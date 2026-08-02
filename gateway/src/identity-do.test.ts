// Tests for IdentityDurableObject — P4.16 (outbound command durability),
// P4.17 (OCPP subprotocol echo) and P4.18 (Authorize verdict caching).
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
import {
  IdentityDurableObject,
  selectSubprotocol,
  retentionClassFor,
} from "./identity-do";
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
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  readonly webSocket: unknown;
  private readonly bodyValue: unknown;

  constructor(body: unknown, init: ResponseInitLike = {}) {
    this.bodyValue = body;
    this.status = init.status ?? 200;
    // The Authorize sidecar branches on `resp.ok`, so the fake has to
    // carry it or every stubbed 200 would read as an upstream failure.
    this.ok = this.status >= 200 && this.status < 300;
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

// ───────────────────────────────────────────────────────────────────
// P4.18 — Authorize verdict caching
// ───────────────────────────────────────────────────────────────────

const AUTHORIZE_CACHE_TTL_MS = 60_000;

interface VerdictBody {
  verdict: "Accepted" | "Blocked" | "Expired" | "Invalid";
  reason: string;
  userId?: string;
  idTokenId?: string;
  enforceAuthorize: boolean;
}

type UpstreamBehaviour =
  | { kind: "verdict"; body: VerdictBody }
  | { kind: "status"; status: number }
  | { kind: "throw"; message: string };

interface AuthorizeUpstream {
  /** Every body the DO actually sent upstream — length is the miss count. */
  calls: Array<{ idTag: string; identityId: string; orgId: string }>;
  /** Mutable: tests flip this between frames. */
  behaviour: UpstreamBehaviour;
}

function verdict(
  v: VerdictBody["verdict"],
  enforceAuthorize: boolean,
  reason = "test",
): UpstreamBehaviour {
  return { kind: "verdict", body: { verdict: v, reason, enforceAuthorize, idTokenId: "tok-1" } };
}

/**
 * Replace the throwing MAIN_APP fake with an Authorize responder whose
 * behaviour the test can change mid-flight. Call count is the whole
 * point of these tests: a cache hit must produce no upstream call.
 */
function installAuthorizeUpstream(
  env: GatewayEnv,
  initial: UpstreamBehaviour,
): AuthorizeUpstream {
  const upstream: AuthorizeUpstream = { calls: [], behaviour: initial };
  env.MAIN_APP = {
    fetch: async (req: Request) => {
      upstream.calls.push(
        (await req.json()) as { idTag: string; identityId: string; orgId: string },
      );
      const b = upstream.behaviour;
      if (b.kind === "throw") throw new Error(b.message);
      if (b.kind === "status") {
        return new FakeResponse("upstream sad", { status: b.status }) as unknown as Response;
      }
      return new FakeResponse(JSON.stringify(b.body), { status: 200 }) as unknown as Response;
    },
  };
  return upstream;
}

async function connect(d: IdentityDurableObject, state: FakeState): Promise<FakeWebSocket> {
  await d.fetch(upgradeRequest("ocpp1.6"));
  return state.getWebSockets()[0]!;
}

let uniqueIdSeq = 0;

/** Send an Authorize/StartTransaction Call and return the reply payload. */
async function sendAuthFrame(
  d: IdentityDurableObject,
  ws: FakeWebSocket,
  idTag: string,
  action: "Authorize" | "StartTransaction" = "Authorize",
): Promise<Record<string, unknown>> {
  const uniqueId = `auth-${(uniqueIdSeq += 1)}`;
  const payload =
    action === "StartTransaction" ? { connectorId: 1, idTag, meterStart: 0 } : { idTag };
  await d.webSocketMessage(
    ws as unknown as WebSocket,
    JSON.stringify([2, uniqueId, action, payload]),
  );
  const frame = JSON.parse(ws.sent[ws.sent.length - 1]!) as [number, string, Record<string, unknown>];
  expect(frame[0]).toBe(3);
  expect(frame[1]).toBe(uniqueId);
  return frame[2];
}

function idTagStatus(reply: Record<string, unknown>): unknown {
  return (reply.idTagInfo as Record<string, unknown> | undefined)?.status;
}

/** The most recent `authorize.evaluated` structured log payload. */
function lastAuthorizeLog(): Record<string, unknown> {
  const calls = vi
    .mocked(console.log)
    .mock.calls.filter((c) => c[0] === "[ocpp-gw] authorize.evaluated");
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![1] as Record<string, unknown>;
}

function authzKeys(state: FakeState): string[] {
  return [...state.storage.entries.keys()].filter((k) => k.startsWith("authz:"));
}

function invalidateRequest(body: unknown): Request {
  return makeRequest("https://do.internal/invalidate-authorize", {
    method: "POST",
    body,
  });
}

/** F21 — the persisted last-known enforcement posture, if any. */
function enforceMemo(
  state: FakeState,
): { enforceAuthorize: boolean; observedAt: number } | undefined {
  return state.storage.entries.get("enforceAuthorize") as
    | { enforceAuthorize: boolean; observedAt: number }
    | undefined;
}

describe("P4.18 Authorize verdict caching", () => {
  it("serves the StartTransaction that follows an Authorize from cache", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    const first = await sendAuthFrame(d, ws, "TAG-A", "Authorize");
    expect(idTagStatus(first)).toBe("Accepted");
    expect(upstream.calls).toHaveLength(1);
    expect(lastAuthorizeLog().cached).toBe(false);

    // The pair the cache exists for: same idTag, seconds later.
    const second = await sendAuthFrame(d, ws, "TAG-A", "StartTransaction");
    expect(idTagStatus(second)).toBe("Accepted");
    expect(second.transactionId).toBeTypeOf("number");
    expect(upstream.calls).toHaveLength(1);
    expect(lastAuthorizeLog().cached).toBe(true);
    // Cached verdicts keep every field the fresh one carried, so the
    // operator's pre-flip validation reads the same either way.
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "Accepted",
      reason: "test",
      idTokenId: "tok-1",
      enforceAuthorize: true,
      mode: "enforced",
    });
  });

  it("keys the cache by idTag — a different token is a miss", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-A");
    await sendAuthFrame(d, ws, "TAG-B");

    expect(upstream.calls.map((c) => c.idTag)).toEqual(["TAG-A", "TAG-B"]);
    expect(authzKeys(state).sort()).toEqual(["authz:TAG-A", "authz:TAG-B"]);
    expect(lastAuthorizeLog().cached).toBe(false);
  });

  it("survives DO eviction — the cache lives in storage, not memory", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));

    const instanceA = makeDo(state, env);
    const ws = await connect(instanceA, state);
    await sendAuthFrame(instanceA, ws, "TAG-HIB");
    expect(upstream.calls).toHaveLength(1);

    // Hibernation wake-up: fresh instance, same storage. An in-memory
    // Map would miss here, which is the whole reason for DO storage.
    const instanceB = makeDo(state, env);
    await sendAuthFrame(instanceB, ws, "TAG-HIB", "StartTransaction");

    expect(upstream.calls).toHaveLength(1);
    expect(lastAuthorizeLog().cached).toBe(true);
  });

  it("treats an entry at or past its TTL as a miss", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-TTL");
    expect(upstream.calls).toHaveLength(1);
    expect(state.storage.entries.get("authz:TAG-TTL")).toMatchObject({
      expiresAt: t0 + AUTHORIZE_CACHE_TTL_MS,
    });

    // One millisecond inside the window — still a hit.
    vi.setSystemTime(t0 + AUTHORIZE_CACHE_TTL_MS - 1);
    await sendAuthFrame(d, ws, "TAG-TTL");
    expect(upstream.calls).toHaveLength(1);
    expect(lastAuthorizeLog().cached).toBe(true);

    // Exactly at the deadline — expired, so back upstream.
    vi.setSystemTime(t0 + AUTHORIZE_CACHE_TTL_MS);
    await sendAuthFrame(d, ws, "TAG-TTL");
    expect(upstream.calls).toHaveLength(2);
    expect(lastAuthorizeLog().cached).toBe(false);
    // Refreshed, not left on the old deadline.
    expect(state.storage.entries.get("authz:TAG-TTL")).toMatchObject({
      expiresAt: t0 + 2 * AUTHORIZE_CACHE_TTL_MS,
    });
  });

  it("re-reads a revoked token immediately after explicit invalidation", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-REVOKE"))).toBe("Accepted");

    // Operator revokes the token. Without this call the charger would
    // keep getting Accepted for up to the full TTL.
    const res = (await d.fetch(
      invalidateRequest({ idTag: "TAG-REVOKE" }),
    )) as unknown as FakeResponse;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, scope: "idTag", cleared: 1 });
    expect(authzKeys(state)).toEqual([]);

    upstream.behaviour = verdict("Blocked", true, "revoked");
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-REVOKE"))).toBe("Blocked");
    expect(upstream.calls).toHaveLength(2);
    expect(lastAuthorizeLog().cached).toBe(false);
  });

  it("clears every cached verdict on the all form, and is idempotent", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-A");
    await sendAuthFrame(d, ws, "TAG-B");
    expect(authzKeys(state)).toHaveLength(2);

    const res = (await d.fetch(invalidateRequest({ all: true }))) as unknown as FakeResponse;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, scope: "all", cleared: 2 });
    expect(authzKeys(state)).toEqual([]);

    // Invalidating nothing is still a success — the caller's contract
    // ("not served from cache after this") already holds.
    const again = (await d.fetch(invalidateRequest({ all: true }))) as unknown as FakeResponse;
    expect(await again.json()).toEqual({ ok: true, scope: "all", cleared: 0 });
    const unknownTag = (await d.fetch(
      invalidateRequest({ idTag: "NEVER-SEEN" }),
    )) as unknown as FakeResponse;
    expect(await unknownTag.json()).toEqual({ ok: true, scope: "idTag", cleared: 0 });

    await sendAuthFrame(d, ws, "TAG-A");
    expect(upstream.calls).toHaveLength(3);
  });

  it("leaves inflight command state alone when clearing the whole cache", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);

    const { uniqueId } = await connectAndDispatch(d, state, "cmd-untouched");
    const ws = state.getWebSockets()[0]!;
    await sendAuthFrame(d, ws, "TAG-A");

    await d.fetch(invalidateRequest({ all: true }));

    // The authz: prefix must not sweep cmd: rows with it.
    expect(state.storage.entries.has(`cmd:${uniqueId}`)).toBe(true);
    expect(authzKeys(state)).toEqual([]);
  });

  it("rejects an invalidation body that names neither an idTag nor all", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const d = makeDo(state, env);

    expect(((await d.fetch(invalidateRequest({}))) as unknown as FakeResponse).status).toBe(400);
    expect(
      ((await d.fetch(invalidateRequest({ idTag: "" }))) as unknown as FakeResponse).status,
    ).toBe(400);
    expect(
      ((await d.fetch(invalidateRequest({ all: false }))) as unknown as FakeResponse).status,
    ).toBe(400);
  });

  it("rides out an upstream outage on an unexpired cached entry", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Blocked", true, "not-in-list"));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-OUTAGE"))).toBe("Blocked");

    // Upstream falls over. The cached entry is still inside its window,
    // so the frame is answered from cache and never touches the network.
    upstream.behaviour = { kind: "throw", message: "service binding down" };
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-OUTAGE"))).toBe("Blocked");
    expect(upstream.calls).toHaveLength(1);
    expect(lastAuthorizeLog()).toMatchObject({ verdict: "Blocked", cached: true });
  });

  it("falls back to the stub reply on an upstream error with no cached entry", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, { kind: "throw", message: "boom" });
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    // No verdict at all, and this DO has never observed enforcement →
    // shadow posture (Accepted). See the F21 block for the case where
    // enforcement *has* been observed, which refuses instead.
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-ERR"))).toBe("Accepted");
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "upstream_error",
      reason: "upstream_error",
      cached: false,
    });
    // A failure must never be cached — that would freeze a transient
    // blip in for the whole TTL.
    expect(authzKeys(state)).toEqual([]);
    expect(upstream.calls).toHaveLength(1);
  });

  it("does not cache a non-200 upstream reply either, and retries the next frame", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, { kind: "status", status: 500 });
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-500");
    expect(authzKeys(state)).toEqual([]);

    upstream.behaviour = verdict("Accepted", true);
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-500"))).toBe("Accepted");
    expect(upstream.calls).toHaveLength(2);
    expect(lastAuthorizeLog().cached).toBe(false);
    expect(authzKeys(state)).toEqual(["authz:TAG-500"]);
  });

  it("does not resurrect an expired entry when the upstream is down", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-STALE");
    vi.setSystemTime(t0 + AUTHORIZE_CACHE_TTL_MS + 1);
    upstream.behaviour = { kind: "throw", message: "boom" };

    // Expired is a miss, not a fallback: we do not serve
    // stale-while-error on an access-control decision.
    await sendAuthFrame(d, ws, "TAG-STALE");
    expect(upstream.calls).toHaveLength(2);
    expect(lastAuthorizeLog()).toMatchObject({ verdict: "upstream_error", cached: false });
  });

  it("keeps shadow mode identical whether the verdict was cached or not", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    // enforceAuthorize=false → the charger is told Accepted regardless
    // of the verdict (P4.11 posture). Caching must not touch that.
    installAuthorizeUpstream(env, verdict("Blocked", false, "not-in-list"));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    const uncached = await sendAuthFrame(d, ws, "TAG-SHADOW", "Authorize");
    const uncachedLog = { ...lastAuthorizeLog() };
    const cached = await sendAuthFrame(d, ws, "TAG-SHADOW", "Authorize");
    const cachedLog = { ...lastAuthorizeLog() };

    expect(idTagStatus(uncached)).toBe("Accepted");
    expect(idTagStatus(cached)).toBe("Accepted");
    // The logged verdict is the real one both times — that log is how
    // the operator validates before flipping the flag.
    expect(uncachedLog).toMatchObject({ verdict: "Blocked", mode: "shadow", cached: false });
    expect(cachedLog).toMatchObject({ verdict: "Blocked", mode: "shadow", cached: true });
    // `cached` is the only field that may differ between the two.
    expect({ ...cachedLog, cached: false }).toEqual(uncachedLog);
  });

  it("keeps enforced mode identical whether the verdict was cached or not", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    installAuthorizeUpstream(env, verdict("Expired", true, "past-expiry"));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    const uncached = await sendAuthFrame(d, ws, "TAG-ENF", "Authorize");
    const cached = await sendAuthFrame(d, ws, "TAG-ENF", "StartTransaction");

    expect(idTagStatus(uncached)).toBe("Expired");
    // Refused start still carries a transactionId (OCPP 1.6 §6.6).
    expect(idTagStatus(cached)).toBe("Expired");
    expect(cached.transactionId).toBeTypeOf("number");
  });

  it("records the enforcement memo alongside the cached verdict", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-MEMO");

    // The memo must not live under the authz: prefix — /invalidate-authorize
    // { all: true } sweeps that, and it is exactly the call an operator
    // makes when flipping enforceAuthorize.
    expect(authzKeys(state)).toEqual(["authz:TAG-MEMO"]);
    expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: true });
  });

  it("never consults the cache for non-authorize actions", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await d.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify([2, "hb-1", "Heartbeat", {}]),
    );
    await d.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify([2, "st-1", "StopTransaction", { idTag: "TAG-A", transactionId: 7 }]),
    );

    expect(upstream.calls).toHaveLength(0);
    expect(authzKeys(state)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────
// F21 — the access gate fails CLOSED when the verdict is unverifiable
//
// Operator posture: "if things are offline, the user can't charge."
// The hard part is that `enforceAuthorize` only ever arrives inside a
// verdict, so a failed lookup leaves the DO not knowing whether the
// gate is armed. It decides on the last successfully observed value,
// persisted in DO storage.
//
// Most tests below need a DO that has *seen* enforcement but has *no
// usable cache entry* — the real-world shape is "verdict cached an hour
// ago, TTL long gone, API now down". `armAndForget` builds it by doing
// one successful lookup and then dropping the cached verdict, which is
// the same end state as TTL expiry without needing fake timers.
// ───────────────────────────────────────────────────────────────────

const OUTAGE: UpstreamBehaviour = { kind: "throw", message: "service binding down" };

/**
 * Drive one successful lookup so the enforcement memo is written, then
 * clear the verdict cache. Leaves the DO knowing the installation's
 * posture but with nothing cached to answer from.
 */
async function armAndForget(
  d: IdentityDurableObject,
  ws: FakeWebSocket,
  state: FakeState,
  enforce: boolean,
  idTag = "TAG-F21",
): Promise<void> {
  await sendAuthFrame(d, ws, idTag);
  expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: enforce });
  await d.fetch(invalidateRequest({ all: true }));
  expect(authzKeys(state)).toEqual([]);
}

describe("F21 Authorize gate fails closed on an unverifiable lookup", () => {
  it("refuses when the upstream is down and enforcement was last known on", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, true);
    expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: true });

    upstream.behaviour = OUTAGE;
    const reply = await sendAuthFrame(d, ws, "TAG-F21", "Authorize");

    // Pre-F21 this was Accepted — the gate opened whenever the API did.
    expect(idTagStatus(reply)).toBe("Blocked");
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "upstream_error",
      reason: "upstream_error",
      cached: false,
      mode: "enforced",
      replyStatus: "Blocked",
      // The distinct field: this Blocked says nothing about the token.
      availabilityRefusal: true,
    });
    // A refusal we invented must never be cached — the next frame has
    // to retry upstream, not inherit our guess for a whole TTL.
    expect(authzKeys(state)).toEqual([]);
  });

  it("still proceeds on a cached Accepted while the upstream is down", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    // The pair F21 must not break: Authorize succeeds, the API drops,
    // and the StartTransaction lands seconds later.
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-PAIR", "Authorize"))).toBe("Accepted");
    upstream.behaviour = OUTAGE;

    const start = await sendAuthFrame(d, ws, "TAG-PAIR", "StartTransaction");
    expect(idTagStatus(start)).toBe("Accepted");
    expect(start.transactionId).toBeTypeOf("number");
    expect(upstream.calls).toHaveLength(1);
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "Accepted",
      cached: true,
      availabilityRefusal: false,
      replyStatus: "Accepted",
    });
  });

  it("still refuses on a cached Blocked while the upstream is down", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Blocked", true, "not-in-list"));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-CACHED-BLOCK"))).toBe("Blocked");
    upstream.behaviour = OUTAGE;

    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-CACHED-BLOCK"))).toBe("Blocked");
    expect(upstream.calls).toHaveLength(1);
    // Same wire status as an availability refusal, different meaning —
    // this one is a real access decision, and the flag says so.
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "Blocked",
      reason: "not-in-list",
      cached: true,
      availabilityRefusal: false,
    });
  });

  it("stays in shadow mode when the upstream is down and enforcement was last known off", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Blocked", false, "not-in-list"));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, false);
    expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: false });

    upstream.behaviour = OUTAGE;
    const reply = await sendAuthFrame(d, ws, "TAG-F21");

    // The gate is not armed, so there is nothing to fail closed.
    expect(idTagStatus(reply)).toBe("Accepted");
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "upstream_error",
      mode: "shadow",
      availabilityRefusal: false,
      replyStatus: "Accepted",
    });
  });

  it("stays in shadow mode when enforcement has never been observed", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    installAuthorizeUpstream(env, OUTAGE);
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    // A charger that has never had a successful lookup. Refusing here
    // would mean an installation that never enforced starts refusing
    // drivers the first time the API blips.
    expect(enforceMemo(state)).toBeUndefined();
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-VIRGIN"))).toBe("Accepted");
    expect(lastAuthorizeLog()).toMatchObject({
      verdict: "upstream_error",
      mode: "shadow",
      availabilityRefusal: false,
    });
    expect(enforceMemo(state)).toBeUndefined();
  });

  it("refuses a StartTransaction but still returns a transactionId", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, true);
    upstream.behaviour = OUTAGE;

    const reply = await sendAuthFrame(d, ws, "TAG-F21", "StartTransaction");

    expect(idTagStatus(reply)).toBe("Blocked");
    // OCPP 1.6 §6.6 — the charger needs the id even on a refused start,
    // otherwise it has no handle for the StopTransaction it will send.
    expect(reply.transactionId).toBeTypeOf("number");
    expect(lastAuthorizeLog()).toMatchObject({ availabilityRefusal: true, replyStatus: "Blocked" });
  });

  it("remembers enforcement across a DO eviction", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));

    const instanceA = makeDo(state, env);
    const ws = await connect(instanceA, state);
    await armAndForget(instanceA, ws, state, true);

    // Hibernation wake-up: fresh instance, nothing in memory. If the
    // memo were an instance field the gate would silently fail open
    // here — the same class of bug P4.16 and P4.18 already fixed.
    upstream.behaviour = OUTAGE;
    const instanceB = makeDo(state, env);
    const reply = await sendAuthFrame(instanceB, ws, "TAG-F21");

    expect(idTagStatus(reply)).toBe("Blocked");
    expect(lastAuthorizeLog()).toMatchObject({ availabilityRefusal: true });
  });

  it("keeps the memo when /invalidate-authorize clears the whole cache", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await sendAuthFrame(d, ws, "TAG-A");
    await sendAuthFrame(d, ws, "TAG-B");

    // { all: true } is what an operator calls when flipping
    // enforceAuthorize. It must not also erase the record that the gate
    // is armed, or the flip would leave the DO failing open.
    const res = (await d.fetch(invalidateRequest({ all: true }))) as unknown as FakeResponse;
    expect(await res.json()).toEqual({ ok: true, scope: "all", cleared: 2 });
    expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: true });

    upstream.behaviour = OUTAGE;
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-A"))).toBe("Blocked");
  });

  it("follows the memo down when the operator disarms the gate", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, true);
    expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: true });

    // Operator turns enforcement off; the next successful lookup is the
    // only channel that can tell the gateway.
    upstream.behaviour = verdict("Accepted", false);
    await armAndForget(d, ws, state, false);
    expect(enforceMemo(state)).toMatchObject({ enforceAuthorize: false });

    upstream.behaviour = OUTAGE;
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-F21"))).toBe("Accepted");
    expect(lastAuthorizeLog()).toMatchObject({ availabilityRefusal: false });
  });

  it("refuses across an expired cache entry rather than serving it stale", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-08-02T10:00:00.000Z");
    vi.setSystemTime(t0);

    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-EXPIRED"))).toBe("Accepted");

    // One ms past the TTL with the API dark. Expired is a miss, and a
    // miss on an armed gate refuses — we do not serve
    // stale-while-error on an access-control decision.
    vi.setSystemTime(t0 + AUTHORIZE_CACHE_TTL_MS + 1);
    upstream.behaviour = OUTAGE;

    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-EXPIRED"))).toBe("Blocked");
    expect(upstream.calls).toHaveLength(2);
    expect(lastAuthorizeLog()).toMatchObject({ availabilityRefusal: true, cached: false });
  });

  it("refuses on a non-200 upstream too, not just a thrown binding", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, true);

    // A 500 from the API Worker (Postgres unreachable, say) is the same
    // availability failure as the binding throwing.
    upstream.behaviour = { kind: "status", status: 500 };
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-F21"))).toBe("Blocked");
    expect(lastAuthorizeLog()).toMatchObject({ availabilityRefusal: true });
  });

  it("recovers immediately once the upstream comes back", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, true);
    upstream.behaviour = OUTAGE;
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-F21"))).toBe("Blocked");

    // Nothing latched: the refusal was not cached, so the very next
    // frame is answered by the API again.
    upstream.behaviour = verdict("Accepted", true);
    expect(idTagStatus(await sendAuthFrame(d, ws, "TAG-F21"))).toBe("Accepted");
    expect(lastAuthorizeLog()).toMatchObject({ availabilityRefusal: false, cached: false });
  });

  it("leaves non-authorize actions alone during an outage", async () => {
    const state = new FakeState();
    const { env } = makeEnv();
    const upstream = installAuthorizeUpstream(env, verdict("Accepted", true));
    const d = makeDo(state, env);
    const ws = await connect(d, state);

    await armAndForget(d, ws, state, true);
    upstream.behaviour = OUTAGE;

    // Failing closed is an *access* posture. A charger must still be
    // able to boot, heartbeat and report status while the API is down,
    // or we lose the telemetry that shows us the outage.
    await d.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify([2, "boot-f21", "BootNotification", { chargePointModel: "m" }]),
    );
    const boot = JSON.parse(ws.sent[ws.sent.length - 1]!) as [number, string, Record<string, unknown>];
    expect(boot[2].status).toBe("Accepted");

    await d.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify([2, "stop-f21", "StopTransaction", { idTag: "TAG-F21", transactionId: 9 }]),
    );
    const stop = JSON.parse(ws.sent[ws.sent.length - 1]!) as [number, string, Record<string, unknown>];
    expect(idTagStatus(stop[2])).toBe("Accepted");
  });
});

// ─────────────────────────────────────────────────────────────────────
// ADR 0039 amendment / ADR 0040 — retention class per OCPP action.
//
// Guards billing evidence. A blanket `raw_protocol` stamp combined with
// ADR 0037's 7-day R2 expiry and ADR 0039's 7-day partition drop would
// have deleted OCMF-bearing MeterValues and StopTransaction from BOTH
// stores on a timer, while ADR 0031 §15 settles metering disputes on
// exactly those logs.
// ─────────────────────────────────────────────────────────────────────
describe("retentionClassFor", () => {
  it("classifies heartbeats as disposable", () => {
    expect(retentionClassFor("Heartbeat")).toBe("raw_protocol");
  });

  it("classifies billing-bearing frames as financial", () => {
    // MeterValues carries the OCMF signed meter reading; StopTransaction
    // is the charger's own record of delivered energy.
    expect(retentionClassFor("MeterValues")).toBe("financial");
    expect(retentionClassFor("StartTransaction")).toBe("financial");
    expect(retentionClassFor("StopTransaction")).toBe("financial");
  });

  it("classifies diagnostic frames as operational", () => {
    expect(retentionClassFor("StatusNotification")).toBe("operational");
    expect(retentionClassFor("BootNotification")).toBe("operational");
    expect(retentionClassFor("Authorize")).toBe("operational");
  });

  it("defaults an unknown action to operational, never raw_protocol", () => {
    // Fail long, not short: an untriaged frame type is more likely to be
    // something new that matters than something disposable.
    expect(retentionClassFor("SomeVendorExtension")).toBe("operational");
    expect(retentionClassFor("")).toBe("operational");
  });

  it("only Heartbeat is ever disposable", () => {
    const actions = [
      "MeterValues", "StartTransaction", "StopTransaction",
      "StatusNotification", "BootNotification", "Authorize",
      "DataTransfer", "DiagnosticsStatusNotification",
    ];
    for (const a of actions) {
      expect(retentionClassFor(a)).not.toBe("raw_protocol");
    }
  });
});
