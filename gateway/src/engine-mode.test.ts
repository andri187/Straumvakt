import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { EngineMode, ENGINE_CTX_HEADER, METER_FLUSH_DELAY_MS, STATUS_FLUSH_DELAY_MS, FLUSH_JITTER_MS, dueAt, readTag, type StopCommandInput } from "./engine-mode";
import { MAX_STOP_RECORDS, type StopRecord } from "./stop-command";

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
  async transaction<T>(fn: (tx: FakeStorage) => Promise<T>) {
    const saved = structuredClone(this.m);
    try { return await fn(this); } catch (e) { this.m = saved; throw e; }
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
  orgId: "o1", installationId: "i1", chargePointId: "CP-1", identityString: "o1/CP-1",
  deviceId: "dev1", placementId, credentialMode: "none", credentialEpoch: "e1",
});
const negotiate = (offer: string | null) => (offer && !/ocpp1\.6/i.test(offer) ? ({ ok: false } as const) : ({ ok: true, selected: offer } as const));

let engineCalls: { body: { action: string; payload: unknown } }[];
let engineMode: "ok" | "down" | "reject";
let batchCalls = 0;
const env = {
  ENGINE: {
    callBatchV1: async (bodies: { messageId: string; action: string; payload: unknown }[]) => {
      batchCalls++;
      return Promise.all(bodies.map(async body => ({ messageId: body.messageId, outcome: await env.ENGINE.call(body).catch(() => ({ kind: "unavailable" as const })) })));
    },
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
  batchCalls = 0;
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
  it("coalesces a burst into one wake-up and one RPC, retaining per-entry results", async () => {
    const m = mode();
    const a = await connect(m);
    for (let i = 0; i < 5; i++) await m.message(a.ws, a.tag, mv(i));
    expect(state.storage.alarm).toBe(dueAt("meter", 1_000_000, "dev1"));
    clock = dueAt("meter", 1_000_000, "dev1");
    await m.drainOutbox();
    expect(engineCalls).toHaveLength(5);
    expect(batchCalls).toBe(1);
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
  let seq = 0;
  /** A well-formed durable attempt. Every call gets a fresh attempt id unless one is given. */
  const stopIn = (over: Partial<StopCommandInput> = {}): StopCommandInput => ({ transactionNo: 42, attemptId: `req-1:42:${++seq}`, requestId: "req-1", placementId: "p1", deadlineMs: clock + 60_000, ...over });
  const stopReq = async (m: EngineMode, n = 42, ms = 500) => (await m.requestStop(stopIn({ transactionNo: n }), ms)).outcome;
  const sentCalls = (s: FakeSocket) => s.sent.map((x) => JSON.parse(x)).filter((f) => f[0] === 2);
  const waitSent = (s: FakeSocket, n = 1) => vi.waitFor(() => expect(sentCalls(s)).toHaveLength(n));

  it("sends the standard call to the CURRENT socket and reports Accepted as 'accepted' (the command's outcome, not a stop)", async () => {
    const m = mode();
    const a = await connect(m);
    const p = stopReq(m);
    await waitSent(a.sock);
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
    await waitSent(a.sock, 1);
    await m.message(a.ws, a.tag, JSON.stringify([3, sentCalls(a.sock)[0]![1], { status: "Rejected" }]));
    expect(await p1).toBe("rejected");
    const p2 = stopReq(m);
    await waitSent(a.sock, 2);
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

  // ── durable, attempt-keyed behaviour ──────────────────────────────────────────────────────────────────────────────
  const records = () => [...state.storage.m.entries()].filter(([k]) => k.startsWith("stopcmd:")).map(([, v]) => v as StopRecord);
  const wireId = (s: FakeSocket, i = 0) => sentCalls(s)[i]![1] as string;
  const accept = (m: EngineMode, a: { ws: WebSocket; tag: ReturnType<typeof readTag> & object; sock: FakeSocket }, i = 0, status = "Accepted") =>
    m.message(a.ws, a.tag, JSON.stringify([3, wireId(a.sock, i), { status }]));

  it("persists the intent BEFORE the frame reaches the wire, and the outcome BEFORE the waiter resolves", async () => {
    const m = mode();
    const a = await connect(m);
    let atSend: StopRecord[] = [];
    const realSend = a.sock.send.bind(a.sock);
    a.sock.send = (d: string) => { atSend = records(); realSend(d); };
    const input = stopIn();
    const p = m.requestStop(input, 500);
    await waitSent(a.sock);
    expect(atSend).toHaveLength(1);
    expect(atSend[0]).toMatchObject({ attemptId: input.attemptId, requestId: "req-1", placementId: "p1", transactionNo: 42, generation: a.tag.generation, phase: "pending" });
    await accept(m, a);
    expect(await p).toEqual({ outcome: "accepted" });
    expect(records()[0]).toMatchObject({ phase: "done", outcome: "accepted", via: "response" }); // already durable when the promise resolved
  });
  it("a repeated delivery of one attempt never sends again: concurrent joins the wait, a later one gets the retained outcome", async () => {
    const m = mode();
    const a = await connect(m);
    const input = stopIn();
    const p1 = m.requestStop(input, 500);
    await waitSent(a.sock);
    const p2 = m.requestStop(input, 500); // concurrent delivery
    await accept(m, a);
    expect(await p1).toEqual({ outcome: "accepted" });
    expect(await p2).toEqual({ outcome: "accepted" });
    expect(await m.requestStop(input, 500)).toEqual({ outcome: "accepted", reason: "replayed" });
    expect(sentCalls(a.sock)).toHaveLength(1);
    expect(records()).toHaveLength(1);
  });
  it("100 redeliveries after durable admission send once and add no command writes or engine calls", async () => {
    const m = mode();
    const a = await connect(m);
    const put = vi.spyOn(state.storage, "put");
    const alarm = vi.spyOn(state.storage, "setAlarm");
    const input = stopIn();
    const first = m.requestStop(input, 500);
    await waitSent(a.sock);
    const deliveries = Array.from({ length: 100 }, () => m.requestStop(input, 500));
    await accept(m, a);
    const outcomes = await Promise.all([first, ...deliveries]);
    expect(outcomes.every((r) => r.outcome === "accepted")).toBe(true);
    expect(sentCalls(a.sock)).toHaveLength(1);
    expect(put.mock.calls.filter(([key]) => key.startsWith("stopcmd:"))).toHaveLength(2);
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(engineCalls).toHaveLength(0);
  });
  it("the same attempt id with a different body is a conflict and sends nothing", async () => {
    const m = mode();
    const a = await connect(m);
    const input = stopIn();
    const p = m.requestStop(input, 500);
    await waitSent(a.sock);
    await accept(m, a);
    await p;
    for (const alt of [{ transactionNo: 43 }, { placementId: "p9" }, { requestId: "other" }]) {
      expect(await m.requestStop({ ...input, ...alt }, 500)).toEqual({ outcome: "unavailable", reason: "conflict" });
    }
    expect(sentCalls(a.sock)).toHaveLength(1);
  });
  it("a crash after the send but before the reply: the recreated instance reports 'timeout' (uncertain), never sends again, and the alarm finalises it without any frame", async () => {
    const m = mode();
    const a = await connect(m);
    const input = stopIn();
    void m.requestStop(input, 200); // the original request dies with the instance
    await waitSent(a.sock);
    expect(state.storage.alarm).toBe(clock + 200); // armed for the expiry: no further frame is needed
    const reborn = mode();
    expect(await reborn.requestStop(input, 200)).toEqual({ outcome: "timeout", reason: "uncertain" });
    expect(records()[0]!.phase).toBe("pending"); // still undecided: a genuine late reply may yet be recorded
    clock += 200;
    await reborn.onAlarm();
    expect(records()[0]).toMatchObject({ phase: "done", outcome: "timeout", via: "deadline" });
    expect(await reborn.requestStop(input, 200)).toEqual({ outcome: "timeout", reason: "replayed" });
    expect(sentCalls(a.sock)).toHaveLength(1);
  });
  it("a crash between the intent and the send leaves a record that is never replayed", async () => {
    const m = mode();
    const a = await connect(m);
    const input = stopIn();
    const owner = await state.storage.get<{ generation: number }>("engine:owner");
    await m.stopsForTests.admit({ attemptId: input.attemptId, requestId: input.requestId, placementId: input.placementId, transactionNo: input.transactionNo, generation: owner!.generation, uniqueId: "u-lost", createdAt: clock, deadlineMs: input.deadlineMs, expiresAt: clock + 500, phase: "pending" }, clock);
    expect(await mode().requestStop(input, 500)).toEqual({ outcome: "timeout", reason: "uncertain" });
    expect(sentCalls(a.sock)).toHaveLength(0);
  });
  it("a reply carried by a REPLACEMENT socket (another generation) cannot complete the old command; it ends as 'timeout'", async () => {
    const m = mode();
    const a = await connect(m);
    const p = stopReq(m, 42, 300);
    await waitSent(a.sock);
    const oldWire = wireId(a.sock);
    const b = await connect(m); // supersedes a; same placement, higher generation
    await m.message(b.ws, b.tag, JSON.stringify([3, oldWire, { status: "Accepted" }]));
    expect(records()[0]!.phase).toBe("pending");
    expect(await p).toBe("timeout");
    expect(records()[0]).toMatchObject({ outcome: "timeout" });
    expect(sentCalls(b.sock)).toHaveLength(0); // and nothing was replayed onto the new socket
  });
  it("closing the owning socket resolves its commands as uncertain at once; closing a STALE socket touches nothing", async () => {
    const m = mode();
    const a = await connect(m);
    const b = await connect(m); // a is now stale
    const p = stopReq(m, 42, 5_000);
    await waitSent(b.sock);
    expect(await m.closed(a.ws, a.tag)).toBe(false);
    expect(records()[0]!.phase).toBe("pending");
    state.sockets = state.sockets.filter((s) => s !== b.sock);
    expect(await m.closed(b.ws, b.tag)).toBe(true);
    expect(await p).toBe("timeout");
    expect(records()[0]).toMatchObject({ phase: "done", via: "disconnected" });
  });
  it("a command reserved under one placement is never sent to a socket owned under another", async () => {
    const m = mode();
    const a = await connect(m, ctx("p2"));
    expect(await m.requestStop(stopIn({ placementId: "p1" }), 500)).toEqual({ outcome: "offline" });
    expect(sentCalls(a.sock)).toHaveLength(0);
    expect(records()).toHaveLength(0); // offline writes nothing
  });
  it("an attempt that arrives after its own deadline is refused unsent; an absurdly distant deadline is a bad request", async () => {
    const m = mode();
    const a = await connect(m);
    expect(await m.requestStop(stopIn({ deadlineMs: clock }), 500)).toEqual({ outcome: "unavailable", reason: "expired" });
    expect((await m.requestStop(stopIn({ deadlineMs: clock + 3_600_000 }), 500)).reason).toBe("bad_deadline");
    expect((await m.requestStop(stopIn({ attemptId: "no good" }), 500)).reason).toBe("bad_attempt");
    expect(sentCalls(a.sock)).toHaveLength(0);
    expect(records()).toHaveLength(0);
  });
  it("a send that throws is recorded as 'unavailable' and is not retried by a repeated delivery", async () => {
    const m = mode();
    const a = await connect(m);
    a.sock.send = () => { throw new Error("closed"); };
    const input = stopIn();
    expect(await m.requestStop(input, 500)).toEqual({ outcome: "unavailable", reason: "send_failed" });
    expect(records()[0]).toMatchObject({ phase: "done", outcome: "unavailable", via: "send_failed" });
    expect(await m.requestStop(input, 500)).toEqual({ outcome: "unavailable", reason: "replayed" });
  });
  it("is bounded: a full set of undecided attempts refuses (back-pressure), never evicts one, and never sends unrecorded", async () => {
    const m = mode();
    const a = await connect(m);
    const owner = await state.storage.get<{ generation: number }>("engine:owner");
    for (let i = 0; i < MAX_STOP_RECORDS; i++) {
      await m.stopsForTests.admit({ attemptId: `held-${i}`, requestId: "r", placementId: "p1", transactionNo: 1 + i, generation: owner!.generation, uniqueId: `u${i}`, createdAt: clock, deadlineMs: clock + 60_000, expiresAt: clock + 60_000, phase: "pending" }, clock);
    }
    expect(await m.requestStop(stopIn(), 500)).toEqual({ outcome: "unavailable", reason: "capacity" });
    expect(sentCalls(a.sock)).toHaveLength(0);
    expect(records()).toHaveLength(MAX_STOP_RECORDS);
    expect(records().every((r) => r.phase === "pending")).toBe(true);
  });
  it("resolved attempts that can no longer be replayed are purged on the next admission; nothing arms an alarm when nothing is pending", async () => {
    const m = mode();
    const a = await connect(m);
    const first = stopIn({ deadlineMs: clock + 1_000 });
    const p = m.requestStop(first, 500);
    await waitSent(a.sock);
    await accept(m, a);
    await p;
    expect(records()).toHaveLength(1);
    clock += 2 * 3_600_000; // past both the attempt deadline and the retention
    const p2 = m.requestStop(stopIn({ deadlineMs: clock + 60_000 }), 500);
    await waitSent(a.sock, 2);
    expect(records().map((r) => r.attemptId)).not.toContain(first.attemptId);
    await accept(m, a, 1);
    await p2;
    expect(await m.stopsForTests.nextExpiry()).toBeNull();
  });

  // ── one alarm, two jobs ─────────────────────────────────────────────────────────────────────────────────────────
  it("command expiry EARLIER than the outbox: the alarm moves earlier, fires the expiry, then re-arms for the outbox", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, call("st1", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging" }));
    expect(state.storage.alarm).toBe(clock + STATUS_FLUSH_DELAY_MS);
    const p = stopReq(m, 42, 500);
    await waitSent(a.sock);
    expect(state.storage.alarm).toBe(clock + 500);
    clock += 500;
    await m.onAlarm();
    expect(await p).toBe("timeout"); // the expiry was resolved by the alarm, not by a frame
    expect(engineCalls).toHaveLength(0); // the outbox entry was not yet due
    expect(state.storage.alarm).toBe(1_000_000 + STATUS_FLUSH_DELAY_MS); // still armed for the outbox
  });
  it("command expiry LATER than the outbox: the earlier outbox alarm is kept, and after it fires the expiry is re-armed", async () => {
    const m = mode();
    const a = await connect(m);
    await m.message(a.ws, a.tag, call("st1", "StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging" }));
    const p = stopReq(m, 42, 20_000);
    await waitSent(a.sock);
    expect(state.storage.alarm).toBe(1_000_000 + STATUS_FLUSH_DELAY_MS); // not pushed out by the later expiry
    clock += STATUS_FLUSH_DELAY_MS;
    await m.onAlarm();
    expect(engineCalls.map((c) => c.body.action)).toEqual(["StatusNotification"]);
    expect(state.storage.alarm).toBe(1_000_000 + 20_000);
    await accept(m, a); // settle the command and its timer
    await p;
  });
  it("with no commands or outbox work only the liveness deadline remains", async () => {
    const m = mode();
    await connect(m);
    state.storage.alarm = null;
    await m.onAlarm();
    expect(state.storage.alarm).toBe(clock + 3 * 3600_000);
  });
});

describe("independent connection liveness", () => {
  it("coalesces a burst into one latest-value publication, retries after recreation and never calls the database path", async () => {
    const published: unknown[] = [];
    let available = false;
    const realtimeEnv = { ...env, OCPP_REALTIME_ENABLED: "true", ENGINE: { ...env.ENGINE, publishLiveV1: async (v: unknown) => { published.push(v); return { ok: available }; } } };
    const realtimeMode = () => new EngineMode(state as unknown as DurableObjectState, realtimeEnv, negotiate, () => clock);
    const m = realtimeMode(); const c = await connect(m);
    for (let i = 0; i < 20; i++) await m.message(c.ws, c.tag, call(`hb${i}`, "Heartbeat", {}));
    expect(published).toHaveLength(0);
    clock += 1000; state.storage.alarm = null;
    await m.onAlarm(); expect(published).toHaveLength(1);
    expect(state.storage.alarm).toBe(clock + 30000);
    available = true; clock += 30000; state.storage.alarm = null;
    await realtimeMode().onAlarm(); expect(published).toHaveLength(2);
    expect(published[1]).toEqual(published[0]);
    expect(await state.storage.get("engine:live-projection")).toMatchObject({ due: null });
    expect(engineCalls).toHaveLength(0);
  });
  it("repair rejects wrong scope and replays only selected IDs with original evidence and audit retained", async () => {
    const m = mode(); await connect(m);
    await m.outboxForTests.enqueue("meter", "original-1", 10);
    await m.outboxForTests.enqueue("meter", "original-2", 10);
    await m.outboxForTests.settle((await m.outboxForTests.due(10)).map(entry => ({ entry, verdict: "poison" as const })), 11);
    expect(await m.repairOutbox({ op: "inspect", orgId: "other", deviceId: "dev1" })).toEqual({ error: "scope" });
    expect(await m.repairOutbox({ op: "replay", orgId: "o1", deviceId: "dev1", ids: [1], actor: "operator", requestId: "r1" })).toEqual({ replayed: 1 });
    expect(await m.repairOutbox({ op: "replay", orgId: "o1", deviceId: "dev1", ids: [1], actor: "operator", requestId: "r1" })).toEqual({ replayed: 0 });
    expect(await m.outboxForTests.stats()).toMatchObject({ live: 1, dead: 1 });
    expect((await m.outboxForTests.due(clock))[0]).toMatchObject({ body: "original-1", enqueuedAt: 10, lastReplay: { requestId: "r1", actor: "operator" } });
    expect(JSON.stringify(await m.repairOutbox({ op: "inspect", orgId: "o1", deviceId: "dev1" }))).not.toContain("original-");
  });
  it("silence becomes offline after eviction without a charger frame or engine/Neon call", async () => {
    const m = mode();
    await connect(m);
    clock += 3 * 3600_000;
    state.storage.alarm = null;
    await mode().onAlarm();
    expect(await state.storage.get("ops")).toMatchObject({ liveness: { online: false, onlineSince: clock } });
    expect(state.storage.alarm).toBeNull();
    expect(engineCalls).toHaveLength(0);
  });
  it("a heartbeat extends the deadline; the earlier wake-up cannot mark it offline", async () => {
    const m = mode();
    const c = await connect(m);
    clock += 2 * 3600_000;
    await m.message(c.ws, c.tag, call("hb", "Heartbeat", {}));
    clock += 3600_000;
    state.storage.alarm = null;
    await mode().onAlarm();
    expect(await state.storage.get("ops")).toMatchObject({ liveness: { online: true } });
    expect(state.storage.alarm).toBe(clock + 2 * 3600_000);
    expect(engineCalls).toHaveLength(0);
  });
  it("current close becomes offline immediately, stale close cannot affect its replacement", async () => {
    const m = mode();
    const old = await connect(m);
    const current = await connect(m);
    await m.closed(old.ws, old.tag);
    expect(await state.storage.get("ops")).toMatchObject({ liveness: { online: true } });
    await m.closed(current.ws, current.tag);
    expect(await state.storage.get("ops")).toMatchObject({ liveness: { online: false } });
  });
  it("all entries in an unavailable batch back off instead of leaving an immediate retry loop", async () => {
    const m = mode();
    const c = await connect(m);
    for (let i = 0; i < 20; i++) await m.message(c.ws, c.tag, call(`s${i}`, "StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" }));
    clock += STATUS_FLUSH_DELAY_MS;
    state.storage.alarm = null;
    engineMode = "down";
    await m.onAlarm();
    expect(batchCalls).toBe(1);
    expect(await m.outboxForTests.due(clock)).toHaveLength(0);
    expect(state.storage.alarm).toBe(clock + OUTBOX_LIMITS.BASE_BACKOFF_MS);
    expect(await m.outboxForTests.stats()).toMatchObject({ live: 20, dead: 0 });
  });
});
