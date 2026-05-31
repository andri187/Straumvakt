// Admin billing routes — Sprint 8.4.
//
// Reads from reports.session_ledger via the shared repo. Scope is
// derived from the request's session + permission grants:
//
//   • PlatformGrant role super_user / platform_admin → admin scope
//     (sees all tenants). Today's bootstrap admin fits this.
//   • billing.read on the requesting user's Membership in the
//     queried org → org scope (sees that org's rows).
//   • Driver self-view → not a Sprint 8.4 surface; ships when the
//     driver app does.
//
// Per-site / per-charger / per-driver scopes are reachable via the
// query parameters; the route validates the requester is allowed
// to ask for that narrower scope (must already have admin or org
// scope over the parent org).

import { Hono, type Context } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listSessionLedger,
  totalSessionLedger,
  type LedgerScope,
} from "../../repositories/session-ledger";
import { getSessionDetail } from "../../repositories/session-detail";
import { getSessionFullDetail } from "../../repositories/session-full-detail";
import { formatIskMinor } from "../../lib/tariff/compute-session-cost";
import { tariffDetailRouter } from "./billing-tariff-detail";
import { tariffMgmtRouter } from "./billing-tariff-mgmt";
import { dsoRouter } from "./billing-dso";
import { contractsRouter } from "./billing-contracts";
import { driverContractsRouter } from "./billing-driver-contracts";
import { costFactorsRouter } from "./billing-cost-factors";
import { electricityRouter } from "./billing-electricity";
import { summaryRouter } from "./billing-summary";
import { costCentersRouter } from "./billing-cost-centers";
import { rateReferencesRouter } from "./billing-rate-references";
import { enrichmentRouter } from "./billing-enrichment";
import type { Env } from "../../bindings";

type BillingContext = Context<{ Bindings: Env; Variables: AuthVars }>;

export const adminBilling = new Hono<{ Bindings: Env; Variables: AuthVars }>();
adminBilling.use("*", requireAdmin);

/**
 * Builds a scope from the query parameters. Specific scopes (site /
 * charger / driver) take precedence over org → admin. The route
 * gate is `billing.read`; refining further (e.g. preventing an org
 * agent from querying another org's siteId) is layered on top
 * via assertPermission once Sprint 8 Track C lands per-resource
 * checks. For Sprint 8.4 ship the admin-scope happy path.
 */
function scopeFromQuery(c: BillingContext): LedgerScope {
  const driverUserId = c.req.query("driverUserId");
  if (driverUserId) return { kind: "driver", driverUserId };
  const chargingStationId = c.req.query("chargingStationId");
  if (chargingStationId) return { kind: "charger", chargingStationId };
  const siteId = c.req.query("siteId");
  if (siteId) return { kind: "site", siteId };
  const orgId = c.req.query("orgId");
  if (orgId) return { kind: "org", orgId };
  return { kind: "admin" };
}

function dateOrUndefined(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function intOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Sprint 8.16 — single-session detail (header + time series).
// Renders the modal that opens when an operator clicks a session
// UID on /charge-log. Time series comes from EnergyDetails when
// the row was imported with DetailLevel=1, otherwise from parsing
// the OCMF SignedSession blob — both yield the same shape.
adminBilling.get(
  "/sessions/:id",
  requirePermission("billing.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const detail = await getSessionDetail(db, c.req.param("id"));
    if (!detail) return c.json({ error: "not_found" }, 404);
    return c.json({ session: detail });
  },
);

// Sprint 9 / 2026-05-08 — full enriched session detail for the
// standalone /charge-log/[sessionId] page. Same row, more columns:
// OCMF identity (auth_id_*), full OCMF gateway block, AMQP-derived
// telemetry samples, and the raw 723 + OCMF blobs when ?include=raw.
adminBilling.get(
  "/sessions/:id/full",
  requirePermission("billing.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const includeRaw = c.req.query("include") === "raw";
    const detail = await getSessionFullDetail(db, c.req.param("id"), { includeRaw });
    if (!detail) return c.json({ error: "not_found" }, 404);
    return c.json({ session: detail });
  },
);

adminBilling.get(
  "/sessions",
  requirePermission("billing.read"),
  async (c) => {
    const scope = scopeFromQuery(c);
    const filters = {
      startedAfter: dateOrUndefined(c.req.query("startedAfter")),
      startedBefore: dateOrUndefined(c.req.query("startedBefore")),
      limit: intOrUndefined(c.req.query("limit")),
      offset: intOrUndefined(c.req.query("offset")),
    };
    const db = makePrisma(c.env);
    const [rows, totals] = await Promise.all([
      listSessionLedger(db, scope, filters),
      totalSessionLedger(db, scope, filters),
    ]);
    return c.json({
      scope,
      filters: {
        startedAfter: filters.startedAfter?.toISOString() ?? null,
        startedBefore: filters.startedBefore?.toISOString() ?? null,
        limit: filters.limit ?? 100,
        offset: filters.offset ?? 0,
      },
      totals: {
        sessionCount: totals.sessionCount,
        totalEnergyKwh: totals.totalEnergyKwh,
        totalCostIskMinor: totals.totalCostIskMinor.toString(),
        totalCostFormatted: formatIskMinor(totals.totalCostIskMinor),
      },
      sessions: rows.map((r) => ({
        sessionId: r.sessionId,
        orgId: r.orgId,
        orgDisplayName: r.orgDisplayName,
        siteId: r.siteId,
        siteDisplayName: r.siteDisplayName,
        chargingStationId: r.chargingStationId,
        chargerDisplayName: r.chargerDisplayName,
        driverUserId: r.driverUserId,
        driverIdTag: r.driverIdTag,
        startedAt: r.startedAt.toISOString(),
        stoppedAt: r.stoppedAt?.toISOString() ?? null,
        durationSec: r.durationSec,
        energyKwh: r.energyKwh,
        costIskMinor: r.costIskMinor?.toString() ?? null,
        costFormatted: r.costIskMinor
          ? formatIskMinor(r.costIskMinor)
          : null,
        tariffDefinitionId: r.tariffDefinitionId,
        stopReason: r.stopReason,
      })),
    });
  },
);

/**
 * GET /tariffs — read-only catalogue of every TariffDefinition,
 * grouped by org. Includes attachment counts (sites / installations
 * / stations using each tariff) so the operator can spot orphan
 * tariffs and gaps (sites/installations without anchors).
 *
 * Sprint 9 — first surface for the parked billing UX work. Pure
 * read; tariff editing remains via seed scripts until ADR 0021
 * lands.
 */
adminBilling.get("/tariffs", requirePermission("billing.read"), async (c) => {
  const db = makePrisma(c.env);

  // Tariff rows + their costFactor codes
  const tariffs = await db.tariffDefinition.findMany({
    include: {
      organization: { select: { id: true, displayName: true } },
      costFactor: { select: { code: true, displayName: true } },
    },
    orderBy: [{ orgId: "asc" }, { displayName: "asc" }],
  });

  // Attachment counts in three batched queries
  const tariffIds = tariffs.map((t) => t.id);
  if (tariffIds.length === 0) {
    return c.json({ orgs: [], tariffs: [] });
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

  const siteCountByTariff = new Map<string, number>();
  for (const r of siteCounts) {
    if (r.dsoTariffId) siteCountByTariff.set(r.dsoTariffId, r._count._all);
  }
  const installCountByTariff = new Map<string, number>();
  for (const r of installCounts) {
    if (r.retailerTariffId)
      installCountByTariff.set(r.retailerTariffId, r._count._all);
  }
  const stationCountByTariff = new Map<string, number>();
  for (const r of stationCounts) {
    if (r.chrgrfTariffId)
      stationCountByTariff.set(r.chrgrfTariffId, r._count._all);
  }

  const out = tariffs.map((t) => {
    const sitesUsing = siteCountByTariff.get(t.id) ?? 0;
    const installationsUsing = installCountByTariff.get(t.id) ?? 0;
    const stationsUsing = stationCountByTariff.get(t.id) ?? 0;
    const rule = t.computeRule as Record<string, unknown> | null;
    return {
      id: t.id,
      orgId: t.orgId,
      orgDisplayName: t.organization.displayName,
      displayName: t.displayName,
      currency: t.currency,
      vatRatePct: t.vatRatePct?.toString() ?? null,
      status: t.status,
      costFactorCode: t.costFactor?.code ?? null,
      costFactorName: t.costFactor?.displayName ?? null,
      computeRuleKind: typeof rule?.kind === "string" ? rule.kind : null,
      pricePerKwhMinor:
        rule?.pricePerKwhMinor !== undefined
          ? String(rule.pricePerKwhMinor)
          : null,
      sitesUsing,
      installationsUsing,
      stationsUsing,
      isOrphan: sitesUsing + installationsUsing + stationsUsing === 0,
    };
  });

  return c.json({ tariffs: out });
});

// Sprint 9 Track A — tariff detail + DSO rates sub-routers.
// Mount after the /tariffs catalogue route so the more-specific
// /:id/detail path doesn't shadow the list endpoint.
adminBilling.route("/tariffs/:id/detail", tariffDetailRouter);
adminBilling.route("/dso", dsoRouter);

// Sprint 9 Track C — Agreement catalogue + driver-level membership surfaces.
adminBilling.route("/contracts", contractsRouter);
adminBilling.route("/driver-contracts", driverContractsRouter);

// Sprint 9 Track B — cost-factor catalogue + retailer/electricity rates.
adminBilling.route("/cost-factors", costFactorsRouter);
adminBilling.route("/electricity", electricityRouter);

// Sprint 9 Track D — overview dashboard summary + cost-center catalogue.
adminBilling.route("/summary", summaryRouter);
adminBilling.route("/cost-centers", costCentersRouter);

// Sprint 9 Track B — rate-reference (versioned rate book) CRUD.
adminBilling.route("/rate-references", rateReferencesRouter);

// Sprint 9 Track C — TariffDefinition create/edit/clone/lifecycle.
adminBilling.route("/tariffs-mgmt", tariffMgmtRouter);

// Sprint 9 / ENRICH-4 — enrichment-status surface.
adminBilling.route("/enrichment", enrichmentRouter);
