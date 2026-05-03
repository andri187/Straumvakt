// Public invite endpoints — recipient side of the agent invite
// flow (Sprint 5 / ADR 0017 milestone 5.8).
//
// These routes are NOT gated by the admin session cookie. They're
// gated by the invite token itself — possession of an unexpired
// unused invite token is the only authorisation required.
//
// Routes:
//   GET  /api/public/invites/peek?token=<plaintext>    — read-only context
//   POST /api/public/invites/consume                    — accept + set password
//
// Peek: returns { orgId, orgDisplayName, role, email, expiresAt }
// for a valid token, 404 otherwise. The recipient page calls this
// to render "Accept role X at org Y" before showing the form.
//
// Consume: body { token, password }. Verifies the token (kind=invite,
// not expired, not used), upserts UserCredential.passwordHash with
// PBKDF2, flips Membership(orgId, userId) to status='active', sets
// acceptedAt. All in one tx so a partial failure rolls back. Audit
// row written to the org as actor 'user' with the recipient as the
// acting userId.
//
// Returns the resolved email so the recipient page can redirect to
// /login?email=<...> with the email pre-filled.

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { sha256Hex } from "../../lib/sha256";
import { hashPassword } from "../../lib/password";
import { recordAuditAction } from "../../lib/audit";
import type { Env } from "../../bindings";

export const publicInvites = new Hono<{ Bindings: Env }>();

const ConsumeBody = z.object({
  token: z.string().min(8).max(256),
  password: z.string().min(8).max(128),
});

publicInvites.get("/peek", async (c) => {
  const token = c.req.query("token");
  if (!token || token.length === 0) {
    return c.json({ error: "token_required" }, 400);
  }
  const tokenHash = await sha256Hex(token);
  const db = makePrisma(c.env);
  const row = await db.userToken.findUnique({
    where: { tokenHash },
    select: {
      kind: true,
      usedAt: true,
      expiresAt: true,
      metadata: true,
    },
  });
  if (!row || row.kind !== "invite") {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.usedAt !== null) return c.json({ error: "already_used" }, 410);
  if (row.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: "expired" }, 410);
  }
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const orgId = typeof meta.orgId === "string" ? meta.orgId : null;
  const role = typeof meta.role === "string" ? meta.role : null;
  const email = typeof meta.email === "string" ? meta.email : null;
  if (!orgId || !role || !email) {
    return c.json({ error: "malformed_metadata" }, 500);
  }
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { displayName: true },
  });
  return c.json({
    invite: {
      orgId,
      orgDisplayName: org?.displayName ?? "(unknown org)",
      role,
      email,
      expiresAt: row.expiresAt.toISOString(),
    },
  });
});

publicInvites.post("/consume", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = ConsumeBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { token, password } = parsed.data;
  const tokenHash = await sha256Hex(token);
  const db = makePrisma(c.env);

  // The "find row + claim row + flip membership + write credential
  // + audit" sequence runs in one tx. Token claim uses a conditional
  // updateMany so concurrent consumers race deterministically.
  const result = await db.$transaction(async (tx) => {
    const row = await tx.userToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        kind: true,
        usedAt: true,
        expiresAt: true,
        metadata: true,
      },
    });
    if (!row || row.kind !== "invite") {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (row.usedAt !== null) {
      return { ok: false as const, reason: "already_used" as const };
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return { ok: false as const, reason: "expired" as const };
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const orgId = typeof meta.orgId === "string" ? meta.orgId : null;
    const email = typeof meta.email === "string" ? meta.email : null;
    if (!orgId || !email) {
      return { ok: false as const, reason: "malformed_metadata" as const };
    }

    // Conditional claim — concurrent consumers race; loser sees
    // count=0 and reports already_used.
    const claimed = await tx.userToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { ok: false as const, reason: "already_used" as const };
    }

    // Hash + persist password. Upsert in case the user already had
    // a credential row from a prior reset (unusual for an invite
    // flow, but defensive).
    const passwordHash = await hashPassword(password);
    await tx.userCredential.upsert({
      where: { userId: row.userId },
      create: { userId: row.userId, passwordHash },
      update: { passwordHash },
    });

    // Flip Membership 'invited' → 'active'.
    await tx.membership.updateMany({
      where: { orgId, userId: row.userId, status: "invited" },
      data: { status: "active", acceptedAt: new Date() },
    });

    // Bump User.emailVerifiedAt — accepting via the invite link IS
    // the email verification (it was sent to that address).
    await tx.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: new Date() },
    });

    await recordAuditAction(tx, {
      orgId,
      actorUserId: row.userId,
      actorKind: "user",
      action: "membership.invite_accepted",
      targetType: "user",
      targetId: row.userId,
      metadata: { tokenId: row.id },
    });

    return {
      ok: true as const,
      userId: row.userId,
      orgId,
      email,
    };
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 410;
    return c.json({ error: result.reason }, status);
  }
  return c.json({
    ok: true,
    userId: result.userId,
    orgId: result.orgId,
    email: result.email,
  });
});
