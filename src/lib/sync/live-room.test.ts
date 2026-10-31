import { describe, expect, it, vi } from "vitest";
import { LiveRoom } from "./live-room";
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
