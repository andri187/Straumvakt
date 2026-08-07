// Invite repository — operator-side half of the agent invite flow
// (Sprint 5 / ADR 0017 milestone 5.7).
//
// Three operations + a list:
//
//   • createInvite — admin clicks "Invite agent" with an email +
//     role + (optional) site/property scope. We:
//       1. Find or create the User row for that email (audience=
//          operator). Idempotent — if they already exist we reuse.
//       2. Find or create the Membership row in status='invited'.
//          If a Membership already exists with status='active' we
//          refuse — that's already-a-member, not-an-invite.
//          If it exists with status='invited', we revoke any
//          outstanding token and mint a fresh one (lets the admin
//          re-send a new link without a stale one floating).
//       3. Mint a UserToken kind='invite' carrying the orgId, role,
//          and scope arrays in metadata.
//       4. Return plaintext + expiresAt + computed invite URL.
//
//   • listInvitesForOrg — outstanding invites (kind='invite',
//     metadata.orgId match, not used, not expired). Backs the
//     org-detail invites panel.
//
//   • revokeInvite — operator cancels. Two effects:
//       - UserToken.usedAt = now() (token can't consume).
//       - Membership.status = 'revoked' (the user can't be
//         re-invited under a stale Membership row).
//     Both writes in one tx.

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { memberships, organizations, users, userTokens } from "@straumvakt/shared/db/identity";
import type { Db } from "../lib/drizzle";
import { recordAuditAction } from "../lib/audit";
import { createUserToken, revokeUserToken } from "./user-tokens";

export type InviteRole =
  | "manager"
  | "technician"
  | "finance"
  | "support"
  | "viewer"
  // ADR 0027 — going-public host-admin invite (tenancy-scoped host
  // self-management; HOST_ADMIN_BUNDLE permissions).
  | "host_admin";

export const INVITE_ROLES: InviteRole[] = [
  "manager",
  "technician",
  "finance",
  "support",
  "viewer",
  "host_admin",
];

export interface CreateInviteInput {
  orgId: string;
  email: string;
  role: InviteRole;
  ttlHours: number;
  invitedByUserId: string;
  /** Optional scope narrowing — empty arrays mean full-org access. */
  scopeSiteIds?: string[];
  scopePropertyIds?: string[];
}

export type CreateInviteOutcome =
  | {
      ok: true;
      tokenId: string;
      tokenPlaintext: string;
      expiresAt: Date;
      userId: string;
      isNewUser: boolean;
    }
  | { ok: false; reason: "already_active_member" | "org_not_found" };

export async function createInvite(
  db: Db,
  input: CreateInviteInput,
): Promise<CreateInviteOutcome> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
    .limit(1);
  if (!org) return { ok: false, reason: "org_not_found" };

  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    // 1. Resolve or create the User. Email is Citext + lowercase
    //    normalised at the call site so case variations don't fork
    //    User rows.
    let [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    let isNewUser = false;
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email, audience: "operator", status: "active" })
        .returning({ id: users.id });
      isNewUser = true;
    }

    // 2. Membership lookup. (orgId, userId) is the @@id, so at most
    //    one row per pair. Fork on its current status:
    //      • undefined  → create with status='invited'
    //      • 'invited'  → re-use; revoke any outstanding token first
    //                     so old links die when a new invite goes out
    //      • 'active'   → refuse (already-a-member)
    //      • 'suspended', 'revoked' → flip back to 'invited'
    // (org_id, user_id) is the composite primary key, so this matches at
    // most one row — the same guarantee Prisma's orgId_userId gave.
    const [membership] = await tx
      .select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, user!.id)))
      .limit(1);

    if (membership?.status === "active") {
      return {
        ok: false as const,
        reason: "already_active_member" as const,
      };
    }

    const now = new Date();
    if (!membership) {
      await tx.insert(memberships).values({
        orgId: input.orgId,
        userId: user!.id,
        role: input.role,
        status: "invited",
        invitedById: input.invitedByUserId,
        invitedAt: now,
        scopeSiteIds: input.scopeSiteIds ?? [],
        scopePropertyIds: input.scopePropertyIds ?? [],
      });
    } else {
      // Re-invite path: bump role / scope / inviter to the latest
      // values + flip status back to 'invited'.
      await tx
        .update(memberships)
        .set({
          role: input.role,
          status: "invited",
          invitedById: input.invitedByUserId,
          invitedAt: now,
          acceptedAt: null,
          suspendedAt: null,
          revokedAt: null,
          scopeSiteIds: input.scopeSiteIds ?? [],
          scopePropertyIds: input.scopePropertyIds ?? [],
        })
        .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, user!.id)));

      // Revoke any outstanding invite tokens for this user+org so
      // an old link the recipient might still have stops working.
      // Tokens for OTHER orgs are untouched.
      const stale = await tx
        .select({ id: userTokens.id, metadata: userTokens.metadata })
        .from(userTokens)
        .where(
          and(
            eq(userTokens.userId, user!.id),
            eq(userTokens.kind, "invite"),
            isNull(userTokens.usedAt),
            gt(userTokens.expiresAt, now),
          ),
        );
      for (const t of stale) {
        const meta = (t.metadata ?? {}) as { orgId?: unknown };
        if (meta.orgId === input.orgId) {
          await tx.update(userTokens).set({ usedAt: now }).where(eq(userTokens.id, t.id));
        }
      }
    }

    // 3. Mint the fresh token.
    const tokenResult = await createUserToken(tx, {
      userId: user!.id,
      kind: "invite",
      ttlMinutes: input.ttlHours * 60,
      createdById: input.invitedByUserId,
      metadata: {
        orgId: input.orgId,
        role: input.role,
        scopeSiteIds: input.scopeSiteIds ?? [],
        scopePropertyIds: input.scopePropertyIds ?? [],
        email,
      },
    });

    // 4. Audit row.
    await recordAuditAction(tx, {
      orgId: input.orgId,
      actorUserId: input.invitedByUserId,
      actorKind: "user",
      action: "membership.invite_created",
      targetType: "user",
      targetId: user!.id,
      metadata: {
        email,
        role: input.role,
        tokenId: tokenResult.id,
        ttlHours: input.ttlHours,
        isNewUser,
      },
    });

    return {
      ok: true as const,
      tokenId: tokenResult.id,
      tokenPlaintext: tokenResult.plaintext,
      expiresAt: tokenResult.expiresAt,
      userId: user!.id,
      isNewUser,
    };
  });
}

export interface InviteListItem {
  tokenId: string;
  userId: string;
  email: string;
  role: InviteRole;
  expiresAt: Date;
  createdAt: Date;
  invitedById: string | null;
  scopeSiteIds: string[];
  scopePropertyIds: string[];
}

export async function listInvitesForOrg(
  db: Db,
  orgId: string,
): Promise<InviteListItem[]> {
  // The org filter is applied in JS below, not in SQL, because it lives in
  // the token's JSONB metadata. Unchanged from the Prisma version.
  const rows = await db
    .select({
      id: userTokens.id,
      userId: userTokens.userId,
      expiresAt: userTokens.expiresAt,
      createdAt: userTokens.createdAt,
      createdById: userTokens.createdById,
      metadata: userTokens.metadata,
    })
    .from(userTokens)
    .where(
      and(
        eq(userTokens.kind, "invite"),
        isNull(userTokens.usedAt),
        gt(userTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(userTokens.createdAt));
  return rows
    .map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      if (meta.orgId !== orgId) return null;
      return {
        tokenId: r.id,
        userId: r.userId,
        email: typeof meta.email === "string" ? meta.email : "",
        role: meta.role as InviteRole,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        invitedById: r.createdById,
        scopeSiteIds: Array.isArray(meta.scopeSiteIds)
          ? (meta.scopeSiteIds as string[])
          : [],
        scopePropertyIds: Array.isArray(meta.scopePropertyIds)
          ? (meta.scopePropertyIds as string[])
          : [],
      };
    })
    .filter((r): r is InviteListItem => r !== null);
}

export type RevokeInviteOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_consumed" };

export async function revokeInvite(
  db: Db,
  tokenId: string,
  actorUserId: string,
): Promise<RevokeInviteOutcome> {
  const [token] = await db
    .select({
      id: userTokens.id,
      kind: userTokens.kind,
      userId: userTokens.userId,
      usedAt: userTokens.usedAt,
      metadata: userTokens.metadata,
    })
    .from(userTokens)
    .where(eq(userTokens.id, tokenId))
    .limit(1);
  if (!token || token.kind !== "invite") return { ok: false, reason: "not_found" };
  if (token.usedAt !== null) {
    // Already consumed = recipient already accepted. We don't
    // un-do that here. Operator should suspend the Membership
    // through a separate flow if they want to revoke access.
    return { ok: false, reason: "already_consumed" };
  }

  const meta = (token.metadata ?? {}) as { orgId?: unknown };
  const orgId = typeof meta.orgId === "string" ? meta.orgId : null;

  await db.transaction(async (tx) => {
    await revokeUserToken(tx as unknown as Db, tokenId);
    if (orgId) {
      // Flip Membership.status to revoked so the operator can
      // re-invite later under a fresh row without dragging stale
      // 'invited' state.
      await tx
        .update(memberships)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(memberships.orgId, orgId),
            eq(memberships.userId, token.userId),
            eq(memberships.status, "invited"),
          ),
        );
      await recordAuditAction(tx, {
        orgId,
        actorUserId,
        actorKind: "user",
        action: "membership.invite_revoked",
        targetType: "user",
        targetId: token.userId,
        metadata: { tokenId },
      });
    }
  });

  return { ok: true };
}
