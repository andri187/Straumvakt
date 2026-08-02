/**
 * IdentityDurableObject — one instance per OCPP identity.
 *
 * Keyed by `ocpp_identities.id` UUID (not the identity string) so
 * renaming a charger's identity string doesn't split its DO state.
 *
 * Uses the **WebSocket Hibernation API** (`acceptWebSocket` +
 * `webSocketMessage` + `webSocketClose`) — the DO is not kept in
 * memory between WebSocket frames, which keeps charger fleet cost
 * linear in message rate, not charger count.
 *
 * Responsibilities:
 *   • Accept the WebSocket after auth already happened in the fetch
 *     entry (the DO trusts the bindings).
 *   • Parse each inbound frame as OCPP 1.6J.
 *   • Translate Call frames → domain events → enqueue onto
 *     OCPP_EVENTS_QUEUE (Sprint 5 / ADR 0017). The DO awaits queue
 *     accept (~1ms), not Postgres write — charger CALLRESULT replies
 *     stop being gated on database latency.
 *   • Reply to Call frames with OCPP CallResult per dev-stub policy
 *     (Sprint 2 replaces with real token resolver for Authorize).
 *   • Handle outbound commands injected via `/dispatch` (main app →
 *     gateway direction): mint a uniqueId, send Call frame, match
 *     CallResult by uniqueId to resolve the dispatch.
 *   • Cache Authorize verdicts in DO storage for a short TTL (P4.18)
 *     and expose `/invalidate-authorize` so a revocation does not have
 *     to wait the TTL out.
 *
 * Crash-resilience:
 *   • Inbound: Cloudflare Queues handles redelivery (max_retries=3 →
 *     DLQ, configured in apps/api wrangler.jsonc). The legacy
 *     `inflight:<eventId>` DO-storage path was removed in Sprint 5.2
 *     because queue retries replace it.
 *   • Outbound: inflight commands live in `state.storage` under
 *     `cmd:<uniqueId>` (P4.16). Written *before* the Call frame goes
 *     on the wire, deleted on correlation. Because this DO hibernates
 *     between frames, an in-memory map would lose the correlation
 *     whenever the object was evicted between dispatch and the
 *     charger's CallResult — the command would sit "Sent" forever in
 *     the operator console. Every inflight command now reaches a
 *     terminal state via one of three paths: CallResult/CallError
 *     correlation, the `webSocketClose` sweep, or the alarm-driven
 *     timeout sweep.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import { parseFrame, serializeCallResult, serializeCall } from "./ocpp-frame";
import { enqueueOrPost, type IngestEvent } from "./ingest-client";
import type { GatewayEnv } from "./auth";

/**
 * Verdict shape returned by /api/internal/ocpp-authorize. Mirrors
 * `AuthorizeResult` in apps/api. Gateway honours `verdict` only when
 * `enforceAuthorize` is true (Sprint 4 milestone 4.6 — per-installation
 * flag set by operator after IdToken table is verified seeded). When
 * false, gateway logs the verdict but always replies Accepted —
 * Sprint 3's shadow-mode posture preserved as the safe default.
 */
interface AuthorizeVerdict {
  verdict: "Accepted" | "Blocked" | "Expired" | "Invalid";
  reason: string;
  userId?: string;
  idTokenId?: string;
  enforceAuthorize: boolean;
}

/**
 * Read a string-valued field from an OCPP payload. Returns undefined
 * for missing or non-string values — keeps the call-site free of
 * unknown-cast churn.
 */
function stringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * WebSocket subprotocols this gateway speaks, most-preferred first.
 * OCPP 1.6J only — `ocpp_identities.ocpp_version` is authoritative for
 * the identity, but the wire negotiation is 1.6 across the fleet.
 */
export const SUPPORTED_SUBPROTOCOLS = ["ocpp1.6"] as const;

export type SubprotocolChoice =
  | { ok: true; selected: string | null }
  | { ok: false; offered: string[] };

/**
 * RFC 6455 §4.1/§4.2.2 subprotocol negotiation (P4.17).
 *
 *   • No offer at all → `selected: null`; the 101 must NOT carry a
 *     `Sec-WebSocket-Protocol` header.
 *   • One or more offers, at least one supported → echo it. The token
 *     echoed is the client's own spelling, because RFC 6455 requires
 *     the selected value to be one that appeared in the client
 *     handshake; we compare case-insensitively so `OCPP1.6` from a
 *     sloppy firmware still negotiates.
 *   • Offers present but none supported → `ok: false`, caller fails
 *     the handshake.
 *
 * Client preference order wins over ours — that is what the RFC's
 * "the server selects one of them" plus the client's ordered list
 * means in practice, and with a single supported protocol it is
 * indistinguishable anyway.
 */
export function selectSubprotocol(header: string | null): SubprotocolChoice {
  const offered = (header ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (offered.length === 0) return { ok: true, selected: null };
  const match = offered.find((token) =>
    SUPPORTED_SUBPROTOCOLS.some((s) => s === token.toLowerCase()),
  );
  if (!match) return { ok: false, offered };
  return { ok: true, selected: match };
}

/**
 * A verdict parked in DO storage with the wall-clock instant it stops
 * being usable. Stored — not held in an in-memory Map — because this
 * DO hibernates between WebSocket frames: an `Authorize` and the
 * `StartTransaction` that follows it seconds later are very often
 * served by two different in-memory instances over the same storage.
 * A memory-backed cache would miss on exactly the pair it exists to
 * serve, which is the same class of bug P4.16 fixed for outbound
 * commands.
 */
interface CachedAuthorizeVerdict {
  verdict: AuthorizeVerdict;
  /** Wall-clock ms; at or after this the entry is treated as a miss. */
  expiresAt: number;
}

interface SessionMeta {
  identityId: string;
  orgId: string;
  identityString: string;
}

interface OutboundPending {
  commandId: string;
  uniqueId: string;
  action: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
  /** Wall-clock ms after which the timeout sweep fails this command. */
  expiresAt: number;
}

/** DO-storage key prefix for inflight outbound commands (P4.16). */
const CMD_PREFIX = "cmd:";

function cmdKey(uniqueId: string): string {
  return `${CMD_PREFIX}${uniqueId}`;
}

/**
 * How long an outbound Call may sit uncorrelated before the alarm
 * sweep declares it failed.
 *
 * 30 seconds, chosen because:
 *   • 30s is the conventional OCPP-J CALL→response timeout
 *     (docs/reference/integrations/ocpp-1.6j.md §2.2) — the number
 *     charger firmware is itself written against. A charger that has
 *     not answered by then has almost certainly dropped the request
 *     rather than being merely slow (real Zaptec hardware answers
 *     RemoteStart in well under 2s, even over LTE).
 *   • `apps/api/scripts/virtual-cp.ts` already uses 30s for its own
 *     call timeout. Matching it means neither end of the wire is
 *     waiting on a peer that has already given up.
 *   • It is short enough that the operator console shows a terminal
 *     state within one page refresh, and long enough that we do not
 *     manufacture false failures on a congested link.
 *
 * A CallResult arriving after the sweep is logged as an unmatched
 * uniqueId (same as any spurious frame) — we deliberately do not
 * resurrect a command that has already been reported terminal, because
 * the outbox row on the API side has moved on.
 */
const COMMAND_TIMEOUT_MS = 30_000;

/**
 * DO-storage key prefix for cached Authorize verdicts (P4.18). The DO
 * is per-identity, so the idTag alone is a sufficient key *within* it
 * — the identity and org are implied by which object you are talking
 * to, and are what the upstream lookup was scoped by.
 */
const AUTHZ_PREFIX = "authz:";

function authzKey(idTag: string): string {
  return `${AUTHZ_PREFIX}${idTag}`;
}

/**
 * How long a cached Authorize verdict stays usable (P4.18).
 *
 * 60 seconds, chosen because:
 *   • The dominant win is the `Authorize` → `StartTransaction` pair.
 *     A driver taps, the charger asks `Authorize`, and the same idTag
 *     comes back on `StartTransaction` a few seconds later. That is
 *     two Postgres round-trips on the charger hot path for one
 *     decision; 60s collapses it to one with room to spare for a
 *     driver who plugs in slowly.
 *   • It bounds the staleness cost. A cached "Accepted" for a token
 *     revoked one second ago is an access-control decision, not a
 *     performance detail — but the worst case is *at most one extra
 *     session start* per charger per revocation, and that session is
 *     still metered, still billed, and still stoppable remotely.
 *     Longer TTLs start to allow repeated starts on a dead token.
 *   • Anything shorter stops covering the tap→plug gap on a slow
 *     driver, which is the case the cache exists for.
 *
 * When one extra session start is not acceptable — revocation,
 * non-payment suspension — the caller uses `/invalidate-authorize`
 * rather than waiting the window out.
 */
const AUTHORIZE_CACHE_TTL_MS = 60_000;

export class IdentityDurableObject {
  private readonly state: DurableObjectState;
  private readonly env: GatewayEnv;
  private meta: SessionMeta | null = null;

  constructor(state: DurableObjectState, env: GatewayEnv) {
    this.state = state;
    this.env = env;
  }

  // ───────────────────────────────────────────────────────────────
  // Entry — HTTP requests routed to this DO
  // ───────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade from a charger — auth already happened upstream.
    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      return this.handleUpgrade(request);
    }

    // Outbound command injection from main-app dispatcher.
    if (url.pathname === "/dispatch" && request.method === "POST") {
      return this.handleDispatch(request);
    }

    // P4.18 — drop cached Authorize verdicts on demand (revocation,
    // non-payment suspension) so the next frame goes back upstream
    // instead of waiting out the TTL.
    if (url.pathname === "/invalidate-authorize" && request.method === "POST") {
      return this.handleInvalidateAuthorize(request);
    }

    return new Response("not found", { status: 404 });
  }

  // ───────────────────────────────────────────────────────────────
  // WebSocket upgrade (charger connection)
  // ───────────────────────────────────────────────────────────────

  private async handleUpgrade(request: Request): Promise<Response> {
    // P4.17 — subprotocol negotiation. The entry Worker rebuilds the
    // upgrade request, so it forwards the client's offer under
    // `x-straumvakt-ws-protocol`; we accept the spec header too so the
    // DO can be driven directly (tests, future direct routing).
    const offer =
      request.headers.get("sec-websocket-protocol") ??
      request.headers.get("x-straumvakt-ws-protocol");
    const negotiated = selectSubprotocol(offer);
    if (!negotiated.ok) {
      // RFC 6455 §4.2.2: if the client offers subprotocols and the
      // server supports none of them, the handshake must fail rather
      // than complete without the header. Failing here with a 400 is
      // cleaner than a 101 the client immediately closes 1006.
      return new Response(
        `unsupported websocket subprotocol; supported: ${SUPPORTED_SUBPROTOCOLS.join(", ")}`,
        { status: 400 },
      );
    }

    // Meta is passed as trailing headers by the gateway entry. The DO
    // persists it so hibernation wake-ups recover identity context.
    const identityId = request.headers.get("x-straumvakt-identity-id");
    const orgId = request.headers.get("x-straumvakt-org-id");
    const identityString = request.headers.get("x-straumvakt-identity-string");
    if (!identityId || !orgId || !identityString) {
      return new Response("missing identity headers", { status: 500 });
    }
    await this.state.storage.put("meta", { identityId, orgId, identityString } satisfies SessionMeta);
    this.meta = { identityId, orgId, identityString };

    const pair = new WebSocketPair();
    const [clientWs, serverWs] = [pair[0], pair[1]];

    // Hibernation API — the DO is evicted between frames.
    this.state.acceptWebSocket(serverWs);

    // Only send the header when the client actually offered a
    // subprotocol. Echoing one the client never asked for is itself a
    // protocol violation (RFC 6455 §4.1) and some stacks close on it.
    const headers = negotiated.selected
      ? { "Sec-WebSocket-Protocol": negotiated.selected }
      : undefined;

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
      ...(headers ? { headers } : {}),
    });
  }

  // ───────────────────────────────────────────────────────────────
  // Hibernation API hooks
  // ───────────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      ws.send(
        JSON.stringify([4, "malformed", "ProtocolError", "binary frames not supported", {}]),
      );
      return;
    }

    await this.ensureMeta();
    if (!this.meta) {
      // DO state lost — should not happen on Hibernation wake-ups. Close.
      ws.close(1011, "internal_state_missing");
      return;
    }

    const parsed = parseFrame(message);
    if (!parsed.ok) {
      // OCPP 1.6J: reply with CallError generic if we can't parse.
      ws.send(JSON.stringify([4, "unknown", "FormationViolation", parsed.error, {}]));
      return;
    }

    const frame = parsed.frame;

    if (frame.kind === "call") {
      await this.handleInboundCall(ws, frame);
      return;
    }
    if (frame.kind === "call_result") {
      await this.handleInboundCallResult(frame);
      return;
    }
    if (frame.kind === "call_error") {
      await this.handleInboundCallError(frame);
      return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    // Cleanly mark lastSeen; state survives the close — DO hibernates
    // until the next event.
    await this.state.storage.put("lastClosedAt", Date.now());

    // P4.16 — anything still inflight can never be answered now: the
    // socket that would have carried the CallResult is gone. Sweep to
    // a terminal state instead of leaving the outbox row hanging until
    // the timeout alarm notices. Only sweep when the last socket goes
    // away; a charger with a second connection may still answer. The
    // closing socket is filtered explicitly — whether it is still
    // listed at this point is a runtime detail we should not depend on.
    const remaining = this.state.getWebSockets().filter((s) => s !== ws);
    if (remaining.length > 0) return;
    await this.sweepPending("disconnected", {
      closeCode: code,
      closeReason: reason,
    });
  }

  /**
   * A socket torn down by error never reaches `webSocketClose` — the
   * Hibernation API routes it here instead. Same durability problem,
   * same sweep (P4.16).
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    await this.state.storage.put("lastClosedAt", Date.now());
    const remaining = this.state.getWebSockets().filter((s) => s !== ws);
    if (remaining.length > 0) return;
    await this.sweepPending("disconnected", {
      socketError: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * DO alarm — timeout sweep for outbound commands whose CallResult
   * never arrived (P4.16). Re-arms itself for the next command still
   * inside its window so a burst of dispatches costs one alarm each
   * rather than one per tick.
   */
  async alarm(): Promise<void> {
    await this.ensureMeta();
    const now = Date.now();
    const pending = await this.state.storage.list<OutboundPending>({
      prefix: CMD_PREFIX,
    });

    let nextDueAt: number | null = null;
    for (const [key, cmd] of pending) {
      if (cmd.expiresAt > now) {
        nextDueAt = nextDueAt === null ? cmd.expiresAt : Math.min(nextDueAt, cmd.expiresAt);
        continue;
      }
      // delete() reports whether the key was still there — the same
      // claim guard the CallResult path uses, so a CallResult racing
      // the alarm produces exactly one terminal event, not two.
      const claimed = await this.state.storage.delete(key);
      if (!claimed) continue;
      console.warn("[ocpp-gw] command timed out", {
        commandId: cmd.commandId,
        uniqueId: cmd.uniqueId,
        action: cmd.action,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      await this.recordCommandResult(cmd, {
        outcome: "rejected",
        result: {
          reason: "timeout",
          timeoutMs: COMMAND_TIMEOUT_MS,
        },
      });
    }

    if (nextDueAt !== null) await this.state.storage.setAlarm(nextDueAt);
  }

  /**
   * Drain every `cmd:` row and report it terminal. Used by the
   * disconnect path; `reason` lands in the command_result payload so
   * the operator console can distinguish "charger dropped mid-command"
   * from "charger said no".
   *
   * Emitted as outcome `rejected` on purpose: the apps/api projection
   * `ocpp.command_result` only recognises `accepted` / `rejected` and
   * ignores anything else, so a bespoke `disconnected` outcome would
   * silently leave the outbox row on the optimistic `acked` the
   * dispatcher wrote at 202. `rejected` is what drives it to `failed`.
   */
  private async sweepPending(
    reason: "disconnected",
    detail: Record<string, unknown>,
  ): Promise<void> {
    const pending = await this.state.storage.list<OutboundPending>({
      prefix: CMD_PREFIX,
    });
    if (pending.size === 0) return;
    await this.ensureMeta();
    for (const [key, cmd] of pending) {
      const claimed = await this.state.storage.delete(key);
      if (!claimed) continue;
      console.warn("[ocpp-gw] command failed on disconnect", {
        commandId: cmd.commandId,
        uniqueId: cmd.uniqueId,
        action: cmd.action,
        reason,
      });
      await this.recordCommandResult(cmd, {
        outcome: "rejected",
        result: { reason, ...detail },
      });
    }
    // Nothing left to time out — drop the alarm so a hibernating DO
    // isn't woken for an empty sweep.
    await this.state.storage.deleteAlarm();
  }

  // ───────────────────────────────────────────────────────────────
  // Charger → main-app direction
  // ───────────────────────────────────────────────────────────────

  private async handleInboundCall(
    ws: WebSocket,
    frame: { kind: "call"; uniqueId: string; action: string; payload: Record<string, unknown> },
  ): Promise<void> {
    if (!this.meta) return;

    // Mint the event envelope ourselves — translation of OCPP vocab to
    // domain events lives on the main-app side for now (shared module
    // via ../src/lib/ocpp/translator.ts path). To keep the gateway bundle
    // small in Sprint 1.4 we emit a generic envelope with the OCPP
    // action stashed inside; main-app route handles the translator call.
    //
    // Sprint 1.5 will move translation to the gateway side via TS path
    // import — the infra (shared/ocpp path alias) is configured in
    // gateway/tsconfig.json and gateway/vitest.config.ts.
    const event: IngestEvent = {
      eventId: crypto.randomUUID(),
      orgId: this.meta.orgId,
      aggregateType: "ocpp_identity",
      aggregateId: this.meta.identityId,
      eventType: `ocpp.raw.${frame.action}`,
      occurredAt: new Date().toISOString(),
      correlationId: frame.uniqueId,
      retentionClass: "raw_protocol",
      payload: { action: frame.action, request: frame.payload },
    };

    // Sprint 5 / ADR 0017 — primary path is queue.send (sub-ms
    // accept). Falls back to postEvent on local dev (queue binding
    // undefined) or transient queue.send failure. Retries on the
    // service-binding fallback are now Cloudflare-Queues' job
    // (max_retries=3 → DLQ on the consumer side); the inflight:
    // DO-storage path is gone.
    const outcome = await enqueueOrPost(this.env, event);
    if (outcome.kind === "retriable") {
      console.warn("[ocpp-gw] ingest retriable", {
        eventId: event.eventId,
        error: outcome.error,
      });
    }
    if (outcome.kind === "rejected") {
      console.error("[ocpp-gw] ingest rejected", {
        eventId: event.eventId,
        status: outcome.status,
        error: outcome.error,
      });
    }

    // Sprint 3 closure item 3 + Sprint 4 milestone 4.6 — Authorize
    // handler. Resolve the idTag through the API's IdToken lookup,
    // log the verdict, then either:
    //   • reply per the verdict if Installation.enforceAuthorize=true
    //     (operator has flipped the flag after seeding the IdToken
    //     table)
    //   • reply Accepted regardless (shadow mode) when false.
    // The shadow-mode log line keeps working in both states so the
    // operator can watch verdicts pre-flip and verify post-flip.
    let authResolverVerdict: AuthorizeVerdict | null = null;
    if (frame.action === "Authorize" || frame.action === "StartTransaction") {
      const idTag = stringField(frame.payload, "idTag");
      if (idTag && this.meta) {
        const resolved = await this.resolveAuthorizeVerdict(idTag, frame.action);
        authResolverVerdict = resolved.verdict;
        // Single-line shape so Cloudflare tail / Logpush stays grep-able.
        console.log("[ocpp-gw] authorize.evaluated", {
          identityString: this.meta.identityString,
          action: frame.action,
          idTag,
          verdict: authResolverVerdict?.verdict ?? "upstream_error",
          reason: authResolverVerdict?.reason ?? "upstream_error",
          userId: authResolverVerdict?.userId,
          idTokenId: authResolverVerdict?.idTokenId,
          enforceAuthorize: authResolverVerdict?.enforceAuthorize ?? false,
          mode: authResolverVerdict?.enforceAuthorize ? "enforced" : "shadow",
          // P4.18 — an operator validating verdicts before flipping
          // enforceAuthorize (P4.11) must be able to tell a fresh
          // decision from one served out of the DO's cache. Without
          // this field that validation is done against silently-stale
          // data.
          cached: resolved.cached,
        });
      }
    }

    // Compute the response. For Authorize and StartTransaction with
    // enforceAuthorize=true, the verdict from the API gates the reply.
    // For everything else (heartbeat, status, meter values, or any
    // failed lookup), the dev-stub response is used — which reads
    // Accepted for the auth-relevant frames anyway.
    const responsePayload = this.responseFor(
      frame.action,
      authResolverVerdict,
    );
    ws.send(serializeCallResult(frame.uniqueId, responsePayload));
  }

  /**
   * Build the OCPP CallResult payload for an inbound Call. For
   * Authorize/StartTransaction with `enforceAuthorize=true`, honour
   * the API's verdict (Reject/Block/Expire/Accept). For everything
   * else (or when enforceAuthorize=false / upstream_error), fall back
   * to the stub response which is Accepted for these actions.
   */
  private responseFor(
    action: string,
    authVerdict: AuthorizeVerdict | null,
  ): Record<string, unknown> {
    const stub = this.stubResponseFor(action);
    if (action !== "Authorize" && action !== "StartTransaction") {
      return stub;
    }
    if (!authVerdict || !authVerdict.enforceAuthorize) {
      return stub;
    }
    // Enforced path. Authorize and StartTransaction both reply with
    // an idTagInfo whose status field carries the verdict verbatim.
    // StartTransaction additionally needs a transactionId — preserved
    // from the stub regardless of verdict (charger needs the id even
    // on a refused start, per OCPP 1.6 §6.6).
    if (action === "Authorize") {
      return { idTagInfo: { status: authVerdict.verdict } };
    }
    return {
      ...stub,
      idTagInfo: { status: authVerdict.verdict },
    };
  }

  /**
   * P4.18 — cache-aware wrapper around the upstream verdict lookup.
   *
   * Order is: usable cached entry → serve it and skip the network
   * entirely; otherwise ask upstream and cache a successful answer.
   *
   * Two deliberate properties:
   *   • An **expired entry is a miss**, not a fallback. We do not
   *     serve stale-while-revalidate on an access-control decision.
   *   • A **failed lookup is never cached**. `requestAuthorizeVerdict`
   *     returns null on any upstream error; caching that would turn a
   *     one-off blip into a full TTL of degraded behaviour, so the
   *     next frame retries instead. It also leaves any *unexpired*
   *     entry alone — it was written by a successful lookup and is
   *     still within its window.
   *
   * The returned `cached` flag is log-only; it never influences the
   * reply. In particular the shadow-mode path (`enforceAuthorize` =
   * false → always Accepted) is identical whichever way the verdict
   * arrived, because `responseFor` only ever reads the verdict object.
   */
  private async resolveAuthorizeVerdict(
    idTag: string,
    action: string,
  ): Promise<{ verdict: AuthorizeVerdict | null; cached: boolean }> {
    const key = authzKey(idTag);
    const entry = await this.state.storage.get<CachedAuthorizeVerdict>(key);
    if (entry && entry.expiresAt > Date.now()) {
      return { verdict: entry.verdict, cached: true };
    }

    const fresh = await this.requestAuthorizeVerdict(idTag, action);
    if (!fresh) return { verdict: null, cached: false };

    await this.state.storage.put(key, {
      verdict: fresh,
      expiresAt: Date.now() + AUTHORIZE_CACHE_TTL_MS,
    } satisfies CachedAuthorizeVerdict);
    return { verdict: fresh, cached: false };
  }

  /**
   * P4.18 — drop cached verdicts for this identity. Body is either
   * `{ "idTag": "..." }` for a single token or `{ "all": true }` to
   * clear every entry (used when an installation-wide flag changes,
   * e.g. `enforceAuthorize` itself, where per-token invalidation would
   * mean enumerating tokens).
   *
   * Idempotent: invalidating something that was never cached is a 200
   * with `cleared: 0`, because the caller's contract is "this idTag is
   * not served from cache after this returns," which is already true.
   */
  private async handleInvalidateAuthorize(request: Request): Promise<Response> {
    let body: { idTag?: unknown; all?: unknown };
    try {
      body = ((await request.json()) ?? {}) as { idTag?: unknown; all?: unknown };
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    if (body.all === true) {
      const entries = await this.state.storage.list<CachedAuthorizeVerdict>({
        prefix: AUTHZ_PREFIX,
      });
      let cleared = 0;
      for (const key of entries.keys()) {
        if (await this.state.storage.delete(key)) cleared += 1;
      }
      return Response.json({ ok: true, scope: "all", cleared }, { status: 200 });
    }

    const idTag = typeof body.idTag === "string" && body.idTag.length > 0 ? body.idTag : null;
    if (!idTag) {
      return Response.json(
        { error: "expected { idTag: string } or { all: true }" },
        { status: 400 },
      );
    }
    const cleared = (await this.state.storage.delete(authzKey(idTag))) ? 1 : 0;
    return Response.json({ ok: true, scope: "idTag", cleared }, { status: 200 });
  }

  /**
   * Sidecar call to `/api/internal/ocpp-authorize`. Failure is silent
   * — on any upstream error we return null, the caller logs it as
   * `upstream_error`, and `responseFor` falls back to the stub reply.
   *
   * This lookup *is* on the charger hot path: the CALLRESULT for
   * `Authorize` / `StartTransaction` waits on it, which is why P4.18
   * put a cache in front of it. (An earlier version of this comment
   * claimed the reply was never blocked on the lookup. It was — that
   * was finding F9.)
   */
  private async requestAuthorizeVerdict(
    idTag: string,
    action: string,
  ): Promise<AuthorizeVerdict | null> {
    if (!this.meta) return null;
    try {
      const resp = await this.env.MAIN_APP.fetch(
        new Request("https://main.internal/api/internal/ocpp-authorize", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-straumvakt-ingest": this.env.OCPP_INGEST_SECRET,
          },
          body: JSON.stringify({
            idTag,
            identityId: this.meta.identityId,
            orgId: this.meta.orgId,
          }),
        }),
      );
      if (!resp.ok) {
        console.warn("[ocpp-gw] authorize upstream non-200", {
          status: resp.status,
          action,
        });
        return null;
      }
      return (await resp.json()) as AuthorizeVerdict;
    } catch (err) {
      console.error("[ocpp-gw] authorize upstream threw", {
        action,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private stubResponseFor(action: string): Record<string, unknown> {
    const now = new Date().toISOString();
    switch (action) {
      case "BootNotification":
        return { status: "Accepted", currentTime: now, interval: 60 };
      case "Heartbeat":
        return { currentTime: now };
      case "Authorize":
        return { idTagInfo: { status: "Accepted" } };
      case "StartTransaction":
        return {
          transactionId: Math.floor(Math.random() * 2_000_000_000),
          idTagInfo: { status: "Accepted" },
        };
      case "StopTransaction":
        return { idTagInfo: { status: "Accepted" } };
      case "StatusNotification":
      case "MeterValues":
      default:
        return {};
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Main-app → charger direction (outbound commands)
  // ───────────────────────────────────────────────────────────────

  private async handleDispatch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      commandId: string;
      action: string;
      payload: Record<string, unknown>;
    };

    await this.ensureMeta();

    // Resolve the active WebSocket. Hibernation API exposes a list.
    const [activeWs] = this.state.getWebSockets();
    if (!activeWs) {
      return Response.json(
        { kind: "retriable", error: "no active websocket for identity" },
        { status: 503 },
      );
    }

    const now = Date.now();
    const uniqueId = crypto.randomUUID();
    const pending: OutboundPending = {
      commandId: body.commandId,
      uniqueId,
      action: body.action,
      payload: body.payload,
      enqueuedAt: now,
      expiresAt: now + COMMAND_TIMEOUT_MS,
    };

    // Durability ordering matters: persist BEFORE the frame goes on
    // the wire. The reverse order leaves a window where the charger
    // has the Call and we have no record of it — the exact hole P4.16
    // closes. Persisting a command that then fails to send is the
    // recoverable direction: we roll it back below.
    await this.state.storage.put(cmdKey(uniqueId), pending);
    await this.armTimeoutAlarm(pending.expiresAt);

    try {
      activeWs.send(serializeCall(uniqueId, body.action, body.payload));
    } catch (err) {
      await this.state.storage.delete(cmdKey(uniqueId));
      return Response.json(
        {
          kind: "retriable",
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 503 },
      );
    }

    // We return immediately with 'sent' — the DO waits for the
    // matching CallResult to come back via webSocketMessage, and the
    // main app promotes/downgrades the outbox row when the
    // `ocpp.command_result` event lands. Since P4.16 that event is
    // guaranteed to arrive on one of three paths (correlation,
    // disconnect sweep, timeout sweep), so a 202 no longer means
    // "possibly never resolved".
    return Response.json(
      { kind: "ack", result: { status: "Sent", uniqueId } },
      { status: 202 },
    );
  }

  /**
   * Set the DO alarm for the earliest inflight deadline. Only moves
   * the alarm earlier — a later command must not push an already-armed
   * earlier deadline out.
   */
  private async armTimeoutAlarm(dueAt: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current === null || current > dueAt) {
      await this.state.storage.setAlarm(dueAt);
    }
  }

  /**
   * Take ownership of an inflight command by uniqueId. Reads from DO
   * storage (not memory — this DO hibernates between frames) and uses
   * `delete()`'s existence result as the claim: whoever observes the
   * key emits the terminal event, everyone else is a duplicate. That
   * makes a repeated CallResult, or a CallResult racing the timeout
   * sweep, produce exactly one `ocpp.command_result`.
   */
  private async claimPending(uniqueId: string): Promise<OutboundPending | null> {
    const pending = await this.state.storage.get<OutboundPending>(cmdKey(uniqueId));
    if (!pending) return null;
    const claimed = await this.state.storage.delete(cmdKey(uniqueId));
    return claimed ? pending : null;
  }

  private async handleInboundCallResult(
    frame: { kind: "call_result"; uniqueId: string; payload: Record<string, unknown> },
  ): Promise<void> {
    const pending = await this.claimPending(frame.uniqueId);
    if (!pending) {
      // Spurious, duplicate, or already-swept CallResult — log and drop.
      console.warn("[ocpp-gw] unmatched CallResult uniqueId", frame.uniqueId);
      return;
    }
    await this.recordCommandResult(pending, {
      outcome: "accepted",
      result: frame.payload,
    });
  }

  private async handleInboundCallError(
    frame: { kind: "call_error"; uniqueId: string; errorCode: string; errorDescription: string },
  ): Promise<void> {
    const pending = await this.claimPending(frame.uniqueId);
    if (!pending) {
      console.warn("[ocpp-gw] unmatched CallError", frame.uniqueId);
      return;
    }
    await this.recordCommandResult(pending, {
      outcome: "rejected",
      result: {
        errorCode: frame.errorCode,
        errorDescription: frame.errorDescription,
      },
    });
  }

  /**
   * Ship a command-result event back to main app so the reply is
   * persisted in the event log (retention: operational). Operator
   * console / tests read from there to confirm a round-trip.
   */
  private async recordCommandResult(
    pending: OutboundPending,
    outcome: { outcome: "accepted" | "rejected"; result: Record<string, unknown> },
  ): Promise<void> {
    await this.ensureMeta();
    if (!this.meta) {
      // Should be unreachable — meta is persisted on the first upgrade
      // and every path here follows one. Log loudly rather than drop
      // silently, because dropping means an outbox row hangs.
      console.error("[ocpp-gw] command_result dropped, no identity meta", {
        commandId: pending.commandId,
        uniqueId: pending.uniqueId,
      });
      return;
    }
    const event = {
      eventId: crypto.randomUUID(),
      orgId: this.meta.orgId,
      aggregateType: "outbound_command",
      aggregateId: pending.commandId,
      eventType: "ocpp.command_result",
      occurredAt: new Date().toISOString(),
      correlationId: pending.uniqueId,
      retentionClass: "operational" as const,
      payload: {
        commandId: pending.commandId,
        action: pending.action,
        outcome: outcome.outcome,
        result: outcome.result,
        latencyMs: Date.now() - pending.enqueuedAt,
      },
    };
    const shipped = await enqueueOrPost(this.env, event);
    if (shipped.kind !== "accepted") {
      console.warn("[ocpp-gw] command_result ingest failed", {
        eventId: event.eventId,
        kind: shipped.kind,
        error: "error" in shipped ? shipped.error : undefined,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Recovery after hibernation wake
  // ───────────────────────────────────────────────────────────────

  private async ensureMeta(): Promise<void> {
    if (this.meta) return;
    const stored = await this.state.storage.get<SessionMeta>("meta");
    if (stored) this.meta = stored;
  }
}
