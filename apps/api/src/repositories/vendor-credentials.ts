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
}

interface CountStats {
  installationCount: number;
  chargerCount: number;
  chargersOnline: number;
}

function toSummary(r: RawRow, stats: CountStats | null): VendorCredentialSummary {
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
    installationCount: stats?.installationCount ?? null,
    chargerCount: stats?.chargerCount ?? null,
    chargersOnline: stats?.chargersOnline ?? null,
  };
}

/**
 * Per-credential counts: installations linked to this credential
 * (matched via the new credentials_id FK OR the legacy
 * credentials_ref text-match for installations imported before the
 * vault landed), plus chargers under those installations split into
 * online vs offline. Online = OcppIdentity.status='online' OR
 * lastSeenAt within last 5 minutes (projections.ts updates these
 * fields on incoming OCPP events).
 *
 * Single grouped query — O(1) round-trip per list call.
 */
async function statsByCredential(
  db: PrismaClient,
  credentialIds: string[],
): Promise<Map<string, CountStats>> {
  if (credentialIds.length === 0) return new Map();
  const rows = await db.$queryRaw<
    {
      credential_id: string;
      install_count: bigint;
      charger_count: bigint;
      chargers_online: bigint;
    }[]
  >`
    SELECT
      vc.id AS credential_id,
      COUNT(DISTINCT i.id)::BIGINT AS install_count,
      COUNT(DISTINCT cs.site_asset_id)::BIGINT AS charger_count,
      COUNT(DISTINCT cs.site_asset_id) FILTER (
        WHERE oi.status = 'online' OR oi.last_seen_at > NOW() - interval '5 minutes'
      )::BIGINT AS chargers_online
    FROM hardware.vendor_credentials vc
    LEFT JOIN properties.installations i ON
      i.credentials_id = vc.id
      OR (i.org_id = vc.owner_org_id AND i.credentials_ref = vc.username)
    LEFT JOIN assets.charging_stations cs ON cs.installation_id = i.id
    LEFT JOIN ocpp.ocpp_identities oi ON oi.charging_station_id = cs.site_asset_id
    WHERE vc.id = ANY(${credentialIds}::uuid[])
    GROUP BY vc.id
  `;
  const out = new Map<string, CountStats>();
  for (const r of rows) {
    out.set(r.credential_id, {
      installationCount: Number(r.install_count),
      chargerCount: Number(r.charger_count),
      chargersOnline: Number(r.chargers_online),
    });
  }
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
    },
  })) as RawRow[];

  const stats = await statsByCredential(db, rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, stats.get(r.id) ?? null));
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
    },
  })) as RawRow | null;
  if (!row) return null;
  const stats = await statsByCredential(db, [id]);
  return toSummary(row, stats.get(id) ?? null);
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
    },
  })) as RawRow;
  return toSummary(created, null);
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
    },
  })) as RawRow;
  const stats = await statsByCredential(db, [id]);
  return toSummary(updated, stats.get(id) ?? null);
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
