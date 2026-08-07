// POST/GET /:orgId/driver-group-memberships — guard logic, against the real DB.
//
// ── WHY THIS MOVED HERE 2026-08-07 ──────────────────────────────────────
//
// Lived at src/routes/admin/driver-group-memberships.test.ts and drove the
// route through a hand-rolled fake PrismaClient. The route ported to
// Drizzle and all 7 cases broke — the fake still applied, it just stopped
// intercepting. Third instance of the same pattern this session.
//
// Unlike charging-stations.test.ts, this route does its OWN queries (the
// DriverGroup and User guards), so mocking the repository is not enough.
// Instead `makeDrizzle` is mocked to hand back a real transaction that is
// rolled back afterwards — the route runs its actual SQL, and the FKs from
// driver_group_memberships to both driver_groups and users are exercised
// rather than assumed.
//
// It reuses the driver group already on the branch instead of seeding one:
// driver_groups.agreement_id is a NOT NULL FK, so seeding would mean
// standing up an org and an agreement just to test a 404.
//
// EVERY CASE ROLLS BACK.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, getDrizzle, hasDb } from "./_harness";
import { driverGroups } from "@straumvakt/shared/db/commercial";
import { users } from "@straumvakt/shared/db/identity";

const ROLLBACK = Symbol("rollback");

/** The transaction the mocked makeDrizzle hands to the route. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeTx: any = null;

vi.mock("../../src/lib/drizzle", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, makeDrizzle: () => activeTx };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionOverride: any | null = null;
vi.mock("../../src/lib/admin-session", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (await importOriginal()) as any;
  return {
    ...real,
    verifyAdminSession: async () =>
      sessionOverride ?? { sub: "admin", iat: Math.floor(Date.now() / 1000) },
    adminSessionConfig: real.adminSessionConfig ?? { SESSION_COOKIE_NAME: "sv_session" },
  };
});

let effectivePerms: string[] = ["member.write"];
vi.mock("../../src/lib/auth/effective-permissions", () => ({
  resolveEffectivePermissions: async () => effectivePerms,
}));

const { adminDriverGroupMemberships } = await import(
  "../../src/routes/admin/driver-group-memberships"
);

const MISSING_GROUP = "33333333-3333-4333-8333-333333333333";
const MISSING_USER = "44444444-4444-4444-8444-444444444444";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callCreate(orgId: string, body: unknown, env: any = { AUTH_SECRET: "test" }) {
  return adminDriverGroupMemberships.fetch(
    new Request(`http://test/${orgId}/driver-group-memberships`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "straumvakt_admin_session=fake" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

/** Run one case inside a transaction that always rolls back. */
async function inRollback(fn: () => Promise<void>): Promise<void> {
  try {
    await getDrizzle().transaction(async (tx) => {
      activeTx = tx;
      await fn();
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  } finally {
    activeTx = null;
  }
}

let GROUP_ID = "";
let ORG_ID = "";

describe.skipIf(!hasDb)("driver-group-memberships route (real DB, rolled back)", () => {
  afterAll(closeAll);

  beforeAll(async () => {
    const [g] = await getDrizzle()
      .select({ id: driverGroups.id, ownerOrgId: driverGroups.ownerOrgId })
      .from(driverGroups)
      .limit(1);
    if (!g) throw new Error("no driver_groups row on this branch — cannot run");
    GROUP_ID = g.id;
    ORG_ID = g.ownerOrgId;
  });

  beforeEach(() => {
    sessionOverride = null;
    effectivePerms = ["member.write"];
  });

  /** A fresh driver, inside the current transaction. Rolled back with it. */
  async function makeDriver(
    overrides: Partial<{ audience: string; status: string }> = {},
  ): Promise<string> {
    const [u] = await activeTx
      .insert(users)
      .values({
        email: `parity-dgm-${Math.floor(performance.now() * 1e6)}@straumvakt.invalid`,
        displayName: "Parity driver",
        audience: overrides.audience ?? "driver",
        status: overrides.status ?? "active",
      })
      .returning({ id: users.id });
    return u.id as string;
  }

  it("creates a new membership and returns 201 with created:true", async () => {
    await inRollback(async () => {
      const userId = await makeDriver();
      const res = await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { created: boolean; membership: { userId: string } };
      expect(body.created).toBe(true);
      expect(body.membership.userId).toBe(userId);
    });
  });

  it("returns 200 with created:false on a duplicate call (idempotent)", async () => {
    await inRollback(async () => {
      const userId = await makeDriver();
      await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId });
      const res = await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { created: boolean }).created).toBe(false);
    });
  });

  it("returns 403 when DriverGroup.ownerOrgId does not match URL orgId", async () => {
    await inRollback(async () => {
      const userId = await makeDriver();
      const res = await callCreate(OTHER_ORG, { driverGroupId: GROUP_ID, userId });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("forbidden");
    });
  });

  it("returns 404 when driverGroup does not exist", async () => {
    await inRollback(async () => {
      const userId = await makeDriver();
      const res = await callCreate(ORG_ID, { driverGroupId: MISSING_GROUP, userId });
      expect(res.status).toBe(404);
    });
  });

  it("returns 404 when user does not exist", async () => {
    await inRollback(async () => {
      const res = await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId: MISSING_USER });
      expect(res.status).toBe(404);
    });
  });

  it("returns 422 when user audience is operator", async () => {
    await inRollback(async () => {
      const userId = await makeDriver({ audience: "operator" });
      const res = await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId });
      expect(res.status).toBe(422);
    });
  });

  it("returns 422 when user status is suspended", async () => {
    await inRollback(async () => {
      const userId = await makeDriver({ status: "suspended" });
      const res = await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId });
      expect(res.status).toBe(422);
    });
  });

  it("returns 403 when the caller lacks member.write", async () => {
    await inRollback(async () => {
      effectivePerms = [];
      sessionOverride = { sub: "user", userId: MISSING_USER, iat: Math.floor(Date.now() / 1000) };
      const userId = await makeDriver();
      const res = await callCreate(ORG_ID, { driverGroupId: GROUP_ID, userId });
      expect(res.status).toBe(403);
    });
  });

  it("rejects a malformed body with 400 before touching the database", async () => {
    await inRollback(async () => {
      const res = await callCreate(ORG_ID, { driverGroupId: "not-a-uuid", userId: MISSING_USER });
      expect(res.status).toBe(400);
    });
  });
});
