// Partition lifecycle cron — Sprint 7.2 / ADR 0018 Decision 1.
//
// Runs from the apps/api scheduled handler (every 5 minutes per
// wrangler.jsonc). Idempotent: ensures forward-looking partitions
// exist for events.event_log + charging.meter_values; harmless when
// they already do.
//
// P4.15 / ADR 0037 D5 — it now ALSO detaches and drops partitions
// past their retention window, gated on the R2 archive watermark.
// See `planPartitionDrops` below for the gate; it is dry-run by
// default and every drop is fail-closed.
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
import type { RetentionClass } from "../../generated/prisma/client";
import {
  readArchiveWatermarks,
  watermarkKey,
  type ArchiveWatermarkRow,
} from "./archive-watermark";

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

// ═══════════════════════════════════════════════════════════════════
// Partition retention — P4.15 / ADR 0037 D5
// ═══════════════════════════════════════════════════════════════════
//
// Detach-and-drop of partitions past their retention window, gated on
// the R2 archive watermark. Three properties, in order of importance:
//
//   1. FAIL CLOSED. Every path that cannot positively prove a
//      partition's rows are archived returns "do not drop." No
//      watermark row, an unparsable partition name, a class with no
//      declared retention, a shortfall against the watermark — all
//      block. There is no "assume it's fine" branch.
//
//   2. DRY RUN BY DEFAULT. The destructive statements only execute
//      when the operator has explicitly set the enable flag. Every
//      other invocation logs exactly what it would have done, with
//      row counts and the watermark comparison, and touches nothing.
//
//   3. IDEMPOTENT. Decisions come from pg_inherits, so a dropped
//      partition simply stops appearing. Re-running a tick against an
//      unchanged database yields the same decisions and, in dry run,
//      the same zero destructive statements.

/**
 * Postgres-side retention per class, per ADR 0017 §5: 7 days for
 * `raw_protocol`, indefinite for `financial` and `operational`.
 *
 * `null` means indefinite — never dropped. Classes ADR 0017 does not
 * give a Postgres window (`aggregate`, `issue_history`) are null on
 * purpose: an undeclared retention must never be read as "expire it."
 * That is the fail-closed default. Note this is the POSTGRES window
 * and is independent of the R2 lifecycle ages in ADR 0037 D2 — a row
 * leaves the hot table long before its object leaves the bucket.
 */
export const POSTGRES_RETENTION_DAYS: Record<RetentionClass, number | null> = {
  financial: null,
  operational: null,
  raw_protocol: 7,
  aggregate: null,
  issue_history: null,
};

/**
 * Parents this cron will consider for dropping.
 *
 * `charging.meter_values` is deliberately absent. It has no
 * `retention_class` column, so no class-aware gate can be built for
 * it, and rule 1 says that means it does not get dropped. Adding it
 * would require ADR-level agreement on a meter-value retention window
 * plus its own archive proof.
 */
export const DROPPABLE_PARENTS: ReadonlyArray<{ schema: string; parent: string }> = [
  { schema: "events", parent: "event_log" },
];

/**
 * Enable flag. The drop is destructive and irreversible, so it is off
 * unless the operator turns it on deliberately:
 *
 *   wrangler secret put PARTITION_DROP_ENABLED --env staging   # "1"
 *
 * Anything other than "1" / "true" (case-insensitive), including
 * unset, empty, "0", "false" or a typo, means dry run.
 */
export function isPartitionDropEnabled(env: {
  PARTITION_DROP_ENABLED?: string;
}): boolean {
  const v = (env.PARTITION_DROP_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * `event_log_p_20260726` → `2026-07-26`. Returns null for any name
 * that is not a dated partition — an unrecognised child of the parent
 * is never a drop candidate.
 */
export function parsePartitionDay(partition: string): string | null {
  const m = /_p_(\d{4})(\d{2})(\d{2})$/.exec(partition);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  const asDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  // Reject e.g. 20260231, which Date rolls forward into March.
  if (yyyymmdd(asDate) !== `${yyyy}${mm}${dd}`) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Whole days between the partition's day and the UTC day of `now`.
 * Partition `2026-07-26` on 2026-07-27 is age 1.
 */
export function partitionAgeDays(partitionDay: string, now: Date): number {
  const start = Date.parse(`${partitionDay}T00:00:00.000Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - start) / 86_400_000);
}

/**
 * Is every row a partition CAN hold older than the class's window?
 *
 * A partition for day D covers `recorded_at` in [D, D+1), so its
 * newest possible row is a hair under one day younger than D. To
 * guarantee no row is dropped before it has served `retentionDays`,
 * the partition must be strictly older than the window — age 8 for a
 * 7-day class, not age 7. The off-by-one costs one day of storage and
 * buys the guarantee that the boundary can never eat a fresh row.
 */
export function isPastRetention(
  retentionClass: RetentionClass,
  partitionDay: string,
  now: Date,
): boolean {
  const window = POSTGRES_RETENTION_DAYS[retentionClass];
  if (window === null || window === undefined) return false;
  return partitionAgeDays(partitionDay, now) > window;
}

/** One (retention_class, occurred_at day) group of rows in a partition. */
export interface PartitionRowGroup {
  retentionClass: RetentionClass;
  /** UTC day of `occurred_at` — the day the R2 objects live under. */
  occurredDay: string;
  rows: number;
}

export interface PartitionGroupVerdict extends PartitionRowGroup {
  /** Objects the archive consumer recorded, or null when no row exists. */
  archived: number | null;
  /** null when the group is clear; otherwise why it blocks the drop. */
  blockedBy: string | null;
}

export interface PartitionDropDecision {
  schema: string;
  parent: string;
  partition: string;
  /** UTC day the partition's `recorded_at` range covers. */
  partitionDay: string | null;
  ageDays: number | null;
  totalRows: number;
  groups: PartitionGroupVerdict[];
  /** True only when every check passed. */
  eligible: boolean;
  /** Every reason the drop was refused. Empty iff eligible. */
  blockedBy: string[];
  /** DDL that would run — recorded even in dry run, for the log. */
  ddl: string[];
}

/**
 * The whole gate, as a pure function. Every IO-free rule lives here so
 * the fail-closed behaviour is testable without a database.
 */
export function decidePartitionDrop(input: {
  schema: string;
  parent: string;
  partition: string;
  groups: PartitionRowGroup[];
  watermarks: ArchiveWatermarkRow[];
  now: Date;
}): PartitionDropDecision {
  const { schema, parent, partition, groups, watermarks, now } = input;
  const partitionDay = parsePartitionDay(partition);
  const blockedBy: string[] = [];

  const decision: PartitionDropDecision = {
    schema,
    parent,
    partition,
    partitionDay,
    ageDays: partitionDay === null ? null : partitionAgeDays(partitionDay, now),
    totalRows: groups.reduce((n, g) => n + g.rows, 0),
    groups: [],
    eligible: false,
    blockedBy,
    ddl: [
      `ALTER TABLE "${schema}"."${parent}" DETACH PARTITION "${schema}"."${partition}";`,
      `DROP TABLE "${schema}"."${partition}";`,
    ],
  };

  if (partitionDay === null) {
    blockedBy.push("unparsable_partition_name");
    return decision;
  }

  // An empty partition has nothing to confirm — and ADR 0037 D5 says
  // absence of proof blocks the drop. Dropping it would lose nothing,
  // but "no watermark row means no drop" is stated without exception
  // and a special case here is exactly where a bug would hide.
  if (groups.length === 0) {
    blockedBy.push("no_rows_and_no_archive_proof");
    return decision;
  }

  const byKey = new Map<string, ArchiveWatermarkRow>();
  for (const w of watermarks) {
    byKey.set(watermarkKey(w.retentionClass, w.day), w);
  }

  for (const g of groups) {
    const mark = byKey.get(watermarkKey(g.retentionClass, g.occurredDay)) ?? null;
    const archived = mark?.objectCount ?? null;
    let groupBlock: string | null = null;

    if (!isPastRetention(g.retentionClass, partitionDay, now)) {
      groupBlock =
        POSTGRES_RETENTION_DAYS[g.retentionClass] === null
          ? `retention_indefinite:${g.retentionClass}`
          : `within_retention:${g.retentionClass}`;
    } else if (archived === null) {
      // The fail-closed core of D5.
      groupBlock = `no_watermark:${g.retentionClass}@${g.occurredDay}`;
    } else if (archived < g.rows) {
      groupBlock = `watermark_shortfall:${g.retentionClass}@${g.occurredDay}:${archived}<${g.rows}`;
    }
    // archived > rows is a surplus, not a shortfall. R2 PUT is
    // idempotent by key, so a queue retry re-puts the same object and
    // increments the count a second time — the object set is still
    // complete. Blocking on surplus would let one retry deadlock the
    // gate forever, so it is logged (below) rather than treated as a
    // failure.

    if (groupBlock) blockedBy.push(groupBlock);
    decision.groups.push({ ...g, archived, blockedBy: groupBlock });
  }

  decision.eligible = blockedBy.length === 0;
  return decision;
}

/** Children of a partitioned parent, from the catalog. */
export async function listPartitions(
  client: PoolClient,
  schema: string,
  parent: string,
): Promise<string[]> {
  const sql = `
    SELECT c.relname AS partition
      FROM pg_inherits i
      JOIN pg_class c       ON c.oid = i.inhrelid
      JOIN pg_class p       ON p.oid = i.inhparent
      JOIN pg_namespace pn  ON pn.oid = p.relnamespace
     WHERE pn.nspname = $1
       AND p.relname  = $2
     ORDER BY c.relname
  `;
  const result = await client.query<{ partition: string }>(sql, [schema, parent]);
  return result.rows.map((r) => r.partition);
}

/**
 * Row counts for one partition, grouped by retention class and by the
 * UTC day of `occurred_at`.
 *
 * Grouping by `occurred_at` rather than the partition's own
 * `recorded_at` range is what makes the comparison honest: the R2 key
 * and the watermark are both keyed on `occurred_at`, so a late
 * arrival — recorded on day D, occurred on D-1 — is checked against
 * the D-1 watermark where its object actually landed. Comparing the
 * partition's total against the D watermark would mismatch on every
 * late event and block drops forever.
 *
 * This is a scan of one partition, which is the cost D5 accepted in
 * exchange for not scanning R2. It runs only for partitions already
 * past their retention window.
 */
export async function readPartitionGroups(
  client: PoolClient,
  schema: string,
  partition: string,
): Promise<PartitionRowGroup[]> {
  const sql = `
    SELECT "retention_class"::text                            AS retention_class,
           to_char("occurred_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS occurred_day,
           count(*)::bigint                                   AS rows
      FROM "${schema}"."${partition}"
     GROUP BY 1, 2
  `;
  const result = await client.query<{
    retention_class: string;
    occurred_day: string;
    rows: string | number;
  }>(sql);
  return result.rows.map((r) => ({
    retentionClass: r.retention_class as RetentionClass,
    occurredDay: r.occurred_day,
    rows: Number(r.rows),
  }));
}

export interface PartitionDropOptions {
  now?: Date;
  /** False (the default) means dry run: decide + log, execute nothing. */
  enabled?: boolean;
}

export interface PartitionDropResult {
  dryRun: boolean;
  /** Partitions old enough to be worth evaluating. */
  considered: number;
  decisions: PartitionDropDecision[];
  /** Eligible AND actually dropped. Always 0 in dry run. */
  dropped: string[];
  /** Eligible but not dropped because this was a dry run. */
  wouldDrop: string[];
  blocked: Array<{ partition: string; reasons: string[] }>;
  failed: Array<{ partition: string; error: string }>;
}

/**
 * Evaluates every droppable parent's partitions and, when explicitly
 * enabled, detaches and drops the ones that clear the gate.
 *
 * Partitions younger than the shortest declared window are skipped
 * before any scan — the common case must not pay for a GROUP BY over
 * today's hot partition.
 */
export async function dropExpiredPartitions(
  client: PoolClient,
  options: PartitionDropOptions = {},
): Promise<PartitionDropResult> {
  const now = options.now ?? new Date();
  const dryRun = options.enabled !== true;

  const result: PartitionDropResult = {
    dryRun,
    considered: 0,
    decisions: [],
    dropped: [],
    wouldDrop: [],
    blocked: [],
    failed: [],
  };

  const windows = Object.values(POSTGRES_RETENTION_DAYS).filter(
    (d): d is number => typeof d === "number",
  );
  if (windows.length === 0) return result;
  const shortestWindow = Math.min(...windows);

  for (const { schema, parent } of DROPPABLE_PARENTS) {
    let partitions: string[];
    try {
      partitions = await listPartitions(client, schema, parent);
    } catch (err) {
      result.failed.push({
        partition: `${schema}.${parent}`,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    for (const partition of partitions) {
      const day = parsePartitionDay(partition);
      // Not old enough for even the shortest window — skip silently.
      if (day !== null && partitionAgeDays(day, now) <= shortestWindow) continue;
      result.considered++;

      try {
        const groups =
          day === null ? [] : await readPartitionGroups(client, schema, partition);
        const days = [...new Set(groups.map((g) => g.occurredDay))];
        const watermarks = await readArchiveWatermarks(client, days);
        const decision = decidePartitionDrop({
          schema,
          parent,
          partition,
          groups,
          watermarks,
          now,
        });
        result.decisions.push(decision);

        const surplus = decision.groups.filter(
          (g) => g.archived !== null && g.archived > g.rows,
        );
        if (surplus.length > 0) {
          console.warn("[partition-drop] watermark_surplus", {
            partition,
            groups: surplus.map((g) => ({
              retentionClass: g.retentionClass,
              occurredDay: g.occurredDay,
              rows: g.rows,
              archived: g.archived,
            })),
          });
        }

        if (!decision.eligible) {
          result.blocked.push({ partition, reasons: decision.blockedBy });
          console.log("[partition-drop] blocked", {
            partition,
            ageDays: decision.ageDays,
            rows: decision.totalRows,
            reasons: decision.blockedBy,
          });
          continue;
        }

        if (dryRun) {
          result.wouldDrop.push(partition);
          console.log("[partition-drop] would_drop", {
            partition,
            ageDays: decision.ageDays,
            rows: decision.totalRows,
            groups: decision.groups.map((g) => ({
              retentionClass: g.retentionClass,
              occurredDay: g.occurredDay,
              rows: g.rows,
              archived: g.archived,
            })),
            ddl: decision.ddl,
            note: "dry run — set PARTITION_DROP_ENABLED=1 to execute",
          });
          continue;
        }

        for (const ddl of decision.ddl) {
          await client.query(ddl);
        }
        result.dropped.push(partition);
        console.log("[partition-drop] dropped", {
          partition,
          ageDays: decision.ageDays,
          rows: decision.totalRows,
        });
      } catch (err) {
        result.failed.push({
          partition,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}
