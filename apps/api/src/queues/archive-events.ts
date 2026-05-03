// Archive consumer — Sprint 7.4 / ADR 0018 Decision 3.
//
// Drains straumvakt-archive-events-* queue. For every envelope:
//
//   1. Compute the R2 key per ADR 0018 Decision 3b:
//        <orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz
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

/**
 * Builds the R2 object key for an archived envelope. Pure function;
 * the consumer + tests both call it.
 */
export function buildArchiveKey(
  envelope: Pick<OcppEventMessage, "orgId" | "aggregateType" | "aggregateId" | "eventId" | "occurredAt">,
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
  return `${envelope.orgId}/${yyyy}/${mm}/${dd}/${chargerKey}/${envelope.eventId}.json.gz`;
}

async function gzip(payload: ArrayBuffer): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([payload]).stream().pipeThrough(cs);
  return await new Response(stream).arrayBuffer();
}

export async function handleArchiveEventsBatch(
  batch: MessageBatch<OcppEventMessage>,
  env: Env,
): Promise<void> {
  const consumedAt = Date.now();
  let acked = 0;
  let retried = 0;
  let dropped = 0;
  let bytesWritten = 0;

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
    } catch (err) {
      console.error("[archive-q] r2_put_failed", {
        eventId: parsed.event.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry();
      retried++;
    }
  }

  console.log("[archive-q] batch_summary", {
    queue: batch.queue,
    count: batch.messages.length,
    acked,
    retried,
    dropped,
    bytesWritten,
    durationMs: Date.now() - consumedAt,
  });
}
