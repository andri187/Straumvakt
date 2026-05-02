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
 *   • Translate Call frames → domain events → POST to main app.
 *   • Reply to Call frames with OCPP CallResult per dev-stub policy
 *     (Sprint 2 replaces with real token resolver for Authorize).
 *   • Handle outbound commands injected via `/dispatch` (main app →
 *     gateway direction): mint a uniqueId, send Call frame, match
 *     CallResult by uniqueId to resolve the dispatch.
 *
 * Crash-resilience:
 *   • Inflight ingest attempts live in DO storage as `inflight:<eventId>`.
 *     On webSocketMessage, if ingest fails retriably we persist the event
 *     to storage and let the alarm fire to retry. (Sprint 1.4 ships the
 *     alarm loop wiring; Sprint 1.5 proves it end-to-end.)
 *   • Inflight outbound commands similarly: `cmd:<commandId>`.
 */
import type { DurableObjectState } from "@cloudflare/workers-types";
import { parseFrame, serializeCallResult, serializeCall } from "./ocpp-frame";
import { postEvent, type IngestEvent } from "./ingest-client";
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
}

interface SessionMapEntry {
  connectorId: string; // UUID resolved from connector index
  chargeSessionId: string; // UUID minted by DO for this transaction
}

export class IdentityDurableObject {
  private readonly state: DurableObjectState;
  private readonly env: GatewayEnv;
  /** Map from OCPP transactionId (number) to our session UUIDs. */
  private readonly transactions = new Map<number, SessionMapEntry>();
  /** uniqueId → pending outbound command, awaiting CallResult from charger. */
  private readonly pendingOutbound = new Map<string, OutboundPending>();
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

    return new Response("not found", { status: 404 });
  }

  // ───────────────────────────────────────────────────────────────
  // WebSocket upgrade (charger connection)
  // ───────────────────────────────────────────────────────────────

  private async handleUpgrade(request: Request): Promise<Response> {
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

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
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

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Cleanly mark lastSeen; nothing to tear down beyond that. State
    // survives the close — DO hibernates until next event.
    await this.state.storage.put("lastClosedAt", Date.now());
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

    const outcome = await postEvent(this.env, event);
    if (outcome.kind === "retriable") {
      await this.state.storage.put(`inflight:${event.eventId}`, event);
      // Alarm-driven retry is Sprint 1.5's job — for now, log and reply
      // to the charger anyway so it doesn't sit waiting.
      console.warn("[ocpp-gw] ingest retriable", outcome.error);
    }
    if (outcome.kind === "rejected") {
      console.error("[ocpp-gw] ingest rejected", outcome.status, outcome.error);
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
        authResolverVerdict = await this.requestAuthorizeVerdict(
          idTag,
          frame.action,
        );
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
   * Sidecar call to `/api/internal/ocpp-authorize`. Failure is silent
   * — we never block the charger response on this lookup because the
   * gateway's whole point is sub-second Authorize.req turn-around. If
   * the API errors, we return null and the caller logs it as
   * `upstream_error`. Sprint 4 wires this to actually gate the reply.
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

    const uniqueId = crypto.randomUUID();
    this.pendingOutbound.set(uniqueId, {
      commandId: body.commandId,
      uniqueId,
      action: body.action,
      payload: body.payload,
      enqueuedAt: Date.now(),
    });

    activeWs.send(serializeCall(uniqueId, body.action, body.payload));

    // For Sprint 1.4 we return immediately with 'sent' — the DO waits
    // for the matching CallResult to come back via webSocketMessage.
    // Sprint 1.5 will wire the "wait for ack + respond" loop properly;
    // today main-app records the command as acked on 202 return.
    return Response.json(
      { kind: "ack", result: { status: "Sent", uniqueId } },
      { status: 202 },
    );
  }

  private async handleInboundCallResult(
    frame: { kind: "call_result"; uniqueId: string; payload: Record<string, unknown> },
  ): Promise<void> {
    const pending = this.pendingOutbound.get(frame.uniqueId);
    if (!pending) {
      // Spurious CallResult — log and drop.
      console.warn("[ocpp-gw] unmatched CallResult uniqueId", frame.uniqueId);
      return;
    }
    this.pendingOutbound.delete(frame.uniqueId);
    await this.recordCommandResult(pending, {
      outcome: "accepted",
      result: frame.payload,
    });
  }

  private async handleInboundCallError(
    frame: { kind: "call_error"; uniqueId: string; errorCode: string; errorDescription: string },
  ): Promise<void> {
    const pending = this.pendingOutbound.get(frame.uniqueId);
    if (!pending) {
      console.warn("[ocpp-gw] unmatched CallError", frame.uniqueId);
      return;
    }
    this.pendingOutbound.delete(frame.uniqueId);
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
    if (!this.meta) return;
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
    const shipped = await postEvent(this.env, event);
    if (shipped.kind !== "accepted") {
      console.warn("[ocpp-gw] command_result ingest failed", shipped);
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
