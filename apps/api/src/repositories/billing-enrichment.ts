// Sprint 9 / ENRICH-4 — Enrichment-status repository.
//
// Pulls from reports.session_ledger (verifiedSource, enrichmentStatus)
// joined to charging.charge_sessions (ocmfBlobRef, ocppEnergyKwh,
// cdrEnergyKwh) via a batch lookup. SessionLedger has no Prisma FK to
// ChargeSession (sessionId is a plain UUID column), so we use the same
// two-pass pattern as session-ledger.ts.
//
// The ENRICH-1 columns (verifiedSource, enrichmentStatus on SessionLedger;
// ocmfBlobRef, ocppEnergyKwh, cdrEnergyKwh on ChargeSession) are declared
// in the Prisma schema but their migration may not have run yet — transient
// tsc errors will resolve when ENRICH-1's migration lands.
//
// Rule 7 — no Prisma types leak past this module. Caller receives
// EnrichmentRow[].

import type { PrismaClient } from "../generated/prisma/client";

// ── Public types ─────────────────────────────────────────────────────

export type EnrichmentStatusFilter =
  | "pending"
  | "complete"
  | "mismatch"
  | "stale"
  | "all";

export interface EnrichmentFilters {
  status?: EnrichmentStatusFilter;
  /** Window in days back from now (default 30). */
  days?: number;
  /** Row cap (default 100, max 500). */
  limit?: number;
}

export interface EnrichmentSummary {
  pending: number;
  complete: number;
  mismatch: number;
  stale: number;
}

export interface EnrichmentRow {
  sessionId: string;
  startedAt: Date;
  stoppedAt: Date | null;
  chargerDisplayName: string | null;
  siteDisplayName: string | null;
  /** Canonical energy from session_ledger (Decimal serialised). */
  energyKwh: string;
  costIskMinor: bigint | null;
  /** "ocpp" | "cdr" | "amqp" | "reconciled" | null */
  verifiedSource: string | null;
  /** "pending" | "complete" | "mismatch" | "stale" | null */
  enrichmentStatus: string | null;
  /** From ChargeSession.ocppEnergyKwh (Decimal serialised or null). */
  ocppEnergyKwh: string | null;
  /** From ChargeSession.cdrEnergyKwh (Decimal serialised or null). */
  cdrEnergyKwh: string | null;
  /** |ocppEnergyKwh - cdrEnergyKwh| when both present, else null. */
  energyDeltaKwh: string | null;
  /** True if ChargeSession.ocmfBlobRef is non-null. */
  hasOcmfBlob: boolean;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// ── listEnrichmentSessions ────────────────────────────────────────────

export async function listEnrichmentSessions(
  db: PrismaClient,
  filters: EnrichmentFilters = {},
): Promise<{ summary: EnrichmentSummary; sessions: EnrichmentRow[] }> {
  const days = Math.max(1, filters.days ?? 30);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Summary: count each status bucket across the entire window (no row
  // cap, no status filter — this is the aggregate, not the list).
  const summaryGroups = await db.sessionLedger.groupBy({
    by: ["enrichmentStatus"],
    where: { startedAt: { gte: since } },
    _count: { sessionId: true },
  });

  const summary: EnrichmentSummary = { pending: 0, complete: 0, mismatch: 0, stale: 0 };
  for (const g of summaryGroups) {
    const s = g.enrichmentStatus;
    const n = g._count.sessionId;
    if (s === "pending") summary.pending = n;
    else if (s === "complete") summary.complete = n;
    else if (s === "mismatch") summary.mismatch = n;
    else if (s === "stale") summary.stale = n;
  }

  // Session list: apply optional status filter on top of the time window.
  const ledgerRows = await db.sessionLedger.findMany({
    where: {
      startedAt: { gte: since },
      ...(filters.status && filters.status !== "all"
        ? { enrichmentStatus: filters.status }
        : {}),
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      sessionId: true,
      siteId: true,
      chargingStationId: true,
      startedAt: true,
      stoppedAt: true,
      energyKwh: true,
      costIskMinor: true,
      verifiedSource: true,
      enrichmentStatus: true,
    },
  });

  if (ledgerRows.length === 0) {
    return { summary, sessions: [] };
  }

  const sessionIds = ledgerRows.map((r) => r.sessionId);
  const stationIds = Array.from(
    new Set(
      ledgerRows
        .map((r) => r.chargingStationId)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const siteIds = Array.from(
    new Set(
      ledgerRows.map((r) => r.siteId).filter((v): v is string => Boolean(v)),
    ),
  );

  // Batch fetch supporting data in parallel.
  const [chargeSessions, siteAssets, sites] = await Promise.all([
    db.chargeSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        ocmfBlobRef: true,
        ocppEnergyKwh: true,
        cdrEnergyKwh: true,
      },
    }),
    stationIds.length > 0
      ? db.siteAsset.findMany({
          where: { id: { in: stationIds } },
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

  const chargeSessionById = new Map(chargeSessions.map((s) => [s.id, s]));
  const chargerNameByStation = new Map(siteAssets.map((s) => [s.id, s.displayName]));
  const siteNameById = new Map(sites.map((s) => [s.id, s.displayName]));

  const sessions: EnrichmentRow[] = ledgerRows.map((r) => {
    const cs = chargeSessionById.get(r.sessionId);
    const ocppKwh = cs?.ocppEnergyKwh != null ? cs.ocppEnergyKwh.toString() : null;
    const cdrKwh = cs?.cdrEnergyKwh != null ? cs.cdrEnergyKwh.toString() : null;

    let energyDeltaKwh: string | null = null;
    if (ocppKwh !== null && cdrKwh !== null) {
      try {
        const delta = Math.abs(parseFloat(ocppKwh) - parseFloat(cdrKwh));
        energyDeltaKwh = delta.toFixed(4);
      } catch {
        energyDeltaKwh = null;
      }
    }

    return {
      sessionId: r.sessionId,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      chargerDisplayName: r.chargingStationId
        ? (chargerNameByStation.get(r.chargingStationId) ?? null)
        : null,
      siteDisplayName: r.siteId ? (siteNameById.get(r.siteId) ?? null) : null,
      energyKwh: r.energyKwh.toString(),
      costIskMinor: r.costIskMinor,
      verifiedSource: r.verifiedSource,
      enrichmentStatus: r.enrichmentStatus,
      ocppEnergyKwh: ocppKwh,
      cdrEnergyKwh: cdrKwh,
      energyDeltaKwh,
      hasOcmfBlob: Boolean(cs?.ocmfBlobRef),
    };
  });

  return { summary, sessions };
}
