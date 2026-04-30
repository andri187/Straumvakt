// Pending-discoveries repository — read-only from the operator
// console's perspective. Rows are written by the OCPP gateway auth
// path (see src/app/api/internal/ocpp-auth/route.ts) and deleted
// either by an operator dismiss action or automatically when a
// charger create lands a matching identity_string.

import type { PrismaClient } from "../generated/prisma/client";

export interface PendingDiscoverySummary {
  identityString: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
  remoteAddr: string | null;
  userAgent: string | null;
}

export async function listPendingDiscoveries(
  db: PrismaClient,
): Promise<PendingDiscoverySummary[]> {
  // Returns ALL pending rows — including ones that match an existing
  // OcppIdentity. A "matches but is in pending" row is signal, not
  // noise: the charger is connecting to the gateway but failing auth
  // (typically because Zaptec has PropertyAuthenticationDisabled = true
  // and is connecting anonymously). The page UI distinguishes the two
  // cases visually so the operator can spot config drift.
  const rows = await db.pendingDiscovery.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: {
      identityString: true,
      firstSeenAt: true,
      lastSeenAt: true,
      attemptCount: true,
      remoteAddr: true,
      userAgent: true,
    },
  });
  return rows.map((r) => ({
    identityString: r.identityString,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    attemptCount: r.attemptCount,
    remoteAddr: r.remoteAddr,
    userAgent: r.userAgent,
  }));
}

/** Delete by identity_string. Idempotent — no-op if row is missing. */
export async function deletePendingDiscovery(
  db: PrismaClient,
  identityString: string,
): Promise<void> {
  await db.pendingDiscovery.deleteMany({ where: { identityString } });
}

/**
 * Bulk-delete pending rows whose last_seen_at is older than the
 * "live" window (5 min). Operator triggers this from /chargers/pending
 * to clear out the noise — chargers that briefly probed the gateway
 * once and never came back. If a cleared row's charger reconnects
 * later, the gateway's no-auth hook re-creates the row at the next
 * retry, so this is non-destructive.
 *
 * Returns count of deleted rows so the UI can flash a confirmation.
 */
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

export async function clearIdlePendingDiscoveries(db: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - IDLE_THRESHOLD_MS);
  const r = await db.pendingDiscovery.deleteMany({
    where: { lastSeenAt: { lt: cutoff } },
  });
  return r.count;
}

/**
 * Upsert a row keyed by identity_string. Called from the OCPP auth
 * route on a 403 (unknown identity OR bad password). Identity string
 * is lowercased before write so the same charger retrying from
 * different firmware versions doesn't pile up under multiple cases —
 * Zaptec sends lowercase post-Jan 2023 (legacy uppercase toggle
 * deprecated), and operator-typed entries vary by hand.
 */
export async function upsertPendingDiscovery(
  db: PrismaClient,
  args: {
    identityString: string;
    remoteAddr: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const key = args.identityString.toLowerCase();
  await db.pendingDiscovery.upsert({
    where: { identityString: key },
    create: {
      identityString: key,
      attemptCount: 1,
      remoteAddr: args.remoteAddr ? args.remoteAddr.slice(0, 64) : null,
      userAgent: args.userAgent ? args.userAgent.slice(0, 255) : null,
    },
    update: {
      lastSeenAt: new Date(),
      attemptCount: { increment: 1 },
      remoteAddr: args.remoteAddr ? args.remoteAddr.slice(0, 64) : null,
      userAgent: args.userAgent ? args.userAgent.slice(0, 255) : null,
    },
  });
}
