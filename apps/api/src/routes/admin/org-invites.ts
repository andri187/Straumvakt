// Admin invite routes — operator creates / lists / revokes
// agent invites for an org. Sprint 5 / ADR 0017 milestone 5.7.
//
// Mounted at /api/admin/orgs/:orgId/invites in src/index.ts.
//
// Routes:
//   POST   /api/admin/orgs/:orgId/invites      — create
//   GET    /api/admin/orgs/:orgId/invites      — list outstanding
//   DELETE /api/admin/orgs/:orgId/invites/:tokenId — revoke
//
// Plaintext invite token is returned ONCE on create. The recipient's
// link is built UI-side (`{baseUrl}/invite/{plaintext}`) — this
// route returns just the plaintext + expiry. Audit rows go to the
// org orgId; actorUserId is the bootstrap admin's User row (Sprint 5.5).

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { requirePermission } from "../../lib/auth/require-permission";
import {
  createInvite,
  listInvitesForOrg,
  revokeInvite,
  INVITE_ROLES,
  type InviteRole,
} from "../../repositories/invites";
import type { Env } from "../../bindings";

export const adminOrgInvites = new Hono<{ Bindings: Env; Variables: AuthVars }>();
adminOrgInvites.use("*", requireAdmin);

const InviteCreateBody = z.object({
  email: z.string().email().max(200),
  role: z.enum(INVITE_ROLES as [InviteRole, ...InviteRole[]]),
  ttlHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30) // 30 days max
    .optional(),
  scopeSiteIds: z.array(z.string().uuid()).optional(),
  scopePropertyIds: z.array(z.string().uuid()).optional(),
});

adminOrgInvites.post(
  "/:orgId/invites",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = InviteCreateBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation", issues: parsed.error.issues }, 400);
    }
    const session = c.var.session;
    if (!session.userId) {
      // Bootstrap admin's userId is set on every fresh login post-5.5.
      // A missing one means an old cookie pre-5.5 — force re-login so
      // we can record a real inviter.
      return c.json({ error: "session_missing_userid_relogin_required" }, 401);
    }
    const db = makePrisma(c.env);
    const result = await createInvite(db, {
      orgId: c.req.param("orgId"),
      email: parsed.data.email,
      role: parsed.data.role,
      ttlHours: parsed.data.ttlHours ?? 72,
      invitedByUserId: session.userId,
      scopeSiteIds: parsed.data.scopeSiteIds,
      scopePropertyIds: parsed.data.scopePropertyIds,
    });
    if (!result.ok) {
      const status = result.reason === "org_not_found" ? 404 : 409;
      return c.json({ error: result.reason }, status);
    }
    return c.json(
      {
        invite: {
          tokenId: result.tokenId,
          tokenPlaintext: result.tokenPlaintext,
          expiresAt: result.expiresAt.toISOString(),
          userId: result.userId,
          isNewUser: result.isNewUser,
        },
      },
      201,
    );
  },
);

adminOrgInvites.get(
  "/:orgId/invites",
  requirePermission("platform.tenant.read"),
  async (c) => {
    const db = makePrisma(c.env);
    const invites = await listInvitesForOrg(db, c.req.param("orgId"));
    return c.json({
      invites: invites.map((i) => ({
        tokenId: i.tokenId,
        userId: i.userId,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
        invitedById: i.invitedById,
        scopeSiteIds: i.scopeSiteIds,
        scopePropertyIds: i.scopePropertyIds,
      })),
    });
  },
);

adminOrgInvites.delete(
  "/:orgId/invites/:tokenId",
  requirePermission("platform.tenant.write"),
  async (c) => {
    const session = c.var.session;
    if (!session.userId) {
      return c.json({ error: "session_missing_userid_relogin_required" }, 401);
    }
    const db = makePrisma(c.env);
    const result = await revokeInvite(
      db,
      c.req.param("tokenId"),
      session.userId,
    );
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      return c.json({ error: result.reason }, status);
    }
    return c.json({ ok: true });
  },
);
