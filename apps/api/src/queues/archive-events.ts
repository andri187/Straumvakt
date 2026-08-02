// Archive consumer — Sprint 7.4 / ADR 0018 Decision 3.
//
// Drains straumvakt-archive-events-* queue. For every envelope:
//
//   1. Compute the R2 key per ADR 0037 D1 (amends ADR 0018 3b):
//        <retentionClass>/<orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz
//      where <chargingStationId> is the aggregateId for the
//      'ocpp_identity' aggregateType (the rule the gateway DO uses
//      today).
//
//   2. Serialise the envelope as JSON, gzip it, write to R2 with
//      `httpMetadata` carrying the eventType + retentionClass for
//      lifecycle filtering.
//
//   3. ack the message. R2 write failures retry per CF Queues
//      max_retries; after that the DLQ catches them. An R2 outage
//      thus cannot block the Postgres ack on the INBOUND consumer
//      (which is on a different queue).
//
// Why a separate queue (not the inbound consumer's job): per ADR
// 0018 Decision 3d, R2 write must NOT be on the Postgres-ack path.
// An R2 incident must not back-pressure the gateway → consumer →
// Postgres pipeline. Splitting the work across two queues with
// independent retry policies decouples the failure modes cleanly.

import type { MessageBatch, R2Bucket } from "@cloudflare/workers-types";
import type { Env, OcppEventMessage } from "../bindings";
import { parseIngestEvent } from "../lib/ocpp/event-envelope";
import { makePool } from "../lib/db/raw";
import {
  aggregateWatermarkDeltas,
  upsertArchiveWatermarks,
  type ArchiveWatermarkDelta,
} from "../lib/db/archive-watermark";

/**
 * Builds the R2 object key for an archived envelope. Pure function;
 * the consumer + tests both call it.
 *
 * ADR 0037 D1 — `retentionClass` leads the key. R2 lifecycle rules
 * match a literal string prefix and cannot read object metadata, so
 * tiered expiry ("expire raw_protocol at 7 days, never expire
 * financial") is only expressible if the class is IN the key. It used
 * to live in customMetadata only, which no lifecycle rule can see.
 */
export function buildArchiveKey(
  envelope: Pick<
    OcppEventMessage,
    "orgId" | "aggregateType" | "aggregateId" | "eventId" | "occurredAt" | "retentionClass"
  >,
): string {
  const ts = new Date(envelope.occurredAt);
  const yyyy = ts.getUTCFullYear();
  const mm = String(ts.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ts.getUTCDate()).padStart(2, "0");
  // The aggregate that "owns" the envelope from R2's POV is the
  // ChargingStation (so per-charger forensic queries are a single
  // prefix scan). For ocpp_identity envelopes that's the identity
  // UUID, which is keyed 1:1 to a ChargingStation today (Sprint 4
  // milestone 4.1's ADR 0012 model). For session.* and other
  // aggregateTypes the aggregateId is the right granularity already.
  const chargerKey = envelope.aggregateId;
  return `${envelope.retentionClass}/${envelope.orgId}/${yyyy}/${mm}/${dd}/${chargerKey}/${envelope.eventId}.json.gz`;
}

/**
 * Watermark sink. Injected so the unit tests can observe the deltas
 * without a Postgres binding; production wires the pg-backed
 * implementation below.
 */
export type WatermarkRecorder = (
  deltas: ArchiveWatermarkDelta[],
) => Promise<void>;

export interface ArchiveBatchDeps {
  recordWatermarks?: WatermarkRecorder;
}

/**
 * Default recorder — one short-lived pg pool per batch, one upsert
 * statement. ADR 0018 3d keeps R2 off the Postgres-ack path, and this
 * write does not violate that: it happens AFTER the R2 puts and after
 * the messages are acked, on a different queue from the inbound
 * consumer, and a failure here is swallowed. A missed watermark
 * increment can only ever UNDER-count, and the P4.15 drop gate
 * fails closed on an under-count — so losing this write costs a
 * delayed partition drop, never a lost row.
 */
async function recordWatermarksViaPg(
  env: Env,
  deltas: ArchiveWatermarkDelta[],
): Promise<void> {
  if (deltas.length === 0) return;
  const pool = makePool(env);
  try {
    const client = await pool.connect();
    try {
      await upsertArchiveWatermarks(client, deltas);
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function gzip(payload: ArrayBuffer): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([payload]).stream().pipeThrough(cs);
  return await new Response(stream).arrayBuffer();
}

export async function handleArchiveEventsBatch(
  batch: MessageBatch<OcppEventMessage>,
  env: Env,
  deps: ArchiveBatchDeps = {},
): Promise<void> {
  const consumedAt = Date.now();
  let acked = 0;
  let retried = 0;
  let dropped = 0;
  let bytesWritten = 0;
  // Envelopes whose R2 put returned success. Only these count toward
  // the watermark — a retried message must not be counted until the
  // put that finally lands.
  const archived: Array<Pick<OcppEventMessage, "retentionClass" | "occurredAt">> = [];

  console.log("[archive-q] batch_start", {
    queue: batch.queue,
    count: batch.messages.length,
  });

  for (const message of batch.messages) {
    const parsed = parseIngestEvent(message.body);
    if (!parsed.ok) {
      // Malformed envelope at archive stage — same poison-message
      // logic as the inbound consumer. ACK so we don't retry-loop.
      // The inbound consumer's batch_summary will already have
      // surfaced the bad shape; the archive side just adds a log
      // line for forensic completeness.
      console.error("[archive-q] validation_failed", {
        error: parsed.error,
        eventId: (message.body as { eventId?: unknown })?.eventId ?? null,
      });
      message.ack();
      dropped++;
      continue;
    }

    try {
      const env_ = parsed.event;
      const key = buildArchiveKey(env_);
      const json = JSON.stringify(env_);
      const gzipped = await gzip(new TextEncoder().encode(json).buffer as ArrayBuffer);
      bytesWritten += gzipped.byteLength;

      // R2 PUT. httpMetadata carries content-type so signed-URL
      // downloads land as gzip. customMetadata carries the
      // retention_class + eventType so lifecycle rules + operator
      // forensics can slice without parsing the body.
      const bucket: R2Bucket = env.EVIDENCE_BUCKET;
      await bucket.put(key, gzipped, {
        httpMetadata: {
          contentType: "application/json",
          contentEncoding: "gzip",
        },
        customMetadata: {
          eventType: env_.eventType,
          retentionClass: env_.retentionClass,
          aggregateType: env_.aggregateType,
          schemaVersion: String(env_.schemaVersion ?? 1),
        },
      });

      console.log("[archive-q] archived", {
        eventId: env_.eventId,
        eventType: env_.eventType,
        key,
        bytes: gzipped.byteLength,
        retentionClass: env_.retentionClass,
      });
      message.ack();
      acked++;
      archived.push({
        retentionClass: env_.retentionClass,
        occurredAt: env_.occurredAt,
      });
    } catch (err) {
      console.error("[archive-q] r2_put_failed", {
        eventId: parsed.event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry();
      retried++;
    }
  }

  // ADR 0037 D5 — record what this batch archived so the P4.15
  // partition-drop gate has something to read. Deliberately after the
  // acks and deliberately non-fatal: an outage here must not turn a
  // successful R2 write into a queue retry (which would re-put the
  // object and inflate the count). Under-counting is the safe failure
  // direction — the drop gate refuses to drop on a shortfall.
  const deltas = aggregateWatermarkDeltas(archived);
  if (deltas.length > 0) {
    const record = deps.recordWatermarks ?? ((d) => recordWatermarksViaPg(env, d));
    try {
      await record(deltas);
    } catch (err) {
      console.error("[archive-q] watermark_upsert_failed", {
        deltas: deltas.length,
        objects: deltas.reduce((n, d) => n + d.objects, 0),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("[archive-q] batch_summary", {
    queue: batch.queue,
    count: batch.messages.length,
    acked,
    retried,
    dropped,
    bytesWritten,
    watermarkKeys: deltas.length,
    durationMs: Date.now() - consumedAt,
  });
}
