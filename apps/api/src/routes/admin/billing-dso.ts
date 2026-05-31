// DSO rates sub-router — /api/admin/billing/dso
// Sprint 9 Track A.
//
// Mounts as a sub-router under adminBilling (see billing.ts). Requires the
// parent's requireAdmin middleware (already applied) plus billing.read.
//
// Returns all billing.cost_factors with anchorTier = "site" (DSO-level)
// with per-org TariffDefinition usage and cross-reference metadata.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import { getDsoCostFactors } from "../../repositories/billing-dso";
import type { Env } from "../../bindings";
import type { AuthVars } from "../../lib/auth-middleware";

export const dsoRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

/**
 * GET /api/admin/billing/dso
 *
 * Returns all cost factors with anchorTier = "site" (DSO-level), with
 * per-org TariffDefinition usage, orphan flags, and aggregate tile counts.
 *
 * Shape:
 *   {
 *     totalFactors: number,
 *     totalTariffs: number,
 *     orphanFactors: number,
 *     factors: DsoCostFactor[]
 *   }
 */
dsoRouter.get("/", requirePermission("billing.read"), async (c) => {
  const db = makePrisma(c.env);
  const summary = await getDsoCostFactors(db);
  return c.json(summary);
});
