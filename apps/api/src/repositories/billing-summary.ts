// Repository for the billing overview dashboard (Track D, Sprint 9).
//
// Pulls from reports.session_ledger (pre-computed) and
// billing.tariff_definitions / billing.cost_centers for health tiles.
// All functions take orgId = undefined for platform-admin (no filter)
// or a specific orgId for tenant-scoped reads.

import type { PrismaClient } from "../generated/prisma/client";

// ── Current / previous period totals ─────────────────────────────────────────

export interface PeriodTotals {
  sessionCount: number;
  totalEnergyKwh: string;   // Decimal serialised as string
  totalCostIskMinor: string; // BigInt serialised as string
}

/** Returns [start, end) Date bounds for a calendar month (UTC). */
function monthBounds(year: number, month: number): [Date, Date] {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return [start, end];
}

export async function getPeriodTotals(
  db: PrismaClient,
  year: number,
  month: number,
): Promise<PeriodTotals> {
  const [start, end] = monthBounds(year, month);
  const agg = await db.sessionLedger.aggregate({
    where: {
      startedAt: { gte: start, lt: end },
    },
    _count: { sessionId: true },
    _sum: { energyKwh: true, costIskMinor: true },
  });
  return {
    sessionCount: agg._count.sessionId ?? 0,
    totalEnergyKwh: (agg._sum.energyKwh ?? 0).toString(),
    totalCostIskMinor: (agg._sum.costIskMinor ?? 0n).toString(),
  };
}

// ── Tariff coverage ───────────────────────────────────────────────────────────

export interface TariffCoverage {
  totalCount: number;
  anchoredCount: number;
  orphanCount: number;
}

export async function getTariffCoverage(db: PrismaClient): Promise<TariffCoverage> {
  const tariffs = await db.tariffDefinition.findMany({
    select: { id: true },
  });
  const tariffIds = tariffs.map((t) => t.id);
  if (tariffIds.length === 0) {
    return { totalCount: 0, anchoredCount: 0, orphanCount: 0 };
  }

  const [siteCounts, installCounts, stationCounts] = await Promise.all([
    db.site.groupBy({
      by: ["dsoTariffId"],
      where: { dsoTariffId: { in: tariffIds } },
      _count: { _all: true },
    }),
    db.installation.groupBy({
      by: ["retailerTariffId"],
      where: { retailerTariffId: { in: tariffIds } },
      _count: { _all: true },
    }),
    db.chargingStation.groupBy({
      by: ["chrgrfTariffId"],
      where: { chrgrfTariffId: { in: tariffIds } },
      _count: { _all: true },
    }),
  ]);

  const anchoredIds = new Set<string>();
  for (const r of siteCounts) {
    if (r.dsoTariffId) anchoredIds.add(r.dsoTariffId);
  }
  for (const r of installCounts) {
    if (r.retailerTariffId) anchoredIds.add(r.retailerTariffId);
  }
  for (const r of stationCounts) {
    if (r.chrgrfTariffId) anchoredIds.add(r.chrgrfTariffId);
  }

  const anchoredCount = anchoredIds.size;
  return {
    totalCount: tariffIds.length,
    anchoredCount,
    orphanCount: tariffIds.length - anchoredCount,
  };
}

// ── Cost-computation health ───────────────────────────────────────────────────

export interface CostHealthMetric {
  /** Total completed sessions in last 30d in session_ledger. */
  totalSessions: number;
  /** Sessions where costIskMinor IS NOT NULL. */
  costedSessions: number;
  /** Percentage (0–100), or null when no sessions. */
  pctCosted: number | null;
}

export async function getCostHealthMetric(db: PrismaClient): Promise<CostHealthMetric> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalAgg, costedAgg] = await Promise.all([
    db.sessionLedger.aggregate({
      where: { startedAt: { gte: since } },
      _count: { sessionId: true },
    }),
    db.sessionLedger.aggregate({
      where: {
        startedAt: { gte: since },
        costIskMinor: { not: null },
      },
      _count: { sessionId: true },
    }),
  ]);

  const total = totalAgg._count.sessionId ?? 0;
  const costed = costedAgg._count.sessionId ?? 0;
  return {
    totalSessions: total,
    costedSessions: costed,
    pctCosted: total === 0 ? null : Math.round((costed / total) * 100),
  };
}

// ── Recent ledger entries ─────────────────────────────────────────────────────

export interface RecentLedgerRow {
  sessionId: string;
  orgDisplayName: string | null;
  siteDisplayName: string | null;
  startedAt: string;   // ISO
  energyKwh: string;
  costIskMinor: string | null;
}

export async function getRecentLedgerEntries(
  db: PrismaClient,
  limit = 10,
): Promise<RecentLedgerRow[]> {
  const rows = await db.sessionLedger.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      sessionId: true,
      orgId: true,
      siteId: true,
      startedAt: true,
      energyKwh: true,
      costIskMinor: true,
    },
  });

  if (rows.length === 0) return [];

  const orgIds = Array.from(new Set(rows.map((r) => r.orgId)));
  const siteIds = Array.from(
    new Set(rows.map((r) => r.siteId).filter((v): v is string => Boolean(v))),
  );

  const [orgs, sites] = await Promise.all([
    orgIds.length > 0
      ? db.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
    siteIds.length > 0
      ? db.site.findMany({
          where: { id: { in: siteIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
  ]);

  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName]));
  const siteNameById = new Map(sites.map((s) => [s.id, s.displayName]));

  return rows.map((r) => ({
    sessionId: r.sessionId,
    orgDisplayName: orgNameById.get(r.orgId) ?? null,
    siteDisplayName: r.siteId ? siteNameById.get(r.siteId) ?? null : null,
    startedAt: r.startedAt.toISOString(),
    energyKwh: r.energyKwh.toString(),
    costIskMinor: r.costIskMinor !== null ? r.costIskMinor.toString() : null,
  }));
}

// ── Projected close: top 10 orgs by current-month revenue ────────────────────

export interface ProjectedOrgRevenue {
  orgId: string;
  orgDisplayName: string;
  sessionCount: number;
  totalCostIskMinor: string; // BigInt serialised
}

export async function getProjectedOrgRevenue(
  db: PrismaClient,
  year: number,
  month: number,
  topN = 10,
): Promise<ProjectedOrgRevenue[]> {
  const [start, end] = monthBounds(year, month);

  // Aggregate by orgId over current period
  const rows = await db.sessionLedger.groupBy({
    by: ["orgId"],
    where: {
      startedAt: { gte: start, lt: end },
      costIskMinor: { not: null },
    },
    _count: { sessionId: true },
    _sum: { costIskMinor: true },
    orderBy: { _sum: { costIskMinor: "desc" } },
    take: topN,
  });

  if (rows.length === 0) return [];

  const orgIds = rows.map((r) => r.orgId);
  const orgs = await db.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, displayName: true },
  });
  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName]));

  return rows.map((r) => ({
    orgId: r.orgId,
    orgDisplayName: orgNameById.get(r.orgId) ?? r.orgId,
    sessionCount: r._count.sessionId ?? 0,
    totalCostIskMinor: (r._sum.costIskMinor ?? 0n).toString(),
  }));
}
