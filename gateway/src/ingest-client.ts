/**
 * Gateway → API Worker ingest client.
 *
 * Sprint 5 / ADR 0017 — primary path is now Cloudflare Queues:
 *
 *   gateway DO ──env.OCPP_EVENTS_QUEUE.send()──► queue ──► apps/api consumer
 *
 * The DO awaits the queue accept (sub-millisecond) instead of the
 * synchronous service-binding write that used to block on Postgres.
 * Charger CALLRESULT replies stop being gated on database write
 * latency — the goal of Sprint 5.
 *
 * Fallback path (`postEvent`) preserved for two scenarios:
 *   • Local dev — `wrangler dev --local` doesn't bind queues, so
 *     `env.OCPP_EVENTS_QUEUE` is undefined and we drop straight to
 *     a service-binding POST.
 *   • Belt-and-braces — if the queue binding ever drops out at
 *     runtime (deploy gap, CF outage), we keep events flowing on
 *     the slower-but-known-good path.
 *
 * `enqueueOrPost` is the single entry point the DO calls. The
 * caller-visible outcome shape is unchanged across both paths so
 * the DO's retry/log decision logic doesn't need to know which
 * transport ran.
 *
 * Bindings per environment:
 *   • staging → MAIN_APP=hlada-api-staging,
 *               OCPP_EVENTS_QUEUE=straumvakt-ocpp-events-staging
 *   • prod    → MAIN_APP=hlada-api,
 *               OCPP_EVENTS_QUEUE=straumvakt-ocpp-events  (when provisioned)
 */
import type { GatewayEnv } from "./auth";

export interface IngestEvent {
  eventId: string;
  orgId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  correlationId: string;
  retentionClass:
    | "financial"
    | "operational"
    | "raw_protocol"
    | "aggregate"
    | "issue_history";
  payload: Record<string, unknown>;
  schemaVersion?: number;
}

export type IngestOutcome =
  | { kind: "accepted"; eventId: string; recorded: boolean }
  | { kind: "rejected"; status: number; error: string }
  | { kind: "retriable"; status: number; error: string };

export async function postEvent(
  env: GatewayEnv,
  event: IngestEvent,
): Promise<IngestOutcome> {
  try {
    const resp = await env.MAIN_APP.fetch(
      new Request("https://main.internal/api/internal/ocpp-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-straumvakt-ingest": env.OCPP_INGEST_SECRET,
        },
        body: JSON.stringify(event),
      }),
    );

    if (resp.status === 202) {
      const body = (await resp.json()) as { eventId: string; recorded: boolean };
      return { kind: "accepted", eventId: body.eventId, recorded: body.recorded };
    }
    // Malformed body / auth failure / permanent rejection — not retriable.
    // Upstream 5xx / network glitch — retriable.
    const text = await resp.text().catch(() => "");
    if (resp.status >= 500) {
      return { kind: "retriable", status: resp.status, error: text.slice(0, 500) };
    }
    return { kind: "rejected", status: resp.status, error: text.slice(0, 500) };
  } catch (err) {
    // Network/service-binding failure — retriable.
    return {
      kind: "retriable",
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sprint 5 / ADR 0017 — preferred path: enqueue, fall back to
 * postEvent if the queue binding isn't present (local dev) or the
 * send fails for an unexpected reason.
 *
 * Outcome shape matches `postEvent` so the DO's caller logic stays
 * identical. On the queue-success path we return `accepted` with
 * `recorded: false` — the consumer hasn't run yet, so we don't
 * actually know if it's a fresh event or a replay. The DO doesn't
 * use `recorded` to gate the charger reply, only to log, so this is
 * accurate to "we know the queue accepted it; ingest will tell us
 * the rest." The eventId echoed is the one we sent so correlation
 * still works in tail.
 */
export async function enqueueOrPost(
  env: GatewayEnv,
  event: IngestEvent,
): Promise<IngestOutcome> {
  if (env.OCPP_EVENTS_QUEUE) {
    const startedAt = Date.now();
    try {
      await env.OCPP_EVENTS_QUEUE.send(event);
      console.log("[ocpp-gw] enqueued", {
        eventId: event.eventId,
        eventType: event.eventType,
        sendMs: Date.now() - startedAt,
      });
      return { kind: "accepted", eventId: event.eventId, recorded: false };
    } catch (err) {
      // Queue accept failed — log and fall through to the service-
      // binding path so we don't drop the event. The runbook flags
      // sustained queue-accept failures as a deploy/binding issue.
      console.warn("[ocpp-gw] queue.send failed, falling back to postEvent", {
        eventId: event.eventId,
        sendMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const outcome = await postEvent(env, event);
  console.log("[ocpp-gw] posted_fallback", {
    eventId: event.eventId,
    eventType: event.eventType,
    kind: outcome.kind,
  });
  return outcome;
}
