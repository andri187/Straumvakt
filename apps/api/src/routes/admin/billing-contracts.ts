// Admin billing sub-router — Agreement catalogue (Sprint 9 / ADR 0019).
//
// Mounted by billing.ts at /api/admin/billing/contracts.
// Reads agreements.agreements, driver_groups, clauses.
//
// Auth: requireAdmin already applied by the parent adminBilling router.
// Additional gate: requirePermission("billing.read") per-route.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listAgreements,
  getContractsTiles,
} from "../../repositories/billing-contracts";
import type { Env } from "../../bindings";
import type { AuthVars } from "../../lib/auth-middleware";

export const contractsRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

/**
 * GET /api/admin/billing/contracts
 *
 * Returns every Agreement (across all counterparty orgs) plus tile data.
 * Optional query param: ?orgId=<uuid> — filters by counterpartyOrgId or cpoOrgId.
 */
contractsRouter.get(
  "/",
  requirePermission("billing.read"),
  async (c) => {
    const orgId = c.req.query("orgId") ?? null;
    const db = makePrisma(c.env);
    const [agreements, tiles] = await Promise.all([
      listAgreements(db, orgId),
      getContractsTiles(db),
    ]);
    return c.json({ agreements, tiles });
  },
);
