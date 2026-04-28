/**
 * Users repository — `identity.users` + `identity.user_credentials`.
 *
 * Like `organizations.ts`, this is platform-admin only — Users can hold
 * memberships across multiple Orgs, so they sit *above* the tenant
 * boundary. Per-org membership lookups go through `memberships.ts`
 * instead.
 *
 * Pilot rules per ADR 0006:
 *   • Drivers are admin-created inert records — no password, no login.
 *   • Staff (owner/admin/operator/...) also have no login during pilot
 *     (admin-session is env-var driven). Real auth is post-pilot.
 *
 * The `password` argument is preserved for post-pilot use; today it's
 * always undefined and `user_credentials` rows stay null.
 */
import type { UserStatus } from "straumvakt-prisma-cf-client/client";
import { prisma } from "@/lib/prisma";
import {
  UserCreateInput,
  UserUpdateInput,
} from "@/lib/repositories/_inputs/users";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserMembershipSummary {
  orgId: string;
  orgSlug: string;
  orgDisplayName: string;
  role: string;
  createdAt: string;
}

function toSummary(row: {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  credentials: { passwordHash: string | null } | null;
}): UserSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    hasCredentials: !!row.credentials?.passwordHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUsers(opts?: {
  includeDeleted?: boolean;
}): Promise<UserSummary[]> {
  const db = prisma();
  const rows = await db.user.findMany({
    where: opts?.includeDeleted ? undefined : { status: { not: "deleted" } },
    include: { credentials: true },
    orderBy: [{ status: "asc" }, { email: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getUserById(userId: string): Promise<UserSummary | null> {
  const db = prisma();
  const row = await db.user.findUnique({
    where: { id: userId },
    include: { credentials: true },
  });
  return row ? toSummary(row) : null;
}

export async function listUserMemberships(
  userId: string,
): Promise<UserMembershipSummary[]> {
  const db = prisma();
  const rows = await db.membership.findMany({
    where: { userId },
    include: {
      organization: { select: { slug: true, displayName: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map((m) => ({
    orgId: m.orgId,
    orgSlug: m.organization.slug,
    orgDisplayName: m.organization.displayName,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function createUser(input: UserCreateInput): Promise<UserSummary> {
  const db = prisma();
  // Password handling deferred to post-pilot — schema supports it but
  // pilot doesn't use it. When real auth lands, hash with Argon2 here
  // and write a UserCredential row in the same transaction.
  const created = await db.user.create({
    data: {
      email: input.email.toLowerCase(),
      displayName: input.displayName ?? null,
    },
    include: { credentials: true },
  });
  return toSummary(created);
}

export async function updateUser(
  userId: string,
  patch: UserUpdateInput,
): Promise<UserSummary> {
  const db = prisma();
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      displayName: patch.displayName,
      status: patch.status,
    },
    include: { credentials: true },
  });
  return toSummary(updated);
}

export async function softDeleteUser(userId: string): Promise<UserSummary> {
  const db = prisma();
  const updated = await db.user.update({
    where: { id: userId },
    data: { status: "deleted" },
    include: { credentials: true },
  });
  return toSummary(updated);
}
