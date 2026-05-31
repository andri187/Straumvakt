// GET /api/admin/billing/electricity
//
// Read-only catalogue of electricity (retailer/installation-tier) cost
// factors, with per-org TariffDefinition usage counts. Powers the
// /billing/electricity admin page's DB-side panel.
//
// Sprint 9 — Track B.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import { listElectricityCostFactors } from "../../repositories/billing-electricity";
import type { AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

export const electricityRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

electricityRouter.get("/", requirePermission("billing.read"), async (c) => {
  const db = makePrisma(c.env);
  const summary = await listElectricityCostFactors(db);
  return c.json(summary);
});
