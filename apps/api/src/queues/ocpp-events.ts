// Inbound OCPP events queue consumer (Sprint 5 / ADR 0017).
//
// The gateway DO enqueues IngestEvent envelopes onto
// `straumvakt-ocpp-events-staging` (or its prod counterpart) instead of
// awaiting a synchronous service-binding write. This consumer drains
// the queue and runs the same `ingestEvent` repository call that the
// legacy /api/internal/ocpp-events route does, preserving the
// idempotency invariant (event_log_raw_protocol unique on event_id).
//
// Failure semantics:
//   • Validation error (envelope shape wrong) → permanent. ack() so
//     the Cloudflare Queues retry policy doesn't loop on poison
//     messages — DLQ catches the trail of bad shapes for forensics.
//     The legitimate version of this message can never appear (the
//     gateway can't synthesize a valid version after the fact), so
//     retry is wasted work.
//   • DB / transient error → throw. Cloudflare Queues retries up to
//     `max_retries` (configured in wrangler.jsonc), then routes to
//     DLQ. Operator replays via apps/api/scripts/replay-dlq.ts after
//     the underlying issue (Postgres latency spike, Hyperdrive blip)
//     is resolved.
//
// Sprint 5.3 will refine this with explicit replay tests + a
// ValidationError exception type. Sprint 5.4 adds structured log
// lines for queue depth / batch lag / DLQ counts so `wrangler tail`
// can be the operator's read-only dashboard until Sprint 10's full
// observability lands.

import { makePrisma } from "../lib/prisma";
import { parseIngestEvent } from "../lib/ocpp/event-envelope";
import { ingestEvent } from "../lib/ocpp/events-repository";
// Side-effect import — registers projection handlers on first module load.
// Must mirror the legacy route's import to keep projection parity.
import "../lib/ocpp/bootstrap";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, OcppEventMessage } from "../bindings";

export async function handleOcppEventsBatch(
  batch: MessageBatch<OcppEventMessage>,
  env: Env,
): Promise<void> {
  const db = makePrisma(env);
  const consumedAt = Date.now();

  for (const message of batch.messages) {
    const parsed = parseIngestEvent(message.body);
    if (!parsed.ok) {
      // Permanent — bad shape can't fix itself on retry. Ack to drop;
      // CF Queues will surface in DLQ via max-retries dynamics if the
      // producer keeps emitting the same bad shape.
      console.error("[ocpp-q] validation_failed", {
        error: parsed.error,
        eventId: (message.body as { eventId?: unknown })?.eventId ?? null,
      });
      message.ack();
      continue;
    }

    try {
      const occurredAtMs = Date.parse(parsed.event.occurredAt);
      const lagMs = Number.isFinite(occurredAtMs)
        ? consumedAt - occurredAtMs
        : null;
      const result = await ingestEvent(db, parsed.event);
      console.log("[ocpp-q] consumed", {
        eventId: parsed.event.eventId,
        eventType: parsed.event.eventType,
        recorded: result.recorded,
        lagMs,
      });
      message.ack();
    } catch (err) {
      // Transient — let CF Queues retry. After max_retries the message
      // routes to the DLQ for operator-driven replay.
      console.error("[ocpp-q] transient_failure", {
        eventId: parsed.event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry();
    }
  }
}
