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

const mockPermissions = new Map<string, string[]>();
function seedPermissions(userId: string, orgId: string | null, verbs: string[]) {
  mockPermissions.set(JSON.stringify([userId, orgId]), verbs);
}

vi.mock("../drizzle", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeDrizzle: () => ({}) as any,
}));

vi.mock("./effective-permissions", () => ({
  resolveEffectivePermissions: async (
    _db: unknown,
    userId: string,
    orgId: string | null,
  ) => {
    return mockPermissions.get(JSON.stringify([userId, orgId])) ?? [];
  },
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
