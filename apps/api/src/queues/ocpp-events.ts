// Inbound OCPP events queue consumer (Sprint 5 / ADR 0017).
//
// The gateway DO enqueues IngestEvent envelopes onto
// `straumvakt-ocpp-events-staging` (or its prod counterpart) instead of
// awaiting a synchronous service-binding write. This consumer drains
// the queue and runs the same `ingestEvent` repository call that the
// legacy /api/internal/ocpp-events route does, preserving the
// idempotency invariant (event_log_raw_protocol unique on event_id).
//
// ── P4.12 — batch partitioning (ADR 0035) ────────────────────────────
//
// Sprint 7 added a raw-SQL fast path, but gated it on EVERY message in
// the batch being a heartbeat. That condition stops holding as soon as
// sessions are running: at ~250 concurrent sessions a MeterValue lands
// in almost every one-second batch window, so ~99% of batches fell back
// to the per-event Prisma loop — the exact ingest ceiling ADR 0017
// named for MeterValues.
//
// This consumer now PARTITIONS the batch instead of requiring
// homogeneity. Heartbeats go through the batched raw-SQL transaction;
// everything else goes through the per-event Prisma path, unchanged.
// One StopTransaction no longer drags 99 heartbeats onto the slow path.
//
// **What deliberately did NOT change**, and must not without a fresh
// Rule 5 review:
//   • `projections.ts` is not touched. Not one line.
//   • `ingestEventInTx` is not touched.
//   • Billing math, tariff resolution and ledger writes stay entirely
//     on the Prisma path.
//   • The atomicity invariant holds on both paths: an event's log row
//     and its projection commit together or not at all.
//
// ── ADR 0039 D1 — where the log row lands ────────────────────────────
//
// Neither partition of this batch changed shape. What changed is the
// TABLE each path's log row goes to: `raw_protocol` envelopes (every
// `ocpp.raw.*` frame the gateway mints, heartbeats included) now write
// to events.protocol_log; domain facts still write to
// events.event_log. Both destinations keep the same idempotency
// semantics — the idempotency_keys ON CONFLICT DO NOTHING on the raw
// path, the Serializable findUnique/create on the Prisma path — and
// both still report which envelopes were fresh, so the archive fanout
// below is byte-for-byte unaffected.
//
// The decision lives in the write helpers (lib/db/raw.ts
// `logTableFor`, lib/ocpp/events-repository.ts) keyed on retention
// class, NOT here on event type. This consumer's partitioning is a
// throughput concern and is orthogonal: a heartbeat is fast-path
// because its projection is one batchable UPDATE, and protocol_log
// because it is a raw frame. Do not fuse the two conditions.
//
// Only heartbeats are eligible for the batched path, because their
// projection is a single batchable `UPDATE ocpp_identities SET
// last_seen_at`. MeterValues was considered and REJECTED: its
// projection early-returns unless the frame carries an OCMF
// `SignedData` blob, so most frames do no database work — but deciding
// eligibility by inspecting the payload would duplicate a condition
// living in projections.ts. If someone later adds database work before
// that OCMF check, the classifier silently starts skipping projections
// and drops signed billing evidence and EVCCID vehicle identity. That
// is the one place the OCPP path is sometimes the only source (the
// AMQP feed carries the same OCMF, and has died silently for 16h at a
// time). Not worth 19% of throughput. Revisit with P4-D measurements.
//
// Failure semantics:
//   • Validation error (envelope shape wrong) → permanent. ack() so
//     the Cloudflare Queues retry policy doesn't loop on poison
//     messages — DLQ catches the trail of bad shapes for forensics.
//     The legitimate version of this message can never appear (the
//     gateway can't synthesize a valid version after the fact), so
//     retry is wasted work.
//   • DB / transient error → retry(). Cloudflare Queues retries up to
//     `max_retries` (configured in wrangler.jsonc), then routes to
//     DLQ. Operator replays via apps/api/scripts/replay-dlq.ts after
//     the underlying issue (Postgres latency spike, Hyperdrive blip)
//     is resolved.
//   • Fast-path failure retries only the heartbeats. The Prisma path's
//     per-message isolation is unaffected.
//
// Observability (Sprint 5.4): structured single-line JSON logs for
// `wrangler tail`. Per-batch:
//   [ocpp-q] batch_start    — count, batch.queue
//   [ocpp-q] batch_summary  — acked/retried/dropped, path split, lag
// Per-message:
//   [ocpp-q] consumed             — successful ingest (Prisma path)
//   [ocpp-q] validation_failed    — poison drop
//   [ocpp-q] transient_failure    — retried
// All lines start with `[ocpp-q]` so `wrangler tail | grep ocpp-q` is
// the operator's first-look dashboard until P4.1's dashboards land.

import { makePrisma } from "../lib/prisma";
import { parseIngestEvent, type IngestEvent } from "../lib/ocpp/event-envelope";
import { ingestEvent } from "../lib/ocpp/events-repository";
// Side-effect import — registers projection handlers on first module load.
// Must mirror the legacy route's import to keep projection parity.
import "../lib/ocpp/bootstrap";
import { batchIngestHeartbeats, makePool } from "../lib/db/raw";
import type { MessageBatch, Message } from "@cloudflare/workers-types";
import type { Env, OcppEventMessage } from "../bindings";

// Heartbeat fast-path event types. The gateway DO emits
// 'ocpp.raw.Heartbeat' for the raw protocol frame; the legacy
// translator emitted 'charger.heartbeat'. Projections register on
// either name, and both project to the same single-statement UPDATE,
// so both are batchable.
const HEARTBEAT_EVENT_TYPES = new Set<string>([
  "ocpp.raw.Heartbeat",
  "charger.heartbeat",
]);

/** Cloudflare Queues caps a sendBatch call at 100 messages. */
const ARCHIVE_CHUNK = 100;

type ParsedMessage =
  | { ok: true; message: Message<OcppEventMessage>; event: IngestEvent }
  | { ok: false; message: Message<OcppEventMessage>; error: string };

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

/**
 * Fan out freshly-recorded envelopes to the archive queue (Sprint 7.4 /
 * ADR 0018 Decision 3).
 *
 * Post-commit and fire-and-forget by design: an R2/archive failure is
 * logged and never rolls back the Postgres ack. Two queues exist
 * precisely so an archive outage cannot block ingest.
 *
 * P4.13 — batched via `sendBatch` rather than one awaited `send` per
 * event. At 100 events that was 100 sequential round trips inside the
 * batch window.
 */
async function fanOutToArchive(
  env: Env,
  events: IngestEvent[],
): Promise<void> {
  if (!env.ARCHIVE_QUEUE || events.length === 0) return;
  for (let i = 0; i < events.length; i += ARCHIVE_CHUNK) {
    const chunk = events.slice(i, i + ARCHIVE_CHUNK);
    try {
      await env.ARCHIVE_QUEUE.sendBatch(chunk.map((body) => ({ body })));
    } catch (err) {
      console.error("[ocpp-q] archive_fanout_failed", {
        count: chunk.length,
        firstEventId: chunk[0]?.eventId ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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

  const recordLag = (event: IngestEvent): number | null => {
    const occurredAtMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAtMs)) return null;
    const lagMs = consumedAt - occurredAtMs;
    lagSamples.push(lagMs);
    return lagMs;
  };

  // ── Parse and partition ────────────────────────────────────────────
  // Heartbeats are batchable; everything else (and anything that fails
  // to parse) goes to the per-event Prisma path. Note the asymmetry:
  // eligibility is decided ONLY by event type, never by payload
  // inspection — see the header note on why MeterValues was rejected.
  const heartbeats: Array<{ message: Message<OcppEventMessage>; event: IngestEvent }> = [];
  const perEvent: ParsedMessage[] = [];

  for (const message of batch.messages) {
    const parsed = parseIngestEvent(message.body);
    if (parsed.ok && HEARTBEAT_EVENT_TYPES.has(parsed.event.eventType)) {
      heartbeats.push({ message, event: parsed.event });
    } else if (parsed.ok) {
      perEvent.push({ ok: true, message, event: parsed.event });
    } else {
      perEvent.push({ ok: false, message, error: parsed.error });
    }
  }

  // Envelopes recorded this run, for the archive fanout. Collected
  // across both paths and flushed once at the end.
  const freshForArchive: IngestEvent[] = [];

  // ── Fast path — batched heartbeat ingest ───────────────────────────
  if (heartbeats.length > 0) {
    // A fresh Pool per invocation is required, not wasteful: Workers
    // I/O isolation forbids reusing pg connections across requests
    // (see lib/db/raw.ts header). max=1 keeps it to a single
    // Hyperdrive-routed connection.
    const pool = makePool(env);
    try {
      const client = await pool.connect();
      try {
        const result = await batchIngestHeartbeats(
          client,
          heartbeats.map(({ event }) => ({
            eventId: event.eventId,
            orgId: event.orgId,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            correlationId: event.correlationId,
            retentionClass: event.retentionClass,
            payload: event.payload,
            occurredAt: event.occurredAt,
            schemaVersion: event.schemaVersion,
          })),
        );

        for (const { message, event } of heartbeats) {
          recordLag(event);
          message.ack();
        }
        acked += heartbeats.length;
        recorded += result.fresh;

        // P4.12 — archive exactly the events the INSERT reported as
        // fresh, matched by id. The previous `slice(0, fresh)` assumed
        // fresh events were the first N in input order, which is false
        // whenever the batch contains replays.
        const freshIds = new Set(result.freshEventIds);
        for (const { event } of heartbeats) {
          if (freshIds.has(event.eventId)) freshForArchive.push(event);
        }

        console.log("[ocpp-q] fast_path_consumed", {
          count: heartbeats.length,
          fresh: result.fresh,
          replays: result.replays,
          identitiesTouched: result.identitiesTouched,
        });
      } finally {
        client.release();
      }
    } catch (err) {
      // The batched transaction rolled back, so nothing was written.
      // Retry the heartbeats only — the Prisma partition below is
      // independent and still runs.
      console.error("[ocpp-q] fast_path_failed", {
        count: heartbeats.length,
        error: err instanceof Error ? err.message : String(err),
      });
      for (const { message } of heartbeats) message.retry();
      retried += heartbeats.length;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  // ── Per-event path — unchanged Prisma ingest ───────────────────────
  for (const entry of perEvent) {
    if (!entry.ok) {
      // Permanent — a bad shape can't fix itself on retry. Ack to drop;
      // CF Queues surfaces repeat offenders in the DLQ via max-retries
      // dynamics if the producer keeps emitting the same bad shape.
      console.error("[ocpp-q] validation_failed", {
        error: entry.error,
        eventId: (entry.message.body as { eventId?: unknown })?.eventId ?? null,
      });
      entry.message.ack();
      dropped++;
      continue;
    }

    try {
      const lagMs = recordLag(entry.event);
      const result = await ingestEvent(db, entry.event);

      // Only FRESH events fan out — replays already produced an archive
      // object on the original ingest.
      if (result.recorded) freshForArchive.push(entry.event);

      console.log("[ocpp-q] consumed", {
        eventId: entry.event.eventId,
        eventType: entry.event.eventType,
        recorded: result.recorded,
        lagMs,
      });
      entry.message.ack();
      acked++;
      if (result.recorded) recorded++;
    } catch (err) {
      // Transient — let CF Queues retry. After max_retries the message
      // routes to the DLQ for operator-driven replay.
      console.error("[ocpp-q] transient_failure", {
        eventId: entry.event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      entry.message.retry();
      retried++;
    }
  }

  // Post-commit, fire-and-forget. Never gates the Postgres ack.
  await fanOutToArchive(env, freshForArchive);

  // Single grep-able summary line at the end of every batch. Keys
  // chosen so `wrangler tail | grep batch_summary | jq` slices by
  // p95Lag, retried, dropped, path split, etc. without parsing the
  // per-message lines.
  const sortedLag = lagSamples.slice().sort((a, b) => a - b);
  console.log("[ocpp-q] batch_summary", {
    queue: batch.queue,
    count: batch.messages.length,
    batched: heartbeats.length,
    perEvent: perEvent.length,
    acked,
    retried,
    dropped,
    recorded,
    replays: acked - recorded,
    archived: freshForArchive.length,
    p50LagMs: percentile(sortedLag, 0.5),
    p95LagMs: percentile(sortedLag, 0.95),
    durationMs: Date.now() - consumedAt,
  });
}
