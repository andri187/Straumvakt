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
// Observability (Sprint 5.4): structured single-line JSON logs for
// `wrangler tail`. Per-batch:
//   [ocpp-q] batch_start    — count, batch.queue
//   [ocpp-q] batch_summary  — counts of acked/retried/dropped, p50/p95 lag
// Per-message:
//   [ocpp-q] consumed             — successful ingest
//   [ocpp-q] validation_failed    — poison drop
//   [ocpp-q] transient_failure    — retried
// All lines start with `[ocpp-q]` so `wrangler tail | grep ocpp-q` is
// the operator's first-look dashboard until Sprint 10's Grafana wiring.

import { makePrisma } from "../lib/prisma";
import { parseIngestEvent } from "../lib/ocpp/event-envelope";
import { ingestEvent } from "../lib/ocpp/events-repository";
// Side-effect import — registers projection handlers on first module load.
// Must mirror the legacy route's import to keep projection parity.
import "../lib/ocpp/bootstrap";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, OcppEventMessage } from "../bindings";

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

export async function handleOcppEventsBatch(
  batch: MessageBatch<OcppEventMessage>,
  env: Env,
): Promise<void> {
  const db = makePrisma(env);
  const consumedAt = Date.now();
  const lagSamples: number[] = [];
  let acked = 0;
  let retried = 0;
  let dropped = 0;
  let recorded = 0;

  console.log("[ocpp-q] batch_start", {
    queue: batch.queue,
    count: batch.messages.length,
  });

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
      dropped++;
      continue;
    }

    try {
      const occurredAtMs = Date.parse(parsed.event.occurredAt);
      const lagMs = Number.isFinite(occurredAtMs)
        ? consumedAt - occurredAtMs
        : null;
      if (lagMs !== null) lagSamples.push(lagMs);
      const result = await ingestEvent(db, parsed.event);
      console.log("[ocpp-q] consumed", {
        eventId: parsed.event.eventId,
        eventType: parsed.event.eventType,
        recorded: result.recorded,
        lagMs,
      });
      message.ack();
      acked++;
      if (result.recorded) recorded++;
    } catch (err) {
      // Transient — let CF Queues retry. After max_retries the message
      // routes to the DLQ for operator-driven replay.
      console.error("[ocpp-q] transient_failure", {
        eventId: parsed.event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry();
      retried++;
    }
  }

  // Single grep-able summary line at the end of every batch. Keys
  // chosen so `wrangler tail | grep batch_summary | jq` slices by
  // p95Lag, retried, dropped, etc. without parsing the per-message
  // lines.
  const sortedLag = lagSamples.slice().sort((a, b) => a - b);
  console.log("[ocpp-q] batch_summary", {
    queue: batch.queue,
    count: batch.messages.length,
    acked,
    retried,
    dropped,
    recorded,
    replays: acked - recorded,
    p50LagMs: percentile(sortedLag, 0.5),
    p95LagMs: percentile(sortedLag, 0.95),
    durationMs: Date.now() - consumedAt,
  });
}
