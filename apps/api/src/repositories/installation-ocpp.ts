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

// 32-char alphabet (a-z minus l/o + 2-9): exactly 32 chars so each
// random byte's low 5 bits map to one output char without modulo
// bias. Excludes l and o because operators copy passwords by hand
// from our reveal panel into the vendor portal — 1/l and 0/o are
// the most common transcription errors.
const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * 20-character lowercase alphanumeric, ~100 bits of entropy. Short
 * enough to fit charger firmware password fields (Zaptec,
 * ChargeAmps, Easee tend to cap around 20–32 chars; the old 64-char
 * hex output overflowed silently on some models).
 */
function generatePassword(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += PASSWORD_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
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
  hash: string | null,
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
 *
 * Length rules:
 *   • 8–128 chars: normal Basic-Auth credential.
 *   • Any other non-empty length: rejected.
 *   • Empty: rejected by this entrypoint — use
 *     disableInstallationOcppAuth() instead so the no-auth flip is
 *     a deliberate, named operation rather than a silent
 *     consequence of submitting blank plaintext.
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
 * NULL out the auth_secret_hash for every OcppIdentity in this
 * installation, putting the chargers on the **no-auth** path: our
 * gateway will accept their WebSocket upgrade without Basic Auth.
 *
 * This is an opt-in security relaxation. Anyone who knows the
 * identity-string (which is not secret — it's printed on the
 * charger label and written into the vendor portal in plaintext)
 * can connect as that charger and inject events. Use only when:
 *   • The charger firmware genuinely cannot send Basic Auth, AND
 *   • The operational consequence (someone forging events) is
 *     bounded for this fleet.
 *
 * Audit log records who flipped the flag and on which installation.
 */
export async function disableInstallationOcppAuth(
  db: PrismaClient,
  installationId: string,
  actorUserId: string | null,
): Promise<SetResult | null> {
  const ctx = await loadInstallationContext(db, installationId);
  if (!ctx) return null;

  const identityCount = await db.$transaction(async (tx) => {
    const count = await bulkSetHash(tx, installationId, null);
    await recordAuditAction(tx, {
      orgId: ctx.orgId,
      actorUserId,
      actorKind: "user",
      action: "installation.ocpp_password.disable",
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
 * this installation, when this module last rotated/set/disabled the
 * password, and whether the installation is currently on the
 * no-auth path. "authMode" reflects what the rows actually store:
 *   • "basic"  — every identity has a hash. Charger must send Basic
 *                Auth.
 *   • "none"   — every identity has NULL hash. Charger may connect
 *                without Basic Auth.
 *   • "mixed"  — some have a hash, some don't. Should not happen in
 *                normal operation (rotate/set/disable updates all);
 *                surfaced explicitly so the UI flags the drift.
 *   • "empty"  — no identities yet (installation has no chargers).
 *
 * "Last rotated" reads from the audit log
 * (`installation.ocpp_password.{rotate,set,disable}`) — using
 * OcppIdentity.updated_at would falsely bump on unrelated changes
 * (lastSeenAt, status, etc.).
 */
export type InstallationAuthMode = "basic" | "none" | "mixed" | "empty";

export interface InstallationOcppSummary {
  installationId: string;
  identityCount: number;
  lastRotatedAt: Date | null;
  authMode: InstallationAuthMode;
}

function deriveAuthMode(rows: { authSecretHash: string | null }[]): InstallationAuthMode {
  if (rows.length === 0) return "empty";
  const withHash = rows.filter((r) => r.authSecretHash !== null).length;
  const withoutHash = rows.length - withHash;
  if (withHash === 0) return "none";
  if (withoutHash === 0) return "basic";
  return "mixed";
}

export async function getInstallationOcppSummary(
  db: PrismaClient,
  installationId: string,
): Promise<InstallationOcppSummary | null> {
  const ctx = await loadInstallationContext(db, installationId);
  if (!ctx) return null;

  const rows = await db.ocppIdentity.findMany({
    where: { chargingStation: { installationId } },
    select: { authSecretHash: true },
  });

  const lastAudit = await db.auditAction.findFirst({
    where: {
      targetType: "installation",
      targetId: installationId,
      action: {
        in: [
          "installation.ocpp_password.rotate",
          "installation.ocpp_password.set",
          "installation.ocpp_password.disable",
        ],
      },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });

  return {
    installationId,
    identityCount: rows.length,
    lastRotatedAt: lastAudit?.occurredAt ?? null,
    authMode: deriveAuthMode(rows),
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
  // Pull all identities + their hash state, partitioned by
  // installation id via the ChargingStation join.
  const identityRows = await db.ocppIdentity.findMany({
    where: { chargingStation: { installationId: { not: null } } },
    select: {
      authSecretHash: true,
      chargingStation: { select: { installationId: true } },
    },
  });
  const byInstallation = new Map<string, { authSecretHash: string | null }[]>();
  for (const row of identityRows) {
    const instId = row.chargingStation.installationId;
    if (!instId) continue;
    const list = byInstallation.get(instId) ?? [];
    list.push({ authSecretHash: row.authSecretHash });
    byInstallation.set(instId, list);
  }

  // Latest rotation/set/disable audit per installation. We pull every
  // matching audit row ordered desc, then keep only the first per
  // targetId — small volume (one row per change), bounded.
  const audits = await db.auditAction.findMany({
    where: {
      targetType: "installation",
      action: {
        in: [
          "installation.ocpp_password.rotate",
          "installation.ocpp_password.set",
          "installation.ocpp_password.disable",
        ],
      },
    },
    orderBy: { occurredAt: "desc" },
    select: { targetId: true, occurredAt: true },
  });
  const lastRotatedAt = new Map<string, Date>();
  for (const a of audits) {
    if (!a.targetId) continue;
    if (!lastRotatedAt.has(a.targetId)) lastRotatedAt.set(a.targetId, a.occurredAt);
  }

  const all = new Set<string>([...byInstallation.keys(), ...lastRotatedAt.keys()]);
  const result = new Map<string, InstallationOcppSummary>();
  for (const installationId of all) {
    const rows = byInstallation.get(installationId) ?? [];
    result.set(installationId, {
      installationId,
      identityCount: rows.length,
      lastRotatedAt: lastRotatedAt.get(installationId) ?? null,
      authMode: deriveAuthMode(rows),
    });
  }
  return result;
}
