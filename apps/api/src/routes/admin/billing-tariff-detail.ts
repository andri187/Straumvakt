// Tariff detail sub-router — /api/admin/billing/tariffs/:id/detail
// Sprint 9 Track A.
//
// Mounts as a sub-router under adminBilling (see billing.ts). Requires the
// parent's requireAdmin middleware (already applied) plus billing.read.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import { getTariffDetail } from "../../repositories/billing-tariff-detail";
import type { Env } from "../../bindings";
import type { AuthVars } from "../../lib/auth-middleware";

export const tariffDetailRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

/**
 * GET /api/admin/billing/tariffs/:id/detail
 *
 * Returns full detail for a single TariffDefinition:
 *   - Header (org, costFactor, computeRule, status, validity)
 *   - "Used by" lists: sites (dsoTariffId), installations (retailerTariffId),
 *     stations (chrgrfTariffId)
 *   - Recent session-ledger entries (last 30 days, top 20)
 *   - isOrphan flag (true when no entities reference this tariff)
 */
tariffDetailRouter.get("/", requirePermission("billing.read"), async (c) => {
  // The :id param comes from the parent route's path pattern. Hono
  // propagates ancestor params — access via c.req.param("id").
  const tariffId = c.req.param("id");
  if (!tariffId) {
    return c.json({ error: "missing_id" }, 400);
  }

  const db = makePrisma(c.env);
  const result = await getTariffDetail(db, tariffId);

  if (!result.tariff) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json(result);
});
