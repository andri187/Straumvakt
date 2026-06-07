// Host-portal driver-invite repository (ADR 0028) — the host↔driver INVITE
// loop. A host_admin invites a driver (by email) into one of their org's
// DriverGroups; the driver later redeems the invite to acquire a
// DriverGroupMembership (the ACCESS spine, ADR 0019/0020).
//
// Tenant-scoped: every function takes orgId first and validates that the
// target DriverGroup belongs to that org (DriverGroup.ownerOrgId === orgId)
// before minting or listing — this is the cross-tenant guard rail that
// stops a host_admin for org A from inviting into org B's group.
//
// Token model (ADR 0028 §1): one UserToken with kind='driver'. It carries
//   • driverGroupId  — the access grant the invite confers (FK column)
//   • userId         — the (placeholder/existing) driver User the redemption
//                      will attach access to. Found-or-created by email at
//                      invite time, audience='driver' (mirrors the operator
//                      invite repo's find-or-create). Kennitala is captured
//                      at redemption (ADR 0028 §4), not here.
//   • metadata.email — the invitee email (for the host's pending list)
//   • metadata.orgId — the inviting org (defence-in-depth: list filters on it
//                      in addition to the driverGroup→ownerOrg join)
//   • expiresAt      — TTL from ttlHours
//   • maxRedemptions — 1 (single-use); the schema default. ADR 0028 §3 open
//                      question 3 leaves multi-use to a later milestone.
//   • security       — 'none' for the code/email path this milestone ships;
//                      password_key / allow_term (QR) are ADR 0028 §3 future.
//
// billObjectId (the BILLING spine, ADR 0029 §5) is intentionally left null:
// per §5 it is nullable and a null at redemption lands the driver in the
// host's "Unattributed" bill-object. This milestone wires ACCESS only;
// billing-home assignment is deferred (the safety-valve path).

import type { PrismaClient } from "../generated/prisma/client";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";

// ─── Output shapes ───────────────────────────────────────────────────────────

export interface HostDriverGroup {
  id: string;
  displayName: string;
  agreementStatus: string;
  installationDisplayName: string | null;
}

export interface HostDriverInvite {
  tokenId: string;
  email: string;
  driverGroupId: string;
  driverGroupDisplayName: string;
  status: "pending" | "used" | "expired";
  createdAt: string; // ISO-8601
  expiresAt: string; // ISO-8601
  usedAt: string | null;
}

export interface CreateDriverInviteResult {
  /** Shareable code/token plaintext — returned ONCE, never persisted. */
  token: string;
  expiresAt: string;
  /** Relative deep link for the consume surface. */
  inviteUrl: string;
  tokenId: string;
  driverGroupId: string;
  driverGroupDisplayName: string;
  email: string;
}

export type CreateDriverInviteOutcome =
  | { ok: true; invite: CreateDriverInviteResult }
  | {
      ok: false;
      reason:
        | "driver_group_not_found"
        | "driver_group_wrong_org"
        | "invalid_ttl";
    };

// ─── Token generation ────────────────────────────────────────────────────────
//
// Crockford-style alphabet (no l/o/0/1) so a printed/SMS'd code transcribes
// cleanly. 24 chars × 5 bits ≈ 120 bits entropy. The plaintext is the
// shareable "code" (ADR 0028 §2); only its sha256 hash is persisted.

const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function generateInviteCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += TOKEN_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

// ─── listOrgDriverGroups ──────────────────────────────────────────────────────

/**
 * The org's DriverGroups (the ones it owns), with the parent Agreement's
 * status + installation name so the host can pick which group to invite into.
 * Tenant-scoped by ownerOrgId === orgId.
 */
export async function listOrgDriverGroups(
  db: PrismaClient,
  orgId: string,
): Promise<HostDriverGroup[]> {
  const rows = await db.driverGroup.findMany({
    where: { ownerOrgId: orgId },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      agreement: {
        select: {
          status: true,
          installation: { select: { displayName: true } },
        },
      },
    },
  });
  return rows.map((g) => ({
    id: g.id,
    displayName: g.displayName,
    agreementStatus: g.agreement.status,
    installationDisplayName: g.agreement.installation?.displayName ?? null,
  }));
}

// ─── createDriverInvite ───────────────────────────────────────────────────────

export interface CreateDriverInviteInput {
  orgId: string;
  driverGroupId: string;
  email: string;
  invitedByUserId: string;
  ttlHours: number;
}

/**
 * Mint a driver invite (UserToken kind='driver') bound to a DriverGroup the
 * org owns. Validates ownership BEFORE minting (cross-tenant guard). Find-or-
 * creates the invitee User by email as audience='driver' so the token has a
 * concrete userId to attach access to at redemption; the user is NOT yet a
 * member of any group — that write happens only on redemption.
 */
export async function createDriverInvite(
  db: PrismaClient,
  input: CreateDriverInviteInput,
): Promise<CreateDriverInviteOutcome> {
  if (!Number.isFinite(input.ttlHours) || input.ttlHours <= 0) {
    return { ok: false, reason: "invalid_ttl" };
  }

  // Guard: group must exist AND belong to this org. Done before the tx so a
  // cross-tenant attempt never even opens a transaction.
  const group = await db.driverGroup.findUnique({
    where: { id: input.driverGroupId },
    select: { id: true, ownerOrgId: true, displayName: true },
  });
  if (!group) return { ok: false, reason: "driver_group_not_found" };
  if (group.ownerOrgId !== input.orgId) {
    return { ok: false, reason: "driver_group_wrong_org" };
  }

  const email = input.email.trim().toLowerCase();
  const code = generateInviteCode();
  const tokenHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + input.ttlHours * 60 * 60 * 1000);

  const tokenId = await db.$transaction(async (tx) => {
    // Find-or-create the invitee driver User (audience='driver'). Email is
    // Citext + lowercased so case variants don't fork rows. If the user
    // already exists as a driver we reuse them; the redemption captures
    // kennitala (ADR 0028 §4).
    let user = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      user = await tx.user.create({
        data: { email, audience: "driver", status: "active" },
        select: { id: true },
      });
    }

    const token = await tx.userToken.create({
      data: {
        userId: user.id,
        kind: "driver",
        tokenHash,
        expiresAt,
        createdById: input.invitedByUserId,
        driverGroupId: input.driverGroupId,
        // billObjectId stays null → "Unattributed" fallback at redemption
        // (ADR 0028 §5); security defaults to 'none'; maxRedemptions defaults
        // to single-use via the schema default (left null here = 1 in app
        // semantics for the code path).
        maxRedemptions: 1,
        metadata: {
          orgId: input.orgId,
          driverGroupId: input.driverGroupId,
          email,
        },
      },
      select: { id: true },
    });

    await recordAuditAction(tx, {
      orgId: input.orgId,
      actorUserId: input.invitedByUserId,
      actorKind: "user",
      action: "driver_invite.created",
      targetType: "user_token",
      targetId: token.id,
      metadata: {
        email,
        driverGroupId: input.driverGroupId,
        driverGroupDisplayName: group.displayName,
        ttlHours: input.ttlHours,
      },
    });

    return token.id;
  });

  return {
    ok: true,
    invite: {
      token: code,
      expiresAt: expiresAt.toISOString(),
      inviteUrl: `/invite/${code}`,
      tokenId,
      driverGroupId: input.driverGroupId,
      driverGroupDisplayName: group.displayName,
      email,
    },
  };
}

// ─── listOrgDriverInvites ─────────────────────────────────────────────────────

/**
 * Driver invites for the org's groups — pending + recently used, newest
 * first. Tenant-scoped two ways: the driverGroup join filters on
 * ownerOrgId === orgId AND metadata.orgId is re-checked as defence in depth.
 */
export async function listOrgDriverInvites(
  db: PrismaClient,
  orgId: string,
): Promise<HostDriverInvite[]> {
  const rows = await db.userToken.findMany({
    where: {
      kind: "driver",
      driverGroup: { ownerOrgId: orgId },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      driverGroupId: true,
      usedAt: true,
      expiresAt: true,
      createdAt: true,
      metadata: true,
      driverGroup: { select: { displayName: true } },
    },
  });

  const now = Date.now();
  return rows
    .map((r): HostDriverInvite | null => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      // Defence-in-depth: the join already constrained to this org's groups,
      // but if metadata.orgId is present and disagrees, drop the row.
      if (typeof meta.orgId === "string" && meta.orgId !== orgId) return null;
      const status: HostDriverInvite["status"] =
        r.usedAt !== null
          ? "used"
          : r.expiresAt.getTime() <= now
            ? "expired"
            : "pending";
      return {
        tokenId: r.id,
        email: typeof meta.email === "string" ? meta.email : "",
        driverGroupId: r.driverGroupId ?? "",
        driverGroupDisplayName: r.driverGroup?.displayName ?? "(óþekktur hópur)",
        status,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        usedAt: r.usedAt ? r.usedAt.toISOString() : null,
      };
    })
    .filter((r): r is HostDriverInvite => r !== null);
}
