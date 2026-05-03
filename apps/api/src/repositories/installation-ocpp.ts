// Installation-level OCPP password management.
//
// Zaptec applies one OCPP Basic-Auth password across every charger in
// an installation — the portal can't set it per-charger, so neither
// can we (yet). Onboarding via zaptec-import.ts hashes the operator-
// supplied password once and stamps the same hash onto every
// OcppIdentity in that installation. Until this module landed there
// was no way to rotate or change that password without re-importing.
//
// This repository exposes two operations:
//
//   • rotateInstallationOcppPassword — generate a fresh random
//     password, hash it, bulk-update every OcppIdentity row inside
//     the installation, and return the plaintext **once**. The
//     plaintext is never persisted; callers must surface it to the
//     operator immediately so they can paste it into the Zaptec
//     portal (or whatever vendor portal owns the charger-side
//     config).
//
//   • setInstallationOcppPassword — same bulk-update, but with an
//     operator-supplied plaintext. Used when the operator wants to
//     mirror a known password (e.g. one they've already typed into
//     Zaptec's portal).
//
// Both operations are tx-safe: hash + bulk-update + audit row in one
// $transaction, so a partial failure never leaves chargers with
// mixed hashes.
//
// Pushing the new password to chargers via Zaptec REST is **out of
// scope** for this module — that's a separate Zaptec-side concern.
// We surface the plaintext; the operator is responsible for getting
// it into the vendor portal. A future commit can wire
// UpdateOcppSettings via the encrypted vendor credential we already
// store (see credential-management.ts).

import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";

export interface RotateResult {
  installationId: string;
  identityCount: number;
  plaintext: string;
}

export interface SetResult {
  installationId: string;
  identityCount: number;
}

/**
 * 32 bytes of CSPRNG → 64-char lowercase hex. Matches the format
 * generatePassword() uses elsewhere (chargers.ts, onboarding-chains.ts)
 * so chargers onboarded by either path show the same plaintext shape.
 */
function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

async function loadInstallationContext(
  db: PrismaClient | Prisma.TransactionClient,
  installationId: string,
): Promise<{ id: string; orgId: string } | null> {
  return db.installation.findUnique({
    where: { id: installationId },
    select: { id: true, orgId: true },
  });
}

/**
 * Bulk-update every OcppIdentity row whose ChargingStation lives in
 * this installation. Returns the row count Prisma reports — the
 * operator uses this to confirm the rotation hit the expected number
 * of chargers.
 */
async function bulkSetHash(
  tx: Prisma.TransactionClient,
  installationId: string,
  hash: string,
): Promise<number> {
  const result = await tx.ocppIdentity.updateMany({
    where: { chargingStation: { installationId } },
    data: { authSecretHash: hash },
  });
  return result.count;
}

/**
 * Generate a new password, hash it, stamp it across every OcppIdentity
 * in the installation, and return the plaintext.
 *
 * Callers MUST treat the returned plaintext as one-shot — it is never
 * stored after this function returns. If the caller drops it on the
 * floor, the only recovery is another rotation.
 */
export async function rotateInstallationOcppPassword(
  db: PrismaClient,
  installationId: string,
  actorUserId: string | null,
): Promise<RotateResult | null> {
  const ctx = await loadInstallationContext(db, installationId);
  if (!ctx) return null;

  const plaintext = generatePassword();
  const hash = await sha256Hex(plaintext);

  const identityCount = await db.$transaction(async (tx) => {
    const count = await bulkSetHash(tx, installationId, hash);
    await recordAuditAction(tx, {
      orgId: ctx.orgId,
      actorUserId,
      actorKind: "user",
      action: "installation.ocpp_password.rotate",
      targetType: "installation",
      targetId: installationId,
      metadata: { identityCount: count },
    });
    return count;
  });

  return { installationId, identityCount, plaintext };
}

/**
 * Hash the operator-supplied plaintext and stamp it across every
 * OcppIdentity in the installation. Plaintext never persists — only
 * the hash.
 */
export async function setInstallationOcppPassword(
  db: PrismaClient,
  installationId: string,
  plaintext: string,
  actorUserId: string | null,
): Promise<SetResult | null> {
  const ctx = await loadInstallationContext(db, installationId);
  if (!ctx) return null;

  if (plaintext.length < 8 || plaintext.length > 128) {
    throw new Error("password_length_invalid");
  }

  const hash = await sha256Hex(plaintext);

  const identityCount = await db.$transaction(async (tx) => {
    const count = await bulkSetHash(tx, installationId, hash);
    await recordAuditAction(tx, {
      orgId: ctx.orgId,
      actorUserId,
      actorKind: "user",
      action: "installation.ocpp_password.set",
      targetType: "installation",
      targetId: installationId,
      metadata: { identityCount: count },
    });
    return count;
  });

  return { installationId, identityCount };
}

/**
 * Read-only summary for the UI: how many OcppIdentity rows live in
 * this installation, and when this module last rotated/set the
 * password. "Last rotated" reads from the audit log
 * (`installation.ocpp_password.{rotate,set}`) — using OcppIdentity.
 * updated_at would falsely bump on unrelated changes (lastSeenAt,
 * status, etc.) and report stale rotation times.
 */
export interface InstallationOcppSummary {
  installationId: string;
  identityCount: number;
  lastRotatedAt: Date | null;
}

export async function getInstallationOcppSummary(
  db: PrismaClient,
  installationId: string,
): Promise<InstallationOcppSummary | null> {
  const ctx = await loadInstallationContext(db, installationId);
  if (!ctx) return null;

  const identityCount = await db.ocppIdentity.count({
    where: { chargingStation: { installationId } },
  });

  const lastAudit = await db.auditAction.findFirst({
    where: {
      targetType: "installation",
      targetId: installationId,
      action: { in: ["installation.ocpp_password.rotate", "installation.ocpp_password.set"] },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });

  return {
    installationId,
    identityCount,
    lastRotatedAt: lastAudit?.occurredAt ?? null,
  };
}

/**
 * Bulk version of getInstallationOcppSummary — one row per
 * installation that has at least one OcppIdentity. Used by the
 * /installations list page to enrich each row without N+1 round
 * trips.
 *
 * Returns a Map keyed by installation_id so callers can `.get(id)
 * ?? defaultSummary(id)` without allocating placeholders for
 * installations that don't have any chargers yet.
 */
export async function listInstallationOcppSummaries(
  db: PrismaClient,
): Promise<Map<string, InstallationOcppSummary>> {
  // Identity counts per installation. groupBy walks the OcppIdentity
  // → ChargingStation relation, so we hop through chargingStation in
  // a where filter for installationId presence.
  const identityRows = await db.ocppIdentity.findMany({
    where: { chargingStation: { installationId: { not: null } } },
    select: { chargingStation: { select: { installationId: true } } },
  });
  const identityCount = new Map<string, number>();
  for (const row of identityRows) {
    const instId = row.chargingStation.installationId;
    if (!instId) continue;
    identityCount.set(instId, (identityCount.get(instId) ?? 0) + 1);
  }

  // Latest rotation/set audit per installation. We pull every
  // matching audit row ordered desc, then keep only the first per
  // targetId — small volume (one row per rotation), bounded.
  const audits = await db.auditAction.findMany({
    where: {
      targetType: "installation",
      action: { in: ["installation.ocpp_password.rotate", "installation.ocpp_password.set"] },
    },
    orderBy: { occurredAt: "desc" },
    select: { targetId: true, occurredAt: true },
  });
  const lastRotatedAt = new Map<string, Date>();
  for (const a of audits) {
    if (!a.targetId) continue;
    if (!lastRotatedAt.has(a.targetId)) lastRotatedAt.set(a.targetId, a.occurredAt);
  }

  const all = new Set<string>([...identityCount.keys(), ...lastRotatedAt.keys()]);
  const result = new Map<string, InstallationOcppSummary>();
  for (const installationId of all) {
    result.set(installationId, {
      installationId,
      identityCount: identityCount.get(installationId) ?? 0,
      lastRotatedAt: lastRotatedAt.get(installationId) ?? null,
    });
  }
  return result;
}
