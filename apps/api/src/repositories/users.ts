import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type {
  MembershipRole,
  OrgMembershipSummary,
  UserAudience,
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
  audience: UserAudience;
  kennitala: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  notes: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  photoUrl: string | null;
  address: unknown;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  lastSeenAt: Date | null;
  consentTosAt: Date | null;
  consentPrivacyAt: Date | null;
  consentMarketingAt: Date | null;
  metadata: unknown;
  deletedAt: Date | null;
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
    audience: row.audience,
    kennitala: row.kennitala,
    phone: row.phone,
    locale: row.locale,
    timezone: row.timezone,
    notes: row.notes,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    photoUrl: row.photoUrl,
    address: row.address,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: row.phoneVerifiedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    consentTosAt: row.consentTosAt?.toISOString() ?? null,
    consentPrivacyAt: row.consentPrivacyAt?.toISOString() ?? null,
    consentMarketingAt: row.consentMarketingAt?.toISOString() ?? null,
    metadata: row.metadata,
    deletedAt: row.deletedAt?.toISOString() ?? null,
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
      audience: input.audience,
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
  if (patch.audience !== undefined) data.audience = patch.audience;
  if (patch.timezone !== undefined) data.timezone = patch.timezone;
  if (patch.emailVerifiedAt !== undefined) {
    data.emailVerifiedAt = patch.emailVerifiedAt
      ? new Date(patch.emailVerifiedAt)
      : null;
  }
  if (patch.phoneVerifiedAt !== undefined) {
    data.phoneVerifiedAt = patch.phoneVerifiedAt
      ? new Date(patch.phoneVerifiedAt)
      : null;
  }
  if (patch.consentTosAt !== undefined) {
    data.consentTosAt = patch.consentTosAt
      ? new Date(patch.consentTosAt)
      : null;
  }
  if (patch.consentPrivacyAt !== undefined) {
    data.consentPrivacyAt = patch.consentPrivacyAt
      ? new Date(patch.consentPrivacyAt)
      : null;
  }
  if (patch.consentMarketingAt !== undefined) {
    data.consentMarketingAt = patch.consentMarketingAt
      ? new Date(patch.consentMarketingAt)
      : null;
  }
  if (patch.metadata !== undefined) {
    data.metadata = patch.metadata as Prisma.InputJsonValue;
  }

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
