// Post-fix navigation path, end to end below the browser: the real StructuralStore calls the real handlers (handleInstallations,
// handleSync) over the project's real migrations on PGlite, and every SQL statement is counted by class. The same fixture and the
// same classifier as baseline.perf.test.ts, so the numbers are comparable. `PERF=1` also writes .tmp/perf/after.json.
//
// Not covered here: React rendering and a real browser (see the report), Neon network latency, the Cloudflare VersionHub binding
// (an in-process VersionHubCore with the same logic stands in; production has no binding until it is deployed).

import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleInstallations, type ApiDeps } from "@/lib/installations/api";
import { mayAdminister, sharedLoginActor, type Actor } from "@/lib/installations/actor";
import { repoFor } from "@/lib/installations/repo";
import { handleSync, type SyncApiDeps } from "@/lib/sync/api";
import { StructureCache } from "@/lib/sync/cache";
import { ScopeChecker } from "@/lib/sync/check";
import { drizzleSharedLoginAccess, drizzleSyncRepo } from "@/lib/sync/drizzle-sync-store";
import { VersionHubCore, hubBackedAccess, hubBackedRepo, type HubClient, type HubStorage } from "@/lib/sync/hub";
import { SingleFlight } from "@/lib/sync/single-flight";
import { StructuralStore } from "@/lib/sync/structural-store";
import { ORIGIN, SHELL_CONFIG, SHELL_ENV, changeStatus, makeFixture, measure, sessionCookie, type Fixture, type Measurement } from "./harness";

let fx: Fixture;
let t = Date.parse("2026-10-31T12:00:00Z");
const results: Measurement[] = [];
const actor = sharedLoginActor(SHELL_CONFIG.username);

class MemStorage implements HubStorage {
  private m = new Map<string, unknown>();
  async get<T>(k: string) { return this.m.get(k) as T | undefined; }
  async put<T>(k: string, v: T) { this.m.set(k, v); }
  async delete(k: string) { return this.m.delete(k); }
}

/** One simulated isolate: its own checker, flight table and structure cache, over the shared database. */
function isolate(opts: { hub?: HubClient | null } = {}) {
  const checker = new ScopeChecker(() => t);
  const flight = new SingleFlight();
  const cache = new StructureCache();
  const hub = opts.hub ?? null;
  // Holds every repository/sync call until released, so tests can make requests genuinely overlap.
  let gate: Promise<void> | null = null;
  // When set, the device-state read waits until this many callers have joined a shared load (or 2 s pass), so overlap is certain.
  let joinTarget = 0;
  const api: ApiDeps = {
    env: SHELL_ENV,
    contextOrgId: fx.orgId,
    flight,
    async withRepo(fn) {
      if (gate) await gate;
      fx.counter.connections += 1;
      return fn(repoFor(fx.db));
    },
  };
  const sync: SyncApiDeps = {
    env: SHELL_ENV,
    checker,
    async withSync(fn) {
      if (gate) await gate;
      fx.counter.connections += 1;
      const access = drizzleSharedLoginAccess<Actor>(fx.db, (a) => mayAdminister(a, ""));
      const base = drizzleSyncRepo(fx.db);
      const repo = {
        ...base,
        async operationalMany(ids: string[]) {
          const end = Date.now() + 2000;
          while (joinTarget && flight.stats.joined < joinTarget && Date.now() < end) await new Promise((r) => setTimeout(r, 2));
          return base.operationalMany(ids);
        },
      };
      return fn({ access: hub ? hubBackedAccess(access, hub, (a) => mayAdminister(a, "")) : access, repo: hub ? hubBackedRepo(repo, hub) : repo, cache, now: () => t, flight });
    },
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const req = new Request(`${ORIGIN}${url}`, { headers: { cookie: await sessionCookie(), ...((init?.headers as Record<string, string>) ?? {}) } });
    return url.startsWith("/api/cpo/sync") ? handleSync(req, sync) : handleInstallations(req, api);
  };
  const hold = () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    return () => { gate = null; release(); };
  };
  return { checker, flight, api, sync, fetchImpl, hold, waitForJoins: (n: number) => { joinTarget = n; }, newStore: (partition = "u:1") => { const s = new StructuralStore({ fetch: fetchImpl, now: () => t }); s.bind(partition); return s; } };
}

const primedHub = async (iso: ReturnType<typeof isolate>): Promise<HubClient> => {
  const hub = new VersionHubCore(new MemStorage(), () => t);
  const ids = fx.installationIds;
  const versions = Object.fromEntries([...(await drizzleSyncRepo(fx.db).versions(ids))].map(([id, v]) => [id, { rev: v.revision, sv: v.statusVersion }]));
  await hub.prime(ids, versions);
  void iso;
  return hub;
};

beforeAll(async () => { fx = await makeFixture(); }, 180_000);
afterAll(async () => {
  if (process.env.PERF) {
    mkdirSync(".tmp/perf", { recursive: true });
    writeFileSync(".tmp/perf/after.json", JSON.stringify({ fixture: fx.size, installations: fx.installationIds.length, note: "PGlite in-process; real store + real handlers; counts are the evidence", results }, null, 2));
  }
  await fx.close();
});

const record = async (name: string, requests: number, fn: () => Promise<unknown>, note?: string) => { const m = await measure(fx, name, requests, fn, note); results.push(m); return m; };

describe("installations page: store + handlers", () => {
  it("cold load, warm revisit, first expansion, re-expansion", async () => {
    const iso = isolate();
    const store = iso.newStore();
    const cold = await record("installations: cold load (GET list + revisions)", 1, () => store.ensureOverview());
    expect(store.sent.overview).toBe(1);
    expect(cold.connections).toBe(1);
    expect(cold.dataQueries).toBe(2); // the list and the revision stamp; baseline was 1 (no stamp)

    const warm = await record("installations: warm revisit (shell remounts, store holds the list)", 0, () => store.ensureOverview());
    expect(store.sent.overview).toBe(1);
    expect([warm.dataQueries, warm.connections]).toEqual([0, 0]);

    const id = fx.installationIds[0]!;
    const first = await record("installations: first expansion (GET ?id&shape=tree)", 1, () => store.ensureDetail(id));
    expect(first.history).toBe(0); // baseline read 100 history rows nobody renders
    expect(first.structural).toBe(3);
    const again = await record("installations: re-expansion after navigating away and back", 0, () => store.ensureDetail(id));
    expect([again.dataQueries, again.connections]).toEqual([0, 0]);
    expect(store.sent.detail).toBe(1);
  });

  it("collapsed rows load no detail", async () => {
    const store = isolate().newStore();
    const m = await record("installations: 20 collapsed rows (detail requests)", 1, () => store.ensureOverview());
    expect(store.sent.detail).toBe(0);
    expect(m.dataQueries).toBe(2);
  });
});

describe("checks, cooldown and Refresh", () => {
  it("an unchanged check reads no tree: 2 small indexed queries without a hub, 0 with a fresh hub", async () => {
    const plain = isolate();
    const s1 = plain.newStore();
    await s1.ensureOverview();
    t += 31_000;
    const m1 = await record("check: unchanged, no hub (access + version probe)", 1, () => s1.check());
    expect([m1.structural, m1.history, m1.operational]).toEqual([0, 0, 0]);
    expect([m1.access, m1.version]).toEqual([1, 1]);
    expect(s1.updatesAvailable).toBe(false);

    const hubbed = isolate({ hub: await primedHub(isolate()) });
    const s2 = hubbed.newStore();
    await s2.ensureOverview();
    t += 31_000;
    const m2 = await record("check: unchanged, fresh VersionHub (in-process stand-in)", 1, () => s2.check());
    expect(m2.dataQueries).toBe(0);
    expect(s2.updatesAvailable).toBe(false);
  });

  it("inside the cooldown the server does no probe and does not claim 'unchanged'", async () => {
    const iso = isolate();
    const a = iso.newStore();
    const b = iso.newStore();
    await a.ensureOverview();
    t += 31_000;
    await a.check();
    t += 4_000;
    const m = await record("check: second viewer of the same actor inside the cooldown", 1, () => b.check());
    expect(m.version).toBe(0); // no probe
    expect(b.nextCheckAt).toBeGreaterThan(t); // told when to come back
    expect(b.lastCheckedAt).toBeLessThan(t); // and how old the answer is
  });

  it("a commit in this isolate shows in a deferred answer at once; a commit elsewhere waits for the next accepted check, with its age stated", async () => {
    const iso = isolate();
    const viewer = iso.newStore();
    await viewer.ensureOverview();
    t += 31_000;
    await viewer.check(); // accepted: the server now remembers these revisions
    const local = fx.installationIds[1]!;
    iso.checker.noteCommit(local, 99); // what repoFor().save does after a commit in this isolate
    t += 4_000; // inside the cooldown: the server must not probe
    fx.counter.reset();
    fx.counter.enabled = true;
    await viewer.check();
    fx.counter.enabled = false;
    expect(fx.counter.byClass.version).toBe(0);
    expect(viewer.staleIds.has(local)).toBe(true); // the deferred answer did not hide the local write

    const elsewhere = fx.installationIds[3]!;
    await fx.pg.exec(`update properties.installations set revision = revision + 1 where id = '${elsewhere}'`); // another isolate's commit
    t += 2_000;
    await viewer.check(); // still inside the cooldown: the answer is the remembered one, and it says how old it is
    expect(viewer.staleIds.has(elsewhere)).toBe(false);
    expect(viewer.lastCheckedAt).toBeLessThan(t - 5_000);
    t += 31_000;
    await viewer.check(); // accepted: the probe runs and sees it
    expect(viewer.staleIds.has(elsewhere)).toBe(true);
  });

  it("changed Refresh: one check, then the list once, details only if expanded", async () => {
    const iso = isolate();
    const store = iso.newStore();
    await store.ensureOverview();
    const id = fx.installationIds[2]!;
    store.setInstallationOpen(id, true);
    await store.ensureDetail(id);
    // A structure edit committed by another isolate (no noteCommit here): bump the revision as the writer would.
    await fx.pg.exec(`update properties.installations set revision = revision + 1 where id = '${id}'`);
    t += 31_000;
    const m = await record("refresh: one installation changed elsewhere (check + apply)", 3, async () => {
      const out = await store.refresh();
      expect(out.kind).toBe("applied");
    });
    expect(m.access).toBe(1);
    expect(m.version).toBe(1);
    expect(store.sent.overview).toBe(2);
    expect(store.sent.detail).toBe(2); // the expanded, changed one only
    expect(store.updatesAvailable).toBe(false);
  });

  it("a revoked user gets 403 before any cooldown answer, and the store empties", async () => {
    const iso = isolate();
    const store = iso.newStore();
    await store.ensureOverview();
    iso.sync.withSync = async (fn) => fn({ access: { visible: async () => null }, repo: drizzleSyncRepo(fx.db), cache: new StructureCache(), now: () => t });
    t += 31_000;
    await store.check();
    expect(store.denied).toBe(true);
    expect(store.overview.status).toBe("idle");
  });
});

describe("chargers page: store + handlers", () => {
  it("cold load, warm revisit, and a status poll with no tree read", async () => {
    const iso = isolate();
    const store = iso.newStore();
    const cold = await record("chargers: cold load (registered list + incoming + lean status snapshot)", 3, async () => {
      await Promise.all([store.ensureChargers(), store.ensureIncoming()]);
      const res = await iso.fetchImpl("/api/cpo/sync?view=status");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { installations: { devices: unknown[] }[] };
      expect(body.installations.reduce((n, i) => n + i.devices.length, 0)).toBe(fx.size.installations * fx.size.chargersPer);
    });
    expect(cold.operational).toBe(1); // baseline: 20 (one per installation) + the structure it re-read
    expect(cold.structural).toBe(2 /* chargers + revisions */);
    expect(cold.history).toBe(0);

    const warm = await record("chargers: warm revisit (store holds the list; status client resumes from its cursor)", 0, async () => {
      await store.ensureChargers();
      await store.ensureIncoming(); // fresh: reused
    });
    expect([warm.dataQueries, warm.connections]).toEqual([0, 0]);
  });

  it("lean status snapshot: 304 skips the device read; changes carry only what changed", async () => {
    const iso = isolate();
    const first = await iso.fetchImpl("/api/cpo/sync?view=status");
    const etag = first.headers.get("etag")!;
    const cursor = ((await first.json()) as { cursor: string }).cursor;
    const m304 = await record("chargers: conditional status snapshot, nothing changed", 1, async () => {
      expect((await iso.fetchImpl("/api/cpo/sync?view=status", { headers: { "if-none-match": etag } })).status).toBe(304);
    });
    expect([m304.operational, m304.structural]).toEqual([0, 0]);
    const unchanged = await record("chargers: one status poll, nothing changed (no hub)", 1, async () => { await iso.fetchImpl(`/api/cpo/sync?since=${cursor}`); });
    expect(unchanged.dataQueries).toBe(2);
    await changeStatus(fx, fx.installationIds[0]!);
    const changed = await record("chargers: one status poll with a status change", 1, async () => { await iso.fetchImpl(`/api/cpo/sync?since=${cursor}`); });
    expect(changed.operational).toBe(1);
    expect(changed.structural).toBe(0);
  });
});

describe("concurrent viewers and sessions", () => {
  it("10 viewers on a cold isolate share one list, one charger list and one device-state read", async () => {
    const iso = isolate();
    const K = 10;
    const stores = Array.from({ length: K }, (_, i) => iso.newStore(`viewer:${i}`));
    const release = iso.hold();
    iso.waitForJoins(3 * (K - 1));
    const m = await record(`concurrent: ${K} viewers open installations + chargers at once`, K * 3, async () => {
      const all = Promise.all(stores.flatMap((s) => [s.ensureOverview(), s.ensureChargers(), iso.fetchImpl("/api/cpo/sync?view=status").then((r) => r.json())]));
      await new Promise((r) => setTimeout(r, 30)); // every request is now waiting at the gate or has joined the shared load
      release();
      await all;
    });
    expect(iso.flight.stats.started).toBeLessThanOrEqual(3); // list, chargers, status device read
    expect(iso.flight.stats.joined).toBe(3 * (K - 1));
    expect(m.operational).toBe(1); // baseline: 200
    expect(m.structural).toBe(4); // list + revisions, chargers + revisions: once, not K times
    expect(m.access).toBe(K); // each viewer is authorised on its own request
  });

  it("a probe is shared by actors with the same visible set, but each actor keeps its own cooldown", async () => {
    const checker = new ScopeChecker(() => t);
    let probes = 0;
    const probe = async () => { probes += 1; await new Promise((r) => setTimeout(r, 5)); return { a: 1 }; };
    await Promise.all([checker.check("platform-operator|alice", "scope-1", probe), checker.check("platform-operator|bob", "scope-1", probe)]);
    expect(probes).toBe(1);
    expect((await checker.check("platform-operator|alice", "scope-1", probe)).deferred).toBe(true);
    expect((await checker.check("platform-operator|bob", "scope-1", probe)).deferred).toBe(true);
    // A different permission scope (a different visible set) never shares an answer or a cooldown.
    const other = await checker.check("platform-operator|alice", "scope-2", async () => { probes += 1; return { b: 2 }; });
    expect(other.deferred).toBe(false);
    expect(other.revisions).toEqual({ b: 2 });
    expect(probes).toBe(2);
  });

  it("A signs out and B signs in on one document: B starts empty; a request without a session reads nothing", async () => {
    const iso = isolate();
    const store = iso.newStore("alice:1");
    await store.ensureOverview();
    store.bind("bob:2");
    expect(store.overview.status).toBe("idle");
    fx.counter.reset();
    fx.counter.enabled = true;
    const res = await handleInstallations(new Request(`${ORIGIN}/api/cpo/installations`), iso.api);
    fx.counter.enabled = false;
    expect(res.status).toBe(401);
    expect(fx.counter.total).toBe(0);
    void actor;
  });
});
