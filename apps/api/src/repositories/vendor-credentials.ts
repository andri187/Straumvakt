// Vendor-credentials repository — per-org Zaptec/Easee/etc. portal
// credentials. Encryption boundary: this layer accepts plaintext on
// create/rotate, seals it via credential-crypto.sealPassword, and
// stores ciphertext + IV columns. open* helpers decrypt for server-
// side re-auth (the operator UI never sees the plaintext).

import type { PrismaClient } from "../generated/prisma/client";
import type { VendorCredentialSummary } from "@straumvakt/shared/domain/vendor-credentials";
import { openPassword, sealPassword } from "../lib/credential-crypto";

interface ListOptions {
  /** When set, restrict to credentials owned by these org ids. Used by org-scoped routes. */
  ownerOrgIds?: string[];
  /** When set, restrict to one vendor slug. */
  vendorSlug?: string;
}

interface RawRow {
  id: string;
  ownerOrgId: string;
  vendorId: string;
  username: string;
  status: string;
  lastUsedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  ownerOrg: { displayName: string };
  vendor: { slug: string; displayName: string };
  _count: { installations: number };
}

function toSummary(r: RawRow, chargerCount: number | null): VendorCredentialSummary {
  return {
    id: r.id,
    ownerOrgId: r.ownerOrgId,
    ownerOrgDisplayName: r.ownerOrg.displayName,
    vendorId: r.vendorId,
    vendorSlug: r.vendor.slug,
    vendorDisplayName: r.vendor.displayName,
    username: r.username,
    status: r.status as "active" | "expired" | "revoked",
    notes: r.notes,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    installationCount: r._count.installations,
    chargerCount,
  };
}

/**
 * Per-credential count of chargers across linked installations.
 * Single grouped query keeps this O(1) regardless of credential count.
 */
async function chargerCountByCredential(
  db: PrismaClient,
  credentialIds: string[],
): Promise<Map<string, number>> {
  if (credentialIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ credentials_id: string; charger_count: bigint }[]>`
    SELECT i.credentials_id, COUNT(cs.site_asset_id)::BIGINT AS charger_count
    FROM properties.installations i
    LEFT JOIN assets.charging_stations cs ON cs.installation_id = i.id
    WHERE i.credentials_id = ANY(${credentialIds}::uuid[])
    GROUP BY i.credentials_id
  `;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.credentials_id, Number(r.charger_count));
  return out;
}

export async function listVendorCredentials(
  db: PrismaClient,
  opts: ListOptions = {},
): Promise<VendorCredentialSummary[]> {
  const where: Record<string, unknown> = {};
  if (opts.ownerOrgIds) where.ownerOrgId = { in: opts.ownerOrgIds };
  if (opts.vendorSlug) where.vendor = { slug: opts.vendorSlug };

  const rows = (await db.vendorCredential.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: {
      ownerOrg: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
      _count: { select: { installations: true } },
    },
  })) as RawRow[];

  const cc = await chargerCountByCredential(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toSummary(r, cc.get(r.id) ?? 0));
}

export async function getVendorCredentialById(
  db: PrismaClient,
  id: string,
): Promise<VendorCredentialSummary | null> {
  const row = (await db.vendorCredential.findUnique({
    where: { id },
    include: {
      ownerOrg: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
      _count: { select: { installations: true } },
    },
  })) as RawRow | null;
  if (!row) return null;
  const cc = await chargerCountByCredential(db, [id]);
  return toSummary(row, cc.get(id) ?? 0);
}

export interface CreateCredentialArgs {
  ownerOrgId: string;
  vendorSlug: string;
  username: string;
  passwordPlaintext: string;
  notes?: string;
  kek: string;
}

export async function createVendorCredential(
  db: PrismaClient,
  args: CreateCredentialArgs,
): Promise<VendorCredentialSummary> {
  const vendor = await db.hardwareVendor.findUnique({
    where: { slug: args.vendorSlug },
    select: { id: true },
  });
  if (!vendor) throw new Error("vendor_not_found");

  const sealed = await sealPassword(args.kek, args.passwordPlaintext);

  const created = (await db.vendorCredential.create({
    data: {
      ownerOrgId: args.ownerOrgId,
      vendorId: vendor.id,
      username: args.username,
      passwordCipher: Buffer.from(sealed.cipher),
      passwordIv: Buffer.from(sealed.iv),
      notes: args.notes,
    },
    include: {
      ownerOrg: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
      _count: { select: { installations: true } },
    },
  })) as RawRow;
  return toSummary(created, 0);
}

export interface UpdateCredentialArgs {
  passwordPlaintext?: string;
  status?: "active" | "expired" | "revoked";
  notes?: string;
  kek: string;
}

export async function updateVendorCredential(
  db: PrismaClient,
  id: string,
  args: UpdateCredentialArgs,
): Promise<VendorCredentialSummary> {
  const data: Record<string, unknown> = {};
  if (args.status !== undefined) data.status = args.status;
  if (args.notes !== undefined) data.notes = args.notes;
  if (args.passwordPlaintext) {
    const sealed = await sealPassword(args.kek, args.passwordPlaintext);
    data.passwordCipher = Buffer.from(sealed.cipher);
    data.passwordIv = Buffer.from(sealed.iv);
  }
  const updated = (await db.vendorCredential.update({
    where: { id },
    data,
    include: {
      ownerOrg: { select: { displayName: true } },
      vendor: { select: { slug: true, displayName: true } },
      _count: { select: { installations: true } },
    },
  })) as RawRow;
  const cc = await chargerCountByCredential(db, [id]);
  return toSummary(updated, cc.get(id) ?? 0);
}

export async function deleteVendorCredential(
  db: PrismaClient,
  id: string,
): Promise<void> {
  await db.vendorCredential.delete({ where: { id } });
}

/**
 * Decrypt the stored password for a credential. Used server-side to
 * re-auth against the vendor's API. Updates last_used_at as a side
 * effect so the operator UI can show "last used" timestamps.
 */
export async function unsealVendorCredentialPassword(
  db: PrismaClient,
  id: string,
  kek: string,
): Promise<{ username: string; password: string; vendorSlug: string }> {
  const row = await db.vendorCredential.findUnique({
    where: { id },
    select: {
      username: true,
      passwordCipher: true,
      passwordIv: true,
      vendor: { select: { slug: true } },
    },
  });
  if (!row) throw new Error("credential_not_found");
  if (!row.passwordCipher || !row.passwordIv) {
    throw new Error("credential_password_missing");
  }
  const password = await openPassword(kek, {
    cipher: row.passwordCipher,
    iv: row.passwordIv,
  });
  await db.vendorCredential.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  });
  return { username: row.username, password, vendorSlug: row.vendor.slug };
}
