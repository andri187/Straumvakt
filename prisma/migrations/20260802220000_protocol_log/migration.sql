-- Split the raw protocol log out of the event log — ADR 0039 D1
-- (2026-08-02). Amends ADR 0018 Decision 1.
--
-- ADR 0018 put every retention class in one partitioned
-- events.event_log and committed to tiered retention on that basis.
-- The tiering cannot be enforced: a table is partitioned one way per
-- level, the axis is spent on time, and every day's partition mixes
-- 7-day `raw_protocol` noise with `operational` rows that never
-- expire. P4.15's fail-closed gate therefore blocks on essentially
-- every real partition and NOTHING has ever reclaimed raw frames
-- (ADR 0035 F5 / F22). Heartbeats alone are ~80% of all events —
-- ~2M rows/day at 1000 chargers.
--
-- This migration gives raw frames their own partitioned table so
-- retention becomes a DROP TABLE on a day partition: O(1) metadata,
-- no bloat, no VACUUM, no lock on anything that matters. The R2
-- archive remains the durable record (ADR 0039 D2) — protocol_log is
-- a 7-day forensics cache, not the system of record.
--
-- Shape is byte-identical to events.event_log so the write path
-- differs only in the table name and the projection dispatcher is
-- unchanged. Postgres requires the partition key in the primary key,
-- so the PK is composite (id, recorded_at), same as event_log.
--
-- Additive only: creates one new partitioned table plus its day
-- partitions, reusing the existing events."RetentionClass" enum. No
-- renames, no drops, no changes to any existing table.
--
-- NO BACKFILL, and deliberately so. ADR 0039 D-migration §4: existing
-- raw_protocol rows stay in event_log and age out with their day
-- partitions once their operational neighbours are also droppable.
-- Bulk-deleting 2M rows/day is precisely the heavy operation this ADR
-- exists to avoid.
--
-- NOT YET APPLIED. Review before running:
--   npx prisma migrate deploy    (staging first — br-tiny-river-abgpqq37)

-- ────────────────────────────────────────────────────────────────
-- 1. The partitioned parent
-- ────────────────────────────────────────────────────────────────
--
-- No FOREIGN KEY to tenancy.organizations, unlike event_log. That FK
-- carries ON DELETE CASCADE, and cascading an org delete across every
-- day partition of a 2M-rows/day table is the same heavy operation
-- D1 exists to avoid — for rows that are gone within 7 days anyway.
-- prisma/schema.prisma's ProtocolLogEntry declares no relation either,
-- so schema and database agree and `prisma migrate diff` stays quiet.

CREATE TABLE "events"."protocol_log" (
    "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
    "org_id"          UUID           NOT NULL,
    "aggregate_type"  TEXT           NOT NULL,
    "aggregate_id"    UUID           NOT NULL,
    "event_type"      TEXT           NOT NULL,
    "schema_version"  INTEGER        NOT NULL DEFAULT 1,
    "payload"         JSONB          NOT NULL,
    "metadata"        JSONB          NOT NULL DEFAULT '{}',
    "retention_class" "events"."RetentionClass" NOT NULL DEFAULT 'raw_protocol',
    "occurred_at"     TIMESTAMPTZ(6) NOT NULL,
    "recorded_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_log_pkey" PRIMARY KEY ("id", "recorded_at")
) PARTITION BY RANGE ("recorded_at");

-- Indexes on the partitioned parent. Postgres propagates these to each
-- partition automatically as partitions are created or attached. Same
-- three as event_log: the probe scripts UNION ALL across both tables
-- during the overlap window and must not lose their access paths.
CREATE INDEX "protocol_log_org_id_occurred_at_idx"
    ON "events"."protocol_log" ("org_id", "occurred_at" DESC);

CREATE INDEX "protocol_log_aggregate_type_aggregate_id_occurred_at_idx"
    ON "events"."protocol_log" ("aggregate_type", "aggregate_id", "occurred_at");

CREATE INDEX "protocol_log_event_type_occurred_at_idx"
    ON "events"."protocol_log" ("event_type", "occurred_at" DESC);

-- ────────────────────────────────────────────────────────────────
-- 2. Seven days of forward partitions (today + 6)
-- ────────────────────────────────────────────────────────────────
--
-- An INSERT with no matching partition fails outright with "no
-- partition of relation found for row", so the table must never be
-- reachable by the consumer without today's partition present. The
-- +7-day buffer means a failed cron tick still leaves six days of
-- headroom.
--
-- Names follow the same `<parent>_p_<yyyymmdd>` convention the
-- partition cron detects and skips idempotently — see
-- apps/api/src/lib/db/partition-cron.ts, which now plans protocol_log
-- alongside event_log and meter_values, and lists it in
-- DROPPABLE_PARENTS at the 7-day raw_protocol window.

CREATE TABLE "events"."protocol_log_p_20260802" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-02 00:00:00+00') TO ('2026-08-03 00:00:00+00');
CREATE TABLE "events"."protocol_log_p_20260803" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-03 00:00:00+00') TO ('2026-08-04 00:00:00+00');
CREATE TABLE "events"."protocol_log_p_20260804" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-04 00:00:00+00') TO ('2026-08-05 00:00:00+00');
CREATE TABLE "events"."protocol_log_p_20260805" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-05 00:00:00+00') TO ('2026-08-06 00:00:00+00');
CREATE TABLE "events"."protocol_log_p_20260806" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-06 00:00:00+00') TO ('2026-08-07 00:00:00+00');
CREATE TABLE "events"."protocol_log_p_20260807" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-07 00:00:00+00') TO ('2026-08-08 00:00:00+00');
CREATE TABLE "events"."protocol_log_p_20260808" PARTITION OF "events"."protocol_log"
    FOR VALUES FROM ('2026-08-08 00:00:00+00') TO ('2026-08-09 00:00:00+00');
