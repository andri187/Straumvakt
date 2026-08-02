/**
 * Overlap-window shim for the operator probe scripts — ADR 0039 D1.
 *
 * ADR 0039 split raw OCPP frames out of `events.event_log` into
 * `events.protocol_log`. New `raw_protocol` rows land in protocol_log;
 * the ones written before the split stay in event_log and age out with
 * their day partitions (D-migration §4 — deliberately no backfill, no
 * bulk delete).
 *
 * So for the ~7 days after the migration lands, "all OCPP frames" is
 * the union of both tables. The probes are operator diagnostics, not a
 * shipped surface, so a UNION ALL is the right amount of machinery:
 * one place to delete once the pre-split rows are gone.
 *
 * Columns are listed explicitly rather than `select *`. The two tables
 * were created with the same column order today, but a probe silently
 * mis-mapping payload onto metadata because someone added a column to
 * one of them is not a failure mode worth leaving open.
 *
 * Usage — substitute for the table name, keeping any alias:
 *
 *   `select el.event_type from ${EVENT_LOG_ALL} el where ...`
 *
 * Cost note: both parents are partitioned on recorded_at, and a
 * predicate on occurred_at does not prune partitions. That was already
 * true of every one of these queries against event_log alone; the
 * union roughly doubles the parents scanned and nothing else. These
 * run by hand, at operator pace.
 */

const COLUMNS = [
  "id",
  "org_id",
  "aggregate_type",
  "aggregate_id",
  "event_type",
  "schema_version",
  "payload",
  "metadata",
  "retention_class",
  "occurred_at",
  "recorded_at",
].join(", ");

/**
 * Drop-in replacement for `events.event_log` covering both tables.
 * Parenthesised, so it slots straight into a FROM clause with or
 * without an alias.
 */
export const EVENT_LOG_ALL = `(
      select ${COLUMNS} from events.event_log
      union all
      select ${COLUMNS} from events.protocol_log
    )`;
