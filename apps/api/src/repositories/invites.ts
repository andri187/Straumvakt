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

import type { Prisma, PrismaClient } from "../generated/prisma/client";
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
  db: PrismaClient,
  input: CreateInviteInput,
): Promise<CreateInviteOutcome> {
  const org = await db.organization.findUnique({
    where: { id: input.orgId },
    select: { id: true },
  });
  if (!org) return { ok: false, reason: "org_not_found" };

  const email = input.email.trim().toLowerCase();

  return db.$transaction(async (tx) => {
    // 1. Resolve or create the User. Email is Citext + lowercase
    //    normalised at the call site so case variations don't fork
    //    User rows.
    let user = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    let isNewUser = false;
    if (!user) {
      user = await tx.user.create({
        data: {
          email,
          audience: "operator",
          status: "active",
        },
        select: { id: true },
      });
      isNewUser = true;
    }

    // 2. Membership lookup. (orgId, userId) is the @@id, so at most
    //    one row per pair. Fork on its current status:
    //      • undefined  → create with status='invited'
    //      • 'invited'  → re-use; revoke any outstanding token first
    //                     so old links die when a new invite goes out
    //      • 'active'   → refuse (already-a-member)
    //      • 'suspended', 'revoked' → flip back to 'invited'
    const membership = await tx.membership.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: user.id } },
      select: { status: true },
    });

    if (membership?.status === "active") {
      return {
        ok: false as const,
        reason: "already_active_member" as const,
      };
    }

    const now = new Date();
    if (!membership) {
      await tx.membership.create({
        data: {
          orgId: input.orgId,
          userId: user.id,
          role: input.role,
          status: "invited",
          invitedById: input.invitedByUserId,
          invitedAt: now,
          scopeSiteIds: input.scopeSiteIds ?? [],
          scopePropertyIds: input.scopePropertyIds ?? [],
        },
      });
    } else {
      // Re-invite path: bump role / scope / inviter to the latest
      // values + flip status back to 'invited'.
      await tx.membership.update({
        where: { orgId_userId: { orgId: input.orgId, userId: user.id } },
        data: {
          role: input.role,
          status: "invited",
          invitedById: input.invitedByUserId,
          invitedAt: now,
          acceptedAt: null,
          suspendedAt: null,
          revokedAt: null,
          scopeSiteIds: input.scopeSiteIds ?? [],
          scopePropertyIds: input.scopePropertyIds ?? [],
        },
      });

      // Revoke any outstanding invite tokens for this user+org so
      // an old link the recipient might still have stops working.
      // Tokens for OTHER orgs are untouched.
      const stale = await tx.userToken.findMany({
        where: {
          userId: user.id,
          kind: "invite",
          usedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, metadata: true },
      });
      for (const t of stale) {
        const meta = (t.metadata ?? {}) as { orgId?: unknown };
        if (meta.orgId === input.orgId) {
          await tx.userToken.update({
            where: { id: t.id },
            data: { usedAt: now },
          });
        }
      }
    }

    // 3. Mint the fresh token.
    const tokenResult = await createUserToken(tx, {
      userId: user.id,
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
      targetId: user.id,
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
      userId: user.id,
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
  db: PrismaClient,
  orgId: string,
): Promise<InviteListItem[]> {
  const rows = await db.userToken.findMany({
    where: {
      kind: "invite",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      createdAt: true,
      createdById: true,
      metadata: true,
    },
  });
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
  db: PrismaClient,
  tokenId: string,
  actorUserId: string,
): Promise<RevokeInviteOutcome> {
  const token = await db.userToken.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      kind: true,
      userId: true,
      usedAt: true,
      metadata: true,
    },
  });
  if (!token || token.kind !== "invite") return { ok: false, reason: "not_found" };
  if (token.usedAt !== null) {
    // Already consumed = recipient already accepted. We don't
    // un-do that here. Operator should suspend the Membership
    // through a separate flow if they want to revoke access.
    return { ok: false, reason: "already_consumed" };
  }

  const meta = (token.metadata ?? {}) as { orgId?: unknown };
  const orgId = typeof meta.orgId === "string" ? meta.orgId : null;

  await db.$transaction(async (tx) => {
    await revokeUserToken(tx as unknown as PrismaClient, tokenId);
    if (orgId) {
      // Flip Membership.status to revoked so the operator can
      // re-invite later under a fresh row without dragging stale
      // 'invited' state.
      await tx.membership.updateMany({
        where: { orgId, userId: token.userId, status: "invited" },
        data: { status: "revoked", revokedAt: new Date() },
      });
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
