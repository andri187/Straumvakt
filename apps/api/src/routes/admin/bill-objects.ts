// ADR 0029 — BillObject (billing-home) admin routes.
//
// Mounted via app.route("/api/admin/orgs", adminBillObjects):
//   POST /:orgId/bill-objects                    — create a billing home
//   GET  /:orgId/bill-objects?installationId=    — list
//   GET  /:orgId/bill-objects/:id                — one
//   POST /:orgId/bill-objects/:id/members        — attach a driver { userId }
//   GET  /:orgId/bill-objects/:id/members        — list members
//
// Org-scoped: billing.read for reads, billing.write for writes, both
// resolved against :orgId. Cross-tenant guards reject acting on another
// host's installation/bill-object.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { recordAuditAction } from "../../lib/audit";
import {
  assignDriverToBillObject,
  createBillObject,
  getBillObject,
  listBillObjectMembers,
  listBillObjectsForOrg,
} from "../../repositories/bill-objects";
import type { Env } from "../../bindings";

export const adminBillObjects = new Hono<{
  Bindings: Env;
  Variables: AuthVars;
}>();

adminBillObjects.use("*", requireAdmin);

const KINDS = [
  "apartment",
  "unit",
  "stall",
  "company",
  "department",
  "cost_center",
  "other",
] as const;

const OwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }),
  z.object({ kind: z.literal("org"), orgId: z.string().uuid() }),
  z.object({ kind: z.literal("none") }),
]);

const CreateBody = z.object({
  kind: z.enum(KINDS),
  label: z.string().trim().min(1).max(200),
  installationId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  owner: OwnerSchema,
});

function actorUserId(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
): string | null {
  const session = c.get("session") as { userId?: string } | undefined;
  return session?.userId ?? null;
}

// ── POST /:orgId/bill-objects ─────────────────────────────────────────
adminBillObjects.post(
  "/:orgId/bill-objects",
  requirePermission("billing.write", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = CreateBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const { kind, label, installationId, parentId, owner } = parsed.data;
    const db = makePrisma(c.env);

    // Guard: installation (if given) must belong to this org.
    if (installationId) {
      const inst = await db.installation.findUnique({
        where: { id: installationId },
        select: { orgId: true },
      });
      if (!inst) {
        return c.json({ error: "not_found", message: "Installation not found" }, 404);
      }
      if (inst.orgId !== orgId) {
        return c.json(
          { error: "forbidden", message: "Installation does not belong to this organisation" },
          403,
        );
      }
    }

    const billObject = await createBillObject(db, orgId, {
      kind,
      label,
      installationId: installationId ?? null,
      parentId: parentId ?? null,
      ownerUserId: owner.kind === "user" ? owner.userId : null,
      ownerOrgId: owner.kind === "org" ? owner.orgId : null,
    });

    await recordAuditAction(db, {
      orgId,
      actorUserId: actorUserId(c),
      actorKind: "user",
      action: "bill_object.create",
      targetType: "bill_object",
      targetId: billObject.id,
      metadata: { kind, label, owner },
    });

    return c.json({ billObject }, 201);
  },
);

// ── GET /:orgId/bill-objects ──────────────────────────────────────────
adminBillObjects.get(
  "/:orgId/bill-objects",
  requirePermission("billing.read", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const installationId = c.req.query("installationId") ?? undefined;
    const db = makePrisma(c.env);
    const items = await listBillObjectsForOrg(db, orgId, { installationId });
    return c.json({ items });
  },
);

// ── GET /:orgId/bill-objects/:id ──────────────────────────────────────
adminBillObjects.get(
  "/:orgId/bill-objects/:id",
  requirePermission("billing.read", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const id = c.req.param("id");
    const db = makePrisma(c.env);
    const billObject = await getBillObject(db, orgId, id);
    if (!billObject) return c.json({ error: "not_found" }, 404);
    return c.json({ billObject });
  },
);

// ── POST /:orgId/bill-objects/:id/members ─────────────────────────────
const AssignBody = z.object({ userId: z.string().uuid() });

adminBillObjects.post(
  "/:orgId/bill-objects/:id/members",
  requirePermission("billing.write", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const billObjectId = c.req.param("id");
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = AssignBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const { userId } = parsed.data;
    const db = makePrisma(c.env);

    // Guard: bill object belongs to this org.
    const billObject = await getBillObject(db, orgId, billObjectId);
    if (!billObject) return c.json({ error: "not_found", message: "BillObject not found" }, 404);

    // Guard: user is an active driver.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, audience: true, status: true },
    });
    if (!user) return c.json({ error: "not_found", message: "User not found" }, 404);
    if (user.audience !== "driver") {
      return c.json({ error: "unprocessable", message: "User audience must be 'driver'" }, 422);
    }
    if (user.status !== "active") {
      return c.json({ error: "unprocessable", message: "User must be active" }, 422);
    }

    const result = await assignDriverToBillObject(db, orgId, billObjectId, userId);

    if (result.created) {
      await recordAuditAction(db, {
        orgId,
        actorUserId: actorUserId(c),
        actorKind: "user",
        action: "bill_object_member.assign",
        targetType: "bill_object_member",
        targetId: result.member.id,
        metadata: { billObjectId, userId, closedPrevious: result.closedPrevious },
      });
    }

    return c.json(result, result.created ? 201 : 200);
  },
);

// ── GET /:orgId/bill-objects/:id/members ──────────────────────────────
adminBillObjects.get(
  "/:orgId/bill-objects/:id/members",
  requirePermission("billing.read", { orgIdParam: "orgId" }),
  async (c) => {
    const orgId = c.req.param("orgId");
    const billObjectId = c.req.param("id");
    const db = makePrisma(c.env);
    // Tenant guard via the bill object.
    const billObject = await getBillObject(db, orgId, billObjectId);
    if (!billObject) return c.json({ error: "not_found" }, 404);
    const includeEnded = c.req.query("includeEnded") === "true";
    const members = await listBillObjectMembers(db, billObjectId, { includeEnded });
    return c.json({ members });
  },
);
