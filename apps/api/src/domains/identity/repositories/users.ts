// Users and memberships — identity.users, identity.user_credentials,
// tenancy.memberships, tenancy.organizations. Drizzle.
//
// Moved from src/repositories/users.ts and ported from Prisma in the same
// commit. Every function keeps its name, signature shape and return type;
// the only change to a caller is which client it passes.
//
// Behaviour differences that had to be handled rather than inherited:
//
//   Prisma's `include: { credentials: true }` is a LEFT JOIN on
//   identity.user_credentials, written out below. The mapper only ever read
//   `passwordHash`, so only that column is selected.
//
//   Prisma raised P2002/P2025 and callers matched on
//   `err.message.includes("Unique constraint")` — a string node-postgres
//   never produces. Those two conditions now raise UniqueViolationError and
//   RecordNotFoundError from ./errors; the HTTP results are unchanged.
//
//   `orderBy: [{ status: "asc" }]` on an enum column sorts by the enum's
//   declaration order in Postgres, not alphabetically. Plain `ORDER BY
//   status ASC` gives the same order, so it is preserved by doing nothing —
//   noted because it looks like it should need handling.

import { and, asc, eq, ne } from "drizzle-orm";
import type {
  IdTokenSummary,
  MembershipRole,
  OrgMembershipSummary,
  UserAudience,
  UserMembershipSummary,
  UserStatus,
  UserSummary,
} from "@straumvakt/shared/domain/users";
import type { UserCreateInput, UserUpdateInput } from "@straumvakt/shared/inputs/users";
import type { Db } from "../../../lib/drizzle";
import { memberships, organizations, userCredentials, users } from "@straumvakt/shared/db/identity";
import { createIdToken } from "./id-tokens";
import { RecordNotFoundError, UniqueViolationError, isUniqueViolation } from "./errors";

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
  passwordHash: string | null;
};

/** The user columns the summary needs, plus the one credential column it
 *  reads. Prisma selected every column of both tables; this selects 26. */
const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  status: users.status,
  audience: users.audience,
  kennitala: users.kennitala,
  phone: users.phone,
  locale: users.locale,
  timezone: users.timezone,
  notes: users.notes,
  firstName: users.firstName,
  middleName: users.middleName,
  lastName: users.lastName,
  dateOfBirth: users.dateOfBirth,
  photoUrl: users.photoUrl,
  address: users.address,
  emailVerifiedAt: users.emailVerifiedAt,
  phoneVerifiedAt: users.phoneVerifiedAt,
  lastSeenAt: users.lastSeenAt,
  consentTosAt: users.consentTosAt,
  consentPrivacyAt: users.consentPrivacyAt,
  consentMarketingAt: users.consentMarketingAt,
  metadata: users.metadata,
  deletedAt: users.deletedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  passwordHash: userCredentials.passwordHash,
} as const;

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
    hasCredentials: !!row.passwordHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listUsers(
  db: Db,
  opts?: { includeDeleted?: boolean },
): Promise<UserSummary[]> {
  // `status: { not: "deleted" }`. `ne` is safe here only because status is
  // NOT NULL — `<> 'deleted'` would drop NULL rows, and there are none.
  const rows = await db
    .select(USER_COLUMNS)
    .from(users)
    .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(opts?.includeDeleted ? undefined : ne(users.status, "deleted"))
    .orderBy(asc(users.status), asc(users.email));

  return (rows as Row[]).map(toSummary);
}

export async function getUserById(db: Db, userId: string): Promise<UserSummary | null> {
  const [row] = await db
    .select(USER_COLUMNS)
    .from(users)
    .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row ? toSummary(row as Row) : null;
}

export async function listUserMemberships(
  db: Db,
  userId: string,
): Promise<UserMembershipSummary[]> {
  const rows = await db
    .select({
      orgId: memberships.orgId,
      orgDisplayName: organizations.displayName,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));

  return rows.map((m) => ({
    orgId: m.orgId,
    orgDisplayName: m.orgDisplayName,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function listOrgMemberships(
  db: Db,
  orgId: string,
): Promise<OrgMembershipSummary[]> {
  const rows = await orgMembershipRows(db, orgId);
  return rows.map((m) => ({
    userId: m.userId,
    userEmail: m.userEmail,
    userDisplayName: m.userDisplayName,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function listUsersByOrg(
  db: Db,
  orgId: string,
): Promise<{ id: string; label: string }[]> {
  const rows = await orgMembershipRows(db, orgId);
  return rows.map((m) => ({
    id: m.userId,
    label: m.userDisplayName ? `${m.userDisplayName} (${m.userEmail})` : m.userEmail,
  }));
}

/** listOrgMemberships and listUsersByOrg ran the identical Prisma query and
 *  differed only in the mapper. Kept as one query so they cannot drift. */
function orgMembershipRows(db: Db, orgId: string) {
  return db
    .select({
      userId: memberships.userId,
      userEmail: users.email,
      userDisplayName: users.displayName,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.createdAt));
}

/**
 * Create a user and auto-mint one primary RFID IdToken in the same
 * transaction. Per the 2026-05-02 conversation: every new user gets a
 * Straumvakt-generated UID up-front; operators can add more tokens
 * (manual or auto-minted) from the user detail page.
 *
 * The primary token's value is shown in the create-user response so
 * the operator can program a physical card with that UID. RFID UIDs
 * are not secrets — anyone with NFC-read access to the card can read
 * them — so we surface the value plainly without one-time-display
 * ceremony. Future kinds (app_jwt, magic_link) WILL need redaction;
 * the surface for those is separate.
 */
export async function createUser(
  db: Db,
  input: UserCreateInput,
): Promise<{ user: UserSummary; primaryToken: IdTokenSummary }> {
  const values = {
    email: input.email.toLowerCase(),
    displayName: input.displayName ?? null,
    audience: input.audience,
    ...(input.firstName ? { firstName: input.firstName } : {}),
    ...(input.middleName ? { middleName: input.middleName } : {}),
    ...(input.lastName ? { lastName: input.lastName } : {}),
    ...(input.kennitala ? { kennitala: input.kennitala } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.dateOfBirth ? { dateOfBirth: new Date(input.dateOfBirth) } : {}),
    ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
    ...(input.address ? { address: input.address } : {}),
  };

  return db.transaction(async (tx) => {
    let created;
    try {
      [created] = await tx.insert(users).values(values).returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new UniqueViolationError(err.constraint, err);
      throw err;
    }

    // A brand-new user cannot have credentials, so the LEFT JOIN that
    // getUserById does would always yield null here. Stated rather than
    // queried for.
    const summary = toSummary({ ...(created as Omit<Row, "passwordHash">), passwordHash: null });
    const primaryToken = await createIdToken(tx, {
      userId: summary.id,
      kind: "rfid",
      label: "Primary",
    });
    return { user: summary, primaryToken };
  });
}

export async function updateUser(
  db: Db,
  userId: string,
  patch: UserUpdateInput,
): Promise<UserSummary> {
  // Built explicitly so undefined keys are omitted rather than written as
  // NULL. Drizzle ignores undefined in `.set()`, but relying on that would
  // make the intent depend on the ORM rather than on this code.
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
    data.emailVerifiedAt = patch.emailVerifiedAt ? new Date(patch.emailVerifiedAt) : null;
  }
  if (patch.phoneVerifiedAt !== undefined) {
    data.phoneVerifiedAt = patch.phoneVerifiedAt ? new Date(patch.phoneVerifiedAt) : null;
  }
  if (patch.consentTosAt !== undefined) {
    data.consentTosAt = patch.consentTosAt ? new Date(patch.consentTosAt) : null;
  }
  if (patch.consentPrivacyAt !== undefined) {
    data.consentPrivacyAt = patch.consentPrivacyAt ? new Date(patch.consentPrivacyAt) : null;
  }
  if (patch.consentMarketingAt !== undefined) {
    data.consentMarketingAt = patch.consentMarketingAt
      ? new Date(patch.consentMarketingAt)
      : null;
  }
  if (patch.metadata !== undefined) data.metadata = patch.metadata;

  let updated;
  try {
    [updated] = await db.update(users).set(data).where(eq(users.id, userId)).returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new UniqueViolationError(err.constraint, err);
    throw err;
  }
  // Prisma raised P2025 here, which the route did not catch — a PATCH
  // against a missing user was a 500. Preserved as a 500, with a message
  // that says which row.
  if (!updated) throw new RecordNotFoundError(`user ${userId}`);

  // UPDATE … RETURNING cannot reach the joined credential row, so
  // hasCredentials needs its own read. Prisma issued a second query for
  // this too.
  const [cred] = await db
    .select({ passwordHash: userCredentials.passwordHash })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);

  return toSummary({
    ...(updated as Omit<Row, "passwordHash">),
    passwordHash: cred?.passwordHash ?? null,
  });
}

// ── credentials ──────────────────────────────────────────────────────────
//
// The admin password routes reached into `db.user` and `db.userCredential`
// directly, against Rule 7. Moving those routes into this domain was the
// moment to give them a repository rather than carry the violation across.

export async function userExists(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(row);
}

/** Set or rotate a user's password hash. Upsert — a user with no credential
 *  row yet gets one. Admin-side reset; no current-password challenge, and
 *  existing sessions are not invalidated. */
export async function setUserPasswordHash(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .insert(userCredentials)
    .values({ userId, passwordHash })
    .onConflictDoUpdate({ target: userCredentials.userId, set: { passwordHash } });
}

/** Clear a user's password. Idempotent — a user with no credential row is
 *  already in the desired state, which is why this does not raise. */
export async function clearUserPasswordHash(db: Db, userId: string): Promise<void> {
  await db
    .update(userCredentials)
    .set({ passwordHash: null })
    .where(eq(userCredentials.userId, userId));
}

export async function addMembership(
  db: Db,
  orgId: string,
  userId: string,
  role: MembershipRole,
): Promise<{ orgId: string; userId: string; role: MembershipRole }> {
  try {
    const [m] = await db.insert(memberships).values({ orgId, userId, role }).returning({
      orgId: memberships.orgId,
      userId: memberships.userId,
      role: memberships.role,
    });
    return m;
  } catch (err) {
    if (isUniqueViolation(err)) throw new UniqueViolationError(err.constraint, err);
    throw err;
  }
}

export async function updateMembership(
  db: Db,
  orgId: string,
  userId: string,
  role: MembershipRole,
): Promise<{ orgId: string; userId: string; role: MembershipRole }> {
  const [m] = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .returning({
      orgId: memberships.orgId,
      userId: memberships.userId,
      role: memberships.role,
    });
  if (!m) throw new RecordNotFoundError(`membership ${orgId}/${userId}`);
  return m;
}

export async function removeMembership(db: Db, orgId: string, userId: string): Promise<void> {
  const deleted = await db
    .delete(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .returning({ orgId: memberships.orgId });
  if (deleted.length === 0) throw new RecordNotFoundError(`membership ${orgId}/${userId}`);
}
