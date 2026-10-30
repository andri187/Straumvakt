import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { decideShellRoute, SHELL_DATA_APIS } from "@/lib/cpo-shell-policy";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { middleware } from "@/middleware";
import { MemoryStore } from "./__tests__/memory-store";
import { DatabaseUnavailableError, handleDirectory, handleInstallations, toView, type ApiDeps, type Repo } from "./api";
import { loadHistoryForTest } from "./__tests__/history";
import { saveInstallation } from "./service";

const HTTPS = "https://shell.example.test";
const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";

async function cookie(config: ShellConfig = CONFIG, now?: number) {
  return `${SHELL_COOKIE_NAME}=${await createShellSession(config, now)}`;
}

function fakeDeps(store = new MemoryStore()) {
  store.seedOrg(ORG, "Nordic Charge", SITE);
  const repo: Repo = {
    save: (input, actor) => saveInstallation(store, input, actor),
    get: async (id) => {
      const snapshot = store.snapshot(id);
      return snapshot ? { snapshot, routingId: store.state.orgs.get(snapshot.installation.orgId)?.routing ?? null, history: loadHistoryForTest(store, id) } : null;
    },
    list: async () => [],
    directory: async () => ({ organisations: [{ id: ORG, displayName: "Nordic Charge", routingId: null }], sites: [] }),
    createOrganisation: async () => ({ id: ORG }),
    createSite: async (i) => (i.orgId === ORG ? { id: SITE } : null),
  };
  const deps: ApiDeps = { env: ENV, withRepo: async (fn) => fn(repo) };
  return { store, deps };
}

const body = (over: Record<string, unknown> = {}) => ({
  orgId: ORG,
  siteId: SITE,
  idempotencyKey: crypto.randomUUID(),
  installation: { displayName: "Harbour" },
  electrician: {},
  circuits: [],
  chargers: [],
  ...over,
});

async function post(deps: ApiDeps, payload: unknown, headers: Record<string, string> = {}, path = "/api/cpo/installations") {
  return handleInstallations(
    new Request(`${HTTPS}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: HTTPS, cookie: await cookie(), ...headers },
      body: JSON.stringify(payload),
    }),
    deps,
  );
}

describe("authentication and request guards", () => {
  it("rejects missing, forged, expired and admin-cookie sessions with 401 before touching storage", async () => {
    let touched = false;
    const deps: ApiDeps = { env: ENV, withRepo: async () => { touched = true; throw new Error("storage reached"); } };
    const get = (c?: string) => handleInstallations(new Request(`${HTTPS}/api/cpo/installations`, { headers: c ? { cookie: c } : {} }), deps);
    expect((await get()).status).toBe(401);
    expect((await get(`${SHELL_COOKIE_NAME}=forged.token`)).status).toBe(401);
    const other = { ...CONFIG, secret: "a-different-signing-secret-0123456789abcdef" };
    expect((await get(await cookie(other))).status).toBe(401);
    expect((await get(await cookie(CONFIG, Math.floor(Date.now() / 1000) - 3600 * 24))).status).toBe(401);
    expect((await get("straumvakt_admin_session=anything")).status).toBe(401);
    expect(touched).toBe(false);
  });

  it("is closed when the shell is not configured", async () => {
    const res = await handleInstallations(new Request(`${HTTPS}/api/cpo/installations`, { headers: { cookie: await cookie() } }), { env: {}, withRepo: async (f) => f({} as Repo) });
    expect(res.status).toBe(401);
  });

  it("refuses cross-origin, non-JSON and oversized state-changing requests", async () => {
    const { deps, store } = fakeDeps();
    expect((await post(deps, body(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(deps, body(), { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post(deps, body(), { "content-length": String(10 * 1024 * 1024) })).status).toBe(400);
    expect(store.state.installations.size).toBe(0);
  });

  it("answers every response with no-store and refuses other methods", async () => {
    const { deps } = fakeDeps();
    const res = await handleInstallations(new Request(`${HTTPS}/api/cpo/installations`, { method: "DELETE", headers: { cookie: await cookie() } }), deps);
    expect(res.status).toBe(405);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const ok = await handleDirectory(new Request(`${HTTPS}/api/cpo/directory`, { headers: { cookie: await cookie() } }), deps);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });
});

describe("installations API", () => {
  it("creates, reads back and edits; actor comes from the session, not the body", async () => {
    const { deps, store } = fakeDeps();
    const res = await post(deps, body({ actor: "someone-else", actorKind: "user", electrician: { name: "Jón" } }));
    expect(res.status).toBe(200);
    const created = await res.json();
    expect(created.installation.key).toMatch(/^[a-z0-9]{12}$/);
    expect(created.connection).toMatchObject({ status: "not_active" });
    expect(created.connection.address).toContain(`.straumvakt.org/${created.installation.key}/`);
    expect(created.connection.address).not.toMatch(/password|\?/);
    expect(store.state.changes.every((c) => c.actorLabel === 'shared login "ShellTester"')).toBe(true);

    const read = await handleInstallations(new Request(`${HTTPS}/api/cpo/installations?id=${created.installation.id}`, { headers: { cookie: await cookie() } }), deps);
    expect(read.status).toBe(200);
    expect((await read.json()).history.length).toBeGreaterThan(0);
  });

  it("never exposes a password or verifier in any response, but returns a generated one exactly once", async () => {
    const { deps } = fakeDeps();
    const res = await post(deps, body({ password: { action: "generate" } }));
    const created = await res.json();
    expect(created.generatedPassword).toHaveLength(24);
    expect(JSON.stringify({ ...created, generatedPassword: undefined })).not.toMatch(/pbkdf2|verifier/i);
    const read = await handleInstallations(new Request(`${HTTPS}/api/cpo/installations?id=${created.installation.id}`, { headers: { cookie: await cookie() } }), deps);
    const text = await read.text();
    expect(text).not.toContain(created.generatedPassword);
    expect(text).not.toMatch(/pbkdf2/);
    expect(JSON.parse(text).installation.password.mode).toBe("password");
  });

  it("returns 422 with field paths, 409 for a stale revision, and 404 without existence disclosure", async () => {
    const { deps } = fakeDeps();
    const bad = await post(deps, body({ installation: { displayName: "" } }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).problems[0].path).toBe("installation.displayName");

    const created = await (await post(deps, body())).json();
    const edit = (rev: number, name: string) => body({ installationId: created.installation.id, expectedRevision: rev, orgId: undefined, siteId: undefined, installation: { displayName: name } });
    expect((await post(deps, edit(1, "One"))).status).toBe(200);
    const stale = await post(deps, edit(1, "Two"));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale_revision", currentRevision: 2 });

    const unknown = await post(deps, body({ installationId: crypto.randomUUID(), expectedRevision: 1, orgId: undefined, siteId: undefined }));
    expect(unknown.status).toBe(404);
  });

  it("returns 409 for a duplicate serial without naming where the other device is", async () => {
    const { deps } = fakeDeps();
    const mk = (cp: string) => body({ circuits: [{ id: "new-c", parentId: null, displayName: "C" }], chargers: [{ id: "new-1", circuitId: "new-c", label: "L", chargePointId: cp, serialNumber: "SN-1" }] });
    expect((await post(deps, mk("A"))).status).toBe(200);
    const dup = await post(deps, mk("B"));
    expect(dup.status).toBe(409);
    const text = await dup.text();
    expect(JSON.parse(text).error).toBe("serial_in_use");
    expect(text).not.toMatch(/installation|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("reports an unconfigured database as 503 and an unexpected failure as a generic 500", async () => {
    const down: ApiDeps = { env: ENV, withRepo: async () => { throw new DatabaseUnavailableError(); } };
    expect((await post(down, body())).status).toBe(503);
    const boom: ApiDeps = { env: ENV, withRepo: async () => { throw new Error("connection string postgres://user:secret@host/db"); } };
    const res = await post(boom, body());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });

  it("presents unknown capacity as a zero allowance that is not a confirmed limit", async () => {
    const { deps, store } = fakeDeps();
    const created = await (await post(deps, body({ circuits: [{ id: "new-c", parentId: null, displayName: "C" }] }))).json();
    expect(created.circuits[0]).toMatchObject({ ratingAmps: null, phaseCount: null, allowance: { amps: 0, basis: "unknown" } });
    expect(created.enforcement.status).toBe("unavailable");
    const view = toView(store.snapshot(created.installation.id)!, null);
    expect(view.installation.mainRatingAmps).toBeNull();
  });
});

describe("directory API", () => {
  it("lists, creates and refuses a site for an unknown organisation", async () => {
    const { deps } = fakeDeps();
    const h = { "content-type": "application/json", origin: HTTPS, cookie: await cookie() };
    const make = (b: unknown) => handleDirectory(new Request(`${HTTPS}/api/cpo/directory`, { method: "POST", headers: h, body: JSON.stringify(b) }), deps);
    expect((await make({ action: "create-organisation", displayName: "Fjord Charging" })).status).toBe(201);
    expect((await make({ action: "create-site", orgId: ORG, displayName: "Pier 1", address: "Hafnarstræti 1" })).status).toBe(201);
    expect((await make({ action: "create-site", orgId: crypto.randomUUID(), displayName: "Pier 2" })).status).toBe(404);
    expect((await make({ action: "create-organisation", displayName: "x" })).status).toBe(422);
    expect((await make({ action: "nope", displayName: "Valid name" })).status).toBe(400);
  });
});

describe("route policy for the data APIs", () => {
  it("exposes exactly the four data endpoints, only to a session, and still 404s everything else", () => {
    expect([...SHELL_DATA_APIS].sort()).toEqual(["/api/cpo/directory", "/api/cpo/installations", "/api/cpo/lifecycle", "/api/cpo/sync"]);
    for (const p of SHELL_DATA_APIS) {
      // The sync handler owns its cache headers (ETag revalidation); every other data API is no-store at the gate.
      expect(decideShellRoute({ pathname: p, hasSession: true })).toEqual({ action: "next", noStore: p !== "/api/cpo/sync" });
      expect(decideShellRoute({ pathname: p, hasSession: false })).toEqual({ action: "unauthorized" });
    }
    for (const p of ["/api/cpo", "/api/cpo/", "/api/cpo/installations/", "/api/cpo/installations/x", "/api/cpo/other", "/api/admin/installations"]) {
      expect(decideShellRoute({ pathname: p, hasSession: true })).toEqual({ action: "notFound" });
    }
  });

  it("the middleware answers an unauthenticated data-API request with 401 JSON, not a redirect", async () => {
    const res = await middleware(new NextRequest(`${HTTPS}/api/cpo/installations`));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});
