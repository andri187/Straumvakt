// Billing cost-centers catalogue API (Track D, Sprint 9).
//
// Mounts as /api/admin/billing/cost-centers via adminBilling.route().
// All routes require billing.read.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { listCostCenters } from "../../repositories/billing-cost-centers";
import type { Env } from "../../bindings";

export const costCentersRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

costCentersRouter.use("*", requireAdmin);

/**
 * GET /api/admin/billing/cost-centers
 *
 * Returns the catalogue of all billing.cost_centers across all orgs.
 * Each row includes: org, payer org/user, beneficiary org, active
 * membership count, last session date, current-period revenue, and
 * active tariff count for the owning org.
 *
 * Query params (optional):
 *   year  — integer, defaults to UTC current year
 *   month — integer (1-12), defaults to UTC current month
 */
costCentersRouter.get(
  "/",
  requirePermission("billing.read"),
  async (c) => {
    const now = new Date();
    const year =
      Number(c.req.query("year") ?? now.getUTCFullYear()) || now.getUTCFullYear();
    const month =
      Number(c.req.query("month") ?? now.getUTCMonth() + 1) ||
      now.getUTCMonth() + 1;

    const db = makePrisma(c.env);
    const costCenters = await listCostCenters(db, year, month);

    return c.json({ costCenters, period: { year, month } });
  },
);
