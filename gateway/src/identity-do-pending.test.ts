// The Durable Object routes pending sockets to PendingMode and never lets them reach the legacy or engine paths.
// LOCAL FIXTURES ONLY (fake sockets/storage/engine).
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { IdentityDurableObject } from "./identity-do";
import { PENDING_ATTEMPT_HEADER, PENDING_CTX_HEADER, readPendingTag } from "./pending-mode";
import type { PendingCall } from "./engine-client";
import { MAX_PENDING_SOCKETS_PER_CPO } from "@engine/pending";

class FakeResponse {
  constructor(readonly body: unknown, readonly init: { status?: number; webSocket?: unknown } = {}) {}
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
  async list() {
    return new Map();
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

const CTX = { orgId: "11111111-1111-4111-8111-111111111111", routingId: "test-cpo", chargePointId: "ZPR074002" };
const BOOT = { chargePointVendor: "Zaptec", chargePointModel: "Go" };
let pendingCalls: PendingCall[];
let otherCalls: number;
let state: FakeState;

function makeDo() {
  const env = {
    ENGINE: {
      admit: async () => ({ kind: "deny" as const }),
      call: async () => { otherCalls++; return { kind: "unavailable" as const }; },
      pending: async (c: PendingCall) => { pendingCalls.push(c); return c.op === "check" ? { kind: "state" as const, state: "registered" as const } : { kind: "captured" as const, result: "stored" as const }; },
    },
  };
  return new IdentityDurableObject(state as unknown as DurableObjectState, env as never);
}
const wsReq = (attempt?: string) =>
  new Request("https://do.internal/pending/ws", { method: "GET", headers: { upgrade: "websocket", [PENDING_CTX_HEADER]: JSON.stringify(CTX), ...(attempt ? { [PENDING_ATTEMPT_HEADER]: attempt } : {}) } });

/**
 * Real IdentityDurableObject instances that reach each other through a fake namespace, one FakeState each: the pending object
 * `pending:{cpo}:{id}` and the per-CPO gate object `pending-gate:{cpo}` collaborate exactly as they do in the Worker, apart from
 * the platform itself. `beforeGate` lets a test hold a gate request in flight.
 */
function makeCluster(beforeGate?: (req: Request) => Promise<void>) {
  const objects = new Map<string, { d: IdentityDurableObject; st: FakeState }>();
  const env: Record<string, unknown> = {
    ENGINE: {
      admit: async () => ({ kind: "deny" as const }),
      call: async () => { otherCalls++; return { kind: "unavailable" as const }; },
      pending: async (c: PendingCall) => { pendingCalls.push(c); return c.op === "check" ? { kind: "state" as const, state: "unregistered" as const, hasCapture: true } : { kind: "captured" as const, result: "stored" as const }; },
    },
  };
  const obj = (name: string) => {
    let o = objects.get(name);
    if (!o) {
      const st = new FakeState();
      o = { d: new IdentityDurableObject(st as unknown as DurableObjectState, env as never), st };
      objects.set(name, o);
    }
    return o;
  };
  env.IDENTITY_DO = {
    idFromName: (n: string) => n,
    get: (name: string) => ({
      fetch: async (req: Request) => {
        if (name.startsWith("pending-gate:") && beforeGate) await beforeGate(req);
        return obj(name).d.fetch(req);
      },
    }),
  };
  const gateName = `pending-gate:${CTX.orgId}`;
  return {
    pending: () => obj(`pending:${CTX.orgId}:${CTX.chargePointId}`).d,
    gate: (path: "acquire" | "release", body: Record<string, unknown>) =>
      (env.IDENTITY_DO as { get: (n: string) => { fetch: (r: Request) => Promise<Response> } }).get(gateName).fetch(new Request(`https://do.internal/gate/${path}`, { method: "POST", body: JSON.stringify(body) })),
    /** The gate's stored leases (the one storage key the gate writes). */
    leases: () => (obj(gateName).st.storage.m.get("gate:leases") ?? {}) as Record<string, { o?: string; a?: string }>,
  };
}

beforeEach(() => {
  vi.stubGlobal("WebSocketPair", FakePair);
  vi.stubGlobal("Response", FakeResponse);
  state = new FakeState();
  pendingCalls = [];
  otherCalls = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("IdentityDurableObject: pending routing", () => {
  it("a pending upgrade is accepted by PendingMode; its BootNotification is answered Pending and never reaches the legacy/engine lanes", async () => {
    const d = makeDo();
    expect((await d.fetch(wsReq())).status).toBe(101);
    const ws = lastPair![1] as unknown as WebSocket;
    expect(readPendingTag(ws)).toEqual({ pending: true, generation: 1 });
    await d.webSocketMessage(ws, JSON.stringify([2, "b1", "BootNotification", BOOT]));
    expect(JSON.parse(lastPair![1].sent[0]!)[2].status).toBe("Pending");
    expect(pendingCalls.map((c) => c.op)).toEqual(["boot"]);
    expect(otherCalls).toBe(0);
  });
  it("a Start/Authorize from a pending socket is refused and never reaches the engine call lane", async () => {
    const d = makeDo();
    await d.fetch(wsReq());
    const ws = lastPair![1] as unknown as WebSocket;
    await d.webSocketMessage(ws, JSON.stringify([2, "s1", "StartTransaction", { connectorId: 1, idTag: "X", meterStart: 0, timestamp: "2026-10-31T10:00:00Z" }]));
    expect(JSON.parse(lastPair![1].sent[0]!)[2]).toBe("SecurityError");
    expect(otherCalls).toBe(0);
  });
  it("promote and presence are reachable only as internal object paths and report the real state", async () => {
    const d = makeDo();
    const none = await d.fetch(new Request("https://do.internal/pending/promote", { method: "POST" }));
    expect(await none.json()).toEqual({ outcome: "not_connected" });
    await d.fetch(wsReq());
    const presence = await d.fetch(new Request("https://do.internal/pending/presence"));
    expect(await presence.json()).toEqual({ connected: true });
    const promoted = await d.fetch(new Request("https://do.internal/pending/promote", { method: "POST" }));
    expect(await promoted.json()).toEqual({ outcome: "reconnect_requested" });
    expect(lastPair![1].closed?.code).toBe(4002);
  });
  it("close and error go to PendingMode; the alarm of a pending object only enforces the first-boot deadline", async () => {
    const d = makeDo();
    await d.fetch(wsReq());
    const sock = lastPair![1];
    await d.alarm();
    expect(sock.closed).toBeNull(); // an alarm before the deadline closes nothing
    const real = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(real + 61_000);
    await d.alarm();
    vi.restoreAllMocks();
    expect(sock.closed?.reason).toBe("no BootNotification");
    await d.webSocketClose(sock as unknown as WebSocket, 1006, "gone", false);
    expect(pendingCalls.map((c) => c.op)).toEqual(["closed"]);
    await d.fetch(wsReq());
    await d.webSocketError(lastPair![1] as unknown as WebSocket, new Error("x"));
    expect(pendingCalls.map((c) => c.op)).toEqual(["closed", "closed"]);
    expect(otherCalls).toBe(0);
  });
  const gatePost = (d: IdentityDurableObject) => async (path: "acquire" | "release", body: Record<string, unknown>) =>
    (await (await d.fetch(new Request(`https://do.internal/gate/${path}`, { method: "POST", body: JSON.stringify(body) }))).json()) as { ok: boolean };
  it("the admission gate object grants up to the cap, refuses beyond it, and gives a slot back on release", async () => {
    const post = gatePost(makeDo());
    for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO; i++) expect((await post("acquire", { id: `CP-${i}`, attempt: `att-${i}` })).ok).toBe(true);
    expect((await post("acquire", { id: "CP-NEW", attempt: "att-new" })).ok).toBe(false);
    await post("release", { id: "CP-3", attempt: "att-3" });
    expect((await post("acquire", { id: "CP-NEW", attempt: "att-new" })).ok).toBe(true);
  });
  it("the gate route separates an unconfirmed upgrade (attempt) from an accepted connection (owner)", async () => {
    const post = gatePost(makeDo());
    const filled = async () => {
      let n = 0;
      for (let i = 0; i < MAX_PENDING_SOCKETS_PER_CPO + 1; i++) if ((await post("acquire", { id: `probe-${i}`, attempt: `probe-att-${i}` })).ok) n++;
      return n;
    };
    expect((await post("acquire", { id: "CP-A", attempt: "att-1" })).ok).toBe(true);
    expect((await post("acquire", { id: "CP-A", owner: "att-1" })).ok).toBe(true); // the pending object confirms
    await post("release", { id: "CP-A", attempt: "att-1" }); // a late failure report of the same upgrade
    expect(await filled()).toBe(MAX_PENDING_SOCKETS_PER_CPO - 1); // CP-A still holds its slot
    await post("release", { id: "CP-A", owner: "att-1" });
    expect((await post("acquire", { id: "CP-Z", attempt: "att-z" })).ok).toBe(true); // CP-A's slot is free again
  });
  it("a gate call without a valid token changes nothing, and a lapsed owner is not recreated by a plain renewal", async () => {
    const post = gatePost(makeDo());
    expect((await post("acquire", { id: "CP-X" })).ok).toBe(false);
    expect((await post("acquire", { id: "CP-X", attempt: "bad token" })).ok).toBe(false);
    expect((await post("acquire", { id: "CP-X", owner: "tok-1" })).ok).toBe(false); // nothing to renew, and `create` was not asked for
    expect((await post("acquire", { id: "CP-X", owner: "tok-1", create: true })).ok).toBe(true);
    await post("release", { id: "CP-X" });
    await post("release", { id: "CP-X", owner: "tok-other" });
    expect((await post("acquire", { id: "CP-X", owner: "tok-1" })).ok).toBe(true); // still held
    await post("release", { id: "CP-X", owner: "tok-1" });
    expect((await post("acquire", { id: "CP-X", owner: "tok-1" })).ok).toBe(false); // gone, not recreated
  });
  it("a pending upgrade without a context header is not treated as one", async () => {
    const d = makeDo();
    const res = await d.fetch(new Request("https://do.internal/pending/ws", { headers: { upgrade: "websocket" } }));
    expect(res.status).toBe(404);
  });
});

// Real objects talking to each other through a fake namespace (no platform): ownership across the object boundary.
describe("IdentityDurableObject: pending connection ownership across the gate", () => {
  const ID = CTX.chargePointId;
  const bootFrame = JSON.stringify([2, "b1", "BootNotification", BOOT]);
  const okOf = async (res: Response) => ((await res.json()) as { ok: boolean }).ok;

  it("the first boot confirms the upgrade's claim; closing the socket gives the slot back", async () => {
    const cluster = makeCluster();
    const pending = cluster.pending();
    expect(await okOf(await cluster.gate("acquire", { id: ID, attempt: "att-1" }))).toBe(true);
    expect(cluster.leases()[ID]).toMatchObject({ a: "att-1" });
    expect((await pending.fetch(wsReq("att-1"))).status).toBe(101);
    const ws = lastPair![1] as unknown as WebSocket;
    await pending.webSocketMessage(ws, bootFrame);
    expect(cluster.leases()[ID]!.o).toBe("att-1");
    expect(cluster.leases()[ID]!.a).toBeUndefined();
    await pending.webSocketClose(ws, 1006, "gone", false);
    expect(Object.keys(cluster.leases())).toEqual([]);
  });
  it("REVIEW CASE: an old connection's close, delivered after a replacement claimed the identity, cannot free the replacement's slot", async () => {
    let hold: Promise<void> | null = null;
    let arrived!: () => void;
    const arrivedP = new Promise<void>((r) => { arrived = r; });
    const cluster = makeCluster(async (req) => {
      if (hold && new URL(req.url).pathname === "/gate/release") {
        arrived();
        await hold;
      }
    });
    const pending = cluster.pending();
    await cluster.gate("acquire", { id: ID, attempt: "att-old" });
    await pending.fetch(wsReq("att-old"));
    const oldWs = lastPair![1] as unknown as WebSocket;
    await pending.webSocketMessage(oldWs, bootFrame);
    expect(cluster.leases()[ID]!.o).toBe("att-old");

    let resume!: () => void;
    hold = new Promise<void>((r) => { resume = r; });
    const closing = pending.webSocketClose(oldWs, 1006, "gone", false); // its release is now held in flight
    await arrivedP;
    expect(await okOf(await cluster.gate("acquire", { id: ID, attempt: "att-new" }))).toBe(true);
    expect((await pending.fetch(wsReq("att-new"))).status).toBe(101);
    const newWs = lastPair![1] as unknown as WebSocket;
    resume();
    await closing;

    // The old release found the replacement's claim and left the slot for it.
    expect(Object.keys(cluster.leases())).toEqual([ID]);
    expect(cluster.leases()[ID]!.a).toBe("att-new");
    expect(cluster.leases()[ID]!.o).toBeUndefined();
    expect(pendingCalls.filter((c) => c.op === "closed")).toHaveLength(0); // a replaced socket's death starts no Incoming window
    // The replacement confirms with its own first boot, then owns the slot until it goes.
    await pending.webSocketMessage(newWs, bootFrame);
    expect(cluster.leases()[ID]!.o).toBe("att-new");
    await pending.webSocketClose(newWs, 1006, "gone", false);
    expect(Object.keys(cluster.leases())).toEqual([]);
  });
  it("a second upgrade of the same id while one is in flight is refused, and neither failure leaves an empty slot", async () => {
    const cluster = makeCluster();
    expect(await okOf(await cluster.gate("acquire", { id: ID, attempt: "att-1" }))).toBe(true);
    expect(await okOf(await cluster.gate("acquire", { id: ID, attempt: "att-2" }))).toBe(false);
    await cluster.gate("release", { id: ID, attempt: "att-1" });
    await cluster.gate("release", { id: ID, attempt: "att-2" });
    expect(Object.keys(cluster.leases())).toEqual([]);
  });
  it("a renewal that reaches the gate after the slot was released does not recreate it", async () => {
    const cluster = makeCluster();
    const pending = cluster.pending();
    await cluster.gate("acquire", { id: ID, attempt: "att-1" });
    await pending.fetch(wsReq("att-1"));
    const ws = lastPair![1] as unknown as WebSocket;
    await pending.webSocketMessage(ws, bootFrame);
    await pending.webSocketClose(ws, 1006, "gone", false);
    expect(await okOf(await cluster.gate("acquire", { id: ID, owner: "att-1" }))).toBe(false);
    expect(Object.keys(cluster.leases())).toEqual([]);
  });
  it("a never-booting socket gives its unconfirmed claim back at the first-boot deadline", async () => {
    const seen: { path: string; body: { id?: string; owner?: string; attempt?: string } }[] = [];
    const cluster = makeCluster(async (req) => {
      seen.push({ path: new URL(req.url).pathname, body: JSON.parse(await req.clone().text()) });
    });
    const pending = cluster.pending();
    await cluster.gate("acquire", { id: ID, attempt: "att-1" });
    await pending.fetch(wsReq("att-1"));
    seen.length = 0;
    const real = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(real + 61_000);
    await pending.alarm();
    vi.restoreAllMocks();
    // The pending object gave the claim back as that connection's owner (the claim itself would also have lapsed by now).
    expect(seen).toEqual([{ path: "/gate/release", body: expect.objectContaining({ id: ID, owner: "att-1" }) }]);
  });
});
