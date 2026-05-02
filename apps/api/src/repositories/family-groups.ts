// FamilyGroup repository — placeholder driver-group model used by
// the org-detail "Driver groups" tab until the broader Zaptec
// UserGroup import flow lands (ADR 0014 follow-up Sprint 5).

import type { PrismaClient } from "../generated/prisma/client";
import type { FamilyGroupSummary } from "@straumvakt/shared/domain/family-groups";

export async function listFamilyGroupsByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<FamilyGroupSummary[]> {
  const rows = await db.familyGroup.findMany({
    where: { orgId },
    orderBy: [{ displayName: "asc" }],
    include: {
      primaryUser: { select: { id: true, displayName: true, email: true } },
      _count: { select: { members: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    displayName: r.displayName,
    primaryUserId: r.primaryUser.id,
    primaryUserDisplayName: r.primaryUser.displayName,
    primaryUserEmail: r.primaryUser.email,
    memberCount: r._count.members,
    createdAt: r.createdAt.toISOString(),
  }));
}
