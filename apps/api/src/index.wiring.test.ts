// Wiring check: the real Worker app must put the Origin guard in front of
// every /api/admin route, including login and logout, and leave the rest.

import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/drizzle", () => ({ makeDrizzle: () => ({}) }));
vi.mock("./lib/prisma", () => ({ makePrisma: () => ({}) }));

const imported = await import("./index");
const worker = imported.default as unknown as {
  fetch: (r: Request, env: unknown, ctx: unknown) => Promise<Response>;
};

const ENV = { AUTH_SECRET: "test-secret-not-real" } as never;
const SIMPLE = { "content-type": "text/plain", cookie: "straumvakt_admin_session=x" };

async function req(path: string, init: RequestInit) {
  return worker.fetch(new Request(`https://api.straumvakt.org${path}`, init), ENV, {
    waitUntil() {},
    passThroughOnException() {},
  });
}

describe("apps/api wiring — admin Origin guard", () => {
  it.each([
    ["POST", "/api/admin/login"],
    ["POST", "/api/admin/logout"],
    ["POST", "/api/admin/orgs"],
    ["PATCH", "/api/admin/orgs/00000000-0000-4000-8000-000000000000"],
    ["DELETE", "/api/admin/vendor-credentials/00000000-0000-4000-8000-000000000000"],
  ])("%s %s from a sibling subdomain is rejected with 403", async (method, path) => {
    const res = await req(path, { method, headers: { ...SIMPLE, origin: "https://dso.straumvakt.org" }, body: "{}" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("logout from the apex origin is accepted and clears the cookie", async () => {
    const res = await req("/api/admin/logout", { method: "POST", headers: { origin: "https://straumvakt.org" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("straumvakt_admin_session=");
  });

  it("an allowed origin reaches auth (401, not 403) on a protected write", async () => {
    const res = await req("/api/admin/orgs", { method: "POST", headers: { origin: "https://www.straumvakt.org" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("GET /health is unaffected", async () => {
    const res = await req("/health", { headers: { origin: "https://dso.straumvakt.org" } });
    expect(res.status).toBe(200);
  });
});
