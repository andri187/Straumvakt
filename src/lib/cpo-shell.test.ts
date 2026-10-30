import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminSession, verifyAdminSession } from "@/lib/admin-session";
import {
  handleShellLogin,
  handleShellLogout,
  isSameOriginRequest,
} from "@/lib/cpo-shell-handlers";
import { decideShellRoute, readShellCookie, SHELL_PUBLIC_ASSETS } from "@/lib/cpo-shell-policy";
import {
  SHELL_COOKIE_NAME,
  SHELL_SESSION_TTL_SECONDS,
  createShellSession,
  readShellConfig,
  shellCookieIsSecure,
  verifyShellCredentials,
  verifyShellSession,
  type ShellConfig,
} from "@/lib/cpo-shell-session";
import { middleware } from "@/middleware";
import { SHELL_PAGES, WORKSPACE_PATHS, NAV_GROUPS, SETTINGS_ITEM, resolveTab } from "@/app/cpo/sections";

// Disposable values, generated for this file only. Not a real credential.
const SECRET = "test-only-signing-secret-0123456789abcdef";
const CONFIG: ShellConfig = {
  username: "ShellTester",
  password: "disposable-test-password",
  secret: SECRET,
};
const ENV = {
  CPO_SHELL_USERNAME: CONFIG.username,
  CPO_SHELL_PASSWORD: CONFIG.password,
  CPO_SHELL_SESSION_SECRET: CONFIG.secret,
};
const HTTPS = "https://shell.example.test";
const LOCAL = "http://localhost:3000";

afterEach(() => {
  vi.unstubAllEnvs();
});

function formLogin(
  username: string,
  password: string,
  opts: { base?: string; headers?: Record<string, string> } = {},
) {
  const base = opts.base ?? HTTPS;
  return new Request(`${base}/api/shell/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: base,
      ...opts.headers,
    },
    body: new URLSearchParams({ username, password }).toString(),
  });
}

function jsonLogin(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${HTTPS}/api/shell/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: HTTPS, ...headers },
    body: JSON.stringify(body),
  });
}

describe("shell configuration", () => {
  it("reads all three server-side values", () => {
    expect(readShellConfig(ENV)).toEqual(CONFIG);
  });

  it.each([
    ["username", { ...ENV, CPO_SHELL_USERNAME: undefined }],
    ["blank username", { ...ENV, CPO_SHELL_USERNAME: "   " }],
    ["password", { ...ENV, CPO_SHELL_PASSWORD: undefined }],
    ["empty password", { ...ENV, CPO_SHELL_PASSWORD: "" }],
    ["secret", { ...ENV, CPO_SHELL_SESSION_SECRET: undefined }],
    ["short secret", { ...ENV, CPO_SHELL_SESSION_SECRET: "short" }],
  ])("is unavailable without %s", (_name, env) => {
    expect(readShellConfig(env)).toBeNull();
  });

  it("has no built-in default credential", () => {
    expect(readShellConfig({})).toBeNull();
  });
});

describe("credential check", () => {
  it("accepts the configured pair only", async () => {
    expect(await verifyShellCredentials("ShellTester", CONFIG.password, CONFIG)).toBe(true);
    expect(await verifyShellCredentials("  ShellTester ", CONFIG.password, CONFIG)).toBe(true);
    expect(await verifyShellCredentials("ShellTester", "wrong", CONFIG)).toBe(false);
    expect(await verifyShellCredentials("shelltester", CONFIG.password, CONFIG)).toBe(false);
    expect(await verifyShellCredentials("other", CONFIG.password, CONFIG)).toBe(false);
    expect(await verifyShellCredentials("", "", CONFIG)).toBe(false);
    expect(await verifyShellCredentials(null, undefined, CONFIG)).toBe(false);
    expect(await verifyShellCredentials({}, [], CONFIG)).toBe(false);
  });
});

describe("shell session", () => {
  it("round-trips and is limited to the shell subject", async () => {
    const now = 1_800_000_000;
    const token = await createShellSession(CONFIG, now);
    const session = await verifyShellSession(token, CONFIG, now + 10);
    expect(session).toMatchObject({ sub: "cpo-shell", username: "ShellTester" });
    expect(session?.exp).toBe(now + SHELL_SESSION_TTL_SECONDS);
    expect(session).not.toHaveProperty("role");
  });

  it("rejects expired sessions", async () => {
    const now = 1_800_000_000;
    const token = await createShellSession(CONFIG, now);
    expect(await verifyShellSession(token, CONFIG, now + SHELL_SESSION_TTL_SECONDS)).toBeNull();
    expect(await verifyShellSession(token, CONFIG, now + SHELL_SESSION_TTL_SECONDS + 1)).toBeNull();
  });

  it("rejects tampered payloads and signatures", async () => {
    const now = 1_800_000_000;
    const token = await createShellSession(CONFIG, now);
    const [payload, signature] = token.split(".");

    const forged = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    forged.exp += 100_000;
    const forgedPart = btoa(JSON.stringify(forged))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(await verifyShellSession(`${forgedPart}.${signature}`, CONFIG, now)).toBeNull();
    expect(await verifyShellSession(`${payload}.${signature.slice(0, -2)}AA`, CONFIG, now)).toBeNull();
    expect(await verifyShellSession(`${payload}.`, CONFIG, now)).toBeNull();
    expect(await verifyShellSession("garbage", CONFIG, now)).toBeNull();
    expect(await verifyShellSession("a.b.c", CONFIG, now)).toBeNull();
    expect(await verifyShellSession("", CONFIG, now)).toBeNull();
    expect(await verifyShellSession(undefined, CONFIG, now)).toBeNull();
  });

  it("rejects a session after the secret or username changes, or with no config", async () => {
    const now = 1_800_000_000;
    const token = await createShellSession(CONFIG, now);
    expect(
      await verifyShellSession(token, { ...CONFIG, secret: `${SECRET}-rotated` }, now),
    ).toBeNull();
    expect(
      await verifyShellSession(token, { ...CONFIG, username: "SomeoneElse" }, now),
    ).toBeNull();
    expect(await verifyShellSession(token, null, now)).toBeNull();
  });

  it("is not interchangeable with the legacy admin session, even with the same secret", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const adminToken = await createAdminSession("admin@example.test", "superuser");
    const shellToken = await createShellSession(CONFIG);

    expect(await verifyShellSession(adminToken, CONFIG)).toBeNull();
    expect(await verifyAdminSession(shellToken)).toBeNull();
  });
});

describe("cookie attributes", () => {
  it("is secure except on plain-HTTP loopback", () => {
    expect(shellCookieIsSecure(`${HTTPS}/x`)).toBe(true);
    expect(shellCookieIsSecure("http://localhost:3000/x")).toBe(false);
    expect(shellCookieIsSecure("http://127.0.0.1:3000/x")).toBe(false);
    expect(shellCookieIsSecure("http://shell.example.test/x")).toBe(true);
  });
});

describe("login handler", () => {
  it("signs in with the right credentials and sets a host-only cookie", async () => {
    const res = await handleShellLogin(formLogin("ShellTester", CONFIG.password), ENV);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${HTTPS}/cpo`);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${SHELL_COOKIE_NAME}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toContain(CONFIG.password);

    const token = cookie.split(";")[0].slice(SHELL_COOKIE_NAME.length + 1);
    expect(await verifyShellSession(token, CONFIG)).toMatchObject({ sub: "cpo-shell" });
  });

  it("omits Secure only for local development over HTTP", async () => {
    const res = await handleShellLogin(
      formLogin("ShellTester", CONFIG.password, { base: LOCAL }),
      ENV,
    );
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(res.status).toBe(303);
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("HttpOnly");
  });

  it("answers JSON callers with JSON", async () => {
    const ok = await handleShellLogin(
      jsonLogin({ username: "ShellTester", password: CONFIG.password }),
      ENV,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(SHELL_COOKIE_NAME);

    const bad = await handleShellLogin(
      jsonLogin({ username: "ShellTester", password: "nope" }),
      ENV,
    );
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect(await bad.json()).toEqual({ error: "invalid" });
  });

  it("refuses wrong credentials without setting a cookie or revealing which field", async () => {
    for (const [u, p] of [
      ["ShellTester", "wrong"],
      ["wrong", CONFIG.password],
      ["", ""],
    ]) {
      const res = await handleShellLogin(formLogin(u, p), ENV);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`${HTTPS}/signin?error=invalid`);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("is unavailable, and never signs anyone in, when configuration is missing", async () => {
    const res = await handleShellLogin(formLogin("ShellTester", CONFIG.password), {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${HTTPS}/signin?error=unavailable`);
    expect(res.headers.get("set-cookie")).toBeNull();

    const json = await handleShellLogin(
      jsonLogin({ username: "ShellTester", password: CONFIG.password }),
      { ...ENV, CPO_SHELL_SESSION_SECRET: undefined },
    );
    expect(json.status).toBe(503);
    expect(json.headers.get("set-cookie")).toBeNull();
  });

  it("rejects malformed, oversized and unsupported bodies", async () => {
    const malformed = await handleShellLogin(
      new Request(`${HTTPS}/api/shell/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: HTTPS },
        body: "{not json",
      }),
      ENV,
    );
    expect(malformed.headers.get("set-cookie")).toBeNull();

    const plain = await handleShellLogin(
      new Request(`${HTTPS}/api/shell/login`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: HTTPS },
        body: JSON.stringify({ username: "ShellTester", password: CONFIG.password }),
      }),
      ENV,
    );
    expect(plain.headers.get("set-cookie")).toBeNull();

    const huge = await handleShellLogin(
      formLogin("ShellTester", "x".repeat(10_000)),
      ENV,
    );
    expect(huge.headers.get("set-cookie")).toBeNull();
  });

  it("only accepts POST", async () => {
    const res = await handleShellLogin(new Request(`${HTTPS}/api/shell/login`), ENV);
    expect(res.status).toBe(405);
  });

  it("refuses cross-origin state-changing requests, including simple POSTs without preflight", async () => {
    const attempts: Request[] = [
      formLogin("ShellTester", CONFIG.password, { headers: { origin: "https://evil.example" } }),
      formLogin("ShellTester", CONFIG.password, { headers: { origin: "null" } }),
      // A cross-site simple POST (text/plain) carries Origin and no preflight.
      new Request(`${HTTPS}/api/shell/login`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://evil.example" },
        body: JSON.stringify({ username: "ShellTester", password: CONFIG.password }),
      }),
      new Request(`${HTTPS}/api/shell/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "cross-site",
        },
        body: "username=ShellTester&password=x",
      }),
      new Request(`${HTTPS}/api/shell/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: "https://evil.example/page",
        },
        body: "username=ShellTester&password=x",
      }),
    ];
    for (const req of attempts) {
      const res = await handleShellLogin(req, ENV);
      expect(res.status).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("recognises same-origin evidence and non-browser callers", () => {
    const mk = (headers: Record<string, string>) =>
      new Request(`${HTTPS}/x`, { method: "POST", headers });
    expect(isSameOriginRequest(mk({ origin: HTTPS }))).toBe(true);
    expect(isSameOriginRequest(mk({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(mk({ referer: `${HTTPS}/signin` }))).toBe(true);
    expect(isSameOriginRequest(mk({ referer: "not a url" }))).toBe(false);
    expect(isSameOriginRequest(mk({}))).toBe(true);
    // A foreign Origin wins over a spoofable Sec-Fetch-Site.
    expect(
      isSameOriginRequest(mk({ origin: "https://evil.example", "sec-fetch-site": "same-origin" })),
    ).toBe(false);
  });
});

describe("logout handler", () => {
  it("clears the cookie with the same attributes and returns to sign-in", async () => {
    const res = await handleShellLogout(
      new Request(`${HTTPS}/api/shell/logout`, { method: "POST", headers: { origin: HTTPS } }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${HTTPS}/signin`);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${SHELL_COOKIE_NAME}=;`)).toBe(true);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("refuses cross-origin and non-POST logout", async () => {
    const cross = await handleShellLogout(
      new Request(`${HTTPS}/api/shell/logout`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(cross.status).toBe(403);
    expect(cross.headers.get("set-cookie")).toBeNull();

    const get = await handleShellLogout(new Request(`${HTTPS}/api/shell/logout`));
    expect(get.status).toBe(405);
  });
});

describe("route policy", () => {
  const next = { action: "next", noStore: true };

  it("sends anonymous visitors to sign-in and members to the workspace", () => {
    expect(decideShellRoute({ pathname: "/", hasSession: false })).toEqual({
      action: "redirect",
      location: "/signin",
    });
    expect(decideShellRoute({ pathname: "/", hasSession: true })).toEqual({
      action: "redirect",
      location: "/cpo",
    });
    expect(decideShellRoute({ pathname: "/signin", hasSession: false })).toEqual(next);
    expect(decideShellRoute({ pathname: "/signin", hasSession: true })).toEqual({
      action: "redirect",
      location: "/cpo",
    });
  });

  it("protects every workspace page", () => {
    for (const p of [...WORKSPACE_PATHS, "/cpo/organisations", "/cpo/anything"]) {
      expect(decideShellRoute({ pathname: p, hasSession: false })).toEqual({
        action: "redirect",
        location: "/signin",
      });
      expect(decideShellRoute({ pathname: p, hasSession: true })).toEqual(next);
    }
  });

  it("answers 404 for every legacy or unknown route, with or without a session", () => {
    const legacy = [
      "/home",
      "/staff",
      "/staff/overview",
      "/org/n1",
      "/org/n1/chargers",
      "/app",
      "/app/admin",
      "/app/org/chargers",
      "/local/product-preview",
      "/local/dso-lookup",
      "/visual",
      "/login-demo",
      "/api/admin/login",
      "/api/admin/me",
      "/api/admin/logout",
      "/api/anything",
      "/concepts/admin.html",
      "/dso-lookup.html",
      "/app-screenshots/00_login_pixel9.png",
      "/cpo-extra",
      "/signin/extra",
    ];
    for (const pathname of legacy) {
      for (const hasSession of [true, false]) {
        expect(decideShellRoute({ pathname, hasSession })).toEqual({ action: "notFound" });
      }
    }
  });

  it("allows only the shell's own static assets", () => {
    for (const asset of SHELL_PUBLIC_ASSETS) {
      expect(decideShellRoute({ pathname: asset, hasSession: false }).action).toBe("next");
    }
    expect(decideShellRoute({ pathname: "/_next/static/chunk.js", hasSession: false }).action).toBe("next");
    // The homepage artwork is AVIF/WebP only; the original PNG and the other
    // landing files, including the full logo, are not part of this deployment.
    for (const pathname of [
      "/landing/straumvakt-car.png",
      "/landing/straumvakt-logo-full.png",
      "/landing/anything.avif",
      "/landing/",
      "/landing/straumvakt-car.avif/extra",
    ]) {
      expect(decideShellRoute({ pathname, hasSession: false })).toEqual({ action: "notFound" });
      expect(decideShellRoute({ pathname, hasSession: true })).toEqual({ action: "notFound" });
    }
  });

  it("reads only the shell cookie from a Cookie header", () => {
    expect(readShellCookie(null)).toBeUndefined();
    expect(readShellCookie("a=1; straumvakt_admin_session=admin; b=2")).toBeUndefined();
    expect(readShellCookie(`a=1; ${SHELL_COOKIE_NAME}=tok.en; b=2`)).toBe("tok.en");
  });
});

describe("middleware on the shipped surface", () => {
  async function req(path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    return middleware(new NextRequest(`${HTTPS}${path}`, { headers }));
  }

  async function signedInCookie(): Promise<string> {
    const token = await createShellSession(CONFIG);
    return `${SHELL_COOKIE_NAME}=${token}`;
  }

  function useShellEnv() {
    vi.stubEnv("CPO_SHELL_USERNAME", CONFIG.username);
    vi.stubEnv("CPO_SHELL_PASSWORD", CONFIG.password);
    vi.stubEnv("CPO_SHELL_SESSION_SECRET", CONFIG.secret);
  }

  it("redirects a direct request for every protected page without a session", async () => {
    useShellEnv();
    for (const p of [...WORKSPACE_PATHS, "/cpo/organisations"]) {
      const res = await req(p);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/signin");
    }
  });

  it("rejects a tampered or expired session cookie", async () => {
    useShellEnv();
    const good = await signedInCookie();
    const tampered = good.slice(0, -3) + "AAA";
    expect((await req("/cpo", { cookie: tampered })).status).toBe(307);

    const old = await createShellSession(CONFIG, Math.floor(Date.now() / 1000) - SHELL_SESSION_TTL_SECONDS - 5);
    expect((await req("/cpo", { cookie: `${SHELL_COOKIE_NAME}=${old}` })).status).toBe(307);
  });

  it("serves every protected page, with no-store, to a valid session", async () => {
    useShellEnv();
    const cookie = await signedInCookie();
    for (const p of WORKSPACE_PATHS) {
      const res = await req(p, { cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    // A tab chosen in the address keeps the same protection.
    expect((await req("/cpo/people?tab=invitations")).status).toBe(307);
    expect((await req("/cpo/people?tab=invitations", { cookie })).status).toBe(200);
  });

  it("serves the homepage and sign-in without a session and sends a member onward", async () => {
    useShellEnv();
    expect((await req("/signin")).status).toBe(200);
    expect((await req("/signin?error=invalid")).status).toBe(200);
    expect((await req("/signin", { cookie: await signedInCookie() })).headers.get("location")).toMatch(/\/cpo$/);
    expect(new URL((await req("/")).headers.get("location")!).pathname).toBe("/signin");
  });

  it("serves only the exact homepage artwork variants", async () => {
    useShellEnv();
    expect((await req("/landing/straumvakt-car.avif")).status).toBe(200);
    expect((await req("/landing/straumvakt-car.webp")).status).toBe(200);
    expect((await req("/landing/straumvakt-car.png")).status).toBe(404);
    expect((await req("/landing/straumvakt-logo-full.png")).status).toBe(404);
  });

  it("fails closed when the shell is not configured", async () => {
    const res = await req("/cpo", { cookie: await signedInCookie() });
    expect(res.status).toBe(307);
  });

  it("refuses a shell session on staff, organisation, demo and admin-API routes", async () => {
    useShellEnv();
    const cookie = await signedInCookie();
    for (const p of [
      "/staff/overview",
      "/org/n1",
      "/app/admin",
      "/home",
      "/api/admin/me",
      "/api/admin/login",
    ]) {
      const res = await req(p, { cookie });
      expect(res.status).toBe(404);
    }
  });

  it("does not honour the preview flag or a legacy admin cookie", async () => {
    useShellEnv();
    vi.stubEnv("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW", "1");
    vi.stubEnv("AUTH_SECRET", SECRET);
    const adminCookie = `straumvakt_admin_session=${await createAdminSession("a@example.test", "superuser")}`;
    for (const p of ["/app", "/app/admin", "/visual", "/login-demo", "/local/product-preview", "/local/dso-lookup", "/staff/overview", "/api/admin/me"]) {
      expect((await req(p)).status).toBe(404);
      expect((await req(p, { cookie: adminCookie })).status).toBe(404);
    }
    expect((await req("/cpo", { cookie: adminCookie })).status).toBe(307);
  });

  it("answers 404 for dotted public files that would otherwise be served unchecked", async () => {
    useShellEnv();
    expect((await req("/concepts/admin.html")).status).toBe(404);
    expect((await req("/dso-lookup.html")).status).toBe(404);
    expect((await req("/data-model.svg")).status).toBe(404);
  });

  it("strips a client-supplied trusted-admin header", async () => {
    useShellEnv();
    const res = await req("/cpo", {
      cookie: await signedInCookie(),
      headers: { "x-straumvakt-admin-verified": "1" },
    });
    const overridden = res.headers.get("x-middleware-override-headers") ?? "";
    expect(overridden).not.toContain("x-straumvakt-admin-verified");
  });

  it("cannot be switched onto the legacy surface in a production build", async () => {
    useShellEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRAUMVAKT_SURFACE", "legacy");
    vi.stubEnv("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW", "1");
    expect((await req("/app")).status).toBe(404);
    expect((await req("/staff/overview")).status).toBe(404);
  });

  it("keeps the legacy surface reachable for local development only", async () => {
    vi.stubEnv("STRAUMVAKT_SURFACE", "legacy");
    vi.stubEnv("STRAUMVAKT_LOCAL_PRODUCT_PREVIEW", "1");
    expect((await req("/app")).status).toBe(200);
  });
});

describe("workspace content", () => {
  const tabs = SHELL_PAGES.flatMap((page) => page.tabs.map((tab) => ({ page, tab })));
  const everyWord = [
    ...NAV_GROUPS.flatMap((group) => [group.heading, ...group.items.flatMap((i) => [i.label, i.summary])]),
    SETTINGS_ITEM.label,
    SETTINGS_ITEM.summary,
    ...SHELL_PAGES.flatMap((page) => [page.title, page.subtitle]),
    ...tabs.flatMap(({ tab }) => [
      tab.label,
      tab.note ?? "",
      tab.action?.label ?? "",
      tab.action?.reason ?? "",
      ...(tab.content.kind === "table"
        ? [...tab.content.columns, tab.content.emptyTitle, tab.content.emptyDetail]
        : tab.content.facts.flat()),
    ]),
  ].join(" ");

  it("uses the approved flat navigation, with no Organisations entry", () => {
    expect(NAV_GROUPS.map((g) => [g.heading, g.items.map((i) => [i.label, i.href])])).toEqual([
      ["Workspace", [["Overview", "/cpo"], ["People & access", "/cpo/people"]]],
      [
        "Charging",
        [["Installations", "/cpo/installations"], ["Chargers", "/cpo/chargers"], ["Sessions", "/cpo/sessions"]],
      ],
      [
        "Costs",
        [["Cost factors & rates", "/cpo/costs"], ["Agreements & sponsorship", "/cpo/agreements"]],
      ],
    ]);
    expect(SETTINGS_ITEM).toMatchObject({ label: "Organisation settings", href: "/cpo/settings" });
    expect(WORKSPACE_PATHS).not.toContain("/cpo/organisations");
  });

  it("offers the approved tabs on each page", () => {
    const labels = Object.fromEntries(SHELL_PAGES.map((p) => [p.key, p.tabs.map((t) => t.label)]));
    expect(labels).toEqual({
      people: ["People", "Invitations", "Driver groups"],
      installations: ["All installations"],
      chargers: ["All chargers", "Incoming", "Charger groups"],
      sessions: ["All sessions", "Needs attention"],
      costs: ["Cost factors", "Rate history"],
      agreements: ["Agreements", "Sponsorship"],
      settings: ["Organisation details", "Representation", "Activity"],
    });
  });

  it("resolves a tab from the address and falls back to the first for anything else", () => {
    const chargers = SHELL_PAGES.find((p) => p.key === "chargers")!;
    expect(resolveTab(chargers, "incoming").key).toBe("incoming");
    expect(resolveTab(chargers, ["groups", "incoming"]).key).toBe("groups");
    for (const raw of [undefined, "", "nope", "__proto__", "INCOMING", "incoming "]) {
      expect(resolveTab(chargers, raw).key).toBe("all");
    }
  });

  it("never presents a figure, example record or legacy data", () => {
    expect(everyWord).not.toMatch(/\d/);
    expect(everyWord).not.toMatch(/dalvegur|\bn1\b|demo|fixture|mock|prisma|drizzle|neon|ocpp|worker|database/i);
  });

  it("explains every unavailable action and every empty list", () => {
    for (const { tab } of tabs) {
      if (tab.action) expect(tab.action.reason.length).toBeGreaterThan(30);
      if (tab.content.kind === "table") {
        expect(tab.content.emptyDetail).toMatch(
          /not connected|cannot be (confirmed|assessed)|not available|cannot be listed|can be listed|no charger is connected|nothing can be listed/i,
        );
      }
    }
  });

  it("does not describe an empty list as a measured zero or an offline charger as fact", () => {
    for (const { tab } of tabs) {
      if (tab.content.kind !== "table") continue;
      expect(tab.content.emptyDetail).not.toMatch(/\bzero\b/i);
      if (/offline/i.test(tab.content.emptyDetail)) {
        expect(tab.content.emptyDetail).toMatch(/does not mean a charger is offline/i);
      }
    }
  });

  it("keeps the shared test identity free of any role", () => {
    const details = SHELL_PAGES.find((p) => p.key === "settings")!.tabs[0];
    expect(details.note).toMatch(/no organisation, platform, installer or installation-representative role/);
    if (details.content.kind !== "facts") throw new Error("expected facts");
    expect(details.content.facts).toContainEqual(["Organisation", "Not connected"]);
  });
});
