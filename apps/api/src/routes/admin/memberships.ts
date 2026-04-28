import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { removeMembership } from "../../repositories/users";
import type { Env } from "../../bindings";

export const adminMemberships = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminMemberships.use("*", requireAdmin);

adminMemberships.delete("/:orgId/:userId", async (c) => {
  const db = makePrisma(c.env);
  await removeMembership(db, c.req.param("orgId"), c.req.param("userId"));
  return c.json({ ok: true });
});
