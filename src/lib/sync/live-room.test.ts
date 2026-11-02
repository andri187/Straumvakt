import { describe, expect, it, vi } from "vitest";
import { LIVE_MAX_TOMBSTONES, LiveRoom } from "./live-room";
import type { LiveDevice } from "../ocpp-engine/live-projection";

export const ID = "00000000-0000-4000-8000-000000000001";
export const device = (revision = 1): LiveDevice => ({ schema: 1, orgId: ID, installationId: ID, deviceId: ID, placementId: ID, generation: 1, revision, observedAt: 1000, online: true, onlineUntil: 999999, connectors: { "1": { status: "Available" } } });
const memory = () => {
  const map = new Map<string, unknown>();
  return { get: async <T>(k: string) => structuredClone(map.get(k)) as T | undefined, put: vi.fn(async <T>(k: string, v: T) => { map.set(k, structuredClone(v)); }), delete: async (k: string) => map.delete(k), list: async <T>(o: { prefix: string; limit: number }) => new Map([...map].filter(([k]) => k.startsWith(o.prefix)).slice(0, o.limit)) as Map<string, T> };
};
describe("shared latest-value room", () => {
  it("survives recreation, ignores duplicate and late generations, and never regresses a snapshot", async () => {
    const storage = memory();
    const a = new LiveRoom(storage);
    await a.publish(device(10));
    storage.put.mockClear();
    expect(await a.publish(device(9))).toEqual({ ok: true, changed: false });
    expect(await a.publish(device(10))).toEqual({ ok: true, changed: false });
    expect(storage.put).not.toHaveBeenCalled();
    expect(await new LiveRoom(storage).snapshot(ID)).toEqual([device(10)]);
    await a.publish({ ...device(1), generation: 2 });
    await a.publish(device(999));
    expect((await a.snapshot(ID))[0]?.generation).toBe(2);
  });
  it("rejects cross-scope publication and extra/private fields", async () => {
    const room = new LiveRoom(memory());
    await room.publish(device());
    expect(await room.publish({ ...device(2), orgId: ID.replace(/1$/, "2") })).toEqual({ ok: false, changed: false });
    expect(await room.publish({ ...device(2), password: "never store" })).toEqual({ ok: false, changed: false });
    expect(await room.snapshot(ID.replace(/1$/, "2"))).toEqual([]);
  });
  it("100 subscribers read the same values without writes or a database dependency", async () => {
    const storage = memory(); const room = new LiveRoom(storage);
    await room.publish(device()); storage.put.mockClear();
    const views = await Promise.all(Array.from({ length: 100 }, () => room.snapshot(ID)));
    expect(views.every(v => v[0]?.revision === 1)).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe("disposal of obsolete devices", () => {
  const NOW = Date.parse("2026-11-01T12:00:00Z");
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const dev = (n: number, onlineUntil: number): LiveDevice => ({ ...device(1), deviceId: uuid(n), placementId: uuid(n), onlineUntil });
  const fill = async (room: LiveRoom, count: number, onlineUntil: number) => { for (let i = 1; i <= count; i++) expect((await room.publish(dev(i, onlineUntil))).ok).toBe(true); };

  it("a full room of long-gone devices makes space for a new one instead of refusing it forever", async () => {
    const storage = memory();
    const room = new LiveRoom(storage, () => NOW);
    await fill(room, 200, NOW - 25 * 3600_000); // removed or moved chargers: lease lapsed over a day ago
    expect(await room.publish(dev(500, NOW + 60_000))).toEqual({ ok: true, changed: true });
    const kept = (await room.snapshot(ID)).map((d) => d.deviceId);
    expect(kept).toEqual([uuid(500)]);
  });
  it("never evicts a device that is merely quiet: a full room of recent devices still refuses and keeps them all", async () => {
    const room = new LiveRoom(memory(), () => NOW);
    await fill(room, 200, NOW - 3600_000); // silent for an hour: offline, but not obsolete
    expect(await room.publish(dev(500, NOW + 60_000))).toEqual({ ok: false, changed: false });
    expect(await room.snapshot(ID)).toHaveLength(200);
  });
  it("disposes only what the new device needs the room to lose, and only when the room is full", async () => {
    const storage = memory();
    const room = new LiveRoom(storage, () => NOW);
    await fill(room, 10, NOW - 48 * 3600_000);
    storage.put.mockClear();
    await room.publish(dev(11, NOW)); // not full: nothing is deleted
    expect(await room.snapshot(ID)).toHaveLength(11);
  });
});

describe("removal and placement invalidation", () => {
  const INST = "11111111-1111-4111-8111-111111111111";
  const INST2 = "22222222-2222-4222-8222-222222222222";
  const P1 = "66666666-6666-4666-8666-666666666666";
  const P2 = "77777777-7777-4777-8777-777777777777";
  const D1 = "dddddddd-0000-4000-8000-000000000001";
  const D2 = "dddddddd-0000-4000-8000-000000000002";
  const mk = (deviceId: string, placementId: string, generation: number, revision = 1) => ({
    schema: 1 as const, orgId: "99999999-9999-4999-8999-999999999999", installationId: INST, deviceId, placementId,
    generation, revision, observedAt: 1, online: true, onlineUntil: 2, connectors: { "1": { status: "Available" } },
  });
  const room = () => {
    const store = new Map<string, unknown>();
    const storage = {
      async get<T>(k: string) { return structuredClone(store.get(k)) as T | undefined; },
      async put<T>(k: string, v: T) { store.set(k, structuredClone(v)); },
      async delete(k: string) { return store.delete(k); },
      async list<T>({ prefix, limit }: { prefix: string; limit: number }) { return new Map([...store].filter(([k]) => k.startsWith(prefix)).slice(0, limit) as [string, T][]); },
    };
    let t = 1_000_000;
    return { r: new LiveRoom(storage, () => t), store, tick: (ms: number) => { t += ms; } };
  };

  it("reconcile drops exactly the devices the structure no longer lists, and says which", async () => {
    const { r } = room();
    await r.publish(mk(D1, P1, 1)); await r.publish(mk(D2, P2, 1));
    expect(await r.reconcile(INST, [D1])).toEqual([D2]);
    expect((await r.snapshot(INST)).map((d) => d.deviceId)).toEqual([D1]);
    expect(await r.reconcile(INST, [D1])).toEqual([]); // idempotent
    expect(await r.reconcile(INST2, [])).toEqual([]); // another installation's reconcile touches nothing here
    expect((await r.snapshot(INST)).map((d) => d.deviceId)).toEqual([D1]);
  });

  it("a removed placement's still-open socket cannot bring the device back, but a NEW placement is accepted", async () => {
    const { r } = room();
    await r.publish(mk(D1, P1, 1));
    expect(await r.remove(INST, D1)).toBe(true);
    expect(await r.snapshot(INST)).toEqual([]);
    // The old socket keeps publishing under the removed placement (higher revision, same generation): obsolete, not retried.
    expect(await r.publish(mk(D1, P1, 1, 50))).toEqual({ ok: true, changed: false, removed: true });
    expect(await r.snapshot(INST)).toEqual([]);
    // The device returns under a new placement and a new connection generation.
    expect(await r.publish(mk(D1, P2, 2))).toEqual({ ok: true, changed: true });
    expect((await r.snapshot(INST)).map((d) => d.placementId)).toEqual([P2]);
    // The tombstone is cleared: nothing stale remains to block that placement later.
    expect(await r.publish(mk(D1, P2, 2, 5))).toEqual({ ok: true, changed: true });
  });

  it("a placement that closed before the room ever held the device is still refused (the caller names the placement)", async () => {
    const { r } = room();
    await r.publish(mk(D2, P2, 1)); // establishes the room
    await r.remove(INST, D1, P1);
    expect(await r.publish(mk(D1, P1, 1))).toMatchObject({ ok: true, changed: false, removed: true });
  });

  it("tombstones are bounded: the oldest are evicted beyond the cap", async () => {
    const { r, store, tick } = room();
    await r.publish(mk(D2, P2, 1));
    for (let i = 0; i < LIVE_MAX_TOMBSTONES + 20; i++) { tick(1000); await r.remove(INST, `dddddddd-1111-4000-8000-${String(i).padStart(12, "0")}`, P1); }
    expect([...store.keys()].filter((k) => k.startsWith("live-tomb:")).length).toBeLessThanOrEqual(LIVE_MAX_TOMBSTONES);
    expect(store.has(`live-tomb:dddddddd-1111-4000-8000-${String(LIVE_MAX_TOMBSTONES + 19).padStart(12, "0")}`)).toBe(true); // newest kept
    expect(store.has("live-tomb:dddddddd-1111-4000-8000-000000000000")).toBe(false); // oldest gone
  });
});
