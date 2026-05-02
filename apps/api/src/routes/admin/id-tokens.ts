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
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  backfillPrimaryRfidForUsersWithoutTokens,
  getIdTokenById,
  revokeIdToken,
} from "../../repositories/id-tokens";
import type { Env } from "../../bindings";

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
    const db = makePrisma(c.env);
    const report = await backfillPrimaryRfidForUsersWithoutTokens(db);
    return c.json(report);
  },
);

adminIdTokens.get(
  "/:tokenId",
  requirePermission("member.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const token = await getIdTokenById(db, c.req.param("tokenId"));
    if (!token) return c.json({ error: "not_found" }, 404);
    return c.json({ token });
  },
);

adminIdTokens.delete(
  "/:tokenId",
  requirePermission("member.write"),
  async (c) => {
    const db = makePrisma(c.env);
    try {
      const token = await revokeIdToken(db, c.req.param("tokenId"));
      return c.json({ token });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Prisma P2025 — record to update not found.
      if (msg.includes("Record to update not found")) {
        return c.json({ error: "not_found" }, 404);
      }
      throw err;
    }
  },
);
