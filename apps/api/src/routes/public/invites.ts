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

/**
 * Refusal reason → HTTP status. Exhaustive by construction: adding a
 * reason to the transaction's return union without adding it here is a
 * type error, which is the point.
 *
 * `already_claimed` is 409, matching the driver path
 * (routes/public/driver.ts:1090) so the two invite routes stop
 * disagreeing about the same condition. `malformed_metadata` is 400
 * rather than 410 — the token is not gone, its stored metadata is
 * unusable.
 */
const REFUSAL_STATUS = {
  not_found: 404,
  already_claimed: 409,
  already_used: 410,
  expired: 410,
  malformed_metadata: 400,
} as const satisfies Record<string, 400 | 404 | 409 | 410>;

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

    // ── S2 guard. Runs BEFORE the claim, deliberately. ───────────────
    //
    // This route is authorised by possession of the token alone. Without
    // this check, `upsert`'s update branch let a bearer of an unused
    // invite token overwrite the password of a user who already had one.
    // That is reachable through ordinary business: createInvite
    // (repositories/invites.ts:94-106) resolves an EXISTING user by email
    // and only refuses when membership in THAT org is already active, so
    // inviting a current customer into a second organisation mints a
    // token bound to their existing userId.
    //
    // Ordering matters as much as the check. Placed after the claim, a
    // refusal would still have burned the invite and locked the real
    // invitee out — the deadlock ADR 0053 fixed on the driver path.
    //
    // Test the COLUMN, not the row: password_hash is nullable
    // (packages/shared/src/db/identity.ts:215) and
    // clearUserPasswordHash (domains/identity/repositories/users.ts:381)
    // nulls it while keeping the row. A row-existence guard — which is
    // what driver.ts:1089 does — would permanently lock out any account
    // an admin deliberately cleared.
    const existingCredential = await tx.userCredential.findUnique({
      where: { userId: row.userId },
      select: { passwordHash: true },
    });
    if (
      existingCredential?.passwordHash !== null &&
      existingCredential?.passwordHash !== undefined
    ) {
      return { ok: false as const, reason: "already_claimed" as const };
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

    // Still an upsert, and that is not the pre-S2 behaviour returning by
    // the back door: the guard above has already established there is no
    // password to overwrite. `create` alone would raise a unique
    // violation on the cleared-password row the guard deliberately lets
    // through, turning an admin-initiated reset into a 500.
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
    // Was `reason === "not_found" ? 404 : 410`, which collapsed every
    // other refusal — including malformed metadata, a server-side data
    // fault — into "gone". Doc 18D annotated this as "was 500"; the 500
    // is in /peek at :69, not here.
    const status = REFUSAL_STATUS[result.reason];
    return c.json({ error: result.reason }, status);
  }
  return c.json({
    ok: true,
    userId: result.userId,
    orgId: result.orgId,
    email: result.email,
  });
});
