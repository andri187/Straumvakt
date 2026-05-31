// Read-only repository for the billing.cost_factors catalogue surface.
// Sprint 9 — Track B (cost-factors + electricity rates pages).
//
// billing.CostFactor rows are platform-defined; they are not tenant-scoped
// themselves (no org_id column). The anchorTier enum tells you at which
// level in the hierarchy this factor is anchored:
//
//   org, property, site, installation, circuit, charger, driver_contract
//
// Usage count (tariffCount) is the number of billing.tariff_definitions
// rows whose cost_factor_id references this factor. A count of zero means
// the factor is orphaned — seeded but not yet wired to any tariff.

import type { PrismaClient } from "../generated/prisma/client";
import type { CostFactorAnchor, CostFactorStatus } from "../generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// UI shape
// ─────────────────────────────────────────────────────────────────────────────

export interface CostFactorRow {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: CostFactorAnchor;
  defaultVatRatePct: string;      // Decimal serialised as string
  defaultCurrency: string;
  status: CostFactorStatus;
  tariffCount: number;            // TariffDefinitions referencing this factor
  isOrphan: boolean;
}

export interface CostFactorsByAnchor {
  anchor: CostFactorAnchor;
  factors: CostFactorRow[];
}

export interface CostFactorCatalogueSummary {
  totalFactors: number;
  orphanCount: number;
  byAnchor: CostFactorsByAnchor[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all billing.cost_factors rows, grouped by anchorTier, with
 * per-factor TariffDefinition usage counts.
 *
 * Note: CostFactor is a platform-level catalogue, not tenant-scoped.
 * The admin gate on the route is sufficient access control.
 */
export async function listCostFactors(
  db: PrismaClient,
): Promise<CostFactorCatalogueSummary> {
  const factors = await db.costFactor.findMany({
    orderBy: [{ anchorTier: "asc" }, { code: "asc" }],
  });

  if (factors.length === 0) {
    return { totalFactors: 0, orphanCount: 0, byAnchor: [] };
  }

  // Batch-count tariff definitions per factor.
  const factorIds = factors.map((f) => f.id);
  const tariffGroups = await db.tariffDefinition.groupBy({
    by: ["costFactorId"],
    where: { costFactorId: { in: factorIds } },
    _count: { _all: true },
  });

  const tariffCountById = new Map<string, number>();
  for (const g of tariffGroups) {
    tariffCountById.set(g.costFactorId, g._count._all);
  }

  // Build UI rows.
  const rows: CostFactorRow[] = factors.map((f) => {
    const tariffCount = tariffCountById.get(f.id) ?? 0;
    return {
      id: f.id,
      code: f.code,
      displayName: f.displayName,
      description: f.description ?? null,
      anchorTier: f.anchorTier,
      defaultVatRatePct: f.defaultVatRatePct.toString(),
      defaultCurrency: f.defaultCurrency,
      status: f.status,
      tariffCount,
      isOrphan: tariffCount === 0,
    };
  });

  // Group by anchor tier preserving sort order from the DB.
  const anchorOrder: CostFactorAnchor[] = [];
  const byAnchorMap = new Map<CostFactorAnchor, CostFactorRow[]>();
  for (const r of rows) {
    if (!byAnchorMap.has(r.anchorTier)) {
      anchorOrder.push(r.anchorTier);
      byAnchorMap.set(r.anchorTier, []);
    }
    byAnchorMap.get(r.anchorTier)!.push(r);
  }

  const byAnchor: CostFactorsByAnchor[] = anchorOrder.map((anchor) => ({
    anchor,
    factors: byAnchorMap.get(anchor) ?? [],
  }));

  const orphanCount = rows.filter((r) => r.isOrphan).length;

  return {
    totalFactors: rows.length,
    orphanCount,
    byAnchor,
  };
}
