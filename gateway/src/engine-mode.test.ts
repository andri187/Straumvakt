import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { EngineMode, ENGINE_CTX_HEADER, METER_FLUSH_DELAY_MS, STATUS_FLUSH_DELAY_MS, FLUSH_JITTER_MS, dueAt, readTag } from "./engine-mode";

const METER_DUE = () => dueAt("meter", clock, "dev1");
import type { EngineContext } from "./connection-ownership";
import { OUTBOX_LIMITS } from "./outbox";

class FakeResponse {
  readonly ok: boolean;
  constructor(readonly body: unknown, readonly init: { status?: number; webSocket?: unknown; headers?: Record<string, string> } = {}) {
    this.ok = (init.status ?? 200) < 300;
  }
  get status() {
    return this.init.status ?? 200;
  }
  async json() {
    return JSON.parse(String(this.body));
  }
}
class FakeSocket {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private att: unknown = null;
  send(d: string) {
    this.sent.push(d);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  serializeAttachment(v: unknown) {
    this.att = structuredClone(v);
  }
  deserializeAttachment() {
    return this.att;
  }
}
let lastPair: [FakeSocket, FakeSocket] | null = null;
class FakePair {
  0 = new FakeSocket();
  1 = new FakeSocket();
  constructor() {
    lastPair = [this[0], this[1]];
  }
}
class FakeStorage {
  m = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(k: string) {
    const v = this.m.get(k);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put(k: string, v: unknown) {
    this.m.set(k, structuredClone(v));
  }
  async delete(k: string) {
    return this.m.delete(k);
  }
  async list<T>(o: { prefix: string }) {
    return new Map([...this.m.entries()].filter(([k]) => k.startsWith(o.prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, structuredClone(v)])) as Map<string, T>;
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(t: number | Date) {
    this.alarm = typeof t === "number" ? t : t.getTime();
  }
}
class FakeState {
  storage = new FakeStorage();
  sockets: FakeSocket[] = [];
  acceptWebSocket(s: FakeSocket) {
    this.sockets.push(s);
  }
  getWebSockets() {
    return this.sockets.filter((s) => !s.closed);
  }
}

const ctx = (placementId = "p1"): EngineContext => ({
  orgId: "o1", installationId: "i1", installationKey: "abcdefghijk1", chargePointId: "CP-1", identityString: "abcdefghijk1/CP-1",
  deviceId: "dev1", placementId, credentialMode: "none", credentialEpoch: "e1",
});
const negotiate = (offer: string | null) => (offer && !/ocpp1\.6/i.test(offer) ? ({ ok: false } as const) : ({ ok: true, selected: offer } as const));

let engineCalls: { body: { action: string; payload: unknown } }[];
let engineMode: "ok" | "down" | "reject";
const env = {
  ENGINE: {
    admit: async () => ({ kind: "deny" as const }),
    call: async (body: { action: string; payload: unknown }) => {
      engineCalls.push({ body });
      if (engineMode === "down") throw new Error("network");
      if (engineMode === "reject") return { kind: "rejected" as const, status: 422 };
      return { kind: "answer" as const, answer: { kind: "result" as const, payload: { idTagInfo: { status: "Accepted" } } } };
    },
  },
};

let state: FakeState;
let clock: number;
const mode = (s = state) => new EngineMode(s as unknown as DurableObjectState, env, negotiate, () => clock);
const upgradeReq = (c: EngineContext, proto?: string) =>
  ({ headers: { get: (n: string) => ({ [ENGINE_CTX_HEADER]: JSON.stringify(c), "sec-websocket-protocol": proto ?? null })[n.toLowerCase()] ?? null } }) as unknown as Request;
const call = (id: string, action: string, payload: unknown) => JSON.stringify([2, id, action, payload]);
const frames = (s: FakeSocket) => s.sent.map((x) => JSON.parse(x));

async function connect(m: EngineMode, c = ctx()) {
  const res = await m.upgrade(upgradeReq(c, "ocpp1.6"));
  expect(res.status).toBe(101);
  const server = lastPair![1];
  return { ws: server as unknown as WebSocket, sock: server, tag: readTag(server as unknown as WebSocket)! };
}

beforeEach(() => {
  vi.stubGlobal("WebSocketPair", FakePair);
  vi.stubGlobal("Response", FakeResponse);
  state = new FakeState();
  clock = 1_000_000;
  engineCalls = [];
  engineMode = "ok";
});
afterEach(() => vi.unstubAllGlobals());

describe("engine mode: ownership", () => {
  it("a new admitted connection supersedes the old: old socket closed with the superseded code, owner generation advances", async () => {
    const m = mode();
    const a = await connect(m);
    const b = await connect(m);
    expect(a.sock.closed).toEqual({ code: 4001, reason: "superseded" });
    expect(b.sock.closed).toBeNull();
    expect(b.tag.generation).toBe(2);
    expect((await state.storage.get<{ generation: number }>("engine:owner"))!.generation).toBe(2);
  });
  it("events from a stale socket are not processed, not answered and never reach the engine", async () => {
    const m = mode();
    const a = await connect(m);
    await connect(m);
    await m.message(a.ws, a.tag, call("1", "Authorize", { idTag: "X" }));
    expect(engineCalls).toHaveLength(0);
    expect(a.sock.sent).toEqual([]);
  });
  it("a socket accepted under an old placement is stale once the device is re-placed", async () => {
    const m = mode();
    const a = await connect(m, ctx("p1"));
    await connect(m, ctx("p2"));
    await m.message(a.ws, a.tag, call("1", "Authorize", { idTag: "X" }));
    expect(engineCalls).toHaveLength(0);
  });
  it("closing a stale socket does not touch device state; closing the owner does", async () => {
    const m = mode();
    const a = await connect(m);
    const b = await connect(m);
    expect(await m.closed(a.ws, a.tag)).toBe(false);
    expect(await state.storage.get("lastClosedAt")).toBeUndefined();
    state.sockets = state.sockets.filter((s) => s !== b.sock);
    expect(await m.closed(b.ws, b.tag)).toBe(true);
    expect(await state.storage.get("lastClosedAt")).toBe(clock);
  });
  it("rejects an upgrade with a bad context or an unsupported subprotocol, and claims nothing", async () => {
    const m = mode();
    expect((await m.upgrade({ headers: { get: () => null } } as unknown as Request)).status).toBe(500);
    expect((await m.upgrade(upgradeReq(ctx(), "mqtt"))).status).toBe(400);
    expect(await state.storage.get("engine:owner")).toBeUndefined();
  });
  it("survives hibernation: a fresh instance over the same storage still recognises the owner", async () => {
    const a = await connect(mode());
    const reborn = mode(); // evicted and rebuilt
    await reborn.message(a.ws, a.tag, call("1", "Authorize", { idTag: "X" }));
    expect(engineCalls).toHaveLength(1);
    expect(frames(a.sock)[0]).toEqual([3, "1", { idTagInfo: { status: "Accepted" } }]);
  });
});

describe("engine mode: lanes", () => {
  it("heartbeat is answered locally with no engine call", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, call("h", "Heartbeat", {}));
    expect(engineCalls).toHaveLength(0);
    expect(frames(a.sock)[0]![0]).toBe(3);
    expect(frames(a.sock)[0]![2].currentTime).toBe(new Date(clock).toISOString());
  });
  it("sync lane relays the engine's answer; an unreachable or rejecting engine becomes InternalError, never a decision", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, call("1", "Authorize", { idTag: "X" }));
    engineMode = "down";
    await m.message(a.ws, a.tag, call("2", "StartTransaction", { connectorId: 1, idTag: "X", meterStart: 0, timestamp: "2026-10-29T12:00:00Z" }));
    engineMode = "reject";
    await m.message(a.ws, a.tag, call("3", "Authorize", { idTag: "X" }));
    const f = frames(a.sock);
    expect(f[0]![0]).toBe(3);
    expect(f[1]).toEqual([4, "2", "InternalError", "backend unavailable; retry", {}]);
    expect(f[2]![0]).toBe(4); // a 4xx from the engine is not turned into success
  });
  it("malformed or unsupported frames get protocol errors and never reach the engine or the outbox", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, call("1", "Authorize", {}));
    await m.message(a.ws, a.tag, call("2", "Reset", { type: "Hard" }));
    await m.message(a.ws, a.tag, call("3", "MeterValues", { connectorId: 1, meterValue: [] }));
    expect(frames(a.sock).map((x) => x[2])).toEqual(["OccurenceConstraintViolation", "NotImplemented", "PropertyConstraintViolation"]);
    expect(engineCalls).toHaveLength(0);
    expect((await m.outboxForTests.stats()).live).toBe(0);
  });
});

describe("engine mode: durable async lane", () => {
  const mv = (n: number) => call(`mv${n}`, "MeterValues", { connectorId: 1, transactionId: 7, meterValue: [{ timestamp: "2026-10-29T12:10:00Z", sampledValue: [{ value: String(n) }] }] });

  it("replies at once, stores the frame, waits the stated delay, and delivers only on the alarm", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, mv(100));
    expect(frames(a.sock)[0]).toEqual([3, "mv100", {}]);
    expect(engineCalls).toHaveLength(0); // no service-binding call per meter frame
    const due0 = METER_DUE();
    expect(state.storage.alarm).toBe(due0);
    await m.drainOutbox(); // too early
    expect(engineCalls).toHaveLength(0);
    clock = dueAt("meter", 1_000_000, "dev1");
    await m.drainOutbox();
    expect(engineCalls).toHaveLength(1);
    expect((await m.outboxForTests.stats()).live).toBe(0);
    expect(state.storage.alarm! <= clock).toBe(true); // the fired alarm is not re-armed: an empty outbox schedules nothing
  });
  it("coalesces a burst into one wake-up: one alarm, N deliveries", async () => {
    const m = mode();
    const a = await connect(m);
    for (let i = 0; i < 5; i++) await m.message(a.ws, a.tag, mv(i));
    expect(state.storage.alarm).toBe(dueAt("meter", 1_000_000, "dev1"));
    clock = dueAt("meter", 1_000_000, "dev1");
    await m.drainOutbox();
    expect(engineCalls).toHaveLength(5);
  });
  it("when the engine is down both the frame and the retry survive a restart, then deliver on recovery", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, mv(1));
    engineMode = "down";
    clock = dueAt("meter", 1_000_000, "dev1");
    await m.drainOutbox();
    expect((await m.outboxForTests.stats()).live).toBe(1); // not lost
    expect(state.storage.alarm).toBe(clock + OUTBOX_LIMITS.BASE_BACKOFF_MS); // bounded backoff, not a poll
    const reborn = mode(); // hibernation / restart
    engineMode = "ok";
    clock += OUTBOX_LIMITS.BASE_BACKOFF_MS;
    await reborn.drainOutbox();
    expect((await reborn.outboxForTests.stats()).live).toBe(0);
  });
  it("a frame the engine will never accept is dead-lettered with its evidence, not retried forever or dropped", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, mv(1));
    engineMode = "reject";
    clock = dueAt("meter", 1_000_000, "dev1");
    await m.drainOutbox();
    expect(await m.outboxForTests.stats()).toMatchObject({ live: 0, dead: 1 });
  });
  it("a full outbox pushes back on the charger instead of discarding evidence", async () => {
    const m = mode();
    const a = await connect(m);
    for (let i = 0; i < OUTBOX_LIMITS.MAX_ENTRIES; i++) await m.outboxForTests.enqueue("meter", "x", clock);
    await m.message(a.ws, a.tag, mv(1));
    expect(frames(a.sock)[0]).toEqual([4, "mv1", "InternalError", "backend buffer full", {}]);
  });

  it("status frames flush within seconds while meter frames wait their longer bound; one alarm serves both", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, mv(1));
    await m.message(a.ws, a.tag, call("st1", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging" }));
    expect(state.storage.alarm).toBe(clock + STATUS_FLUSH_DELAY_MS); // earliest due wins
    clock += STATUS_FLUSH_DELAY_MS;
    await m.drainOutbox();
    expect(engineCalls.map((c) => c.body.action)).toEqual(["StatusNotification"]); // meter still waiting
    expect(state.storage.alarm).toBe(dueAt("meter", 1_000_000, "dev1")); // re-armed for the meter entry only
  });

  it("meter readings minutes apart share ONE flush per window; the next window gets its own; the wait is bounded", async () => {
    const m = mode();
    const a = await connect(m);
    const W = METER_FLUSH_DELAY_MS;
    clock = 10 * W + 1_000; // just inside a window
    for (let i = 0; i < 3; i++) { await m.message(a.ws, a.tag, mv(i)); clock += 5 * 60_000 / 3; } // three readings inside the window
    const due = dueAt("meter", 10 * W + 1_000, "dev1");
    expect(due).toBeGreaterThan(11 * W - 1);
    expect(due).toBeLessThan(11 * W + FLUSH_JITTER_MS);
    expect(state.storage.alarm).toBe(due); // ONE alarm for all three
    clock = due;
    await m.drainOutbox();
    expect(engineCalls).toHaveLength(3); // one wake-up, three deliveries
    const next = dueAt("meter", clock, "dev1");
    expect(next - due).toBeLessThanOrEqual(W); // a reading right after gets the next window, not an unbounded wait
    expect(dueAt("meter", clock, "dev1") - clock).toBeLessThanOrEqual(W + FLUSH_JITTER_MS);
  });
  it("different devices get different offsets inside the same window (no synchronised burst)", () => {
    const offsets = new Set(["dev-a", "dev-b", "dev-c", "dev-d"].map((d) => dueAt("meter", 0, d) % METER_FLUSH_DELAY_MS));
    expect(offsets.size).toBeGreaterThan(1);
  });
});

describe("engine mode: RemoteStopTransaction command", () => {
  const stopReq = (m: EngineMode, n = 42, ms = 500) => m.requestStop({ transactionNo: n }, ms);
  const sentCalls = (s: FakeSocket) => s.sent.map((x) => JSON.parse(x)).filter((f) => f[0] === 2);

  it("sends the standard call to the CURRENT socket and reports Accepted as 'accepted' (the command's outcome, not a stop)", async () => {
    const m = mode();
    const a = await connect(m);
    const p = stopReq(m);
    await Promise.resolve(); await Promise.resolve();
    const [call] = sentCalls(a.sock);
    expect(call![2]).toBe("RemoteStopTransaction");
    expect(call![3]).toEqual({ transactionId: 42 });
    await m.message(a.ws, a.tag, JSON.stringify([3, call![1], { status: "Accepted" }]));
    expect(await p).toBe("accepted");
    expect(engineCalls).toHaveLength(0); // answering a command is not an engine event
  });
  it("Rejected and CallError are 'rejected'; silence is 'timeout'", async () => {
    const m = mode();
    const a = await connect(m);
    const p1 = stopReq(m);
    await Promise.resolve(); await Promise.resolve();
    await m.message(a.ws, a.tag, JSON.stringify([3, sentCalls(a.sock)[0]![1], { status: "Rejected" }]));
    expect(await p1).toBe("rejected");
    const p2 = stopReq(m);
    await Promise.resolve(); await Promise.resolve();
    await m.message(a.ws, a.tag, JSON.stringify([4, sentCalls(a.sock)[1]![1], "NotSupported", "no", {}]));
    expect(await p2).toBe("rejected");
    expect(await stopReq(m, 7, 20)).toBe("timeout");
  });
  it("with no current socket it is 'offline' and sends nothing; a stale socket does not count", async () => {
    const m = mode();
    expect(await stopReq(m)).toBe("offline");
    const a = await connect(m);
    await connect(m); // supersedes a
    state.sockets = state.sockets.filter((s) => s !== state.sockets[1]); // the new owner goes away too
    expect(await stopReq(m)).toBe("offline");
    expect(sentCalls(a.sock)).toHaveLength(0);
  });
  it("rejects an invalid transaction number as 'unavailable' without sending", async () => {
    const m = mode();
    const a = await connect(m);
    for (const n of [0, -1, 1.5, 2_147_483_648, NaN]) expect(await stopReq(m, n)).toBe("unavailable");
    expect(sentCalls(a.sock)).toHaveLength(0);
  });
  it("a late or unknown CallResult is ignored, never mistaken for an engine frame", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, JSON.stringify([3, "no-such-id", { status: "Accepted" }]));
    expect(a.sock.sent).toEqual([]);
    expect(engineCalls).toHaveLength(0);
  });
});
