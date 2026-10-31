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
 * Also owns durable stop dispatch, independent liveness and opt-in latest-value publication.
 * Standard smart-charging commands remain outside this mode.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import { claim, closeAffectsDevice, standing, SUPERSEDED_CLOSE_CODE, type EngineContext, type Owner, type SocketTag } from "./connection-ownership";
import { callEngine, callEngineBatch, publishLive, INTERNAL_ERROR, type CallAnswer, type EngineCallBody, type EngineEnv } from "./engine-client";
import type { LiveDevice, LiveConnector } from "@engine/live-projection";
import { readingsFrom } from "@engine/meter-readings";
import { bypassesIngest, DEFAULT_LIVENESS_CONFIG, frameCapDecision, recordFrame, resolveHeartbeatIntervalSeconds, type FrameCapState, type LivenessState } from "./heartbeat-fastpath";
import { parseFrame, serializeCall, serializeCallResult } from "./ocpp-frame";
import { Outbox, type OutboxEntry } from "./outbox";
import { StopCommandStore, validateStopInput, type StopCommandInput, type StopCommandOutcome, type StopCommandResult, type StopRecord, type StopVia } from "./stop-command";
import { isExercised, validatePayload } from "@engine/protocol";

export type { StopCommandOutcome, StopCommandResult, StopCommandInput } from "./stop-command";

const OWNER_KEY = "engine:owner";
const OPS_KEY = "ops";
type OpsState = { liveness: LivenessState; cap: FrameCapState; heartbeatIntervalMs?: number };
type LivePending = { value: LiveDevice; due: number | null; failures?: number };
const LIVE_KEY = "engine:live-projection";
const LIVE_DELAY_MS = 1_000;

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

type Env = EngineEnv & { OCPP_HEARTBEAT_INTERVAL_SECONDS?: string; OCPP_REALTIME_ENABLED?: string };
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

type LiveStop = { uniqueId: string; promise: Promise<StopCommandResult>; resolve: (r: StopCommandResult) => void; timer: ReturnType<typeof setTimeout> | undefined };

export class EngineMode {
  /**
   * Stop attempts awaiting a reply IN THIS INSTANCE, by attempt id. A convenience only (it lets the request that is
   * waiting resolve at once, and a repeated delivery join it): the durable record in `stops` is the truth and is always
   * written BEFORE a waiter is resolved. After eviction this map is empty and the record alone describes the attempt.
   */
  private readonly live = new Map<string, LiveStop>();
  private readonly outbox: Outbox;
  private readonly stops: StopCommandStore;
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly negotiate: (offer: string | null) => { ok: true; selected: string | null } | { ok: false },
    private readonly now: () => number = Date.now,
  ) {
    this.outbox = new Outbox(state.storage as never);
    this.stops = new StopCommandStore(state.storage as never);
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
    await this.recordActivity("Connected");
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
    if (frame.kind === "call_result" || frame.kind === "call_error") {
      await this.recordActivity("CommandReply");
      const outcome: StopCommandOutcome = frame.kind === "call_result" && (frame.payload as { status?: unknown })?.status === "Accepted" ? "accepted" : "rejected";
      await this.commandReply(tag, frame.uniqueId, outcome);
      return;
    }
    if (frame.kind !== "call") return;

    const nowMs = this.now();
    // Heartbeat fast path (same accounting as the legacy path: one read, one write, no outbound call).
    const { live, cap } = await this.recordActivity(frame.action);

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
      if (this.env.OCPP_REALTIME_ENABLED === "true") {
        const payload = valid.value as { connectorId: number; status?: string; errorCode?: string; timestamp?: string };
        if (frame.action === "StatusNotification") await this.stageLive(payload.connectorId, { status: payload.status, errorCode: payload.errorCode, reportedAt: payload.timestamp ?? null });
        else {
          const rows = readingsFrom(valid.value as Parameters<typeof readingsFrom>[0]);
          const latest = rows.reduce<(typeof rows)[number] | null>((a, b) => !a || b.sampledAt > a.sampledAt ? b : a, null);
          if (latest) await this.stageLive(payload.connectorId, { powerW: latest.powerW, energyWh: latest.energyWh });
        }
      }
      // Shedding is a COST control and is never applied to MeterValues of a transaction (required evidence).
      if (cap.shedIngest && frame.action === "StatusNotification") {
        ws.send(serializeCallResult(frame.uniqueId, {}));
        return;
      }
      const body = JSON.stringify({ ctx, messageId: frame.uniqueId, action: frame.action, payload: frame.payload, receivedAt: new Date(nowMs).toISOString() });
      const kind = frame.action === "MeterValues" ? "meter" : "status";
      const due = dueAt(kind, nowMs, ctx.deviceId);
      const r = await this.outbox.enqueue(kind, body, nowMs, due);
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
    if (frame.action === "BootNotification" && answer.kind === "result" && answer.payload.status === "Accepted" && standing(await this.owner(), tag) === "current") {
      const interval = answer.payload.interval;
      if (typeof interval === "number" && Number.isInteger(interval) && interval >= 60 && interval <= 86400) {
        const ops = await this.state.storage.get<OpsState>(OPS_KEY);
        if (ops) {
          const next = { ...ops, heartbeatIntervalMs: interval * 1000 };
          await this.state.storage.put(OPS_KEY, next);
          await this.armAlarmAt(this.livenessDeadline(next));
        }
      }
    }
    ws.send(answer.kind === "result" ? serializeCallResult(frame.uniqueId, answer.payload) : errFrame(frame.uniqueId, answer.code, answer.description));
  }

  private livenessDeadline(ops: OpsState): number {
    return ops.liveness.lastSeenAt + (ops.heartbeatIntervalMs ?? resolveHeartbeatIntervalSeconds(this.env.OCPP_HEARTBEAT_INTERVAL_SECONDS).seconds * 1000) * DEFAULT_LIVENESS_CONFIG.offlineAfterMissedIntervals;
  }

  private async recordActivity(action: string) {
    const stored = await this.state.storage.get<OpsState>(OPS_KEY);
    const heartbeatIntervalMs = stored?.heartbeatIntervalMs ?? resolveHeartbeatIntervalSeconds(this.env.OCPP_HEARTBEAT_INTERVAL_SECONDS).seconds * 1000;
    const live = recordFrame(stored?.liveness ?? null, action, this.now(), { ...DEFAULT_LIVENESS_CONFIG, idleHeartbeatIntervalMs: heartbeatIntervalMs });
    const cap = frameCapDecision(stored?.cap ?? null, action, this.now());
    const next: OpsState = { liveness: live.next, cap: cap.next, heartbeatIntervalMs };
    await this.state.storage.put(OPS_KEY, next);
    await this.armAlarmAt(this.livenessDeadline(next));
    await this.stageLive();
    return { live, cap };
  }

  /** Connection liveness is separate from the last connector status; neither invents a transaction stop. */
  private async markOffline(): Promise<void> {
    const ops = await this.state.storage.get<OpsState>(OPS_KEY);
    if (ops?.liveness.online) {
      await this.state.storage.put(OPS_KEY, { ...ops, liveness: { ...ops.liveness, online: false, onlineSince: this.now() } });
      await this.stageLive();
    }
  }

  private async stageLive(connectorId?: number, patch?: LiveConnector): Promise<void> {
    if (this.env.OCPP_REALTIME_ENABLED !== "true") return;
    const owner = await this.owner();
    const ops = await this.state.storage.get<OpsState>(OPS_KEY);
    if (!owner || !ops) return;
    const held = await this.state.storage.get<LivePending>(LIVE_KEY);
    const compatible = held?.value.placementId === owner.context.placementId && held.value.generation === owner.generation;
    const connectors = compatible ? { ...held.value.connectors } : {};
    if (connectorId !== undefined && connectorId >= 0 && connectorId <= 65535 && patch && (connectors[String(connectorId)] || Object.keys(connectors).length < 64)) {
      const previous = connectors[String(connectorId)];
      if (!previous || !previous.reportedAt || !patch.reportedAt || Date.parse(patch.reportedAt) >= Date.parse(previous.reportedAt)) connectors[String(connectorId)] = { ...previous, ...patch };
    }
    const value: LiveDevice = { schema: 1, orgId: owner.context.orgId, installationId: owner.context.installationId, deviceId: owner.context.deviceId, placementId: owner.context.placementId,
      generation: owner.generation, revision: (held?.value.revision ?? 0) + 1, observedAt: ops.liveness.lastSeenAt, online: ops.liveness.online, onlineUntil: this.livenessDeadline(ops), connectors };
    const due = held?.due ?? this.now() + LIVE_DELAY_MS;
    await this.state.storage.put(LIVE_KEY, { value, due, failures: held?.failures ?? 0 } satisfies LivePending);
    await this.armAlarmAt(due);
  }

  private async flushLive(): Promise<void> {
    if (this.env.OCPP_REALTIME_ENABLED !== "true") return;
    const pending = await this.state.storage.get<LivePending>(LIVE_KEY);
    if (!pending || pending.due === null) return;
    if (pending.due > this.now()) { await this.armAlarmAt(pending.due); return; }
    const ok = await publishLive(this.env, pending.value);
    const latest = await this.state.storage.get<LivePending>(LIVE_KEY);
    if (!latest) return;
    const unchanged = latest.value.revision === pending.value.revision;
    const failures = ok ? 0 : (latest.failures ?? 0) + 1;
    const due = ok && unchanged ? null : this.now() + (ok ? LIVE_DELAY_MS : Math.min(300_000, 30_000 * 2 ** Math.min(failures - 1, 4)));
    await this.state.storage.put(LIVE_KEY, { ...latest, due, failures });
    if (due !== null) await this.armAlarmAt(due);
  }

  /**
   * Sends RemoteStopTransaction to the CURRENT owning socket, once per ATTEMPT, and reports what the charger answered.
   *
   * Idempotent on `attemptId`: the intent is persisted before the frame is sent; a repeated delivery never sends again
   * (retained outcome, joining the live wait, or an honest "timeout" while the attempt is undecided). A reused attempt id
   * with a different body is a conflict. No current socket under the stated placement => "offline", nothing sent and
   * nothing recorded. The answer is an outcome of the COMMAND only; the session is stopped when the engine records its
   * StopTransaction. `reason` is diagnostic only.
   */
  async requestStop(input: StopCommandInput, timeoutMs = STOP_COMMAND_TIMEOUT_MS): Promise<StopCommandResult> {
    const nowMs = this.now();
    const bad = validateStopInput(input, nowMs);
    if (bad) return { outcome: "unavailable", reason: bad };

    const existing = await this.stops.get(input.attemptId);
    if (existing) return this.redeliver(existing, input, nowMs);
    // A new attempt that arrives after its own deadline is refused unsent: the lifecycle side has moved on.
    if (nowMs >= input.deadlineMs) return { outcome: "unavailable", reason: "expired" };

    const owner = await this.owner();
    // The placement fence: a command reserved under one placement is never sent to a socket owned under another.
    const socket = owner && owner.context.placementId === input.placementId ? this.state.getWebSockets().find((s) => standing(owner, readTag(s)) === "current") : undefined;
    if (!owner || !socket) return { outcome: "offline" };

    const uniqueId = crypto.randomUUID();
    const expiresAt = Math.min(input.deadlineMs, nowMs + timeoutMs);
    const rec: StopRecord = {
      attemptId: input.attemptId, requestId: input.requestId, placementId: input.placementId, transactionNo: input.transactionNo,
      generation: owner.generation, uniqueId, createdAt: nowMs, deadlineMs: input.deadlineMs, expiresAt, phase: "pending",
    };
    // Persist the intent BEFORE anything reaches the wire; refuse (back-pressure) rather than send unrecorded.
    if ((await this.stops.admit(rec, nowMs)) === "capacity") return { outcome: "unavailable", reason: "capacity" };
    await this.armAlarmAt(expiresAt); // crash recovery: the expiry fires without any further frame

    let resolve!: (r: StopCommandResult) => void;
    const promise = new Promise<StopCommandResult>((res) => { resolve = res; });
    const entry: LiveStop = { uniqueId, promise, resolve, timer: undefined };
    this.live.set(input.attemptId, entry);
    entry.timer = setTimeout(() => { this.finishStop(input.attemptId, "timeout", "deadline").catch(() => this.settle(input.attemptId, { outcome: "timeout", reason: "not_recorded" })); }, Math.max(1, expiresAt - nowMs));
    try {
      socket.send(serializeCall(uniqueId, "RemoteStopTransaction", { transactionId: input.transactionNo }));
    } catch {
      const r = await this.finishStop(input.attemptId, "unavailable", "send_failed");
      return { outcome: r.outcome, reason: "send_failed" };
    }
    return promise;
  }

  /** A second delivery of an attempt this device already recorded. Never sends. */
  private async redeliver(rec: StopRecord, input: StopCommandInput, nowMs: number): Promise<StopCommandResult> {
    if (rec.requestId !== input.requestId || rec.placementId !== input.placementId || rec.transactionNo !== input.transactionNo) return { outcome: "unavailable", reason: "conflict" };
    if (rec.phase === "done") return { outcome: rec.outcome ?? "timeout", reason: "replayed" };
    const live = this.live.get(rec.attemptId);
    if (live) return live.promise; // the original request is still waiting in this instance: share its answer
    // No waiter here (instance recreated, or the original request is gone): the command may or may not have reached the
    // charger. Do not guess and do not replay. Past its expiry it is final; before, the alarm or a late reply finishes it.
    if (nowMs >= rec.expiresAt) {
      const done = await this.stops.resolve(rec.attemptId, "timeout", "deadline", nowMs);
      return { outcome: done?.outcome ?? "timeout", reason: "uncertain" };
    }
    return { outcome: "timeout", reason: "uncertain" };
  }

  /** Durable first, waiter second. Idempotent: the first resolution of an attempt wins and is what everyone sees. */
  private async finishStop(attemptId: string, outcome: StopCommandOutcome, via: StopVia): Promise<StopCommandResult> {
    const rec = await this.stops.resolve(attemptId, outcome, via, this.now());
    const result: StopCommandResult = { outcome: rec?.outcome ?? outcome };
    this.settle(attemptId, result);
    return result;
  }

  private settle(attemptId: string, result: StopCommandResult): void {
    const l = this.live.get(attemptId);
    if (!l) return;
    this.live.delete(attemptId);
    if (l.timer !== undefined) clearTimeout(l.timer);
    l.resolve(result);
  }

  /**
   * A CallResult/CallError from a CURRENT socket. It completes an attempt only if the attempt is still pending, was sent
   * on THIS socket generation and has not expired; anything else (late, duplicate, unknown id, replacement socket) is
   * ignored and never mistaken for an engine frame.
   */
  private async commandReply(tag: SocketTag, uniqueId: string, outcome: StopCommandOutcome): Promise<void> {
    const mine = [...this.live.entries()].find(([, v]) => v.uniqueId === uniqueId)?.[0];
    const rec = mine ? await this.stops.get(mine) : await this.stops.findByUniqueId(uniqueId);
    if (!rec || rec.phase !== "pending" || rec.uniqueId !== uniqueId || rec.generation !== tag.generation) return;
    if (this.now() >= rec.expiresAt) {
      await this.finishStop(rec.attemptId, "timeout", "deadline"); // the local deadline wins over a reply that arrived after it
      return;
    }
    await this.finishStop(rec.attemptId, outcome, "response");
  }

  /** Close/error of an engine socket. Returns true when device-level cleanup should run. */
  async closed(ws: WebSocket, tag: SocketTag): Promise<boolean> {
    const owner = await this.owner();
    const others = this.state.getWebSockets().filter((s) => s !== ws && standing(owner, readTag(s)) === "current").length;
    if (!closeAffectsDevice(owner, tag, others)) return false;
    await this.markOffline();
    // Commands sent on this generation can never be answered now. Uncertain (they may have arrived), so "timeout".
    for (const r of await this.stops.abandonGeneration(tag.generation, this.now())) this.settle(r.attemptId, { outcome: "timeout", reason: "disconnected" });
    await this.state.storage.put("lastClosedAt", this.now());
    return true;
  }

  /**
   * The ONE alarm handler of an engine object: resolves stop attempts whose expiry passed (durably, without any incoming
   * frame), delivers due outbox entries, then re-arms for the earliest of what remains. `armAlarmAt` only ever moves an
   * existing alarm earlier, so command expiry and outbox delivery coexist in either order.
   */
  async onAlarm(): Promise<void> {
    if (!await this.owner()) return; // legacy/pending identities do not acquire engine liveness work
    const ops = await this.state.storage.get<OpsState>(OPS_KEY);
    if (ops?.liveness.online && this.livenessDeadline(ops) <= this.now()) await this.markOffline();
    for (const r of await this.stops.expireDue(this.now())) this.settle(r.attemptId, { outcome: "timeout", reason: "deadline" });
    await this.flushLive();
    await this.drainOutbox();
    const next = await this.stops.nextExpiry();
    if (next !== null) await this.armAlarmAt(next);
    // Re-read after external I/O: a frame may have extended liveness while the batch was committing.
    const latest = await this.state.storage.get<OpsState>(OPS_KEY);
    if (latest?.liveness.online) await this.armAlarmAt(this.livenessDeadline(latest));
  }

  get stopsForTests(): StopCommandStore {
    return this.stops;
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
    const batch: { entry: OutboxEntry; body: EngineCallBody }[] = [];
    const scope = (body: EngineCallBody) => JSON.stringify([body.ctx.orgId, body.ctx.installationId, body.ctx.deviceId, body.ctx.placementId, body.ctx.identityString, body.ctx.chargePointId, body.ctx.credentialMode, body.ctx.credentialEpoch]);
    for (const entry of due) {
      try {
        const body = JSON.parse(entry.body) as EngineCallBody;
        if (!body?.ctx || !["MeterValues", "StatusNotification"].includes(body.action)) throw new Error("invalid entry");
        // Old placement evidence must not be mixed into the current placement's batch.
        if (batch.length && scope(body) !== scope(batch[0]!.body)) break;
        batch.push({ entry, body });
      } catch {
        results.push({ entry, verdict: "poison", error: "invalid stored entry" });
      }
    }
    if (batch.length) {
      const outcomes = await callEngineBatch(this.env, batch.map(item => item.body));
      for (const [i, out] of outcomes.entries()) {
        const entry = batch[i]!.entry;
        if (out.kind === "answer" && out.answer.kind === "result") results.push({ entry, verdict: "ack" });
        else if (out.kind === "rejected") results.push({ entry, verdict: "poison", error: `rejected ${out.status}` });
        else if (out.kind === "answer" && out.answer.kind === "error" && out.answer.code !== "InternalError") results.push({ entry, verdict: "poison", error: out.answer.code });
        else results.push({ entry, verdict: "retry", error: "unavailable" });
      }
    }
    await this.outbox.settle(results, nowMs);
    await this.armAlarm();
  }

  get outboxForTests(): Outbox {
    return this.outbox;
  }

  /** Internal operator repair only. Scope is checked against the durable owner; never sends a charger command. */
  async repairOutbox(input: { orgId: string; deviceId: string; op: "inspect" | "replay"; after?: number; ids?: number[]; requestId?: string; actor?: string }): Promise<unknown> {
    const owner = await this.owner();
    if (!owner || input.orgId !== owner.context.orgId || input.deviceId !== owner.context.deviceId) return { error: "scope" };
    if (input.op === "inspect") {
      if (input.after !== undefined && (!Number.isSafeInteger(input.after) || input.after < 0)) return { error: "input" };
      return { ...await this.outbox.stats(), ...await this.outbox.inspect(input.after) };
    }
    if (input.op !== "replay" || !Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 20 || input.ids.some(n => !Number.isSafeInteger(n) || n < 1)
      || typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId)
      || typeof input.actor !== "string" || input.actor.length < 1 || input.actor.length > 160) return { error: "input" };
    // Commit selected replay metadata together, then arm delivery. No required evidence is removed by repair.
    const count = await this.state.storage.transaction(tx => new Outbox(tx as never).replayDead(this.now(), input.ids!, { requestId: input.requestId!, actor: input.actor! }));
    await this.armAlarm();
    return { replayed: count };
  }
}
