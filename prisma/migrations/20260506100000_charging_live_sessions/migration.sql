-- Sprint 9.6 — charging.live_sessions: per-charger active-session tracker
-- driven by Azure Service Bus state observations parsed by the Fly
-- consumer (apps/zaptec-consumer).
--
-- One row per charger that has an active charging session. Created on
-- StateId 710 transition to 3 (Charging), updated as later observations
-- (StateId 513 power, 553 session-energy) arrive, deleted on transition
-- to 5 (Finished) or 1 (Disconnected).
--
-- Charge-station-id is the primary key — at most one active session per
-- charger by physics (single connector at Dalvegur). For multi-connector
-- chargers we'd need to widen later.
--
-- Additive only; no defaults backfilled.

CREATE TABLE "charging"."live_sessions" (
  "charging_station_id"     UUID PRIMARY KEY,
  "org_id"                  UUID NOT NULL,
  "ocpp_identity_id"        UUID NOT NULL,
  "vendor_resource_id"      TEXT NOT NULL,
  "started_at"              TIMESTAMPTZ(6) NOT NULL,
  "last_observed_at"        TIMESTAMPTZ(6) NOT NULL,
  "last_operation_mode"     INTEGER,
  "last_power_w"            NUMERIC(10, 0),
  "last_session_energy_wh"  NUMERIC(12, 0),
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "live_sessions_station_fk" FOREIGN KEY ("charging_station_id")
    REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE,
  CONSTRAINT "live_sessions_org_fk" FOREIGN KEY ("org_id")
    REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "live_sessions_identity_fk" FOREIGN KEY ("ocpp_identity_id")
    REFERENCES "ocpp"."ocpp_identities"("id") ON DELETE CASCADE
);

-- Unique constraint enforces 1:1 with OcppIdentity (one active
-- session per identity). The Prisma schema models LiveSession?
-- on OcppIdentity which requires this @unique on the FK side.
CREATE UNIQUE INDEX "live_sessions_ocpp_identity_id_key"
  ON "charging"."live_sessions"("ocpp_identity_id");
CREATE INDEX "live_sessions_org_idx" ON "charging"."live_sessions"("org_id");
CREATE INDEX "live_sessions_observed_idx" ON "charging"."live_sessions"("last_observed_at");
