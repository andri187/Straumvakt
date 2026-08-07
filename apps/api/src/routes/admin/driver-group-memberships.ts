// Admin route — POST /api/admin/orgs/:orgId/driver-group-memberships
//
// Creates a DriverGroupMembership that grants a driver access through an
// Agreement-backed DriverGroup. Idempotent: a duplicate call returns the
// existing row (200 + created:false) rather than a 409.
//
// Mounted via:
//   app.route("/api/admin/orgs", adminDriverGroupMemberships)
// so the full path becomes /api/admin/orgs/:orgId/driver-group-memberships.
//
// Guard rail: DriverGroup.ownerOrgId must match the :orgId URL parameter.
// This prevents cross-tenant privilege escalation — an operator for org A
// cannot add a driver to org B's group by posting to /orgs/A/...

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { makeDrizzle } from "../../lib/drizzle";
import { driverGroups } from "@straumvakt/shared/db/commercial";
import { users } from "@straumvakt/shared/db/identity";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { recordAuditAction } from "../../lib/audit";
import {
  createMembership,
  listMembershipsForDriverGroup,
} from "../../repositories/driver-group-memberships";
import type { Env } from "../../bindings";

export const adminDriverGroupMemberships = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

adminDriverGroupMemberships.use("*", requireAdmin);

// ─── Input schema ─────────────────────────────────────────────────────────────

const CreateMembershipBody = z.object({
  userId: z.string().uuid(),
  driverGroupId: z.string().uuid(),
});

// ─── POST /:orgId/driver-group-memberships ────────────────────────────────────

adminDriverGroupMemberships.post(
  "/:orgId/driver-group-memberships",
  requirePermission("member.write", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = CreateMembershipBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }

    const { userId, driverGroupId } = parsed.data;
    const db = makeDrizzle(c.env);

    // ── Guard 1: DriverGroup must exist and belong to this org ───────────────
    const [group] = await db
      .select({
        id: driverGroups.id,
        ownerOrgId: driverGroups.ownerOrgId,
        displayName: driverGroups.displayName,
      })
      .from(driverGroups)
      .where(eq(driverGroups.id, driverGroupId))
      .limit(1);

    if (!group) {
      return c.json({ error: "not_found", message: "DriverGroup not found" }, 404);
    }

    if (group.ownerOrgId !== orgId) {
      // Cross-tenant assignment attempt — reject with 403 (not 404) so
      // the operator knows the group exists but they're not allowed to
      // assign under this org.
      return c.json(
        {
          error: "forbidden",
          message: "DriverGroup does not belong to this organisation",
        },
        403,
      );
    }

    // ── Guard 2: User must exist, be a driver, and be active ────────────────
    const [user] = await db
      .select({ id: users.id, audience: users.audience, status: users.status, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return c.json({ error: "not_found", message: "User not found" }, 404);
    }

    if (user.audience !== "driver") {
      return c.json(
        {
          error: "unprocessable",
          message: "User audience must be 'driver'",
        },
        422,
      );
    }

    if (user.status !== "active") {
      return c.json(
        {
          error: "unprocessable",
          message: "User must have status 'active'",
        },
        422,
      );
    }

    // ── Create (idempotent) ──────────────────────────────────────────────────
    const result = await createMembership(db, { driverGroupId, userId });

    // ── Audit log (only on new creation — skip on idempotent repeat) ─────────
    if (result.created) {
      const session = c.get("session");
      const actorUserId =
        (session as typeof session & { userId?: string }).userId ?? null;

      await recordAuditAction(db, {
        orgId,
        actorUserId,
        actorKind: "user",
        action: "driver_group_membership.create",
        targetType: "driver_group_membership",
        targetId: result.membership.id,
        metadata: {
          driverGroupId,
          userId,
          driverGroupDisplayName: group.displayName,
          userEmail: user.email,
        },
      });
    }

    const status = result.created ? 201 : 200;
    return c.json({ membership: result.membership, created: result.created }, status);
  },
);

// ─── GET /:orgId/driver-group-memberships ─────────────────────────────────────
//
// Optional read surface — list memberships for a group scoped to this org.
// Query param: ?driverGroupId=<uuid> (required). The group must belong to orgId.

adminDriverGroupMemberships.get(
  "/:orgId/driver-group-memberships",
  requirePermission("member.write", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const driverGroupId = c.req.query("driverGroupId");

    if (!driverGroupId) {
      return c.json({ error: "validation", message: "driverGroupId query param required" }, 400);
    }

    const db = makeDrizzle(c.env);

    // Verify group belongs to this org before returning members.
    const [group] = await db
      .select({ ownerOrgId: driverGroups.ownerOrgId })
      .from(driverGroups)
      .where(eq(driverGroups.id, driverGroupId))
      .limit(1);

    if (!group) {
      return c.json({ error: "not_found", message: "DriverGroup not found" }, 404);
    }

    if (group.ownerOrgId !== orgId) {
      return c.json({ error: "forbidden", message: "DriverGroup does not belong to this organisation" }, 403);
    }

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 500) : 100;

    const memberships = await listMembershipsForDriverGroup(db, driverGroupId, { limit });
    return c.json({ memberships });
  },
);
