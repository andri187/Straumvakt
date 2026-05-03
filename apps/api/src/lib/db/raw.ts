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

/**
 * Batch INSERT into events.event_log via one multi-row VALUES
 * statement. Returns the new row ids in input order. Does NOT
 * touch idempotency_keys — that's a separate batch helper below.
 *
 * Idempotency must be applied UPSTREAM by the caller (filter the
 * batch through an idempotency_keys lookup first), or DOWNSTREAM
 * by relying on this function being called only with already-fresh
 * events. The atomic ingest path (combined 7.1+7.3 milestone) wraps
 * both lookups + insert + projection writes in one transaction.
 *
 * Sprint 7.1 ships this as foundation. Wiring into the consumer
 * happens in the atomic-batch milestone.
 */
export async function batchInsertEventLog(
  client: PoolClient,
  events: EventLogInsert[],
): Promise<BatchInsertResult> {
  if (events.length === 0) {
    return { inserted: [], rowCount: 0 };
  }

  const tuples: string[] = [];
  const values: unknown[] = [];
  let p = 1;
  for (const e of events) {
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
    INSERT INTO "events"."event_log"
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
  return {
    inserted: result.rows.map((r) => ({ logEntryId: r.id })),
    rowCount: result.rowCount ?? 0,
  };
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
