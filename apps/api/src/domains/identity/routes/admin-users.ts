import { Hono } from "hono";
import { z } from "zod";
import { UserCreateInput, UserUpdateInput } from "@straumvakt/shared/inputs/users";
import { makePrisma } from "../../../lib/prisma";
import { makeDrizzle } from "../../../lib/drizzle";
import { requireAdmin, type AuthVars } from "../../../lib/auth-middleware";
import { requirePermission } from "../../../lib/auth/require-permission";
import { hashPassword } from "../../../lib/password";
import {
  clearUserPasswordHash,
  createUser,
  getUserById,
  listUserMemberships,
  listUsers,
  setUserPasswordHash,
  updateUser,
  userExists,
} from "../repositories/users";
import {
  createIdToken,
  listIdTokensForUser,
} from "../repositories/id-tokens";
import { listAgreementMembershipsForUser } from "../../../repositories/agreements";
import { RecordNotFoundError, UniqueViolationError } from "../repositories/errors";
import type { Env } from "../../../bindings";

// Two clients on the user-detail and password routes, deliberately and
// temporarily.
//
// The identity repositories are Drizzle now; listAgreementMembershipsForUser
// reads the agreements schema and is still Prisma, because commercial has
// not been ported and must not be touched (ADR 0025 D1-D5 are unanswered).
// A route that needs both opens both — one extra Hyperdrive checkout on two
// handlers, which is the honest cost of a half-migrated system and is paid
// back when commercial lands. It is NOT a pattern to copy into new routes.

export const adminUsers = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminUsers.use("*", requireAdmin);

// Cross-tenant user list — platform staff only.
adminUsers.get("/", requirePermission("platform.tenant.read"), async (c) => {
  const db = makeDrizzle(c.env);
  const users = await listUsers(db, { includeDeleted: c.req.query("includeDeleted") === "true" });
  return c.json({ users });
});

// Creating a User row is platform-staff bootstrap today (no org binding
// at create time); Sprint 5 invite flow makes this org-scoped via
// member.invite at /api/admin/orgs/:orgId/memberships.
adminUsers.post("/", requirePermission("platform.tenant.write"), async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = UserCreateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makeDrizzle(c.env);
  try {
    const { user, primaryToken } = await createUser(db, parsed.data);
    return c.json({ user, primaryToken }, 201);
  } catch (err) {
    if (err instanceof UniqueViolationError) {
      return c.json({ error: "email_taken" }, 409);
    }
    throw err;
  }
});

adminUsers.get("/:id", requirePermission("member.read"), async (c) => {
  const db = makeDrizzle(c.env);
  // Prisma as well, only for the agreements read — see the note at the top.
  const prisma = makePrisma(c.env);
  // The id_tokens table is part of the 2026-05-02 user-profile-enrichment
  // migration. If staging Neon hasn't had `prisma migrate deploy` run for
  // that migration, listIdTokensForUser fails with "relation does not
  // exist" — and Promise.all would 500 the entire user-detail GET, which
  // would break the user-detail page even though the user / memberships
  // data is fine. Degrade to idTokens=[] on failure and log loudly so the
  // operator notices and runs migrate deploy. Same defensive treatment
  // for agreement memberships (added per ADR 0019 A.8 — degrade if the
  // agreements schema isn't deployed yet).
  const [user, memberships, idTokens, agreementMemberships] = await Promise.all([
    getUserById(db, c.req.param("id")),
    listUserMemberships(db, c.req.param("id")),
    listIdTokensForUser(db, c.req.param("id")).catch((err) => {
      console.error("[admin/users] listIdTokensForUser failed; degrading to []", {
        userId: c.req.param("id"),
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    listAgreementMembershipsForUser(prisma, c.req.param("id")).catch((err) => {
      console.error("[admin/users] listAgreementMembershipsForUser failed; degrading to []", {
        userId: c.req.param("id"),
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json({ user, memberships, idTokens, agreementMemberships });
});

adminUsers.patch("/:id", requirePermission("member.write"), async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = UserUpdateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  const db = makeDrizzle(c.env);
  try {
    const user = await updateUser(db, c.req.param("id"), parsed.data);
    return c.json({ user });
  } catch (err) {
    // Prisma raised P2002 here too and nothing caught it, so a PATCH to a
    // taken email was a 500. Now it is the 409 the POST already returned.
    if (err instanceof UniqueViolationError) {
      return c.json({ error: "email_taken" }, 409);
    }
    if (err instanceof RecordNotFoundError) {
      return c.json({ error: "not_found" }, 404);
    }
    throw err;
  }
});

// ── Password management (Sprint 9 — admin-driven set / clear) ────────
//
// Surfaces the existing UserCredential model. Login already validates
// against UserCredential.passwordHash (Path B in admin/auth.ts); this
// endpoint is the missing operator-facing way to seed or rotate it.
//
// PUT    /api/admin/users/:id/password   { password: string }  → 200 { ok: true }
// DELETE /api/admin/users/:id/password                          → 200 { ok: true }
//
// No "current password" challenge — admin-side reset, not user-side.
// The user's old session is not invalidated by this endpoint; that's a
// separate concern.

const passwordSchema = z.object({ password: z.string().min(8).max(200) });

adminUsers.put(
  "/:id/password",
  requirePermission("member.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = passwordSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const db = makeDrizzle(c.env);
    const userId = c.req.param("id");
    if (!(await userExists(db, userId))) return c.json({ error: "not_found" }, 404);

    await setUserPasswordHash(db, userId, await hashPassword(parsed.data.password));
    return c.json({ ok: true });
  },
);

adminUsers.delete(
  "/:id/password",
  requirePermission("member.write"),
  async (c) => {
    const db = makeDrizzle(c.env);
    // Idempotent — if the row doesn't exist, treat as success.
    await clearUserPasswordHash(db, c.req.param("id"));
    return c.json({ ok: true });
  },
);

// ── RFID / IdToken sub-resource ──────────────────────────────────────
//
// GET    /api/admin/users/:id/tokens          list all tokens for user
// POST   /api/admin/users/:id/tokens          add a token; value optional
//                                             (omit → auto-mint for rfid)
//
// Revoke lives at /api/admin/tokens/:tokenId (mounted under
// adminIdTokens in apps/api/src/index.ts) so the URL doesn't repeat the
// userId — tokens are unique system-wide.

adminUsers.get("/:id/tokens", requirePermission("member.read"), async (c) => {
  const db = makeDrizzle(c.env);
  const tokens = await listIdTokensForUser(db, c.req.param("id"));
  return c.json({ tokens });
});

adminUsers.post("/:id/tokens", requirePermission("member.write"), async (c) => {
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
  // Sprint 9 / 2026-05-10 — accept optional scopeInstallationId +
  // expiresAt so the technical-read add-idTag form can pre-bind a
  // freshly-minted token to the charger's installation.
  const scopeInstallationId =
    typeof body.scopeInstallationId === "string"
      ? body.scopeInstallationId
      : undefined;
  let expiresAt: Date | undefined;
  if (typeof body.expiresAt === "string" && body.expiresAt.length > 0) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) {
      return c.json({ error: "expiresAt_invalid_iso" }, 400);
    }
    expiresAt = d;
  }
  const db = makeDrizzle(c.env);
  try {
    const token = await createIdToken(db, {
      userId: c.req.param("id"),
      kind,
      ...(value && value.length > 0 ? { value } : {}),
      ...(label && label.length > 0 ? { label } : {}),
      ...(scopeInstallationId ? { scopeInstallationId } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
    return c.json({ token }, 201);
  } catch (err) {
    if (err instanceof UniqueViolationError) {
      return c.json({ error: "value_taken" }, 409);
    }
    const msg = err instanceof Error ? err.message : String(err);
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
  "evccid",
] as const;
type ValidKind = (typeof VALID_KINDS)[number];

function isValidKind(k: string): k is ValidKind {
  return (VALID_KINDS as readonly string[]).includes(k);
}
