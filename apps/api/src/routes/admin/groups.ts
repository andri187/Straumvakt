// Cross-org groups listing — surfaces every group kind in one
// response so the /tenants/groups page can render them with a kind
// filter without N round-trips.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { listAllFamilyGroups } from "../../repositories/family-groups";
import { listAllVendorUserGroups } from "../../repositories/vendor-user-groups";
import type { Env } from "../../bindings";

export const adminGroups = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminGroups.use("*", requireAdmin);

// Cross-tenant — every org's groups surfaced in one call. Platform-only.
adminGroups.get("/", requirePermission("platform.tenant.read"), async (c) => {
  const db = makePrisma(c.env);
  const [familyGroups, vendorGroups] = await Promise.all([
    listAllFamilyGroups(db),
    listAllVendorUserGroups(db),
  ]);
  return c.json({ familyGroups, vendorGroups });
});
