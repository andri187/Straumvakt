import { Hono } from "hono";
import { UserCreateInput, UserUpdateInput } from "@straumvakt/shared/inputs/users";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import {
  createUser,
  getUserById,
  listUserMemberships,
  listUsers,
  updateUser,
} from "../../repositories/users";
import type { Env } from "../../bindings";

export const adminUsers = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminUsers.use("*", requireAdmin);

adminUsers.get("/", async (c) => {
  const db = makePrisma(c.env);
  const users = await listUsers(db, { includeDeleted: c.req.query("includeDeleted") === "true" });
  return c.json({ users });
});

adminUsers.post("/", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = UserCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  try {
    const user = await createUser(db, parsed.data);
    return c.json({ user }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return c.json({ error: "email_taken" }, 409);
    }
    throw err;
  }
});

adminUsers.get("/:id", async (c) => {
  const db = makePrisma(c.env);
  const [user, memberships] = await Promise.all([
    getUserById(db, c.req.param("id")),
    listUserMemberships(db, c.req.param("id")),
  ]);
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json({ user, memberships });
});

adminUsers.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = UserUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const user = await updateUser(db, c.req.param("id"), parsed.data);
  return c.json({ user });
});
