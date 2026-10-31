import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { decideShellRoute, SHELL_DATA_APIS } from "@/lib/cpo-shell-policy";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { middleware } from "@/middleware";
import { MemoryStore } from "./__tests__/memory-store";
import { DatabaseUnavailableError, handleDirectory, handleInstallations, toView, type ApiDeps, type Repo } from "./api";
import { loadHistoryForTest } from "./__tests__/history";
import { discardDraft, getDraft, listDrafts, saveDraft } from "./drafts";
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
    contextDirectory: async () => null,
    listIncoming: async () => [],
    getBootCapture: async () => null,
    createOrganisation: async () => ({ id: ORG }),
    createSite: async (i) => (i.orgId === ORG ? { id: SITE } : null),
    saveDraft: (input, actor) => saveDraft(store, input, actor),
    discardDraft: (input, actor) => discardDraft(store, input, actor),
    getDraft: (id, actor) => getDraft(store, id, actor),
    listDrafts: (actor) => listDrafts(store, actor),
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
    expect(created.connection).toMatchObject({ status: "unverified" });
    // The CPO endpoint, with no installation segment; a charger adds its own id.
    expect(created.connection.cpoAddress).toMatch(/^wss:\/\/[a-z0-9-]+\.straumvakt\.org\/$/);
    expect(created.connection.cpoAddress).not.toContain(created.installation.key);
    expect(created.connection.cpoAddress).not.toMatch(/password|\?/);
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

describe("direct OEM onboarding on the installations endpoint", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const CRED = { action: "vendor-connect", vendor: "easee", username: "operator@example.org", password: "operator-secret-never" };

  const detail = (id: string | number = 4821) => ({
    id, name: "Grandavegur 3", siteKey: "ELFX-YA22", ratedCurrent: 63,
    // Everything below is outside the allowlist and must not be kept.
    contactInfo: { ownerName: "Jon Jonsson", ownerPhoneNumber: "+3545551234" }, accessToken: "token-never", costPerKWh: 18.5,
    circuits: [{ id: 11, panelName: "Panel A", ratedCurrent: 40, use3Phase: true, chargers: [{ id: "EH000001", name: "Bilskur 1" }, { id: "EH000002", name: "Bilskur 2" }] }],
  });

  type Hook = (url: string, method: string, body: Record<string, unknown> | null) => Response | null;
  function fakeVendor(b: { detail?: (ref: string) => Response; extra?: Hook } = {}) {
    const calls: string[] = [];
    // Every non-GET call except the vendor's own sign-in: the only way anything at the vendor could be changed.
    const writes: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(url);
      if (method !== "GET" && !/\/(accounts\/login|oauth\/token)$/.test(url)) writes.push(`${method} ${url}`);
      const custom = b.extra?.(url, method, typeof init?.body === "string" && init.body.startsWith("{") ? (JSON.parse(init.body) as Record<string, unknown>) : null);
      if (custom) return custom;
      if (url.endsWith("/api/accounts/login")) return Response.json({ accessToken: "easee-token-never", refreshToken: "refresh-never", expiresIn: 3600, accessClaims: ["Partner"] });
      if (url === "https://api.easee.com/api/sites") return Response.json([{ id: 4821, name: "Grandavegur 3" }, { id: 4822, name: "Hlidarendi" }]);
      const m = url.match(/\/api\/sites\/([^/]+)$/);
      if (m) return b.detail ? b.detail(m[1]) : Response.json(detail(m[1]));
      return new Response("", { status: 404 });
    }) as typeof fetch;
    return { calls, writes, fetcher };
  }

  // The vendor connection is bound to ONE shell session, so each test keeps one shell cookie for all its requests.
  const setup = async (vendorOn = true, behaviour: Parameters<typeof fakeVendor>[0] = {}, extraEnv: Record<string, string> = {}) => {
    const { deps, store } = fakeDeps();
    const fx = fakeVendor(behaviour);
    const shell = await cookie();
    return {
      store, fx, shell,
      deps: { ...deps, env: vendorOn ? { ...ENV, CPO_VENDOR_CONNECT: "easee,zaptec", ...extraEnv } : ENV, contextOrgId: ORG, vendor: { fetcher: fx.fetcher } } satisfies ApiDeps,
    };
  };
  const vendorCookie = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
  const onboardBody = (over: Record<string, unknown> = {}) => ({ action: "vendor-onboard", vendor: "easee", installationRef: "4821", siteId: SITE, idempotencyKey: crypto.randomUUID(), ...over });
  const connect = async (s: Awaited<ReturnType<typeof setup>>) => {
    const res = await post(s.deps, CRED, { cookie: s.shell });
    expect(res.status).toBe(200);
    return { res, vc: vendorCookie(res), cookie: `${s.shell}; ${vendorCookie(res)}` };
  };

  it("is switched off unless the deployment names the vendor, and needs the signed session and a same-origin JSON request", async () => {
    const off = await setup(false);
    const refused = await post(off.deps, CRED, { cookie: off.shell });
    expect(refused.status).toBe(404);
    expect((await refused.json()).error).toBe("vendor_connect_disabled");
    const on = await setup();
    expect((await post(on.deps, CRED, { cookie: on.shell, origin: "https://evil.example" })).status).toBe(403);
    expect((await post(on.deps, CRED, { cookie: "" })).status).toBe(401);
    expect((await post(on.deps, CRED, { cookie: on.shell, "content-type": "text/plain" })).status).toBe(415);
    expect(off.fx.calls.length + on.fx.calls.length).toBe(0);
    expect(off.store.state.installations.size + on.store.state.installations.size).toBe(0);
  });

  it("connects once, keeps the connection only in a sealed HttpOnly cookie, and returns no secret", async () => {
    const s = await setup();
    const { res } = await connect(s);
    const out = await res.json();
    expect(out).toMatchObject({ connected: true, vendor: "easee", installations: [{ id: "4821", name: "Grandavegur 3" }, { id: "4822", name: "Hlidarendi" }] });
    expect(JSON.stringify(out)).not.toMatch(/easee-token-never|refresh-never|operator-secret-never/);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^straumvakt_vc_easee=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toContain("Path=/api/cpo/installations");
    expect(setCookie).not.toContain("easee-token-never");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(s.fx.calls).toEqual(["https://api.easee.com/api/accounts/login", "https://api.easee.com/api/sites"]);
  });

  it("onboards the selected installation for the workspace CPO from the server's own vendor read, and keeps only the allowlisted snapshot", async () => {
    const s = await setup();
    const { cookie: c } = await connect(s);
    // An organisation and a package in the request are ignored: the CPO is the workspace's, and vendor data comes from the vendor.
    const res = await post(s.deps, onboardBody({ orgId: OTHER, ocppIds: { EH000001: "CP-1" }, package: { kind: "x", site: { ref: "4821", name: "Forged" } } }), { cookie: c });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ outcome: "created", vendor: "easee", displayName: "Grandavegur 3", circuits: 1, chargers: 1, electricalValuesAccepted: false });
    expect(out.pendingEquipment).toEqual([{ ref: "EH000002", name: "Bilskur 2", circuitRef: "11", serialNumber: null, reason: "needs_ocpp_identity" }]);
    // The registered one is reported as registered, the other as not registered; nothing is called complete, and nothing is "connected".
    expect(out.equipment.map((e: { ref: string; registration: string; connection: string }) => [e.ref, e.registration, e.connection])).toEqual([
      ["EH000001", "registered", "not_observed"], ["EH000002", "needs_identity", "not_observed"],
    ]);
    expect(out.complete).toBe(false);
    expect(out.registrationComplete).toBe(false);
    const row = dbState(s).installations.get(out.installationId)!;
    expect(row.orgId).toBe(ORG);
    expect(JSON.stringify(row.vendorImport)).not.toMatch(/Forged|Jon Jonsson|3545551234|token-never|"(costPerKWh|contactInfo|accessToken)"\s*:/);
    // Not accepted, so the vendor's 40 A stays unknown on the circuit while remaining in the snapshot.
    expect([...dbState(s).circuits.values()][0]).toMatchObject({ ratingAmps: null, phaseCount: null, vendorRef: "11" });
    expect(JSON.stringify(row.vendorImport)).toContain('"ratedCurrentAmps":40');
    // Connect (2 reads) + exactly one site-detail read for the one installation.
    expect(s.fx.calls).toHaveLength(3);
    expect(s.fx.calls[2]).toBe("https://api.easee.com/api/sites/4821");
  });

  it("answers a repeat under a new key with the existing installation and writes nothing", async () => {
    const s = await setup();
    const { cookie: c } = await connect(s);
    const first = await (await post(s.deps, onboardBody(), { cookie: c })).json();
    const changes = dbState(s).changes.length;
    const second = await post(s.deps, onboardBody(), { cookie: c });
    expect(second.status).toBe(200);
    const again = await second.json();
    expect(again).toMatchObject({ outcome: "already_imported", installationId: first.installationId });
    // Nothing was typed this time, so both chargers are still reported as needing an id; none is attached or duplicated.
    expect(again.pendingEquipment).toHaveLength(2);
    expect(again.chargers).toBe(0);
    expect(dbState(s).installations.size).toBe(1);
    expect(dbState(s).changes.length).toBe(changes);
  });

  it("onboards several selected installations as independent requests: one failing does not undo another", async () => {
    const s = await setup();
    const { cookie: c } = await connect(s);
    const a = await post(s.deps, onboardBody({ installationRef: "4821" }), { cookie: c });
    const bad = await post(s.deps, onboardBody({ installationRef: "4822", siteId: crypto.randomUUID() }), { cookie: c });
    const b = await post(s.deps, onboardBody({ installationRef: "4822" }), { cookie: c });
    expect([a.status, bad.status, b.status]).toEqual([200, 404, 200]);
    expect(dbState(s).installations.size).toBe(2);
  });

  it("refuses onboarding without a connection, with one made in another shell session, and after disconnect, reading nothing", async () => {
    const s = await setup();
    expect((await post(s.deps, onboardBody(), { cookie: s.shell })).status).toBe(409);
    const { cookie: c, vc } = await connect(s);
    const reads = s.fx.calls.length;
    // Another login is a different shell session: the earlier connection is dead and is cleared.
    const otherShell = await cookie(CONFIG, Math.floor(Date.now() / 1000) + 5);
    expect(otherShell).not.toBe(s.shell);
    const foreign = await post(s.deps, onboardBody(), { cookie: `${otherShell}; ${vc}` });
    expect(foreign.status).toBe(409);
    expect((await foreign.json()).error).toBe("connection_required");
    expect(foreign.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(s.fx.calls.length).toBe(reads);

    const bye = await post(s.deps, { action: "vendor-disconnect", vendor: "easee" }, { cookie: c });
    expect(bye.status).toBe(200);
    expect(bye.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(dbState(s).installations.size).toBe(0);
  });

  it("passes a vendor rate limit on with Retry-After and remembers it, without creating anything", async () => {
    const s = await setup(true, { detail: () => new Response("", { status: 429, headers: { "retry-after": "45" } }) });
    const { cookie: c } = await connect(s);
    const res = await post(s.deps, onboardBody(), { cookie: c });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("45");
    expect((await res.json()).retryAfter).toBe(45);
    expect(res.headers.get("set-cookie")).toContain("straumvakt_vw_easee");
    expect(dbState(s).installations.size).toBe(0);
  });

  it("refuses an invalid request, a wrong site and a clashing OCPP id with the right status and no write", async () => {
    const s = await setup();
    const { cookie: c } = await connect(s);
    expect((await post(s.deps, onboardBody({ siteId: "not-a-uuid" }), { cookie: c })).status).toBe(422);
    expect((await post(s.deps, onboardBody({ siteId: crypto.randomUUID() }), { cookie: c })).status).toBe(404);
    expect((await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1", EH000002: "cp-1" } }), { cookie: c })).status).toBe(422);
    expect(dbState(s).installations.size).toBe(0);
    expect((await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: c })).status).toBe(200);
    const clash = await post(s.deps, onboardBody({ installationRef: "4822", ocppIds: { EH000001: "CP-1" } }), { cookie: c });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toBe("identity_in_use");
    expect(dbState(s).installations.size).toBe(1);
  });

  it("has no file-based import: the old action creates nothing, and the normal save and draft actions are unchanged", async () => {
    const s = await setup();
    const gone = await post(s.deps, { action: "import-vendor", siteId: SITE, idempotencyKey: crypto.randomUUID(), package: { kind: "straumvakt-vendor-site" } }, { cookie: s.shell });
    expect([400, 422]).toContain(gone.status);
    expect(dbState(s).installations.size).toBe(0);
    const created = await (await post(s.deps, body({ vendorImport: undefined }), { cookie: s.shell })).json();
    expect(created.installation.id).toBeTruthy();
    const draft = await post(s.deps, { action: "save-draft", draftId: crypto.randomUUID(), orgId: ORG, payload: {} }, { cookie: s.shell });
    expect([200, 201]).toContain(draft.status);
  });

  // ── Chargers: registration, retry and configuration ──────────────────────
  const withSerials = (id: string | number = 4821) => ({
    id, name: "Grandavegur 3", ratedCurrent: 63,
    circuits: [{ id: 11, panelName: "Panel A", ratedCurrent: 40, use3Phase: true, chargers: [
      { id: "EH000001", name: "Bilskur 1", serialNumber: "EH000001" },
      { id: "EH000002", name: "Bilskur 2", serialNumber: "EH000002" },
    ] }],
  });
  const ADDR = "wss://nordic-charge.straumvakt.org";
  const LOCAL = "https://api.easee.com/local-ocpp/v1";

  it("registers typed chargers on the first save and attaches the rest on a retry, to the right circuit, without duplicating any", async () => {
    const s = await setup(true, { detail: (r) => Response.json(withSerials(r)) });
    const { cookie: c } = await connect(s);
    const first = await (await post(s.deps, onboardBody(), { cookie: c })).json();
    expect(first.chargers).toBe(0);
    expect(first.equipment.map((e: { registration: string }) => e.registration)).toEqual(["needs_identity", "needs_identity"]);
    expect(first.equipment[0].serialNumber).toBe("EH000001");

    const retry = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1", EH000002: "CP-2" } }), { cookie: c })).json();
    expect(retry).toMatchObject({ outcome: "already_imported", installationId: first.installationId, chargers: 2, registrationComplete: true });
    expect(retry.equipment.map((e: { registration: string; chargePointId: string }) => [e.registration, e.chargePointId])).toEqual([["registered", "CP-1"], ["registered", "CP-2"]]);
    const snapshot = s.store.snapshot(first.installationId)!;
    const circuit = [...dbState(s).circuits.values()].find((x) => x.vendorRef === "11")!;
    expect(snapshot.chargers.map((x) => [x.chargePointId, x.circuitId, x.serialNumber])).toEqual([["CP-1", circuit.id, "EH000001"], ["CP-2", circuit.id, "EH000002"]]);
    expect(dbState(s).installations.size).toBe(1);

    // The same request again: nothing is created, moved or written, and each charger is reported as already registered.
    const changes = dbState(s).changes.length;
    const again = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1", EH000002: "CP-2" } }), { cookie: c })).json();
    expect(again.equipment.map((e: { registration: string }) => e.registration)).toEqual(["already_registered", "already_registered"]);
    expect(dbState(s).changes.length).toBe(changes);
    expect(s.store.snapshot(first.installationId)!.chargers).toHaveLength(2);
  });

  it("recognises a registered charger by its explicit serial when no id is sent, and refuses an id registered for different equipment", async () => {
    const s = await setup(true, { detail: (r) => Response.json(withSerials(r)) });
    const { cookie: c } = await connect(s);
    await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: c });
    const later = await (await post(s.deps, onboardBody(), { cookie: c })).json();
    expect(later.equipment.map((e: { ref: string; registration: string; chargePointId: string | null }) => [e.ref, e.registration, e.chargePointId])).toEqual([
      ["EH000001", "already_registered", "CP-1"], ["EH000002", "needs_identity", null],
    ]);
    // CP-1 belongs to EH000001; asking for it on EH000002 must not take it over.
    const clash = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1", EH000002: "CP-1" } }), { cookie: c })).json();
    expect(clash.error ?? clash.equipment.find((e: { ref: string }) => e.ref === "EH000002").registration).toMatch(/validation|failed/);
    expect(s.store.snapshot(later.installationId)!.chargers.map((x) => x.chargePointId)).toEqual(["CP-1"]);
  });

  it("does not touch the vendor beyond reads when configuration is not switched on, and says what address to set", async () => {
    const s = await setup(true, { detail: (r) => Response.json(withSerials(r)) });
    const { cookie: c } = await connect(s);
    const out = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: c })).json();
    expect(out.equipment[0].configuration).toMatchObject({ state: "blocked", code: "not_enabled" });
    expect(out.equipment[0].address).toBe(`${ADDR}/CP-1`);
    expect(out.complete).toBe(false);
    expect(s.fx.writes).toEqual([]);
    expect(s.fx.calls.some((u) => u.includes("local-ocpp"))).toBe(false);
  });

  it("configures an Easee charger only after it is registered: read first, store and apply the dual-protocol address, read back — and never reports it connected", async () => {
    let applied = false;
    const order: string[] = [];
    const extra: Hook = (url, method, b) => {
      if (!url.startsWith(`${LOCAL}/`)) return null;
      order.push(`${method} ${url.slice(LOCAL.length)}`);
      if (url === `${LOCAL}/connection-details/EH000001` && method === "GET") {
        return applied ? Response.json({ connectivityMode: "DualProtocol", websocketConnectionArgs: { url: ADDR }, chargePointId: "CP-1", version: 7 }) : new Response("", { status: 404 });
      }
      if (url === `${LOCAL}/connection-details/EH000001` && method === "POST") {
        expect(b).toEqual({ connectivityMode: "DualProtocol", websocketConnectionArgs: { url: ADDR }, chargePointId: "CP-1" });
        return Response.json({ version: 7 });
      }
      if (url === `${LOCAL}/connections/chargers/EH000001` && method === "POST") { expect(b).toEqual({ version: "7" }); applied = true; return Response.json({}); }
      return new Response("", { status: 404 });
    };
    const s = await setup(true, { detail: (r) => Response.json(withSerials(r)), extra }, { CPO_VENDOR_CONFIGURE: "easee" });
    const { cookie: c } = await connect(s);
    const out = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: c })).json();
    expect(out.equipment[0]).toMatchObject({ registration: "registered", connection: "not_observed", configuration: { state: "configured", code: "ok" } });
    // Registered in the database before the vendor was asked to change anything.
    expect(s.store.snapshot(out.installationId)!.chargers.map((x) => x.chargePointId)).toEqual(["CP-1"]);
    expect(order).toEqual(["GET /connection-details/EH000001", "POST /connection-details/EH000001", "POST /connections/chargers/EH000001", "GET /connection-details/EH000001"]);
    // Only the unregistered second charger is left; it was not configured.
    expect(out.equipment[1]).toMatchObject({ registration: "needs_identity", configuration: null });
    expect(out.complete).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/easee-token-never|basicAuthPassword/);

    // A retry finds it already configured and writes nothing more.
    const writes = s.fx.writes.length;
    const retry = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: c })).json();
    expect(retry.equipment.find((e: { ref: string }) => e.ref === "EH000001").configuration).toMatchObject({ state: "already_configured" });
    expect(s.fx.writes.length).toBe(writes);
  });

  it("never overwrites a charger that already points at another backend, or at Straumvakt under another id", async () => {
    const stored: Record<string, string> = { EH000001: "wss://other-backend.example.com/ocpp", EH000002: `${ADDR}/SOMETHING-ELSE` };
    const extra: Hook = (url, method) => {
      const m = url.match(/local-ocpp\/v1\/connection-details\/(EH\d+)$/);
      if (!m) return url.startsWith(LOCAL) ? new Response("", { status: 404 }) : null;
      return method === "GET" ? Response.json({ connectivityMode: "DualProtocol", websocketConnectionArgs: { url: stored[m[1]] }, chargePointId: m[1] === "EH000002" ? undefined : "X" }) : new Response("", { status: 500 });
    };
    const s = await setup(true, { detail: (r) => Response.json(withSerials(r)), extra }, { CPO_VENDOR_CONFIGURE: "easee" });
    const { cookie: c } = await connect(s);
    const out = await (await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1", EH000002: "CP-2" } }), { cookie: c })).json();
    expect(out.equipment[0].configuration).toMatchObject({ state: "blocked", code: "different_backend" });
    expect(out.equipment[0].configuration.message).toContain("other-backend.example.com");
    expect(out.equipment[0].configuration.message).not.toContain("/ocpp");
    expect(out.equipment[1].configuration).toMatchObject({ state: "blocked", code: "identity_mismatch" });
    expect(s.fx.writes).toEqual([]);
    // The installation and both chargers are kept: the configuration problem does not undo the registration.
    expect(out.chargers).toBe(2);
    expect(out.complete).toBe(false);
  });

  it("blocks configuration it cannot do safely: no serial, no permission, and a refused apply that leaves nothing reported as done", async () => {
    // No explicit serial in the vendor data.
    const a = await setup(true, {}, { CPO_VENDOR_CONFIGURE: "easee" });
    const ca = await connect(a);
    const noSerial = await (await post(a.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: ca.cookie })).json();
    expect(noSerial.equipment[0].configuration).toMatchObject({ state: "blocked", code: "serial_unverified" });
    expect(a.fx.writes).toEqual([]);

    // The vendor refuses this account for the charger.
    const b = await setup(true, { detail: (r) => Response.json(withSerials(r)), extra: (url) => (url.startsWith(LOCAL) ? new Response("", { status: 403 }) : null) }, { CPO_VENDOR_CONFIGURE: "easee" });
    const cb = await connect(b);
    const denied = await (await post(b.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: cb.cookie })).json();
    expect(denied.equipment[0].configuration).toMatchObject({ state: "blocked", code: "prerequisites" });
    expect(b.fx.writes).toEqual([]);

    // Stored but not applied: reported as failed, not configured.
    const extra: Hook = (url, method) => {
      if (!url.startsWith(LOCAL)) return null;
      if (method === "GET") return new Response("", { status: 404 });
      return url.includes("/connections/chargers/") ? new Response("", { status: 500 }) : Response.json({ version: 3 });
    };
    const d = await setup(true, { detail: (r) => Response.json(withSerials(r)), extra }, { CPO_VENDOR_CONFIGURE: "easee" });
    const cd = await connect(d);
    const half = await (await post(d.deps, onboardBody({ ocppIds: { EH000001: "CP-1" } }), { cookie: cd.cookie })).json();
    expect(half.equipment[0].configuration).toMatchObject({ state: "failed", code: "apply_failed" });
    expect(half.complete).toBe(false);
  });

  it("stops configuring on a vendor rate limit and remembers the wait, keeping what was registered", async () => {
    const extra: Hook = (url) => (url.startsWith(LOCAL) ? new Response("", { status: 429, headers: { "retry-after": "40" } }) : null);
    const s = await setup(true, { detail: (r) => Response.json(withSerials(r)), extra }, { CPO_VENDOR_CONFIGURE: "easee" });
    const { cookie: c } = await connect(s);
    const res = await post(s.deps, onboardBody({ ocppIds: { EH000001: "CP-1", EH000002: "CP-2" } }), { cookie: c });
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.chargers).toBe(2);
    expect(out.equipment.map((e: { configuration: { state: string } }) => e.configuration.state)).toEqual(["not_attempted", "not_attempted"]);
    expect(out.configurationRetryAfter).toBe(40);
    expect(res.headers.get("set-cookie")).toContain("straumvakt_vw_easee");
    // Only the first charger was asked about.
    expect(s.fx.calls.filter((u) => u.includes("local-ocpp"))).toHaveLength(1);
  });

  // ── Zaptec, through the same flow ─────────────────────────────────────────
  const ZI = "7d722149-3c5f-4488-8bf2-e660503e11e9";
  const ZC = "03278fc6-ab76-47af-9ccc-b84e90e07284";
  const zaptec = (over: { auth?: number; installationUrl?: string | null; chargerUrl?: string | null } = {}): Hook => (url, method) => {
    if (url === "https://api.zaptec.com/oauth/token") return Response.json({ access_token: "zaptec-token-never", expires_in: 3600 });
    if (!url.startsWith("https://api.zaptec.com/api/")) return null;
    if (url.startsWith("https://api.zaptec.com/api/installation?")) return Response.json({ Pages: 1, Data: [{ Id: ZI, Name: "Dalvegur 10 - 14", ActiveChargerCount: 1 }] });
    if (url === `https://api.zaptec.com/api/installation/${ZI}`) {
      return Response.json({ Id: ZI, Name: "Dalvegur 10 - 14", Address: "Dalvegur 8", City: "Kopavogur", NetworkType: 4, MaxCurrent: 100, UseLoadBalancing: true,
        AuthenticationType: over.auth ?? 2, OcppCloudUrl: over.installationUrl ?? null, OcppInitialChargePointPassword: "pw-never", InstallationUsers: [{ UserEmail: "driver@example.org" }] });
    }
    if (url === `https://api.zaptec.com/api/installation/${ZI}/hierarchy`) {
      return Response.json({ Id: ZI, Name: "Dalvegur 10 - 14", Circuits: [{ Id: "c1c1c1c1-0000-4000-8000-000000000001", Name: "Circuit A", MaxCurrent: 32, Chargers: [{ Id: ZC, Name: "Festi 5", DeviceId: "ZCS032822", SerialNo: "OLD-never" }] }] });
    }
    if (url === `https://api.zaptec.com/api/chargers/${ZC}` && method === "GET") return Response.json({ Id: ZC, DeviceId: "ZCS032822", PropertyOcppUrl: over.chargerUrl ?? null });
    return new Response("", { status: 404 });
  };
  const zConnect = async (s: Awaited<ReturnType<typeof setup>>) => {
    const res = await post(s.deps, { action: "vendor-connect", vendor: "zaptec", username: "operator@example.org", password: "operator-secret-never" }, { cookie: s.shell });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^straumvakt_vc_zaptec=/);
    return `${s.shell}; ${vendorCookie(res)}`;
  };
  const zBody = (over: Record<string, unknown> = {}) => onboardBody({ vendor: "zaptec", installationRef: ZI, ...over });

  it("onboards a Zaptec installation through the same flow: structure, a charger with its physical serial, the supply system on acceptance", async () => {
    const s = await setup(true, { extra: zaptec() });
    const c = await zConnect(s);
    const out = await (await post(s.deps, zBody({ acceptVendorElectrical: true, ocppIds: { [ZC]: "ZAP-FESTI5" } }), { cookie: c })).json();
    expect(out).toMatchObject({ outcome: "created", vendor: "zaptec", displayName: "Dalvegur 10 - 14", circuits: 1, chargers: 1 });
    expect(out.equipment[0]).toMatchObject({ ref: ZC, serialNumber: "ZCS032822", chargePointId: "ZAP-FESTI5", registration: "registered" });
    const snapshot = s.store.snapshot(out.installationId)!;
    // The OCPP id is what the operator chose; the vendor UUID and the serial are neither of them.
    expect(snapshot.chargers[0]).toMatchObject({ chargePointId: "ZAP-FESTI5", serialNumber: "ZCS032822", vendor: "Zaptec" });
    expect(snapshot.installation).toMatchObject({ mainGridType: "TN", mainPhaseCount: 3, mainRatingAmps: null });
    expect(snapshot.circuits[0]).toMatchObject({ ratingAmps: 32, phaseCount: 3 });
    // Nothing outside the allowlist: not the OCPP password, not the user list, not the deprecated serial field.
    const stored = JSON.stringify(dbState(s).installations.get(out.installationId)!.vendorImport);
    // (The NAMES of the fields the read saw are kept on purpose; their values are not.)
    expect(stored).not.toMatch(/pw-never|driver@example\.org|OLD-never|zaptec-token-never|"(OcppInitialChargePointPassword|InstallationUsers|SerialNo)"\s*:/);
    expect(s.fx.writes).toEqual([]);
  });

  it("classifies Zaptec's current OCPP settings and never changes them: not cloud mode, another backend, our address, nothing set", async () => {
    const run = async (over: Parameters<typeof zaptec>[0]) => {
      const s = await setup(true, { extra: zaptec(over) }, { CPO_VENDOR_CONFIGURE: "zaptec" });
      const c = await zConnect(s);
      const out = await (await post(s.deps, zBody({ ocppIds: { [ZC]: "ZAP-FESTI5" } }), { cookie: c })).json();
      expect(s.fx.writes).toEqual([]);
      expect(out.chargers).toBe(1);
      return out.equipment[0].configuration as { state: string; code: string; message: string };
    };
    expect(await run({ auth: 3 })).toMatchObject({ state: "blocked", code: "not_cloud_mode" });
    const foreign = await run({ installationUrl: "wss://beta.connect.longship.io/tenant/{deviceId}" });
    expect(foreign).toMatchObject({ state: "blocked", code: "different_backend" });
    expect(foreign.message).toContain("beta.connect.longship.io");
    expect(foreign.message).not.toContain("tenant");
    expect(await run({ installationUrl: `${ADDR}/ZAP-FESTI5` })).toMatchObject({ state: "already_configured" });
    expect(await run({ chargerUrl: `${ADDR}/{deviceId}` })).toMatchObject({ state: "blocked", code: "identity_mismatch" });
    const unset = await run({});
    expect(unset).toMatchObject({ state: "blocked", code: "write_contract_unconfirmed" });
    expect(unset.message).toContain(`${ADDR}/ZAP-FESTI5`);
  });

  it("keeps a Zaptec connection out of Easee and the reverse, and a vendor connect for a vendor not listed is refused", async () => {
    const s = await setup(true, { extra: zaptec() });
    const z = await zConnect(s);
    const wrong = await post(s.deps, onboardBody(), { cookie: z });
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).error).toBe("connection_required");
    const only = await setup(true, {}, { CPO_VENDOR_CONNECT: "easee" });
    const refused = await post(only.deps, { action: "vendor-connect", vendor: "zaptec", username: "u@example.org", password: "p" }, { cookie: only.shell });
    expect(refused.status).toBe(404);
    expect(only.fx.calls).toEqual([]);
  });
});

const dbState = (s: { store: MemoryStore }) => s.store.state;

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
