import { Hono } from "hono";
import { MembershipUpdateInput } from "@straumvakt/shared/inputs/users";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import { removeMembership, updateMembership } from "../../repositories/users";
import type { Env } from "../../bindings";

export const adminMemberships = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminMemberships.use("*", requireAdmin);

adminMemberships.patch(
  "/:orgId/:userId",
  requirePermission("member.write", { orgIdParam: "orgId" }),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = MembershipUpdateInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    const db = makePrisma(c.env);
    const membership = await updateMembership(
      db,
      c.req.param("orgId"),
      c.req.param("userId"),
      parsed.data.role,
    );
    return c.json({ membership });
  },
);

adminMemberships.delete(
  "/:orgId/:userId",
  requirePermission("member.remove", { orgIdParam: "orgId" }),
  async (c) => {
    const db = makePrisma(c.env);
    await removeMembership(db, c.req.param("orgId"), c.req.param("userId"));
    return c.json({ ok: true });
  },
);
