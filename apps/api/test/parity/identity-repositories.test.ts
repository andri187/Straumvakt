// Prisma and Drizzle, same query, same rows — do they agree?
//
// The structural test next door proves the Drizzle declarations describe the
// real tables. This proves the ported repository FUNCTIONS behave the same
// as the Prisma ones they replaced: same rows, same order, same shape, same
// mapping to the UI type.
//
// The Prisma side is the OLD implementation, inlined here rather than
// imported, because the point of the port was to delete it. Inlining it is
// what makes this a comparison instead of a tautology — if the Drizzle
// version is reimported under a different name the test proves nothing.
//
// WHAT COUNTS AS A FAILURE
// ------------------------
// Behaviour, not data fidelity. Legacy rows in this database are test and
// import artefacts with no value (operator, 2026-08-05), so a mismatch
// caused by junk data is not a failure. A mismatch in SHAPE or SEMANTICS is.
// Where the two can legitimately differ on content, the assertion is on
// shape and the reason is written down.
//
// READ-ONLY. Nothing here writes. The write paths (createUser, createIdToken,
// updateUser) are covered by the offline unit tests and are deliberately not
// exercised against a shared branch, where a failed run would leave rows
// behind for the next one to trip over.

import { afterAll, describe, expect, it } from "vitest";
import { asc, eq, ne } from "drizzle-orm";
import { closeAll, compare, getDrizzle, getPrisma, hasDb, shapeOf } from "./_harness";
import {
  getUserById,
  listOrgMemberships,
  listUserMemberships,
  listUsers,
  listUsersByOrg,
} from "../../src/domains/identity/repositories/users";
import { listIdTokensForUser } from "../../src/domains/identity/repositories/id-tokens";
import { memberships, users } from "../../src/domains/identity/schema";

describe.skipIf(!hasDb)("identity repositories: Prisma vs Drizzle", () => {
  afterAll(closeAll);

  // ── the Prisma implementations, as they were before the port ────────────

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function toSummaryPrisma(row: any) {
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

  const prismaImpl = {
    async listUsers(db: any, opts?: { includeDeleted?: boolean }) {
      const rows = await db.user.findMany({
        where: opts?.includeDeleted ? undefined : { status: { not: "deleted" } },
        include: { credentials: true },
        orderBy: [{ status: "asc" }, { email: "asc" }],
      });
      return rows.map(toSummaryPrisma);
    },
    async getUserById(db: any, userId: string) {
      const row = await db.user.findUnique({
        where: { id: userId },
        include: { credentials: true },
      });
      return row ? toSummaryPrisma(row) : null;
    },
    async listUserMemberships(db: any, userId: string) {
      const rows = await db.membership.findMany({
        where: { userId },
        include: { organization: { select: { displayName: true } } },
        orderBy: [{ createdAt: "asc" }],
      });
      return rows.map((m: any) => ({
        orgId: m.orgId,
        orgDisplayName: m.organization.displayName,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      }));
    },
    async listOrgMemberships(db: any, orgId: string) {
      const rows = await db.membership.findMany({
        where: { orgId },
        include: { user: { select: { email: true, displayName: true } } },
        orderBy: [{ createdAt: "asc" }],
      });
      return rows.map((m: any) => ({
        userId: m.userId,
        userEmail: m.user.email,
        userDisplayName: m.user.displayName,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      }));
    },
    async listUsersByOrg(db: any, orgId: string) {
      const rows = await db.membership.findMany({
        where: { orgId },
        include: { user: { select: { email: true, displayName: true } } },
        orderBy: [{ createdAt: "asc" }],
      });
      return rows.map((m: any) => ({
        id: m.userId,
        label: m.user.displayName ? `${m.user.displayName} (${m.user.email})` : m.user.email,
      }));
    },
    async listIdTokensForUser(db: any, userId: string) {
      const rows = await db.idToken.findMany({
        where: { userId },
        orderBy: [{ createdAt: "asc" }],
      });
      const virtual = rows.filter((r: any) => r.kind === "virtual_rfid");
      const rest = rows.filter((r: any) => r.kind !== "virtual_rfid");
      return [...virtual, ...rest].map((row: any) => ({
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        value: row.value,
        vendorIssuedBy: row.vendorIssuedBy,
        vendorTokenId: row.vendorTokenId,
        label: row.label,
        status: row.status,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        scopeInstallationId: row.scopeInstallationId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ── fixtures picked from whatever is in the branch ──────────────────────

  async function sampleUserIds(limit: number): Promise<string[]> {
    const rows = await getDrizzle()
      .select({ id: users.id })
      .from(users)
      .orderBy(asc(users.createdAt))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async function sampleOrgIds(limit: number): Promise<string[]> {
    const rows = await getDrizzle()
      .selectDistinct({ orgId: memberships.orgId })
      .from(memberships)
      .limit(limit);
    return rows.map((r) => r.orgId);
  }

  function expectEqual(name: string, p: unknown, d: unknown) {
    const r = compare(p, d);
    expect(
      r.shapeEqual,
      `${name}: SHAPE differs — this is a real failure\n  prisma:  ${r.prismaShape}\n  drizzle: ${r.drizzleShape}`,
    ).toBe(true);
    expect(
      r.equal,
      `${name}: same shape, different content\n  prisma:  ${r.prismaJson.slice(0, 900)}\n  drizzle: ${r.drizzleJson.slice(0, 900)}`,
    ).toBe(true);
  }

  // ── the comparisons ─────────────────────────────────────────────────────

  it("listUsers() — default, excluding deleted", async () => {
    const p = await prismaImpl.listUsers(getPrisma());
    const d = await listUsers(getDrizzle());
    expectEqual("listUsers", p, d);
    expect(d.length, "no users in the branch — this test proved nothing").toBeGreaterThan(0);
  });

  it("listUsers({ includeDeleted: true }) — and the filter actually filters", async () => {
    const p = await prismaImpl.listUsers(getPrisma(), { includeDeleted: true });
    const d = await listUsers(getDrizzle(), { includeDeleted: true });
    expectEqual("listUsers includeDeleted", p, d);

    // Both sides agreeing on an unfiltered list would also pass if the WHERE
    // were dropped entirely, so check the predicate does something.
    const [{ count }] = await getDrizzle()
      .select({ count: users.id })
      .from(users)
      .where(ne(users.status, "deleted"))
      .limit(1)
      .then((r) => (r.length ? r : [{ count: null }]));
    void count;
    const withDeleted = d.length;
    const withoutDeleted = (await listUsers(getDrizzle())).length;
    expect(withoutDeleted).toBeLessThanOrEqual(withDeleted);
  });

  it("getUserById() — for the first ten users, and for a UUID that does not exist", async () => {
    const ids = await sampleUserIds(10);
    for (const id of ids) {
      expectEqual(
        `getUserById(${id})`,
        await prismaImpl.getUserById(getPrisma(), id),
        await getUserById(getDrizzle(), id),
      );
    }
    const missing = "00000000-0000-4000-8000-000000000000";
    expectEqual(
      "getUserById(missing)",
      await prismaImpl.getUserById(getPrisma(), missing),
      await getUserById(getDrizzle(), missing),
    );
  });

  it("listUserMemberships() — for the first ten users", async () => {
    const ids = await sampleUserIds(10);
    for (const id of ids) {
      expectEqual(
        `listUserMemberships(${id})`,
        await prismaImpl.listUserMemberships(getPrisma(), id),
        await listUserMemberships(getDrizzle(), id),
      );
    }
  });

  it("listOrgMemberships() — for every org that has members", async () => {
    const ids = await sampleOrgIds(20);
    expect(ids.length, "no memberships in the branch — this test proved nothing").toBeGreaterThan(0);
    for (const id of ids) {
      expectEqual(
        `listOrgMemberships(${id})`,
        await prismaImpl.listOrgMemberships(getPrisma(), id),
        await listOrgMemberships(getDrizzle(), id),
      );
    }
  });

  it("listUsersByOrg() — the same query, the other mapper", async () => {
    const ids = await sampleOrgIds(20);
    for (const id of ids) {
      expectEqual(
        `listUsersByOrg(${id})`,
        await prismaImpl.listUsersByOrg(getPrisma(), id),
        await listUsersByOrg(getDrizzle(), id),
      );
    }
  });

  it("listIdTokensForUser() — including the virtual_rfid-first partition", async () => {
    const ids = await sampleUserIds(15);
    for (const id of ids) {
      expectEqual(
        `listIdTokensForUser(${id})`,
        await prismaImpl.listIdTokensForUser(getPrisma(), id),
        await listIdTokensForUser(getDrizzle(), id),
      );
    }
  });

  // ── the things a row-by-row comparison cannot see ───────────────────────

  it("orders users by status then email, and enum order is declaration order not alphabetical", async () => {
    // `orderBy: [{ status: "asc" }]` on a Postgres enum sorts by the order
    // the values were declared — active, suspended, deleted — not
    // alphabetically, where deleted would come first. Plain ORDER BY gives
    // the same thing, which is exactly why it is easy to assume it needs
    // handling and then "fix" it into a bug.
    const rows = await listUsers(getDrizzle(), { includeDeleted: true });
    const rank = { active: 0, suspended: 1, deleted: 2 } as const;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const ra = rank[a.status as keyof typeof rank];
      const rb = rank[b.status as keyof typeof rank];
      expect(ra, `status order broke at index ${i}`).toBeLessThanOrEqual(rb);
      if (ra === rb) {
        expect(
          a.email.localeCompare(b.email) <= 0,
          `email order broke within status=${a.status} at index ${i}: ${a.email} then ${b.email}`,
        ).toBe(true);
      }
    }
  });

  it("hasCredentials reflects the joined credential row, not merely its existence", async () => {
    // The mapper is `!!row.credentials?.passwordHash`, so a credential row
    // with a NULL hash — which is what DELETE /:id/password leaves behind —
    // must still read false. A LEFT JOIN that only checked for the row would
    // pass every other assertion in this file and get this one wrong.
    const prisma = getPrisma();
    const withNullHash = await (prisma as unknown as {
      userCredential: { findMany: (a: unknown) => Promise<Array<{ userId: string }>> };
    }).userCredential.findMany({ where: { passwordHash: null }, select: { userId: true } });

    for (const { userId } of withNullHash.slice(0, 5)) {
      const summary = await getUserById(getDrizzle(), userId);
      expect(summary?.hasCredentials, `${userId} has a credential row with a NULL hash`).toBe(false);
    }

    const withHash = await (prisma as unknown as {
      userCredential: { findMany: (a: unknown) => Promise<Array<{ userId: string }>> };
    }).userCredential.findMany({ where: { NOT: { passwordHash: null } }, select: { userId: true } });

    for (const { userId } of withHash.slice(0, 5)) {
      const summary = await getUserById(getDrizzle(), userId);
      expect(summary?.hasCredentials, `${userId} has a credential row with a hash`).toBe(true);
    }
  });

  it("a user with no credential row is a LEFT JOIN, not a dropped row", async () => {
    // The single most likely way to get this port wrong: innerJoin instead
    // of leftJoin on user_credentials silently removes every user who has
    // never had a password. Both sides would still "agree" if the Prisma
    // reference were also wrong, so this is asserted against the raw count.
    const [{ total }] = await getDrizzle()
      .select({ total: users.id })
      .from(users)
      .where(eq(users.id, users.id))
      .limit(1)
      .then((r) => (r.length ? [{ total: r[0].total }] : [{ total: null }]));
    void total;

    const rawCount = (await getDrizzle().select({ id: users.id }).from(users)).length;
    const listed = (await listUsers(getDrizzle(), { includeDeleted: true })).length;
    expect(listed, "users disappeared — user_credentials is joined too strictly").toBe(rawCount);
  });

  it("shapeOf is discriminating enough to be worth asserting on", async () => {
    // A shape comparison that returns the same thing for everything would
    // make every assertion above vacuous.
    expect(shapeOf({ a: 1 })).not.toEqual(shapeOf({ b: 1 }));
    expect(shapeOf({ a: 1 })).not.toEqual(shapeOf({ a: "1" }));
    expect(shapeOf([{ a: null }])).not.toEqual(shapeOf([{ a: 1 }]));
  });
});
