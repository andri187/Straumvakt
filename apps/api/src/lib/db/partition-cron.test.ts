// Sprint 7.2 — partition-cron date math tests. The actual `CREATE
// TABLE IF NOT EXISTS` execution is exercised via integration when
// the migration runs against staging Neon; here we lock in the
// pure-function behaviour of `planPartitions`.

import { describe, expect, it, vi } from "vitest";
import {
  planPartitions,
  ensureForwardPartitions,
  parsePartitionDay,
  partitionAgeDays,
  isPastRetention,
  isPartitionDropEnabled,
  decidePartitionDrop,
  dropExpiredPartitions,
  POSTGRES_RETENTION_DAYS,
} from "./partition-cron";
import type { PoolClient } from "pg";
import type { ArchiveWatermarkRow } from "./archive-watermark";

describe("planPartitions", () => {
  it("returns 14 plans for 7 forward days × 2 tables", () => {
    const now = new Date("2026-05-03T15:30:00.000Z");
    const plans = planPartitions(now);
    expect(plans).toHaveLength(14);
  });

  it("interleaves event_log + meter_values pairs day by day", () => {
    const now = new Date("2026-05-03T15:30:00.000Z");
    const plans = planPartitions(now);
    expect(plans[0].partition).toBe("event_log_p_20260503");
    expect(plans[1].partition).toBe("meter_values_p_20260503");
    expect(plans[2].partition).toBe("event_log_p_20260504");
    expect(plans[13].partition).toBe("meter_values_p_20260509");
  });

  it("UTC dates regardless of local-time offset of `now`", () => {
    // 2026-05-03 23:30 UTC is 2026-05-04 in some timezones; the
    // partition for "today" should be the UTC day, not the local day.
    const now = new Date("2026-05-03T23:30:00.000Z");
    const plans = planPartitions(now);
    expect(plans[0].partition).toBe("event_log_p_20260503");
    expect(plans[0].startUtc).toBe("2026-05-03 00:00:00+00");
    expect(plans[0].endUtc).toBe("2026-05-04 00:00:00+00");
  });

  it("handles month boundary correctly", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const plans = planPartitions(now);
    // Days 30, 31, then June 1, 2, 3, 4, 5.
    const eventNames = plans.filter((p) => p.parent === "event_log").map((p) => p.partition);
    expect(eventNames).toEqual([
      "event_log_p_20260530",
      "event_log_p_20260531",
      "event_log_p_20260601",
      "event_log_p_20260602",
      "event_log_p_20260603",
      "event_log_p_20260604",
      "event_log_p_20260605",
    ]);
  });

  it("handles year boundary correctly", () => {
    const now = new Date("2026-12-30T12:00:00.000Z");
    const plans = planPartitions(now);
    const eventNames = plans.filter((p) => p.parent === "event_log").map((p) => p.partition);
    expect(eventNames).toEqual([
      "event_log_p_20261230",
      "event_log_p_20261231",
      "event_log_p_20270101",
      "event_log_p_20270102",
      "event_log_p_20270103",
      "event_log_p_20270104",
      "event_log_p_20270105",
    ]);
  });

  it("DDL contains the right partition name + range", () => {
    const now = new Date("2026-05-03T00:00:00.000Z");
    const plans = planPartitions(now);
    const first = plans[0];
    expect(first.ddl).toContain("event_log_p_20260503");
    expect(first.ddl).toContain("PARTITION OF");
    expect(first.ddl).toContain("'2026-05-03 00:00:00+00'");
    expect(first.ddl).toContain("'2026-05-04 00:00:00+00'");
    expect(first.ddl).toContain("CREATE TABLE IF NOT EXISTS");
  });
});

describe("ensureForwardPartitions", () => {
  it("calls one query per planned partition; succeeded counts on no-throw", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    const now = new Date("2026-05-03T00:00:00.000Z");
    const result = await ensureForwardPartitions(client, now);
    expect(result.attempted).toBe(14);
    expect(result.succeeded).toBe(14);
    expect(result.failed).toEqual([]);
    expect(queries).toHaveLength(14);
  });

  it("counts failures per partition; loop continues across them", async () => {
    let nthCall = 0;
    const client = {
      query: vi.fn(async () => {
        nthCall++;
        if (nthCall === 5 || nthCall === 9) {
          throw new Error(`simulated DDL failure on call ${nthCall}`);
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;
    const now = new Date("2026-05-03T00:00:00.000Z");
    const result = await ensureForwardPartitions(client, now);
    expect(result.attempted).toBe(14);
    expect(result.succeeded).toBe(12);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].error).toContain("simulated DDL failure");
  });
});

// ═══════════════════════════════════════════════════════════════════
// P4.15 / ADR 0037 D5 — partition retention
// ═══════════════════════════════════════════════════════════════════

describe("parsePartitionDay", () => {
  it("extracts the UTC day from the naming convention", () => {
    expect(parsePartitionDay("event_log_p_20260726")).toBe("2026-07-26");
    expect(parsePartitionDay("meter_values_p_20270101")).toBe("2027-01-01");
  });

  it("returns null for anything that is not a dated partition", () => {
    // A child of the parent we can't date is never a drop candidate.
    expect(parsePartitionDay("event_log")).toBeNull();
    expect(parsePartitionDay("event_log_legacy")).toBeNull();
    expect(parsePartitionDay("event_log_p_default")).toBeNull();
    expect(parsePartitionDay("event_log_p_2026072")).toBeNull();
  });

  it("rejects a calendar-invalid date rather than rolling it forward", () => {
    // new Date('2026-02-31') silently becomes March 3. A partition
    // named that way is corrupt, not eight days older than it looks.
    expect(parsePartitionDay("event_log_p_20260231")).toBeNull();
    expect(parsePartitionDay("event_log_p_20261301")).toBeNull();
  });
});

describe("partitionAgeDays", () => {
  it("counts whole UTC days from the partition's day", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(partitionAgeDays("2026-08-02", now)).toBe(0);
    expect(partitionAgeDays("2026-08-01", now)).toBe(1);
    expect(partitionAgeDays("2026-07-26", now)).toBe(7);
    expect(partitionAgeDays("2026-07-25", now)).toBe(8);
  });

  it("ignores the time of day — 00:01 and 23:59 give the same age", () => {
    expect(partitionAgeDays("2026-07-25", new Date("2026-08-02T00:00:01.000Z"))).toBe(8);
    expect(partitionAgeDays("2026-07-25", new Date("2026-08-02T23:59:59.000Z"))).toBe(8);
  });

  it("spans month and year boundaries", () => {
    expect(partitionAgeDays("2026-12-28", new Date("2027-01-05T09:00:00.000Z"))).toBe(8);
  });
});

describe("isPastRetention — the boundary", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");

  it("raw_protocol keeps 7 days per ADR 0017 §5", () => {
    expect(POSTGRES_RETENTION_DAYS.raw_protocol).toBe(7);
  });

  it("requires age STRICTLY greater than the window", () => {
    // A partition for day D holds recorded_at in [D, D+1), so at age
    // exactly 7 its newest rows are only 6-and-a-bit days old. Waiting
    // one more day is what makes "kept for 7 days" true of every row.
    expect(isPastRetention("raw_protocol", "2026-07-27", now)).toBe(false); // age 6
    expect(isPastRetention("raw_protocol", "2026-07-26", now)).toBe(false); // age 7
    expect(isPastRetention("raw_protocol", "2026-07-25", now)).toBe(true); // age 8
    expect(isPastRetention("raw_protocol", "2026-07-24", now)).toBe(true); // age 9
  });

  it("never expires the indefinite classes, however old", () => {
    const ancient = "2020-01-01";
    expect(isPastRetention("financial", ancient, now)).toBe(false);
    expect(isPastRetention("operational", ancient, now)).toBe(false);
    // Classes ADR 0017 gives no Postgres window are indefinite too —
    // an undeclared retention must never read as "expire it."
    expect(isPastRetention("aggregate", ancient, now)).toBe(false);
    expect(isPastRetention("issue_history", ancient, now)).toBe(false);
  });
});

describe("isPartitionDropEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(isPartitionDropEnabled({})).toBe(false);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "" })).toBe(false);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "0" })).toBe(false);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "false" })).toBe(false);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "no" })).toBe(false);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "yes" })).toBe(false);
  });

  it("accepts only 1 / true", () => {
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "1" })).toBe(true);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: "true" })).toBe(true);
    expect(isPartitionDropEnabled({ PARTITION_DROP_ENABLED: " TRUE " })).toBe(true);
  });
});

describe("decidePartitionDrop — the watermark gate", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const BASE = {
    schema: "events",
    parent: "event_log",
    partition: "event_log_p_20260725", // age 8
  };

  function mark(
    retentionClass: ArchiveWatermarkRow["retentionClass"],
    day: string,
    objectCount: number,
  ): ArchiveWatermarkRow {
    return {
      retentionClass,
      day,
      objectCount,
      lastWriteAt: new Date("2026-07-26T00:05:00.000Z"),
    };
  }

  it("drops when the watermark matches the partition's rows", () => {
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
      ],
      watermarks: [mark("raw_protocol", "2026-07-25", 1200)],
      now,
    });
    expect(d.eligible).toBe(true);
    expect(d.blockedBy).toEqual([]);
    expect(d.totalRows).toBe(1200);
    expect(d.ddl).toEqual([
      'ALTER TABLE "events"."event_log" DETACH PARTITION "events"."event_log_p_20260725";',
      'DROP TABLE "events"."event_log_p_20260725";',
    ]);
  });

  it("refuses when there is no watermark row at all — fail closed", () => {
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
      ],
      watermarks: [],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["no_watermark:raw_protocol@2026-07-25"]);
    expect(d.groups[0].archived).toBeNull();
  });

  it("refuses when a watermark exists for a different day", () => {
    // Presence of *a* watermark is not proof; it must be the one for
    // the day whose objects these rows became.
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
      ],
      watermarks: [mark("raw_protocol", "2026-07-24", 99999)],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["no_watermark:raw_protocol@2026-07-25"]);
  });

  it("refuses when a watermark exists for a different class", () => {
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
      ],
      watermarks: [mark("financial", "2026-07-25", 99999)],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["no_watermark:raw_protocol@2026-07-25"]);
  });

  it("refuses on a shortfall — one unarchived row blocks the whole partition", () => {
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
      ],
      watermarks: [mark("raw_protocol", "2026-07-25", 1199)],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual([
      "watermark_shortfall:raw_protocol@2026-07-25:1199<1200",
    ]);
  });

  it("allows a surplus — R2 PUT is idempotent by key, so a retry inflates the count", () => {
    // Blocking on surplus would let a single queue retry deadlock the
    // gate permanently, while the object set is in fact complete.
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
      ],
      watermarks: [mark("raw_protocol", "2026-07-25", 1205)],
      now,
    });
    expect(d.eligible).toBe(true);
  });

  it("checks every group — a late-arriving day is compared against ITS own watermark", () => {
    // Recorded on 07-25, occurred on 07-24: the object landed under
    // the 07-24 prefix, so that is the watermark it must clear.
    const groups = [
      { retentionClass: "raw_protocol" as const, occurredDay: "2026-07-25", rows: 1200 },
      { retentionClass: "raw_protocol" as const, occurredDay: "2026-07-24", rows: 3 },
    ];
    const both = decidePartitionDrop({
      ...BASE,
      groups,
      watermarks: [
        mark("raw_protocol", "2026-07-25", 1200),
        mark("raw_protocol", "2026-07-24", 3),
      ],
      now,
    });
    expect(both.eligible).toBe(true);
    expect(both.totalRows).toBe(1203);

    const missingLate = decidePartitionDrop({
      ...BASE,
      groups,
      watermarks: [mark("raw_protocol", "2026-07-25", 1200)],
      now,
    });
    expect(missingLate.eligible).toBe(false);
    expect(missingLate.blockedBy).toEqual(["no_watermark:raw_protocol@2026-07-24"]);
  });

  it("refuses a partition holding ANY indefinite class, however well archived", () => {
    // The partition is per-day, not per-class. Dropping a day that
    // still holds financial rows destroys billing evidence — the exact
    // failure ADR 0037 exists to prevent.
    const d = decidePartitionDrop({
      ...BASE,
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1200 },
        { retentionClass: "financial", occurredDay: "2026-07-25", rows: 4 },
      ],
      watermarks: [
        mark("raw_protocol", "2026-07-25", 1200),
        mark("financial", "2026-07-25", 4),
      ],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["retention_indefinite:financial"]);
  });

  it("refuses a partition still inside its window", () => {
    const d = decidePartitionDrop({
      ...BASE,
      partition: "event_log_p_20260726", // age 7 — not yet past
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-26", rows: 10 },
      ],
      watermarks: [mark("raw_protocol", "2026-07-26", 10)],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["within_retention:raw_protocol"]);
  });

  it("refuses an empty partition — absence of proof is not proof", () => {
    const d = decidePartitionDrop({
      ...BASE,
      groups: [],
      watermarks: [],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["no_rows_and_no_archive_proof"]);
  });

  it("refuses a partition whose name it cannot date", () => {
    const d = decidePartitionDrop({
      ...BASE,
      partition: "event_log_p_default",
      groups: [
        { retentionClass: "raw_protocol", occurredDay: "2026-07-25", rows: 1 },
      ],
      watermarks: [mark("raw_protocol", "2026-07-25", 1)],
      now,
    });
    expect(d.eligible).toBe(false);
    expect(d.blockedBy).toEqual(["unparsable_partition_name"]);
  });
});

// ── dropExpiredPartitions — IO orchestration ───────────────────────

interface DropScenario {
  partitions: string[];
  /** partition name → GROUP BY rows */
  groups: Record<
    string,
    Array<{ retention_class: string; occurred_day: string; rows: number }>
  >;
  watermarks: Array<{
    retention_class: string;
    day: string;
    object_count: number;
    last_write_at: string;
  }>;
}

function dropClient(scenario: DropScenario): {
  client: PoolClient;
  sql: string[];
  destructive: string[];
} {
  const sql: string[] = [];
  const destructive: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      sql.push(text);
      if (/DETACH PARTITION|DROP TABLE/.test(text)) {
        destructive.push(text);
        // Simulate the partition disappearing from the catalog.
        const m = /"(event_log_p_\d{8})"/.exec(text);
        if (m && /DROP TABLE/.test(text)) {
          scenario.partitions = scenario.partitions.filter((p) => p !== m[1]);
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("pg_inherits")) {
        return {
          rows: scenario.partitions.map((partition) => ({ partition })),
          rowCount: scenario.partitions.length,
        };
      }
      if (text.includes("archive_watermark")) {
        return { rows: scenario.watermarks, rowCount: scenario.watermarks.length };
      }
      const m = /"events"\."(event_log_p_\d{8})"/.exec(text);
      const rows = (m && scenario.groups[m[1]]) || [];
      return { rows, rowCount: rows.length };
    }),
  } as unknown as PoolClient;
  return { client, sql, destructive };
}

describe("dropExpiredPartitions", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");

  function archivedScenario(): DropScenario {
    return {
      // age 8 (droppable), age 7 (too young), age 0 (today's hot one)
      partitions: [
        "event_log_p_20260725",
        "event_log_p_20260726",
        "event_log_p_20260802",
      ],
      groups: {
        event_log_p_20260725: [
          { retention_class: "raw_protocol", occurred_day: "2026-07-25", rows: 1200 },
        ],
      },
      watermarks: [
        {
          retention_class: "raw_protocol",
          day: "2026-07-25",
          object_count: 1200,
          last_write_at: "2026-07-26T00:05:00.000Z",
        },
      ],
    };
  }

  it("is DRY RUN by default — no DETACH, no DROP, ever", async () => {
    const scenario = archivedScenario();
    const { client, destructive } = dropClient(scenario);
    const result = await dropExpiredPartitions(client, { now });
    expect(result.dryRun).toBe(true);
    expect(destructive).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.wouldDrop).toEqual(["event_log_p_20260725"]);
    // Still there afterwards.
    expect(scenario.partitions).toContain("event_log_p_20260725");
  });

  it("dry run is explicit about the enable flag being off, not merely absent", async () => {
    const { client, destructive } = dropClient(archivedScenario());
    const result = await dropExpiredPartitions(client, { now, enabled: false });
    expect(result.dryRun).toBe(true);
    expect(destructive).toEqual([]);
  });

  it("detaches then drops when explicitly enabled", async () => {
    const scenario = archivedScenario();
    const { client, destructive } = dropClient(scenario);
    const result = await dropExpiredPartitions(client, { now, enabled: true });
    expect(result.dryRun).toBe(false);
    expect(result.dropped).toEqual(["event_log_p_20260725"]);
    expect(destructive).toHaveLength(2);
    expect(destructive[0]).toContain("DETACH PARTITION");
    expect(destructive[1]).toContain("DROP TABLE");
    // Detach must precede drop — a drop on an attached partition takes
    // an ACCESS EXCLUSIVE lock on the parent and stalls ingest.
    expect(destructive[0].indexOf("DETACH")).toBeGreaterThan(-1);
  });

  it("skips partitions younger than the shortest window without scanning them", async () => {
    const { client, sql } = dropClient(archivedScenario());
    const result = await dropExpiredPartitions(client, { now });
    expect(result.considered).toBe(1);
    // Today's hot partition must never be counted.
    expect(sql.some((s) => s.includes("event_log_p_20260802"))).toBe(false);
    expect(sql.some((s) => s.includes("event_log_p_20260726"))).toBe(false);
  });

  it("does not drop when the watermark is missing — fail closed end to end", async () => {
    const scenario = archivedScenario();
    scenario.watermarks = [];
    const { client, destructive } = dropClient(scenario);
    const result = await dropExpiredPartitions(client, { now, enabled: true });
    expect(destructive).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.blocked).toEqual([
      {
        partition: "event_log_p_20260725",
        reasons: ["no_watermark:raw_protocol@2026-07-25"],
      },
    ]);
  });

  it("does not drop when the watermark falls short", async () => {
    const scenario = archivedScenario();
    scenario.watermarks[0].object_count = 1199;
    const { client, destructive } = dropClient(scenario);
    const result = await dropExpiredPartitions(client, { now, enabled: true });
    expect(destructive).toEqual([]);
    expect(result.blocked[0].reasons).toEqual([
      "watermark_shortfall:raw_protocol@2026-07-25:1199<1200",
    ]);
  });

  it("is idempotent across repeated ticks — dry run", async () => {
    const scenario = archivedScenario();
    const { client, destructive } = dropClient(scenario);
    const first = await dropExpiredPartitions(client, { now });
    const second = await dropExpiredPartitions(client, { now });
    const third = await dropExpiredPartitions(client, { now });
    expect(destructive).toEqual([]);
    expect(second.wouldDrop).toEqual(first.wouldDrop);
    expect(third.wouldDrop).toEqual(first.wouldDrop);
  });

  it("is idempotent across repeated ticks — enabled; the second tick is a no-op", async () => {
    const scenario = archivedScenario();
    const { client, destructive } = dropClient(scenario);
    const first = await dropExpiredPartitions(client, { now, enabled: true });
    expect(first.dropped).toEqual(["event_log_p_20260725"]);
    expect(destructive).toHaveLength(2);

    const second = await dropExpiredPartitions(client, { now, enabled: true });
    expect(second.dropped).toEqual([]);
    expect(second.considered).toBe(0);
    // No further destructive statements — the partition is gone from
    // pg_inherits, so there is nothing left to decide about.
    expect(destructive).toHaveLength(2);
  });

  it("records a per-partition failure without aborting the sweep", async () => {
    const scenario = archivedScenario();
    scenario.partitions = ["event_log_p_20260724", "event_log_p_20260725"];
    scenario.groups.event_log_p_20260724 = [
      { retention_class: "raw_protocol", occurred_day: "2026-07-24", rows: 5 },
    ];
    let calls = 0;
    const base = dropClient(scenario);
    const client = {
      query: vi.fn(async (text: string) => {
        calls++;
        if (text.includes("event_log_p_20260724") && text.includes("GROUP BY")) {
          throw new Error("relation vanished mid-sweep");
        }
        return (base.client as unknown as { query: (t: string) => Promise<unknown> }).query(
          text,
        );
      }),
    } as unknown as PoolClient;
    const result = await dropExpiredPartitions(client, { now });
    expect(calls).toBeGreaterThan(1);
    expect(result.failed).toEqual([
      {
        partition: "event_log_p_20260724",
        error: "relation vanished mid-sweep",
      },
    ]);
    expect(result.wouldDrop).toEqual(["event_log_p_20260725"]);
  });

  it("leaves charging.meter_values alone — no retention_class, no gate, no drop", async () => {
    const { client, sql } = dropClient(archivedScenario());
    await dropExpiredPartitions(client, { now, enabled: true });
    expect(sql.some((s) => s.includes("meter_values"))).toBe(false);
  });
});
