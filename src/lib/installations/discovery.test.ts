// Incoming (knocking) chargers and their attachment. Runs against the in-memory store, which proves the SERVICE contract
// (scoping, one attachment operation, conflicts, rollback). It does not prove PostgreSQL behaviour, the engine's
// throttled writes, or any hardware.

import { describe, expect, it } from "vitest";
import type { Actor } from "./actor";
import { sharedLoginActor } from "./actor";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { MemoryStore } from "./__tests__/memory-store";
import { handleInstallations, type ApiDeps, type Repo } from "./api";
import { bootCaptureFor, incomingChargers, MAX_PRESENCE_CALLS, MAX_PRESENCE_IDS, MAX_PROMOTE_ATTEMPTS, PROMOTE_RETRY_MIN_AGE_MS, signalAttached, type PresencePort, type PromotionPort } from "./discovery";
import { MAX_PROMOTE_PER_CALL, pendingGatewayFrom } from "./pending-gateway";
import { INCOMING_WINDOW_MS } from "./incoming-window";
import { SaveInstallationInput } from "./model";
import { saveInstallation } from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const OTHER_SITE = "44444444-4444-4444-8444-444444444444";
const actor = sharedLoginActor("Straumvakt");
const outsider = { kind: "shared_login", label: "outsider", platformOperator: false } as unknown as Actor;
const uuid = () => crypto.randomUUID();
const deps = { hashPassword: async (p: string) => `v(${p.length})`, now: () => new Date("2026-10-30T12:00:00Z") };

function world() {
  const store = new MemoryStore();
  store.seedOrg(ORG, "Nordic Charge", SITE);
  store.seedOrg(OTHER, "Harbour Power", OTHER_SITE);
  return store;
}

const attach = (chargePointId: string, over: Record<string, unknown> = {}, circuitId = "new-c1") =>
  SaveInstallationInput.parse({
    orgId: ORG,
    siteId: SITE,
    idempotencyKey: uuid(),
    installation: { displayName: "Harbour" },
    electrician: {},
    circuits: [{ id: "new-c1", displayName: "Bay", ratingAmps: 0 }],
    chargers: [{ id: "new-ch1", circuitId, label: "Charger 1", chargePointId }],
    ...over,
  });

// The seeded knocks were last seen at 11:00Z; the clock is ten minutes later unless a test says otherwise.
const at = (iso: string) => () => new Date(iso);
const NOW = "2026-10-30T11:10:00Z";
const list = (store: MemoryStore, orgId = ORG, who: Actor = actor, now = at(NOW)) => incomingChargers(store, orgId, who, 50, now);

describe("the incoming list is scoped to the CPO and honest about what it knows", () => {
  it("lists unknown chargers of THIS CPO only, with first/last seen and the recorded count", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`, { attemptCount: 4 });
    store.seedDiscovery(`${OTHER}/CP-2`);
    const rows = await list(store);
    expect(rows).toEqual([{ chargePointId: "CP-1", firstSeenAt: "2026-10-30T10:00:00.000Z", lastSeenAt: "2026-10-30T11:00:00.000Z", attempts: 4, state: "incoming", note: null, boot: null, socket: null, activation: null }]);
    expect((await list(store, OTHER)).map((r) => r.chargePointId)).toEqual(["CP-2"]);
  });

  it("the same text id knocking at two CPOs stays two isolated rows", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    store.seedDiscovery(`${OTHER}/CP-1`);
    expect(await list(store)).toHaveLength(1);
    expect(await list(store, OTHER)).toHaveLength(1);
    await saveInstallation(store, attach("CP-1"), actor, deps);
    expect((await list(store)).filter((r) => r.state === "incoming")).toEqual([]);
    expect((await list(store, OTHER)).map((r) => r.chargePointId)).toEqual(["CP-1"]);
  });

  it("leaves out legacy and ambiguous keys, and anything it cannot attribute to this CPO", async () => {
    const store = world();
    store.seedDiscovery("EE43C609263CC7"); // legacy: no CPO in the key
    store.seedDiscovery("abc123xyz/CP-3"); // legacy installation-key form
    store.seedDiscovery(`${ORG}/bad id!`); // not a valid charge point id
    store.seedDiscovery(`${ORG}/`);
    store.seedDiscovery(`${ORG}-x/CP-4`); // a key that only looks like this CPO
    expect((await list(store)).filter((r) => r.state === "incoming")).toEqual([]);
  });

  it("separates new candidates from registered chargers and recovery cases, and never edits the observations", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-NEW`);
    store.seedDiscovery(`${ORG}/CP-DONE`);
    store.seedDiscovery(`${ORG}/CP-RETIRED`, { reason: "identity_not_current" });
    store.seedDiscovery(`${ORG}/CP-ORPHAN`, { reason: "no_active_placement" });
    store.seedDiscovery(`${ORG}/CP-VAGUE`, { reason: "something_else" }); // unknown id with a refusal reason: ambiguous
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-DONE", open: true });
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "cp-retired", open: false }); // closed, other case
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-ORPHAN", open: true });
    const before = JSON.stringify([...store.state.discoveries]);
    const rows = await list(store);
    expect(rows.map((r) => [r.chargePointId, r.state]).sort()).toEqual([["CP-NEW", "incoming"], ["CP-ORPHAN", "recovery"], ["CP-RETIRED", "recovery"]]);
    expect(rows.find((r) => r.chargePointId === "CP-RETIRED")?.note).toMatch(/Return it/);
    expect(rows.filter((r) => r.state === "recovery").every((r) => r.note)).toBe(true);
    expect(JSON.stringify([...store.state.discoveries])).toBe(before);
  });

  it("an actor without authority over the CPO sees nothing", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    expect(await list(store, ORG, outsider)).toEqual([]);
  });

  it("is bounded", async () => {
    const store = world();
    for (let i = 0; i < 80; i++) store.seedDiscovery(`${ORG}/CP-${i}`, { lastSeenAt: new Date(Date.UTC(2026, 9, 30, 11, 0, i)) });
    const rows = await incomingChargers(store, ORG, actor, 10, at(NOW));
    expect(rows).toHaveLength(10);
    expect(rows[0].chargePointId).toBe("CP-79");
  });
});

describe("picking an incoming charger and typing its id are one operation", () => {
  const shape = (store: MemoryStore) => ({
    devices: store.state.devices.size,
    identities: store.state.identities.map((i) => [i.cpoOrgId, i.chargePointId, i.open]),
    placements: store.state.placements.map((p) => [p.orgId, p.circuitId === "" ? "" : "set", p.label, p.open]),
  });

  it("creates the same device, identity and dated placement either way; only the audit notes the knock", async () => {
    const knocked = world();
    knocked.seedDiscovery(`${ORG}/CP-1`, { attemptCount: 5 });
    const manual = world();
    await saveInstallation(knocked, attach("CP-1"), actor, deps);
    await saveInstallation(manual, attach("CP-1"), actor, deps);
    expect(shape(knocked)).toEqual(shape(manual));
    const evidence = (s: MemoryStore) => s.state.changes.find((c) => c.entityType === "charger" && c.action === "create")!.diff;
    expect(evidence(knocked).acceptedFromIncoming?.to).toMatch(/first seen 2026-10-30T10:00:00.000Z, last seen 2026-10-30T11:00:00.000Z, 5 recorded observations/);
    expect(evidence(manual).acceptedFromIncoming).toBeUndefined();
    expect(knocked.state.changes.every((c) => c.actorLabel === 'shared login "Straumvakt"')).toBe(true);
  });

  it("attaching does not edit the observation, and the charger then leaves the incoming list", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    expect(await list(store)).toHaveLength(1);
    await saveInstallation(store, attach("CP-1"), actor, deps);
    expect((await list(store)).filter((r) => r.state === "incoming")).toEqual([]);
    expect(store.state.discoveries.get(`${ORG}/CP-1`)?.attemptCount).toBe(3);
  });

  it("selection is not registration: abandoning the form leaves nothing behind", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    // The form only prefilled the id; no save was made.
    expect(store.state.devices.size + store.state.identities.length + store.state.placements.length).toBe(0);
    expect(await list(store)).toHaveLength(1);
  });

  it("a stale selection, or manual against incoming, gets the existing conflict and no second device", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    const first = await saveInstallation(store, attach("CP-1"), actor, deps);
    // Another tab picked the same candidate, or the id was typed by hand into another installation.
    await expect(saveInstallation(store, attach("CP-1"), actor, deps)).rejects.toMatchObject({ code: "identity_in_use" });
    expect(store.state.devices.size).toBe(1);
    expect(store.state.placements.filter((p) => p.open)).toHaveLength(1);
    expect(store.state.installations.size).toBe(1);
    expect(first.snapshot.chargers).toHaveLength(1);
  });

  it("the same id in another CPO is a separate charger", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    store.seedDiscovery(`${OTHER}/CP-1`);
    await saveInstallation(store, attach("CP-1"), actor, deps);
    await saveInstallation(store, attach("CP-1", { orgId: OTHER, siteId: OTHER_SITE }), actor, deps);
    expect(store.state.identities.map((i) => i.cpoOrgId).sort()).toEqual([ORG, OTHER].sort());
  });

  it("a forged circuit, or a site of another CPO, refuses the whole save and registers nothing", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await expect(saveInstallation(store, attach("CP-1", {}, "not-a-circuit-of-this-form"), actor, deps)).rejects.toMatchObject({ code: "validation" });
    await expect(saveInstallation(store, attach("CP-1", { siteId: OTHER_SITE }), actor, deps)).rejects.toMatchObject({ code: "not_found" });
    expect(store.state.devices.size + store.state.identities.length + store.state.placements.length + store.state.installations.size).toBe(0);
    expect(await list(store)).toHaveLength(1);
  });

  it("an outsider cannot attach", async () => {
    const store = world();
    await expect(saveInstallation(store, attach("CP-1"), outsider, deps)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a charger that already knocked, was retired, and still has a closed identity is a recovery row, not a candidate", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-R`, { reason: "identity_not_current" });
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-R", open: false });
    const rows = await list(store);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("recovery");
  });
});

describe("GET /api/cpo/installations?incoming", () => {
  const HTTPS = "https://shell.example.test";
  const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
  const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };

  function api(contextOrgId: string | null) {
    const store = world();
    const fresh = { lastSeenAt: new Date(Date.now() - 60_000) }; // the handler uses the real clock
    store.seedDiscovery(`${ORG}/CP-1`, fresh);
    store.seedDiscovery(`${OTHER}/CP-2`, fresh);
    const repo = { listIncoming: (orgId: string, who: Actor) => incomingChargers(store, orgId, who) } as unknown as Repo;
    const d: ApiDeps = { env: ENV, contextOrgId, withRepo: async (fn) => fn(repo) };
    return d;
  }
  const get = async (d: ApiDeps, query: string, signedIn = true) =>
    handleInstallations(new Request(`${HTTPS}/api/cpo/installations?${query}`, { headers: signedIn ? { cookie: `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}` } : {} }), d);

  it("returns the workspace CPO's list and ignores any organisation named in the request", async () => {
    const d = api(ORG);
    const res = await get(d, `incoming=1&org=${OTHER}&orgId=${OTHER}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incoming.map((r: { chargePointId: string }) => r.chargePointId)).toEqual(["CP-1"]);
    expect(body.windowMs).toBe(INCOMING_WINDOW_MS);
    expect(Math.abs(Date.parse(body.asOf) - Date.now())).toBeLessThan(5_000);
  });

  it("has no list without a workspace CPO, and none without a session", async () => {
    const none = await get(api(null), "incoming=1");
    expect(none.status).toBe(409);
    expect((await none.json()).error).toBe("no_context");
    expect((await get(api(ORG), "incoming=1", false)).status).toBe(401);
  });

  it("is never cached", async () => {
    expect((await get(api(ORG), "incoming=1")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("incoming visibility window", () => {
  const MIN = 60_000;
  const lastSeen = (store: MemoryStore, key: string, iso: string, over: Record<string, unknown> = {}) => store.seedDiscovery(key, { lastSeenAt: new Date(iso), ...over });
  const ids = async (store: MemoryStore, now: string, orgId = ORG) => (await list(store, orgId, actor, at(now))).map((r) => r.chargePointId);

  it("lists while fresh, hides exactly at the window and after, and the window is 30 minutes of lastSeen", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-1`, "2026-10-30T11:00:00Z");
    expect(INCOMING_WINDOW_MS).toBe(30 * MIN);
    expect(await ids(store, "2026-10-30T11:29:59.999Z")).toEqual(["CP-1"]);
    expect(await ids(store, "2026-10-30T11:30:00.000Z")).toEqual([]); // at expiry
    expect(await ids(store, "2026-10-30T11:30:00.001Z")).toEqual([]);
  });

  it("uses lastSeen, not firstSeen: an old first knock with a fresh last knock is listed; a fresh first with a stale last is not", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-OLD-FIRST`, "2026-10-30T11:55:00Z", { firstSeenAt: new Date("2026-10-01T00:00:00Z") });
    lastSeen(store, `${ORG}/CP-STALE`, "2026-10-30T11:00:00Z", { firstSeenAt: new Date("2026-10-30T11:00:00Z") });
    const rows = await list(store, ORG, actor, at("2026-10-30T12:00:00Z"));
    expect(rows.map((r) => r.chargePointId)).toEqual(["CP-OLD-FIRST"]);
    expect(rows[0].firstSeenAt).toBe("2026-10-01T00:00:00.000Z"); // first-seen evidence is retained in the model
  });

  it("hiding writes and deletes nothing, and a later knock on the SAME row brings the candidate back once", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-1`, "2026-10-30T11:00:00Z", { attemptCount: 3 });
    expect(await ids(store, "2026-10-30T12:00:00Z")).toEqual([]);
    expect(store.state.discoveries.size).toBe(1);
    expect(store.state.discoveries.get(`${ORG}/CP-1`)?.attemptCount).toBe(3); // untouched by being hidden
    // The engine's upsert: same CPO/identity key, newer lastSeen, count + 1.
    const row = store.state.discoveries.get(`${ORG}/CP-1`)!;
    store.state.discoveries.set(`${ORG}/CP-1`, { ...row, lastSeenAt: new Date("2026-10-30T11:58:00Z"), attemptCount: row.attemptCount + 1 });
    store.state.discoveries.set(`${ORG}/CP-1`, { ...store.state.discoveries.get(`${ORG}/CP-1`)!, lastSeenAt: new Date("2026-10-30T11:59:00Z"), attemptCount: 5 });
    const rows = await list(store, ORG, actor, at("2026-10-30T12:00:00Z"));
    expect(rows.map((r) => r.chargePointId)).toEqual(["CP-1"]); // one row, not one per knock
    expect(store.state.discoveries.size).toBe(1);
    expect(store.state.devices.size).toBe(0); // no device or identity was created by being listed
    expect(store.state.identities).toEqual([]);
  });

  it("stays isolated per CPO: the same id fresh at one CPO and stale at the other", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-1`, "2026-10-30T11:55:00Z");
    lastSeen(store, `${OTHER}/CP-1`, "2026-10-30T10:00:00Z");
    expect(await ids(store, "2026-10-30T12:00:00Z")).toEqual(["CP-1"]);
    expect(await ids(store, "2026-10-30T12:00:00Z", OTHER)).toEqual([]);
  });

  it("does not expire recovery rows, and does not change registered-charger behaviour", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-RETIRED`, "2026-09-01T00:00:00Z", { reason: "identity_not_current" });
    lastSeen(store, `${ORG}/CP-DONE`, "2026-09-01T00:00:00Z");
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-RETIRED", open: false });
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-DONE", open: true });
    const rows = await list(store, ORG, actor, at("2026-10-30T12:00:00Z"));
    expect(rows.map((r) => [r.chargePointId, r.state])).toEqual([["CP-RETIRED", "recovery"]]);
  });

  it("an expired charger can still be attached by hand: expiry is not a ban", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-1`, "2026-10-30T10:00:00Z");
    expect(await ids(store, "2026-10-30T12:00:00Z")).toEqual([]);
    await saveInstallation(store, attach("CP-1"), actor, deps);
    expect(store.state.identities.map((i) => [i.chargePointId, i.open])).toEqual([["CP-1", true]]);
  });

  it("stays bounded: the same limit applies after the window", async () => {
    const store = world();
    for (let i = 0; i < 80; i++) lastSeen(store, `${ORG}/CP-${i}`, new Date(Date.UTC(2026, 9, 30, 11, 50, 0) + i * 1000).toISOString());
    const rows = await incomingChargers(store, ORG, actor, 10, at("2026-10-30T12:00:00Z"));
    expect(rows).toHaveLength(10);
  });
});

// ── Pending onboarding: gateway presence, boot metadata and the on-demand capture ────────────────────────────────────

const BOOT = {
  messageId: "boot-msg-1",
  receivedAt: "2026-10-31T09:00:00.000Z",
  frameBytes: 210,
  validation: { ok: true } as const,
  payload: { chargePointVendor: "Zaptec", chargePointModel: "Go", iccid: "8935800000000000000", imsi: "274020000000000", vendorExtra: { n: [1, 2] } },
};
const presence = (connected: string[], unknown: string[] = []) => {
  const asked: string[][] = [];
  const port: PresencePort = { connected: async (_org, ids) => { asked.push(ids); return { connected: new Set(connected), unknown: new Set(unknown) }; } };
  return { port, asked };
};
const lastSeen = (store: MemoryStore, key: string, iso: string, over: Record<string, unknown> = {}) => store.seedDiscovery(key, { lastSeenAt: new Date(iso), ...over });
const NOW_LATE = "2026-10-31T12:00:00Z"; // three hours after a 09:00Z knock: far outside the 30 minute window

describe("a connected pending charger stays listed past the knock window (gateway-observed, not liveness)", () => {
  it("a quiet charger with an open pending socket is still listed after 30 minutes and is marked socket=true", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-QUIET`, "2026-10-31T09:00:00Z");
    const { port, asked } = presence(["CP-QUIET"]);
    const rows = await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), port);
    expect(rows.map((r) => [r.chargePointId, r.socket])).toEqual([["CP-QUIET", true]]);
    expect(asked).toEqual([["CP-QUIET"]]);
  });
  it("a disconnected candidate falls back to the existing window: hidden once old, listed while recent, never marked connected", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-OLD`, "2026-10-31T09:00:00Z");
    lastSeen(store, `${ORG}/CP-RECENT`, "2026-10-31T11:50:00Z");
    const { port } = presence([]);
    const rows = await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), port);
    expect(rows.map((r) => [r.chargePointId, r.socket])).toEqual([["CP-RECENT", false]]);
  });
  it("when the gateway cannot answer, presence is UNKNOWN (null) and the knock window alone decides; nothing is invented", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-OLD`, "2026-10-31T09:00:00Z");
    lastSeen(store, `${ORG}/CP-RECENT`, "2026-10-31T11:50:00Z");
    for (const port of [{ connected: async () => null }, { connected: async () => { throw new Error("binding down"); } }] as PresencePort[]) {
      const rows = await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), port);
      expect(rows.map((r) => [r.chargePointId, r.socket])).toEqual([["CP-RECENT", null]]);
    }
    const unk = await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), presence([], ["CP-OLD", "CP-RECENT"]).port);
    expect(unk.map((r) => [r.chargePointId, r.socket])).toEqual([["CP-RECENT", null]]);
  });
  it("only unregistered candidates are asked, in bounded batches of MAX_PRESENCE_IDS, and nothing is asked when there are none", async () => {
    const store = world();
    for (let i = 0; i < MAX_PRESENCE_IDS + 10; i++) lastSeen(store, `${ORG}/CP-${i}`, new Date(Date.UTC(2026, 9, 31, 11, 55, 0) + i).toISOString());
    lastSeen(store, `${ORG}/CP-KNOWN`, "2026-10-31T11:56:00Z", { reason: "identity_not_current" });
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-KNOWN", open: false });
    const { port, asked } = presence([]);
    await incomingChargers(store, ORG, actor, 100, at(NOW_LATE), port);
    expect(asked.map((c) => c.length).sort((x, y) => y - x)).toEqual([MAX_PRESENCE_IDS, 10]);
    expect(asked.flat()).not.toContain("CP-KNOWN");
    expect(new Set(asked.flat()).size).toBe(MAX_PRESENCE_IDS + 10);
    const empty = presence([]);
    await incomingChargers(world(), ORG, actor, 50, at(NOW_LATE), empty.port);
    expect(empty.asked).toEqual([]);
  });
  it("one read makes at most MAX_PRESENCE_CALLS bounded calls however many candidates there are", async () => {
    const store = world();
    for (let i = 0; i < 160; i++) lastSeen(store, `${ORG}/CP-${i}`, new Date(Date.UTC(2026, 9, 31, 11, 50, 0) + i).toISOString());
    const { port, asked } = presence([]);
    await incomingChargers(store, ORG, actor, 100, at(NOW_LATE), port);
    expect(asked.length).toBeLessThanOrEqual(MAX_PRESENCE_CALLS);
    expect(asked.every((c) => c.length <= MAX_PRESENCE_IDS)).toBe(true);
  });
  it("the gateway is asked AFTER the database transaction, so no connection waits on it", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-1`, "2026-10-31T11:55:00Z");
    let txOpen = false;
    const original = store.transaction.bind(store);
    store.transaction = (async (fn: never) => { txOpen = true; try { return await original(fn); } finally { txOpen = false; } }) as typeof store.transaction;
    let openWhenAsked: boolean | null = null;
    await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), { connected: async () => { openWhenAsked = txOpen; return { connected: new Set(), unknown: new Set() }; } });
    expect(openWhenAsked).toBe(false);
  });
  it("a registered charger never shows as incoming just because a socket exists", async () => {
    const store = world();
    lastSeen(store, `${ORG}/CP-1`, "2026-10-31T09:00:00Z");
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-1", open: true });
    expect(await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), presence(["CP-1"]).port)).toEqual([]);
  });
});

describe("the BootNotification capture: metadata in the list, the body only on demand and only for this CPO", () => {
  it("the list carries when and which message, never the body", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`, { boot: BOOT });
    const [row] = await list(store);
    expect(row!.boot).toEqual({ messageId: "boot-msg-1", receivedAt: "2026-10-31T09:00:00.000Z" });
    expect(JSON.stringify(row)).not.toContain("8935800000000000000");
    expect(JSON.stringify(row)).not.toContain("vendorExtra");
  });
  it("returns the complete payload exactly as stored, including optional ICCID/IMSI and vendor extensions", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`, { boot: BOOT });
    expect(await bootCaptureFor(store, ORG, actor, "CP-1")).toEqual(BOOT);
  });
  it("is null when nothing was captured (an honest 'none', never a substitute summary)", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    expect(await bootCaptureFor(store, ORG, actor, "CP-1")).toBeNull();
    expect(await bootCaptureFor(store, ORG, actor, "CP-UNKNOWN")).toBeNull();
  });
  it("is isolated per CPO: the same id captured under another CPO is invisible, and an outsider gets nothing", async () => {
    const store = world();
    store.seedDiscovery(`${OTHER}/CP-1`, { boot: BOOT });
    expect(await bootCaptureFor(store, ORG, actor, "CP-1")).toBeNull();
    expect(await bootCaptureFor(store, OTHER, actor, "CP-1")).toEqual(BOOT);
    expect(await bootCaptureFor(store, OTHER, outsider, "CP-1")).toBeNull();
  });
  it("the latest capture stays readable after the charger is attached (it is not deleted with the discovery state)", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`, { boot: BOOT });
    await saveInstallation(store, attach("CP-1"), actor, deps);
    expect((await list(store)).filter((r) => r.state === "incoming")).toEqual([]);
    expect(await bootCaptureFor(store, ORG, actor, "CP-1")).toEqual(BOOT);
  });
});

describe("GET /api/cpo/installations?incoming=1&boot=<id>", () => {
  const HTTPS = "https://shell.example.test";
  const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
  const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
  function api(contextOrgId: string | null) {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`, { boot: BOOT });
    store.seedDiscovery(`${OTHER}/CP-2`, { boot: { ...BOOT, messageId: "other-cpo" } });
    const repo = { getBootCapture: (orgId: string, who: Actor, id: string) => bootCaptureFor(store, orgId, who, id) } as unknown as Repo;
    const d: ApiDeps = { env: ENV, contextOrgId, withRepo: async (fn) => fn(repo) };
    return d;
  }
  const get = async (d: ApiDeps, query: string, signedIn = true) =>
    handleInstallations(new Request(`${HTTPS}/api/cpo/installations?${query}`, { headers: signedIn ? { cookie: `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}` } : {} }), d);

  it("returns one charger's complete capture for the workspace CPO", async () => {
    const res = await get(api(ORG), "incoming=1&boot=CP-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ chargePointId: "CP-1", capture: BOOT });
  });
  it("the CPO is the workspace's: an id captured only under another CPO is none, and a named organisation is ignored", async () => {
    const body = await (await get(api(ORG), `incoming=1&boot=CP-2&org=${OTHER}&orgId=${OTHER}`)).json();
    expect(body).toEqual({ chargePointId: "CP-2", capture: null });
  });
  it("needs a session and a workspace CPO, and refuses a malformed id before any read", async () => {
    expect((await get(api(ORG), "incoming=1&boot=CP-1", false)).status).toBe(401);
    expect((await get(api(null), "incoming=1&boot=CP-1")).status).toBe(409);
    for (const bad of ["../x", "a b", "", "x".repeat(60), "%2e%2e"]) expect((await get(api(ORG), `incoming=1&boot=${encodeURIComponent(bad)}`)).status, bad).toBe(422);
  });
  it("the list endpoint never carries a body", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`, { boot: BOOT, lastSeenAt: new Date(Date.now() - 60_000) });
    const repo = { listIncoming: (orgId: string, who: Actor) => incomingChargers(store, orgId, who) } as unknown as Repo;
    const d: ApiDeps = { env: ENV, contextOrgId: ORG, withRepo: async (fn) => fn(repo) };
    const text = await (await get(d, "incoming=1")).text();
    expect(text).toContain("boot-msg-1");
    expect(text).not.toContain("vendorExtra");
    expect(text).not.toContain("8935800000000000000");
  });
});

describe("the post-save signal to a waiting charger", () => {
  it("a save reports exactly the chargers it attached", async () => {
    const store = world();
    const first = await saveInstallation(store, attach("CP-1"), actor, deps);
    expect(first.attachedChargePointIds).toEqual(["CP-1"]);
  });
  it("the port signals after the commit, bounded, and a failing gateway never throws", async () => {
    const calls: unknown[] = [];
    const gw = pendingGatewayFrom({
      promotePending: async (i) => { calls.push(i); if (i.chargePointId === "BAD") throw new Error("gateway down"); return { outcome: "reconnect_requested" }; },
      pendingPresence: async () => ({ connected: ["A"], unknown: ["B"] }),
    })!;
    await gw.promote(ORG, ["A", "BAD", "C"]);
    expect(calls).toHaveLength(3);
    calls.length = 0;
    await gw.promote(ORG, Array.from({ length: MAX_PROMOTE_PER_CALL + 5 }, (_, i) => `ID${i}`));
    expect(calls).toHaveLength(MAX_PROMOTE_PER_CALL);
    expect(await gw.connected(ORG, ["A", "B"])).toEqual({ connected: new Set(["A"]), unknown: new Set(["B"]) });
    const down = pendingGatewayFrom({ promotePending: async () => ({ outcome: "x" }), pendingPresence: async () => { throw new Error("x"); } })!;
    expect(await down.connected(ORG, ["A"])).toBeNull();
  });
  it("with no binding there is no gateway port at all (list and save degrade to plain database behaviour)", () => {
    expect(pendingGatewayFrom(undefined)).toBeNull();
    expect(pendingGatewayFrom(null)).toBeNull();
  });
});

// ── Review fixes: fair presence, durable activation, visible credential failure ──────────────────────────────────────

describe("REVIEW CASE: connected candidates are not cut by the presence bound", () => {
  it("26 connected quiet candidates older than the window are all listed (the page allows 50)", async () => {
    const store = world();
    const base = Date.parse(NOW_LATE);
    for (let i = 0; i < 26; i++) lastSeen(store, `${ORG}/CP-${i}`, new Date(base - 3_600_000 - i).toISOString());
    const rows = await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), { connected: async (_o, ids) => ({ connected: new Set(ids), unknown: new Set<string>() }) });
    expect(rows).toHaveLength(26);
    expect(rows.every((r) => r.socket === true)).toBe(true);
  });
  it("an old connected candidate beyond the first batch is still found (the second batch is asked)", async () => {
    const store = world();
    const base = Date.parse(NOW_LATE);
    for (let i = 0; i < 40; i++) lastSeen(store, `${ORG}/CP-${i}`, new Date(base - 3_600_000 - i).toISOString());
    const rows = await incomingChargers(store, ORG, actor, 50, at(NOW_LATE), { connected: async (_o, ids) => ({ connected: new Set(ids.filter((x) => x === "CP-39")), unknown: new Set<string>() }) });
    expect(rows.map((r) => r.chargePointId)).toEqual(["CP-39"]);
  });
});

describe("activation after a save is durable, visible and retried without polling", () => {
  const T0 = new Date("2026-10-31T12:00:00Z");
  const saveAt = (store: MemoryStore, id = "CP-1") => saveInstallation(store, attach(id), actor, { ...deps, now: () => T0 });
  const rowFor = async (store: MemoryStore, id: string, nowIso: string, promoter: PromotionPort | null = null) =>
    (await incomingChargers(store, ORG, actor, 50, at(nowIso), null, promoter)).find((r) => r.chargePointId === id);
  const portWith = (answer: (ids: string[]) => Record<string, string> | Error) => {
    const calls: string[][] = [];
    const p: PromotionPort = { promote: async (_o, ids) => { calls.push(ids); const r = answer(ids); if (r instanceof Error) throw r; return r; } };
    return { p, calls };
  };

  it("the intent is committed WITH the attach, and rolled back with it", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    store.seedDiscovery(`${ORG}/CP-2`);
    await saveAt(store, "CP-1");
    expect(store.state.discoveries.get(`${ORG}/CP-1`)?.promote).toMatchObject({ delivered: false, attempts: 0 });
    // A second save attaches CP-2 FIRST and then conflicts on CP-1 (already in use): the whole save fails, so CP-2's intent must not survive.
    const conflicting = attach("CP-2", {
      chargers: [
        { id: "new-chB", circuitId: "new-c1", label: "B", chargePointId: "CP-2" },
        { id: "new-chA", circuitId: "new-c1", label: "A", chargePointId: "CP-1" },
      ],
    });
    await expect(saveInstallation(store, conflicting, actor, deps)).rejects.toBeTruthy();
    expect(store.state.discoveries.get(`${ORG}/CP-2`)?.promote).toBeUndefined();
    expect(store.state.identities.map((i) => i.chargePointId)).toEqual(["CP-1"]);
  });
  it("commit succeeded but the process died before any signal: the saved charger is still listed as undelivered, not lost", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await saveAt(store);
    const row = await rowFor(store, "CP-1", "2026-10-31T12:00:05Z");
    expect(row).toMatchObject({ state: "recovery", activation: "undelivered" });
    expect(row!.note).toMatch(/not reached the gateway/);
  });
  it("a read re-sends it once it is old enough, records the outcome, and the row becomes 'waiting'", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await saveAt(store);
    const { p, calls } = portWith(() => ({ "CP-1": "reconnect_requested" }));
    expect((await rowFor(store, "CP-1", "2026-10-31T12:00:05Z", p))!.activation).toBe("undelivered"); // too fresh: the save's own attempt may be in flight
    expect(calls).toHaveLength(0);
    const later = new Date(T0.getTime() + PROMOTE_RETRY_MIN_AGE_MS).toISOString();
    expect((await rowFor(store, "CP-1", later, p))!.activation).toBe("waiting");
    expect(calls).toEqual([["CP-1"]]);
    expect(store.state.discoveries.get(`${ORG}/CP-1`)?.promote).toMatchObject({ delivered: true, attempts: 1, outcome: "reconnect_requested" });
    await rowFor(store, "CP-1", later, p);
    expect(calls).toHaveLength(1); // delivered: not sent again
  });
  it("delivery failure is recorded and retried up to MAX_PROMOTE_ATTEMPTS, then shown as failed with no further retries", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await saveAt(store);
    const { p, calls } = portWith(() => new Error("gateway unreachable"));
    const later = new Date(T0.getTime() + 60_000).toISOString();
    for (let i = 0; i < MAX_PROMOTE_ATTEMPTS + 2; i++) await rowFor(store, "CP-1", later, p);
    expect(calls).toHaveLength(MAX_PROMOTE_ATTEMPTS);
    const row = await rowFor(store, "CP-1", later, p);
    expect(row).toMatchObject({ activation: "failed" });
    expect(row!.note).toMatch(/could not be delivered/);
    expect(store.state.discoveries.get(`${ORG}/CP-1`)?.promote).toMatchObject({ delivered: false, attempts: MAX_PROMOTE_ATTEMPTS, outcome: "error" });
  });
  it("more attachments than one call carries: the rest stay undelivered and go out on later reads; none is dropped", async () => {
    const store = world();
    const ids = Array.from({ length: 14 }, (_, i) => `CP-${i}`);
    for (const id of ids) store.seedDiscovery(`${ORG}/${id}`);
    for (const id of ids) await saveAt(store, id);
    const { p, calls } = portWith((got) => Object.fromEntries(got.map((id) => [id, "reconnect_requested"])));
    const later = new Date(T0.getTime() + 60_000).toISOString();
    await rowFor(store, "CP-0", later, p);
    await rowFor(store, "CP-0", later, p);
    expect(calls.map((c) => c.length)).toEqual([10, 4]);
    expect(new Set(calls.flat()).size).toBe(14);
  });
  it("signalAttached records each outcome, never throws, and leaves a failed or missing one undelivered", async () => {
    const store = world();
    for (const id of ["CP-1", "CP-2", "CP-3"]) store.seedDiscovery(`${ORG}/${id}`);
    for (const id of ["CP-1", "CP-2", "CP-3"]) await saveAt(store, id);
    await signalAttached(store, { promote: async () => ({ "CP-1": "reconnect_requested", "CP-2": "error" }) }, ORG, ["CP-1", "CP-2", "CP-3"]);
    const p = (id: string) => store.state.discoveries.get(`${ORG}/${id}`)?.promote;
    expect(p("CP-1")).toMatchObject({ delivered: true, attempts: 1 });
    expect(p("CP-2")).toMatchObject({ delivered: false, attempts: 1, outcome: "error" });
    expect(p("CP-3")).toMatchObject({ delivered: false, attempts: 0 });
    await expect(signalAttached(store, { promote: async () => { throw new Error("down"); } }, ORG, ["CP-3"])).resolves.toBeUndefined();
  });
  it("success is evidence-based: an accepted BootNotification after the save clears the row; one before it does not", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await saveAt(store);
    store.bootAt.set(`${ORG}/cp-1`, new Date(T0.getTime() - 60_000)); // an old boot, before the save
    expect(await rowFor(store, "CP-1", "2026-10-31T12:30:00Z")).toMatchObject({ state: "recovery" });
    store.bootAt.set(`${ORG}/cp-1`, new Date(T0.getTime() + 60_000));
    expect(await rowFor(store, "CP-1", "2026-10-31T12:30:00Z")).toBeUndefined();
  });
  it("saved is not online: the row never claims the charger is connected", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await saveAt(store);
    const row = (await rowFor(store, "CP-1", "2026-10-31T12:00:05Z"))!;
    expect(row.socket).toBeNull();
    expect(row.note).not.toMatch(/is online|is connected/i);
  });
});

describe("credential refusal after attach is visible, scoped and self-clearing, and never leaks a secret", () => {
  const T0 = new Date("2026-10-31T12:00:00Z");
  const world2 = () => {
    const store = world();
    store.state.identities.push({ deviceId: uuid(), cpoOrgId: ORG, chargePointId: "CP-1", open: true });
    return store;
  };
  it.each([
    ["bad_credentials", /password the charger sent does not match/],
    ["credentials_required", /without credentials/],
    ["username_mismatch", /charge point id/],
    ["credentials_not_configured", /no OCPP password setting/],
  ])("%s is shown with an actionable note", async (reason, text) => {
    const store = world2();
    store.seedDiscovery(`${ORG}/CP-1`, { reason, reasonAt: T0, lastSeenAt: T0 });
    const [row] = await incomingChargers(store, ORG, actor, 50, at("2026-10-31T12:05:00Z"));
    expect(row).toMatchObject({ chargePointId: "CP-1", state: "recovery" });
    expect(row!.note).toMatch(text);
    expect(JSON.stringify(row)).not.toMatch(/verifier|secret|pbkdf|Basic /i);
  });
  it("an accepted boot after the refusal clears it; one before does not", async () => {
    const store = world2();
    store.seedDiscovery(`${ORG}/CP-1`, { reason: "bad_credentials", reasonAt: T0, lastSeenAt: T0 });
    store.bootAt.set(`${ORG}/cp-1`, new Date(T0.getTime() - 1000));
    expect(await incomingChargers(store, ORG, actor, 50, at("2026-10-31T12:05:00Z"))).toHaveLength(1);
    store.bootAt.set(`${ORG}/cp-1`, new Date(T0.getTime() + 1000));
    expect(await incomingChargers(store, ORG, actor, 50, at("2026-10-31T12:05:00Z"))).toEqual([]);
  });
  it("a credential refusal outranks 'waiting', and the charger stays visible in an actionable view", async () => {
    const store = world();
    store.seedDiscovery(`${ORG}/CP-1`);
    await saveInstallation(store, attach("CP-1"), actor, { ...deps, now: () => T0 });
    const d = store.state.discoveries.get(`${ORG}/CP-1`)!;
    d.reason = "bad_credentials";
    d.reasonAt = new Date(T0.getTime() + 1000);
    const [row] = await incomingChargers(store, ORG, actor, 50, at("2026-10-31T12:05:00Z"));
    expect(row!.note).toMatch(/does not match/);
    expect(row!.activation).toBeNull();
  });
  it("is scoped to the CPO: another CPO's refusal for the same id is invisible", async () => {
    const store = world2();
    store.seedDiscovery(`${OTHER}/CP-1`, { reason: "bad_credentials", reasonAt: T0, lastSeenAt: T0 });
    expect(await incomingChargers(store, ORG, actor, 50, at("2026-10-31T12:05:00Z"))).toEqual([]);
  });
});
