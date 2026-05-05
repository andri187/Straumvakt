-- Sprint 8.4.3 — telemetry-snapshot cache columns on charging_stations.
--
-- Two nullable columns. JSONB stores the last successful read from
-- /api/chargers/{id}/state verbatim; timestamp records when. The
-- technical-read panel falls back to these when the live fetch
-- fails (charger offline / rate limited / cloud blip), marking the
-- pills as stale and showing the observed-at age.
--
-- Additive only; no defaults backfilled, no existing rows touched.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "last_telemetry_read" JSONB,
  ADD COLUMN "last_telemetry_at" TIMESTAMPTZ(6);
