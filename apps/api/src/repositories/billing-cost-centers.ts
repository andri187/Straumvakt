// Repository for the billing cost-centers catalogue (Track D, Sprint 9).
//
// A CostCenter in the Straumvakt schema (billing.cost_centers) is an
// explicit allocation entity that routes billed amounts to a specific
// payer (payerOrg or payerUser) and/or beneficiary (beneficiaryOrg).
// It is NOT just a filtered view of tenancy.organizations.
//
// Each CostCenter is owned by an org (orgId), has an optional payer org,
// optional payer user, and optional beneficiary org. billing_lines carry
// a costCenterId FK, enabling per-center revenue aggregation.

import type { PrismaClient } from "../generated/prisma/client";

export interface CostCenterRow {
  id: string;
  orgId: string;
  orgDisplayName: string;
  code: string;
  displayName: string;
  payerOrgId: string | null;
  payerOrgDisplayName: string | null;
  payerUserId: string | null;
  payerUserDisplayName: string | null;
  beneficiaryOrgId: string | null;
  beneficiaryOrgDisplayName: string | null;
  status: string;
  activeMembershipCount: number;
  lastSessionDate: string | null;  // ISO date string
  currentPeriodCostIskMinor: string; // BigInt as string
  anchoredTariffCount: number;
  createdAt: string;
}

/** Returns [start, end) Date bounds for a calendar month (UTC). */
function monthBoundsUtc(year: number, month: number): [Date, Date] {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return [start, end];
}

export async function listCostCenters(
  db: PrismaClient,
  year: number,
  month: number,
): Promise<CostCenterRow[]> {
  const [periodStart, periodEnd] = monthBoundsUtc(year, month);

  // 1. Fetch all cost centers with their relations
  const costCenters = await db.costCenter.findMany({
    include: {
      organization: { select: { id: true, displayName: true } },
      payerOrg: { select: { id: true, displayName: true } },
      payerUser: { select: { id: true, displayName: true } },
      beneficiaryOrg: { select: { id: true, displayName: true } },
    },
    orderBy: [{ orgId: "asc" }, { displayName: "asc" }],
  });

  if (costCenters.length === 0) return [];

  const costCenterIds = costCenters.map((cc) => cc.id);
  const orgIds = Array.from(new Set(costCenters.map((cc) => cc.orgId)));

  // 2. Per-center billing_line aggregates for current period
  const billingAggs = await db.billingLine.groupBy({
    by: ["costCenterId"],
    where: {
      costCenterId: { in: costCenterIds },
      createdAt: { gte: periodStart, lt: periodEnd },
    },
    _sum: { amountIncVatMinor: true },
  });
  const revenueByCenter = new Map<string, bigint>();
  for (const agg of billingAggs) {
    if (agg._sum.amountIncVatMinor !== null) {
      revenueByCenter.set(agg.costCenterId, agg._sum.amountIncVatMinor);
    }
  }

  // 3. Most recent session per org — use session_ledger for speed
  const lastSessionByOrg = await db.sessionLedger.groupBy({
    by: ["orgId"],
    where: { orgId: { in: orgIds } },
    _max: { startedAt: true },
  });
  const lastSessionDateByOrg = new Map<string, Date>();
  for (const r of lastSessionByOrg) {
    if (r._max.startedAt) lastSessionDateByOrg.set(r.orgId, r._max.startedAt);
  }

  // 4. Active membership count per org
  const membershipCounts = await db.membership.groupBy({
    by: ["orgId"],
    where: {
      orgId: { in: orgIds },
      status: "active",
    },
    _count: { userId: true },
  });
  const membershipCountByOrg = new Map<string, number>();
  for (const r of membershipCounts) {
    membershipCountByOrg.set(r.orgId, r._count.userId);
  }

  // 5. TariffDefinition count per org (as a proxy for "anchored tariffs
  //    for this center's org" — direct per-center tariff anchoring is via
  //    ContractFactorAssignment, which requires joining contracts + scopes
  //    and is deferred to a future milestone)
  const tariffCounts = await db.tariffDefinition.groupBy({
    by: ["orgId"],
    where: { orgId: { in: orgIds }, status: "active" },
    _count: { id: true },
  });
  const tariffCountByOrg = new Map<string, number>();
  for (const r of tariffCounts) {
    tariffCountByOrg.set(r.orgId, r._count.id);
  }

  return costCenters.map((cc) => ({
    id: cc.id,
    orgId: cc.orgId,
    orgDisplayName: cc.organization.displayName,
    code: cc.code,
    displayName: cc.displayName,
    payerOrgId: cc.payerOrgId,
    payerOrgDisplayName: cc.payerOrg?.displayName ?? null,
    payerUserId: cc.payerUserId,
    payerUserDisplayName: cc.payerUser?.displayName ?? null,
    beneficiaryOrgId: cc.beneficiaryOrgId,
    beneficiaryOrgDisplayName: cc.beneficiaryOrg?.displayName ?? null,
    status: cc.status,
    activeMembershipCount: membershipCountByOrg.get(cc.orgId) ?? 0,
    lastSessionDate:
      lastSessionDateByOrg.get(cc.orgId)?.toISOString() ?? null,
    currentPeriodCostIskMinor: (revenueByCenter.get(cc.id) ?? 0n).toString(),
    anchoredTariffCount: tariffCountByOrg.get(cc.orgId) ?? 0,
    createdAt: cc.createdAt.toISOString(),
  }));
}
