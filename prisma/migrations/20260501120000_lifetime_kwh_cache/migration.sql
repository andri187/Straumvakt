-- Lifetime kWh cache — Sprint 3 / ADR 0013.
-- Additive (Rule 4). New columns are nullable; existing rows stay
-- valid without backfill. The first successful Zaptec detail fetch
-- after this migration deploys populates the value.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "lifetime_kwh_cached"      DECIMAL(12, 3),
  ADD COLUMN "lifetime_kwh_observed_at" TIMESTAMPTZ(6);
