// Billing overview dashboard API (Track D, Sprint 9).
//
// Mounts as /api/admin/billing/summary via adminBilling.route().
// All routes require billing.read.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  getPeriodTotals,
  getTariffCoverage,
  getCostHealthMetric,
  getRecentLedgerEntries,
  getProjectedOrgRevenue,
} from "../../repositories/billing-summary";
import type { Env } from "../../bindings";

export const summaryRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

summaryRouter.use("*", requireAdmin);

/**
 * GET /api/admin/billing/summary
 *
 * Returns all tiles for the billing overview dashboard in one call:
 *   - currentPeriod / previousPeriod totals (sessions, energy, revenue)
 *   - tariffCoverage
 *   - costHealth (% of last-30d sessions with cost_isk_minor set)
 *   - projectedClose (top 10 orgs by current-month revenue)
 *   - recentEntries (10 most recent session_ledger rows)
 */
summaryRouter.get(
  "/",
  requirePermission("billing.read"),
  async (c) => {
    const db = makePrisma(c.env);

    const now = new Date();
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1; // 1-indexed

    // Previous month (handles January → December wrap)
    const prevYear = curMonth === 1 ? curYear - 1 : curYear;
    const prevMonth = curMonth === 1 ? 12 : curMonth - 1;

    const [
      currentPeriod,
      previousPeriod,
      tariffCoverage,
      costHealth,
      projectedClose,
      recentEntries,
    ] = await Promise.all([
      getPeriodTotals(db, curYear, curMonth),
      getPeriodTotals(db, prevYear, prevMonth),
      getTariffCoverage(db),
      getCostHealthMetric(db),
      getProjectedOrgRevenue(db, curYear, curMonth, 10),
      getRecentLedgerEntries(db, 10),
    ]);

    return c.json({
      period: { year: curYear, month: curMonth },
      currentPeriod,
      previousPeriod,
      tariffCoverage,
      costHealth,
      projectedClose,
      recentEntries,
    });
  },
);
