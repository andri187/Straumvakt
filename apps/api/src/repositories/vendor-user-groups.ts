// VendorUserGroup repository — Zaptec UserGroup mirror.
// Populated by the user-import sync engine (deferred). Read paths are
// available now so the /tenants/groups page can list them as soon as
// rows start landing.

import type { PrismaClient } from "../generated/prisma/client";
import type { VendorUserGroupSummary } from "@straumvakt/shared/domain/vendor-user-groups";

const include = {
  installation: {
    select: {
      displayName: true,
      orgId: true,
      organization: { select: { displayName: true } },
    },
  },
  _count: { select: { memberships: true } },
} as const;

type Row = {
  id: string;
  vendorSlug: string;
  vendorGroupId: string;
  installationId: string;
  name: string;
  installation: {
    displayName: string;
    orgId: string;
    organization: { displayName: string };
  };
  _count: { memberships: number };
  lastSyncedAt: Date;
  createdAt: Date;
};

function toSummary(r: Row): VendorUserGroupSummary {
  return {
    id: r.id,
    vendorSlug: r.vendorSlug,
    vendorGroupId: r.vendorGroupId,
    installationId: r.installationId,
    installationDisplayName: r.installation.displayName,
    orgId: r.installation.orgId,
    orgDisplayName: r.installation.organization.displayName,
    name: r.name,
    memberCount: r._count.memberships,
    lastSyncedAt: r.lastSyncedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listAllVendorUserGroups(
  db: PrismaClient,
): Promise<VendorUserGroupSummary[]> {
  const rows = await db.vendorUserGroup.findMany({
    orderBy: [{ name: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function listVendorUserGroupsByInstallation(
  db: PrismaClient,
  installationId: string,
): Promise<VendorUserGroupSummary[]> {
  const rows = await db.vendorUserGroup.findMany({
    where: { installationId },
    orderBy: [{ name: "asc" }],
    include,
  });
  return rows.map(toSummary);
}
