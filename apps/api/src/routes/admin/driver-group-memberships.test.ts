// Sprint 9 / ADR 0022 (ENROLL-4) — POST driver-group-memberships tests.
//
// Covers all 8 spec cases:
//   1. Valid userId + driverGroupId → 201, created: true
//   2. Repeat call (same pair) → 200, created: false (idempotent)
//   3. DriverGroup belongs to a different org → 403
//   4. User audience='operator' → 422
//   5. User status='suspended' → 422
//   6. User doesn't exist → 404
//   7. DriverGroup doesn't exist → 404
//   8. Missing permission → 403 (mock requirePermission)
//
// Pattern: fake PrismaClient via vi.mock("../../lib/prisma"), fake admin
// session via vi.mock("../../lib/admin-session"). Same approach as
// charging-stations.test.ts. For Case 8, effective-permissions is also
// mocked to return [] for a non-bootstrap session.

import { describe, expect, it, beforeEach, vi } from "vitest";

// ─── Fake state ──────────────────────────────────────────────────────────────

interface FakeGroup {
  id: string;
  ownerOrgId: string;
  displayName: string;
}

interface FakeUser {
  id: string;
  audience: string;
  status: string;
  email: string;
}

interface FakeMembershipRow {
  id: string;
  driverGroupId: string;
  userId: string;
  addedAt: Date;
}

interface FakeState {
  group: FakeGroup | null;
  user: FakeUser | null;
  memberships: FakeMembershipRow[];
  auditLogs: unknown[];
}

const fakeState: FakeState = {
  group: null,
  user: null,
  memberships: [],
  auditLogs: [],
};

function resetState() {
  fakeState.group = null;
  fakeState.user = null;
  fakeState.memberships = [];
  fakeState.auditLogs = [];
}

// ─── Fake PrismaClient factory ───────────────────────────────────────────────

function makeFake() {
  return {
    driverGroup: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!fakeState.group) return null;
        if (where.id !== fakeState.group.id) return null;
        return fakeState.group;
      },
    },
    user: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        if (!fakeState.user) return null;
        if (where.id !== fakeState.user.id) return null;
        return fakeState.user;
      },
    },
    driverGroupMembership: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: async ({ where }: any) => {
        const { driverGroupId, userId } = where.driverGroupId_userId;
        return (
          fakeState.memberships.find(
            (m) => m.driverGroupId === driverGroupId && m.userId === userId,
          ) ?? null
        );
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        const row: FakeMembershipRow = {
          id: "00000000-0000-4000-8000-" + Date.now().toString().padStart(12, "0"),
          driverGroupId: data.driverGroupId,
          userId: data.userId,
          addedAt: new Date(),
        };
        fakeState.memberships.push(row);
        return row;
      },
    },
    auditAction: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        fakeState.auditLogs.push(data);
      },
    },
  };
}

vi.mock("../../lib/prisma", () => ({
  makePrisma: () => makeFake(),
}));

// The route still runs on Prisma; requirePermission does not. Since the
// middleware was ported it builds its own Drizzle client from c.env, and an
// unmocked one reads env.HYPERDRIVE_DB.connectionString off a test Env with
// no bindings — which turned Case 8's expected 403 into a 500. Faked here so
// the middleware reaches its mocked resolver instead of a real connection.
vi.mock("../../lib/drizzle", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeDrizzle: () => ({}) as any,
}));

// ─── Session mock ─────────────────────────────────────────────────────────────
//
// By default returns a bootstrap-admin session (sub="admin", no userId).
// Tests that need a real-user session (for the permission gate) set
// `sessionOverride` before the request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionOverride: any | null = null;

vi.mock("../../lib/admin-session", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (await importOriginal()) as any;
  return {
    ...real,
    verifyAdminSession: async (_secret: string, _cookie: string | undefined) =>
      sessionOverride ?? { sub: "admin", iat: Math.floor(Date.now() / 1000) },
    adminSessionConfig: real.adminSessionConfig ?? { SESSION_COOKIE_NAME: "sv_session" },
  };
});

// ─── Effective-permissions mock ───────────────────────────────────────────────
//
// By default returns ["member.write"] so the permission gate passes.
// Case 8 overrides `effectivePerms` to [] to trigger the 403.
let effectivePerms: string[] = ["member.write"];

vi.mock("../../lib/auth/effective-permissions", () => ({
  resolveEffectivePermissions: async () => effectivePerms,
}));

// Import AFTER mocks are installed.
import { adminDriverGroupMemberships } from "./driver-group-memberships";

// ─── Constants ───────────────────────────────────────────────────────────────
//
// RFC 4122-compliant UUIDs (version nibble = 4, variant nibble = 8).
// Zod v4 validates UUID version + variant; all-same-hex UUIDs like
// "aaaa-aaaa-..." fail because the version nibble must be 1–8 and
// the variant nibble must be 8/9/a/b.
const ORG_ID    = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const GROUP_ID  = "33333333-3333-4333-8333-333333333333";
const USER_ID   = "44444444-4444-4444-8444-444444444444";

// ─── Helper ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callCreate(orgId: string, body: unknown, env: any = { AUTH_SECRET: "test" }) {
  const req = new Request(
    `http://test/${orgId}/driver-group-memberships`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "straumvakt_admin_session=fake",
      },
      body: JSON.stringify(body),
    },
  );
  return adminDriverGroupMemberships.fetch(req, env);
}

// ─── Default happy-path fixtures ─────────────────────────────────────────────

function setupHappyPath() {
  fakeState.group = {
    id: GROUP_ID,
    ownerOrgId: ORG_ID,
    displayName: "Test Group",
  };
  fakeState.user = {
    id: USER_ID,
    audience: "driver",
    status: "active",
    email: "driver@example.com",
  };
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("POST /:orgId/driver-group-memberships", () => {
  beforeEach(() => {
    resetState();
    // Reset session and permissions to bootstrap defaults.
    sessionOverride = null;
    effectivePerms = ["member.write"];
  });

  // ── Case 1: valid inputs → 201, created: true ────────────────────────────

  it("creates a new membership and returns 201 with created:true", async () => {
    setupHappyPath();

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      membership: { id: string; userId: string; driverGroupId: string };
      created: boolean;
    };
    expect(body.created).toBe(true);
    expect(body.membership.userId).toBe(USER_ID);
    expect(body.membership.driverGroupId).toBe(GROUP_ID);
    expect(typeof body.membership.id).toBe("string");

    // Row persisted.
    expect(fakeState.memberships).toHaveLength(1);

    // Audit log written on new creation.
    expect(fakeState.auditLogs).toHaveLength(1);
    const audit = fakeState.auditLogs[0] as { action: string; targetType: string };
    expect(audit.action).toBe("driver_group_membership.create");
    expect(audit.targetType).toBe("driver_group_membership");
  });

  // ── Case 2: repeat call → 200, created: false ────────────────────────────

  it("returns 200 with created:false on a duplicate call (idempotent)", async () => {
    setupHappyPath();

    // First call creates.
    await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });
    const auditCountAfterFirst = fakeState.auditLogs.length;

    // Second call should be idempotent.
    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { membership: { userId: string }; created: boolean };
    expect(body.created).toBe(false);
    expect(body.membership.userId).toBe(USER_ID);

    // No new row, no new audit log on repeat.
    expect(fakeState.memberships).toHaveLength(1);
    expect(fakeState.auditLogs).toHaveLength(auditCountAfterFirst);
  });

  // ── Case 3: DriverGroup belongs to different org → 403 ───────────────────

  it("returns 403 when DriverGroup.ownerOrgId does not match URL orgId", async () => {
    fakeState.group = {
      id: GROUP_ID,
      ownerOrgId: OTHER_ORG, // different org
      displayName: "Other Group",
    };
    fakeState.user = {
      id: USER_ID,
      audience: "driver",
      status: "active",
      email: "driver@example.com",
    };

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
    expect(fakeState.memberships).toHaveLength(0);
    expect(fakeState.auditLogs).toHaveLength(0);
  });

  // ── Case 4: User audience='operator' → 422 ───────────────────────────────

  it("returns 422 when user audience is 'operator'", async () => {
    fakeState.group = { id: GROUP_ID, ownerOrgId: ORG_ID, displayName: "G" };
    fakeState.user = {
      id: USER_ID,
      audience: "operator", // not driver
      status: "active",
      email: "op@example.com",
    };

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unprocessable");
    expect(fakeState.memberships).toHaveLength(0);
  });

  // ── Case 5: User status='suspended' → 422 ────────────────────────────────

  it("returns 422 when user status is 'suspended'", async () => {
    fakeState.group = { id: GROUP_ID, ownerOrgId: ORG_ID, displayName: "G" };
    fakeState.user = {
      id: USER_ID,
      audience: "driver",
      status: "suspended", // not active
      email: "driver@example.com",
    };

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unprocessable");
    expect(fakeState.memberships).toHaveLength(0);
  });

  // ── Case 6: User doesn't exist → 404 ─────────────────────────────────────

  it("returns 404 when user does not exist", async () => {
    fakeState.group = { id: GROUP_ID, ownerOrgId: ORG_ID, displayName: "G" };
    fakeState.user = null; // no user

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ── Case 7: DriverGroup doesn't exist → 404 ──────────────────────────────

  it("returns 404 when driverGroup does not exist", async () => {
    fakeState.group = null; // no group
    fakeState.user = {
      id: USER_ID,
      audience: "driver",
      status: "active",
      email: "driver@example.com",
    };

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ── Case 8: Missing permission → 403 ─────────────────────────────────────
  //
  // Uses a non-bootstrap session (has userId → skips god-mode path) and
  // resolveEffectivePermissions returns [] → requirePermission returns 403.

  it("returns 403 when the session lacks member.write permission", async () => {
    setupHappyPath();

    // Non-bootstrap session: has userId.
    sessionOverride = {
      sub: "admin",
      userId: USER_ID,
      iat: Math.floor(Date.now() / 1000),
    };

    // No permissions in the resolved set.
    effectivePerms = [];

    const res = await callCreate(ORG_ID, { userId: USER_ID, driverGroupId: GROUP_ID });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
    // No side effects.
    expect(fakeState.memberships).toHaveLength(0);
    expect(fakeState.auditLogs).toHaveLength(0);
  });
});
