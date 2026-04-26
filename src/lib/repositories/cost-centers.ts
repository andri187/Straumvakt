import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { CostCenterCreateInput } from "@/lib/repositories/_inputs/cost-centers";

export interface CostCenterSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  code: string;
  displayName: string;
  payerOrgId: string | null;
  payerOrgDisplayName: string | null;
  payerUserId: string | null;
  beneficiaryOrgId: string | null;
  beneficiaryOrgDisplayName: string | null;
  status: string;
}

export async function listAllCostCenters(): Promise<CostCenterSummary[]> {
  const db = prisma();
  const rows = await db.costCenter.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      payerOrg: { select: { displayName: true } },
      beneficiaryOrg: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    code: r.code,
    displayName: r.displayName,
    payerOrgId: r.payerOrgId,
    payerOrgDisplayName: r.payerOrg?.displayName ?? null,
    payerUserId: r.payerUserId,
    beneficiaryOrgId: r.beneficiaryOrgId,
    beneficiaryOrgDisplayName: r.beneficiaryOrg?.displayName ?? null,
    status: r.status,
  }));
}

export async function createCostCenter(input: CostCenterCreateInput, actorUserId: string | null): Promise<CostCenterSummary> {
  const db = prisma();
  const created = await db.costCenter.create({
    data: {
      orgId: input.orgId,
      code: input.code,
      displayName: input.displayName,
      payerOrgId: input.payerOrgId,
      payerUserId: input.payerUserId,
      beneficiaryOrgId: input.beneficiaryOrgId,
    },
    include: {
      organization: { select: { displayName: true } },
      payerOrg: { select: { displayName: true } },
      beneficiaryOrg: { select: { displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "cost-center.create",
    targetType: "cost_center",
    targetId: created.id,
    metadata: { code: created.code },
  });
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    code: created.code,
    displayName: created.displayName,
    payerOrgId: created.payerOrgId,
    payerOrgDisplayName: created.payerOrg?.displayName ?? null,
    payerUserId: created.payerUserId,
    beneficiaryOrgId: created.beneficiaryOrgId,
    beneficiaryOrgDisplayName: created.beneficiaryOrg?.displayName ?? null,
    status: created.status,
  };
}
