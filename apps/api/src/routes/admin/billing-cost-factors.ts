// GET /api/admin/billing/cost-factors
//
// Read-only catalogue of all billing.cost_factors rows, grouped by
// anchorTier. Powers the /billing/cost-factors admin page.
//
// Sprint 9 — Track B.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import { listCostFactors } from "../../repositories/billing-cost-factors";
import type { AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

export const costFactorsRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

costFactorsRouter.get("/", requirePermission("billing.read"), async (c) => {
  const db = makePrisma(c.env);
  const summary = await listCostFactors(db);
  return c.json(summary);
});
