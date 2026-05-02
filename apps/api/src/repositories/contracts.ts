// Org-level Contract repository (billing.contracts).
// Distinct from DriverContract (people.driver_contracts).

import type { PrismaClient } from "../generated/prisma/client";
import type {
  ContractScopeType,
  ContractStatus,
  ContractSummary,
} from "@straumvakt/shared/domain/contracts";

export async function listContractsByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<ContractSummary[]> {
  const rows = await db.contract.findMany({
    where: { orgId },
    orderBy: [{ validFrom: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    displayName: r.displayName,
    status: r.status as ContractStatus,
    scopeType: r.scopeType as ContractScopeType,
    scopeId: r.scopeId,
    parentContractId: r.parentContractId,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
