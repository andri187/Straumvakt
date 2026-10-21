// Read-side repository for reports.session_ledger (Sprint 8.4).
//
// One repository function with a tagged scope union enforces all
// access-control filters server-side. Six UI surfaces consume this
// (Operations sidebar, per-org/installation/charger/driver-group/
// driver tabs); each passes a scope object — never a free-form
// WHERE — so a permission bug at one surface can't accidentally
// leak rows from another tenant.
//
// Sprint 8.4 ships the five direct-column scopes (admin, org, site,
// charger, driver). Per-installation + per-driver-group scopes
// require Prisma relations on session_ledger that don't exist yet
// (the schema declares the IDs as plain UUID columns); a follow-up
// milestone adds those relations and the corresponding scopes.
//
// ── TENANCY IS ENFORCED HERE (corrected 2026-08-18) ──────────────────
//
// This header used to read: "Scope authorisation is the CALLER's job — the
// route handler validates that the requesting session is allowed to ask for
// the scope it's asking for. This repo trusts the scope it receives."
//
// The route did not do that. routes/admin/billing.ts:49-56 deferred it in
// turn to "once Sprint 8 Track C lands per-resource checks", and its
// `scopeFromQuery` returned `{ kind: "admin" }` — no tenant filter — whenever
// no query parameter was supplied. Each file named the other as the
// enforcement point and neither enforced, so an org member holding
// `billing.read` could read every tenant's ledger by omitting a parameter.
//
// So the sentence is now true in the other direction: **this repository
// enforces.** Every entry point takes a `LedgerAccess`, whose
// `restrictToOrgIds` is REQUIRED — `null` means platform-wide and has to be
// written deliberately. A caller who does not think about tenancy does not
// compile. lib/billing/ledger-scope.ts decides what a given session gets.

import type { PrismaClient } from "../generated/prisma/client";

export type LedgerScope =
  /** Straumvakt admin (super_user / platform_admin) — no filter. */
  | { kind: "admin" }
  /** Org agent with billing.read scoped to their org. */
  | { kind: "org"; orgId: string }
  /** Per-site view (org admin or higher). */
  | { kind: "site"; siteId: string }
  /** Per-charger view. */
  | { kind: "charger"; chargingStationId: string }
  /** Per-driver view. Driver self-view ALSO uses this — the route
   *  passes the session's own userId. */
  | { kind: "driver"; driverUserId: string };

/**
 * A scope plus the tenant confinement that applies to it.
 *
 * `restrictToOrgIds` is not optional and has no default. `null` is the
 * explicit "platform-wide, no confinement" choice; an array confines every
 * row to those orgs REGARDLESS of which scope was requested, so a per-charger
 * view asked for by an org member returns that charger's rows intersected
 * with the member's orgs rather than being refused outright.
 */
export interface LedgerAccess {
  scope: LedgerScope;
  restrictToOrgIds: string[] | null;
}

export interface LedgerFilters {
  /** Inclusive lower bound on startedAt. */
  startedAfter?: Date;
  /** Exclusive upper bound on startedAt. */
  startedBefore?: Date;
  /** Pagination: max rows. Default 100, max 500. */
  limit?: number;
  /** Pagination: offset. Default 0. */
  offset?: number;
}

export interface LedgerRow {
  sessionId: string;
  orgId: string;
  /** Sprint 8.14.4 — display name for the operator console. */
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  chargingStationId: string | null;
  /** Display name of the charger (e.g. "Festi 8", "K1"). Falls back
   *  to the chargingStationId when the asset has no human label. */
  chargerDisplayName: string | null;
  driverUserId: string | null;
  driverIdTag: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
  durationSec: number | null;
  energyKwh: string; // Decimal serialised — Prisma returns string for Decimal
  costIskMinor: bigint | null;
  tariffDefinitionId: string | null;
  /** From charging.sessions.stop_reason — OCPP-style string. */
  stopReason: string | null;
  computedAt: Date;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * The one WHERE builder, shared by the list and the summary.
 *
 * It was two copies of the same switch. Two copies of a tenant filter is one
 * copy away from a surface that reads a total across every tenant while the
 * list beside it reads one org — and the total is the number an operator
 * believes.
 */
function buildLedgerWhere(
  access: LedgerAccess,
  filters: LedgerFilters,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  switch (access.scope.kind) {
    case "admin":
      // No scope-derived filter. The tenant confinement below still applies.
      break;
    case "org":
      where.orgId = access.scope.orgId;
      break;
    case "site":
      where.siteId = access.scope.siteId;
      break;
    case "charger":
      where.chargingStationId = access.scope.chargingStationId;
      break;
    case "driver":
      where.driverUserId = access.scope.driverUserId;
      break;
  }

  if (access.restrictToOrgIds !== null) {
    const allowed = access.restrictToOrgIds;
    const named = typeof where.orgId === "string" ? where.orgId : null;
    if (allowed.length === 0) {
      // Fail closed. An empty allow-list means "may see nothing", which must
      // not degrade into "no filter" the way an empty object would.
      where.orgId = { in: [] };
    } else if (named !== null) {
      // A named org AND a confinement: the intersection, not the union.
      where.orgId = allowed.includes(named) ? named : { in: [] };
    } else {
      where.orgId = { in: allowed };
    }
  }

  if (filters.startedAfter || filters.startedBefore) {
    where.startedAt = {
      ...(filters.startedAfter ? { gte: filters.startedAfter } : {}),
      ...(filters.startedBefore ? { lt: filters.startedBefore } : {}),
    };
  }
  return where;
}

export async function listSessionLedger(
  db: PrismaClient,
  access: LedgerAccess,
  filters: LedgerFilters = {},
): Promise<LedgerRow[]> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  const offset = Math.max(0, filters.offset ?? 0);

  const where = buildLedgerWhere(access, filters);

  const rows = await db.sessionLedger.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    skip: offset,
    select: {
      sessionId: true,
      orgId: true,
      siteId: true,
      chargingStationId: true,
      driverUserId: true,
      driverIdTag: true,
      startedAt: true,
      stoppedAt: true,
      durationSec: true,
      energyKwh: true,
      costIskMinor: true,
      tariffDefinitionId: true,
      computedAt: true,
    },
  });

  // Sprint 8.14.4 — enrich rows with display names + stop reason
  // via batch lookups. session_ledger doesn't carry these directly
  // and there's no Prisma relation back to ChargeSession (sessionId
  // is a plain UUID column, not a declared FK). So we collect the
  // ids we need across all rows and run one targeted findMany per
  // entity. At pilot scale (≤500 rows per page) this is cheaper than
  // adding the FK + migration.
  const sessionIds = rows.map((r) => r.sessionId);
  const stationIds = Array.from(
    new Set(rows.map((r) => r.chargingStationId).filter((v): v is string => Boolean(v))),
  );
  const siteIds = Array.from(
    new Set(rows.map((r) => r.siteId).filter((v): v is string => Boolean(v))),
  );
  const orgIds = Array.from(new Set(rows.map((r) => r.orgId)));

  const [sessions, siteAssets, sites, orgs] = await Promise.all([
    sessionIds.length > 0
      ? db.chargeSession.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, stopReason: true },
        })
      : Promise.resolve([] as Array<{ id: string; stopReason: string | null }>),
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
    orgIds.length > 0
      ? db.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([] as Array<{ id: string; displayName: string }>),
  ]);
  const stopReasonBySession = new Map(sessions.map((s) => [s.id, s.stopReason]));
  const chargerNameByStation = new Map(siteAssets.map((s) => [s.id, s.displayName]));
  const siteNameById = new Map(sites.map((s) => [s.id, s.displayName]));
  const orgNameById = new Map(orgs.map((o) => [o.id, o.displayName]));

  return rows.map((r) => ({
    sessionId: r.sessionId,
    orgId: r.orgId,
    orgDisplayName: orgNameById.get(r.orgId) ?? null,
    siteId: r.siteId,
    siteDisplayName: r.siteId ? siteNameById.get(r.siteId) ?? null : null,
    chargingStationId: r.chargingStationId,
    chargerDisplayName: r.chargingStationId
      ? chargerNameByStation.get(r.chargingStationId) ?? null
      : null,
    driverUserId: r.driverUserId,
    driverIdTag: r.driverIdTag,
    startedAt: r.startedAt,
    stoppedAt: r.stoppedAt,
    durationSec: r.durationSec,
    energyKwh: r.energyKwh.toString(),
    costIskMinor: r.costIskMinor,
    tariffDefinitionId: r.tariffDefinitionId,
    stopReason: stopReasonBySession.get(r.sessionId) ?? null,
    computedAt: r.computedAt,
  }));
}

/**
 * Aggregate totals for a scope — count of sessions, sum of energy +
 * cost. Used by the dashboard tile row above the session list.
 */
export interface LedgerTotals {
  sessionCount: number;
  totalEnergyKwh: string;     // Decimal serialised
  totalCostIskMinor: bigint;
}

export async function totalSessionLedger(
  db: PrismaClient,
  access: LedgerAccess,
  filters: LedgerFilters = {},
): Promise<LedgerTotals> {
  // Same builder as the list. The dashboard tile and the table beneath it
  // must never be able to answer for different sets of tenants.
  const where = buildLedgerWhere(access, filters);

  const agg = await db.sessionLedger.aggregate({
    where,
    _count: { sessionId: true },
    _sum: { energyKwh: true, costIskMinor: true },
  });

  return {
    sessionCount: agg._count.sessionId ?? 0,
    totalEnergyKwh: (agg._sum.energyKwh ?? 0).toString(),
    totalCostIskMinor: agg._sum.costIskMinor ?? 0n,
  };
}
