// Pending mode: the restricted waiting socket for an unregistered charger.
// LOCAL FIXTURES ONLY. Fake sockets, fake storage and a fake engine binding; nothing here is evidence from a real charger.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { PENDING_ATTEMPT_HEADER, PENDING_CTX_HEADER, PendingMode, parsePendingContext, readPendingTag, type PendingContext, type PendingLease } from "./pending-mode";
import { PendingGate } from "./pending-gate";
import type { PendingAnswer, PendingCall } from "./engine-client";
import {
  MAX_PENDING_FRAME_BYTES, PENDING_CAPTURE_MIN_INTERVAL_MS, PENDING_FIRST_BOOT_DEADLINE_MS, PENDING_MESSAGES_PER_WINDOW, PENDING_MESSAGE_WINDOW_MS,
  PENDING_LEASE_MS, PENDING_RECHECK_SECONDS,
} from "@engine/pending";

class FakeResponse {
  constructor(readonly body: unknown, readonly init: { status?: number; webSocket?: unknown; headers?: Record<string, string> } = {}) {}
  get status() {
    return this.init.status ?? 200;
  }
}
/** readyState: 1 OPEN, 2 CLOSING (the platform still lists it), 3 CLOSED. */
class FakeSocket {
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  readyState = 1;
  private att: unknown = null;
  send(d: string) {
    this.sent.push(d);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = 2;
  }
  finishClose() {
    this.readyState = 3;
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
  puts = 0;
  gets = 0;
  deletes = 0;
  async delete(k: string) {
    this.deletes++;
    return this.m.delete(k);
  }
  async get<T>(k: string) {
    this.gets++;
    const v = this.m.get(k);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put(k: string, v: unknown) {
    this.puts++;
    this.m.set(k, structuredClone(v));
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
  /** Like the platform: a socket that is CLOSING is still listed; only a CLOSED one is gone. */
  getWebSockets() {
    return this.sockets.filter((s) => s.readyState < 3);
  }
}

const CTX: PendingContext = { orgId: "11111111-1111-4111-8111-111111111111", routingId: "test-cpo", chargePointId: "ZPR074002" };
const negotiate = (offer: string | null) => (offer && !/ocpp1\.6/i.test(offer) ? ({ ok: false } as const) : ({ ok: true, selected: offer } as const));
const BOOT = { chargePointVendor: "Zaptec", chargePointModel: "Go", chargePointSerialNumber: "ZPR074002", firmwareVersion: "4.1.0", iccid: "8935800000000000000", imsi: "274020000000000" };
const SIX_HOURS = PENDING_RECHECK_SECONDS * 1000;

let engineCalls: PendingCall[];
let engineAnswer: (c: PendingCall) => PendingAnswer | Promise<PendingAnswer>;
const env = { ENGINE: { admit: async () => ({ kind: "deny" as const }), call: async () => ({ kind: "unavailable" as const }), pending: async (c: PendingCall) => { engineCalls.push(c); return engineAnswer(c); } } };
let leaseCalls: string[];
/** The same calls with the owner token and the `create` flag, for the ownership cases. */
let leaseDetail: { op: "renew" | "release"; owner: string; create?: boolean }[];
/** What the gate answers a renewal with (`create` is the flag the caller sent): held (default), refused, unreachable, or a promise the test settles. */
let renewAnswer: (create: boolean) => boolean | Promise<boolean>;
const lease: PendingLease = {
  renew: async (c, owner, create) => {
    leaseCalls.push(`renew:${c.chargePointId}`);
    leaseDetail.push({ op: "renew", owner, create });
    return renewAnswer(create);
  },
  release: async (c, owner) => {
    leaseCalls.push(`release:${c.chargePointId}`);
    leaseDetail.push({ op: "release", owner });
  },
};

let state: FakeState;
let clock: number;
const mode = (s = state) => new PendingMode(s as unknown as DurableObjectState, env, negotiate, () => clock, lease);
const upgradeReq = (c: PendingContext = CTX, proto?: string, attempt?: string) =>
  ({
    headers: {
      get: (n: string) => ({ [PENDING_CTX_HEADER]: JSON.stringify(c), "sec-websocket-protocol": proto ?? null, [PENDING_ATTEMPT_HEADER]: attempt ?? null })[n.toLowerCase()] ?? null,
    },
  }) as unknown as Request;
const call = (id: string, action: string, payload: unknown) => JSON.stringify([2, id, action, payload]);
const frames = (s: FakeSocket) => s.sent.map((x) => JSON.parse(x));

type Conn = { ws: WebSocket; sock: FakeSocket };
async function connect(m: PendingMode, c = CTX, attempt?: string): Promise<Conn> {
  const res = await m.upgrade(upgradeReq(c, "ocpp1.6", attempt));
  expect(res.status).toBe(101);
  const server = lastPair![1];
  return { ws: server as unknown as WebSocket, sock: server };
}
/** Delivers a message the way the Durable Object does: the tag is read fresh from the socket attachment every time. */
const send = (m: PendingMode, c: Conn, data: string | ArrayBuffer) => m.message(c.ws, readPendingTag(c.ws)!, data);
const tagOf = (c: Conn) => readPendingTag(c.ws)!;

beforeEach(() => {
  vi.stubGlobal("WebSocketPair", FakePair);
  vi.stubGlobal("Response", FakeResponse);
  state = new FakeState();
  clock = 1_000_000;
  engineCalls = [];
  leaseCalls = [];
  leaseDetail = [];
  renewAnswer = () => true;
  engineAnswer = (c) => (c.op === "boot" ? { kind: "captured", result: "stored" } : c.op === "check" ? { kind: "state", state: "unregistered", hasCapture: true } : { kind: "ok" });
});
afterEach(() => vi.unstubAllGlobals());

describe("pending mode: connect", () => {
  it("accepts a well-formed pending context, arms ONE first-boot deadline alarm and carries no device or placement context", async () => {
    const m = mode();
    const a = await connect(m);
    expect(tagOf(a)).toEqual({ pending: true, generation: 1 });
    expect(state.storage.alarm).toBe(clock + PENDING_FIRST_BOOT_DEADLINE_MS);
    expect([...state.storage.m.keys()].sort()).toEqual(["pending:ctx", "pending:deadline", "pending:gen"]);
  });
  it("rejects a missing or malformed context and a bad subprotocol", async () => {
    const m = mode();
    expect((await m.upgrade({ headers: { get: () => null } } as unknown as Request)).status).toBe(500);
    expect(parsePendingContext(JSON.stringify({ ...CTX, orgId: "not-a-uuid" }))).toBeNull();
    expect(parsePendingContext(JSON.stringify({ ...CTX, chargePointId: "../x" }))).toBeNull();
    expect((await m.upgrade(upgradeReq(CTX, "mqtt"))).status).toBe(400);
  });
  it("a reconnect replaces the older socket (closed 4001) and the older socket's later frames are ignored", async () => {
    const m = mode();
    const a = await connect(m);
    const b = await connect(m);
    expect(a.sock.closed).toEqual({ code: 4001, reason: "superseded" });
    expect(tagOf(b).generation).toBe(2);
    a.sock.finishClose();
    await m.message(a.ws, { pending: true, generation: 1 }, call("1", "BootNotification", BOOT));
    expect(engineCalls).toHaveLength(0);
    expect(a.sock.sent).toHaveLength(0);
  });
});

describe("pending mode: BootNotification", () => {
  it("answers Pending with the server time and a nonzero retry interval, correlated to the request id", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("boot-1", "BootNotification", BOOT));
    const [f] = frames(a.sock);
    expect(f[0]).toBe(3);
    expect(f[1]).toBe("boot-1");
    expect(f[2].status).toBe("Pending");
    expect(f[2].interval).toBe(1800);
    expect(f[2].interval).toBeGreaterThan(0);
    expect(f[2].currentTime).toBe(new Date(clock).toISOString());
  });
  it("hands the COMPLETE payload to the engine once, including optional ICCID/IMSI and the exact byte size", async () => {
    const m = mode();
    const a = await connect(m);
    const raw = call("b1", "BootNotification", BOOT);
    await send(m, a, raw);
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0]).toMatchObject({ op: "boot", routingId: "test-cpo", chargePointId: "ZPR074002", messageId: "b1", frameBytes: new TextEncoder().encode(raw).length, payload: BOOT });
  });
  it("keeps vendor extensions for inspection even though the schema refuses them, and still refuses the boot on the wire", async () => {
    const m = mode();
    const a = await connect(m);
    const withExtension = { ...BOOT, vendorExtra: { nested: [1, 2, 3] } };
    await send(m, a, call("b1", "BootNotification", withExtension));
    expect(engineCalls[0]!.payload).toEqual(withExtension); // captured before any stripping
    const [f] = frames(a.sock);
    expect(f[0]).toBe(4);
    expect(f[2]).toBe("FormationViolation");
  });
  it("an identical repeat (any key order) is answered Pending with NO engine call; every reply stays correlated", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    clock += 60_000;
    await send(m, a, call("b2", "BootNotification", { ...BOOT }));
    await send(m, a, call("b3", "BootNotification", Object.fromEntries(Object.entries(BOOT).reverse())));
    expect(engineCalls).toHaveLength(1);
    expect(frames(a.sock).map((f) => [f[1], f[2].status])).toEqual([["b1", "Pending"], ["b2", "Pending"], ["b3", "Pending"]]);
  });
  it("durable writes: the first boot's state once, none for further identical boots", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    const after = state.storage.puts;
    for (let i = 0; i < 5; i++) await send(m, a, call(`r${i}`, "BootNotification", BOOT));
    expect(state.storage.puts).toBe(after);
    expect(engineCalls).toHaveLength(1);
  });
  it("the per-CPO identity cap answers Rejected and closes; the socket does not linger", async () => {
    engineAnswer = () => ({ kind: "captured", result: "full" });
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    expect(frames(a.sock)[0][2].status).toBe("Rejected");
    expect(a.sock.closed?.code).toBe(1008);
  });
  it("a known (retired/ambiguous) or inactive identity is Rejected and closed, never kept waiting", async () => {
    engineAnswer = () => ({ kind: "state", state: "known" });
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    expect(frames(a.sock)[0][2]).toMatchObject({ status: "Rejected", interval: 1800 });
    expect(a.sock.closed?.code).toBe(1008);
  });
});

describe("pending mode: the capture budget bounds engine work independently of the payload hash", () => {
  it("REVIEW CASE: nine changing boots inside the interval cause ONE engine capture; replies stay correct and nothing is stored from the held-back ones", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    for (let i = 0; i < 8; i++) await send(m, a, call(`b${i}`, "BootNotification", { ...BOOT, extension: i }));
    expect(engineCalls.filter((c) => c.op === "boot")).toHaveLength(1);
    const replies = frames(a.sock);
    expect(replies).toHaveLength(9);
    expect(replies[0][2].status).toBe("Pending");
    expect(replies.slice(1).every((f) => f[0] === 4 && f[2] === "FormationViolation")).toBe(true); // refused as invalid, still correlated
    expect(replies.map((f) => f[1])).toEqual(["first", ...Array.from({ length: 8 }, (_, i) => `b${i}`)]);
  });
  it("a changed body is stored once the interval has passed (explicit policy: at most one capture per PENDING_CAPTURE_MIN_INTERVAL_MS)", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS - 1;
    await send(m, a, call("b2", "BootNotification", { ...BOOT, firmwareVersion: "4.2.0" }));
    expect(engineCalls).toHaveLength(1);
    clock += 1;
    await send(m, a, call("b3", "BootNotification", { ...BOOT, firmwareVersion: "4.2.0" }));
    expect(engineCalls.map((c) => c.op)).toEqual(["boot", "boot"]);
    expect((engineCalls[1]!.payload as { firmwareVersion: string }).firmwareVersion).toBe("4.2.0");
  });
  it("engine unavailable: the attempt still spends the budget, so a failing database is not hammered; the same body is retried after the interval", async () => {
    engineAnswer = () => ({ kind: "unavailable" });
    const m = mode();
    const a = await connect(m);
    for (let i = 0; i < 6; i++) await send(m, a, call(`b${i}`, "BootNotification", BOOT));
    expect(engineCalls).toHaveLength(1);
    expect(frames(a.sock).every((f) => f[2].status === "Pending")).toBe(true);
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
    await send(m, a, call("later", "BootNotification", BOOT));
    expect(engineCalls).toHaveLength(2);
  });
  it("REVIEW CASE (reconnects): a reconnect storm with changing bodies makes one capture per interval, not one per reconnect", async () => {
    const m = mode();
    for (let i = 0; i < 12; i++) {
      const c = await connect(m);
      await send(m, c, call(`r${i}`, "BootNotification", { ...BOOT, extension: i }));
      clock += 30_000;
    }
    expect(engineCalls).toHaveLength(Math.ceil((12 * 30_000) / PENDING_CAPTURE_MIN_INTERVAL_MS)); // 6 min of storm = 1
  });
  it("the budget survives hibernation: a fresh instance over the same storage still holds a changed body back", async () => {
    const first = mode();
    const a = await connect(first);
    await send(first, a, call("b1", "BootNotification", BOOT));
    const restored = mode();
    await send(restored, a, call("b2", "BootNotification", { ...BOOT, firmwareVersion: "9" }));
    expect(engineCalls).toHaveLength(1);
  });
  it("a re-check that reports the capture gone lets the next boot store it again (still under the budget)", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    engineAnswer = (c) => (c.op === "check" ? { kind: "state", state: "unregistered", hasCapture: false } : { kind: "captured", result: "stored" });
    clock += SIX_HOURS + 1;
    await send(m, a, call("b2", "BootNotification", BOOT)); // re-check: capture is gone
    await send(m, a, call("b3", "BootNotification", BOOT)); // restored
    expect(engineCalls.map((c) => c.op)).toEqual(["boot", "check", "boot"]);
  });
});

describe("pending mode: restricted actions", () => {
  it.each(["Authorize", "StartTransaction", "StopTransaction", "MeterValues", "StatusNotification", "DataTransfer"])("%s is refused with SecurityError and reaches nothing", async (action) => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("x1", action, { idTag: "X" }));
    expect(frames(a.sock)[0].slice(0, 3)).toEqual([4, "x1", "SecurityError"]);
    expect(engineCalls).toHaveLength(0);
  });
  it("Heartbeat is answered locally with the server time", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("h1", "Heartbeat", {}));
    expect(frames(a.sock)[0]).toEqual([3, "h1", { currentTime: new Date(clock).toISOString() }]);
    expect(engineCalls).toHaveLength(0);
  });
  it("never sends a request or an unsolicited frame: a CallResult/CallError from the charger is ignored silently", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, JSON.stringify([3, "z", {}]));
    await send(m, a, JSON.stringify([4, "z", "GenericError", "x", {}]));
    expect(a.sock.sent).toHaveLength(0);
  });
});

describe("pending mode: abusive input is bounded", () => {
  it("binary frames get a ProtocolError and create no record", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, new ArrayBuffer(8));
    expect(frames(a.sock)[0][2]).toBe("ProtocolError");
    expect(engineCalls).toHaveLength(0);
  });
  it("an oversized frame (by bytes, not characters) closes the socket with 1009 before parsing", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, "x".repeat(MAX_PENDING_FRAME_BYTES + 1));
    expect(a.sock.closed?.code).toBe(1009);
    const b = await connect(m);
    // 3000 three-byte characters are fewer than 8192 characters but more than 8192 bytes.
    await send(m, b, JSON.stringify([2, "m", "BootNotification", { chargePointVendor: "€".repeat(3000) }]));
    expect(b.sock.closed?.code).toBe(1009);
    expect(engineCalls).toHaveLength(0);
  });
  it("malformed JSON and overlong ids get FormationViolation, not a record", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, "{not json");
    await send(m, a, call("i".repeat(37), "BootNotification", BOOT));
    expect(frames(a.sock).map((f) => f[2])).toEqual(["FormationViolation", "FormationViolation"]);
    expect(engineCalls).toHaveLength(0);
  });
  it("the message window is per socket, counted in the socket attachment and therefore survives hibernation; it resets after the window", async () => {
    const m = mode();
    const a = await connect(m);
    for (let i = 0; i < PENDING_MESSAGES_PER_WINDOW - 4; i++) await send(m, a, call(`h${i}`, "Heartbeat", {}));
    const restored = mode(); // evicted and woken: no in-memory count survives, the attachment does
    for (let i = 0; i < 4; i++) await send(restored, a, call(`g${i}`, "Heartbeat", {}));
    expect(a.sock.closed).toBeNull();
    expect(tagOf(a).n).toBe(PENDING_MESSAGES_PER_WINDOW);
    await send(restored, a, call("over", "Heartbeat", {}));
    expect(a.sock.closed?.code).toBe(1008);
    const b = await connect(m);
    for (let i = 0; i < PENDING_MESSAGES_PER_WINDOW; i++) await send(m, b, call(`k${i}`, "Heartbeat", {}));
    clock += PENDING_MESSAGE_WINDOW_MS;
    await send(m, b, call("fresh", "Heartbeat", {}));
    expect(b.sock.closed).toBeNull();
  });
  it("a closing socket gets no work and is not counted as present", async () => {
    const m = mode();
    const a = await connect(m);
    a.sock.close(1001, "going away"); // CLOSING: the platform still lists it
    expect(state.getWebSockets()).toContain(a.sock);
    expect(await m.presence()).toEqual({ connected: false });
    await send(m, a, call("late", "BootNotification", BOOT));
    expect(engineCalls).toHaveLength(0);
    expect(a.sock.sent).toHaveLength(0);
    expect(await m.promote()).toBe("not_connected");
  });
});

describe("pending mode: first-boot deadline is per generation", () => {
  it("REVIEW CASE: a replacement gets its own FULL deadline; the previous socket's alarm cannot close it early", async () => {
    const m = mode();
    await connect(m);
    const t0 = clock;
    clock = t0 + PENDING_FIRST_BOOT_DEADLINE_MS - 1000;
    const replacement = await connect(m);
    expect(state.storage.alarm).toBe(clock + PENDING_FIRST_BOOT_DEADLINE_MS); // the one alarm is the CURRENT deadline
    const realDeadline = clock + PENDING_FIRST_BOOT_DEADLINE_MS;
    clock = t0 + PENDING_FIRST_BOOT_DEADLINE_MS;
    await m.alarm(); // a stale or early alarm
    expect(replacement.sock.closed).toBeNull();
    expect(state.storage.alarm).toBe(realDeadline); // re-armed for the real deadline
    clock = realDeadline;
    await m.alarm();
    expect(replacement.sock.closed?.reason).toBe("no BootNotification");
  });
  it("a socket that never boots is closed at its deadline and gives its admission slot back; one that booted is left alone", async () => {
    const m = mode();
    const silent = await connect(m);
    clock += PENDING_FIRST_BOOT_DEADLINE_MS;
    await m.alarm();
    expect(silent.sock.closed?.reason).toBe("no BootNotification");
    expect(leaseCalls).toEqual(["release:ZPR074002"]);
    const booted = await connect(m);
    await send(m, booted, call("b", "BootNotification", BOOT));
    clock += PENDING_FIRST_BOOT_DEADLINE_MS;
    await m.alarm();
    expect(booted.sock.closed).toBeNull();
  });
  it("replacement after the old socket DID boot: the new socket still needs its own boot, and the deadline survives eviction", async () => {
    const first = mode();
    const a = await connect(first);
    await send(first, a, call("b", "BootNotification", BOOT));
    const restored = mode(); // evicted between the two connections
    const b = await connect(restored);
    clock += PENDING_FIRST_BOOT_DEADLINE_MS;
    await mode().alarm(); // yet another fresh instance fires the alarm
    expect(b.sock.closed?.reason).toBe("no BootNotification");
  });
});

describe("pending mode: stale asynchronous work", () => {
  it("REVIEW CASE: a replacement during an awaited engine call: the stale reply mutates nothing, sends nothing and closes nothing", async () => {
    let release!: (a: PendingAnswer) => void;
    engineAnswer = () => new Promise<PendingAnswer>((r) => { release = r; });
    const m = mode();
    const a = await connect(m);
    const pendingBoot = send(m, a, call("b1", "BootNotification", BOOT));
    await vi.waitFor(() => expect(engineCalls).toHaveLength(1));
    const b = await connect(m); // replaces A while the engine is still thinking
    expect(a.sock.closed?.code).toBe(4001);
    const putsBefore = state.storage.puts;
    release({ kind: "state", state: "registered" }); // would close every socket, including B, if it were applied
    await pendingBoot;
    expect(b.sock.closed).toBeNull();
    expect(a.sock.sent).toHaveLength(0);
    expect(state.storage.puts).toBe(putsBefore);
    expect(state.storage.m.get("pending:hash")).toBeUndefined();
  });
  it("a socket that closes during the engine call gets no reply and no state change", async () => {
    let release!: (a: PendingAnswer) => void;
    engineAnswer = () => new Promise<PendingAnswer>((r) => { release = r; });
    const m = mode();
    const a = await connect(m);
    const p = send(m, a, call("b1", "BootNotification", BOOT));
    await vi.waitFor(() => expect(engineCalls).toHaveLength(1));
    a.sock.close(1006, "gone");
    release({ kind: "captured", result: "stored" });
    await p;
    expect(a.sock.sent).toHaveLength(0);
    expect(state.storage.m.get("pending:hash")).toBeUndefined();
  });
  it("promote() replaced while it asks: the newer connection is not closed", async () => {
    let release!: (a: PendingAnswer) => void;
    engineAnswer = () => new Promise<PendingAnswer>((r) => { release = r; });
    const m = mode();
    await connect(m);
    const p = m.promote();
    await vi.waitFor(() => expect(engineCalls).toHaveLength(1));
    const b = await connect(m);
    release({ kind: "state", state: "registered" });
    expect(await p).toBe("not_connected");
    expect(b.sock.closed).toBeNull();
  });
});

describe("pending mode: registration re-check cooldown and admission lease renewal", () => {
  const renews = () => leaseCalls.filter((l) => l.startsWith("renew"));
  it("REVIEW CASE: a normal six-hour re-check renews the admission lease, so a waiting charger keeps its slot beyond the lease period", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    leaseCalls = [];
    clock += SIX_HOURS + 1;
    await send(m, a, call("next", "BootNotification", BOOT));
    expect(engineCalls.at(-1)?.op).toBe("check");
    expect(renews()).toEqual(["renew:ZPR074002"]);
    // Keep going for more than one lease period (7 h) with the charger booting every 30 min: renewed once per 6 h, no more.
    leaseCalls = [];
    for (let i = 0; i < 40; i++) {
      clock += 1800 * 1000;
      await send(m, a, call(`k${i}`, "BootNotification", BOOT));
    }
    expect(renews()).toHaveLength(Math.floor((40 * 1800) / PENDING_RECHECK_SECONDS));
    expect(a.sock.closed).toBeNull();
  });
  it("a boot inside the re-check period does not touch the gate", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    leaseCalls = [];
    clock += SIX_HOURS - 60_000;
    await send(m, a, call("again", "BootNotification", BOOT));
    expect(leaseCalls).toEqual([]);
  });
  it("REVIEW CASE: a failed re-check is charged before the engine is asked, so repeated unchanged boots (and fresh instances) cause ONE call", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    clock += SIX_HOURS + 1;
    engineCalls = [];
    engineAnswer = () => ({ kind: "unavailable" });
    for (let i = 0; i < 9; i++) await send(mode(), a, call(`retry-${i}`, "BootNotification", BOOT)); // a new instance each time: hibernation
    expect(engineCalls.filter((c) => c.op === "check")).toHaveLength(1);
    // Every reply stayed correct.
    expect(frames(a.sock).slice(1).every((f) => f[0] === 3 && f[2].status === "Pending")).toBe(true);
    // After the cooldown the next boot asks again, and a healthy answer moves the re-check out to the full period.
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
    engineAnswer = () => ({ kind: "state", state: "unregistered", hasCapture: true });
    await send(mode(), a, call("recovered", "BootNotification", BOOT));
    expect(engineCalls.filter((c) => c.op === "check")).toHaveLength(2);
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
    await send(mode(), a, call("quiet", "BootNotification", BOOT));
    expect(engineCalls.filter((c) => c.op === "check")).toHaveLength(2);
  });
  it("a failed re-check does not starve lease renewal: the lease is renewed on the same boot", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    leaseCalls = [];
    clock += SIX_HOURS + 1;
    engineAnswer = () => ({ kind: "unavailable" });
    await send(m, a, call("next", "BootNotification", BOOT));
    expect(renews()).toHaveLength(1);
  });
  it("a refused renewal (the CPO is at its cap and this identity lost its slot) is answered Rejected and the socket is closed", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    clock += SIX_HOURS + 1;
    renewAnswer = () => false;
    await send(m, a, call("next", "BootNotification", BOOT));
    expect(frames(a.sock).at(-1)[2]).toMatchObject({ status: "Rejected", interval: 1800 });
    expect(a.sock.closed?.code).toBe(1008);
  });
  it("REVIEW CASE: an unreachable gate keeps the socket; the failed attempt is charged, so repeated boots (and fresh instances) cause ONE gate call per cooldown", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("first", "BootNotification", BOOT));
    leaseCalls = [];
    clock += SIX_HOURS + 1;
    renewAnswer = () => Promise.reject(new Error("gate unreachable"));
    await send(m, a, call("next", "BootNotification", BOOT));
    expect(a.sock.closed).toBeNull();
    expect(frames(a.sock).at(-1)[2].status).toBe("Pending");
    expect(renews()).toHaveLength(1);
    // Nine more boots, each on a new instance (hibernation), inside the cooldown: no gate call at all.
    for (let i = 0; i < 9; i++) {
      clock += 1000;
      await send(mode(), a, call(`retry-${i}`, "BootNotification", BOOT));
    }
    expect(renews()).toHaveLength(1);
    expect(frames(a.sock).slice(1).every((f) => f[0] === 3 && f[2].status === "Pending")).toBe(true); // every reply stayed correct
    // After the cooldown the gate is asked again; still down: another single call, and the socket survives.
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
    await send(mode(), a, call("after-cooldown", "BootNotification", BOOT));
    expect(renews()).toHaveLength(2);
    // Recovered: a held answer moves the next renewal a full period out.
    renewAnswer = () => true;
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
    await send(mode(), a, call("recovered", "BootNotification", BOOT));
    expect(renews()).toHaveLength(3);
    clock += 1800 * 1000;
    await send(mode(), a, call("quiet", "BootNotification", BOOT));
    expect(renews()).toHaveLength(3);
    expect(a.sock.closed).toBeNull();
  });
  it("a replacement or close DURING the renewal await: the stale caller sends nothing, closes nothing and records nothing", async () => {
    for (const interleave of ["replace", "close"] as const) {
      state = new FakeState();
      const m = mode();
      const a = await connect(m);
      await send(m, a, call("first", "BootNotification", BOOT));
      leaseCalls = [];
      clock += SIX_HOURS + 1;
      let settle!: (v: boolean) => void;
      renewAnswer = () => new Promise<boolean>((r) => { settle = r; });
      const pendingBoot = send(m, a, call("slow", "BootNotification", BOOT));
      await vi.waitFor(() => expect(leaseCalls.filter((l) => l.startsWith("renew"))).toHaveLength(1));
      const sentBefore = a.sock.sent.length;
      let b: Conn | null = null;
      if (interleave === "replace") b = await connect(m);
      else a.sock.close(1006, "gone");
      const putsBefore = state.storage.puts;
      settle(false); // a refusal that would close the socket if it were applied
      await pendingBoot;
      expect(a.sock.sent.length, interleave).toBe(sentBefore);
      expect(state.storage.puts, interleave).toBe(putsBefore);
      if (b) expect(b.sock.closed, interleave).toBeNull();
      renewAnswer = () => true;
    }
  });
  it("REVIEW CASE: the attempt is charged BEFORE the gate is asked, so boots (even on fresh instances) while a slow call is in flight make no second call", async () => {
    for (const result of ["unavailable", "held"] as const) {
      state = new FakeState();
      const m = mode();
      const a = await connect(m);
      await send(m, a, call("first", "BootNotification", BOOT));
      leaseCalls = [];
      clock += SIX_HOURS + 1;
      let settle!: () => void;
      renewAnswer = () => new Promise<boolean>((resolve, reject) => { settle = () => (result === "held" ? resolve(true) : reject(new Error("gate unreachable"))); });
      const one = send(m, a, call("one", "BootNotification", BOOT));
      await vi.waitFor(() => expect(renews()).toHaveLength(1));
      // Two more boots, each on a new instance (hibernation), while the first call has not answered: they complete without the gate.
      await send(mode(), a, call("two", "BootNotification", BOOT));
      await send(mode(), a, call("three", "BootNotification", BOOT));
      expect(renews(), result).toHaveLength(1);
      settle();
      await one;
      expect(renews(), result).toHaveLength(1);
      expect(a.sock.closed, result).toBeNull();
      expect(frames(a.sock).slice(1).every((f) => f[0] === 3 && f[2].status === "Pending"), result).toBe(true);
      // Held: the next renewal is a full period out. Unavailable: only the cooldown applies, after which the gate is asked again.
      renewAnswer = result === "held" ? () => true : () => Promise.reject(new Error("gate unreachable"));
      clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
      await send(mode(), a, call("after", "BootNotification", BOOT));
      expect(renews(), result).toHaveLength(result === "held" ? 1 : 2);
    }
  });
});

// Ownership across the gate boundary. These use the real PendingGate with the real PendingMode; only the platform is faked.
describe("pending mode: connection ownership at the gate", () => {
  const ID = CTX.chargePointId;
  const newGate = () => new PendingGate(new FakeState() as unknown as DurableObjectState, () => clock);
  const gateLease = (gate: PendingGate): PendingLease => ({
    renew: (c, owner, create) => gate.renew(c.chargePointId, owner, create),
    release: (c, owner) => gate.releaseOwner(c.chargePointId, owner),
  });
  const gated = (lease: PendingLease) => new PendingMode(state as unknown as DurableObjectState, env, negotiate, () => clock, lease);
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
  };

  it("the owner token handed over by the entry Worker rides with the generation, and every gate call carries it", async () => {
    const m = mode();
    const a = await connect(m, CTX, "tok-a");
    await send(m, a, call("b1", "BootNotification", BOOT));
    a.sock.close(1006, "gone");
    await m.closed(a.ws, tagOf(a), 1006);
    expect(leaseDetail).toEqual([{ op: "renew", owner: "tok-a", create: false }, { op: "release", owner: "tok-a" }]);
    // A generation without a handed-over token (a direct upgrade) is named by its generation, never by a shared empty value.
    const b = await connect(m);
    await send(m, b, call("b2", "BootNotification", BOOT));
    expect(leaseDetail.at(-1)).toEqual({ op: "renew", owner: "g2", create: false });
    // A malformed token is not trusted.
    const c = await connect(m, CTX, "bad token!");
    await send(m, c, call("b3", "BootNotification", BOOT));
    expect(leaseDetail.at(-1)).toEqual({ op: "renew", owner: "g3", create: false });
  });

  it("REVIEW CASE: an old connection's delayed close cannot remove the replacement's slot, and starts no Incoming window", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    const arrived = deferred();
    const resume = deferred();
    let delayRelease = false;
    const m = gated({
      renew: real.renew,
      release: async (c, owner) => {
        if (delayRelease) {
          arrived.resolve();
          await resume.promise;
        }
        await real.release(c, owner);
      },
    });
    expect(await gate.acquire(ID, "old-upgrade")).toBe(true);
    const old = await connect(m, CTX, "old-upgrade");
    await send(m, old, call("first", "BootNotification", BOOT)); // confirms the old connection as owner
    delayRelease = true;
    old.sock.close(1000, "disconnect");
    const closing = m.closed(old.ws, tagOf(old), 1000);
    await arrived.promise; // the old release is now in flight
    expect(await gate.acquire(ID, "new-upgrade")).toBe(true);
    const fresh = await connect(m, CTX, "new-upgrade");
    resume.resolve();
    await closing;
    expect(fresh.sock.readyState).toBe(1);
    expect(await gate.size()).toBe(1);
    expect(engineCalls.filter((c) => c.op === "closed")).toHaveLength(0);
    // The replacement confirms; the old owner can no longer renew or claim the identity.
    await send(m, fresh, call("again", "BootNotification", BOOT));
    expect(await gate.renew(ID, "old-upgrade", false)).toBe(false);
    expect(await gate.renew(ID, "old-upgrade", true)).toBe(false);
    expect(await gate.size()).toBe(1);
    await m.closed(fresh.ws, tagOf(fresh), 1006);
    expect(await gate.size()).toBe(0);
  });

  it("REVIEW CASE: a renewal that is still in flight when the connection closes does not recreate the released slot and is not re-claimed", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    const arrived = deferred();
    const resume = deferred();
    const renewFlags: boolean[] = [];
    let delayRenew = false;
    const m = gated({
      renew: async (c, owner, create) => {
        renewFlags.push(create);
        if (delayRenew) {
          arrived.resolve();
          await resume.promise;
        }
        return real.renew(c, owner, create);
      },
      release: real.release,
    });
    expect(await gate.acquire(ID, "tok-1")).toBe(true);
    const a = await connect(m, CTX, "tok-1");
    delayRenew = true;
    const boot = send(m, a, call("b1", "BootNotification", BOOT)); // its first renewal is held in flight
    await arrived.promise;
    a.sock.close(1006, "gone");
    await m.closed(a.ws, tagOf(a), 1006); // the release reaches the gate first
    expect(await gate.size()).toBe(0);
    resume.resolve();
    await boot;
    expect(renewFlags).toEqual([false]); // no second, creating call from a connection that is already gone
    expect(await gate.size()).toBe(0);
    expect(a.sock.sent).toHaveLength(0);
  });

  it("REVIEW CASE: a stale renewal from a replaced connection records nothing, and the replacement then owns the slot", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    const arrived = deferred();
    const resume = deferred();
    let delayRenew = false;
    const m = gated({
      renew: async (c, owner, create) => {
        if (delayRenew) {
          arrived.resolve();
          await resume.promise;
        }
        return real.renew(c, owner, create);
      },
      release: real.release,
    });
    expect(await gate.acquire(ID, "tok-1")).toBe(true);
    const a = await connect(m, CTX, "tok-1");
    await send(m, a, call("first", "BootNotification", BOOT)); // tok-1 confirmed
    clock += SIX_HOURS + 1;
    delayRenew = true;
    const slow = send(m, a, call("slow", "BootNotification", BOOT)); // renewal due, held in flight
    await arrived.promise;
    delayRenew = false;
    expect(await gate.acquire(ID, "tok-2")).toBe(true);
    const b = await connect(m, CTX, "tok-2");
    const putsBefore = state.storage.puts;
    resume.resolve();
    await slow;
    expect(state.storage.puts).toBe(putsBefore); // the stale caller recorded nothing
    expect(b.sock.closed).toBeNull();
    await send(m, b, call("b2", "BootNotification", BOOT)); // the replacement confirms tok-2
    expect(await gate.renew(ID, "tok-1", false)).toBe(false);
    expect(await gate.renew(ID, "tok-1", true)).toBe(false);
    expect(await gate.size()).toBe(1);
    await m.closed(b.ws, tagOf(b), 1006);
    expect(await gate.size()).toBe(0);
  });

  it("a live socket whose lease lapsed claims a slot again on its next due renewal", async () => {
    const gate = newGate();
    const m = gated(gateLease(gate));
    expect(await gate.acquire(ID, "tok-1")).toBe(true);
    const a = await connect(m, CTX, "tok-1");
    await send(m, a, call("first", "BootNotification", BOOT));
    // The gate lost the lease (a charger silent for longer than the lease): the next renewal asks to create it.
    await gate.releaseOwner(ID, "tok-1");
    clock += SIX_HOURS + 1;
    await send(m, a, call("next", "BootNotification", BOOT));
    expect(await gate.size()).toBe(1);
    expect(a.sock.closed).toBeNull();
  });

  // The gate lease of a confirmed connection lapses (a silent charger) and its next renewal has to CREATE the slot. These cases
  // hold that creating call in flight while the connection ends.
  const lapsedConnection = async (m: PendingMode, gate: PendingGate) => {
    expect(await gate.acquire(ID, "tok-1")).toBe(true);
    const a = await connect(m, CTX, "tok-1");
    await send(m, a, call("first", "BootNotification", BOOT)); // tok-1 confirmed
    clock += PENDING_LEASE_MS + 1; // the gate lease has lapsed; the re-check and the renewal are both due
    return a;
  };

  it("REVIEW CASE: a creating renewal that lands after its socket closed gives the slot back (no empty seven-hour lease)", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    const arrived = deferred();
    const resume = deferred();
    const m = gated({
      renew: async (c, owner, create) => {
        if (create) {
          arrived.resolve();
          await resume.promise;
        }
        return real.renew(c, owner, create);
      },
      release: real.release,
    });
    const a = await lapsedConnection(m, gate);
    const sentBefore = a.sock.sent.length;
    const slow = send(m, a, call("later", "BootNotification", BOOT));
    await arrived.promise;
    a.sock.close(1000, "gone");
    await m.closed(a.ws, tagOf(a), 1000);
    expect(await gate.size()).toBe(0); // the close released nothing to remove yet
    resume.resolve(); // the creating call now lands on the gate
    await slow;
    expect(await gate.size()).toBe(0);
    expect(a.sock.sent).toHaveLength(sentBefore); // the stale caller answered nothing
  });

  it("REVIEW CASE: a held creating renewal whose connection was replaced meanwhile releases only its own token; the replacement keeps the slot", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    const arrived = deferred();
    const resume = deferred();
    const m = gated({
      renew: async (c, owner, create) => {
        const held = await real.renew(c, owner, create); // applied at the gate...
        if (create) {
          arrived.resolve();
          await resume.promise; // ...but the answer is slow
        }
        return held;
      },
      release: real.release,
    });
    const a = await lapsedConnection(m, gate);
    const slow = send(m, a, call("later", "BootNotification", BOOT));
    await arrived.promise;
    expect(await gate.acquire(ID, "tok-2")).toBe(true); // the replacement's upgrade is admitted next to the old owner
    const b = await connect(m, CTX, "tok-2");
    resume.resolve();
    await slow;
    expect(await gate.size()).toBe(1); // the slot was kept for tok-2
    expect(b.sock.readyState).toBe(1);
    expect(b.sock.closed).toBeNull();
    await send(m, b, call("b2", "BootNotification", BOOT)); // the replacement confirms
    expect(await gate.renew(ID, "tok-1", false)).toBe(false);
    expect(await gate.renew(ID, "tok-1", true)).toBe(false);
    expect(await gate.size()).toBe(1);
    await m.closed(b.ws, tagOf(b), 1006);
    expect(await gate.size()).toBe(0);
  });

  it("REVIEW CASE: a creating renewal that is refused because the replacement owns the slot changes nothing and takes nothing", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    const arrived = deferred();
    const resume = deferred();
    const m = gated({
      renew: async (c, owner, create) => {
        if (create) {
          arrived.resolve();
          await resume.promise;
        }
        return real.renew(c, owner, create);
      },
      release: real.release,
    });
    const a = await lapsedConnection(m, gate);
    const slow = send(m, a, call("later", "BootNotification", BOOT));
    await arrived.promise;
    expect(await gate.acquire(ID, "tok-2")).toBe(true);
    const b = await connect(m, CTX, "tok-2");
    const sentBefore = a.sock.sent.length;
    resume.resolve();
    await slow;
    expect(a.sock.sent).toHaveLength(sentBefore);
    expect(await gate.size()).toBe(1);
    expect(b.sock.closed).toBeNull();
    await send(m, b, call("b2", "BootNotification", BOOT));
    expect(await gate.renew(ID, "tok-2", false)).toBe(true);
  });

  it("REVIEW CASE: a LOST reply to a creating renewal (the gate applied it) is cleaned up when the connection is already gone; a lost cleanup is bounded by the lease expiry", async () => {
    for (const cleanupLost of [false, true]) {
      const gate = newGate();
      const real = gateLease(gate);
      const arrived = deferred();
      const resume = deferred();
      let releases = 0;
      state = new FakeState();
      const m = gated({
        renew: async (c, owner, create) => {
          if (create) {
            arrived.resolve();
            await resume.promise;
            await real.renew(c, owner, create); // applied at the gate...
            throw new Error("reply lost"); // ...but the pending object never hears
          }
          return real.renew(c, owner, create);
        },
        release: async (c, owner) => {
          releases++;
          if (cleanupLost && releases > 1) throw new Error("cleanup lost"); // the close's own release (#1) works, the compensating one (#2) does not
          await real.release(c, owner);
        },
      });
      const a = await lapsedConnection(m, gate);
      const slow = send(m, a, call("later", "BootNotification", BOOT));
      await arrived.promise;
      a.sock.close(1000, "gone");
      await m.closed(a.ws, tagOf(a), 1000);
      expect(await gate.size(), String(cleanupLost)).toBe(0);
      resume.resolve();
      await slow;
      expect(releases, String(cleanupLost)).toBe(2);
      if (!cleanupLost) {
        expect(await gate.size()).toBe(0);
      } else {
        expect(await gate.size()).toBe(1); // no new machinery: it is freed by the gate's own finite expiry
        clock += PENDING_LEASE_MS + 1;
        expect(await gate.size()).toBe(0);
      }
    }
  });

  it("a creating renewal for a connection that is still open and current keeps its slot: only a stale caller releases", async () => {
    const gate = newGate();
    const real = gateLease(gate);
    let releases = 0;
    const m = gated({ renew: real.renew, release: async (c, owner) => { releases++; await real.release(c, owner); } });
    const a = await lapsedConnection(m, gate);
    await send(m, a, call("later", "BootNotification", BOOT));
    expect(await gate.size()).toBe(1);
    expect(releases).toBe(0);
    expect(a.sock.closed).toBeNull();
    expect(frames(a.sock).at(-1)[2].status).toBe("Pending");
  });
});

describe("pending mode: promotion to normal operation", () => {
  it("a boot retry that finds the charger registered closes 4002 so it reconnects through NORMAL admission; no Accepted is forged", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    engineAnswer = (c) => (c.op === "check" ? { kind: "state", state: "registered" } : { kind: "ok" });
    clock += SIX_HOURS + 1000;
    await send(m, a, call("b2", "BootNotification", BOOT));
    expect(a.sock.closed).toEqual({ code: 4002, reason: "registered; reconnect" });
    expect(frames(a.sock).filter((f) => f[2]?.status === "Accepted")).toHaveLength(0);
    expect(frames(a.sock)).toHaveLength(1); // only the first Pending
    expect(leaseCalls).toContain("release:ZPR074002");
  });
  it("a changed boot on a charger that became registered also closes 4002 (the capture RPC reports registration)", async () => {
    const m = mode();
    const a = await connect(m);
    engineAnswer = () => ({ kind: "state", state: "registered" });
    await send(m, a, call("b1", "BootNotification", BOOT));
    expect(a.sock.closed?.code).toBe(4002);
  });
  it("the re-check is due only after PENDING_RECHECK_SECONDS: a retry before that costs no engine call", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    clock += SIX_HOURS - 60_000;
    await send(m, a, call("b2", "BootNotification", BOOT));
    expect(engineCalls).toHaveLength(1);
    clock += 120_000;
    await send(m, a, call("b3", "BootNotification", BOOT));
    expect(engineCalls.map((c) => c.op)).toEqual(["boot", "check"]);
  });
  it("a re-check that finds the charger still unregistered keeps the socket open, answers Pending, and is not repeated on the next retry", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    clock += SIX_HOURS + 1000;
    await send(m, a, call("b2", "BootNotification", BOOT));
    clock += 1800 * 1000;
    await send(m, a, call("b3", "BootNotification", BOOT));
    expect(engineCalls.map((c) => c.op)).toEqual(["boot", "check"]);
    expect(a.sock.closed).toBeNull();
    expect(frames(a.sock).map((f) => f[2].status)).toEqual(["Pending", "Pending", "Pending"]);
  });
  it("promote(): re-reads the actual registration. Registered -> reconnect requested; unregistered -> nothing; known -> nothing; outage -> unavailable", async () => {
    const m = mode();
    const a = await connect(m);
    engineAnswer = () => ({ kind: "state", state: "unregistered" });
    expect(await m.promote()).toBe("still_unregistered");
    expect(a.sock.closed).toBeNull();
    engineAnswer = () => ({ kind: "state", state: "known" });
    expect(await m.promote()).toBe("known");
    engineAnswer = () => ({ kind: "unavailable" });
    expect(await m.promote()).toBe("unavailable");
    expect(a.sock.closed).toBeNull();
    engineAnswer = () => ({ kind: "state", state: "registered" });
    expect(await m.promote()).toBe("reconnect_requested");
    expect(a.sock.closed?.code).toBe(4002);
  });
  it("promote() with no open socket answers not_connected WITHOUT touching the engine (a forged signal costs nothing)", async () => {
    const m = mode();
    expect(await m.promote()).toBe("not_connected");
    const a = await connect(m);
    a.sock.close(1000, "bye");
    a.sock.finishClose();
    expect(await m.promote()).toBe("not_connected");
    expect(engineCalls).toHaveLength(0);
  });
});

describe("pending mode: admission lease, close, error, presence and hibernation", () => {
  it("the lease is renewed when a body is stored and released when the last socket goes, but not for a replaced socket", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    expect(leaseCalls).toEqual(["renew:ZPR074002"]);
    const b = await connect(m); // a replaced
    await m.closed(a.ws, { pending: true, generation: 1 }, 4001);
    expect(leaseCalls).toEqual(["renew:ZPR074002"]); // the replacement still holds the slot
    await m.closed(b.ws, tagOf(b), 1006);
    expect(leaseCalls).toEqual(["renew:ZPR074002", "release:ZPR074002"]);
  });
  it("a charger-side close notes the disconnect once; our own 4001/4002 closes and a replaced socket's death note nothing", async () => {
    const m = mode();
    const a = await connect(m);
    const b = await connect(m); // a replaced
    await m.closed(a.ws, { pending: true, generation: 1 }, 4001);
    expect(engineCalls).toHaveLength(0);
    await m.closed(b.ws, tagOf(b), 4002);
    expect(engineCalls).toHaveLength(0);
    await m.closed(b.ws, tagOf(b), 1006);
    expect(engineCalls).toEqual([{ op: "closed", routingId: "test-cpo", chargePointId: "ZPR074002" }]);
  });
  it("presence reports gateway-observed OPEN socket state only", async () => {
    const m = mode();
    expect(await m.presence()).toEqual({ connected: false });
    const a = await connect(m);
    expect(await m.presence()).toEqual({ connected: true });
    a.sock.close(1000, "x");
    expect(await m.presence()).toEqual({ connected: false });
  });
  it("after eviction a NEW instance over the same storage and sockets keeps the dedupe, the recheck schedule and the ownership", async () => {
    const first = mode();
    const a = await connect(first);
    await send(first, a, call("b1", "BootNotification", BOOT));
    const restored = mode(); // fresh in-memory state, same durable state and live sockets
    await send(restored, a, call("b2", "BootNotification", BOOT));
    expect(engineCalls).toHaveLength(1); // dedupe survived
    expect(frames(a.sock)[1][1]).toBe("b2");
    expect(await restored.presence()).toEqual({ connected: true });
    const b = await connect(restored); // replacement after restore
    expect(a.sock.closed?.code).toBe(4001);
    expect(tagOf(b).generation).toBe(2);
  });
  it("a reconnect stores its first boot afresh, under the capture budget", async () => {
    const m = mode();
    const a = await connect(m);
    await send(m, a, call("b1", "BootNotification", BOOT));
    clock += PENDING_CAPTURE_MIN_INTERVAL_MS;
    const b = await connect(m);
    await send(m, b, call("b2", "BootNotification", BOOT));
    expect(engineCalls.map((c) => c.op)).toEqual(["boot", "boot"]);
  });
  it("a socket error behaves like a close", async () => {
    const m = mode();
    const a = await connect(m);
    await m.closed(a.ws, tagOf(a));
    expect(engineCalls.map((c) => c.op)).toEqual(["closed"]);
  });
});

// ── Measured ledger (LOCAL FIXTURE counts; engine calls and durable writes counted at the gateway boundary) ─────────────
// Neon statements are NOT measured here: they are read from drizzle-admission-store.ts (registration = 2 selects; hasCapture
// = 1 select; a capture write = lock + 1 select [+ count + at most one body eviction for a first-ever identity] + upsert;
// touch = 1 upsert).
describe("measured cost ledger", () => {
  const snapshot = (label: string) => ({ label, engine: engineCalls.map((c) => c.op).join(","), puts: state.storage.puts, deletes: state.storage.deletes });
  it("idle waiting charger for 24 h at the 1800 s retry the charger was told: engine calls and durable writes", async () => {
    const m = mode();
    const a = await connect(m);
    const connectPuts = state.storage.puts;
    for (let i = 0; i < 48; i++) {
      await send(m, a, call(`d${i}`, "BootNotification", BOOT));
      clock += 1800 * 1000;
    }
    const ops = engineCalls.map((c) => c.op);
    expect(ops.filter((o) => o === "boot")).toHaveLength(1);
    expect(ops.filter((o) => o === "check")).toHaveLength(Math.floor((47 * 1800) / PENDING_RECHECK_SECONDS)); // one per 6 h
    // writes: captureAt + hash + recheck + leaseAt (attempt cooldown, then the 6 h time) + bootGen = 6 on the first boot; per
    // re-check the attempt cooldown, the 6 h re-check time and the lease's two puts = 4; nothing per repeated boot. The lease's
    // cooldown is written before the gate is asked (one more put than before), which is what keeps a slow or failing gate from
    // being called again by the next boot.
    expect(state.storage.puts - connectPuts).toBe(6 + 4 * ops.filter((o) => o === "check").length);
    expect(leaseCalls.filter((l) => l.startsWith("renew"))).toHaveLength(1 + ops.filter((o) => o === "check").length);
    expect(a.sock.closed).toBeNull();
    console.info("LEDGER", JSON.stringify({ ...snapshot("idle 24h, 48 identical boots"), connectPuts, boots: 48 }));
  });
  it("a charger that reconnects every 90 s for an hour: one capture per budget interval, never one per reconnect or message", async () => {
    const m = mode();
    for (let i = 0; i < 40; i++) {
      const c = await connect(m);
      await send(m, c, call(`r${i}`, "BootNotification", BOOT));
      clock += 90_000;
    }
    expect(engineCalls.length).toBe(Math.ceil((40 * 90_000) / PENDING_CAPTURE_MIN_INTERVAL_MS)); // 1 hour / 10 min
    console.info("LEDGER", JSON.stringify({ ...snapshot("40 reconnects in 1 h, 1 boot each"), boots: 40 }));
  });
  it("sustained changing bodies for an hour (one per minute): one capture per budget interval", async () => {
    const m = mode();
    const a = await connect(m);
    for (let i = 0; i < 60; i++) {
      await send(m, a, call(`c${i}`, "BootNotification", { ...BOOT, firmwareVersion: `v${i}` }));
      clock += 60_000;
    }
    expect(engineCalls.length).toBe(6);
    console.info("LEDGER", JSON.stringify({ ...snapshot("60 changing bodies in 1 h"), boots: 60 }));
  });
  it("an abusive socket (300 frames: garbage, oversize, binary, actions) makes zero engine calls and is closed within the per-window budget", async () => {
    const m = mode();
    const a = await connect(m);
    const before = state.storage.puts;
    let sent = 0;
    for (let i = 0; i < 300 && !a.sock.closed; i++) {
      sent++;
      await send(m, a, i % 4 === 0 ? "{bad" : i % 4 === 1 ? call(`x${i}`, "Authorize", { idTag: "X" }) : i % 4 === 2 ? new ArrayBuffer(4) : "y".repeat(100));
    }
    expect(engineCalls).toHaveLength(0);
    expect(state.storage.puts).toBe(before);
    expect(a.sock.closed?.code).toBe(1008);
    expect(sent).toBe(PENDING_MESSAGES_PER_WINDOW + 1);
    console.info("LEDGER", JSON.stringify({ ...snapshot("abusive 300-frame attempt"), framesBeforeClose: sent }));
  });
  it("many distinct identities never share state: each pending object stores only its own", async () => {
    const stores = Array.from({ length: 5 }, () => new FakeState());
    for (const [i, st] of stores.entries()) {
      const m = new PendingMode(st as unknown as DurableObjectState, env, negotiate, () => clock, lease);
      await m.upgrade(upgradeReq({ ...CTX, chargePointId: `CP-${i}` }, "ocpp1.6"));
    }
    expect(stores.map((s) => (s.storage.m.get("pending:ctx") as PendingContext).chargePointId)).toEqual(["CP-0", "CP-1", "CP-2", "CP-3", "CP-4"]);
  });
});
