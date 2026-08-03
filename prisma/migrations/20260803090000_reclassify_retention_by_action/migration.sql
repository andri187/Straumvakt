-- Reclassify historical retention_class by OCPP action.
-- ADR 0039 (2026-08-02 amendment) + ADR 0040.
--
-- ⚠️  NOT YET APPLIED. Review before running.
--
-- ─────────────────────────────────────────────────────────────────────
-- Why this exists
-- ─────────────────────────────────────────────────────────────────────
-- gateway/src/identity-do.ts stamped retention_class = 'raw_protocol'
-- on EVERY inbound OCPP frame, whatever the action. That class therefore
-- does not mean "disposable protocol noise" — it means "arrived over
-- OCPP", and that set includes:
--
--   * ocpp.raw.MeterValues     — carries the OCMF SIGNED BILLING
--                                EVIDENCE (the tamper-evident meter
--                                reading a dispute is settled on)
--   * ocpp.raw.StopTransaction — the charger's own record of delivered
--                                energy, the basis of the invoice
--
-- ADR 0037 expires the raw_protocol/ prefix from R2 after 7 days, and
-- ADR 0039 drops protocol_log partitions after 7 days. Switching either
-- on while these rows are still mis-stamped would delete billing
-- evidence from both stores on a timer — while ADR 0031 §15 settles
-- metering disputes on exactly those logs, and ADR 0018 §3c calls
-- billing-touched retention "non-negotiable" at 7 years.
--
-- The gateway now classifies correctly for NEW frames (commit 65f4514).
-- This migration fixes the rows written before that.
--
-- ⚠️  THIS IS THE GATE. No 7-day retention rule — R2 lifecycle or
--     PARTITION_DROP_ENABLED — may be switched on until this has run
--     and been verified. It is the one part of the retention work that
--     cannot ship incrementally.
--
-- ─────────────────────────────────────────────────────────────────────
-- Before running: see what you are about to change
-- ─────────────────────────────────────────────────────────────────────
-- Run this first and keep the output. It is also the after-check.
--
--   SELECT retention_class, event_type, count(*)
--     FROM events.event_log
--    WHERE retention_class = 'raw_protocol'
--    GROUP BY 1, 2
--    ORDER BY 3 DESC;
--
-- Expect Heartbeat to dominate (~80% of all events). Anything with a
-- large MeterValues or StopTransaction count is billing evidence that is
-- currently one config flag away from deletion.
--
-- ─────────────────────────────────────────────────────────────────────
-- Volume note
-- ─────────────────────────────────────────────────────────────────────
-- retention_class is NOT the partition key (recorded_at is), so these
-- UPDATEs do not move rows between partitions — no partition-key update
-- restrictions apply, and no rows are rewritten across partition
-- boundaries.
--
-- At current volume (~529 MB total) a single pass is fine. Past roughly
-- 50M rows, run it batched by day instead, so it does not hold a long
-- transaction or bloat the table in one go:
--
--   UPDATE events.event_log SET retention_class = 'financial'
--    WHERE retention_class = 'raw_protocol'
--      AND recorded_at >= '2026-05-01' AND recorded_at < '2026-05-02'
--      AND event_type IN (...);
--
-- Run this migration EARLY. It gets more expensive every day it waits.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Billing evidence → financial (indefinite retention)
-- ─────────────────────────────────────────────────────────────────────
UPDATE "events"."event_log"
   SET "retention_class" = 'financial'
 WHERE "retention_class" = 'raw_protocol'
   AND "event_type" IN (
         'ocpp.raw.MeterValues',
         'ocpp.raw.StartTransaction',
         'ocpp.raw.StopTransaction'
       );

-- ─────────────────────────────────────────────────────────────────────
-- 2. Everything that is not a heartbeat → operational (90 days)
--
-- Deliberately an exclusion, not an allow-list. A frame type nobody has
-- triaged must land on the LONGER window — an unrecognised action is
-- more likely to be something new that matters than something
-- disposable. Fail long, not short. This mirrors retentionClassFor()'s
-- default in gateway/src/identity-do.ts.
--
-- 'charger.heartbeat' is the legacy translator's name for the same
-- frame; both are disposable.
-- ─────────────────────────────────────────────────────────────────────
UPDATE "events"."event_log"
   SET "retention_class" = 'operational'
 WHERE "retention_class" = 'raw_protocol'
   AND "event_type" NOT IN ('ocpp.raw.Heartbeat', 'charger.heartbeat');

-- ─────────────────────────────────────────────────────────────────────
-- 3. What remains
--
-- Only heartbeats are left as raw_protocol — which is now what the class
-- means. Verify with the SELECT at the top: the only rows returned
-- should be ocpp.raw.Heartbeat and charger.heartbeat.
--
-- Only once that is true is it safe to enable:
--   * R2 lifecycle rules on the raw_protocol/ prefix (ADR 0037 D2)
--   * PARTITION_DROP_ENABLED (P4.15)
--
-- NOTE — R2 objects are NOT reclassified by this migration. Their
-- retention class is baked into the object key (ADR 0037 D1), so
-- existing archived objects sit under raw_protocol/ regardless of what
-- Postgres now says. Applying an R2 lifecycle rule to that prefix would
-- still delete historical OCMF frames. Either exclude the pre-migration
-- date range from the lifecycle rule, or copy those objects to their
-- correct prefix first. This is tracked separately — do not assume this
-- migration made R2 safe.
-- ─────────────────────────────────────────────────────────────────────
