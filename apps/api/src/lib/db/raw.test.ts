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
