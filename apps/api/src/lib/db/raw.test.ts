// Sprint 7.1 — raw SQL helpers tests. The pg pool itself is mocked
// (we don't connect to Hyperdrive in unit tests); we verify the SQL
// shape + parameter binding for batch insert + idempotency lookup.

import { describe, expect, it, vi } from "vitest";
import {
  batchInsertEventLog,
  findExistingIdempotencyKeys,
  type EventLogInsert,
} from "./raw";
import type { PoolClient } from "pg";

function makeClient(rowsByCall: Array<{ rows: unknown[]; rowCount?: number }>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let i = 0;
  const client = {
    query: vi.fn(async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      const result = rowsByCall[i++] ?? { rows: [], rowCount: 0 };
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    }),
  };
  return { client: client as unknown as PoolClient, calls };
}

const SAMPLE: EventLogInsert = {
  orgId: "11111111-1111-1111-1111-111111111111",
  aggregateType: "ocpp_identity",
  aggregateId: "22222222-2222-2222-2222-222222222222",
  eventType: "ocpp.raw.Heartbeat",
  payload: { action: "Heartbeat", request: {} },
  retentionClass: "raw_protocol",
  occurredAt: "2026-05-03T15:00:00.000Z",
};

describe("batchInsertEventLog", () => {
  it("empty batch is a no-op (no SQL fired)", async () => {
    const { client, calls } = makeClient([]);
    const result = await batchInsertEventLog(client, []);
    expect(result.rowCount).toBe(0);
    expect(result.inserted).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("single-row batch fires one INSERT with correct placeholders", async () => {
    const { client, calls } = makeClient([
      { rows: [{ id: "log-1" }] },
    ]);
    const result = await batchInsertEventLog(client, [SAMPLE]);
    expect(result.rowCount).toBe(1);
    expect(result.inserted).toEqual([{ logEntryId: "log-1" }]);
    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("event_log");
    expect(sql).toContain("RETURNING");
    // Placeholders for one row: 9 columns = $1..$9
    expect(sql).toContain("$1");
    expect(sql).toContain("$9");
    expect(sql).not.toContain("$10");
    // Values bound match the inputs.
    expect(calls[0].values).toEqual([
      SAMPLE.orgId,
      SAMPLE.aggregateType,
      SAMPLE.aggregateId,
      SAMPLE.eventType,
      1, // schemaVersion default
      JSON.stringify(SAMPLE.payload),
      JSON.stringify({}), // metadata default
      SAMPLE.retentionClass,
      SAMPLE.occurredAt,
    ]);
  });

  it("multi-row batch fires one INSERT with N tuples", async () => {
    const { client, calls } = makeClient([
      { rows: [{ id: "log-1" }, { id: "log-2" }, { id: "log-3" }] },
    ]);
    const events = [SAMPLE, SAMPLE, SAMPLE];
    const result = await batchInsertEventLog(client, events);
    expect(result.rowCount).toBe(3);
    expect(result.inserted.map((i) => i.logEntryId)).toEqual([
      "log-1",
      "log-2",
      "log-3",
    ]);
    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    // 3 rows × 9 placeholders = $1..$27
    expect(sql).toContain("$27");
    expect(sql).not.toContain("$28");
    expect(calls[0].values).toHaveLength(27);
  });

  it("explicit schemaVersion and metadata override defaults", async () => {
    const { client, calls } = makeClient([{ rows: [{ id: "log-1" }] }]);
    const event: EventLogInsert = {
      ...SAMPLE,
      schemaVersion: 3,
      metadata: { correlationId: "corr-123" },
    };
    await batchInsertEventLog(client, [event]);
    expect(calls[0].values[4]).toBe(3);
    expect(calls[0].values[6]).toBe(JSON.stringify({ correlationId: "corr-123" }));
  });

  it("payload and metadata serialise as JSONB", async () => {
    const { client, calls } = makeClient([{ rows: [{ id: "log-1" }] }]);
    await batchInsertEventLog(client, [SAMPLE]);
    const sql = calls[0].sql;
    expect(sql).toContain("::jsonb");
    // Two ::jsonb casts (payload + metadata).
    expect(sql.match(/::jsonb/g)?.length).toBe(2);
  });

  it("retention_class is cast to the enum type", async () => {
    const { client, calls } = makeClient([{ rows: [{ id: "log-1" }] }]);
    await batchInsertEventLog(client, [SAMPLE]);
    expect(calls[0].sql).toContain('::"events"."RetentionClass"');
  });
});

describe("batchInsertIdempotencyKeys", () => {
  it("empty batch is a no-op", async () => {
    const { client, calls } = makeClient([]);
    const { batchInsertIdempotencyKeys } = await import("./raw");
    const result = await batchInsertIdempotencyKeys(client, []);
    expect(result.rowCount).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("ON CONFLICT DO NOTHING is included", async () => {
    const { client, calls } = makeClient([{ rows: [], rowCount: 1 }]);
    const { batchInsertIdempotencyKeys } = await import("./raw");
    await batchInsertIdempotencyKeys(client, [
      { scope: "ocpp", key: "evt-1", result: { ok: true }, ttlMs: 60_000 },
    ]);
    expect(calls[0].sql).toContain("ON CONFLICT");
    expect(calls[0].sql).toContain("DO NOTHING");
  });

  it("five placeholders per row (scope, key, result, createdAt, expiresAt)", async () => {
    const { client, calls } = makeClient([{ rows: [], rowCount: 2 }]);
    const { batchInsertIdempotencyKeys } = await import("./raw");
    await batchInsertIdempotencyKeys(client, [
      { scope: "ocpp", key: "evt-1", result: { ok: true }, ttlMs: 60_000 },
      { scope: "ocpp", key: "evt-2", result: { ok: true }, ttlMs: 60_000 },
    ]);
    // 2 rows × 5 placeholders = 10
    expect(calls[0].values).toHaveLength(10);
  });
});

describe("batchIngestHeartbeats", () => {
  it("empty batch returns zero counts without firing SQL", async () => {
    const { client, calls } = makeClient([]);
    const { batchIngestHeartbeats } = await import("./raw");
    const result = await batchIngestHeartbeats(client, []);
    expect(result).toEqual({ fresh: 0, replays: 0, identitiesTouched: 0 });
    expect(calls).toHaveLength(0);
  });

  it("all-fresh batch: BEGIN → SELECT → INSERT log → UPDATE identities → INSERT idem → COMMIT", async () => {
    const { client, calls } = makeClient([
      // BEGIN
      { rows: [], rowCount: 0 },
      // SELECT idempotency_keys (empty — all fresh)
      { rows: [], rowCount: 0 },
      // INSERT event_log RETURNING id
      { rows: [{ id: "log-1" }, { id: "log-2" }], rowCount: 2 },
      // UPDATE ocpp_identities ... = ANY(...)
      { rows: [], rowCount: 2 },
      // INSERT idempotency_keys
      { rows: [], rowCount: 2 },
      // COMMIT
      { rows: [], rowCount: 0 },
    ]);
    const { batchIngestHeartbeats } = await import("./raw");
    const result = await batchIngestHeartbeats(client, [
      {
        eventId: "evt-1",
        orgId: "org-1",
        aggregateType: "ocpp_identity",
        aggregateId: "id-1",
        eventType: "ocpp.raw.Heartbeat",
        correlationId: "corr-1",
        retentionClass: "raw_protocol",
        payload: {},
        occurredAt: "2026-05-03T12:00:00Z",
      },
      {
        eventId: "evt-2",
        orgId: "org-1",
        aggregateType: "ocpp_identity",
        aggregateId: "id-2",
        eventType: "ocpp.raw.Heartbeat",
        correlationId: "corr-2",
        retentionClass: "raw_protocol",
        payload: {},
        occurredAt: "2026-05-03T12:00:30Z",
      },
    ]);
    expect(result.fresh).toBe(2);
    expect(result.replays).toBe(0);
    expect(result.identitiesTouched).toBe(2);
    expect(calls.map((c) => c.sql.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "INSERT",
      "UPDATE",
      "INSERT",
      "COMMIT",
    ]);
  });

  it("all-replay batch: short-circuits after SELECT (no INSERT, no UPDATE)", async () => {
    const { client, calls } = makeClient([
      // BEGIN
      { rows: [], rowCount: 0 },
      // SELECT idempotency_keys returns BOTH keys (replays)
      { rows: [{ key: "evt-1" }, { key: "evt-2" }], rowCount: 2 },
      // COMMIT
      { rows: [], rowCount: 0 },
    ]);
    const { batchIngestHeartbeats } = await import("./raw");
    const result = await batchIngestHeartbeats(client, [
      {
        eventId: "evt-1",
        orgId: "org-1",
        aggregateType: "ocpp_identity",
        aggregateId: "id-1",
        eventType: "ocpp.raw.Heartbeat",
        correlationId: "corr-1",
        retentionClass: "raw_protocol",
        payload: {},
        occurredAt: "2026-05-03T12:00:00Z",
      },
      {
        eventId: "evt-2",
        orgId: "org-1",
        aggregateType: "ocpp_identity",
        aggregateId: "id-2",
        eventType: "ocpp.raw.Heartbeat",
        correlationId: "corr-2",
        retentionClass: "raw_protocol",
        payload: {},
        occurredAt: "2026-05-03T12:00:30Z",
      },
    ]);
    expect(result.fresh).toBe(0);
    expect(result.replays).toBe(2);
    expect(result.identitiesTouched).toBe(0);
    // Only 3 SQL: BEGIN, SELECT, COMMIT
    expect(calls).toHaveLength(3);
  });

  it("rolls back on error and rethrows", async () => {
    let nthCall = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        nthCall++;
        if (nthCall === 3) {
          // Fail on the INSERT event_log call
          throw new Error("simulated INSERT failure");
        }
        // Return realistic shapes for BEGIN, SELECT, ROLLBACK
        if (sql.startsWith("BEGIN")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    const { batchIngestHeartbeats } = await import("./raw");
    await expect(
      batchIngestHeartbeats(client, [
        {
          eventId: "evt-1",
          orgId: "org-1",
          aggregateType: "ocpp_identity",
          aggregateId: "id-1",
          eventType: "ocpp.raw.Heartbeat",
          correlationId: "corr-1",
          retentionClass: "raw_protocol",
          payload: {},
          occurredAt: "2026-05-03T12:00:00Z",
        },
      ]),
    ).rejects.toThrow("simulated INSERT failure");
    // We expect: BEGIN, SELECT, INSERT (failed), ROLLBACK = 4 calls
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(((client.query as ReturnType<typeof vi.fn>).mock.calls[3][0] as string).trim().startsWith("ROLLBACK")).toBe(true);
  });

  it("DISTINCT identity IDs in UPDATE: 3 events from 2 chargers → 1 UPDATE with 2-element array", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values: values ?? [] });
        if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT")) return { rows: [], rowCount: 0 };
        if (sql.includes("INSERT INTO \"events\".\"event_log\"")) {
          return {
            rows: [{ id: "log-1" }, { id: "log-2" }, { id: "log-3" }],
            rowCount: 3,
          };
        }
        if (sql.includes("UPDATE")) return { rows: [], rowCount: 2 };
        if (sql.includes("INSERT INTO \"events\".\"idempotency_keys\"")) return { rows: [], rowCount: 3 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    const { batchIngestHeartbeats } = await import("./raw");
    await batchIngestHeartbeats(client, [
      {
        eventId: "evt-1", orgId: "org-1", aggregateType: "ocpp_identity",
        aggregateId: "id-A", eventType: "ocpp.raw.Heartbeat", correlationId: "c1",
        retentionClass: "raw_protocol", payload: {}, occurredAt: "2026-05-03T12:00:00Z",
      },
      {
        eventId: "evt-2", orgId: "org-1", aggregateType: "ocpp_identity",
        aggregateId: "id-A", eventType: "ocpp.raw.Heartbeat", correlationId: "c2",
        retentionClass: "raw_protocol", payload: {}, occurredAt: "2026-05-03T12:00:30Z",
      },
      {
        eventId: "evt-3", orgId: "org-1", aggregateType: "ocpp_identity",
        aggregateId: "id-B", eventType: "ocpp.raw.Heartbeat", correlationId: "c3",
        retentionClass: "raw_protocol", payload: {}, occurredAt: "2026-05-03T12:00:31Z",
      },
    ]);
    const updateCall = calls.find((c) => c.sql.includes("UPDATE"));
    expect(updateCall).toBeDefined();
    // The values bound to UPDATE should be [array-of-2-uuids]
    expect(Array.isArray(updateCall!.values[0])).toBe(true);
    expect((updateCall!.values[0] as string[]).sort()).toEqual(["id-A", "id-B"]);
  });
});

describe("findExistingIdempotencyKeys", () => {
  it("empty keys list returns empty set, no SQL fired", async () => {
    const { client, calls } = makeClient([]);
    const result = await findExistingIdempotencyKeys(client, "ocpp", []);
    expect(result.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("returns the subset of keys that exist", async () => {
    const { client, calls } = makeClient([
      { rows: [{ key: "evt-2" }, { key: "evt-3" }] },
    ]);
    const result = await findExistingIdempotencyKeys(client, "ocpp", [
      "evt-1",
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
    expect(result.has("evt-1")).toBe(false);
    expect(result.has("evt-2")).toBe(true);
    expect(result.has("evt-3")).toBe(true);
    expect(result.has("evt-4")).toBe(false);
    expect(result.size).toBe(2);
    expect(calls).toHaveLength(1);
    // Verify the SQL: scope is $1, keys are $2..$5.
    expect(calls[0].sql).toContain("WHERE");
    expect(calls[0].sql).toContain("$1");
    expect(calls[0].sql).toContain("$5");
    expect(calls[0].sql).not.toContain("$6");
    expect(calls[0].values).toEqual(["ocpp", "evt-1", "evt-2", "evt-3", "evt-4"]);
  });

  it("returns an empty set when no keys match", async () => {
    const { client } = makeClient([{ rows: [] }]);
    const result = await findExistingIdempotencyKeys(client, "ocpp", [
      "evt-fresh-1",
      "evt-fresh-2",
    ]);
    expect(result.size).toBe(0);
  });
});
