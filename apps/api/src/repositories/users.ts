import type { PrismaClient } from "../generated/prisma/client";
import type {
  MembershipRole,
  OrgMembershipSummary,
  UserMembershipSummary,
  UserStatus,
  UserSummary,
} from "@straumvakt/shared/domain/users";
import type { UserCreateInput, UserUpdateInput } from "@straumvakt/shared/inputs/users";

type Row = {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  kennitala: string | null;
  phone: string | null;
  locale: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  credentials: { passwordHash: string | null } | null;
};

function toSummary(row: Row): UserSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    kennitala: row.kennitala,
    phone: row.phone,
    locale: row.locale,
    notes: row.notes,
    hasCredentials: !!row.credentials?.passwordHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUsers(
  db: PrismaClient,
  opts?: { includeDeleted?: boolean },
): Promise<UserSummary[]> {
  const rows = await db.user.findMany({
    where: opts?.includeDeleted ? undefined : { status: { not: "deleted" } },
    include: { credentials: true },
    orderBy: [{ status: "asc" }, { email: "asc" }],
  });
  return rows.map(toSummary);
}

export async function getUserById(
  db: PrismaClient,
  userId: string,
): Promise<UserSummary | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    include: { credentials: true },
  });
  return row ? toSummary(row) : null;
}

export async function listUserMemberships(
  db: PrismaClient,
  userId: string,
): Promise<UserMembershipSummary[]> {
  const rows = await db.membership.findMany({
    where: { userId },
    include: { organization: { select: { slug: true, displayName: true } } },
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

export async function listOrgMemberships(
  db: PrismaClient,
  orgId: string,
): Promise<OrgMembershipSummary[]> {
  const rows = await db.membership.findMany({
    where: { orgId },
    include: { user: { select: { email: true, displayName: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map((m) => ({
    userId: m.userId,
    userEmail: m.user.email,
    userDisplayName: m.user.displayName,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function listUsersByOrg(
  db: PrismaClient,
  orgId: string,
): Promise<{ id: string; label: string }[]> {
  const rows = await db.membership.findMany({
    where: { orgId },
    include: { user: { select: { email: true, displayName: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map((m) => ({
    id: m.userId,
    label: m.user.displayName ? `${m.user.displayName} (${m.user.email})` : m.user.email,
  }));
}

export async function createUser(
  db: PrismaClient,
  input: UserCreateInput,
): Promise<UserSummary> {
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
  db: PrismaClient,
  userId: string,
  patch: UserUpdateInput,
): Promise<UserSummary> {
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      email: patch.email?.toLowerCase(),
      displayName: patch.displayName,
      status: patch.status,
      kennitala: patch.kennitala,
      phone: patch.phone,
      locale: patch.locale,
      notes: patch.notes,
    },
    include: { credentials: true },
  });
  return toSummary(updated);
}

export async function addMembership(
  db: PrismaClient,
  orgId: string,
  userId: string,
  role: MembershipRole,
): Promise<{ orgId: string; userId: string; role: MembershipRole }> {
  const m = await db.membership.create({ data: { orgId, userId, role } });
  return { orgId: m.orgId, userId: m.userId, role: m.role };
}

export async function updateMembership(
  db: PrismaClient,
  orgId: string,
  userId: string,
  role: MembershipRole,
): Promise<{ orgId: string; userId: string; role: MembershipRole }> {
  const m = await db.membership.update({
    where: { orgId_userId: { orgId, userId } },
    data: { role },
  });
  return { orgId: m.orgId, userId: m.userId, role: m.role };
}

export async function removeMembership(
  db: PrismaClient,
  orgId: string,
  userId: string,
): Promise<void> {
  await db.membership.delete({ where: { orgId_userId: { orgId, userId } } });
}
