-- Sprint 7.5 / ADR 0018 Decision 5 — named data product schemas.
-- Pure additive: new schema namespace + 5 new tables. No changes
-- to existing tables. Sprint 8's tariff engine writes the billing-
-- grade rows; Sprint 7's daily aggregate jobs (scaffolding lands
-- later) fill the rest.

-- New schema namespace.
CREATE SCHEMA IF NOT EXISTS "reports";

-- ────────────────────────────────────────────────────────────────
-- reports.billing_period_summary — per orgId × month
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "reports"."billing_period_summary" (
    "org_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "total_kwh" DECIMAL(14, 3) NOT NULL DEFAULT 0,
    "total_isk_minor" BIGINT NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_period_summary_pkey" PRIMARY KEY ("org_id", "year", "month")
);

CREATE INDEX "billing_period_summary_year_month_idx"
    ON "reports"."billing_period_summary" ("year", "month");

ALTER TABLE "reports"."billing_period_summary"
    ADD CONSTRAINT "billing_period_summary_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- reports.session_ledger — per session
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "reports"."session_ledger" (
    "session_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID,
    "charging_station_id" UUID,
    "driver_user_id" UUID,
    "driver_id_tag" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "stopped_at" TIMESTAMPTZ(6),
    "duration_sec" INTEGER,
    "energy_kwh" DECIMAL(10, 3) NOT NULL DEFAULT 0,
    "cost_isk_minor" BIGINT,
    "tariff_definition_id" UUID,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_ledger_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX "session_ledger_org_id_started_at_idx"
    ON "reports"."session_ledger" ("org_id", "started_at" DESC);
CREATE INDEX "session_ledger_driver_user_id_started_at_idx"
    ON "reports"."session_ledger" ("driver_user_id", "started_at" DESC);
CREATE INDEX "session_ledger_charging_station_id_started_at_idx"
    ON "reports"."session_ledger" ("charging_station_id", "started_at" DESC);

ALTER TABLE "reports"."session_ledger"
    ADD CONSTRAINT "session_ledger_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- reports.site_energy_daily — per site × day
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "reports"."site_energy_daily" (
    "site_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "total_kwh" DECIMAL(12, 3) NOT NULL DEFAULT 0,
    "peak_power_w" INTEGER,
    "uptime_pct" DECIMAL(5, 2),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_energy_daily_pkey" PRIMARY KEY ("site_id", "date")
);

CREATE INDEX "site_energy_daily_org_id_date_idx"
    ON "reports"."site_energy_daily" ("org_id", "date" DESC);

ALTER TABLE "reports"."site_energy_daily"
    ADD CONSTRAINT "site_energy_daily_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- reports.charger_uptime_daily — per chargingStation × day
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "reports"."charger_uptime_daily" (
    "charging_station_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "heartbeats_received" INTEGER NOT NULL DEFAULT 0,
    "status_transitions" INTEGER NOT NULL DEFAULT 0,
    "offline_minutes" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "charger_uptime_daily_pkey" PRIMARY KEY ("charging_station_id", "date")
);

CREATE INDEX "charger_uptime_daily_org_id_date_idx"
    ON "reports"."charger_uptime_daily" ("org_id", "date" DESC);

ALTER TABLE "reports"."charger_uptime_daily"
    ADD CONSTRAINT "charger_uptime_daily_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- reports.command_history — per outbound command (final state)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE "reports"."command_history" (
    "command_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "control_domain" TEXT NOT NULL,
    "routed_to" TEXT NOT NULL,
    "dispatched_at" TIMESTAMPTZ(6),
    "final_status" TEXT NOT NULL,
    "result_json" JSONB,
    "latency_ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "command_history_pkey" PRIMARY KEY ("command_id")
);

CREATE INDEX "command_history_org_id_created_at_idx"
    ON "reports"."command_history" ("org_id", "created_at" DESC);
CREATE INDEX "command_history_identity_id_created_at_idx"
    ON "reports"."command_history" ("identity_id", "created_at" DESC);

ALTER TABLE "reports"."command_history"
    ADD CONSTRAINT "command_history_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
