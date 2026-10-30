/**
 * Engine mode for the per-device Durable Object (Checkpoints A/B).
 *
 * The legacy identity path stays as it is; a socket is in ENGINE mode exactly
 * when it carries a `SocketTag` attachment (set only by `upgrade`, after the
 * engine admitted the connection). That keeps the two paths separable and the
 * legacy tests meaningful.
 *
 * What lives here:
 *   - ownership: every admitted upgrade claims a new generation and closes the
 *     older sockets; stale sockets are ignored and cannot disturb the owner;
 *   - the sync lane (Boot/Authorize/Start/Stop): reply only after the engine
 *     commits; outage -> CALLERROR InternalError;
 *   - the async lane (MeterValues/Status): validate, store in the bounded
 *     durable outbox with a bounded flush delay, reply `{}`;
 *   - Heartbeat fast path: answered locally, one storage read/write (existing
 *     `ops` key), no service-binding call and no database wake-up.
 *
 * Not in this mode (explicit gaps, see the handoff): outbound command dispatch,
 * liveness transition events, standard smart-charging commands.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import { claim, closeAffectsDevice, standing, SUPERSEDED_CLOSE_CODE, type EngineContext, type Owner, type SocketTag } from "./connection-ownership";
import { callEngine, INTERNAL_ERROR, type CallAnswer, type EngineEnv } from "./engine-client";
import { bypassesIngest, frameCapDecision, recordFrame, type FrameCapState, type LivenessState } from "./heartbeat-fastpath";
import { parseFrame, serializeCall, serializeCallResult } from "./ocpp-frame";
import { Outbox, type OutboxEntry } from "./outbox";
import { isExercised, validatePayload } from "@engine/protocol";

const OWNER_KEY = "engine:owner";
const OPS_KEY = "ops";
type OpsState = { liveness: LivenessState; cap: FrameCapState };

/**
 * Longest a frame may wait in the outbox before first delivery, by kind. Explicit, not incidental.
 *  - status: short, so the shared view shows a state change within seconds.
 *  - meter: long. Readings typically arrive minutes apart (commonly 300 s), so a short window
 *    cannot coalesce them and every reading would cost its own database request. Billing does NOT
 *    wait on this: costing uses the start/stop registers committed synchronously. A crash loses
 *    nothing (the outbox is durable); the only cost of the delay is that live power lags.
 */
export const STATUS_FLUSH_DELAY_MS = 5_000;
export const METER_FLUSH_DELAY_MS = 15 * 60_000;
export const ASYNC_FLUSH_DELAY_MS = METER_FLUSH_DELAY_MS;
/** Per-device spread so chargers sharing a boundary do not all hit the backend in the same second. */
export const FLUSH_JITTER_MS = 60_000;

/**
 * When a frame becomes due. Status: a short fixed delay. Meter: the NEXT wall-clock window boundary
 * (plus a small deterministic per-device offset), NOT "enqueue + delay". Readings that arrive minutes
 * apart then share one flush per window instead of each owning its own alarm, which is the whole
 * point of batching. Maximum wait is therefore one window plus the jitter.
 */
export function dueAt(kind: "meter" | "status", nowMs: number, deviceId: string): number {
  if (kind === "status") return nowMs + STATUS_FLUSH_DELAY_MS;
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) h = (h * 31 + deviceId.charCodeAt(i)) >>> 0;
  return (Math.floor(nowMs / METER_FLUSH_DELAY_MS) + 1) * METER_FLUSH_DELAY_MS + (h % FLUSH_JITTER_MS);
}
export const ENGINE_CTX_HEADER = "x-straumvakt-engine-ctx";

type Env = EngineEnv & { OCPP_HEARTBEAT_INTERVAL_SECONDS?: string };
type SendableSocket = WebSocket & { serializeAttachment(v: unknown): void; deserializeAttachment(): unknown };

export function readTag(ws: WebSocket): SocketTag | null {
  try {
    const v = (ws as SendableSocket).deserializeAttachment() as Partial<SocketTag> | null;
    return v && typeof v.generation === "number" && typeof v.placementId === "string" ? { generation: v.generation, placementId: v.placementId } : null;
  } catch {
    return null;
  }
}

const errFrame = (uniqueId: string, code: string, description: string) => JSON.stringify([4, uniqueId, code, description, {}]);

/** How long a RemoteStopTransaction may wait for the charger's CallResult before it is reported as a timeout. */
export const STOP_COMMAND_TIMEOUT_MS = 10_000;
export type StopCommandOutcome = "accepted" | "rejected" | "offline" | "timeout" | "unavailable";

export class EngineMode {
  /** In-flight stop commands by OCPP unique id. In memory on purpose: the request that awaits it keeps the object alive. */
  private readonly waiters = new Map<string, (o: StopCommandOutcome) => void>();
  private readonly outbox: Outbox;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly negotiate: (offer: string | null) => { ok: true; selected: string | null } | { ok: false },
    private readonly now: () => number = Date.now,
  ) {
    this.outbox = new Outbox(state.storage as never);
  }

  /**
   * In-memory copy of the owner. Safe because there is exactly one Durable Object
   * instance per device (single writer) and `upgrade` is the only place that changes
   * it; after eviction/hibernation the first frame reloads it with ONE storage read.
   */
  private ownerCache: Owner | null = null;

  private async owner(): Promise<Owner | null> {
    if (this.ownerCache) return this.ownerCache;
    this.ownerCache = (await this.state.storage.get<Owner>(OWNER_KEY)) ?? null;
    return this.ownerCache;
  }

  async upgrade(request: Request): Promise<Response> {
    const raw = request.headers.get(ENGINE_CTX_HEADER);
    let ctx: EngineContext;
    try {
      ctx = JSON.parse(raw ?? "") as EngineContext;
      if (!ctx.deviceId || !ctx.placementId || !ctx.orgId) throw new Error("incomplete");
    } catch {
      return new Response("bad engine context", { status: 500 });
    }
    const negotiated = this.negotiate(request.headers.get("sec-websocket-protocol") ?? request.headers.get("x-straumvakt-ws-protocol"));
    if (!negotiated.ok) return new Response("unsupported websocket subprotocol", { status: 400 });

    const { owner, tag } = claim(await this.owner(), ctx);
    // Persist the new owner BEFORE accepting, so a crash between the two leaves a
    // higher generation with no socket (harmless), never a socket with no owner.
    await this.state.storage.put(OWNER_KEY, owner);
    this.ownerCache = owner;
    for (const old of this.state.getWebSockets()) {
      try {
        old.close(SUPERSEDED_CLOSE_CODE, "superseded");
      } catch {
        /* already closed */
      }
    }
    const pair = new WebSocketPair();
    const [clientWs, serverWs] = [pair[0], pair[1]];
    (serverWs as unknown as SendableSocket).serializeAttachment(tag);
    this.state.acceptWebSocket(serverWs);
    return new Response(null, { status: 101, webSocket: clientWs, ...(negotiated.selected ? { headers: { "Sec-WebSocket-Protocol": negotiated.selected } } : {}) } as ResponseInit);
  }

  async message(ws: WebSocket, tag: SocketTag, message: string | ArrayBuffer): Promise<void> {
    const owner = await this.owner();
    if (standing(owner, tag) !== "current") {
      // A stale socket gets no processing and no reply: whatever it says belongs to a placement/generation that no longer owns the device.
      try {
        ws.close(SUPERSEDED_CLOSE_CODE, "superseded");
      } catch {
        /* closed */
      }
      return;
    }
    const ctx = owner!.context;
    if (typeof message !== "string") {
      ws.send(errFrame("malformed", "ProtocolError", "binary frames not supported"));
      return;
    }
    const parsed = parseFrame(message);
    if (!parsed.ok) {
      ws.send(errFrame("unknown", "FormationViolation", parsed.error));
      return;
    }
    const frame = parsed.frame;
    // CallResult / CallError answer the RemoteStopTransaction we sent (the only command in engine mode).
    // `Accepted` means the charger will TRY to stop; it is never treated as a stopped session.
    if (frame.kind === "call_result") {
      const done = this.waiters.get(frame.uniqueId);
      if (done) {
        this.waiters.delete(frame.uniqueId);
        done((frame.payload as { status?: unknown })?.status === "Accepted" ? "accepted" : "rejected");
      }
      return;
    }
    if (frame.kind === "call_error") {
      const done = this.waiters.get(frame.uniqueId);
      if (done) {
        this.waiters.delete(frame.uniqueId);
        done("rejected");
      }
      return;
    }
    if (frame.kind !== "call") return;

    const nowMs = this.now();
    // Heartbeat fast path (same accounting as the legacy path: one read, one write, no outbound call).
    const stored = (await this.state.storage.get<OpsState>(OPS_KEY)) ?? null;
    const live = recordFrame(stored?.liveness ?? null, frame.action, nowMs);
    const cap = frameCapDecision(stored?.cap ?? null, frame.action, nowMs);
    await this.state.storage.put(OPS_KEY, { liveness: live.next, cap: cap.next } satisfies OpsState);

    if (frame.action === "Heartbeat") {
      ws.send(serializeCallResult(frame.uniqueId, { currentTime: new Date(nowMs).toISOString() }));
      return;
    }
    if (bypassesIngest(frame.action) && !live.emitTransition && !live.flushRollup) {
      ws.send(serializeCallResult(frame.uniqueId, {}));
      return;
    }

    if (!isExercised(frame.action)) {
      ws.send(errFrame(frame.uniqueId, "NotImplemented", `${frame.action} is not supported`));
      return;
    }
    const valid = validatePayload(frame.action, frame.payload);
    if (!valid.ok) {
      ws.send(errFrame(frame.uniqueId, valid.error.code, valid.error.description));
      return;
    }

    if (frame.action === "MeterValues" || frame.action === "StatusNotification") {
      // Shedding is a COST control and is never applied to MeterValues of a transaction (required evidence).
      if (cap.shedIngest && frame.action === "StatusNotification") {
        ws.send(serializeCallResult(frame.uniqueId, {}));
        return;
      }
      const body = JSON.stringify({ ctx, messageId: frame.uniqueId, action: frame.action, payload: frame.payload, receivedAt: new Date(nowMs).toISOString() });
      const kind = frame.action === "MeterValues" ? "meter" : "status";
      const due = dueAt(kind, nowMs, ctx.deviceId);
      const r = await this.outbox.enqueue(kind, body, due);
      if (!r.ok) {
        // Back-pressure, never a silent drop: the charger is told to retry.
        ws.send(errFrame(frame.uniqueId, "InternalError", `backend buffer ${r.reason}`));
        return;
      }
      await this.armAlarmAt(due); // known due time: no outbox listing on the hot path
      ws.send(serializeCallResult(frame.uniqueId, {}));
      return;
    }

    // Sync lane.
    const out = await callEngine(this.env, { ctx, messageId: frame.uniqueId, action: frame.action, payload: frame.payload, receivedAt: new Date(nowMs).toISOString() });
    const answer: CallAnswer = out.kind === "answer" ? out.answer : INTERNAL_ERROR;
    ws.send(answer.kind === "result" ? serializeCallResult(frame.uniqueId, answer.payload) : errFrame(frame.uniqueId, answer.code, answer.description));
  }

  /**
   * Sends RemoteStopTransaction to the CURRENT owning socket and reports what the
   * charger answered. No current socket => "offline" and nothing is sent. The
   * answer is an outcome of the COMMAND only; the session is stopped when the
   * engine records its StopTransaction.
   */
  async requestStop(input: { transactionNo: number }, timeoutMs = STOP_COMMAND_TIMEOUT_MS): Promise<StopCommandOutcome> {
    if (!Number.isInteger(input.transactionNo) || input.transactionNo < 1 || input.transactionNo > 2_147_483_647) return "unavailable";
    const owner = await this.owner();
    const socket = owner ? this.state.getWebSockets().find((s) => standing(owner, readTag(s)) === "current") : undefined;
    if (!socket) return "offline";
    const uniqueId = crypto.randomUUID();
    const answered = new Promise<StopCommandOutcome>((resolve) => this.waiters.set(uniqueId, resolve));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<StopCommandOutcome>((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
    try {
      socket.send(serializeCall(uniqueId, "RemoteStopTransaction", { transactionId: input.transactionNo }));
    } catch {
      this.waiters.delete(uniqueId);
      if (timer !== undefined) clearTimeout(timer);
      return "unavailable";
    }
    const outcome = await Promise.race([answered, timedOut]);
    this.waiters.delete(uniqueId);
    if (timer !== undefined) clearTimeout(timer);
    return outcome;
  }

  /** Close/error of an engine socket. Returns true when device-level cleanup should run. */
  async closed(ws: WebSocket, tag: SocketTag): Promise<boolean> {
    const owner = await this.owner();
    const others = this.state.getWebSockets().filter((s) => s !== ws && standing(owner, readTag(s)) === "current").length;
    if (!closeAffectsDevice(owner, tag, others)) return false;
    await this.state.storage.put("lastClosedAt", this.now());
    return true;
  }

  private async armAlarm(): Promise<void> {
    const due = await this.outbox.nextDueAt();
    if (due === null) return;
    await this.armAlarmAt(due);
  }

  private async armAlarmAt(due: number): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    // An alarm already in the past is the one currently firing (or missed); it cannot serve a later due time.
    if (existing === null || existing <= this.now() || due < existing) await this.state.storage.setAlarm(due);
  }

  /**
   * Alarm: deliver due outbox entries to the engine. Re-arms for the next due
   * time only; there is no polling loop, and an empty outbox arms nothing.
   */
  async drainOutbox(): Promise<void> {
    const nowMs = this.now();
    const due = await this.outbox.due(nowMs);
    const results: { entry: OutboxEntry; verdict: "ack" | "retry" | "poison"; error?: string }[] = [];
    for (const entry of due) {
      const out = await callEngine(this.env, JSON.parse(entry.body));
      if (out.kind === "answer") results.push({ entry, verdict: "ack" });
      else if (out.kind === "rejected") results.push({ entry, verdict: "poison", error: `rejected ${out.status}` });
      else results.push({ entry, verdict: "retry", error: "unavailable" });
      // The engine is down: stop hammering it within this wake-up; remaining entries stay due.
      if (out.kind === "unavailable") break;
    }
    await this.outbox.settle(results, nowMs);
    await this.armAlarm();
  }

  get outboxForTests(): Outbox {
    return this.outbox;
  }
}
