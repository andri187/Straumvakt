// Bootstrap-admin → real User row resolver (Sprint 5 / ADR 0017
// milestone 5.5).
//
// The admin login path historically minted a static HMAC session
// (`sub: "admin"`, `email: <whatever ADMIN_EMAIL is>`) with no
// `User` row backing it. Every audit/invite/ownership column wrote
// `actorUserId: null` because there was no User to point at.
//
// This module fixes that by performing a one-time idempotent
// upsert on every successful admin login:
//
//   1. Find (or create) a User row keyed by the login email.
//   2. Find (or create) a PlatformGrant row keyed by user.id with
//      role='super_user'.
//   3. Return the resolved user.id so the session can carry it.
//
// Called from POST /api/admin/login. Free to be called on every
// login because both steps are idempotent — the find-first
// short-circuits the create-second.
//
// Email-as-key gotcha: if the operator changes `ADMIN_EMAIL` later,
// a NEW User + PlatformGrant pair is provisioned for the new email.
// The old User stays in place with its audit history intact (we
// don't soft-delete on this path). Operationally fine — the old
// one becomes a read-only relic of the prior ADMIN_EMAIL, the new
// one starts collecting audit rows.

import type { PrismaClient } from "../generated/prisma/client";

export interface BootstrapResult {
  userId: string;
  email: string;
  audience: "operator";
  /** True if this call inserted a new User row, false if found existing. */
  createdUser: boolean;
  /** True if this call inserted a new PlatformGrant row. */
  createdGrant: boolean;
}

/**
 * Idempotent provisioning of the bootstrap admin User + PlatformGrant.
 * Safe to call on every login.
 */
export async function bootstrapAdminUser(
  db: PrismaClient,
  rawEmail: string,
): Promise<BootstrapResult> {
  // Citext + lowercase normalisation for stability — the User.email
  // column is Citext so a comparison is case-insensitive at the DB
  // level, but we lowercase here too so a re-import or client-side
  // lookup hits the same row.
  const email = rawEmail.trim();

  // Step 1: User row.
  let user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, audience: true },
  });
  let createdUser = false;
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        displayName: "Bootstrap admin",
        audience: "operator",
        status: "active",
      },
      select: { id: true, email: true, audience: true },
    });
    createdUser = true;
  }

  // Step 2: PlatformGrant row keyed by user.id (@id, so one per user).
  // We use `role: super_user` because bootstrap admin should be able
  // to mint other platform grants — the platform_admin role can't.
  let createdGrant = false;
  const grant = await db.platformGrant.findUnique({
    where: { userId: user.id },
    select: { userId: true, role: true, status: true },
  });
  if (!grant) {
    await db.platformGrant.create({
      data: {
        userId: user.id,
        role: "super_user",
        status: "active",
        // grantedById is self-referential here (no granter exists yet);
        // store null since the FK is nullable. Audit log + this row's
        // grantedAt timestamp are the trail.
        grantedById: null,
      },
    });
    createdGrant = true;
  }

  return {
    userId: user.id,
    email: user.email,
    audience: "operator",
    createdUser,
    createdGrant,
  };
}
