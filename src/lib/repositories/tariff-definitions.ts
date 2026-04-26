import { prisma } from "@/lib/prisma";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { TariffDefinitionCreateInput } from "@/lib/repositories/_inputs/tariff-definitions";

export interface TariffDefinitionSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  costFactorId: string;
  costFactorCode: string;
  costFactorDisplayName: string;
  displayName: string;
  computeRule: unknown;
  vatRatePct: string;
  currency: string;
  validFrom: string;
  validUntil: string | null;
  status: string;
}

export async function listAllTariffs(): Promise<TariffDefinitionSummary[]> {
  const db = prisma();
  const rows = await db.tariffDefinition.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      organization: { select: { displayName: true } },
      costFactor: { select: { code: true, displayName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    costFactorId: r.costFactorId,
    costFactorCode: r.costFactor.code,
    costFactorDisplayName: r.costFactor.displayName,
    displayName: r.displayName,
    computeRule: r.computeRule,
    vatRatePct: r.vatRatePct.toString(),
    currency: r.currency,
    validFrom: r.validFrom.toISOString(),
    validUntil: r.validUntil?.toISOString() ?? null,
    status: r.status,
  }));
}

export async function createTariff(input: TariffDefinitionCreateInput, actorUserId: string | null): Promise<TariffDefinitionSummary> {
  const db = prisma();
  const created = await db.tariffDefinition.create({
    data: {
      orgId: input.orgId,
      costFactorId: input.costFactorId,
      displayName: input.displayName,
      computeRule: input.computeRule as object,
      vatRatePct: input.vatRatePct,
      currency: input.currency,
      validFrom: new Date(input.validFrom),
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    },
    include: {
      organization: { select: { displayName: true } },
      costFactor: { select: { code: true, displayName: true } },
    },
  });
  await recordAuditAction({
    orgId: input.orgId,
    actorUserId,
    actorKind: "user",
    action: "tariff.create",
    targetType: "tariff_definition",
    targetId: created.id,
    metadata: { factor: created.costFactor.code, displayName: created.displayName },
  });
  return {
    id: created.id,
    orgId: created.orgId,
    orgDisplayName: created.organization.displayName,
    costFactorId: created.costFactorId,
    costFactorCode: created.costFactor.code,
    costFactorDisplayName: created.costFactor.displayName,
    displayName: created.displayName,
    computeRule: created.computeRule,
    vatRatePct: created.vatRatePct.toString(),
    currency: created.currency,
    validFrom: created.validFrom.toISOString(),
    validUntil: created.validUntil?.toISOString() ?? null,
    status: created.status,
  };
}
