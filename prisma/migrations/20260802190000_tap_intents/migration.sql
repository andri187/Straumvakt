-- Símatap tap-to-charge — charging.tap_intents (ADR 0024 addendum 2, 2026-08-02)
--
-- Driver-side half of a phone tap: "user U intends to charge at station S,
-- BLE says S is right here, valid until T". The charger-side half arrives
-- independently as an anonymous random UID over OCPP Authorize. Joined on
-- (station, time window) they authorise a session; neither half alone does.
--
-- NOT YET APPLIED. Review before running:
--   npx prisma migrate deploy    (staging first — br-tiny-river-abgpqq37)

CREATE TABLE "charging"."tap_intents" (
    "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    "org_id"              UUID         NOT NULL,
    "user_id"             UUID         NOT NULL,
    "charging_station_id" UUID         NOT NULL,
    "evse_id"             UUID,
    "device_handle"       TEXT,
    "ble_rssi"            INTEGER,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"          TIMESTAMPTZ(6) NOT NULL,
    "consumed_at"         TIMESTAMPTZ(6),
    "consumed_id_tag"     TEXT,

    CONSTRAINT "tap_intents_pkey" PRIMARY KEY ("id")
);

-- The resolver's hot path: "which live intents exist for this station?".
-- Answered from the index alone; bounded by drivers standing at ONE
-- charger, never by fleet size.
CREATE INDEX "tap_intents_station_live_idx"
    ON "charging"."tap_intents" ("charging_station_id", "consumed_at", "expires_at");

-- The app's "am I armed?" query, and the per-driver purge scan.
CREATE INDEX "tap_intents_user_expiry_idx"
    ON "charging"."tap_intents" ("user_id", "expires_at");
