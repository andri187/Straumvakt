import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { ContractCreateInput } from "@/lib/repositories/_inputs/contracts";

export interface ContractSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  scopeType: string;
  scopeId: string | null;
  parentContractId: string | null;
  displayName: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
}

export async function listAllContracts(): Promise<ContractSummary[]> {
  const db = prisma();
  const rows = await db.contract.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { organization: { select: { displayName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    parentContractId: r.parentContractId,
    displayName: r.displayName,
    status: r.status,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil?.toISOString() ?? null,
  }));
}

export async function createContract(input: ContractCreateInput, actorUserId: string | null): Promise<ContractSummary> {
  const db = prisma();
  const created = await db.contract.create({
    data: {
      orgId: input.orgId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      parentContractId: input.parentContractId,
      displayName: input.displayName,
      status: input.status,
      validFrom: new Date(input.validFrom),
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    },
    include: { organization: { select: { displayName: true } } },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "contract.create",
    targetType: "contract",
    targetId: created.id,
    metadata: { scopeType: created.scopeType, displayName: created.displayName },
  });
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    scopeType: created.scopeType,
    scopeId: created.scopeId,
    parentContractId: created.parentContractId,
    displayName: created.displayName,
    status: created.status,
    validFrom: created.validFrom.toISOString(),
    validUntil: created.validUntil?.toISOString() ?? null,
  };
}
