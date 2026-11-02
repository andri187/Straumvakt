// CSRF / Origin guard for cookie-authenticated admin routes.
//
// The cases that matter most are the "simple" cross-origin POSTs: a
// text/plain body with no custom headers needs no CORS preflight, so the
// browser sends it with the victim's cookie and CORS never gets a vote.

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ALLOWED_ORIGINS, requireTrustedOrigin } from "./origin-guard";

function makeApp() {
  const app = new Hono();
  app.use(
    "/api/*",
    cors({
      origin: (o) => (ALLOWED_ORIGINS.includes(o) ? o : null),
      credentials: true,
    }),
  );
  app.use("/api/admin/*", requireTrustedOrigin);
  const handler = vi.fn((c: { json: (b: unknown) => Response }) => c.json({ ok: true }));
  app.all("/api/admin/thing", handler as never);
  app.post("/api/public/register", (c) => c.json({ public: true }));
  return { app, handler };
}

const API = "https://api.straumvakt.org/api/admin/thing";
const SIMPLE = { "content-type": "text/plain", cookie: "straumvakt_admin_session=x" };

async function call(init: RequestInit & { url?: string }) {
  const { app, handler } = makeApp();
  const res = await app.request(init.url ?? API, init);
  return { res, called: handler.mock.calls.length > 0 };
}

describe("requireTrustedOrigin — rejects foreign pages", () => {
  it.each([
    ["sibling subdomain dso", "https://dso.straumvakt.org"],
    ["sibling subdomain plan", "https://plan.straumvakt.org"],
    ["sibling subdomain test", "https://test.straumvakt.org"],
    ["unrelated site", "https://evil.example"],
    ["look-alike suffix", "https://evilstraumvakt.org"],
    ["look-alike prefix", "https://straumvakt.org.evil.example"],
    ["scheme downgrade", "http://straumvakt.org"],
    ["opaque origin", "null"],
    ["garbage", "not a url"],
  ])("blocks a simple (no-preflight) POST from %s", async (_n, origin) => {
    const { res, called } = await call({ method: "POST", headers: { ...SIMPLE, origin }, body: '{"a":1}' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
    expect(called).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("guards %s", async (method) => {
    const { res, called } = await call({ method, headers: { ...SIMPLE, origin: "https://dso.straumvakt.org" } });
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });

  it("blocks login and logout from a foreign origin (login CSRF)", async () => {
    for (const path of ["login", "logout"]) {
      const { app } = makeApp();
      app.post(`/api/admin/${path}`, (c) => c.json({ ok: true }));
      const res = await app.request(`https://api.straumvakt.org/api/admin/${path}`, {
        method: "POST",
        headers: { origin: "https://plan.straumvakt.org", "content-type": "text/plain" },
        body: "{}",
      });
      expect(res.status).toBe(403);
    }
  });

  it("blocks when Origin is absent but Sec-Fetch-Site says cross-site or same-site", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const { res, called } = await call({ method: "POST", headers: { ...SIMPLE, "sec-fetch-site": site } });
      expect(res.status).toBe(403);
      expect(called).toBe(false);
    }
  });

  it("blocks when only a foreign Referer is present", async () => {
    const { res } = await call({ method: "POST", headers: { ...SIMPLE, referer: "https://dso.straumvakt.org/page" } });
    expect(res.status).toBe(403);
  });

  it("blocks a malformed Referer", async () => {
    const { res } = await call({ method: "POST", headers: { ...SIMPLE, referer: "garbage" } });
    expect(res.status).toBe(403);
  });

  it("Origin wins over a friendly Referer", async () => {
    const { res } = await call({
      method: "POST",
      headers: { ...SIMPLE, origin: "https://dso.straumvakt.org", referer: "https://straumvakt.org/" },
    });
    expect(res.status).toBe(403);
  });

  it("does not echo CORS allow headers to a foreign origin", async () => {
    const { res } = await call({ method: "POST", headers: { ...SIMPLE, origin: "https://dso.straumvakt.org" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("requireTrustedOrigin — preserves legitimate flows", () => {
  it.each([
    ["apex", "https://straumvakt.org"],
    ["www", "https://www.straumvakt.org"],
    ["staging workers.dev UI", "https://hlada-staging.straumvakt.workers.dev"],
    ["prod workers.dev UI", "https://hlada.straumvakt.workers.dev"],
    ["local Next dev", "http://localhost:3000"],
  ])("allows POST from %s", async (_n, origin) => {
    const { res, called } = await call({ method: "POST", headers: { ...SIMPLE, origin }, body: "{}" });
    expect(res.status).toBe(200);
    expect(called).toBe(true);
  });

  it("allows the API's own origin (wrangler dev, direct calls)", async () => {
    const url = "http://localhost:8787/api/admin/thing";
    const { res } = await call({ url, method: "POST", headers: { origin: "http://localhost:8787" } });
    expect(res.status).toBe(200);
  });

  it("allows the workers.dev API host calling itself", async () => {
    const url = "https://hlada-api-staging.straumvakt.workers.dev/api/admin/thing";
    const { res } = await call({ url, method: "DELETE", headers: { origin: "https://hlada-api-staging.straumvakt.workers.dev" } });
    expect(res.status).toBe(200);
  });

  it("allows same-origin / user-initiated Sec-Fetch-Site without Origin", async () => {
    for (const site of ["same-origin", "none"]) {
      const { res } = await call({ method: "POST", headers: { "sec-fetch-site": site } });
      expect(res.status).toBe(200);
    }
  });

  it("allows an allowlisted Referer when Origin and Sec-Fetch-Site are absent", async () => {
    const { res } = await call({ method: "POST", headers: { referer: "https://straumvakt.org/staff/overview" } });
    expect(res.status).toBe(200);
  });

  it("allows non-browser callers (no Origin, Sec-Fetch-Site or Referer) — UI Worker server fetch, curl", async () => {
    const { res, called } = await call({ method: "POST", headers: { cookie: "straumvakt_admin_session=x" } });
    expect(res.status).toBe(200);
    expect(called).toBe(true);
  });

  it.each(["GET", "HEAD"])("never blocks safe %s, even cross-origin", async (method) => {
    const { res } = await call({ method, headers: { origin: "https://dso.straumvakt.org" } });
    expect(res.status).toBe(200);
  });

  it("lets the CORS preflight for an allowed origin through untouched", async () => {
    const { res, called } = await call({
      method: "OPTIONS",
      headers: {
        origin: "https://straumvakt.org",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://straumvakt.org");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(called).toBe(false);
  });

  it("does not touch routes outside /api/admin (public, bearer-token surfaces)", async () => {
    const { app } = makeApp();
    const res = await app.request("https://api.straumvakt.org/api/public/register", {
      method: "POST",
      headers: { origin: "https://anywhere.example" },
    });
    expect(res.status).toBe(200);
  });
});
