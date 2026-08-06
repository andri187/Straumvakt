// FamilyGroup repository — placeholder driver-group model used by
// the org-detail "Driver groups" tab until the broader Zaptec
// UserGroup import flow lands (ADR 0014 follow-up Sprint 5).
//
// Moved from src/repositories/family-groups.ts and ported from Prisma in the
// same commit.
//
// Prisma's `_count: { select: { members: true } }` becomes an explicit
// correlated subquery. Drizzle has no relational count, and a LEFT JOIN with
// GROUP BY would change the row shape for the two joined display columns —
// a scalar subquery keeps the query one row per group, which is what the
// mapper assumes.

import { asc, eq, sql } from "drizzle-orm";
import type { FamilyGroupSummary } from "@straumvakt/shared/domain/family-groups";
import type { Db } from "../../../lib/drizzle";
import { familyGroups, familyMemberships, organizations, users } from "@straumvakt/shared/db/identity";

type Row = {
  id: string;
  orgId: string;
  displayName: string;
  primaryUserId: string;
  primaryUserDisplayName: string | null;
  primaryUserEmail: string;
  orgDisplayName: string;
  memberCount: number;
  createdAt: Date;
};

function toSummary(r: Row): FamilyGroupSummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.orgDisplayName,
    displayName: r.displayName,
    primaryUserId: r.primaryUserId,
    primaryUserDisplayName: r.primaryUserDisplayName,
    primaryUserEmail: r.primaryUserEmail,
    memberCount: r.memberCount,
    createdAt: r.createdAt.toISOString(),
  };
}

const COLUMNS = {
  id: familyGroups.id,
  orgId: familyGroups.orgId,
  displayName: familyGroups.displayName,
  createdAt: familyGroups.createdAt,
  primaryUserId: users.id,
  primaryUserDisplayName: users.displayName,
  primaryUserEmail: users.email,
  orgDisplayName: organizations.displayName,
  // `_count.members` — cast because Postgres count() is bigint and
  // node-postgres hands bigint back as a string.
  memberCount: sql<number>`(
    select count(*)::int from ${familyMemberships}
     where ${familyMemberships.familyGroupId} = ${familyGroups.id}
  )`,
} as const;

/** innerJoin on both, matching Prisma: `primaryUser` and `organization` are
 *  required relations, so a group with a dangling FK was already invisible. */
function baseQuery(db: Db) {
  return db
    .select(COLUMNS)
    .from(familyGroups)
    .innerJoin(users, eq(users.id, familyGroups.primaryUserId))
    .innerJoin(organizations, eq(organizations.id, familyGroups.orgId));
}

export async function listFamilyGroupsByOrg(
  db: Db,
  orgId: string,
): Promise<FamilyGroupSummary[]> {
  const rows = await baseQuery(db)
    .where(eq(familyGroups.orgId, orgId))
    .orderBy(asc(familyGroups.displayName));
  return (rows as Row[]).map(toSummary);
}

export async function listAllFamilyGroups(db: Db): Promise<FamilyGroupSummary[]> {
  const rows = await baseQuery(db).orderBy(asc(familyGroups.displayName));
  return (rows as Row[]).map(toSummary);
}
