/**
 * Pending mode for the Durable Object: a restricted waiting socket for a charger that is not registered yet.
 *
 * WHAT A PENDING SOCKET IS: a connection that passed the ingress guard and the per-CPO admission gate and that the engine
 * called `pending` (a genuinely unknown charge point id of an active CPO). It has no device, placement, credential mode,
 * session or cost context, and it can never obtain one: the object is keyed `pending:{cpo}:{id}`, a different object from the
 * permanent `device:{id}` object that owns registered sockets. Nothing here fabricates those ids.
 *
 * WHAT IT DOES:
 *   - BootNotification -> `Pending`, server time and a nonzero retry interval on EVERY boot, correlated to the request id.
 *     The complete payload goes to the engine for storage only under the capture budget below.
 *   - Heartbeat -> answered locally. Anything else -> CALLERROR SecurityError. No session can start here.
 *   - It never sends a request to the charger and never sends an unsolicited response.
 *
 * BOUNDS (what is enforced and where it lives):
 *   - frame size, per-socket message window: enforced here; the window rides in the socket attachment, so it survives
 *     hibernation with no storage write per message.
 *   - capture budget: after any capture ATTEMPT the next changed/invalid/re-stored body waits PENDING_CAPTURE_MIN_INTERVAL_MS
 *     (persisted). Held-back bodies still get a protocol reply; they are stored by a later boot.
 *   - registration re-check: due every PENDING_RECHECK_SECONDS; the cooldown is persisted BEFORE the engine is asked, so a failed
 *     or unavailable answer cannot be repeated by unchanged boots until PENDING_CAPTURE_MIN_INTERVAL_MS has passed.
 *   - admission lease: the first boot of each connection confirms it at the gate and then it is renewed once per re-check
 *     period, independent of whether the engine answered. Every gate call carries the connection's OWNER TOKEN (the entry Worker's
 *     per-upgrade token, kept with the generation), so a late close, release or renewal of an older connection cannot free,
 *     recreate or take the slot of a newer one (see pending-gate.ts). The attempt cooldown is persisted BEFORE the gate is asked,
 *     so a slow, lost or unavailable call cannot be repeated by another boot until PENDING_CAPTURE_MIN_INTERVAL_MS has passed; a
 *     held answer then advances to the full period. A refused renewal (CPO at its cap) is Rejected + closed; an unreachable gate
 *     keeps the socket. A renewal that turns out stale (its socket closed or was replaced meanwhile) releases what it may have
 *     taken, by its own token (see renewLease).
 *   - first-boot deadline: persisted per generation, so a replacement always gets its own full deadline and an old alarm can
 *     never close a newer socket.
 *   - concurrent pending sockets per CPO: the admission gate (pending-gate.ts), released from here when the socket goes.
 *
 * STALE WORK: every await that can outlive a replacement (the engine call) re-checks the generation before it mutates state,
 * replies or closes anything. Sockets that are CLOSING (the platform still lists them) are not "present" and get no work.
 *
 * SPEC TENSION (OCPP 1.6 ed.2 s4.2): for Pending, "the communication channel SHOULD NOT be closed by either the Charge Point or
 * the Central System". Promotion below closes it (4002) once the charger is genuinely registered, which departs from that SHOULD
 * NOT; Rejected paths (capacity, known/retired, inactive) follow the "Central System MAY close" allowance. The departure is
 * deliberate and must be validated on hardware (does the charger reconnect promptly, and does it send a BootNotification?).
 *
 * HOW IT BECOMES ACCEPTED (and why via a reconnect): a hibernating socket belongs to the object that accepted it, and a
 * registered charger must be owned by its device object under generation/placement ownership. A pending socket cannot be
 * relabelled without inventing that context, and plaintext credentials are never kept, so promotion is: the save commits
 * -> the shell signals `promote` (or a later boot retry re-checks) -> this object re-reads the actual registration and, if it
 * is registered and placed, closes the socket with 4002. The charger reconnects through NORMAL admission (CPO, placement,
 * installation, credentials) and its fresh BootNotification there is answered `Accepted`. TriggerMessage is not used.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import { callPending, type EngineEnv } from "./engine-client";
import { parseFrame, serializeCallResult } from "./ocpp-frame";
import { isOwnerToken } from "./pending-gate";
import { validatePayload } from "@engine/protocol";
import {
  MAX_PENDING_FRAME_BYTES, PENDING_CAPTURE_MIN_INTERVAL_MS, PENDING_FIRST_BOOT_DEADLINE_MS, PENDING_MESSAGES_PER_WINDOW,
  PENDING_MESSAGE_WINDOW_MS, PENDING_RECHECK_SECONDS, PENDING_REGISTERED_CLOSE, PENDING_SUPERSEDED_CLOSE, payloadHash,
  pendingBootResponse, pendingRetrySeconds,
} from "@engine/pending";

export const PENDING_CTX_HEADER = "x-straumvakt-pending-ctx";
/** The entry Worker's per-upgrade token. It becomes the owner token of the generation this upgrade creates. */
export const PENDING_ATTEMPT_HEADER = "x-straumvakt-pending-attempt";
const CTX_KEY = "pending:ctx";
const GEN_KEY = "pending:gen";
const BOOT_GEN_KEY = "pending:bootGen";
const HASH_KEY = "pending:hash";
const RECHECK_KEY = "pending:recheckAt";
const CAPTURE_AT_KEY = "pending:captureAt";
/** The current generation's first-boot deadline and its owner token: `{ gen, at, tok }`. One write per connection. */
const DEADLINE_KEY = "pending:deadline";
/**
 * When the admission lease is next asked for, per generation: `{ gen, at }`. Independent of the registration re-check, so a
 * failing engine cannot starve it. `at` is the short attempt cooldown from the moment an attempt starts (written before the gate
 * is contacted) and the full period once the gate answered held; a new generation is always due, because its token must be
 * confirmed.
 */
const LEASE_AT_KEY = "pending:leaseAt";

export type PendingContext = { orgId: string; routingId: string; chargePointId: string };
/** What rides with the socket across hibernation. `w`/`n` are the message window (start, count). Small on purpose. */
export type PendingTag = { pending: true; generation: number; w?: number; n?: number };
export type PromoteOutcome = "not_connected" | "reconnect_requested" | "still_unregistered" | "known" | "unavailable";

/**
 * The admission gate's lease for this identity (see pending-gate.ts). Both calls carry the connection's owner token.
 * `renew` resolves true when `owner` holds the slot afterwards and false when it does not; with `create` false that only means
 * "nothing of yours to extend", with `create` true it means the CPO is at its cap or the slot belongs to another token
 * (refused). It rejects when the gate could not be asked (unavailable). `release` is best effort.
 */
export type PendingLease = {
  renew(ctx: PendingContext, owner: string, create: boolean): Promise<boolean>;
  release(ctx: PendingContext, owner: string): Promise<void>;
};
type LeaseOutcome = "held" | "refused" | "unavailable" | "stale";

type Env = EngineEnv & { OCPP_PENDING_RETRY_SECONDS?: string };
type AttachSocket = WebSocket & { serializeAttachment(v: unknown): void; deserializeAttachment(): unknown };

export function readPendingTag(ws: WebSocket): PendingTag | null {
  try {
    const v = (ws as AttachSocket).deserializeAttachment() as Partial<PendingTag> | null;
    if (!v || v.pending !== true || typeof v.generation !== "number") return null;
    return { pending: true, generation: v.generation, ...(typeof v.w === "number" ? { w: v.w } : {}), ...(typeof v.n === "number" ? { n: v.n } : {}) };
  } catch {
    return null;
  }
}

/** WebSocket.OPEN is 1. A fake or older runtime without readyState is treated as open. */
const isOpen = (ws: WebSocket) => ((ws as { readyState?: number }).readyState ?? 1) === 1;

const errFrame = (uniqueId: string, code: string, description: string) => JSON.stringify([4, uniqueId, code, description, {}]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const ROUTING = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parsePendingContext(raw: string | null): PendingContext | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<PendingContext>;
    return typeof v.orgId === "string" && UUID.test(v.orgId) && typeof v.routingId === "string" && ROUTING.test(v.routingId) && typeof v.chargePointId === "string" && CP_ID.test(v.chargePointId)
      ? { orgId: v.orgId, routingId: v.routingId, chargePointId: v.chargePointId }
      : null;
  } catch {
    return null;
  }
}

export class PendingMode {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly negotiate: (offer: string | null) => { ok: true; selected: string | null } | { ok: false },
    private readonly now: () => number = Date.now,
    private readonly lease: PendingLease | null = null,
  ) {}

  private async generation(): Promise<number> {
    return (await this.state.storage.get<number>(GEN_KEY)) ?? 0;
  }

  /**
   * The owner token of a generation. Read BEFORE any cross-object gate call, so a call that is delayed past a replacement still
   * carries the token of the connection it speaks for. A generation without a recorded token (a direct upgrade) uses `g{gen}`.
   */
  private async ownerToken(gen: number): Promise<string> {
    const d = await this.state.storage.get<{ gen: number; tok?: string }>(DEADLINE_KEY);
    return d?.gen === gen && typeof d.tok === "string" ? d.tok : `g${gen}`;
  }

  /** Open sockets that belong to this generation. A CLOSING socket is still listed by the platform and is not counted. */
  private currentSockets(gen: number): WebSocket[] {
    return this.state.getWebSockets().filter((s) => isOpen(s) && readPendingTag(s)?.generation === gen);
  }

  private closeAll(code: number, reason: string) {
    for (const s of this.state.getWebSockets()) {
      try {
        s.close(code, reason);
      } catch {
        /* already closed */
      }
    }
  }

  async upgrade(request: Request): Promise<Response> {
    const ctx = parsePendingContext(request.headers.get(PENDING_CTX_HEADER));
    if (!ctx) return new Response("bad pending context", { status: 500 });
    const negotiated = this.negotiate(request.headers.get("sec-websocket-protocol") ?? request.headers.get("x-straumvakt-ws-protocol"));
    if (!negotiated.ok) return new Response("unsupported websocket subprotocol", { status: 400 });

    const generation = (await this.generation()) + 1;
    const deadline = this.now() + PENDING_FIRST_BOOT_DEADLINE_MS;
    const offered = request.headers.get(PENDING_ATTEMPT_HEADER);
    const owner = isOwnerToken(offered) ? offered : `g${generation}`;
    // Persist BEFORE accepting: a crash in between leaves a higher generation with no socket, never a socket with no owner.
    await this.state.storage.put(GEN_KEY, generation);
    await this.state.storage.put(CTX_KEY, ctx);
    await this.state.storage.put(DEADLINE_KEY, { gen: generation, at: deadline, tok: owner });
    // A new connection may store its first boot afresh, but only under the capture budget below.
    await this.state.storage.delete(HASH_KEY);
    // A replacement: the older socket is closed. The newest connection owns the identity.
    this.closeAll(PENDING_SUPERSEDED_CLOSE, "superseded");
    const pair = new WebSocketPair();
    const [clientWs, serverWs] = [pair[0], pair[1]];
    (serverWs as unknown as AttachSocket).serializeAttachment({ pending: true, generation } satisfies PendingTag);
    this.state.acceptWebSocket(serverWs);
    // This object has no other alarm use, so the one alarm is always the CURRENT generation's deadline.
    await this.state.storage.setAlarm(deadline);
    return new Response(null, { status: 101, webSocket: clientWs, ...(negotiated.selected ? { headers: { "Sec-WebSocket-Protocol": negotiated.selected } } : {}) } as ResponseInit);
  }

  /** True when this object has pending state (so the shared alarm/dispatch knows the object is a pending one). */
  async isPending(): Promise<boolean> {
    return (await this.state.storage.get(CTX_KEY)) !== undefined;
  }

  /** Counts this message in the socket's own window and persists the window in the attachment. True when over budget. */
  private overRate(ws: WebSocket, tag: PendingTag, nowMs: number): boolean {
    let w = tag.w ?? 0;
    let n = tag.n ?? 0;
    if (nowMs - w >= PENDING_MESSAGE_WINDOW_MS || nowMs < w) {
      w = nowMs;
      n = 0;
    }
    n++;
    try {
      (ws as AttachSocket).serializeAttachment({ pending: true, generation: tag.generation, w, n } satisfies PendingTag);
    } catch {
      /* a closing socket */
    }
    return n > PENDING_MESSAGES_PER_WINDOW;
  }

  async message(ws: WebSocket, tag: PendingTag, message: string | ArrayBuffer): Promise<void> {
    if (!isOpen(ws)) return; // a closing socket gets no work
    const gen = await this.generation();
    if (tag.generation !== gen) {
      try {
        ws.close(PENDING_SUPERSEDED_CLOSE, "superseded");
      } catch {
        /* closed */
      }
      return;
    }
    const nowMs = this.now();
    if (this.overRate(ws, tag, nowMs)) {
      ws.close(1008, "too many messages");
      return;
    }
    if (typeof message !== "string") {
      ws.send(errFrame("malformed", "ProtocolError", "binary frames not supported"));
      return;
    }
    // Bytes, not characters: a multibyte payload must not slip under the cap.
    const bytes = message.length > MAX_PENDING_FRAME_BYTES ? Infinity : new TextEncoder().encode(message).length;
    if (bytes > MAX_PENDING_FRAME_BYTES) {
      ws.close(1009, "message too large");
      return;
    }
    const parsed = parseFrame(message);
    if (!parsed.ok) {
      ws.send(errFrame("unknown", "FormationViolation", parsed.error));
      return;
    }
    const frame = parsed.frame;
    if (frame.kind !== "call") return; // we never send a request on a pending socket, so there is nothing to answer
    if (frame.uniqueId.length > 36) {
      ws.send(errFrame("unknown", "FormationViolation", "uniqueId too long"));
      return;
    }
    if (frame.action === "Heartbeat") {
      ws.send(serializeCallResult(frame.uniqueId, { currentTime: new Date(nowMs).toISOString() }));
      return;
    }
    if (frame.action !== "BootNotification") {
      // Nothing is registered, so nothing may start: no session, no authorization, no meter evidence.
      ws.send(errFrame(frame.uniqueId, "SecurityError", "charge point is not registered yet"));
      return;
    }
    await this.boot(ws, gen, frame.uniqueId, frame.payload, bytes, nowMs);
  }

  private async boot(ws: WebSocket, gen: number, uniqueId: string, payload: Record<string, unknown>, frameBytes: number, nowMs: number): Promise<void> {
    const ctx = await this.state.storage.get<PendingContext>(CTX_KEY);
    if (!ctx) {
      ws.close(1011, "internal_state_missing");
      return;
    }
    const valid = validatePayload("BootNotification", payload);
    const hash = await payloadHash(payload);
    const storedHash = await this.state.storage.get<string>(HASH_KEY);
    const recheckAt = await this.state.storage.get<number>(RECHECK_KEY);
    const captureAt = await this.state.storage.get<number>(CAPTURE_AT_KEY);
    const changed = hash !== storedHash;
    // Capture budget: a changed/invalid/re-stored body reaches the engine at most once per interval, however it got here.
    const mayCapture = changed && (captureAt === undefined || nowMs - captureAt >= PENDING_CAPTURE_MIN_INTERVAL_MS || nowMs < captureAt);
    const recheck = !changed && (recheckAt === undefined || recheckAt <= nowMs);

    if (mayCapture || recheck) {
      // The budget is charged at ATTEMPT time, so a failing database cannot be hammered by a charger that keeps retrying.
      // A re-check spends the same interval before it asks: success moves it out to the full re-check period below, while an
      // unavailable or failed answer leaves only this short cooldown, so unchanged boots cannot repeat the call.
      if (mayCapture) await this.state.storage.put(CAPTURE_AT_KEY, nowMs);
      else await this.state.storage.put(RECHECK_KEY, nowMs + PENDING_CAPTURE_MIN_INTERVAL_MS);
      const answer = await callPending(this.env, mayCapture
        ? { op: "boot", routingId: ctx.routingId, chargePointId: ctx.chargePointId, messageId: uniqueId, receivedAt: new Date(nowMs).toISOString(), frameBytes, payload }
        : { op: "check", routingId: ctx.routingId, chargePointId: ctx.chargePointId });
      // The engine call can outlive a replacement. A newer connection owns the identity now: touch nothing, say nothing.
      if ((await this.generation()) !== gen || !isOpen(ws)) return;

      if (answer.kind === "state" && answer.state === "registered") {
        // Registered since the last look: let it reconnect through normal admission. No reply is forged for this boot.
        await this.close(ctx, gen, PENDING_REGISTERED_CLOSE, "registered; reconnect");
        return;
      }
      if (answer.kind === "state" && answer.state === "unregistered") {
        // Still waiting: the normal outcome of a re-check. Remember when to look again so retries in between cost nothing.
        await this.state.storage.put(RECHECK_KEY, nowMs + PENDING_RECHECK_SECONDS * 1000);
        // A capture that was evicted or lost is stored again by the next boot (still under the capture budget).
        if (answer.hasCapture === false) await this.state.storage.delete(HASH_KEY);
      } else if (answer.kind === "state") {
        // Known (retired/ambiguous) or inactive CPO: never resurrected through discovery.
        // OCPP 1.6 ed.2 s4.2: a Central System that will not register a charger answers Rejected (with a retry interval) and MAY close.
        ws.send(serializeCallResult(uniqueId, { status: "Rejected", currentTime: new Date(nowMs).toISOString(), interval: pendingRetrySeconds(this.env.OCPP_PENDING_RETRY_SECONDS) }));
        ws.close(1008, "not eligible");
        return;
      }
      if (answer.kind === "captured") {
        if (answer.result === "full") {
          ws.send(serializeCallResult(uniqueId, { status: "Rejected", currentTime: new Date(nowMs).toISOString(), interval: pendingRetrySeconds(this.env.OCPP_PENDING_RETRY_SECONDS) }));
          ws.close(1008, "capacity");
          return;
        }
        // stored or unchanged: remember so a repeat of this body costs nothing. A failed attempt leaves the old hash, so a later boot retries it.
        await this.state.storage.put(HASH_KEY, hash);
        await this.state.storage.put(RECHECK_KEY, nowMs + PENDING_RECHECK_SECONDS * 1000);
      } else if (answer.kind === "rejected" && answer.status === 413) {
        ws.close(1009, "message too large");
        return;
      }
    }

    // Admission lease: confirmed on the first boot of each connection, then renewed once per re-check period on a normal boot,
    // whether or not the engine call ran or succeeded. No timer: a socket that is silent past its lease is the gate's
    // documented approximation.
    if (this.lease) {
      const leaseAt = await this.state.storage.get<{ gen: number; at: number }>(LEASE_AT_KEY);
      if (leaseAt?.gen !== gen || leaseAt.at <= nowMs || nowMs < leaseAt.at - PENDING_RECHECK_SECONDS * 1000) {
        const outcome = await this.renewLease(ctx, gen, ws, nowMs);
        if (outcome === "stale") return; // a newer connection owns the identity: send nothing, change nothing
        if (outcome === "refused") {
          // The CPO is at its cap and this identity no longer holds a slot. Treat it like the capture cap: Rejected, then close.
          ws.send(serializeCallResult(uniqueId, { status: "Rejected", currentTime: new Date(nowMs).toISOString(), interval: pendingRetrySeconds(this.env.OCPP_PENDING_RETRY_SECONDS) }));
          ws.close(1008, "capacity");
          return;
        }
        // "unavailable": the socket stays; the gate is asked again after the short cooldown renewLease recorded before the call.
      }
    }

    // First boot of THIS socket: clears its deadline. One write per connection, not per boot.
    if (((await this.state.storage.get<number>(BOOT_GEN_KEY)) ?? 0) < gen) await this.state.storage.put(BOOT_GEN_KEY, gen);

    // A boot that fails the schema was captured above (vendor extensions stay inspectable) and is refused like a registered one.
    if (!valid.ok) {
      ws.send(errFrame(uniqueId, valid.error.code, valid.error.description));
      return;
    }
    ws.send(serializeCallResult(uniqueId, pendingBootResponse(new Date(nowMs), pendingRetrySeconds(this.env.OCPP_PENDING_RETRY_SECONDS))));
  }

  /**
   * Asks the gate to keep this connection's slot, as its owner token. The first ask only extends or confirms: a lease that was
   * released or passed to another connection is not recreated for a caller that may already be stale. Only when the gate has
   * nothing of ours AND this connection is still the current open one is the slot claimed (it is subject to the cap), which
   * covers a live socket whose lease lapsed. Every await that can outlive a replacement re-checks the generation and the
   * socket: a stale caller records and reports nothing ("stale").
   *
   * The attempt is CHARGED FIRST: the short cooldown is persisted before the gate is contacted, so a second boot (on this or a
   * fresh instance after hibernation) that arrives while the first call is slow, lost or unavailable finds the lease not due
   * and makes no call of its own. A held answer then moves the next renewal out to the full period (a second put); an
   * unavailable gate leaves the cooldown; a refusal closes the socket. Two puts per successful renewal, one otherwise.
   *
   * A caller that turns out stale after the gate answered may have created or extended a slot for a connection that is gone (the
   * renewal was in flight when the socket closed or was replaced). It gives back what it may have taken with a release carrying
   * its OWN token: the gate applies that only while the token still owns the slot, so a replacement's slot is untouched. This
   * also covers a lost reply (the gate may have applied the call). If that cleanup call is itself lost, the slot lapses at the
   * gate after PENDING_LEASE_MS (no tombstone, no timer, no retry); during a total gate outage no cleanup is guaranteed.
   */
  private async renewLease(ctx: PendingContext, gen: number, ws: WebSocket, nowMs: number): Promise<LeaseOutcome> {
    const owner = await this.ownerToken(gen);
    // Nothing is recorded or asked for a connection that is already gone.
    if ((await this.generation()) !== gen || !isOpen(ws)) return "stale";
    await this.state.storage.put(LEASE_AT_KEY, { gen, at: nowMs + PENDING_CAPTURE_MIN_INTERVAL_MS });
    let outcome: LeaseOutcome;
    try {
      let held = await this.lease!.renew(ctx, owner, false);
      if (!held) {
        if ((await this.generation()) !== gen || !isOpen(ws)) return "stale";
        held = await this.lease!.renew(ctx, owner, true);
      }
      outcome = held ? "held" : "refused";
    } catch {
      outcome = "unavailable";
    }
    if ((await this.generation()) !== gen || !isOpen(ws)) {
      // A refusal means the gate holds nothing of ours. Held or uncertain (a thrown call may have been applied): give it back.
      if (outcome !== "refused") await this.lease!.release(ctx, owner).catch(() => undefined);
      return "stale";
    }
    if (outcome === "held") await this.state.storage.put(LEASE_AT_KEY, { gen, at: nowMs + PENDING_RECHECK_SECONDS * 1000 });
    return outcome;
  }

  /** Close every socket and give the admission slot back; used when the charger is promoted. */
  private async close(ctx: PendingContext, gen: number, code: number, reason: string) {
    const owner = await this.ownerToken(gen);
    this.closeAll(code, reason);
    await this.lease?.release(ctx, owner).catch(() => undefined);
  }

  /** Close/error of a pending socket. A disconnect that is not ours starts the Incoming window from now (throttled, best effort). */
  async closed(ws: WebSocket, tag: PendingTag, code?: number): Promise<void> {
    const gen = await this.generation();
    if (tag.generation !== gen) return; // a replaced socket's death changes nothing
    if (this.currentSockets(gen).some((s) => s !== ws)) return;
    const ctx = await this.state.storage.get<PendingContext>(CTX_KEY);
    if (!ctx) return;
    // The slot is given back whenever the LAST current socket goes, whoever closed it. The call carries THIS connection's token
    // (read now), so if it is delivered after a replacement took the identity it cannot free the replacement's slot.
    const owner = await this.ownerToken(gen);
    await this.lease?.release(ctx, owner).catch(() => undefined);
    if (code === PENDING_REGISTERED_CLOSE || code === PENDING_SUPERSEDED_CLOSE) return;
    // A replacement may have arrived while the release was in flight: its death-note is not ours to start.
    if ((await this.generation()) !== gen) return;
    await callPending(this.env, { op: "closed", routingId: ctx.routingId, chargePointId: ctx.chargePointId });
  }

  /**
   * After the CPO saved this charger into a circuit: re-read the ACTUAL registration (never trust the signal) and, if it
   * is registered and placed, close the socket so the charger reconnects through normal admission.
   */
  async promote(): Promise<PromoteOutcome> {
    const gen = await this.generation();
    if (this.currentSockets(gen).length === 0) return "not_connected";
    const ctx = await this.state.storage.get<PendingContext>(CTX_KEY);
    if (!ctx) return "unavailable";
    const answer = await callPending(this.env, { op: "check", routingId: ctx.routingId, chargePointId: ctx.chargePointId });
    if ((await this.generation()) !== gen) return "not_connected"; // replaced while we asked: the newer connection decides for itself
    if (answer.kind === "state" && answer.state === "registered") {
      await this.close(ctx, gen, PENDING_REGISTERED_CLOSE, "registered; reconnect");
      return "reconnect_requested";
    }
    if (answer.kind === "state") return answer.state === "unregistered" ? "still_unregistered" : "known";
    return "unavailable";
  }

  /** Gateway-observed socket presence. NOT proof of recent device liveness: a hibernating socket can be silent. */
  async presence(): Promise<{ connected: boolean }> {
    return { connected: this.currentSockets(await this.generation()).length > 0 };
  }

  /**
   * Alarm: close the current generation's sockets if it never sent a BootNotification by ITS deadline. An alarm that fires
   * early or belongs to an older generation never closes a newer socket; it re-arms for the real deadline.
   */
  async alarm(): Promise<void> {
    const gen = await this.generation();
    const deadline = await this.state.storage.get<{ gen: number; at: number; tok?: string }>(DEADLINE_KEY);
    if (!deadline || deadline.gen !== gen) return;
    if (this.now() < deadline.at) {
      await this.state.storage.setAlarm(deadline.at);
      return;
    }
    if (((await this.state.storage.get<number>(BOOT_GEN_KEY)) ?? 0) >= gen) return;
    const ctx = await this.state.storage.get<PendingContext>(CTX_KEY);
    for (const s of this.currentSockets(gen)) {
      try {
        s.close(1008, "no BootNotification");
      } catch {
        /* closed */
      }
    }
    if (ctx) await this.lease?.release(ctx, deadline.tok ?? `g${gen}`).catch(() => undefined);
  }
}
