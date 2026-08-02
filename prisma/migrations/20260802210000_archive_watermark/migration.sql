-- Archive watermark — ADR 0037 D5 (2026-08-02)
--
-- P4.15 (partition detach-and-drop) may only drop a partition once its
-- rows are confirmed present in the R2 archive. ADR 0037 rejects
-- "LIST the prefix and count objects" as the proof: it is O(objects),
-- racy against in-flight archive writes, and since D1 moved the
-- retention class to the front of the key it now spans one prefix per
-- class per day.
--
-- This table is the proof instead. The archive queue consumer
-- increments one row per (retention_class, UTC day) per batch; the
-- partition-drop cron reads it and refuses to drop on a shortfall.
-- A single indexed read, observable by the operator, and fail-closed:
-- no row means no drop.
--
-- `day` is the UTC day of the envelope's occurred_at — the same date
-- component the R2 object key carries. It is deliberately NOT
-- events.event_log's recorded_at partition key; the cron groups
-- partition rows by occurred_at before comparing.
--
-- Additive only: creates one new table in an existing schema, reusing
-- the existing events."RetentionClass" enum. No renames, no drops, no
-- changes to any existing table.
--
-- NOT YET APPLIED. Review before running:
--   npx prisma migrate deploy    (staging first — br-tiny-river-abgpqq37)

CREATE TABLE "events"."archive_watermark" (
    "retention_class" "events"."RetentionClass" NOT NULL,
    "day"             DATE           NOT NULL,
    "object_count"    BIGINT         NOT NULL DEFAULT 0,
    "last_write_at"   TIMESTAMPTZ(6) NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_watermark_pkey" PRIMARY KEY ("retention_class", "day")
);

-- The drop gate reads by day across all classes present in a
-- partition ("what was archived for 2026-07-26?"). The composite PK
-- leads with retention_class, so that query needs its own index.
CREATE INDEX "archive_watermark_day_idx"
    ON "events"."archive_watermark" ("day");
