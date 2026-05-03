// Sprint 7.2 — partition-cron date math tests. The actual `CREATE
// TABLE IF NOT EXISTS` execution is exercised via integration when
// the migration runs against staging Neon; here we lock in the
// pure-function behaviour of `planPartitions`.

import { describe, expect, it, vi } from "vitest";
import {
  planPartitions,
  ensureForwardPartitions,
} from "./partition-cron";
import type { PoolClient } from "pg";

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
