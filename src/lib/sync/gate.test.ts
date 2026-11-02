import { beforeEach, describe, expect, it } from "vitest";
import { SHELL_COOKIE_NAME, createShellSession, type ShellConfig } from "@/lib/cpo-shell-session";
import { handleInstallations, type ApiDeps, type Repo } from "@/lib/installations/api";
import { ScopeChecker } from "./check";
import { LocalGate, MAX_GATE_KEYS, decide, hubBackedGate, type Gate } from "./gate";
import { REPAIR_WAIT_TRIES, VersionHubCore, hubBackedRepo, type HubClient, type HubStorage } from "./hub";
import { memorySync } from "./__tests__/memory-repo";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

let clock: number;
let store: Map<string, unknown>;
const mem = (): HubStorage => ({
  async get<T>(k: string) { return structuredClone(store.get(k)) as T | undefined; },
  async put<T>(k: string, v: T) { store.set(k, structuredClone(v)); },
  async delete(k: string) { return store.delete(k); },
});
let core: VersionHubCore;
beforeEach(() => { clock = 1_000_000; store = new Map(); core = new VersionHubCore(mem(), () => clock); });

describe("fixed-window decision rule", () => {
  it("admits up to the limit inside a window, denies the rest with the time left, then admits again in a new window", () => {
    let e = decide(undefined, 0, 1000, 2);
    expect(e.decision).toMatchObject({ allow: true, retryAfterMs: 1000, ageMs: 0 });
    e = decide(e.entry, 100, 1000, 2);
    expect(e.decision.allow).toBe(true);
    e = decide(e.entry, 400, 1000, 2);
    expect(e.decision).toMatchObject({ allow: false, retryAfterMs: 600, ageMs: 400 });
    e = decide(e.entry, 1000, 1000, 2);
    expect(e.decision).toMatchObject({ allow: true, ageMs: 0 });
  });
  it("a clock that moved backwards starts a fresh window instead of locking the key", () => {
    expect(decide({ w: 5_000, n: 9 }, 1_000, 1000, 1).decision.allow).toBe(true);
  });
});

describe("hub gate: one decision for every isolate", () => {
  const client = (): Gate => hubBackedGate(core as unknown as HubClient, new LocalGate(() => clock)); // each "isolate" has its own fallback

  it("two isolates share ONE window: the second is denied even though its own local state is empty", async () => {
    const one = client();
    const two = client();
    expect((await one.take("k", 30_000, 1)).allow).toBe(true);
    const d = await two.take("k", 30_000, 1);
    expect(d).toMatchObject({ allow: false, source: "hub" });
    expect(d.retryAfterMs).toBe(30_000);
    clock += 12_000;
    expect(await two.take("k", 30_000, 1)).toMatchObject({ allow: false, retryAfterMs: 18_000, ageMs: 12_000 });
    clock += 18_000;
    expect((await two.take("k", 30_000, 1)).allow).toBe(true);
  });

  it("a rate limit of N admits exactly N across isolates in a window", async () => {
    const gates = [client(), client(), client()];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => gates[i % 3]!.take("list|op", 60_000, 4)));
    expect(results.filter((r) => r.allow)).toHaveLength(4);
  });

  it("keys never share a window (different actors / permission scopes / kinds)", async () => {
    const g = client();
    expect((await g.take("read|tree|platform-operator|alice", 60_000, 1)).allow).toBe(true);
    expect((await g.take("read|tree|platform-operator|bob", 60_000, 1)).allow).toBe(true);
    expect((await g.take("read|list|platform-operator|alice", 60_000, 1)).allow).toBe(true);
    expect((await g.take("read|tree|platform-operator|alice", 60_000, 1)).allow).toBe(false);
  });

  it("returns the recorded answer only to a DENIED taker, and refuses oversize or unwindowed input", async () => {
    const g = client();
    const first = await g.take("check|x", 30_000, 1);
    expect(first.data).toBeUndefined();
    await g.record("check|x", { at: clock, revisions: { [A]: 3 } });
    expect((await g.take("check|x", 30_000, 1)).data).toEqual({ at: clock, revisions: { [A]: 3 } });
    await g.record("check|x", { blob: "x".repeat(5000) });
    expect(((await g.take("check|x", 30_000, 1)).data as { revisions?: unknown }).revisions).toBeDefined(); // oversize write ignored
    expect(await core.gate("k", 5, 1)).toMatchObject({ allow: false }); // window under 1 s is not a valid policy
    expect(await core.gate("k", 30_000, 0)).toMatchObject({ allow: false });
  });

  it("bounds its own storage: the oldest keys are evicted past the cap", async () => {
    for (let i = 0; i < MAX_GATE_KEYS + 10; i++) await core.gate(`k${i}`, 60_000, 1);
    expect([...store.keys()].filter((k) => k.startsWith("gate:"))).toHaveLength(MAX_GATE_KEYS);
    expect(store.has("gate:k0")).toBe(false);
    expect(store.has(`gate:k${MAX_GATE_KEYS + 9}`)).toBe(true);
  });

  it("falls back to the isolate gate when the hub is unreachable, and says so", async () => {
    const broken = { gate: async () => { throw new Error("hub down"); }, gateRecord: async () => { throw new Error("hub down"); } };
    const g = hubBackedGate(broken, new LocalGate(() => clock));
    expect(await g.take("k", 30_000, 1)).toMatchObject({ allow: true, source: "isolate" });
    expect(await g.take("k", 30_000, 1)).toMatchObject({ allow: false, source: "isolate" });
    await expect(g.record("k", { a: 1 })).resolves.toBeUndefined();
  });

  it("a hub class without the method (older deployment) behaves like no hub", async () => {
    const g = hubBackedGate({}, new LocalGate(() => clock));
    expect((await g.take("k", 30_000, 1)).source).toBe("isolate");
  });
});

describe("check cooldown across isolates", () => {
  const probes = { n: 0 };
  const probe = (revs: Record<string, number>) => async () => { probes.n++; return revs; };
  const isolate = () => ({ checker: new ScopeChecker(() => clock, 30_000), gate: hubBackedGate(core as unknown as HubClient, new LocalGate(() => clock)) });
  beforeEach(() => { probes.n = 0; });

  it("N isolates admit ONE check per actor per cooldown; the others are answered from the recorded revisions without a probe", async () => {
    const isolates = Array.from({ length: 5 }, isolate);
    const answers = [];
    for (const i of isolates) answers.push(await i.checker.check("op|alice", "scope1", probe({ [A]: 2 }), i.gate));
    expect(probes.n).toBe(1);
    expect(answers[0]).toMatchObject({ deferred: false });
    for (const a of answers.slice(1)) expect(a).toMatchObject({ deferred: true, revisions: { [A]: 2 }, retryAfterMs: 30_000 });
  });

  it("a different actor has its own cooldown", async () => {
    const i = isolate(); const j = isolate();
    await i.checker.check("op|alice", "scope1", probe({ [A]: 2 }), i.gate);
    const bob = await j.checker.check("op|bob", "scope1", probe({ [A]: 2 }), j.gate);
    expect(bob.deferred).toBe(false);
  });

  it("a commit made through the hub is folded into the remembered answer, so another isolate's deferred answer cannot hide it", async () => {
    await core.prime([A], { [A]: { rev: 2, sv: 0 } });
    const i = isolate(); const j = isolate();
    await i.checker.check("op|alice", "scope1", probe({ [A]: 2 }), i.gate);
    await core.bump(A, { rev: 3 }); // a save committed in a third isolate
    const later = await j.checker.check("op|alice", "scope1", probe({ [A]: 2 }), j.gate);
    expect(later).toMatchObject({ deferred: true, revisions: { [A]: 3 } });
  });

  it("when the admitting isolate has not recorded yet, the denied isolate looks once for itself instead of answering from nothing", async () => {
    const i = isolate(); const j = isolate();
    await i.gate.take("check|op|alice|scope1", 30_000, 1); // admitted, probe still running, nothing recorded
    const a = await j.checker.check("op|alice", "scope1", probe({ [A]: 4, [B]: 1 }), j.gate);
    expect(a).toMatchObject({ deferred: true, revisions: { [A]: 4, [B]: 1 } });
    expect(probes.n).toBe(1);
  });

  it("without a gate it is the established isolate-local cooldown", async () => {
    const c = new ScopeChecker(() => clock, 30_000);
    await c.check("p", "s", probe({ [A]: 1 }));
    const r = await c.check("p", "s", probe({ [A]: 1 }));
    expect(r.deferred).toBe(true);
    expect(probes.n).toBe(1);
  });
});

describe("shared repair on a lost or expired hub reading", () => {
  const w = () => memorySync();
  const noSleep = async () => { clock += 200; };

  it("K isolates facing a lost reading cost ONE database read: one repairs, the others take its result", async () => {
    const world = w();
    world.addInstallation(A);
    let dbReads = 0;
    const inner = { ...world.repo, versions: async (ids: string[]) => { dbReads++; await Promise.resolve(); return world.repo.versions(ids); } };
    // Simulate the repairing isolate finishing during the others' first wait.
    let repairer: Promise<unknown> | null = null;
    const sleep = async () => { await repairer; };
    const repos = Array.from({ length: 4 }, () => hubBackedRepo(inner, core as unknown as HubClient, 120_000, sleep));
    repairer = repos[0]!.versions([A]);
    const rest = await Promise.all(repos.slice(1).map((r) => r.versions([A])));
    await repairer;
    expect(dbReads).toBe(1);
    for (const m of rest) expect(m.get(A)).toBeDefined();
    // The lease is released: a later loss can be repaired again.
    expect(await core.claimRepair(5000)).toBe(true);
  });

  it("if the repairing isolate never finishes, waiters stop waiting after a bounded time and read for themselves", async () => {
    const world = w();
    world.addInstallation(A);
    let dbReads = 0;
    const inner = { ...world.repo, versions: async (ids: string[]) => { dbReads++; return world.repo.versions(ids); } };
    expect(await core.claimRepair(10_000)).toBe(true); // a crashed repairer: lease taken, never primed, never released
    let sleeps = 0;
    const repo = hubBackedRepo(inner, core as unknown as HubClient, 120_000, async () => { sleeps++; clock += 150; });
    const got = await repo.versions([A]);
    expect(sleeps).toBe(REPAIR_WAIT_TRIES);
    expect(dbReads).toBe(1);
    expect(got.has(A)).toBe(true);
  });

  it("an expired lease is claimable again, and a hub without the method repairs for itself exactly as before", async () => {
    expect(await core.claimRepair(2000)).toBe(true);
    expect(await core.claimRepair(2000)).toBe(false);
    clock += 2001;
    expect(await core.claimRepair(2000)).toBe(true);
    const world = w();
    world.addInstallation(A);
    let dbReads = 0;
    const inner = { ...world.repo, versions: async (ids: string[]) => { dbReads++; return world.repo.versions(ids); } };
    const bare: HubClient = { read: async () => null, prime: async () => undefined, bump: async () => undefined, invalidate: async () => undefined };
    await hubBackedRepo(inner, bare, 120_000, noSleep).versions([A]);
    expect(dbReads).toBe(1);
  });
});

describe("installations reads are limited on the server, after authorization", () => {
  const HTTPS = "https://shell.example.test";
  const CONFIG: ShellConfig = { username: "ShellTester", password: "disposable-test-password", secret: "test-only-signing-secret-0123456789abcdef" };
  const ENV = { CPO_SHELL_USERNAME: CONFIG.username, CPO_SHELL_PASSWORD: CONFIG.password, CPO_SHELL_SESSION_SECRET: CONFIG.secret };
  const cookie = async () => `${SHELL_COOKIE_NAME}=${await createShellSession(CONFIG)}`;
  let repoCalls = 0;
  const repo = {
    list: async () => { repoCalls++; return []; }, listChargers: async () => { repoCalls++; return []; }, revisions: async () => ({}),
    getTree: async () => { repoCalls++; return null; }, listIncoming: async () => { repoCalls++; return []; }, get: async () => { repoCalls++; return null; },
  } as unknown as Repo;
  const deps = (gate?: Gate): ApiDeps => ({ env: ENV, contextOrgId: "11111111-1111-4111-8111-111111111111", withRepo: async (fn) => fn(repo), ...(gate ? { gate } : {}) });
  const get = async (d: ApiDeps, path: string, c?: string) => handleInstallations(new Request(`${HTTPS}${path}`, { headers: { cookie: c ?? (await cookie()) } }), d);
  const ID = "cccccccc-0000-4000-8000-000000000003";
  beforeEach(() => { repoCalls = 0; });

  it("refuses list reads past the limit with 429 + Retry-After and does NOT reach the repository", async () => {
    const d = deps(new LocalGate(() => clock));
    for (let i = 0; i < 12; i++) expect((await get(d, "/api/cpo/installations")).status).toBe(200);
    expect(repoCalls).toBe(12);
    const res = await get(d, "/api/cpo/installations");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "rate_limited" });
    expect(repoCalls).toBe(12);
  });

  it("list, tree, detail and incoming are separate budgets, and a new window restores service", async () => {
    const d = deps(new LocalGate(() => clock));
    for (let i = 0; i < 12; i++) await get(d, "/api/cpo/installations");
    expect((await get(d, "/api/cpo/installations")).status).toBe(429);
    expect((await get(d, `/api/cpo/installations?id=${ID}&shape=tree`)).status).toBe(404); // tree budget untouched (repo answers "not found")
    expect((await get(d, "/api/cpo/installations?incoming=1")).status).toBe(200);
    clock += 60_001;
    expect((await get(d, "/api/cpo/installations")).status).toBe(200);
  });

  it("authorization is not traded for the limiter: an unauthenticated caller gets 401 and consumes no budget", async () => {
    const taken: string[] = [];
    const spy: Gate = { take: async (k) => { taken.push(k); return { allow: true, retryAfterMs: 1, ageMs: 0, source: "isolate" }; }, record: async () => undefined };
    const res = await handleInstallations(new Request(`${HTTPS}/api/cpo/installations`), deps(spy));
    expect(res.status).toBe(401);
    expect(taken).toEqual([]);
  });

  it("without a gate nothing is limited (the established behaviour)", async () => {
    const d = deps();
    for (let i = 0; i < 30; i++) expect((await get(d, "/api/cpo/installations")).status).toBe(200);
  });
});
