// Read-only repository for electricity (retailer) cost factors with
// per-org TariffDefinition usage. Sprint 9 — Track B.
//
// "Electricity" in this context = billing.cost_factors with anchorTier
// 'installation' — these are the retailer-supply factors (REPF and
// similar codes) that attach at the Installation level and represent
// the per-kWh commodity price paid to the electricity retailer.
//
// For each such factor we surface:
//   • which TariffDefinitions reference it
//   • which organisations own those tariffs
//
// This lets the operator cross-reference the DB operational config
// against the reference catalogue (docs/reference/iceland-energy-parties.json).

import { asc, eq, inArray } from "drizzle-orm";
import { billingCostFactors, tariffDefinitions } from "@straumvakt/shared/db/commercial";
import { organizations } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";

type CostFactorStatus = (typeof billingCostFactors.status)["_"]["data"];

// ─────────────────────────────────────────────────────────────────────────────
// UI shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgUsage {
  orgId: string;
  orgDisplayName: string;
  tariffCount: number;
}

export interface ElectricityCostFactorRow {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  defaultVatRatePct: string;      // Decimal serialised as string
  defaultCurrency: string;
  status: CostFactorStatus;
  tariffCount: number;
  orgsUsing: OrgUsage[];
  isOrphan: boolean;
}

export interface ElectricityCatalogueSummary {
  totalFactors: number;
  orphanCount: number;
  orgsCovered: number;
  factors: ElectricityCostFactorRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all billing.cost_factors with anchorTier='installation' —
 * the retailer/electricity supply factors. Includes per-org TariffDefinition
 * usage so the operator can see which organisations have a configured
 * electricity rate versus which have none.
 *
 * anchorTier='installation' is the canonical tier for retailer factors
 * (REPF, etc.) — they attach to Installation.retailerTariffId.
 */
export async function listElectricityCostFactors(
  db: Db,
): Promise<ElectricityCatalogueSummary> {
  // Installation-tier cost factors = retailer / electricity supply.
  const factors = await db
    .select()
    .from(billingCostFactors)
    .where(eq(billingCostFactors.anchorTier, "installation"))
    .orderBy(asc(billingCostFactors.code));

  if (factors.length === 0) {
    return { totalFactors: 0, orphanCount: 0, orgsCovered: 0, factors: [] };
  }

  const factorIds = factors.map((f) => f.id);

  // Fetch tariff definitions referencing these factors, with org names.
  const tariffs = await db
    .select({
      costFactorId: tariffDefinitions.costFactorId,
      orgId: tariffDefinitions.orgId,
      orgDisplayName: organizations.displayName,
    })
    .from(tariffDefinitions)
    .leftJoin(organizations, eq(organizations.id, tariffDefinitions.orgId))
    .where(inArray(tariffDefinitions.costFactorId, factorIds))
    .orderBy(asc(tariffDefinitions.costFactorId), asc(tariffDefinitions.orgId));

  // Aggregate: for each (factorId, orgId), count tariffs and collect org name.
  // Structure: Map<factorId, Map<orgId, { orgDisplayName, count }>>
  const usageByFactor = new Map<
    string,
    Map<string, { orgDisplayName: string; count: number }>
  >();
  for (const t of tariffs) {
    if (!usageByFactor.has(t.costFactorId)) {
      usageByFactor.set(t.costFactorId, new Map());
    }
    const orgMap = usageByFactor.get(t.costFactorId)!;
    if (!orgMap.has(t.orgId)) {
      orgMap.set(t.orgId, {
        orgDisplayName: t.orgDisplayName ?? "",
        count: 0,
      });
    }
    orgMap.get(t.orgId)!.count++;
  }

  // Build UI rows.
  const orgsCoveredSet = new Set<string>();
  const rows: ElectricityCostFactorRow[] = factors.map((f) => {
    const orgMap = usageByFactor.get(f.id);
    const orgsUsing: OrgUsage[] = orgMap
      ? Array.from(orgMap.entries())
          .map(([orgId, { orgDisplayName, count }]) => ({
            orgId,
            orgDisplayName,
            tariffCount: count,
          }))
          .sort((a, b) => a.orgDisplayName.localeCompare(b.orgDisplayName, "is"))
      : [];

    const tariffCount = orgsUsing.reduce((s, o) => s + o.tariffCount, 0);
    for (const o of orgsUsing) orgsCoveredSet.add(o.orgId);

    return {
      id: f.id,
      code: f.code,
      displayName: f.displayName,
      description: f.description ?? null,
      defaultVatRatePct: f.defaultVatRatePct.toString(),
      defaultCurrency: f.defaultCurrency,
      status: f.status,
      tariffCount,
      orgsUsing,
      isOrphan: tariffCount === 0,
    };
  });

  const orphanCount = rows.filter((r) => r.isOrphan).length;

  return {
    totalFactors: rows.length,
    orphanCount,
    orgsCovered: orgsCoveredSet.size,
    factors: rows,
  };
}
