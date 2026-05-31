// Admin billing sub-router — DriverGroupMembership catalogue (Sprint 9 / ADR 0019).
//
// Mounted by billing.ts at /api/admin/billing/driver-contracts.
// Reads agreements.driver_group_memberships → driver_groups → agreements,
// joins identity.users and reports.session_ledger.
//
// Auth: requireAdmin already applied by the parent adminBilling router.
// Additional gate: requirePermission("billing.read") per-route.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  listDriverMemberships,
  getDriverContractsTiles,
} from "../../repositories/billing-driver-contracts";
import type { Env } from "../../bindings";
import type { AuthVars } from "../../lib/auth-middleware";

export const driverContractsRouter = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

/**
 * GET /api/admin/billing/driver-contracts
 *
 * Returns every DriverGroupMembership with user + group + agreement data,
 * plus last-session date and dormancy flag.
 * Optional query param: ?orgId=<uuid> — filters by DriverGroup.ownerOrgId.
 */
driverContractsRouter.get(
  "/",
  requirePermission("billing.read"),
  async (c) => {
    const orgId = c.req.query("orgId") ?? null;
    const db = makePrisma(c.env);
    const [memberships, tiles] = await Promise.all([
      listDriverMemberships(db, orgId),
      getDriverContractsTiles(db, orgId),
    ]);
    return c.json({ memberships, tiles });
  },
);
