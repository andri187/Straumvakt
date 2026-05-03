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
import { parseIngestEvent, type IngestEvent } from "../lib/ocpp/event-envelope";
import { ingestEvent } from "../lib/ocpp/events-repository";
// Side-effect import — registers projection handlers on first module load.
// Must mirror the legacy route's import to keep projection parity.
import "../lib/ocpp/bootstrap";
import { batchIngestHeartbeats, makePool } from "../lib/db/raw";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, OcppEventMessage } from "../bindings";

// Sprint 7 atomic-batch milestone — heartbeat fast-path event types.
// At 4k chargers × 30s, heartbeats are ~80% of all events; their
// projection is a one-statement UPDATE that batches trivially. When
// a batch consists ENTIRELY of heartbeat events, we route through
// the raw-SQL fast path (lib/db/raw.ts → batchIngestHeartbeats).
// Mixed batches stay on the per-event Prisma path below.
//
// The gateway DO emits 'ocpp.raw.Heartbeat' for the raw protocol
// frame; projections register on either name today. Both go through
// the fast path.
const HEARTBEAT_EVENT_TYPES = new Set<string>([
  "ocpp.raw.Heartbeat",
  "charger.heartbeat",
]);

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
  let fastPathUsed = false;

  console.log("[ocpp-q] batch_start", {
    queue: batch.queue,
    count: batch.messages.length,
  });

  // Sprint 7 atomic-batch fast path — pre-parse and detect a
  // pure-heartbeat batch. If every message validates AND every
  // event is a heartbeat, route through the raw-SQL fast path.
  // Any validation failure or non-heartbeat event drops back to
  // the slow path.
  const preParsed: Array<
    | { ok: true; index: number; message: typeof batch.messages[number]; event: IngestEvent }
    | { ok: false; index: number; message: typeof batch.messages[number]; error: string }
  > = batch.messages.map((message, index) => {
    const parsed = parseIngestEvent(message.body);
    if (parsed.ok) return { ok: true as const, index, message, event: parsed.event };
    return { ok: false as const, index, message, error: parsed.error };
  });

  const allValid = preParsed.every((p) => p.ok);
  const allHeartbeats =
    allValid &&
    preParsed.every(
      (p) => p.ok && HEARTBEAT_EVENT_TYPES.has(p.event.eventType),
    );

  if (allHeartbeats && batch.messages.length > 0) {
    const validEvents = preParsed
      .filter((p): p is { ok: true; index: number; message: typeof batch.messages[number]; event: IngestEvent } => p.ok)
      .map((p) => p.event);
    const pool = makePool(env);
    try {
      const client = await pool.connect();
      try {
        const result = await batchIngestHeartbeats(
          client,
          validEvents.map((e) => ({
            eventId: e.eventId,
            orgId: e.orgId,
            aggregateType: e.aggregateType,
            aggregateId: e.aggregateId,
            eventType: e.eventType,
            correlationId: e.correlationId,
            retentionClass: e.retentionClass,
            payload: e.payload,
            occurredAt: e.occurredAt,
            schemaVersion: e.schemaVersion,
          })),
        );
        // Fast path success — ack every message and accumulate
        // counts for the summary line.
        for (const p of preParsed) {
          if (p.ok) {
            const occurredAtMs = Date.parse(p.event.occurredAt);
            if (Number.isFinite(occurredAtMs)) {
              lagSamples.push(consumedAt - occurredAtMs);
            }
          }
          p.message.ack();
        }
        acked = batch.messages.length;
        recorded = result.fresh;
        fastPathUsed = true;

        // Fan out fresh events to the archive queue (Sprint 7.4)
        // post-commit so an archive failure doesn't roll back the
        // event_log INSERT.
        if (env.ARCHIVE_QUEUE) {
          for (const e of validEvents.slice(0, result.fresh)) {
            try {
              await env.ARCHIVE_QUEUE.send(e);
            } catch (err) {
              console.error("[ocpp-q] archive_fanout_failed", {
                eventId: e.eventId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        console.log("[ocpp-q] fast_path_consumed", {
          count: validEvents.length,
          fresh: result.fresh,
          replays: result.replays,
          identitiesTouched: result.identitiesTouched,
        });
      } finally {
        client.release();
      }
    } catch (err) {
      // Fast path threw — the whole batch retries. Per-message
      // isolation is sacrificed in this case (CF Queues redelivers
      // the whole batch). On retry the slow path could still run
      // if the bug re-occurs, so we mark all messages retry().
      console.error("[ocpp-q] fast_path_failed", {
        count: batch.messages.length,
        error: err instanceof Error ? err.message : String(err),
      });
      for (const message of batch.messages) message.retry();
      retried = batch.messages.length;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  // Slow path — runs when the fast path didn't (mixed batch, any
  // validation failure, or fastPathUsed=false from the early-out
  // pure-heartbeat-but-empty case).
  if (!fastPathUsed) {
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

      // Sprint 7.4 / ADR 0018 Decision 3 — fan out to archive queue.
      // Only fans out FRESH events (not replays) since replays
      // already produced an archive object on the original ingest.
      // Failure here is logged but does NOT throw — Postgres ack is
      // independent of archive ack per the architectural decision.
      if (result.recorded && env.ARCHIVE_QUEUE) {
        try {
          await env.ARCHIVE_QUEUE.send(parsed.event);
        } catch (err) {
          console.error("[ocpp-q] archive_fanout_failed", {
            eventId: parsed.event.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

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
  }

  // Single grep-able summary line at the end of every batch. Keys
  // chosen so `wrangler tail | grep batch_summary | jq` slices by
  // p95Lag, retried, dropped, etc. without parsing the per-message
  // lines.
  const sortedLag = lagSamples.slice().sort((a, b) => a - b);
  console.log("[ocpp-q] batch_summary", {
    queue: batch.queue,
    count: batch.messages.length,
    path: fastPathUsed ? "fast" : "slow",
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
