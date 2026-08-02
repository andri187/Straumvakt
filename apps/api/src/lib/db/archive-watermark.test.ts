// ADR 0037 D5 — archive watermark. The pure folding logic and the
// shape of the SQL both matter: an upsert that SET the count instead
// of adding to it would silently lose every concurrent consumer's
// work, and the drop gate would then read a number too small to ever
// clear. Locking the additive form in a test is cheap insurance.

import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  aggregateWatermarkDeltas,
  readArchiveWatermarks,
  upsertArchiveWatermarks,
  utcDayOf,
  watermarkKey,
} from "./archive-watermark";

function fakeClient(rows: unknown[] = []): {
  client: PoolClient;
  calls: Array<{ sql: string; values?: unknown[] }>;
} {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows, rowCount: rows.length };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe("utcDayOf", () => {
  it("returns the UTC calendar day, not the local one", () => {
    expect(utcDayOf("2026-05-03T23:59:59.999Z")).toBe("2026-05-03");
    expect(utcDayOf("2026-05-04T00:00:00.000Z")).toBe("2026-05-04");
  });

  it("zero-pads month and day", () => {
    expect(utcDayOf("2026-01-09T12:00:00.000Z")).toBe("2026-01-09");
  });
});

describe("aggregateWatermarkDeltas", () => {
  it("folds a batch to one delta per (class, day)", () => {
    const deltas = aggregateWatermarkDeltas([
      { retentionClass: "raw_protocol", occurredAt: "2026-05-03T01:00:00.000Z" },
      { retentionClass: "raw_protocol", occurredAt: "2026-05-03T02:00:00.000Z" },
      { retentionClass: "financial", occurredAt: "2026-05-03T03:00:00.000Z" },
      { retentionClass: "raw_protocol", occurredAt: "2026-05-04T00:30:00.000Z" },
    ]);
    expect(deltas).toEqual(
      expect.arrayContaining([
        { retentionClass: "raw_protocol", day: "2026-05-03", objects: 2 },
        { retentionClass: "financial", day: "2026-05-03", objects: 1 },
        { retentionClass: "raw_protocol", day: "2026-05-04", objects: 1 },
      ]),
    );
    expect(deltas).toHaveLength(3);
  });

  it("returns no deltas for an empty batch", () => {
    expect(aggregateWatermarkDeltas([])).toEqual([]);
  });

  it("never emits the same key twice — ON CONFLICT cannot hit a row twice in one statement", () => {
    const deltas = aggregateWatermarkDeltas(
      Array.from({ length: 50 }, () => ({
        retentionClass: "raw_protocol" as const,
        occurredAt: "2026-05-03T01:00:00.000Z",
      })),
    );
    const keys = deltas.map((d) => watermarkKey(d.retentionClass, d.day));
    expect(new Set(keys).size).toBe(keys.length);
    expect(deltas[0].objects).toBe(50);
  });
});

describe("upsertArchiveWatermarks", () => {
  it("issues nothing for an empty delta list", async () => {
    const { client, calls } = fakeClient();
    const result = await upsertArchiveWatermarks(client, []);
    expect(calls).toHaveLength(0);
    expect(result.rowCount).toBe(0);
  });

  it("increments rather than overwrites on conflict", async () => {
    const { client, calls } = fakeClient([{}]);
    await upsertArchiveWatermarks(client, [
      { retentionClass: "raw_protocol", day: "2026-05-03", objects: 7 },
    ]);
    const sql = calls[0].sql.replace(/\s+/g, " ");
    expect(sql).toContain('ON CONFLICT (retention_class, day)');
    expect(sql).toContain(
      'object_count = "events"."archive_watermark".object_count + EXCLUDED.object_count',
    );
    expect(calls[0].values).toEqual(["raw_protocol", "2026-05-03", 7]);
  });

  it("batches every delta into one statement", async () => {
    const { client, calls } = fakeClient([{}, {}]);
    await upsertArchiveWatermarks(client, [
      { retentionClass: "raw_protocol", day: "2026-05-03", objects: 2 },
      { retentionClass: "financial", day: "2026-05-03", objects: 1 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([
      "raw_protocol",
      "2026-05-03",
      2,
      "financial",
      "2026-05-03",
      1,
    ]);
  });
});

describe("readArchiveWatermarks", () => {
  it("short-circuits on an empty day list", async () => {
    const { client, calls } = fakeClient();
    expect(await readArchiveWatermarks(client, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("maps bigint counts back to numbers", async () => {
    const { client, calls } = fakeClient([
      {
        retention_class: "raw_protocol",
        day: "2026-05-03",
        object_count: "1204",
        last_write_at: "2026-05-04T00:11:00.000Z",
      },
    ]);
    const rows = await readArchiveWatermarks(client, ["2026-05-03"]);
    expect(calls[0].values).toEqual([["2026-05-03"]]);
    expect(rows).toEqual([
      {
        retentionClass: "raw_protocol",
        day: "2026-05-03",
        objectCount: 1204,
        lastWriteAt: new Date("2026-05-04T00:11:00.000Z"),
      },
    ]);
  });
});
