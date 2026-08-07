// Pending-discoveries repository — read-only from the operator
// console's perspective. Rows are written by the OCPP gateway auth
// path (see src/app/api/internal/ocpp-auth/route.ts) and deleted
// either by an operator dismiss action or automatically when a
// charger create lands a matching identity_string.

import { desc, eq, lt, sql } from "drizzle-orm";
import { pendingDiscoveries } from "@straumvakt/shared/db/protocol";
import type { Db } from "../lib/drizzle";

export interface PendingDiscoverySummary {
  identityString: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
  remoteAddr: string | null;
  userAgent: string | null;
}

export async function listPendingDiscoveries(
  db: Db,
): Promise<PendingDiscoverySummary[]> {
  // Returns ALL pending rows — including ones that match an existing
  // OcppIdentity. A "matches but is in pending" row is signal, not
  // noise: the charger is connecting to the gateway but failing auth
  // (typically because Zaptec has PropertyAuthenticationDisabled = true
  // and is connecting anonymously). The page UI distinguishes the two
  // cases visually so the operator can spot config drift.
  const rows = await db
    .select({
      identityString: pendingDiscoveries.identityString,
      firstSeenAt: pendingDiscoveries.firstSeenAt,
      lastSeenAt: pendingDiscoveries.lastSeenAt,
      attemptCount: pendingDiscoveries.attemptCount,
      remoteAddr: pendingDiscoveries.remoteAddr,
      userAgent: pendingDiscoveries.userAgent,
    })
    .from(pendingDiscoveries)
    .orderBy(desc(pendingDiscoveries.lastSeenAt));
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
  db: Db,
  identityString: string,
): Promise<void> {
  await db.delete(pendingDiscoveries).where(eq(pendingDiscoveries.identityString, identityString));
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

export async function clearIdlePendingDiscoveries(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - IDLE_THRESHOLD_MS);
  // Prisma's deleteMany returned { count }. Drizzle has no row count on
  // node-postgres deletes without RETURNING, so return the ids and count
  // them — same number, one round trip either way.
  const deleted = await db
    .delete(pendingDiscoveries)
    .where(lt(pendingDiscoveries.lastSeenAt, cutoff))
    .returning({ identityString: pendingDiscoveries.identityString });
  return deleted.length;
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
  db: Db,
  args: {
    identityString: string;
    remoteAddr: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const key = args.identityString.toLowerCase();
  const remoteAddr = args.remoteAddr ? args.remoteAddr.slice(0, 64) : null;
  const userAgent = args.userAgent ? args.userAgent.slice(0, 255) : null;
  await db
    .insert(pendingDiscoveries)
    .values({ identityString: key, attemptCount: 1, remoteAddr, userAgent })
    .onConflictDoUpdate({
      target: pendingDiscoveries.identityString,
      set: {
        lastSeenAt: new Date(),
        // Prisma's `{ increment: 1 }` — the read-modify-write has to stay in
        // SQL, not JS, or two gateway retries racing lose a count.
        attemptCount: sql`${pendingDiscoveries.attemptCount} + 1`,
        remoteAddr,
        userAgent,
      },
    });
}
