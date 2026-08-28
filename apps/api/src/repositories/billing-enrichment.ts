// Sprint 9 / ENRICH-4 — Enrichment-status repository.
//
// Pulls from reports.session_ledger (verifiedSource, enrichmentStatus)
// joined to charging.charge_sessions (ocmfBlobRef, ocppEnergyKwh,
// cdrEnergyKwh) via a batch lookup. SessionLedger has no Prisma FK to
// ChargeSession (sessionId is a plain UUID column), so we use the same
// two-pass pattern as session-ledger.ts.
//
// ── TENANCY: CENSUS ROW 104, CLOSED ─────────────────────────────────────
//
// `listEnrichmentSessions` read `session_ledger` with NO tenant term, in
// BOTH halves: the summary `groupBy` and the session list. It is mounted at
// `GET /api/admin/billing/enrichment` behind `billing.read` — which
// `requireAdmin` grants to any org member, not only to platform staff — so
// any admin of any tenant could read every tenant's sessions, with charger
// and site display names attached.
//
// **The summary was the worse half.** A list of 100 rows is visibly a list;
// four counts across "the entire window, no row cap" read as *your* numbers,
// and an operator has no reason to doubt them. That is why `tenantWhere` is
// shared between the two rather than applied to each: a tile confined
// differently from the list beneath it is worse than either being wrong
// alone, because the total is the number an operator believes. Same argument
// as fixes 1 and 2 in the burn-down note, and the same shape.
//
// `restrictToOrgIds` is a REQUIRED parameter. `null` means platform-wide and
// is spelled out at the call site; an empty array means "may see nothing" and
// must not fall into `{}`, which means everything. **The repository enforces**
// — a route can omit a call, a required parameter cannot be omitted without
// the build failing, and the route-side rule was written down once already
// and still not followed for four months.
//
// Rule 7 — no Prisma types leak past this module. Caller receives
// EnrichmentRow[].

import type { PrismaClient } from "../generated/prisma/client";
import type { OrgScope } from "../lib/auth/org-scope";

/** `null` is platform-wide. An empty array is "may see nothing". */
export type EnrichmentTenantScope = string[] | null;


/**
 * Map an `OrgScope` to this repository's tenant scope.
 *
 * It lives HERE rather than in the route, beside the type it produces. A route
 * can omit a call; a required parameter cannot be omitted without the build
 * failing, and the conversion into that parameter belongs on the same side as
 * the enforcement. It also keeps the repository's tests from importing a
 * route, which is an edge the dependency graph is right to refuse.
 *
 * `{ all: true }` — bootstrap sessions and `platform.tenant.read` — maps to
 * `null`, which is platform-wide and unchanged. `{ all: false, orgIds: [] }`,
 * which `resolveOrgScope` returns for an unknown user, maps to `[]` and denies
 * everything. Those two must not be confused, and the test says so.
 */
export function scopeFrom(scope: OrgScope): EnrichmentTenantScope {
  return scope.all ? null : scope.orgIds;
}
/** The session_ledger predicate for a tenant scope. Shared by the summary and
 *  the list so the tile cannot be confined differently from the rows under it. */
function tenantWhere(restrictToOrgIds: EnrichmentTenantScope): Record<string, unknown> {
  if (restrictToOrgIds === null) return {};
  return { orgId: { in: restrictToOrgIds } };
}

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
  /** REQUIRED. `null` is platform-wide; an empty array is "may see nothing". */
  restrictToOrgIds: EnrichmentTenantScope,
  filters: EnrichmentFilters = {},
): Promise<{ summary: EnrichmentSummary; sessions: EnrichmentRow[] }> {
  const days = Math.max(1, filters.days ?? 30);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Summary: count each status bucket across the entire window (no row
  // cap, no status filter — this is the aggregate, not the list).
  const summaryGroups = await db.sessionLedger.groupBy({
    by: ["enrichmentStatus"],
    where: { startedAt: { gte: since }, ...tenantWhere(restrictToOrgIds) },
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
      ...tenantWhere(restrictToOrgIds),
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
