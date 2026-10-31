import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSubscriptions, type LiveSocket } from "./live-client";
import type { LiveDevice } from "../ocpp-engine/live-projection";
const ID = "00000000-0000-4000-8000-000000000001";
const value = (revision: number): LiveDevice => ({ schema: 1, orgId: ID, installationId: ID, deviceId: ID, placementId: ID, generation: 1, revision, observedAt: 0, online: true, onlineUntil: 100000, connectors: {} });
afterEach(() => vi.useRealTimers());
describe("push adapter", () => {
  it("merges out-of-order snapshot/live messages, rejects other scopes and clears on signout", () => {
    const socket: LiveSocket = { onmessage: null, onclose: null, close: vi.fn() };
    const c = new LiveSubscriptions([ID], () => socket, vi.fn()); c.start();
    for (const v of [value(3), value(1), { ...value(5), installationId: ID.replace(/1$/, "2") }]) socket.onmessage!({ data: JSON.stringify({ type: "device", value: v }) });
    expect(c.values.get(`${ID}:${ID}`)?.revision).toBe(3);
    c.clear(); expect(c.values.size).toBe(0); expect(socket.close).toHaveBeenCalled();
  });
  it("parks on hidden/unmount and reconnects with a shared snapshot, without HTTP polling", () => {
    vi.useFakeTimers();
    const socket: LiveSocket = { onmessage: null, onclose: null, close: vi.fn() };
    const connect = vi.fn(() => socket);
    const c = new LiveSubscriptions([ID], connect, vi.fn()); c.start();
    vi.advanceTimersByTime(30 * 60_000); expect(connect).toHaveBeenCalledTimes(1);
    socket.onclose!(); vi.advanceTimersByTime(1000); expect(connect).toHaveBeenCalledTimes(2);
    c.pause(); vi.advanceTimersByTime(30 * 60_000); expect(connect).toHaveBeenCalledTimes(2);
    c.start(); expect(connect).toHaveBeenCalledTimes(3); c.clear();
  });
});
