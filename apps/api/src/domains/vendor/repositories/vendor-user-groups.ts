// VendorUserGroup repository — Zaptec UserGroup mirror.
// Populated by the user-import sync engine (deferred). Read paths are
// available now so the /tenants/groups page can list them as soon as
// rows start landing.
//
// Moved from src/repositories/vendor-user-groups.ts and ported from Prisma
// in the same commit.
//
// WHY IT LIVES IN `vendor` AND NOT `identity`
// -------------------------------------------
// Its table is `identity.vendor_user_groups` — a Postgres-schema placement
// that predates the domain split — but the thing it models is a mirror of a
// Zaptec construct, and the query has to join `properties.installations` for
// the display name. That join is identity → assets, which the layering rule
// forbids, and it is the same shape as the org-email-domains problem parked
// as P4.
//
// Resolving it by domain rather than by exception: a VendorUserGroup is a
// vendor concept, `vendor` sits outside the four-layer chain, and nothing
// forbids vendor from importing what it needs. The rule that does apply —
// nothing may import vendor — now correctly flags the admin route that lists
// these, which is an honest description of a page that renders Zaptec's
// groups.

import { asc, eq, sql } from "drizzle-orm";
import type { VendorUserGroupSummary } from "@straumvakt/shared/domain/vendor-user-groups";
import type { Db } from "../../../lib/drizzle";
import { vendorUserGroups, vendorUserGroupMemberships, organizations } from "../../identity/schema";
import { installations } from "../../assets/schema";

type Row = {
  id: string;
  vendorSlug: string;
  vendorGroupId: string;
  installationId: string;
  installationDisplayName: string;
  orgId: string;
  orgDisplayName: string;
  name: string;
  memberCount: number;
  lastSyncedAt: Date;
  createdAt: Date;
};

function toSummary(r: Row): VendorUserGroupSummary {
  return {
    id: r.id,
    vendorSlug: r.vendorSlug,
    vendorGroupId: r.vendorGroupId,
    installationId: r.installationId,
    installationDisplayName: r.installationDisplayName,
    orgId: r.orgId,
    orgDisplayName: r.orgDisplayName,
    name: r.name,
    memberCount: r.memberCount,
    lastSyncedAt: r.lastSyncedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

const COLUMNS = {
  id: vendorUserGroups.id,
  vendorSlug: vendorUserGroups.vendorSlug,
  vendorGroupId: vendorUserGroups.vendorGroupId,
  installationId: vendorUserGroups.installationId,
  name: vendorUserGroups.name,
  lastSyncedAt: vendorUserGroups.lastSyncedAt,
  createdAt: vendorUserGroups.createdAt,
  installationDisplayName: installations.displayName,
  orgId: installations.orgId,
  orgDisplayName: organizations.displayName,
  // Prisma's `_count.memberships`. A correlated subquery rather than a
  // GROUP BY, so the result stays one row per group for the joined columns.
  memberCount: sql<number>`(
    select count(*)::int from ${vendorUserGroupMemberships}
     where ${vendorUserGroupMemberships.groupId} = ${vendorUserGroups.id}
  )`,
} as const;

function baseQuery(db: Db) {
  return db
    .select(COLUMNS)
    .from(vendorUserGroups)
    .innerJoin(installations, eq(installations.id, vendorUserGroups.installationId))
    .innerJoin(organizations, eq(organizations.id, installations.orgId));
}

export async function listAllVendorUserGroups(db: Db): Promise<VendorUserGroupSummary[]> {
  const rows = await baseQuery(db).orderBy(asc(vendorUserGroups.name));
  return (rows as Row[]).map(toSummary);
}

export async function listVendorUserGroupsByInstallation(
  db: Db,
  installationId: string,
): Promise<VendorUserGroupSummary[]> {
  const rows = await baseQuery(db)
    .where(eq(vendorUserGroups.installationId, installationId))
    .orderBy(asc(vendorUserGroups.name));
  return (rows as Row[]).map(toSummary);
}
