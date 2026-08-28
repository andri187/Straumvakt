// Middleware tests — drive requirePermission through Hono with three
// session shapes:
//   1. No session (null) → 401
//   2. Bootstrap admin (sub:"admin", no userId) → god-mode, proceed
//   3. Multi-user session (with userId) → real check via the resolver

import { describe, expect, it, vi } from "vitest";

// Mock the client factory + the resolver BEFORE importing the middleware so
// the middleware picks up the fakes. The resolver mock returns a
// pre-set permission list per (userId, orgId) keyed by JSON pair —
// each test seeds it.
//
// It is ../drizzle now, not ../prisma. When the middleware was ported these
// four tests went from 403/200 to 500, because the unmocked makeDrizzle read
// env.HYPERDRIVE_DB.connectionString off a test Env that has no bindings.
// A mock that names the wrong module is not a mock.

interface SeededResolution {
  all: string[];
  viaMembership: string[];
  viaPlatform: string[];
}

const mockPermissions = new Map<string, SeededResolution>();

/**
 * Seed a user who holds the verbs through their MEMBERSHIP. Default
 * because it is the ordinary tenant case, and because it keeps the
 * support-context observer quiet — a member acting as a member needs no
 * context.
 */
function seedPermissions(userId: string, orgId: string | null, verbs: string[]) {
  mockPermissions.set(JSON.stringify([userId, orgId]), {
    all: verbs,
    viaMembership: verbs,
    viaPlatform: [],
  });
}

/** Seed a user who holds the verbs ONLY through a platform grant. */
function seedPlatformOnly(
  userId: string,
  orgId: string | null,
  verbs: string[],
) {
  mockPermissions.set(JSON.stringify([userId, orgId]), {
    all: verbs,
    viaMembership: [],
    viaPlatform: verbs,
  });
}

vi.mock("../drizzle", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeDrizzle: () => ({}) as any,
}));

// The whole module is replaced, so every symbol require-permission.ts
// imports must appear here. Adding an import to the middleware without
// adding it below fails with vitest's "No <name> export is defined on the
// mock" and turns these tests 403 -> 500.
vi.mock("./effective-permissions", () => ({
  resolveEffectivePermissions: async (
    _db: unknown,
    userId: string,
    orgId: string | null,
  ) => mockPermissions.get(JSON.stringify([userId, orgId]))?.all ?? [],
  resolvePermissionsWithProvenance: async (
    _db: unknown,
    userId: string,
    orgId: string | null,
  ) =>
    mockPermissions.get(JSON.stringify([userId, orgId])) ?? {
      all: [],
      viaMembership: [],
      viaPlatform: [],
      membershipRole: null,
      platformRole: null,
    },
  // The real difference, not a stub returning a constant — a stub here
  // would let the union bug through the one test written to catch it.
  satisfiedOnlyByPlatformGrant: (r: SeededResolution, verb: string) =>
    r.all.includes(verb) && !r.viaMembership.includes(verb),
}));

import { Hono } from "hono";
import { requirePermission } from "./require-permission";
import type { SessionPayload } from "../admin-session";
import type { Env } from "../../bindings";
import type { AuthVars } from "../auth-middleware";

function makeApp(
  session: SessionPayload | null,
  middleware: ReturnType<typeof requirePermission>,
) {
  const app = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  app.use("*", async (c, next) => {
    if (session) c.set("session", session);
    await next();
  });
  app.get("/test/:orgId?", middleware, (c) => c.json({ ok: true }));
  return app;
}

const env = {} as never;

describe("requirePermission", () => {
  it("returns 401 when no session is present", async () => {
    const app = makeApp(null, requirePermission("site.read"));
    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(401);
  });

  it("grants god-mode when bootstrap admin (sub:'admin', no userId)", async () => {
    const session = {
      sub: "admin" as const,
      role: "admin" as const,
      email: "ops@straumvakt.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const app = makeApp(session, requirePermission("site.write"));
    const res = await app.request("/test/org-1", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("grants god-mode for bootstrap superuser too", async () => {
    const session = {
      sub: "admin" as const,
      role: "superuser" as const,
      email: "founder@straumvakt.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const app = makeApp(
      session,
      requirePermission("platform.tenant.delete"),
    );
    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });

  it("denies multi-user session lacking the verb (403)", async () => {
    seedPermissions("user-1", "org-A", ["org.read"]);
    const session = {
      sub: "admin" as const,
      role: "admin" as const,
      email: "anna@festi.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
      userId: "user-1",
    } as SessionPayload & { userId: string };
    const app = makeApp(
      session,
      requirePermission("site.write", { orgIdParam: "orgId" }),
    );
    const res = await app.request("/test/org-A", undefined, env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required: string };
    expect(body.error).toBe("forbidden");
    expect(body.required).toBe("site.write");
  });

  it("grants multi-user session that has the verb (200)", async () => {
    seedPermissions("user-2", "org-B", ["site.read", "site.write"]);
    const session = {
      sub: "admin" as const,
      role: "admin" as const,
      email: "bjorn@n1.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
      userId: "user-2",
    } as SessionPayload & { userId: string };
    const app = makeApp(
      session,
      requirePermission("site.write", { orgIdParam: "orgId" }),
    );
    const res = await app.request("/test/org-B", undefined, env);
    expect(res.status).toBe(200);
  });

  it("uses null orgId for platform-only verbs (no orgIdParam option)", async () => {
    seedPermissions("user-3", null, ["platform.tenant.read"]);
    const session = {
      sub: "admin" as const,
      role: "admin" as const,
      email: "support@straumvakt.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
      userId: "user-3",
    } as SessionPayload & { userId: string };
    const app = makeApp(
      session,
      requirePermission("platform.tenant.read"),
    );
    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });

  it("denies multi-user session that has perms for a DIFFERENT org", async () => {
    seedPermissions("user-4", "org-OWN", ["site.write"]);
    seedPermissions("user-4", "org-OTHER", []);
    const session = {
      sub: "admin" as const,
      role: "admin" as const,
      email: "u@x.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
      userId: "user-4",
    } as SessionPayload & { userId: string };
    const app = makeApp(
      session,
      requirePermission("site.write", { orgIdParam: "orgId" }),
    );
    const res = await app.request("/test/org-OTHER", undefined, env);
    expect(res.status).toBe(403);
  });

  it("denies multi-user session shape with no userId attached", async () => {
    // Defensive — Sprint 5 will populate userId on every session, but
    // a misconfigured session could land without one. Should NOT
    // grant god-mode in that case.
    const session = {
      sub: "user" as unknown as "admin", // simulates non-bootstrap
      role: "admin" as const,
      email: "ghost@x.is",
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as SessionPayload;
    const app = makeApp(session, requirePermission("site.read"));
    const res = await app.request("/test/org-1", undefined, env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("session_missing_user_id");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Support context — shadow mode
// ─────────────────────────────────────────────────────────────────────
//
// The guard observes and does not block. It cannot block yet:
// support_contexts exists in no schema, so there is no context to open.
// Shadow first is also deliberate — the bootstrap operator holds a
// super_user grant and no membership anywhere, so enforcing on day one
// would demand a context for every routine org-scoped action.

describe("requirePermission — support-context observation", () => {
  function staffSession(userId: string): SessionPayload {
    return {
      sub: "admin" as const,
      role: "admin" as const,
      email: "staff-carol@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
      userId,
    } as SessionPayload;
  }

  it("does NOT observe when the verb comes from the user's membership", async () => {
    seedPermissions("member-1", "org-1", ["site.write"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = makeApp(
        staffSession("member-1"),
        requirePermission("site.write", { orgIdParam: "orgId" }),
      );
      const res = await app.request("/test/org-1", undefined, env);
      expect(res.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("observes, but does not block, a platform-derived org-scoped action", async () => {
    seedPlatformOnly("staff-1", "org-1", ["site.write"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = makeApp(
        staffSession("staff-1"),
        requirePermission("site.write", { orgIdParam: "orgId" }),
      );
      const res = await app.request("/test/org-1", undefined, env);
      expect(res.status).toBe(200); // shadow: observed, not enforced
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("support-context");
      expect(warn.mock.calls[0]![1]).toMatchObject({
        userId: "staff-1",
        orgId: "org-1",
        verb: "site.write",
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("does not observe on a platform-scoped route (no orgId to act on behalf of)", async () => {
    seedPlatformOnly("staff-1", null, ["site.write"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = makeApp(
        staffSession("staff-1"),
        requirePermission("site.write"), // no orgIdParam
      );
      const res = await app.request("/test", undefined, env);
      expect(res.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // The gap, asserted rather than described. A validly-signed session with
  // sub:"admin" and no userId returns next() before any of this runs.
  it("is bypassed entirely by a bootstrap session, as the permission check is", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bootstrap = {
        sub: "admin" as const,
        role: "admin" as const,
        email: "admin-dagur@example.test",
        exp: Math.floor(Date.now() / 1000) + 3600,
      } as SessionPayload;
      const app = makeApp(
        bootstrap,
        requirePermission("site.write", { orgIdParam: "orgId" }),
      );
      const res = await app.request("/test/org-1", undefined, env);
      expect(res.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
