// Parity for the second batch of ported repositories: family-groups,
// vehicles, vendor-user-groups, user-vendor-refs.
//
// As in identity-repositories.test.ts, the Prisma side is the OLD
// implementation inlined rather than imported — the point of the port was to
// delete it, and reimporting the new one under another name proves nothing.
//
// The interesting translation in this batch is Prisma's
// `_count: { select: { members: true } }`. Drizzle has no relational count,
// and a LEFT JOIN with GROUP BY would both change the row shape for the
// joined display columns and silently drop groups with zero members. Both
// became correlated subqueries; the fixtures include a group with two
// members, one with one, and one with none, because a single one-member
// group cannot tell a correct subquery from a constant.

import { afterAll, describe, expect, it } from "vitest";
import { compare, closeAll, getDrizzle, getPrisma, hasDb } from "./_harness";
import {
  listAllFamilyGroups,
  listFamilyGroupsByOrg,
} from "../../src/domains/identity/repositories/family-groups";
import { listVehiclesForUser } from "../../src/domains/identity/repositories/vehicles";
import { listAllVendorUserGroups } from "../../src/domains/vendor/repositories/vendor-user-groups";
import { listUserVendorRefsForUser } from "../../src/domains/vendor/repositories/user-vendor-refs";

const PARITY_ORG = "11111111-0000-4000-8000-000000000001";
const ANNA = "22222222-0000-4000-8000-000000000001";
const THORA = "22222222-0000-4000-8000-000000000003";

describe.skipIf(!hasDb)("ported repositories, batch 2: Prisma vs Drizzle", () => {
  afterAll(closeAll);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const familyInclude = {
    primaryUser: { select: { id: true, displayName: true, email: true } },
    organization: { select: { id: true, displayName: true } },
    _count: { select: { members: true } },
  } as const;

  const toFamily = (r: any) => ({
    id: r.id,
    orgId: r.orgId,
    orgDisplayName: r.organization.displayName,
    displayName: r.displayName,
    primaryUserId: r.primaryUser.id,
    primaryUserDisplayName: r.primaryUser.displayName,
    primaryUserEmail: r.primaryUser.email,
    memberCount: r._count.members,
    createdAt: r.createdAt.toISOString(),
  });

  const prismaImpl = {
    listAllFamilyGroups: async (db: any) =>
      (await db.familyGroup.findMany({ orderBy: [{ displayName: "asc" }], include: familyInclude })).map(toFamily),
    listFamilyGroupsByOrg: async (db: any, orgId: string) =>
      (await db.familyGroup.findMany({ where: { orgId }, orderBy: [{ displayName: "asc" }], include: familyInclude })).map(toFamily),
    listVehiclesForUser: async (db: any, userId: string) =>
      (await db.vehicle.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }] })).map((row: any) => ({
        id: row.id,
        userId: row.userId,
        make: row.make,
        model: row.model,
        year: row.year,
        licensePlate: row.licensePlate,
        vin: row.vin,
        batteryCapacityKwh: row.batteryCapacityKwh ? row.batteryCapacityKwh.toString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    listAllVendorUserGroups: async (db: any) =>
      (
        await db.vendorUserGroup.findMany({
          orderBy: [{ name: "asc" }],
          include: {
            installation: {
              select: { displayName: true, orgId: true, organization: { select: { displayName: true } } },
            },
            _count: { select: { memberships: true } },
          },
        })
      ).map((r: any) => ({
        id: r.id,
        vendorSlug: r.vendorSlug,
        vendorGroupId: r.vendorGroupId,
        installationId: r.installationId,
        installationDisplayName: r.installation.displayName,
        orgId: r.installation.orgId,
        orgDisplayName: r.installation.organization.displayName,
        name: r.name,
        memberCount: r._count.memberships,
        lastSyncedAt: r.lastSyncedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    listUserVendorRefsForUser: async (db: any, userId: string) =>
      (await db.userVendorRef.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }] })).map((row: any) => ({
        id: row.id,
        userId: row.userId,
        vendorSlug: row.vendorSlug,
        vendorUserId: row.vendorUserId,
        vendorEmail: row.vendorEmail,
        vendorRoleHint: row.vendorRoleHint,
        scopeInstallationId: row.scopeInstallationId,
        status: row.status,
        lastSyncedAt: row.lastSyncedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  function expectEqual(name: string, p: unknown, d: unknown) {
    const r = compare(p, d);
    expect(r.shapeEqual, `${name}: SHAPE differs\n  prisma:  ${r.prismaShape}\n  drizzle: ${r.drizzleShape}`).toBe(true);
    expect(r.equal, `${name}\n  prisma:  ${r.prismaJson.slice(0, 900)}\n  drizzle: ${r.drizzleJson.slice(0, 900)}`).toBe(true);
  }

  it("listAllFamilyGroups — including the group with zero members", async () => {
    const p = await prismaImpl.listAllFamilyGroups(getPrisma());
    const d = await listAllFamilyGroups(getDrizzle());
    expectEqual("listAllFamilyGroups", p, d);
    expect(d.length, "no family groups — this proved nothing").toBeGreaterThan(0);

    // The specific thing a GROUP BY would get wrong.
    const empty = d.find((g) => g.displayName.includes("empty"));
    expect(empty, "the zero-member group vanished — subquery became a join").toBeDefined();
    expect(empty!.memberCount).toBe(0);
    // And the counts are not all the same, so a constant would fail too.
    expect(new Set(d.map((g) => g.memberCount)).size).toBeGreaterThan(1);
  });

  it("listFamilyGroupsByOrg", async () => {
    expectEqual(
      "listFamilyGroupsByOrg",
      await prismaImpl.listFamilyGroupsByOrg(getPrisma(), PARITY_ORG),
      await listFamilyGroupsByOrg(getDrizzle(), PARITY_ORG),
    );
  });

  it("listVehiclesForUser — decimal scale is normalised the way Prisma did", async () => {
    const p = await prismaImpl.listVehiclesForUser(getPrisma(), THORA);
    const d = await listVehiclesForUser(getDrizzle(), THORA);
    expectEqual("listVehiclesForUser", p, d);

    // The fixture stores 77.40 in a numeric(6,2), so Postgres returns the
    // string "77.40". Prisma's Decimal.toString() dropped the trailing zero,
    // and that "77.4" is what clients have been receiving — so the port
    // normalises rather than silently changing the driver app's rendering.
    //
    // "77.40" is arguably the better answer, since it carries the column's
    // declared precision and Prisma was discarding information. Changing it
    // is a decision with its own reason, not a side effect of an ORM swap.
    const tesla = d.find((v) => v.make === "Tesla");
    expect(tesla?.batteryCapacityKwh, "decimal scale changed under clients").toBe("77.4");
  });

  it("listAllVendorUserGroups", async () => {
    expectEqual(
      "listAllVendorUserGroups",
      await prismaImpl.listAllVendorUserGroups(getPrisma()),
      await listAllVendorUserGroups(getDrizzle()),
    );
  });

  it("listUserVendorRefsForUser", async () => {
    expectEqual(
      "listUserVendorRefsForUser",
      await prismaImpl.listUserVendorRefsForUser(getPrisma(), ANNA),
      await listUserVendorRefsForUser(getDrizzle(), ANNA),
    );
  });
});
