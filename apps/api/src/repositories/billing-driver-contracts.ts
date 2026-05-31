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
  orgId: string | null,
): Promise<DriverMembershipRow[]> {
  const where = orgId
    ? { driverGroup: { ownerOrgId: orgId } }
    : {};

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
  orgId: string | null,
): Promise<DriverContractsTileData> {
  const where = orgId
    ? { driverGroup: { ownerOrgId: orgId } }
    : {};

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
