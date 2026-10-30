import { beforeEach, describe, expect, it } from "vitest";
import { StructureCache } from "./cache";
import { SyncClient } from "./client";
import { HUB_MAX_AGE_MS, VersionHubCore, hubBackedAccess, hubBackedRepo, notifyCommitted, type HubClient, type HubStorage } from "./hub";
import { readChanges, readSnapshot, type AccessPort, type SyncDeps } from "./service";
import { memorySync } from "./__tests__/memory-repo";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const dev = (n: number) => `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

type Actor = { operator: boolean };
const OP: Actor = { operator: true };
const NOBODY: Actor = { operator: false };

let w: ReturnType<typeof memorySync>;
let clock: number;
let store: Map<string, unknown>;
let hubCalls: Record<string, number>;
let accessCalls: number;
let hub: HubClient;
let hubDown: boolean;

function memStorage(): HubStorage {
  return {
    async get<T>(k: string) { return store.get(k) as T | undefined; },
    async put<T>(k: string, v: T) { store.set(k, structuredClone(v)); },
    async delete(k: string) { return store.delete(k); },
  };
}

/** One "isolate": its own cache, decorated access and repo, but the SAME hub and database. */
function isolate(): SyncDeps<Actor> {
  const dbAccess: AccessPort<Actor> = { visible: async (a) => { accessCalls++; return a.operator ? { installationIds: [A, B] } : null; } };
  const counted = (): HubClient => new Proxy(hub, { get: (t, k: string) => (...args: unknown[]) => { hubCalls[k] = (hubCalls[k] ?? 0) + 1; return (t as never as Record<string, (...a: unknown[]) => unknown>)[k]!(...args); } });
  const h = counted();
  return {
    access: hubBackedAccess(dbAccess, h, (a) => a.operator),
    repo: hubBackedRepo(w.repo, h),
    cache: new StructureCache(50, 600_000, () => clock),
    now: () => clock,
  };
}

beforeEach(() => {
  w = memorySync();
  for (const id of [A, B]) {
    w.addInstallation(id, id);
    w.addCircuit(id, { id: `c-${id.slice(0, 4)}`, parentId: null, displayName: "Main", ratingAmps: 63, phaseCount: 3, sortOrder: 0 });
    for (let n = 1; n <= 5; n++) w.addCharger(id, { id: id === A ? dev(n) : dev(n + 50), circuitId: `c-${id.slice(0, 4)}`, label: `Charger ${n}`, chargePointId: `CP-${n}`, vendor: null, model: null, serialNumber: null });
  }
  clock = 1_800_000_000_000;
  store = new Map();
  hubCalls = {};
  accessCalls = 0;
  hubDown = false;
  const core = new VersionHubCore(memStorage(), () => clock);
  hub = {
    read: async () => { if (hubDown) throw new Error("hub down"); return core.read(); },
    prime: async (i, v) => { if (hubDown) throw new Error("hub down"); return core.prime(i, v); },
    bump: async (i, p) => { if (hubDown) throw new Error("hub down"); return core.bump(i, p); },
    invalidate: () => core.invalidate(),
  };
  w.resetCalls();
});

const snap = async (d: SyncDeps<Actor>, a = OP) => {
  const r = await readSnapshot(d, a);
  if (r.kind !== "snapshot") throw new Error(r.kind);
  return r.body;
};

describe("cross-instance version hub", () => {
  it("after one priming read, idle polls from ANY isolate cost no database query at all", async () => {
    const i1 = isolate();
    const s = await snap(i1);
    expect(accessCalls).toBe(1);
    expect(w.calls.versions).toBe(1);
    w.resetCalls(); accessCalls = 0;
    const i2 = isolate(); // a different isolate: cold cache, shared hub
    for (let n = 0; n < 5; n++) {
      const r = await readChanges(i2, OP, s.cursor);
      expect(r).toMatchObject({ kind: "changes", body: { changes: [] } });
    }
    expect(accessCalls).toBe(0); // access list from the hub
    expect(w.calls).toEqual({}); // no probe, no history, nothing
  });

  it("a committed status change reaches another isolate through the hub: only the device row is read, no probe, no tree", async () => {
    const s = await snap(isolate());
    w.status(A, dev(2), "Charging");
    await notifyCommitted(hub, A, { sv: 1 });
    w.resetCalls();
    const r = await readChanges(isolate(), OP, s.cursor);
    expect(w.calls).toEqual({ operationalSince: 1 });
    expect((r as { body: { changes: unknown[] } }).body.changes).toHaveLength(1);
  });

  it("a committed structure edit propagates the same way (history + entity reads, never a tree rebuild for the delta)", async () => {
    const s = await snap(isolate());
    w.renameCharger(A, dev(1), "Bay 1");
    await notifyCommitted(hub, A, { rev: w.revisionOf(A) });
    w.resetCalls();
    const client = new SyncClient();
    client.applySnapshot(s);
    client.applyChanges(((await readChanges(isolate(), OP, s.cursor)) as unknown as { body: never }).body);
    expect(w.calls.versions).toBeUndefined();
    expect(w.calls.structure).toBeUndefined();
    expect(client.get<{ label: string }>("charger", dev(1))!.label).toBe("Bay 1");
  });

  it("a LOST notification only delays visibility: within the age bound the hub is older, after it the database corrects it", async () => {
    const s = await snap(isolate());
    w.status(A, dev(3), "Faulted"); // committed, hub never told
    w.resetCalls();
    const stale = await readChanges(isolate(), OP, s.cursor);
    expect((stale as { body: { changes: unknown[] } }).body.changes).toHaveLength(0); // within the bound: stale by design
    clock += HUB_MAX_AGE_MS + 1;
    w.resetCalls();
    const fixed = await readChanges(isolate(), OP, s.cursor);
    expect(w.calls.versions).toBe(1); // database probe on expiry, hub re-primed
    expect((fixed as { body: { changes: unknown[] } }).body.changes).toHaveLength(1);
    w.resetCalls();
    await readChanges(isolate(), OP, s.cursor);
    expect(w.calls.versions).toBeUndefined(); // primed again
  });

  it("bumps are monotonic: a late or duplicate notification can never move a counter backwards", async () => {
    await snap(isolate());
    await hub.bump(A, { rev: 9, sv: 4 });
    await hub.bump(A, { rev: 3, sv: 1 }); // late
    await hub.bump(A, { rev: 9, sv: 4 }); // duplicate
    const r = await hub.read();
    expect(r!.versions[A]).toEqual({ rev: 9, sv: 4 });
  });

  it("an unreachable hub degrades to the database and still answers correctly; notify never throws", async () => {
    const s = await snap(isolate());
    w.status(A, dev(1), "Charging");
    hubDown = true;
    expect(await notifyCommitted(hub, A, { sv: 1 })).toBe(false);
    w.resetCalls();
    const r = await readChanges(isolate(), OP, s.cursor);
    expect(w.calls.versions).toBe(1);
    expect((r as { body: { changes: unknown[] } }).body.changes).toHaveLength(1);
  });

  it("a bump for an installation the hub does not list forces a refresh of the list", async () => {
    await snap(isolate());
    await hub.bump("cccccccc-0000-4000-8000-000000000003", { rev: 1 });
    expect((await hub.read())!.ageMs).toBeGreaterThanOrEqual(clock); // loadedAt zeroed => treated as expired
  });

  it("revocation is not traded for a saved query: an actor without session-level permission never touches the hub and gets nothing", async () => {
    const d = isolate();
    await snap(d);
    hubCalls = {};
    expect(await readSnapshot(d, NOBODY)).toEqual({ kind: "forbidden" });
    expect(await readChanges(d, NOBODY, (await snap(d)).cursor)).toEqual({ kind: "forbidden" });
    expect(hubCalls.read ?? 0).toBeLessThanOrEqual(2); // only the allowed snapshot() call above reads it
  });

  it("the hub holds only counters and ids: nothing else is ever stored", async () => {
    await snap(isolate());
    const state = store.get("hub") as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(["ids", "loadedAt", "versions"]);
    expect(JSON.stringify(state)).not.toMatch(/name|label|verifier|password|token|chargePoint/i);
  });

  it("the age bound is a stated constant", () => {
    expect(HUB_MAX_AGE_MS).toBe(120_000);
  });
});
