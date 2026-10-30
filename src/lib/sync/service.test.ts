import { beforeEach, describe, expect, it } from "vitest";
import { StructureCache } from "./cache";
import { SyncClient } from "./client";
import { CURSOR_MAX_AGE_MS, MAX_OPERATIONAL_PER_PAGE, decodeCursor, encodeCursor, type ChangesResponse, type Cursor, type SnapshotResponse } from "./model";
import { readChanges, readSnapshot, type SyncDeps } from "./service";
import { memoryAccess, memorySync } from "./__tests__/memory-repo";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const DEV1 = "dddddddd-0000-4000-8000-000000000001";
const CIRC = "cccccccc-0000-4000-8000-000000000001";

let w: ReturnType<typeof memorySync>;
let access: ReturnType<typeof memoryAccess>;
let clock: number;
let cache: StructureCache;
const deps = (over: Partial<SyncDeps<string>> = {}): SyncDeps<string> => ({ access, repo: w.repo, cache, now: () => clock, ...over });
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

function seedInstallation(id: string) {
  w.addInstallation(id, `Inst ${id.slice(0, 4)}`);
  w.addCircuit(id, { id: CIRC.replace("0001", id.slice(0, 4)), parentId: null, displayName: "Main", ratingAmps: 63, phaseCount: 3, sortOrder: 0 });
  for (let n = 1; n <= 10; n++) {
    const cid = `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
    w.addCharger(id, { id: id === A ? cid : cid.replace("dddddddd", "eeeeeeee"), circuitId: CIRC.replace("0001", id.slice(0, 4)), label: `Charger ${n}`, chargePointId: `CP-${n}`, vendor: null, model: null, serialNumber: null });
  }
}
const dev = (n: number, inst = A) => (inst === A ? `dddddddd-0000-4000-8000-0000000000${String(n).padStart(2, "0")}` : `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`);

beforeEach(() => {
  w = memorySync();
  seedInstallation(A);
  seedInstallation(B);
  access = memoryAccess({ cpoA: [A], cpoB: [B], both: [A, B], nobody: null });
  clock = 1_800_000_000_000;
  cache = new StructureCache(50, 600_000, () => clock);
  w.resetCalls();
});

async function snapshot(actor = "cpoA", d = deps()) {
  const r = await readSnapshot(d, actor);
  if (r.kind !== "snapshot") throw new Error(r.kind);
  return r;
}
async function changes(cursor: string, actor = "cpoA", d = deps()) {
  const r = await readChanges(d, actor, cursor);
  if (r.kind !== "changes") throw new Error(r.kind);
  return r.body;
}

describe("snapshot, cache and conditional reads: query and byte evidence", () => {
  it("cold open reads the tree once; warm repeat navigation reads NO structure; the ETag answers 304 with no entity read", async () => {
    const cold = await snapshot();
    expect(w.calls).toEqual({ versions: 1, structure: 1, operational: 1 });
    const coldBytes = bytes(cold.body);

    w.resetCalls();
    const warm = await snapshot();
    expect(w.calls).toEqual({ versions: 1, operational: 1 }); // structure served from the validated cache
    expect(warm.body.installations[0]!.structure).toEqual(cold.body.installations[0]!.structure);

    w.resetCalls();
    const r = await readSnapshot(deps(), "cpoA", warm.etag);
    expect(r).toEqual({ kind: "not_modified", etag: warm.etag });
    expect(w.calls).toEqual({ versions: 1 }); // probe only: no tree, no device states
    // Evidence, not a performance claim: bytes for a 10-charger installation.
    expect(coldBytes).toBeGreaterThan(1500);
  });
  it("a browser refresh (no client state) is served from the server cache with one probe and no structure query", async () => {
    await snapshot();
    w.resetCalls();
    const fresh = new SyncClient();
    fresh.applySnapshot((await snapshot()).body);
    expect(w.calls.structure).toBeUndefined();
    expect(fresh.list("charger")).toHaveLength(10);
  });
  it("a structure save is never hidden by the cache, even when no invalidation reaches this isolate (lost invalidation)", async () => {
    await snapshot();
    w.renameCharger(A, dev(1), "Renamed"); // another isolate saved; this isolate's cache was never told
    w.resetCalls();
    const s = await snapshot();
    expect(w.calls.structure).toBe(1); // probe saw the new revision, entry rejected, rebuilt
    expect(s.body.installations[0]!.structure.chargers.find((c) => c.id === dev(1))!.label).toBe("Renamed");
  });
  it("cache entries expire by TTL, are bounded, and trust-window staleness is explicit and bounded", async () => {
    await snapshot();
    clock += 11 * 60_000; // past 10 min TTL
    w.resetCalls();
    await snapshot();
    expect(w.calls.structure).toBe(1);
    const tiny = new StructureCache(1, 600_000, () => clock);
    tiny.put("cpo-admin", A, (await snapshot()).body.installations[0]!.structure);
    tiny.put("cpo-admin", B, (await snapshot("cpoB")).body.installations[0]!.structure);
    expect(tiny.size).toBe(1);
    // trustForMs > 0 serves a recently validated entry without a probe: the ONLY staleness window.
    expect(cache.get("cpo-admin", A, null, 5_000)).not.toBeNull();
    clock += 6_000;
    expect(cache.get("cpo-admin", A, null, 5_000)).toBeNull();
  });
  it("never serves one installation's cached tree for another, or an admin payload under another projection key", async () => {
    await snapshot("both");
    expect(cache.get("cpo-admin", A, w.revisionOf(A))).not.toBeNull();
    expect(cache.get("cpo-admin", B, 9999)).toBeNull(); // a stale revision for B is a miss, and A's entry is not keyed under B
    expect(cache.get("driver" as never, A, w.revisionOf(A))).toBeNull();
  });
});

describe("incremental changes", () => {
  it("one status update fetches only that device: no tree, no history, no entity lookups", async () => {
    const client = new SyncClient();
    const snap = await snapshot();
    client.applySnapshot(snap.body);
    w.status(A, dev(3), "Charging");
    w.resetCalls();
    const body = await changes(client.cursor!);
    expect(w.calls).toEqual({ versions: 1, operationalSince: 1 });
    expect(body).toMatchObject({ hasMore: false });
    const c = (body as { changes: unknown[] }).changes;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "operational", entity: "device_state", id: dev(3), op: "upsert" });
    expect(bytes(body)).toBeLessThan(bytes(snap.body) / 4); // evidence: delta ≪ snapshot
    client.applyChanges(body);
    expect(client.deviceState(dev(3))!.connectors["1"]!.status).toBe("Charging");
    expect(client.list("charger")).toHaveLength(10); // tree untouched
  });
  it("an idle view costs one access check and one probe, and returns nothing", async () => {
    const snap = await snapshot();
    w.resetCalls();
    const body = await changes(snap.body.cursor);
    expect(w.calls).toEqual({ versions: 1 });
    expect(body).toMatchObject({ changes: [], hasMore: false });
  });
  it("a structure edit returns only the changed entities, one lookup per entity TYPE, and updates the revision", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    const before = client.get<{ revision: number }>("installation", A)!.revision;
    w.renameCharger(A, dev(1), "Bay 1");
    w.renameCharger(A, dev(2), "Bay 2");
    w.resetCalls();
    const body = await changes(client.cursor!);
    expect(w.calls).toEqual({ versions: 1, historyAfter: 1, installationView: 1, chargersByIds: 1 });
    const r = client.applyChanges(body) as { merged: { status: string }[] };
    expect(r.merged.every((m) => m.status === "applied")).toBe(true);
    expect(client.get<{ label: string }>("charger", dev(1))!.label).toBe("Bay 1");
    expect(client.get<{ revision: number }>("installation", A)!.revision).toBe(before + 2);
    expect(client.get("circuit", CIRC.replace("0001", A.slice(0, 4)))).not.toBeNull(); // untouched
  });
  it("removals arrive as tombstones and an older upsert delivered late cannot resurrect the entity", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    const cur0 = client.cursor!;
    w.detachCharger(A, dev(4));
    const body = await changes(cur0);
    client.applyChanges(body);
    expect(client.get("charger", dev(4))).toBeNull();
    // The same stale history replayed (duplicate / out-of-order delivery) must not bring it back.
    const stale: ChangesResponse = { schema: 1, cursor: client.cursor!, hasMore: false, changes: [{ kind: "structure", installationId: A, entity: "charger", id: dev(4), version: 1, op: "upsert", data: { id: dev(4), circuitId: "x", label: "ghost", chargePointId: "CP", vendor: null, model: null, serialNumber: null } }] };
    const r = client.applyChanges(stale) as { merged: { status: string }[] };
    expect(r.merged[0]!.status).toBe("stale_ignored");
    expect(client.get("charger", dev(4))).toBeNull();
  });
  it("duplicate and out-of-order operational updates never regress state", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    const c0 = client.cursor!;
    w.status(A, dev(1), "Preparing");
    w.status(A, dev(1), "Charging");
    const body = (await changes(c0)) as Extract<ChangesResponse, { changes: unknown[] }>;
    client.applyChanges(body);
    client.applyChanges(body); // duplicate
    expect(client.deviceState(dev(1))!.connectors["1"]!.status).toBe("Charging");
    const older: ChangesResponse = { schema: 1, cursor: client.cursor!, hasMore: false, changes: [{ ...(body.changes[0] as object), version: 1 } as never] };
    client.applyChanges(older);
    expect(client.deviceState(dev(1))!.connectors["1"]!.status).toBe("Charging");
  });
  it("snapshot/delta race: a change committed between the version probe and the data read is replayed harmlessly", async () => {
    const racing = deps({ repo: { ...w.repo, operational: async (id) => { const r = await w.repo.operational(id); w.status(A, dev(5), "Faulted"); return r; } } });
    const client = new SyncClient();
    client.applySnapshot((await readSnapshot(racing, "cpoA") as { kind: "snapshot"; body: SnapshotResponse }).body);
    const body = await changes(client.cursor!);
    client.applyChanges(body);
    expect(client.deviceState(dev(5))!.connectors["1"]!.status).toBe("Faulted"); // not lost
  });
  it("pages large operational bursts by sequence and converges without skipping or repeating", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    for (let n = 0; n < MAX_OPERATIONAL_PER_PAGE + 30; n++) w.status(A, `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`, "Available");
    let guard = 0;
    let more = true;
    let total = 0;
    while (more && guard++ < 10) {
      const b = (await changes(client.cursor!)) as Extract<ChangesResponse, { changes: unknown[] }>;
      total += b.changes.length;
      more = b.hasMore;
      client.applyChanges(b);
    }
    expect(total).toBe(MAX_OPERATIONAL_PER_PAGE + 30);
    expect(client.list("device_state")).toHaveLength(MAX_OPERATIONAL_PER_PAGE + 30);
    expect(guard).toBe(2);
  });
  it("a reconnect after the client was away catches up from the last valid cursor, not from scratch", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    w.status(A, dev(1), "Charging");
    w.renameCharger(A, dev(2), "Away edit");
    w.resetCalls();
    const b = await changes(client.cursor!);
    expect(w.calls.structure).toBeUndefined();
    client.applyChanges(b);
    expect(client.get<{ label: string }>("charger", dev(2))!.label).toBe("Away edit");
    expect(client.deviceState(dev(1))!.connectors["1"]!.status).toBe("Charging");
  });
});

describe("cursor expiry and reset", () => {
  it("rejects invalid, forged-scope, expired and future-dated cursors with an explicit reset, never a silent gap", async () => {
    const snap = await snapshot();
    expect(await changes("garbage!!")).toEqual({ schema: 1, resetRequired: "cursor_invalid" });
    const c = decodeCursor(snap.body.cursor)!;
    expect(await changes(encodeCursor({ ...c, scope: "deadbeef" }))).toEqual({ schema: 1, resetRequired: "scope_changed" });
    clock += CURSOR_MAX_AGE_MS + 1;
    expect(await changes(snap.body.cursor)).toEqual({ schema: 1, resetRequired: "cursor_expired" });
    clock -= CURSOR_MAX_AGE_MS + 1;
    expect(await changes(encodeCursor({ ...c, at: clock + 3_600_000 }))).toEqual({ schema: 1, resetRequired: "cursor_expired" });
  });
});

describe("access, revocation and tenant isolation", () => {
  it("authorizes every call: no access, no snapshot, no delta, no 304", async () => {
    expect(await readSnapshot(deps(), "nobody")).toEqual({ kind: "forbidden" });
    const snap = await snapshot();
    expect(await readChanges(deps(), "nobody", snap.body.cursor)).toEqual({ kind: "forbidden" });
    expect(await readSnapshot(deps(), "nobody", snap.etag)).toEqual({ kind: "forbidden" });
  });
  it("two CPOs are isolated: B's snapshot and deltas contain nothing of A, even with A's cursor forged into B's request", async () => {
    const a = await snapshot("cpoA");
    const b = await snapshot("cpoB");
    expect(JSON.stringify(b.body)).not.toContain(A);
    expect(JSON.stringify(a.body)).not.toContain(B);
    w.status(A, dev(1), "Charging");
    w.status(B, dev(1, B), "Faulted");
    // cpoB presents cpoA's cursor: different visible set => scope mismatch => reset, no data.
    expect(await changes(a.body.cursor, "cpoB")).toEqual({ schema: 1, resetRequired: "scope_changed" });
    const bd = (await changes(b.body.cursor, "cpoB")) as Extract<ChangesResponse, { changes: unknown[] }>;
    expect(bd.changes.every((c) => c.installationId === B)).toBe(true);
  });
  it("losing ONE of two installations forces a reset; the refetch contains only what is still visible and leaks no removal of the lost one", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot("both")).body);
    expect(client.list("installation")).toHaveLength(2);
    access.grants.both = [B]; // membership on A revoked
    w.status(A, dev(1), "Charging"); // a later change in the lost installation
    const body = await changes(client.cursor!, "both");
    expect(body).toEqual({ schema: 1, resetRequired: "scope_changed" });
    expect(JSON.stringify(body)).not.toContain(A);
    expect(client.applyChanges(body)).toBe("reset");
    expect(client.list("installation")).toHaveLength(0); // client evicted everything it held
    client.applySnapshot((await snapshot("both")).body);
    expect(client.list("installation").map((i) => (i as { id: string }).id)).toEqual([B]);
    expect(client.list("charger").every((c) => (c as { installationId: string }).installationId === B)).toBe(true);
    expect(client.deviceState(dev(1))).toBeNull();
  });
  it("gaining access also resets, so newly visible installations arrive by snapshot, not by delta", async () => {
    const snap = await snapshot("cpoA");
    access.grants.cpoA = [A, B];
    expect(await changes(snap.body.cursor, "cpoA")).toEqual({ schema: 1, resetRequired: "scope_changed" });
  });
  it("refuses an over-large scope instead of paying for an unbounded cursor", async () => {
    access.grants.big = Array.from({ length: 51 }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await readSnapshot(deps(), "big")).toEqual({ kind: "too_many" });
  });
});

describe("client: unsaved edits and logout", () => {
  it("never overwrites an entity being edited; the remote value is parked and applied once the edit is released", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    client.markDirty("charger", dev(1));
    w.renameCharger(A, dev(1), "Changed elsewhere");
    const r = client.applyChanges(await changes(client.cursor!)) as { merged: { key: string; status: string }[] };
    expect(r.merged.find((m) => m.key === `charger:${dev(1)}`)!.status).toBe("deferred_dirty");
    expect(client.get<{ label: string }>("charger", dev(1))!.label).toBe("Charger 1"); // the form's base is untouched
    expect(client.pendingRemote.get(`charger:${dev(1)}`)).toBeDefined();
    client.clearDirty("charger", dev(1));
    expect(client.get<{ label: string }>("charger", dev(1))!.label).toBe("Changed elsewhere");
  });
  it("a snapshot refresh keeps the dirty marker so a later delta still cannot clobber the form", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    client.markDirty("charger", dev(2));
    client.applySnapshot((await snapshot()).body);
    w.renameCharger(A, dev(2), "X");
    const r = client.applyChanges(await changes(client.cursor!)) as { merged: { status: string }[] };
    expect(r.merged.some((m) => m.status === "deferred_dirty")).toBe(true);
  });
  it("logout drops every entity, the cursor and all parked edits", async () => {
    const client = new SyncClient();
    client.applySnapshot((await snapshot()).body);
    client.markDirty("charger", dev(1));
    client.clear();
    expect(client.cursor).toBeNull();
    expect(client.list("charger")).toHaveLength(0);
    expect(client.pendingRemote.size).toBe(0);
  });
});

describe("cursor shape", () => {
  it("round-trips and carries no secrets, only versions and a scope hash", async () => {
    const snap = await snapshot();
    const c = decodeCursor(snap.body.cursor) as Cursor;
    expect(Object.keys(c).sort()).toEqual(["at", "pos", "scope", "v"]);
    expect(JSON.stringify(c)).not.toMatch(/password|verifier|token/i);
  });
});
