// Repository — driver-level DriverGroupMembership catalogue (Sprint 9 / ADR 0019).
//
// Joins agreements.driver_group_memberships → agreements.driver_groups →
// agreements.agreements → identity.users and left-joins
// reports.session_ledger for "last session date".
//
// Per Rule 7: returns UI-shaped objects, never Prisma types.

import type { PrismaClient } from "../generated/prisma/client";

// ─── UI types ────────────────────────────────────────────────────────────────

export interface DriverMembershipRow {
  membershipId: string;
  userId: string;
  userDisplayName: string | null;
  userEmail: string;
  userPhone: string | null;
  /** The DriverGroup the user belongs to. */
  driverGroupId: string;
  driverGroupName: string;
  /** The Agreement the DriverGroup is under. */
  agreementId: string;
  agreementDisplayName: string;
  agreementType: string;
  agreementStatus: string;
  /** When the user was added to the DriverGroup. */
  addedAt: string;
  /** ISO string of the most recent session stopAt or startedAt, null if none. */
  lastSessionAt: string | null;
  /** How many IdToken rows this user has. */
  idTokenCount: number;
  /** True when no session in the past 90 days. */
  isDormant: boolean;
}

export interface DriverContractsTileData {
  totalActiveMembers: number;
  dormantMembers: number;
  /** Count by agreement display name. */
  membersByAgreement: Array<{ agreementDisplayName: string; count: number }>;
}

// ── TENANCY: the `?orgId=` parameter was the only confinement ───────────
//
// `listDriverMemberships` and `getDriverContractsTiles` both took an OPTIONAL
// `orgId` read straight from the query string, and `null` meant every row.
// The route is mounted behind `billing.read`, which `requireAdmin` grants to
// any org member — so omitting the parameter returned **every tenant's driver
// memberships**, and the rows carry `email`, `displayName` and `phone`.
//
// That makes this worse than census row 104 in kind rather than degree: the
// enrichment leak was operational data, this one is personal data about
// people who are not the caller's drivers.
//
// **A caller-supplied filter is not a tenancy control.** It confines the query
// only for callers who choose to send it, which is precisely the set of
// callers who were not the threat.
//
// Both functions now take a REQUIRED `restrictToOrgIds`, applied through one
// shared `ownerOrgWhere` so the tile strip cannot be confined differently from
// the list beneath it. The requested `?orgId=` still narrows further, and the
// route validates it against the caller's memberships through the SAME
// `decideLedgerAccess` the session ledger uses — naming someone else's org is
// a 403, not a quiet narrowing to your own rows.

/** `null` is platform-wide. An empty array is "may see nothing". */
export type DriverContractsTenantScope = string[] | null;

/**
 * The membership predicate for a tenant scope, plus an optional narrowing.
 *
 * Shared by the list and the tiles. `requestedOrgId` has already been checked
 * against the caller's memberships by the route; passing it here narrows, it
 * never widens — an empty allow-list stays empty whatever is requested.
 */
export function ownerOrgWhere(
  restrictToOrgIds: DriverContractsTenantScope,
  requestedOrgId: string | null,
): Record<string, unknown> {
  if (restrictToOrgIds === null) {
    return requestedOrgId ? { driverGroup: { ownerOrgId: requestedOrgId } } : {};
  }
  const orgIds = requestedOrgId
    ? restrictToOrgIds.filter((id) => id === requestedOrgId)
    : restrictToOrgIds;
  // `{ in: [] }` matches nothing, which is what an empty allow-list must mean.
  // `{}` would mean everything, so the empty case is spelled out rather than
  // fallen into.
  return { driverGroup: { ownerOrgId: { in: orgIds } } };
}


// ─── Repository functions ────────────────────────────────────────────────────

/**
 * All DriverGroupMemberships, optionally filtered by the ownerOrgId of
 * the DriverGroup (i.e. which org "owns" the group). Left-joins session
 * ledger for last-session date.
 *
 * orgId here is used as the ownerOrgId of the DriverGroup — the org whose
 * admin console is querying.
 */
export async function listDriverMemberships(
  db: PrismaClient,
  /** REQUIRED. null is platform-wide; an empty array is "may see nothing". */
  restrictToOrgIds: DriverContractsTenantScope,
  requestedOrgId: string | null = null,
): Promise<DriverMembershipRow[]> {
  const where = ownerOrgWhere(restrictToOrgIds, requestedOrgId);

  const memberships = await db.driverGroupMembership.findMany({
    where,
    orderBy: [{ addedAt: "desc" }],
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          phone: true,
          idTokens: { select: { id: true } },
        },
      },
      driverGroup: {
        include: {
          agreement: {
            select: {
              id: true,
              displayName: true,
              agreementType: true,
              status: true,
            },
          },
        },
      },
    },
  });

  // Fetch last-session dates for all users in one query.
  const userIds = [...new Set(memberships.map((m) => m.userId))];
  const lastSessionByUser = new Map<string, Date>();

  if (userIds.length > 0) {
    // GroupBy driverUserId, taking max(stoppedAt) — stoppedAt may be null
    // for in-progress sessions so we fall back to startedAt.
    const ledgerRows = await db.sessionLedger.findMany({
      where: { driverUserId: { in: userIds } },
      select: { driverUserId: true, stoppedAt: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    });
    // Build a map: keep only the most recent date per user.
    for (const row of ledgerRows) {
      if (!row.driverUserId) continue;
      const existing = lastSessionByUser.get(row.driverUserId);
      const ts = row.stoppedAt ?? row.startedAt;
      if (!existing || ts > existing) {
        lastSessionByUser.set(row.driverUserId, ts);
      }
    }
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  return memberships.map((m) => {
    const lastSessionDate = lastSessionByUser.get(m.userId) ?? null;
    const isDormant = lastSessionDate === null || lastSessionDate < ninetyDaysAgo;
    return {
      membershipId: m.id,
      userId: m.user.id,
      userDisplayName: m.user.displayName ?? null,
      userEmail: m.user.email,
      userPhone: m.user.phone ?? null,
      driverGroupId: m.driverGroup.id,
      driverGroupName: m.driverGroup.displayName,
      agreementId: m.driverGroup.agreement.id,
      agreementDisplayName: m.driverGroup.agreement.displayName,
      agreementType: m.driverGroup.agreement.agreementType,
      agreementStatus: m.driverGroup.agreement.status,
      addedAt: m.addedAt.toISOString(),
      lastSessionAt: lastSessionDate ? lastSessionDate.toISOString() : null,
      idTokenCount: m.user.idTokens.length,
      isDormant,
    };
  });
}

/** Tile aggregates for the /billing/driver-contracts dashboard strip. */
export async function getDriverContractsTiles(
  db: PrismaClient,
  /** REQUIRED. Same shared predicate as the list, so the tiles cannot be
   *  confined differently from the rows beneath them. */
  restrictToOrgIds: DriverContractsTenantScope,
  requestedOrgId: string | null = null,
): Promise<DriverContractsTileData> {
  const where = ownerOrgWhere(restrictToOrgIds, requestedOrgId);

  const allMembers = await db.driverGroupMembership.findMany({
    where,
    select: { userId: true, driverGroup: { select: { agreement: { select: { id: true, displayName: true } } } } },
  });

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const userIds = [...new Set(allMembers.map((m) => m.userId))];

  // Count users who had at least one session in the last 90 days.
  let activeSessions: string[] = [];
  if (userIds.length > 0) {
    const recentRows = await db.sessionLedger.findMany({
      where: {
        driverUserId: { in: userIds },
        startedAt: { gte: ninetyDaysAgo },
      },
      select: { driverUserId: true },
      distinct: ["driverUserId"],
    });
    activeSessions = recentRows
      .map((r) => r.driverUserId)
      .filter((id): id is string => id !== null);
  }

  const dormantCount = userIds.filter((uid) => !activeSessions.includes(uid)).length;

  // Members by agreement.
  const agreementCounts = new Map<string, { name: string; count: number }>();
  for (const m of allMembers) {
    const agr = m.driverGroup.agreement;
    const existing = agreementCounts.get(agr.id);
    if (existing) {
      existing.count += 1;
    } else {
      agreementCounts.set(agr.id, { name: agr.displayName, count: 1 });
    }
  }

  return {
    totalActiveMembers: allMembers.length,
    dormantMembers: dormantCount,
    membersByAgreement: Array.from(agreementCounts.values())
      .map((v) => ({ agreementDisplayName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count),
  };
}
