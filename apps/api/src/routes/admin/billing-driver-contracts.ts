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
import { resolveOrgScope } from "../../lib/auth/org-scope";
import { decideLedgerAccess } from "../../lib/billing/ledger-scope";
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
    // TENANCY. The ?orgId= query parameter was the ONLY confinement, and it
    // is supplied by the caller: omitting it returned every tenant's driver
    // memberships, with email, displayName and phone attached. A
    // caller-supplied filter is not a tenancy control -- it confines the
    // query only for callers who choose to send it, which is exactly the set
    // of callers who were not the threat.
    //
    // The decision now goes through the SAME decideLedgerAccess the session
    // ledger uses, so naming someone else's org is a 403 rather than a quiet
    // narrowing to your own rows, and a caller with no memberships is denied
    // outright instead of being handed the whole table.
    const requestedOrgId = c.req.query("orgId") ?? null;
    const decision = decideLedgerAccess(
      { orgId: requestedOrgId ?? undefined },
      await resolveOrgScope(c.env, c.get("session")),
    );
    if (decision.kind === "deny") {
      return c.json({ error: decision.reason }, 403);
    }
    const { restrictToOrgIds } = decision.access;

    const db = makePrisma(c.env);
    const [memberships, tiles] = await Promise.all([
      listDriverMemberships(db, restrictToOrgIds, requestedOrgId),
      getDriverContractsTiles(db, restrictToOrgIds, requestedOrgId),
    ]);
    return c.json({ memberships, tiles });
  },
);
