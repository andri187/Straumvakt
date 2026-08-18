// GET /api/admin/users/:id — identity-document redaction.
//
// The route is gated on `member.read` with NO `orgIdParam`, so
// requirePermission resolves orgId = null, skips the membership lookup,
// and only the platform expansion can satisfy the verb. Every platform
// role holds platform.tenant.read, which expands to every per-tenant
// `.read` — so auditor / sales_cs / finance_internal / support_agent
// could each read kennitala, dateOfBirth, address and notes for any user
// in any tenant, unaudited.
//
// Org scope plus a support context is the real fix and both are blocked
// (no org in the URL to scope by; support_contexts does not exist).
// Redaction is what is available now.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PermissionBasis } from "../../../lib/auth-middleware";

const state = vi.hoisted(() => ({
  basis: undefined as PermissionBasis | undefined,
}));

vi.mock("../../../lib/auth-middleware", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireAdmin: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("session", { sub: "admin", role: "admin", email: "staff-carol@example.test" });
    await next();
  },
}));

// Stands in for the real guard: the only thing this route cares about is
// the basis the guard publishes on the context.
vi.mock("../../../lib/auth/require-permission", () => ({
  requirePermission: () => async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    if (state.basis) c.set("permissionBasis", state.basis);
    await next();
  },
}));

vi.mock("../../../lib/drizzle", () => ({ makeDrizzle: () => ({}) }));
vi.mock("../../../lib/prisma", () => ({ makePrisma: () => ({}) }));

const FULL_USER = {
  id: "user-anna",
  email: "driver-anna@example.test",
  displayName: "Anna",
  status: "active",
  audience: "driver",
  kennitala: "1234567890",
  dateOfBirth: "1990-01-01",
  address: { street: "Testgata 1" },
  notes: "internal note",
};

vi.mock("../repositories/users", () => ({
  getUserById: async () => FULL_USER,
  listUserMemberships: async () => [],
  listUsers: async () => [],
  createUser: async () => ({}),
  updateUser: async () => ({}),
  userExists: async () => true,
  setUserPasswordHash: async () => undefined,
  clearUserPasswordHash: async () => undefined,
}));

vi.mock("../repositories/id-tokens", () => ({
  listIdTokensForUser: async () => [],
  createIdToken: async () => ({}),
}));

vi.mock("../../../repositories/agreements", () => ({
  listAgreementMembershipsForUser: async () => [],
}));

import { adminUsers } from "./admin-users";
import type { Env } from "../../../bindings";

const env = {} as unknown as Env;

async function getUser() {
  const res = await adminUsers.fetch(
    new Request("http://localhost/user-anna"),
    env,
  );
  return {
    status: res.status,
    body: (await res.json()) as {
      user: Record<string, unknown> & { redacted?: string[] };
    },
  };
}

const SENSITIVE = ["kennitala", "dateOfBirth", "address", "notes"] as const;

describe("GET /api/admin/users/:id — redaction by permission basis", () => {
  beforeEach(() => {
    state.basis = undefined;
  });

  it("withholds identity documents from a platform-derived reader", async () => {
    state.basis = {
      platformDerived: true,
      platformRole: "sales_cs",
      membershipRole: null,
    };
    const { status, body } = await getUser();
    expect(status).toBe(200);
    for (const field of SENSITIVE) {
      expect(body.user[field]).toBeNull();
    }
    expect(body.user.redacted).toEqual([...SENSITIVE]);
  });

  it("still returns who the person is, so support keeps working", async () => {
    // Deliberately not a 403: staff have a real reason to open a user
    // record. What they do not need is the national ID number.
    state.basis = {
      platformDerived: true,
      platformRole: "support_agent",
      membershipRole: null,
    };
    const { body } = await getUser();
    expect(body.user.email).toBe("driver-anna@example.test");
    expect(body.user.displayName).toBe("Anna");
    expect(body.user.id).toBe("user-anna");
  });

  it("returns the full record when membership supplies the verb", async () => {
    // The point of resolving provenance rather than checking a role name:
    // a genuine member of the tenant is unaffected.
    state.basis = {
      platformDerived: false,
      platformRole: null,
      membershipRole: "admin",
    };
    const { body } = await getUser();
    expect(body.user.kennitala).toBe("1234567890");
    expect(body.user.address).toEqual({ street: "Testgata 1" });
    expect(body.user.redacted).toBeUndefined();
  });

  it("returns the full record when a member ALSO holds a platform grant", async () => {
    // The discriminating case. Under a naive `platformRole !== null`
    // check this reader would be redacted despite being a real member.
    state.basis = {
      platformDerived: false,
      platformRole: "platform_admin",
      membershipRole: "owner",
    };
    const { body } = await getUser();
    expect(body.user.kennitala).toBe("1234567890");
    expect(body.user.redacted).toBeUndefined();
  });

  it("does not redact when no basis was published (bootstrap session)", async () => {
    // The bootstrap session short-circuits before resolution and already
    // has god-mode. Redacting here would imply a guarantee that branch
    // does not provide — recorded, not silently papered over.
    state.basis = undefined;
    const { body } = await getUser();
    expect(body.user.kennitala).toBe("1234567890");
  });
});
