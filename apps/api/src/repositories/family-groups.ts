// FamilyGroup repository — placeholder driver-group model used by
// the org-detail "Driver groups" tab until the broader Zaptec
// UserGroup import flow lands (ADR 0014 follow-up Sprint 5).

import type { PrismaClient } from "../generated/prisma/client";
import type { FamilyGroupSummary } from "@straumvakt/shared/domain/family-groups";

const include = {
  primaryUser: { select: { id: true, displayName: true, email: true } },
  organization: { select: { id: true, displayName: true } },
  _count: { select: { members: true } },
} as const;

type Row = {
  id: string;
  orgId: string;
  displayName: string;
  primaryUser: { id: string; displayName: string | null; email: string };
  organization: { id: string; displayName: string };
  _count: { members: number };
  createdAt: Date;
};

function toSummary(r: Row): FamilyGroupSummary {
  return {
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    displayName: r.displayName,
    primaryUserId: r.primaryUser.id,
    primaryUserDisplayName: r.primaryUser.displayName,
    primaryUserEmail: r.primaryUser.email,
    memberCount: r._count.members,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listFamilyGroupsByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<FamilyGroupSummary[]> {
  const rows = await db.familyGroup.findMany({
    where: { orgId },
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}

export async function listAllFamilyGroups(
  db: PrismaClient,
): Promise<FamilyGroupSummary[]> {
  const rows = await db.familyGroup.findMany({
    orderBy: [{ displayName: "asc" }],
    include,
  });
  return rows.map(toSummary);
}
