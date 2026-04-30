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
  // Hide already-onboarded chargers from the pending list — even if the
  // gateway is still recording auth attempts (e.g. because Zaptec has
  // Authentication disabled and is connecting anonymously), those rows
  // shouldn't surface as "pending" since the operator already claimed
  // the identity. We compare on lower(identity_string) to match the
  // case-insensitive auth lookup. Operator can still see these via the
  // /chargers list if they want.
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

  if (rows.length === 0) return [];

  const lowerKeys = rows.map((r) => r.identityString.toLowerCase());
  const matchingStrings = await db.$queryRaw<{ identity_string: string }[]>`
    SELECT LOWER(identity_string) AS identity_string FROM ocpp.ocpp_identities
    WHERE LOWER(identity_string) = ANY(${lowerKeys})
  `;
  const onboardedSet = new Set(matchingStrings.map((r) => r.identity_string));

  return rows
    .filter((r) => !onboardedSet.has(r.identityString.toLowerCase()))
    .map((r) => ({
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
