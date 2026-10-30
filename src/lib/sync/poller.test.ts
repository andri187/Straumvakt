import { beforeEach, describe, expect, it } from "vitest";
import { StructureCache } from "./cache";
import { SyncClient } from "./client";
import { MAX_CATCHUP_STEPS, POLL_BASE_MS, POLL_MAX_ERROR_MS, POLL_MAX_MS, SyncPoller, type Fetchers } from "./poller";
import { readChanges, readSnapshot, type SyncDeps } from "./service";
import { memoryAccess, memorySync } from "./__tests__/memory-repo";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const dev = (n: number) => `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

let w: ReturnType<typeof memorySync>;
let access: ReturnType<typeof memoryAccess>;
let calls: { snapshot: number; changes: number };
let down: boolean;
let deps: SyncDeps<string>;

const fetchers: Fetchers = {
  async snapshot(inm) {
    calls.snapshot++;
    if (down) return { status: 503 };
    const r = await readSnapshot(deps, "u", inm);
    if (r.kind === "forbidden") return { status: 403 };
    if (r.kind === "not_modified") return { status: 304 };
    if (r.kind === "too_many") return { status: 413 };
    return { status: 200, etag: r.etag, body: r.body };
  },
  async changes(cursor) {
    calls.changes++;
    if (down) return { status: 503 };
    const r = await readChanges(deps, "u", cursor);
    return r.kind === "forbidden" ? { status: 403 } : { status: 200, body: r.body };
  },
};

beforeEach(() => {
  w = memorySync();
  w.addInstallation(A, "Harbour");
  w.addCircuit(A, { id: "c1", parentId: null, displayName: "Main", ratingAmps: 63, phaseCount: 3, sortOrder: 0 });
  for (let n = 1; n <= 3; n++) w.addCharger(A, { id: dev(n), circuitId: "c1", label: `C${n}`, chargePointId: `CP-${n}`, vendor: null, model: null, serialNumber: null });
  access = memoryAccess({ u: [A] });
  deps = { access, repo: w.repo, cache: new StructureCache(), now: () => 1_800_000_000_000 };
  calls = { snapshot: 0, changes: 0 };
  down = false;
});

describe("SyncPoller", () => {
  it("one snapshot, then one bounded request per interval; an unchanged streak stretches the interval and a change snaps it back", async () => {
    const p = new SyncPoller(new SyncClient(), fetchers);
    expect(await p.step()).toEqual({ event: "snapshot", nextDelayMs: POLL_BASE_MS });
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) waits.push((await p.step()).nextDelayMs!);
    expect(waits).toEqual([60_000, 120_000, 120_000, 120_000, 120_000]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(POLL_MAX_MS);
    w.status(A, dev(1), "Charging");
    expect(await p.step()).toEqual({ event: "changes", nextDelayMs: POLL_BASE_MS });
    expect(calls).toEqual({ snapshot: 1, changes: 6 });
  });

  it("applies deltas to the client without refetching the tree", async () => {
    const client = new SyncClient();
    const p = new SyncPoller(client, fetchers);
    await p.step();
    w.status(A, dev(2), "Faulted");
    w.resetCalls();
    await p.step();
    expect(client.deviceState(dev(2))!.connectors["1"]!.status).toBe("Faulted");
    expect(w.calls.structure).toBeUndefined();
  });

  it("failures back off exponentially to a cap and recover without losing the cursor", async () => {
    const client = new SyncClient();
    const p = new SyncPoller(client, fetchers);
    await p.step();
    const cursor = client.cursor;
    down = true;
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) waits.push((await p.step()).nextDelayMs!);
    expect(waits.slice(0, 3)).toEqual([60_000, 120_000, 240_000]);
    expect(Math.max(...waits)).toBe(POLL_MAX_ERROR_MS);
    expect(client.cursor).toBe(cursor);
    down = false;
    w.status(A, dev(1), "Charging");
    expect((await p.step()).event).toBe("changes");
  });

  it("a scope change evicts everything and refetches immediately, only what is still visible", async () => {
    const client = new SyncClient();
    const p = new SyncPoller(client, fetchers);
    await p.step();
    access.grants.u = [];
    const r = await p.step();
    expect(r).toEqual({ event: "reset", nextDelayMs: 0 });
    expect(client.list("installation")).toHaveLength(0);
    expect((await p.step()).event).toBe("snapshot");
  });

  it("revocation (403) clears the cache and stops; no further requests are scheduled", async () => {
    const client = new SyncClient();
    const p = new SyncPoller(client, fetchers);
    await p.step();
    access.grants.u = null;
    expect(await p.step()).toEqual({ event: "signed_out", nextDelayMs: null });
    expect(client.cursor).toBeNull();
    expect(client.list("charger")).toHaveLength(0);
  });

  it("catch-up bursts are bounded: repeated resets fall back to the normal interval", async () => {
    const client = new SyncClient();
    const p = new SyncPoller(client, fetchers);
    const flapping: Fetchers = { snapshot: fetchers.snapshot, changes: async () => ({ status: 200, body: { schema: 1, resetRequired: "scope_changed" } }) };
    const q = new SyncPoller(client, flapping);
    await q.step();
    const delays: (number | null)[] = [];
    for (let i = 0; i < MAX_CATCHUP_STEPS + 1; i++) delays.push((await q.step()).nextDelayMs);
    expect(delays).toContain(POLL_BASE_MS);
    void p;
  });

  it("does nothing by itself: no timers, no requests until step() is called", () => {
    new SyncPoller(new SyncClient(), fetchers);
    expect(calls).toEqual({ snapshot: 0, changes: 0 });
  });
});
