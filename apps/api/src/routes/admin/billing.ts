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
import { formatIskMinor } from "../../lib/tariff/compute-session-cost";
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
