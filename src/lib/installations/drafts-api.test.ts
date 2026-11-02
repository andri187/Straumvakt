// The draft actions of /api/cpo/installations: same guards as every other
// state-changing request, no new route (the shell's allow-list is exact paths),
// and a view that never claims the address is live.

import { describe, expect, it } from "vitest";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { MemoryStore } from "./__tests__/memory-store";
import { DatabaseUnavailableError, handleInstallations, type ApiDeps, type Repo } from "./api";
import { discardDraft, getDraft, listDrafts, saveDraft } from "./drafts";
import { saveInstallation } from "./service";

const HTTPS = "https://shell.example.test";
const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";

const cookie = async () => `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}`;

function fakeDeps() {
  const store = new MemoryStore();
  store.seedOrg(ORG, "Nordic Charge", SITE);
  const repo: Repo = {
    save: (input, actor) => saveInstallation(store, input, actor),
    get: async (id) => {
      const snapshot = store.snapshot(id);
      return snapshot ? { snapshot, routingId: store.state.orgs.get(snapshot.installation.orgId)?.routing ?? null, history: [] } : null;
    },
    list: async () => [],
    listChargers: async () => [],
    revisions: async () => ({}),
    getTree: async () => null,
    directory: async () => ({ organisations: [], sites: [] }),
    contextDirectory: async () => null,
    listIncoming: async () => [],
    getBootCapture: async () => null,
    createOrganisation: async () => ({ id: ORG }),
    createSite: async () => null,
    saveDraft: (input, actor) => saveDraft(store, input, actor),
    discardDraft: (input, actor) => discardDraft(store, input, actor),
    getDraft: (id, actor) => getDraft(store, id, actor),
    listDrafts: (actor) => listDrafts(store, actor),
  };
  const deps: ApiDeps = { env: ENV, withRepo: async (fn) => fn(repo) };
  return { store, deps };
}

async function post(deps: ApiDeps, payload: unknown, headers: Record<string, string> = {}) {
  return handleInstallations(
    new Request(`${HTTPS}/api/cpo/installations`, { method: "POST", headers: { "content-type": "application/json", origin: HTTPS, cookie: await cookie(), ...headers }, body: JSON.stringify(payload) }),
    deps,
  );
}
async function get(deps: ApiDeps, query: string) {
  return handleInstallations(new Request(`${HTTPS}/api/cpo/installations?${query}`, { headers: { cookie: await cookie() } }), deps);
}

const form = (over: Record<string, unknown> = {}) => ({ name: "Harbour", siteId: "", mainType: "", mainAmps: "", mainPhases: "", eName: "", eEmail: "", ePhone: "", effectiveAt: "", pwPending: false, circuits: [], chargers: [], ...over });
const saveDraftCall = (deps: ApiDeps, over: Record<string, unknown> = {}) => post(deps, { action: "save-draft", draftId: crypto.randomUUID(), orgId: ORG, payload: form(), ...over });
const create = (deps: ApiDeps, over: Record<string, unknown> = {}) =>
  post(deps, { orgId: ORG, siteId: SITE, idempotencyKey: crypto.randomUUID(), installation: { displayName: "Harbour" }, electrician: {}, circuits: [], chargers: [], ...over });

describe("save-draft", () => {
  it("creates a draft (201), returns the form and revision, and creates no installation", async () => {
    const { deps, store } = fakeDeps();
    const id = crypto.randomUUID();
    const res = await saveDraftCall(deps, { draftId: id, payload: form({ name: "Pier 4", mainAmps: "63x" }) });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ created: true, unchanged: false, draft: { id, orgId: ORG, orgName: "Nordic Charge", name: "Pier 4", state: "open", revision: 1 } });
    expect(body.draft.payload.mainAmps).toBe("63x"); // as typed, not validated
    expect(JSON.stringify(body)).not.toMatch(/password|verifier/i);
    expect(store.state.installations.size).toBe(0);
  });

  it("answers a repeat of the same save with 200 and no new revision; a changed save needs the revision", async () => {
    const { deps } = fakeDeps();
    const id = crypto.randomUUID();
    await saveDraftCall(deps, { draftId: id });
    const repeat = await saveDraftCall(deps, { draftId: id });
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).unchanged).toBe(true);
    const blind = await saveDraftCall(deps, { draftId: id, payload: form({ name: "Other" }) });
    expect(blind.status).toBe(409);
    expect(await blind.json()).toMatchObject({ error: "stale_revision", currentRevision: 1 });
    const ok = await saveDraftCall(deps, { draftId: id, expectedRevision: 1, payload: form({ name: "Other" }) });
    expect((await ok.json()).draft.revision).toBe(2);
  });

  it("refuses a late save built on an older revision without overwriting", async () => {
    const { deps } = fakeDeps();
    const id = crypto.randomUUID();
    await saveDraftCall(deps, { draftId: id });
    await saveDraftCall(deps, { draftId: id, expectedRevision: 1, payload: form({ name: "Newer" }) });
    const late = await saveDraftCall(deps, { draftId: id, expectedRevision: 1, payload: form({ name: "Older" }) });
    expect(late.status).toBe(409);
    const read = await (await get(deps, `draft=${id}`)).json();
    expect(read.draft.payload.name).toBe("Newer");
  });

  it("refuses a payload carrying a password, with a validation problem, and stores nothing", async () => {
    const { deps, store } = fakeDeps();
    const res = await saveDraftCall(deps, { payload: { ...form(), password: "hunter2hunter2" } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    expect(store.state.drafts.size).toBe(0);
  });

  it("is refused before storage without a session, from another origin, or with a non-JSON body", async () => {
    let touched = false;
    const deps: ApiDeps = { env: ENV, withRepo: async () => { touched = true; throw new Error("storage reached"); } };
    const payload = { action: "save-draft", draftId: crypto.randomUUID(), orgId: ORG, payload: form() };
    expect((await handleInstallations(new Request(`${HTTPS}/api/cpo/installations`, { method: "POST", headers: { "content-type": "application/json", origin: HTTPS }, body: JSON.stringify(payload) }), deps)).status).toBe(401);
    expect((await post(deps, payload, { origin: "https://evil.example.test" })).status).toBe(403);
    expect((await post(deps, payload, { "content-type": "text/plain" })).status).toBe(415);
    expect(touched).toBe(false);
  });

  it("validates ids, the revision and the action", async () => {
    const { deps } = fakeDeps();
    expect((await post(deps, { action: "save-draft", draftId: "nope", payload: form() })).status).toBe(422);
    expect((await saveDraftCall(deps, { orgId: "not-a-uuid" })).status).toBe(422);
    expect((await saveDraftCall(deps, { expectedRevision: 0 })).status).toBe(422);
    expect((await saveDraftCall(deps, { expectedRevision: 1.5 })).status).toBe(422);
    expect((await post(deps, { action: "mystery", draftId: crypto.randomUUID() })).status).toBe(400);
    expect((await saveDraftCall(deps, { orgId: crypto.randomUUID() })).status).toBe(404); // unknown organisation
  });

  it("accepts a draft with no organisation yet", async () => {
    const { deps } = fakeDeps();
    expect((await saveDraftCall(deps, { orgId: null })).status).toBe(201);
    expect((await saveDraftCall(deps, { orgId: "" })).status).toBe(201);
  });

  it("reports an unconfigured database as 503, not as an empty result", async () => {
    const deps: ApiDeps = { env: ENV, withRepo: async () => { throw new DatabaseUnavailableError(); } };
    expect((await saveDraftCall(deps)).status).toBe(503);
  });
});

describe("reading drafts", () => {
  it("lists only open drafts, without their documents, and 404s an unknown or malformed id", async () => {
    const { deps } = fakeDeps();
    const a = (await (await saveDraftCall(deps, { payload: form({ name: "First" }) })).json()).draft;
    const b = (await (await saveDraftCall(deps)).json()).draft;
    await post(deps, { action: "discard-draft", draftId: b.id });
    const list = await (await get(deps, "drafts=1")).json();
    expect(list.drafts).toEqual([expect.objectContaining({ id: a.id, name: "First", orgName: "Nordic Charge", revision: 1 })]);
    expect(list.drafts[0].payload).toBeUndefined();
    expect((await get(deps, `draft=${crypto.randomUUID()}`)).status).toBe(404);
    expect((await get(deps, "draft=not-a-uuid")).status).toBe(404);
  });
});

describe("discard-draft", () => {
  it("discards, is idempotent, and reports a used draft as used without touching its installation", async () => {
    const { deps, store } = fakeDeps();
    const a = (await (await saveDraftCall(deps)).json()).draft;
    expect(await (await post(deps, { action: "discard-draft", draftId: a.id })).json()).toEqual({ outcome: "discarded" });
    expect(await (await post(deps, { action: "discard-draft", draftId: a.id })).json()).toEqual({ outcome: "already_discarded" });

    const b = (await (await saveDraftCall(deps)).json()).draft;
    const created = await (await create(deps, { draftId: b.id })).json();
    const again = await (await post(deps, { action: "discard-draft", draftId: b.id })).json();
    expect(again).toEqual({ outcome: "already_used", installationId: created.installation.id });
    expect(store.snapshot(created.installation.id)).not.toBeNull();
  });

  it("answers 404 for an unknown draft", async () => {
    const { deps } = fakeDeps();
    expect((await post(deps, { action: "discard-draft", draftId: crypto.randomUUID() })).status).toBe(404);
  });
});

describe("creating through the API from a draft", () => {
  it("creates the installation and closes the draft; the view carries the CPO endpoint with no installation segment", async () => {
    const { deps } = fakeDeps();
    const draft = (await (await saveDraftCall(deps)).json()).draft;
    const res = await create(deps, { draftId: draft.id });
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.connection).toMatchObject({ status: "unverified", routingId: "nordic-charge", cpoAddress: "wss://nordic-charge.straumvakt.org/" });
    expect(view.connection.cpoAddress).not.toContain(view.installation.key);
    expect((await (await get(deps, `draft=${draft.id}`)).json()).draft.state).toBe("consumed");
  });

  it("maps a discarded or used draft to 409 draft_unavailable and creates nothing", async () => {
    const { deps, store } = fakeDeps();
    const draft = (await (await saveDraftCall(deps)).json()).draft;
    await post(deps, { action: "discard-draft", draftId: draft.id });
    const res = await create(deps, { draftId: draft.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("draft_unavailable");
    expect(store.state.installations.size).toBe(0);
  });

  it("a used draft answers with the installation it made, so the editor can open it rather than offer a duplicate", async () => {
    const { deps, store } = fakeDeps();
    const draft = (await (await saveDraftCall(deps)).json()).draft;
    const made = await (await create(deps, { draftId: draft.id })).json();
    const second = await create(deps, { draftId: draft.id });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "draft_unavailable", draftState: "consumed", installationId: made.installation.id });
    const saved = await saveDraftCall(deps, { draftId: draft.id, expectedRevision: 1 });
    expect(saved.status).toBe(409);
    expect(await saved.json()).toMatchObject({ error: "draft_unavailable", draftState: "consumed", installationId: made.installation.id });
    expect(store.state.installations.size).toBe(1);
  });

  it("a discarded draft says so and names no installation", async () => {
    const { deps } = fakeDeps();
    const draft = (await (await saveDraftCall(deps)).json()).draft;
    await post(deps, { action: "discard-draft", draftId: draft.id });
    const body = await (await create(deps, { draftId: draft.id })).json();
    expect(body).toMatchObject({ error: "draft_unavailable", draftState: "discarded" });
    expect(body.installationId).toBeUndefined();
  });

  it("a repeated create with the same idempotency key is a replay, not a second installation", async () => {
    const { deps, store } = fakeDeps();
    const draft = (await (await saveDraftCall(deps)).json()).draft;
    const key = crypto.randomUUID();
    const first = await (await create(deps, { draftId: draft.id, idempotencyKey: key })).json();
    const second = await (await create(deps, { draftId: draft.id, idempotencyKey: key })).json();
    expect(second.replayed).toBe(true);
    expect(second.installation.id).toBe(first.installation.id);
    expect(store.state.installations.size).toBe(1);
  });

  it("rejects a malformed draft id as a validation problem, and a create without a draft still works", async () => {
    const { deps } = fakeDeps();
    expect((await create(deps, { draftId: "nope" })).status).toBe(422);
    expect((await create(deps)).status).toBe(200);
  });
});

describe("the workspace's CPO is decided by the server, never by the browser", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";

  it("when the login is associated with a CPO, a create or draft for any other organisation is refused", async () => {
    const { deps, store } = fakeDeps();
    const bound: ApiDeps = { ...deps, contextOrgId: ORG };
    const refused = await create(bound, { orgId: OTHER });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe("wrong_context");
    expect((await saveDraftCall(bound, { orgId: OTHER })).status).toBe(403);
    expect(store.state.installations.size).toBe(0);
    expect(store.state.drafts.size).toBe(0);
    expect((await create(bound)).status).toBe(200);
    expect((await saveDraftCall(bound)).status).toBe(201);
  });

  it("without an association nothing is narrowed: the existing platform-operator behaviour is unchanged", async () => {
    const { deps } = fakeDeps();
    expect((await create(deps)).status).toBe(200);
  });

  it("reads the association only from a well-formed setting", async () => {
    const { readContextOrgId } = await import("./context");
    expect(readContextOrgId({})).toBeNull();
    expect(readContextOrgId({ CPO_SHELL_ORG_ID: "not-a-uuid" })).toBeNull();
    expect(readContextOrgId({ CPO_SHELL_ORG_ID: ` ${ORG.toUpperCase()} ` })).toBe(ORG);
  });
});
