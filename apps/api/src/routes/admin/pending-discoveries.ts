// Admin route for the pre-onboarding pool. Read-only listing + dismiss.
// Provisioning a row out of the pool happens via the regular charger
// create flow (POST /api/admin/chargers), which deletes the matching
// pending_discoveries row in the same transaction.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  clearIdlePendingDiscoveries,
  deletePendingDiscovery,
  listPendingDiscoveries,
} from "../../repositories/pending-discoveries";
import type { Env } from "../../bindings";

export const adminPendingDiscoveries = new Hono<{ Bindings: Env; Variables: AuthVars }>();

// Pending discoveries are pre-onboarding observations of chargers that
// connect with no credentials — platform-only signal, no tenant scope.
adminPendingDiscoveries.use("*", requireAdmin);

adminPendingDiscoveries.get(
  "/",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const pending = await listPendingDiscoveries(db);
    return c.json({ pending });
  },
);

// Bulk-delete idle (last_seen > 5 min ago) rows. Path is registered
// before /:identityString so Hono routes it correctly — Hono matches
// in registration order.
adminPendingDiscoveries.post(
  "/clear-idle",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const db = makePrisma(c.env);
    const count = await clearIdlePendingDiscoveries(db);
    return c.json({ ok: true, deleted: count });
  },
);

adminPendingDiscoveries.delete(
  "/:identityString",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const db = makePrisma(c.env);
    await deletePendingDiscovery(db, c.req.param("identityString"));
    return c.json({ ok: true });
  },
);
