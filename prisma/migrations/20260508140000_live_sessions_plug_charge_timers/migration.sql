-- Sprint 9 / 2026-05-08 — plug / charge / non-charge timers on live_sessions.
--
-- Extends charging.live_sessions to track per-session cumulative time
-- spent in each Zaptec OperationMode bucket. The AMQP state-event
-- handler maintains these as state transitions arrive:
--
--   connected_at         first time mode != Disconnected (1) was observed
--   charging_started_at  first time mode == Charging (3) was observed
--   last_mode_at         when the current mode began (used to compute deltas)
--   charging_seconds     cumulative seconds in Charging mode (3)
--   non_charging_seconds cumulative seconds in connected-but-not-charging
--                          modes (Requesting=2, Finished-pre-disconnect=5,
--                          Suspended=6, etc.) — i.e. every mode except 1
--                          (Disconnected) and 3 (Charging)
--
-- Plug duration (live)  = charging_seconds + non_charging_seconds
-- Charge duration       = charging_seconds
-- Non-charge duration   = non_charging_seconds
--
-- Timers are kept on the live_sessions row only; persistence to
-- charging.sessions is a follow-up sprint (matched to the Zaptec
-- /chargehistory enrichment).
--
-- Backfill: existing rows get connected_at = startedAt, charging_started_at
-- = startedAt, last_mode_at = lastObservedAt, all counters 0. Slight
-- under-counting until the next observation arrives, but no row is lost.

ALTER TABLE "charging"."live_sessions"
  ADD COLUMN "connected_at"          TIMESTAMPTZ(6),
  ADD COLUMN "charging_started_at"   TIMESTAMPTZ(6),
  ADD COLUMN "last_mode_at"          TIMESTAMPTZ(6),
  ADD COLUMN "charging_seconds"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "non_charging_seconds"  INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows. Existing rows were created on mode==3 entry,
-- so connected_at + charging_started_at both default to startedAt and
-- last_mode_at picks up from lastObservedAt.
UPDATE "charging"."live_sessions"
SET
  "connected_at"        = "started_at",
  "charging_started_at" = "started_at",
  "last_mode_at"        = "last_observed_at"
WHERE "connected_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- AMQP-derived telemetry samples (faster interval data for charge log).
--
-- One row per AMQP StateId 513 (TotalChargePower) or 553 (TotalChargeEnergy)
-- observation. Keyed by charger + observed_at. No FK to charging.sessions
-- yet because the AMQP path runs before Zaptec /chargehistory enrichment
-- creates the ChargeSession row.
--
-- A follow-up reconciliation step (post-enrichment cron) can match samples
-- to the right ChargeSession by charger_id + observed_at within the
-- (started_at .. ended_at) window, then either copy them into
-- charging.meter_values or expose them as a denser series alongside.
--
-- Volume sketch (4k chargers, half charging at peak, observations every
-- ~10s): ~200 rows/sec, ~17M rows/day. Retention is on a follow-up sprint;
-- pilot doesn't accumulate enough to worry about.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "charging"."live_session_samples" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "charger_id"    UUID NOT NULL,
  "observed_at"   TIMESTAMPTZ(6) NOT NULL,
  "power_w"       INTEGER,
  "energy_wh"     BIGINT,
  "state_id"      INTEGER NOT NULL,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "live_session_samples_charger_fk"
    FOREIGN KEY ("charger_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE
);

CREATE INDEX "live_session_samples_charger_observed_idx"
  ON "charging"."live_session_samples" ("charger_id", "observed_at" DESC);

