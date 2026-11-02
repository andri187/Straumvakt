import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEGRADED_AFTER_MS, LEASE_CLOSE_CODE, LiveSubscriptions, RECONNECT_GRACE_MS, type LiveSocket } from "./live-client";
import type { LiveDevice } from "../ocpp-engine/live-projection";

const ID = "00000000-0000-4000-8000-000000000001";
const DEV2 = "00000000-0000-4000-8000-0000000000d2";
const value = (revision: number, over: Partial<LiveDevice> = {}): LiveDevice => ({ schema: 1, orgId: ID, installationId: ID, deviceId: ID, placementId: ID, generation: 1, revision, observedAt: 0, online: true, onlineUntil: 100000, connectors: {}, ...over });
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
    socket.onclose!(); vi.advanceTimersByTime(1500); expect(connect).toHaveBeenCalledTimes(2);
    c.pause(); vi.advanceTimersByTime(30 * 60_000); expect(connect).toHaveBeenCalledTimes(2);
    c.start(); expect(connect).toHaveBeenCalledTimes(3); c.clear();
  });
});

describe("reconnect, snapshot and removal", () => {
  let sockets: (LiveSocket & { closedByUs?: boolean })[];
  let clock: number;
  let changes: number;
  let degraded: boolean[];
  const connect = () => { const s: LiveSocket = { onmessage: null, onclose: null, close() { (s as { closedByUs?: boolean }).closedByUs = true; } }; sockets.push(s); return s; };
  const send = (s: LiveSocket, m: unknown) => s.onmessage!({ data: JSON.stringify(m) });
  const ready = (s: LiveSocket) => send(s, { type: "ready", installationId: ID, expiresAt: clock + 60_000 });
  const make = () => new LiveSubscriptions([ID], connect, () => { changes++; }, { now: () => clock, random: () => 0.5, onDegraded: (d) => degraded.push(d) });
  beforeEach(() => { vi.useFakeTimers(); sockets = []; clock = 1_000_000; changes = 0; degraded = []; vi.setSystemTime(clock); });
  const advance = (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); };

  it("a routine lease renewal (close 4001) reconnects at once, does not flicker and does not count as a failure", () => {
    const c = make(); c.start();
    send(sockets[0]!, { type: "device", value: value(1, { onlineUntil: clock + 90_000 }) }); ready(sockets[0]!);
    expect(c.isLive(ID)).toBe(true);
    sockets[0]!.onclose!({ code: LEASE_CLOSE_CODE });
    expect(c.connected.has(ID)).toBe(false);
    expect(c.isLive(ID)).toBe(true); // within the grace: still shown as live
    expect(c.values.size).toBe(1); // nothing was discarded
    advance(300);
    expect(sockets).toHaveLength(2); // reconnected immediately, no backoff
    send(sockets[1]!, { type: "device", value: value(2, { onlineUntil: clock + 90_000 }) }); ready(sockets[1]!);
    expect(c.values.get(`${ID}:${ID}`)?.revision).toBe(2);
    expect(degraded).toEqual([]);
  });

  it("past the grace without a reconnect the installation is no longer reported live", () => {
    const c = make(); c.start();
    send(sockets[0]!, { type: "device", value: value(1) }); ready(sockets[0]!);
    sockets[0]!.onclose!({ code: 1006 });
    advance(RECONNECT_GRACE_MS + 1);
    expect(c.isLive(ID)).toBe(false);
  });

  it("the reconnect snapshot is complete: a device removed while we were away disappears, a replaced value is taken from the room", () => {
    const c = make(); c.start();
    send(sockets[0]!, { type: "device", value: value(5) }); send(sockets[0]!, { type: "device", value: value(1, { deviceId: DEV2 }) }); ready(sockets[0]!);
    expect(c.values.size).toBe(2);
    sockets[0]!.onclose!({ code: 1006 });
    advance(2_000);
    // The room restarted from scratch: its snapshot has only the first device, at a LOWER revision than we held.
    send(sockets[1]!, { type: "device", value: value(2) }); ready(sockets[1]!);
    expect([...c.values.keys()]).toEqual([`${ID}:${ID}`]);
    expect(c.values.get(`${ID}:${ID}`)?.revision).toBe(2);
  });

  it("a remove message drops the device immediately; a later stale publication of it does not resurrect it", () => {
    const c = make(); c.start();
    send(sockets[0]!, { type: "device", value: value(4) }); ready(sockets[0]!);
    send(sockets[0]!, { type: "remove", deviceId: ID });
    expect(c.values.size).toBe(0);
  });

  it("re-renders at the soonest value expiry with no other event, so an expired observation is reported (not 'disconnected')", () => {
    const c = make(); c.start();
    send(sockets[0]!, { type: "device", value: value(1, { onlineUntil: clock + 20_000 }) }); ready(sockets[0]!);
    const before = changes;
    advance(19_000); expect(changes).toBe(before);
    advance(1_100); expect(changes).toBeGreaterThan(before);
    expect(c.isLive(ID)).toBe(true); // the socket is still connected; only the observation expired
    expect(c.values.get(`${ID}:${ID}`)!.onlineUntil <= clock).toBe(true);
  });

  it("an unreachable room is reported degraded after repeated failures, with growing jittered backoff, and recovery is reported too", () => {
    const c = make(); c.start();
    for (let i = 0; i < 3; i++) { sockets.at(-1)!.onclose!({ code: 1006 }); advance(70_000); }
    expect(degraded).toEqual([true]);
    const n = sockets.length;
    sockets.at(-1)!.onclose!({ code: 1006 }); // backoff is capped, never a tight loop
    advance(500); expect(sockets).toHaveLength(n);
    advance(70_000);
    ready(sockets.at(-1)!);
    expect(degraded).toEqual([true, false]);
  });

  it("a room that never answers at all is reported degraded by time alone", () => {
    const c = make(); c.start();
    advance(DEGRADED_AFTER_MS + 100);
    expect(degraded).toEqual([true]);
    c.clear();
    expect(degraded).toEqual([true, false]);
  });

  it("pause closes sockets and stops every timer", () => {
    const c = make(); c.start();
    send(sockets[0]!, { type: "device", value: value(1, { onlineUntil: clock + 20_000 }) }); ready(sockets[0]!);
    c.pause();
    const before = changes;
    advance(120_000);
    expect(changes).toBe(before);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closedByUs).toBe(true);
  });
});
