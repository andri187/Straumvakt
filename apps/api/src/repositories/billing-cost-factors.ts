// Read-write repository for the billing.cost_factors catalogue surface.
// Sprint 9 — Track B (cost-factors + electricity rates pages);
//            Track A (CRUD mutations).
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
//
// Mutation invariants (enforced here and in cost-factor-zod.ts):
//   • code and anchorTier are immutable on an existing row.
//   • Deactivating a factor that is referenced by ≥1 active TariffDefinition
//     is allowed (warn in the UI) but not blocked.

import type { PrismaClient } from "../generated/prisma/client";
import type { CostFactorAnchor, CostFactorStatus } from "../generated/prisma/enums";
import type { CreateCostFactorInput, UpdateCostFactorInput } from "../lib/billing/cost-factor-zod";

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

// ─────────────────────────────────────────────────────────────────────────────
// Single-factor read (used after mutations to return the updated row)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCostFactor(
  db: PrismaClient,
  id: string,
): Promise<CostFactorRow | null> {
  const f = await db.costFactor.findUnique({ where: { id } });
  if (!f) return null;

  const tariffGroup = await db.tariffDefinition.groupBy({
    by: ["costFactorId"],
    where: { costFactorId: id },
    _count: { _all: true },
  });
  const tariffCount = tariffGroup[0]?._count._all ?? 0;

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
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export async function createCostFactor(
  db: PrismaClient,
  input: CreateCostFactorInput,
): Promise<CostFactorRow> {
  const f = await db.costFactor.create({
    data: {
      code: input.code,
      displayName: input.displayName,
      description: input.description ?? null,
      anchorTier: input.anchorTier as CostFactorAnchor,
      defaultVatRatePct: input.defaultVatRatePct,
      defaultCurrency: input.defaultCurrency,
      status: (input.status as CostFactorStatus) ?? "active",
    },
  });

  return {
    id: f.id,
    code: f.code,
    displayName: f.displayName,
    description: f.description ?? null,
    anchorTier: f.anchorTier,
    defaultVatRatePct: f.defaultVatRatePct.toString(),
    defaultCurrency: f.defaultCurrency,
    status: f.status,
    tariffCount: 0,
    isOrphan: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update (displayName, description, defaults — NOT code, NOT anchorTier)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateCostFactor(
  db: PrismaClient,
  id: string,
  input: UpdateCostFactorInput,
): Promise<CostFactorRow | null> {
  const existing = await db.costFactor.findUnique({ where: { id } });
  if (!existing) return null;

  const updated = await db.costFactor.update({
    where: { id },
    data: {
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.defaultVatRatePct !== undefined && {
        defaultVatRatePct: input.defaultVatRatePct,
      }),
      ...(input.defaultCurrency !== undefined && {
        defaultCurrency: input.defaultCurrency,
      }),
    },
  });

  const tariffGroup = await db.tariffDefinition.groupBy({
    by: ["costFactorId"],
    where: { costFactorId: id },
    _count: { _all: true },
  });
  const tariffCount = tariffGroup[0]?._count._all ?? 0;

  return {
    id: updated.id,
    code: updated.code,
    displayName: updated.displayName,
    description: updated.description ?? null,
    anchorTier: updated.anchorTier,
    defaultVatRatePct: updated.defaultVatRatePct.toString(),
    defaultCurrency: updated.defaultCurrency,
    status: updated.status,
    tariffCount,
    isOrphan: tariffCount === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deactivate / Reactivate
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusChangeResult {
  factor: CostFactorRow;
  /** Number of active TariffDefinitions referencing this factor (0 = safe). */
  activeTariffCount: number;
}

export async function deactivateCostFactor(
  db: PrismaClient,
  id: string,
): Promise<StatusChangeResult | null> {
  const existing = await db.costFactor.findUnique({ where: { id } });
  if (!existing) return null;

  // Count active TariffDefinitions referencing this factor — warn in UI.
  const activeTariffCount = await db.tariffDefinition.count({
    where: { costFactorId: id, status: "active" },
  });

  const updated = await db.costFactor.update({
    where: { id },
    data: { status: "archived" },
  });

  const tariffGroup = await db.tariffDefinition.groupBy({
    by: ["costFactorId"],
    where: { costFactorId: id },
    _count: { _all: true },
  });
  const tariffCount = tariffGroup[0]?._count._all ?? 0;

  return {
    factor: {
      id: updated.id,
      code: updated.code,
      displayName: updated.displayName,
      description: updated.description ?? null,
      anchorTier: updated.anchorTier,
      defaultVatRatePct: updated.defaultVatRatePct.toString(),
      defaultCurrency: updated.defaultCurrency,
      status: updated.status,
      tariffCount,
      isOrphan: tariffCount === 0,
    },
    activeTariffCount,
  };
}

export async function reactivateCostFactor(
  db: PrismaClient,
  id: string,
): Promise<CostFactorRow | null> {
  const existing = await db.costFactor.findUnique({ where: { id } });
  if (!existing) return null;

  const updated = await db.costFactor.update({
    where: { id },
    data: { status: "active" },
  });

  const tariffGroup = await db.tariffDefinition.groupBy({
    by: ["costFactorId"],
    where: { costFactorId: id },
    _count: { _all: true },
  });
  const tariffCount = tariffGroup[0]?._count._all ?? 0;

  return {
    id: updated.id,
    code: updated.code,
    displayName: updated.displayName,
    description: updated.description ?? null,
    anchorTier: updated.anchorTier,
    defaultVatRatePct: updated.defaultVatRatePct.toString(),
    defaultCurrency: updated.defaultCurrency,
    status: updated.status,
    tariffCount,
    isOrphan: tariffCount === 0,
  };
}
