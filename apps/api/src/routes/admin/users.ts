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
import {
  createIdToken,
  listIdTokensForUser,
} from "../../repositories/id-tokens";
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
    const { user, primaryToken } = await createUser(db, parsed.data);
    return c.json({ user, primaryToken }, 201);
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
  // The id_tokens table is part of the 2026-05-02 user-profile-enrichment
  // migration. If staging Neon hasn't had `prisma migrate deploy` run for
  // that migration, listIdTokensForUser fails with "relation does not
  // exist" — and Promise.all would 500 the entire user-detail GET, which
  // would break the user-detail page even though the user / memberships
  // data is fine. Degrade to idTokens=[] on failure and log loudly so the
  // operator notices and runs migrate deploy.
  const [user, memberships, idTokens] = await Promise.all([
    getUserById(db, c.req.param("id")),
    listUserMemberships(db, c.req.param("id")),
    listIdTokensForUser(db, c.req.param("id")).catch((err) => {
      console.error("[admin/users] listIdTokensForUser failed; degrading to []", {
        userId: c.req.param("id"),
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json({ user, memberships, idTokens });
});

adminUsers.patch("/:id", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = UserUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makePrisma(c.env);
  const user = await updateUser(db, c.req.param("id"), parsed.data);
  return c.json({ user });
});

// ── RFID / IdToken sub-resource ──────────────────────────────────────
//
// GET    /api/admin/users/:id/tokens          list all tokens for user
// POST   /api/admin/users/:id/tokens          add a token; value optional
//                                             (omit → auto-mint for rfid)
//
// Revoke lives at /api/admin/tokens/:tokenId (mounted under
// adminIdTokens in apps/api/src/index.ts) so the URL doesn't repeat the
// userId — tokens are unique system-wide.

adminUsers.get("/:id/tokens", async (c) => {
  const db = makePrisma(c.env);
  const tokens = await listIdTokensForUser(db, c.req.param("id"));
  return c.json({ tokens });
});

adminUsers.post("/:id/tokens", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object") {
    return c.json({ error: "body required" }, 400);
  }
  const body = raw as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "rfid";
  if (!isValidKind(kind)) {
    return c.json({ error: "invalid_kind", kind }, 400);
  }
  const value = typeof body.value === "string" ? body.value.trim() : undefined;
  const label = typeof body.label === "string" ? body.label.trim() : undefined;
  const db = makePrisma(c.env);
  try {
    const token = await createIdToken(db, {
      userId: c.req.param("id"),
      kind,
      ...(value && value.length > 0 ? { value } : {}),
      ...(label && label.length > 0 ? { label } : {}),
    });
    return c.json({ token }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return c.json({ error: "value_taken" }, 409);
    }
    if (msg.startsWith("idtoken.")) {
      return c.json({ error: "validation", message: msg }, 400);
    }
    throw err;
  }
});

const VALID_KINDS = [
  "rfid",
  "app_jwt",
  "magic_link",
  "zaptec_proxy",
  "ocpi_token",
  "manual",
] as const;
type ValidKind = (typeof VALID_KINDS)[number];

function isValidKind(k: string): k is ValidKind {
  return (VALID_KINDS as readonly string[]).includes(k);
}
