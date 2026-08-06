// IdToken admin routes (system-wide actions).
//
// Listing and adding tokens lives under /api/admin/users/:id/tokens
// in users.ts — that surface is per-user. Revoke and lookup-by-id sit
// here because IdToken values are unique system-wide and the operator
// path doesn't need to repeat the userId.
//
// DELETE /api/admin/tokens/:tokenId  → revoke (soft; status='revoked')
// GET    /api/admin/tokens/:tokenId  → fetch one row by id

import { Hono } from "hono";
import { makeDrizzle } from "../../../lib/drizzle";
import { requireAdmin, type AuthVars } from "../../../lib/auth-middleware";
import { requirePermission } from "../../../lib/auth/require-permission";
import {
  backfillPrimaryRfidForUsersWithoutTokens,
  getIdTokenById,
  hardDeleteIdToken,
  revokeIdToken,
  updateIdToken,
} from "../repositories/id-tokens";
import {
  RecordNotFoundError,
  UniqueViolationError,
  isForeignKeyViolation,
} from "../repositories/errors";
import type { Env } from "../../../bindings";

export const adminIdTokens = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminIdTokens.use("*", requireAdmin);

// ── One-shot backfill — pre-existing users get a primary RFID ────────
//
// POST /api/admin/tokens/backfill
//
// Touches every user row → platform-staff only.
// Idempotent: only mints for users with zero IdToken rows.

adminIdTokens.post(
  "/backfill",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const db = makeDrizzle(c.env);
    const report = await backfillPrimaryRfidForUsersWithoutTokens(db);
    return c.json(report);
  },
);

adminIdTokens.get(
  "/:tokenId",
  requirePermission("member.read"),
  async (c) => {
    const db = makeDrizzle(c.env);
    const token = await getIdTokenById(db, c.req.param("tokenId"));
    if (!token) return c.json({ error: "not_found" }, 404);
    return c.json({ token });
  },
);

adminIdTokens.delete(
  "/:tokenId",
  requirePermission("member.write"),
  async (c) => {
    const db = makeDrizzle(c.env);
    try {
      const token = await revokeIdToken(db, c.req.param("tokenId"));
      return c.json({ token });
    } catch (err) {
      if (err instanceof RecordNotFoundError) {
        return c.json({ error: "not_found" }, 404);
      }
      throw err;
    }
  },
);

// ── Hard delete — physically remove the row, lose audit history ──────
//
// DELETE /api/admin/tokens/:tokenId/permanent
//
// Distinct from the soft-revoke above. Returns 409 Conflict if the row
// is still referenced by a session/audit FK so the operator gets a
// clear "revoke instead" instead of an opaque 500.

adminIdTokens.delete(
  "/:tokenId/permanent",
  requirePermission("member.write"),
  async (c) => {
    const db = makeDrizzle(c.env);
    try {
      await hardDeleteIdToken(db, c.req.param("tokenId"));
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof RecordNotFoundError) {
        return c.json({ error: "not_found" }, 404);
      }
      // SQLSTATE 23503 — foreign key violation, what Prisma called P2003.
      // Surface as 409 with a human-readable hint so the operator knows to
      // revoke instead.
      if (isForeignKeyViolation(err)) {
        return c.json(
          {
            error: "still_referenced",
            message:
              "This token is referenced by another record (e.g. a charge session). Revoke it instead, or remove the references first.",
          },
          409,
        );
      }
      throw err;
    }
  },
);

// ── Patch — edit the editable subset of an IdToken row ───────────────
//
// PATCH /api/admin/tokens/:tokenId
//
// Body: { value?, label?, scopeInstallationId?, expiresAt? }
// All fields optional. Pass `null` to clear (where permitted).
// Editing `value` repoints which idTag the OCPP resolver matches —
// UI displays a warning before submitting.

adminIdTokens.patch(
  "/:tokenId",
  requirePermission("member.write"),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "malformed_json" }, 400);
    }
    if (!body || typeof body !== "object") {
      return c.json({ error: "body_not_object" }, 400);
    }
    const b = body as {
      value?: unknown;
      label?: unknown;
      scopeInstallationId?: unknown;
      expiresAt?: unknown;
    };

    const patch: Parameters<typeof updateIdToken>[2] = {};
    if (b.value !== undefined) {
      if (typeof b.value !== "string") {
        return c.json({ error: "value_must_be_string" }, 400);
      }
      patch.value = b.value.toUpperCase();
    }
    if (b.label !== undefined) {
      if (b.label !== null && typeof b.label !== "string") {
        return c.json({ error: "label_must_be_string_or_null" }, 400);
      }
      patch.label = b.label as string | null;
    }
    if (b.scopeInstallationId !== undefined) {
      if (
        b.scopeInstallationId !== null &&
        typeof b.scopeInstallationId !== "string"
      ) {
        return c.json(
          { error: "scopeInstallationId_must_be_uuid_or_null" },
          400,
        );
      }
      patch.scopeInstallationId = b.scopeInstallationId as string | null;
    }
    if (b.expiresAt !== undefined) {
      if (b.expiresAt === null) {
        patch.expiresAt = null;
      } else if (typeof b.expiresAt === "string") {
        const d = new Date(b.expiresAt);
        if (Number.isNaN(d.getTime())) {
          return c.json({ error: "expiresAt_invalid_iso" }, 400);
        }
        patch.expiresAt = d;
      } else {
        return c.json({ error: "expiresAt_must_be_iso_string_or_null" }, 400);
      }
    }

    const db = makeDrizzle(c.env);
    try {
      const token = await updateIdToken(db, c.req.param("tokenId"), patch);
      return c.json({ token });
    } catch (err) {
      if (err instanceof RecordNotFoundError) {
        return c.json({ error: "not_found" }, 404);
      }
      if (err instanceof UniqueViolationError) {
        return c.json(
          {
            error: "value_conflict",
            message:
              "Another token already has this value. Token values must be globally unique.",
          },
          409,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("idtoken.value: empty string not allowed")) {
        return c.json({ error: "value_empty" }, 400);
      }
      throw err;
    }
  },
);
