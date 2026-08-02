// Tests for IdentityDurableObject — P4.16 (outbound command durability)
// and P4.17 (OCPP subprotocol echo).
//
// The DO runs on the WebSocket Hibernation API, so it is evicted from
// memory between frames. The whole point of P4.16 is that inflight
// outbound commands survive that eviction, which is why several tests
// below deliberately throw away the DO instance and build a fresh one
// over the *same* storage — that is what a hibernation wake-up looks
// like from the object's point of view.
//
// Environment is plain node (see vitest.config.ts), so the Workers
// globals the DO touches are stubbed:
//   • `WebSocketPair` — not present in node at all.
//   • `Response` — node's implementation rejects status 101 outright
//     (RangeError), which is exactly the status the upgrade path
//     returns.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { IdentityDurableObject, selectSubprotocol } from "./identity-do";
import type { GatewayEnv } from "./auth";

const IDENTITY_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const IDENTITY_STRING = "zpr-test-001";
const COMMAND_TIMEOUT_MS = 30_000;

// ───────────────────────────────────────────────────────────────────
// Fakes
// ───────────────────────────────────────────────────────────────────

/** Case-insensitive header bag — avoids depending on node's Headers. */
function headerBag(init: Record<string, string | undefined>) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(init)) {
    if (v !== undefined) map.set(k.toLowerCase(), v);
  }
  return { get: (name: string): string | null => map.get(name.toLowerCase()) ?? null };
}

interface ResponseInitLike {
  status?: number;
  headers?: Record<string, string>;
  webSocket?: unknown;
}

class FakeResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly webSocket: unknown;
  private readonly bodyValue: unknown;

  constructor(body: unknown, init: ResponseInitLike = {}) {
    this.bodyValue = body;
    this.status = init.status ?? 200;
    this.headers = headerBag(init.headers ?? {});
    this.webSocket = init.webSocket;
  }

  static json(data: unknown, init: ResponseInitLike = {}): FakeResponse {
    return new FakeResponse(JSON.stringify(data), init);
  }

  async json(): Promise<unknown> {
    return JSON.parse(String(this.bodyValue));
  }

  async text(): Promise<string> {
    return String(this.bodyValue ?? "");
  }
}

class FakeWebSocket {
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* no-op */
  }
}

class FakeWebSocketPair {
  readonly 0: FakeWebSocket;
  readonly 1: FakeWebSocket;
  constructor() {
    this[0] = new FakeWebSocket();
    this[1] = new FakeWebSocket();
  }
}

class FakeStorage {
  readonly entries = new Map<string, unknown>();
  alarm: number | null = null;
  /** Counts delete() calls so we can prove the claim-once semantics. */
  deleteCalls = 0;

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.entries.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.entries.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    this.deleteCalls += 1;
    return this.entries.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const sorted = [...this.entries.keys()].sort();
    for (const key of sorted) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue;
      out.set(key, structuredClone(this.entries.get(key)) as T);
    }
    return out;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm = typeof scheduledTime === "number" ? scheduledTime : scheduledTime.getTime();
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

class FakeState {
  readonly storage = new FakeStorage();
  private readonly sockets: FakeWebSocket[] = [];

  acceptWebSocket(ws: FakeWebSocket): void {
    this.sockets.push(ws);
  }

  getWebSockets(): FakeWebSocket[] {
    return [...this.sockets];
  }
}

interface CapturedEvent {
  eventType: string;
  orgId: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

function makeEnv(): { env: GatewayEnv; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const env: GatewayEnv = {
    MAIN_APP: {
      fetch: vi.fn(async () => {
        throw new Error("MAIN_APP should not be reached in these tests");
      }),
    },
    OCPP_INGEST_SECRET: "test-secret",
    OCPP_EVENTS_QUEUE: {
      send: async (body: unknown) => {
        events.push(body as CapturedEvent);
      },
    },
  };
  return { env, events };
}

function makeRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string | undefined>; body?: unknown } = {},
): Request {
  return {
    url,
    method: init.method ?? "GET",
    headers: headerBag(init.headers ?? {}),
    json: async () => init.body,
  } as unknown as Request;
}

function makeDo(state: FakeState, env: GatewayEnv): IdentityDurableObject {
  return new IdentityDurableObject(state as unknown as DurableObjectState, env);
}

function upgradeRequest(subprotocol?: string): Request {
  return makeRequest("https://do.internal/ws", {
    headers: {
      upgrade: "websocket",
      "x-straumvakt-identity-id": IDENTITY_ID,
      "x-straumvakt-org-id": ORG_ID,
      "x-straumvakt-identity-string": IDENTITY_STRING,
      "sec-websocket-protocol": subprotocol,
    },
  });
}

function dispatchRequest(commandId: string, action = "RemoteStartTransaction"): Request {
  return makeRequest("https://do.internal/dispatch", {
    method: "POST",
    body: { commandId, action, payload: { connectorId: 1, idTag: "VCP-IDTAG" } },
  });
}

async function connectAndDispatch(
  d: IdentityDurableObject,
  state: FakeState,
  commandId: string,
  action?: string,
): Promise<{ uniqueId: string; serverWs: FakeWebSocket }> {
  await d.fetch(upgradeRequest("ocpp1.6"));
  const res = (await d.fetch(dispatchRequest(commandId, action))) as unknown as FakeResponse;
  expect(res.status).toBe(202);
  const body = (await res.json()) as { result: { uniqueId: string } };
  const serverWs = state.getWebSockets()[0]!;
  return { uniqueId: body.result.uniqueId, serverWs };
}

function callResult(uniqueId: string, payload: Record<string, unknown>): string {
  return JSON.stringify([3, uniqueId, payload]);
}

function commandResults(events: CapturedEvent[]): CapturedEvent[] {
  return events.filter((e) => e.eventType === "ocpp.command_result");
}

beforeEach(() => {
  vi.stubGlobal("Response", FakeResponse);
  vi.stubGlobal("WebSocketPair", FakeWebSocketPair);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────
// P4.16 — outbound command durability
// ───────────────────────────────────────────────────────────────────

describe("P4.16 outbound command durability", () => {
  it("persists the pending command to storage before the Call frame leaves", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const { uniqueId, serverWs } = await connectAndDispatch(d, state, "cmd-1");

    const keys = [...state.storage.entries.keys()].filter((k) => k.startsWith("cmd:"));
    expect(keys).toEqual([`cmd:${uniqueId}`]);

    // The frame actually went out, and carries the same uniqueId that
    // was persisted — the correlation key is the wire id, not a
    // separate bookkeeping id.
    expect(serverWs.sent).toHaveLength(1);
    const frame = JSON.parse(serverWs.sent[0]!) as [number, string, string, unknown];
    expect(frame[0]).toBe(2);
    expect(frame[1]).toBe(uniqueId);
    expect(frame[2]).toBe("RemoteStartTransaction");
  });

  it("correlates a CallResult that arrives after the DO was evicted", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();

    // Instance A dispatches, then is thrown away — the hibernation
    // eviction. Anything it kept in memory is gone.
    const instanceA = makeDo(state, env);
    const { uniqueId, serverWs } = await connectAndDispatch(instanceA, state, "cmd-evicted");

    // Instance B wakes on the inbound frame with empty in-memory state.
    const instanceB = makeDo(state, env);
    await instanceB.webSocketMessage(
      serverWs as unknown as WebSocket,
      callResult(uniqueId, { status: "Accepted" }),
    );

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.aggregateType).toBe("outbound_command");
    expect(results[0]!.aggregateId).toBe("cmd-evicted");
    expect(results[0]!.correlationId).toBe(uniqueId);
    expect(results[0]!.payload.outcome).toBe("accepted");
    expect(results[0]!.payload.result).toEqual({ status: "Accepted" });

    // Correlated commands are removed from storage.
    expect([...state.storage.entries.keys()].filter((k) => k.startsWith("cmd:"))).toEqual([]);
  });

  it("correlates a CallError after eviction and reports it rejected", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();

    const instanceA = makeDo(state, env);
    const { uniqueId, serverWs } = await connectAndDispatch(instanceA, state, "cmd-error");

    const instanceB = makeDo(state, env);
    await instanceB.webSocketMessage(
      serverWs as unknown as WebSocket,
      JSON.stringify([4, uniqueId, "NotSupported", "no such action", {}]),
    );

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.payload.outcome).toBe("rejected");
    expect(results[0]!.payload.result).toEqual({
      errorCode: "NotSupported",
      errorDescription: "no such action",
    });
  });

  it("emits exactly one command_result for a duplicate CallResult", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    const { uniqueId, serverWs } = await connectAndDispatch(d, state, "cmd-dup");

    const frame = callResult(uniqueId, { status: "Accepted" });
    await d.webSocketMessage(serverWs as unknown as WebSocket, frame);
    await d.webSocketMessage(serverWs as unknown as WebSocket, frame);

    expect(commandResults(events)).toHaveLength(1);
  });

  it("sweeps commands still inflight when the socket closes", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    const { uniqueId, serverWs } = await connectAndDispatch(d, state, "cmd-disconnect");

    await d.webSocketClose(serverWs as unknown as WebSocket, 1006, "abnormal", false);

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.aggregateId).toBe("cmd-disconnect");
    expect(results[0]!.correlationId).toBe(uniqueId);
    // `rejected` (not a bespoke outcome) so the apps/api
    // ocpp.command_result projection drives the outbox row to 'failed'.
    expect(results[0]!.payload.outcome).toBe("rejected");
    expect(results[0]!.payload.result).toMatchObject({
      reason: "disconnected",
      closeCode: 1006,
      closeReason: "abnormal",
    });

    expect([...state.storage.entries.keys()].filter((k) => k.startsWith("cmd:"))).toEqual([]);
    // No inflight commands left → no reason to wake for a timeout.
    expect(state.storage.alarm).toBeNull();
  });

  it("sweeps on socket error too, since webSocketClose never fires for that path", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    const { serverWs } = await connectAndDispatch(d, state, "cmd-ws-error");

    await d.webSocketError(serverWs as unknown as WebSocket, new Error("socket reset"));

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.payload.outcome).toBe("rejected");
    expect(results[0]!.payload.result).toMatchObject({
      reason: "disconnected",
      socketError: "socket reset",
    });
  });

  it("emits nothing on a clean close with no commands inflight", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    await d.fetch(upgradeRequest("ocpp1.6"));
    const serverWs = state.getWebSockets()[0]!;
    await d.webSocketClose(serverWs as unknown as WebSocket, 1000, "bye", true);

    expect(commandResults(events)).toHaveLength(0);
    expect(state.storage.entries.get("lastClosedAt")).toBeTypeOf("number");
  });

  it("arms an alarm on dispatch and fails the command when it fires uncorrelated", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    const { uniqueId } = await connectAndDispatch(d, state, "cmd-timeout");
    expect(state.storage.alarm).toBe(t0 + COMMAND_TIMEOUT_MS);

    // Not yet due — the sweep must leave it alone.
    vi.setSystemTime(t0 + COMMAND_TIMEOUT_MS - 1);
    await d.alarm();
    expect(commandResults(events)).toHaveLength(0);
    expect(state.storage.entries.has(`cmd:${uniqueId}`)).toBe(true);

    // Due — terminal state, not silence.
    vi.setSystemTime(t0 + COMMAND_TIMEOUT_MS);
    await d.alarm();

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.aggregateId).toBe("cmd-timeout");
    expect(results[0]!.payload.outcome).toBe("rejected");
    expect(results[0]!.payload.result).toEqual({
      reason: "timeout",
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    expect(results[0]!.payload.latencyMs).toBe(COMMAND_TIMEOUT_MS);
    expect(state.storage.entries.has(`cmd:${uniqueId}`)).toBe(false);
  });

  it("survives eviction on the timeout path as well", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env, events } = makeEnv();

    const instanceA = makeDo(state, env);
    await connectAndDispatch(instanceA, state, "cmd-timeout-evicted");

    vi.setSystemTime(t0 + COMMAND_TIMEOUT_MS + 5_000);
    // A DO woken purely by its alarm has no meta in memory; it must
    // recover it from storage or the event would be dropped.
    const instanceB = makeDo(state, env);
    await instanceB.alarm();

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.aggregateId).toBe("cmd-timeout-evicted");
    // Identity meta was recovered from storage, not memory.
    expect(results[0]!.orgId).toBe(ORG_ID);
  });

  it("re-arms the alarm for the next command still inside its window", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    await connectAndDispatch(d, state, "cmd-early");
    expect(state.storage.alarm).toBe(t0 + COMMAND_TIMEOUT_MS);

    // A later dispatch must not push the earlier deadline out.
    vi.setSystemTime(t0 + 5_000);
    await d.fetch(dispatchRequest("cmd-late", "Reset"));
    expect(state.storage.alarm).toBe(t0 + COMMAND_TIMEOUT_MS);

    vi.setSystemTime(t0 + COMMAND_TIMEOUT_MS);
    await d.alarm();

    expect(commandResults(events).map((e) => e.aggregateId)).toEqual(["cmd-early"]);
    expect(state.storage.alarm).toBe(t0 + 5_000 + COMMAND_TIMEOUT_MS);

    vi.setSystemTime(t0 + 5_000 + COMMAND_TIMEOUT_MS);
    await d.alarm();
    expect(commandResults(events).map((e) => e.aggregateId)).toEqual(["cmd-early", "cmd-late"]);
  });

  it("does not double-report when a CallResult beats the alarm to the same command", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    const { uniqueId, serverWs } = await connectAndDispatch(d, state, "cmd-race");

    await d.webSocketMessage(
      serverWs as unknown as WebSocket,
      callResult(uniqueId, { status: "Accepted" }),
    );

    vi.setSystemTime(t0 + COMMAND_TIMEOUT_MS);
    await d.alarm();

    const results = commandResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.payload.outcome).toBe("accepted");
  });

  it("rejects dispatch with 503 and stores nothing when no socket is connected", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const res = (await d.fetch(dispatchRequest("cmd-nosocket"))) as unknown as FakeResponse;

    expect(res.status).toBe(503);
    expect([...state.storage.entries.keys()].filter((k) => k.startsWith("cmd:"))).toEqual([]);
  });

  it("still logs an unmatched CallResult rather than throwing", async () => {
    const state = new FakeState();
    const { env, events } = makeEnv();
    const d = makeDo(state, env);

    await d.fetch(upgradeRequest("ocpp1.6"));
    const serverWs = state.getWebSockets()[0]!;

    await d.webSocketMessage(
      serverWs as unknown as WebSocket,
      callResult("never-dispatched", { status: "Accepted" }),
    );

    expect(commandResults(events)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      "[ocpp-gw] unmatched CallResult uniqueId",
      "never-dispatched",
    );
  });
});

// ───────────────────────────────────────────────────────────────────
// P4.17 — OCPP subprotocol echo
// ───────────────────────────────────────────────────────────────────

describe("selectSubprotocol", () => {
  it("selects nothing when the client offers nothing", () => {
    expect(selectSubprotocol(null)).toEqual({ ok: true, selected: null });
    expect(selectSubprotocol("")).toEqual({ ok: true, selected: null });
    expect(selectSubprotocol("  ")).toEqual({ ok: true, selected: null });
  });

  it("selects the single supported protocol", () => {
    expect(selectSubprotocol("ocpp1.6")).toEqual({ ok: true, selected: "ocpp1.6" });
  });

  it("picks the supported one out of a list and ignores whitespace", () => {
    expect(selectSubprotocol("ocpp2.0.1, ocpp1.6")).toEqual({
      ok: true,
      selected: "ocpp1.6",
    });
    expect(selectSubprotocol("  ocpp1.6 ,ocpp1.5  ")).toEqual({
      ok: true,
      selected: "ocpp1.6",
    });
  });

  it("matches case-insensitively but echoes the client's own spelling", () => {
    // RFC 6455 §4.1 — the selected value must be one the client sent.
    expect(selectSubprotocol("OCPP1.6")).toEqual({ ok: true, selected: "OCPP1.6" });
  });

  it("fails when offers are present but none are supported", () => {
    expect(selectSubprotocol("ocpp2.0.1")).toEqual({
      ok: false,
      offered: ["ocpp2.0.1"],
    });
    expect(selectSubprotocol("ocpp1.5, ocpp2.0")).toEqual({
      ok: false,
      offered: ["ocpp1.5", "ocpp2.0"],
    });
  });
});

describe("P4.17 upgrade handshake", () => {
  it("echoes Sec-WebSocket-Protocol when the client offers ocpp1.6", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const res = (await d.fetch(upgradeRequest("ocpp1.6"))) as unknown as FakeResponse;

    expect(res.status).toBe(101);
    expect(res.headers.get("Sec-WebSocket-Protocol")).toBe("ocpp1.6");
    expect(state.getWebSockets()).toHaveLength(1);
  });

  it("omits the header entirely when the client offers no subprotocol", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const res = (await d.fetch(upgradeRequest(undefined))) as unknown as FakeResponse;

    expect(res.status).toBe(101);
    expect(res.headers.get("Sec-WebSocket-Protocol")).toBeNull();
    expect(state.getWebSockets()).toHaveLength(1);
  });

  it("selects ocpp1.6 out of a multi-protocol offer", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const res = (await d.fetch(
      upgradeRequest("ocpp2.0.1, ocpp1.6, ocpp1.5"),
    )) as unknown as FakeResponse;

    expect(res.status).toBe(101);
    expect(res.headers.get("Sec-WebSocket-Protocol")).toBe("ocpp1.6");
  });

  it("fails the handshake cleanly when no offered protocol is supported", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const res = (await d.fetch(upgradeRequest("ocpp2.0.1"))) as unknown as FakeResponse;

    expect(res.status).toBe(400);
    // No socket accepted, no meta written — nothing to clean up later.
    expect(state.getWebSockets()).toHaveLength(0);
    expect(state.storage.entries.has("meta")).toBe(false);
  });

  it("accepts the offer forwarded by the entry Worker on the custom header", async () => {
    // The entry Worker rebuilds the upgrade request, so it relays the
    // offer as x-straumvakt-ws-protocol.
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    const req = makeRequest("https://do.internal/ws", {
      headers: {
        upgrade: "websocket",
        "x-straumvakt-identity-id": IDENTITY_ID,
        "x-straumvakt-org-id": ORG_ID,
        "x-straumvakt-identity-string": IDENTITY_STRING,
        "x-straumvakt-ws-protocol": "ocpp1.6",
      },
    });
    const res = (await d.fetch(req)) as unknown as FakeResponse;

    expect(res.status).toBe(101);
    expect(res.headers.get("Sec-WebSocket-Protocol")).toBe("ocpp1.6");
  });
});
