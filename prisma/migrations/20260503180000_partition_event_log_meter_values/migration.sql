-- Sprint 7.2 / ADR 0018 Decision 1 — partition the two hot tables.
--
-- Path (b) per the milestone proposal: rename existing tables to
-- *_legacy, create new partitioned tables, NO DATA MOVEMENT. Existing
-- staging data lives on in *_legacy until natural retention drops it
-- (event_log_legacy ages out at 30d, meter_values_legacy at session
-- archival). Read paths in the app see only the new partitioned
-- table — Sprint 7.5's named data products provide the legacy union
-- if historical reads ever need it.
--
-- Postgres rule: PK on a partitioned table must include the
-- partition key. So both tables get composite PKs:
--   events.event_log         → (id, recorded_at)
--   charging.meter_values    → (id, measured_at)
-- The Prisma model declarations have been updated in lockstep.
--
-- Pre-creates 7 days of forward partitions (today + 6) so deploys
-- have headroom even if the daily cron misses an invocation. The
-- partition-cron Worker (apps/api scheduled handler) creates +7
-- forward partitions every 5 minutes after this migration lands.

-- ────────────────────────────────────────────────────────────────
-- 1. Rename existing tables to *_legacy
-- ────────────────────────────────────────────────────────────────
--
-- Postgres caveat: ALTER TABLE … RENAME does NOT rename associated
-- constraints or indexes. They keep their original names. Without
-- this rename step, the CREATE TABLE for the new partitioned
-- parents (which carry the same constraint + index names) would
-- collide with the legacy ones.

ALTER TABLE "events"."event_log" RENAME TO "event_log_legacy";
ALTER TABLE "charging"."meter_values" RENAME TO "meter_values_legacy";

-- Rename legacy event_log constraints + indexes off the new namespace.
ALTER TABLE "events"."event_log_legacy" RENAME CONSTRAINT "event_log_pkey" TO "event_log_legacy_pkey";
ALTER TABLE "events"."event_log_legacy" RENAME CONSTRAINT "event_log_org_id_fkey" TO "event_log_legacy_org_id_fkey";
ALTER INDEX "events"."event_log_org_id_occurred_at_idx" RENAME TO "event_log_legacy_org_id_occurred_at_idx";
ALTER INDEX "events"."event_log_aggregate_type_aggregate_id_occurred_at_idx" RENAME TO "event_log_legacy_aggregate_type_aggregate_id_occurred_at_idx";
ALTER INDEX "events"."event_log_event_type_occurred_at_idx" RENAME TO "event_log_legacy_event_type_occurred_at_idx";

-- Rename legacy meter_values constraints + indexes off the new namespace.
ALTER TABLE "charging"."meter_values_legacy" RENAME CONSTRAINT "meter_values_pkey" TO "meter_values_legacy_pkey";
ALTER TABLE "charging"."meter_values_legacy" RENAME CONSTRAINT "meter_values_org_id_fkey" TO "meter_values_legacy_org_id_fkey";
ALTER TABLE "charging"."meter_values_legacy" RENAME CONSTRAINT "meter_values_session_id_fkey" TO "meter_values_legacy_session_id_fkey";
ALTER INDEX "charging"."meter_values_session_id_measured_at_idx" RENAME TO "meter_values_legacy_session_id_measured_at_idx";

-- ────────────────────────────────────────────────────────────────
-- 2. Create the new partitioned events.event_log
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "events"."event_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "retention_class" "events"."RetentionClass" NOT NULL DEFAULT 'operational',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id", "recorded_at")
) PARTITION BY RANGE ("recorded_at");

-- Indexes on the partitioned parent. Postgres propagates these to
-- each partition automatically as partitions are created/attached.
CREATE INDEX "event_log_org_id_occurred_at_idx"
    ON "events"."event_log" ("org_id", "occurred_at" DESC);

CREATE INDEX "event_log_aggregate_type_aggregate_id_occurred_at_idx"
    ON "events"."event_log" ("aggregate_type", "aggregate_id", "occurred_at");

CREATE INDEX "event_log_event_type_occurred_at_idx"
    ON "events"."event_log" ("event_type", "occurred_at" DESC);

-- FK out to organizations. CASCADE matches the legacy table's behaviour.
ALTER TABLE "events"."event_log"
    ADD CONSTRAINT "event_log_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- 3. Create the new partitioned charging.meter_values
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "charging"."meter_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "energy_wh" BIGINT,
    "power_w" INTEGER,
    "voltage_v" DECIMAL(6, 2),
    "current_a" DECIMAL(6, 2),
    "soc_percent" DECIMAL(5, 2),
    CONSTRAINT "meter_values_pkey" PRIMARY KEY ("id", "measured_at")
) PARTITION BY RANGE ("measured_at");

CREATE INDEX "meter_values_session_id_measured_at_idx"
    ON "charging"."meter_values" ("session_id", "measured_at");

ALTER TABLE "charging"."meter_values"
    ADD CONSTRAINT "meter_values_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "charging"."meter_values"
    ADD CONSTRAINT "meter_values_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- 4. Pre-create 7 days of forward partitions for both tables.
--
-- Daily ranges starting from 2026-05-03 UTC. The partition-cron
-- Worker keeps +7 forward partitions populated every scheduled
-- invocation after this migration lands; the names follow the
-- pattern below so the cron can detect existing partitions and
-- skip them idempotently.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "events"."event_log_p_20260503" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-03 00:00:00+00') TO ('2026-05-04 00:00:00+00');
CREATE TABLE "events"."event_log_p_20260504" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-04 00:00:00+00') TO ('2026-05-05 00:00:00+00');
CREATE TABLE "events"."event_log_p_20260505" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-05 00:00:00+00') TO ('2026-05-06 00:00:00+00');
CREATE TABLE "events"."event_log_p_20260506" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-06 00:00:00+00') TO ('2026-05-07 00:00:00+00');
CREATE TABLE "events"."event_log_p_20260507" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-07 00:00:00+00') TO ('2026-05-08 00:00:00+00');
CREATE TABLE "events"."event_log_p_20260508" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-08 00:00:00+00') TO ('2026-05-09 00:00:00+00');
CREATE TABLE "events"."event_log_p_20260509" PARTITION OF "events"."event_log"
    FOR VALUES FROM ('2026-05-09 00:00:00+00') TO ('2026-05-10 00:00:00+00');

CREATE TABLE "charging"."meter_values_p_20260503" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-03 00:00:00+00') TO ('2026-05-04 00:00:00+00');
CREATE TABLE "charging"."meter_values_p_20260504" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-04 00:00:00+00') TO ('2026-05-05 00:00:00+00');
CREATE TABLE "charging"."meter_values_p_20260505" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-05 00:00:00+00') TO ('2026-05-06 00:00:00+00');
CREATE TABLE "charging"."meter_values_p_20260506" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-06 00:00:00+00') TO ('2026-05-07 00:00:00+00');
CREATE TABLE "charging"."meter_values_p_20260507" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-07 00:00:00+00') TO ('2026-05-08 00:00:00+00');
CREATE TABLE "charging"."meter_values_p_20260508" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-08 00:00:00+00') TO ('2026-05-09 00:00:00+00');
CREATE TABLE "charging"."meter_values_p_20260509" PARTITION OF "charging"."meter_values"
    FOR VALUES FROM ('2026-05-09 00:00:00+00') TO ('2026-05-10 00:00:00+00');
