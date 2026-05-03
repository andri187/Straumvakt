// Partition lifecycle cron — Sprint 7.2 / ADR 0018 Decision 1.
//
// Runs from the apps/api scheduled handler (every 5 minutes per
// wrangler.jsonc). Idempotent: ensures forward-looking partitions
// exist for events.event_log + charging.meter_values; harmless when
// they already do.
//
// What it does NOT do (yet):
//   • Detach/drop partitions older than the retention window. The
//     archive consumer (Sprint 7.4) drains old partitions to R2 and
//     then drops them. Until 7.4 lands, partitions accumulate; that's
//     fine at staging volume.
//
// What it DOES do:
//   • Computes the set of partition names we want to exist for the
//     next 7 days (today + 6) based on the runtime clock.
//   • Issues `CREATE TABLE IF NOT EXISTS ... PARTITION OF ...` for
//     each. The IF NOT EXISTS makes the call cheap when we're already
//     covered.
//
// Naming convention matches the bootstrap migration:
//   event_log_p_<yyyymmdd>     in schema "events"
//   meter_values_p_<yyyymmdd>  in schema "charging"
//
// One INSERT into a missing partition would fail with
// "no partition of relation found for row" — the +7-day buffer means
// a single failed cron tick still leaves 6 days of headroom before
// any tail risk. Operator-visible signal: scheduled handler logs
// `[partition-cron] created` lines on partition creation.

import type { PoolClient } from "pg";

interface PartitionPlan {
  schema: string;
  parent: string;
  partition: string;
  startUtc: string; // YYYY-MM-DD 00:00:00+00
  endUtc: string;
  ddl: string;
}

const FORWARD_DAYS = 7;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function utcDateAddDays(now: Date, daysOffset: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d;
}

function yyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function isoMidnight(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00+00`;
}

/**
 * Builds the list of partition CREATE statements for the next
 * FORWARD_DAYS days (today + FORWARD_DAYS-1). Pure function — call
 * with `new Date()` from the cron handler. Exported for the unit test.
 */
export function planPartitions(now: Date): PartitionPlan[] {
  const plans: PartitionPlan[] = [];
  for (let i = 0; i < FORWARD_DAYS; i++) {
    const start = utcDateAddDays(now, i);
    const end = utcDateAddDays(now, i + 1);
    const yyyy = yyyymmdd(start);
    plans.push({
      schema: "events",
      parent: "event_log",
      partition: `event_log_p_${yyyy}`,
      startUtc: isoMidnight(start),
      endUtc: isoMidnight(end),
      ddl: `CREATE TABLE IF NOT EXISTS "events"."event_log_p_${yyyy}" PARTITION OF "events"."event_log" FOR VALUES FROM ('${isoMidnight(start)}') TO ('${isoMidnight(end)}');`,
    });
    plans.push({
      schema: "charging",
      parent: "meter_values",
      partition: `meter_values_p_${yyyy}`,
      startUtc: isoMidnight(start),
      endUtc: isoMidnight(end),
      ddl: `CREATE TABLE IF NOT EXISTS "charging"."meter_values_p_${yyyy}" PARTITION OF "charging"."meter_values" FOR VALUES FROM ('${isoMidnight(start)}') TO ('${isoMidnight(end)}');`,
    });
  }
  return plans;
}

export interface PartitionCronResult {
  attempted: number;
  succeeded: number;
  failed: Array<{ partition: string; error: string }>;
}

/**
 * Idempotently ensures the next FORWARD_DAYS days of partitions
 * exist. Errors per-partition are logged and counted but do not
 * abort the loop — cron must remain best-effort across partition
 * names.
 */
export async function ensureForwardPartitions(
  client: PoolClient,
  now: Date = new Date(),
): Promise<PartitionCronResult> {
  const plans = planPartitions(now);
  const result: PartitionCronResult = {
    attempted: plans.length,
    succeeded: 0,
    failed: [],
  };
  for (const plan of plans) {
    try {
      await client.query(plan.ddl);
      result.succeeded++;
    } catch (err) {
      result.failed.push({
        partition: plan.partition,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
