// Raw `pg` driver helpers — Sprint 7 / ADR 0018 Decision 2 foundation.
//
// This module hosts the raw-SQL write path for the categories ADR 0018
// commits to: time-series inserts (event_log), drift-column upserts,
// outbox dispatch. It coexists with Prisma — the queue consumer can
// reach for either depending on the event type.
//
// **Sprint 7.1 is foundation only.** The helpers in this module are
// exported and tested but NOT YET WIRED INTO THE CONSUMER. That happens
// in a later milestone (the fused "atomic raw-SQL ingest" — what was
// 7.1 + 7.3 combined) where raw SQL projections also exist. Until
// then the consumer continues using Prisma per-event so the Sprint 5
// atomicity invariant (event_log INSERT and projection in one
// transaction) holds.
//
// The reason this milestone ships foundation-only: switching to raw
// batch INSERT for event_log without also moving projections to raw
// SQL would break atomicity — projection failure would leave a log
// row inserted with no projected state. Sprint 5's tests (the
// "transient DB error" + "DLQ replay" cases) depend on that
// invariant. ADR 0018 Decision 2 commits to atomic raw ingest, but
// the implementation needs both halves.
//
// Workers runtime notes:
//   • Workers I/O isolation forbids reusing pg connections across
//     requests. Mint a fresh Pool per request, same as Prisma's
//     makePrisma factory does.
//   • Hyperdrive sits between us and Neon. The connection string
//     comes from env.HYPERDRIVE_DB.connectionString — same source
//     as Prisma adapter's. Hyperdrive handles upstream pooling; pg's
//     pool just needs to be sized for the isolate's parallelism (1
//     connection is plenty in practice).
//   • `pg` is already a transitive dep of @prisma/adapter-pg, so
//     no new package install needed.

import { Pool, type PoolClient } from "pg";
import type { Env } from "../../bindings";

/**
 * Per-request Pool factory. Workers I/O isolation means we can't
 * stash this at module scope — each isolate gets its own. In
 * practice the Pool ends up wrapping a single Hyperdrive-routed
 * connection because that's all one isolate can use; the pool API
 * is what `pg` exposes regardless.
 */
export function makePool(env: Env): Pool {
  return new Pool({
    connectionString: env.HYPERDRIVE_DB.connectionString,
    // Cloudflare Workers + Hyperdrive should resolve fast (Hyperdrive
    // is co-located with the Worker). 5s connect timeout catches
    // misconfiguration without holding the queue handler hostage.
    connectionTimeoutMillis: 5_000,
    // One connection per isolate is the realistic ceiling — Workers
    // can't use more than one at a time anyway. Setting max=1 makes
    // the pool's queue-on-busy behaviour explicit.
    max: 1,
  });
}

/**
 * Column names from `events.event_log` mirrored as a const so a
 * Prisma migration that renames a column surfaces in TypeScript at
 * compile time (the union of valid column names is the type of the
 * keys here).
 *
 * ADR 0039 D1 — `events.protocol_log` has the identical column set by
 * construction, so this map serves both destinations. If the two ever
 * diverge, this const has to split first.
 *
 * If you rename a column in prisma/schema.prisma, update this map AT
 * THE SAME TIME. The `npm run typecheck` step at sprint close is the
 * forcing function.
 */
export const EVENT_LOG_COLUMNS = {
  id: "id",
  orgId: "org_id",
  aggregateType: "aggregate_type",
  aggregateId: "aggregate_id",
  eventType: "event_type",
  schemaVersion: "schema_version",
  payload: "payload",
  metadata: "metadata",
  retentionClass: "retention_class",
  occurredAt: "occurred_at",
  recordedAt: "recorded_at",
} as const satisfies Record<string, string>;

export const IDEMPOTENCY_KEY_COLUMNS = {
  scope: "scope",
  key: "key",
  result: "result",
  createdAt: "created_at",
  expiresAt: "expires_at",
} as const satisfies Record<string, string>;

/**
 * Input shape for a batch event-log insert. Mirrors the IngestEvent
 * envelope shape from the gateway side (gateway/src/ingest-client.ts)
 * so callers can pass the queue message body directly.
 */
export interface EventLogInsert {
  orgId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  schemaVersion?: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  retentionClass:
    | "financial"
    | "operational"
    | "raw_protocol"
    | "aggregate"
    | "issue_history";
  occurredAt: string; // ISO-8601
}

export interface BatchInsertResult {
  inserted: Array<{ logEntryId: string }>;
  /** Number of rows the INSERT statement reported affected. */
  rowCount: number;
}

// ── ADR 0039 D1 — two destinations, one envelope shape ──────────────
//
// `raw_protocol` frames go to events.protocol_log; every other
// retention class stays in events.event_log. The tables are identical
// in shape, so this is purely a table-name decision made at write time
// — nothing downstream (projections, idempotency, archive fanout) sees
// a difference.
//
// Why it matters: retention can only be enforced by dropping a whole
// day partition, and a partition mixing 7-day frames with keep-forever
// billing facts is never droppable. Separating the tables is what makes
// P4.15's gate able to fire at all. See ADR 0039.

/** Non-raw_protocol classes — domain facts, retention indefinite. */
export const EVENT_LOG_TABLE = "event_log";
/** raw_protocol frames — 7-day forensics cache, R2 is the record. */
export const PROTOCOL_LOG_TABLE = "protocol_log";

/**
 * The `events` table an envelope's log row belongs in, decided solely
 * by retention class. Deliberately NOT by event type: the gateway sets
 * `raw_protocol` on every `ocpp.raw.*` frame, and a future frame type
 * must route correctly without anyone remembering to add it to a list.
 */
export function logTableFor(
  retentionClass: EventLogInsert["retentionClass"],
): string {
  return retentionClass === "raw_protocol"
    ? PROTOCOL_LOG_TABLE
    : EVENT_LOG_TABLE;
}

/**
 * Batch INSERT of event-log rows via multi-row VALUES statements.
 * Returns the new row ids in INPUT order. Does NOT touch
 * idempotency_keys — that's a separate batch helper below.
 *
 * ADR 0039 D1 — the batch is partitioned by destination table, so a
 * mixed batch issues one INSERT per table (in practice one, since a
 * heartbeat batch is uniformly `raw_protocol`). Ids are scattered back
 * into their input positions afterwards: callers pair
 * `inserted[i].logEntryId` with `events[i]`, and that contract has to
 * survive the split.
 *
 * Idempotency must be applied UPSTREAM by the caller (filter the
 * batch through an idempotency_keys lookup first), or DOWNSTREAM
 * by relying on this function being called only with already-fresh
 * events. The atomic ingest path (combined 7.1+7.3 milestone) wraps
 * both lookups + insert + projection writes in one transaction.
 */
export async function batchInsertEventLog(
  client: PoolClient,
  events: EventLogInsert[],
): Promise<BatchInsertResult> {
  if (events.length === 0) {
    return { inserted: [], rowCount: 0 };
  }

  // Input positions grouped by destination table, insertion-ordered so
  // a single-destination batch (the common case) fires exactly one
  // statement and behaves identically to the pre-split code.
  const positionsByTable = new Map<string, number[]>();
  for (let i = 0; i < events.length; i++) {
    const table = logTableFor(events[i].retentionClass);
    const bucket = positionsByTable.get(table);
    if (bucket) bucket.push(i);
    else positionsByTable.set(table, [i]);
  }

  const inserted = new Array<{ logEntryId: string }>(events.length);
  let rowCount = 0;

  for (const [table, positions] of positionsByTable) {
    const tuples: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const idx of positions) {
      const e = events[idx];
      tuples.push(
        `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}::jsonb, $${p + 6}::jsonb, $${p + 7}::"events"."RetentionClass", $${p + 8})`,
      );
      values.push(
        e.orgId,
        e.aggregateType,
        e.aggregateId,
        e.eventType,
        e.schemaVersion ?? 1,
        JSON.stringify(e.payload),
        JSON.stringify(e.metadata ?? {}),
        e.retentionClass,
        e.occurredAt,
      );
      // 9 columns × 9 placeholders per row (id is generated by the DB).
      p += 9;
    }

    const sql = `
    INSERT INTO "events"."${table}"
      (${EVENT_LOG_COLUMNS.orgId},
       ${EVENT_LOG_COLUMNS.aggregateType},
       ${EVENT_LOG_COLUMNS.aggregateId},
       ${EVENT_LOG_COLUMNS.eventType},
       ${EVENT_LOG_COLUMNS.schemaVersion},
       ${EVENT_LOG_COLUMNS.payload},
       ${EVENT_LOG_COLUMNS.metadata},
       ${EVENT_LOG_COLUMNS.retentionClass},
       ${EVENT_LOG_COLUMNS.occurredAt})
    VALUES ${tuples.join(",")}
    RETURNING ${EVENT_LOG_COLUMNS.id}
  `;

    const result = await client.query<{ id: string }>(sql, values);
    // RETURNING on a multi-row VALUES comes back in VALUES order, which
    // is `positions` order — scatter each id back to where its envelope
    // sat in the caller's array.
    result.rows.forEach((r, n) => {
      inserted[positions[n]] = { logEntryId: r.id };
    });
    rowCount += result.rowCount ?? 0;
  }

  return { inserted, rowCount };
}

/**
 * Batch lookup of idempotency_keys to filter out replays before a
 * batch event-log insert. Returns the set of (scope,key) pairs that
 * already exist, so the caller can partition the input batch into
 * "fresh" vs "replay."
 *
 * Foundation for the atomic-batch ingest path. Not wired into the
 * Sprint 5 consumer yet.
 */
export async function findExistingIdempotencyKeys(
  client: PoolClient,
  scope: string,
  keys: string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const placeholders = keys.map((_, i) => `$${i + 2}`).join(",");
  const sql = `
    SELECT ${IDEMPOTENCY_KEY_COLUMNS.key}
      FROM "events"."idempotency_keys"
     WHERE ${IDEMPOTENCY_KEY_COLUMNS.scope} = $1
       AND ${IDEMPOTENCY_KEY_COLUMNS.key} IN (${placeholders})
  `;
  const result = await client.query<{ key: string }>(sql, [scope, ...keys]);
  return new Set(result.rows.map((r) => r.key));
}

export interface IdempotencyKeyInsert {
  scope: string;
  key: string;
  result: unknown;
  /** TTL in milliseconds. expiresAt = now + ttl. */
  ttlMs: number;
}

/**
 * Batch INSERT into events.idempotency_keys. Uses ON CONFLICT
 * DO NOTHING so a concurrent consumer that snuck a write between
 * our findExistingIdempotencyKeys call and this insert doesn't
 * crash us — the second writer's insert is just discarded.
 */
export async function batchInsertIdempotencyKeys(
  client: PoolClient,
  inserts: IdempotencyKeyInsert[],
): Promise<{ rowCount: number }> {
  if (inserts.length === 0) return { rowCount: 0 };
  const tuples: string[] = [];
  const values: unknown[] = [];
  let p = 1;
  for (const ins of inserts) {
    tuples.push(`($${p}, $${p + 1}, $${p + 2}::jsonb, $${p + 3}, $${p + 4})`);
    values.push(
      ins.scope,
      ins.key,
      JSON.stringify(ins.result),
      new Date(),
      new Date(Date.now() + ins.ttlMs),
    );
    p += 5;
  }
  const sql = `
    INSERT INTO "events"."idempotency_keys"
      (${IDEMPOTENCY_KEY_COLUMNS.scope},
       ${IDEMPOTENCY_KEY_COLUMNS.key},
       ${IDEMPOTENCY_KEY_COLUMNS.result},
       ${IDEMPOTENCY_KEY_COLUMNS.createdAt},
       ${IDEMPOTENCY_KEY_COLUMNS.expiresAt})
    VALUES ${tuples.join(",")}
    ON CONFLICT (${IDEMPOTENCY_KEY_COLUMNS.scope}, ${IDEMPOTENCY_KEY_COLUMNS.key}) DO NOTHING
  `;
  const result = await client.query(sql, values);
  return { rowCount: result.rowCount ?? 0 };
}

/**
 * Heartbeat-only fast-path batch ingest (Sprint 7 atomic-batch
 * milestone). Invariant: ALL events in `heartbeats` have
 * eventType='ocpp.raw.Heartbeat' (or 'charger.heartbeat'). Caller
 * partitions the batch.
 *
 * One pg transaction wraps:
 *   1. Batch lookup of existing idempotency_keys → partition into
 *      [fresh, replay].
 *   2. Batch INSERT the log rows for fresh events — into
 *      events.protocol_log, since heartbeats are `raw_protocol`
 *      (ADR 0039 D1). batchInsertEventLog routes by class.
 *   3. Batch UPDATE ocpp_identities last_seen_at = NOW() for the
 *      identities those fresh events came from.
 *   4. Batch INSERT idempotency_keys for fresh events.
 *
 * Atomicity preserved: rollback on any error rolls back all 4.
 *
 * Why heartbeats specifically: at 4k chargers × 30s heartbeat,
 * heartbeats are ~80% of all events. Their projection is trivially
 * batchable (single UPDATE statement on ocpp_identities). Other
 * event types (status, session.*, command_result) have multi-table
 * projections that would need substantially more work to convert
 * to raw SQL — out of scope for this milestone, stays Prisma.
 */
export interface HeartbeatBatchResult {
  fresh: number;
  replays: number;
  identitiesTouched: number;
  /**
   * Event IDs actually inserted by this call.
   *
   * P4.12 — the caller needs to know *which* events were fresh, not
   * merely how many. The archive fanout previously did
   * `slice(0, result.fresh)`, which assumes fresh events are the first
   * N in input order; that only holds when the batch contains no
   * replays. With replays interleaved it archived the wrong events.
   */
  freshEventIds: string[];
}

export async function batchIngestHeartbeats(
  client: PoolClient,
  heartbeats: Array<{
    eventId: string;
    orgId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    correlationId: string;
    retentionClass: EventLogInsert["retentionClass"];
    payload: Record<string, unknown>;
    occurredAt: string;
    schemaVersion?: number;
  }>,
): Promise<HeartbeatBatchResult> {
  if (heartbeats.length === 0) {
    return { fresh: 0, replays: 0, identitiesTouched: 0, freshEventIds: [] };
  }
  const IDEMPOTENCY_SCOPE = "ocpp";
  const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  await client.query("BEGIN");
  try {
    // 1. Existing idempotency keys → partition
    const eventIds = heartbeats.map((h) => h.eventId);
    const existing = await findExistingIdempotencyKeys(
      client,
      IDEMPOTENCY_SCOPE,
      eventIds,
    );
    const fresh = heartbeats.filter((h) => !existing.has(h.eventId));

    if (fresh.length === 0) {
      await client.query("COMMIT");
      return {
        fresh: 0,
        replays: heartbeats.length,
        identitiesTouched: 0,
        freshEventIds: [],
      };
    }

    // 2. Batch INSERT the log rows. Destination is chosen from each
    //    envelope's retention class inside batchInsertEventLog —
    //    heartbeats are `raw_protocol`, so in practice this lands in
    //    events.protocol_log (ADR 0039 D1).
    const insertResult = await batchInsertEventLog(
      client,
      fresh.map((h) => ({
        orgId: h.orgId,
        aggregateType: h.aggregateType,
        aggregateId: h.aggregateId,
        eventType: h.eventType,
        schemaVersion: h.schemaVersion,
        payload: h.payload,
        metadata: { correlationId: h.correlationId },
        retentionClass: h.retentionClass,
        occurredAt: h.occurredAt,
      })),
    );

    // 3. Batch UPDATE ocpp_identities last_seen_at. The aggregateId
    //    on heartbeat events is the OcppIdentity UUID. Distinct
    //    identity IDs only — multiple heartbeats from the same
    //    charger in one batch resolve to one UPDATE.
    const distinctIdentityIds = Array.from(
      new Set(fresh.map((h) => h.aggregateId)),
    );
    const updateResult = await client.query(
      `UPDATE "ocpp"."ocpp_identities"
          SET "last_seen_at" = NOW()
        WHERE "id" = ANY($1::uuid[])`,
      [distinctIdentityIds],
    );

    // 4. Batch INSERT idempotency_keys
    await batchInsertIdempotencyKeys(
      client,
      fresh.map((h, i) => ({
        scope: IDEMPOTENCY_SCOPE,
        key: h.eventId,
        result: {
          accepted: true,
          eventId: h.eventId,
          recorded: true,
          logEntryId: insertResult.inserted[i]?.logEntryId ?? null,
        },
        ttlMs: IDEMPOTENCY_TTL_MS,
      })),
    );

    await client.query("COMMIT");
    return {
      fresh: fresh.length,
      replays: heartbeats.length - fresh.length,
      identitiesTouched: updateResult.rowCount ?? 0,
      freshEventIds: fresh.map((h) => h.eventId),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
