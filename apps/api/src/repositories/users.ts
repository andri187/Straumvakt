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
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  photoUrl: string | null;
  address: unknown;
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
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    // Date column → yyyy-mm-dd ISO date (no time portion).
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    photoUrl: row.photoUrl,
    address: row.address,
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
    include: { organization: { select: { displayName: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map((m) => ({
    orgId: m.orgId,
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
  // Build the update object explicitly so undefined keys are omitted
  // (Prisma treats present-undefined as "set to undefined" for some
  // column types, which we do not want).
  const data: Record<string, unknown> = {};
  if (patch.email !== undefined) data.email = patch.email.toLowerCase();
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.kennitala !== undefined) data.kennitala = patch.kennitala;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.locale !== undefined) data.locale = patch.locale;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.firstName !== undefined) data.firstName = patch.firstName;
  if (patch.middleName !== undefined) data.middleName = patch.middleName;
  if (patch.lastName !== undefined) data.lastName = patch.lastName;
  if (patch.dateOfBirth !== undefined) {
    // Empty string → null; ISO date → Date(yyyy-mm-dd).
    data.dateOfBirth = patch.dateOfBirth ? new Date(patch.dateOfBirth) : null;
  }
  if (patch.photoUrl !== undefined) data.photoUrl = patch.photoUrl;
  if (patch.address !== undefined) data.address = patch.address;

  const updated = await db.user.update({
    where: { id: userId },
    data,
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
