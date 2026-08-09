// resolveOrgScope — the ROW gate.
//
// This was the only module in lib/auth with no test file, which matters
// more than it sounds: requirePermission decides "may you call this verb",
// resolveOrgScope decides "whose rows may come back". A support context
// enforced only on the verb gate leaves every tenant's rows readable.
//
// The module's own header notes it is a no-op today because only
// bootstrap/platform sessions reach admin routes. That is exactly why it
// needs tests — it activates silently the first time a host_admin session
// reaches a route, and nothing would catch a regression until then.

import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  viaPlatform: [] as string[],
  platformRole: null as string | null,
  memberOrgIds: [] as string[],
}));

vi.mock("../drizzle", () => ({
  makeDrizzle: () => ({
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(state.memberOrgIds.map((orgId) => ({ orgId }))),
      }),
    }),
  }),
}));

vi.mock("./effective-permissions", () => ({
  resolvePermissionsWithProvenance: async () => ({
    all: state.viaPlatform,
    viaMembership: [],
    viaPlatform: state.viaPlatform,
    membershipRole: null,
    platformRole: state.platformRole,
  }),
}));

import { resolveOrgScope, orgInScope } from "./org-scope";
import type { SessionPayload } from "../admin-session";
import type { Env } from "../../bindings";

const env = {} as unknown as Env;

function session(userId?: string): SessionPayload {
  return {
    sub: "admin" as const,
    role: "admin" as const,
    email: "staff-carol@example.test",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...(userId ? { userId } : {}),
  } as SessionPayload;
}

describe("orgInScope", () => {
  it("allows anything under an unrestricted scope", () => {
    expect(orgInScope({ all: true }, "org_alpha")).toBe(true);
  });

  it("allows only listed orgs under a restricted scope", () => {
    const scope = { all: false as const, orgIds: ["org_alpha"] };
    expect(orgInScope(scope, "org_alpha")).toBe(true);
    expect(orgInScope(scope, "org_beta")).toBe(false);
  });

  it("denies everything under an empty restricted scope", () => {
    expect(orgInScope({ all: false, orgIds: [] }, "org_alpha")).toBe(false);
  });
});

describe("resolveOrgScope", () => {
  beforeEach(() => {
    state.viaPlatform = [];
    state.platformRole = null;
    state.memberOrgIds = [];
    vi.restoreAllMocks();
  });

  // Same bypass as the verb gate: a validly-signed session with
  // sub:"admin" and no userId short-circuits before any lookup.
  it("grants unrestricted scope to a bootstrap session with no lookup", async () => {
    const scope = await resolveOrgScope(env, session());
    expect(scope).toEqual({ all: true });
  });

  it("denies all rows when the session has no userId and is not bootstrap", async () => {
    const ghost = {
      sub: "user" as unknown as "admin",
      role: "admin" as const,
      email: "ghost@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as SessionPayload;
    expect(await resolveOrgScope(env, ghost)).toEqual({
      all: false,
      orgIds: [],
    });
  });

  it("grants unrestricted scope to a platform.tenant.read holder", async () => {
    state.viaPlatform = ["platform.tenant.read", "site.read"];
    state.platformRole = "auditor";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await resolveOrgScope(env, session("staff-1"))).toEqual({
        all: true,
      });
      // The row gate is the seam a verb-only support context misses.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("support-context");
    } finally {
      warn.mockRestore();
    }
  });

  it("narrows a plain org member to their active memberships", async () => {
    state.viaPlatform = [];
    state.memberOrgIds = ["org_alpha", "org_beta"];
    const scope = await resolveOrgScope(env, session("member-1"));
    expect(scope).toEqual({ all: false, orgIds: ["org_alpha", "org_beta"] });
  });

  it("does not widen scope for a platform grant that lacks tenant.read", async () => {
    // finance_internal-shaped: platform verbs, but if tenant.read were
    // ever dropped from its bundle this must NOT fall through to `all`.
    state.viaPlatform = ["platform.finance.read"];
    state.memberOrgIds = ["org_alpha"];
    const scope = await resolveOrgScope(env, session("finance-1"));
    expect(scope).toEqual({ all: false, orgIds: ["org_alpha"] });
  });

  it("returns an empty restricted scope for a user with no memberships", async () => {
    state.memberOrgIds = [];
    expect(await resolveOrgScope(env, session("nobody"))).toEqual({
      all: false,
      orgIds: [],
    });
  });
});
