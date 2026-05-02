/**
 * Gateway → API Worker ingest client.
 *
 * After the translator produces a domain event envelope from an OCPP
 * message, we POST it to `/api/internal/ocpp-events` on the bound
 * MAIN_APP service. Sprint 4.5 production cutover renames the URL
 * from `/api/ocpp/events` for prefix consistency with the other
 * internal routes (ocpp-auth, ocpp-authorize, pending-discovery).
 *
 * Bindings per environment (after Sprint 4.5):
 *   • staging → MAIN_APP=hlada-api-staging
 *   • prod    → MAIN_APP=hlada-api
 *
 * The api Worker dual-mounts both URLs during the transition window
 * so a stale gateway binary or an out-of-order deploy doesn't 404.
 * Once both gateway environments are redeployed with this code, a
 * follow-up commit drops the legacy `/api/ocpp/events` mount on the
 * api Worker.
 *
 * The caller (the DO) decides whether to retry on failure — this
 * module just returns the structured outcome.
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
