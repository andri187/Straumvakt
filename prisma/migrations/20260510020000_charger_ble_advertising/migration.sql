-- Sprint 9 / 2026-05-10 — Add BLE advertising-id mapping to chargers.
--
-- BLE-based tap-and-access. The Flutter driver app scans for nearby
-- charger BLE advertisements; matched IDs surface the charger as
-- "nearby" with a quick-start CTA. Apple-friendly (BLE works on iOS
-- without the NFC/Wallet restrictions).
--
-- Two columns added:
--   ble_advertising_id   — what the charger broadcasts (or what an
--                          external iBeacon broadcasts on its behalf).
--                          Format depends on ble_advertising_kind.
--   ble_advertising_kind — discriminator: 'zaptec_serial' | 'ibeacon_uuid'
--                          | 'mac' | NULL (charger doesn't advertise).
--
-- Both nullable + additive. No backfill needed; operators populate
-- per-charger during onboarding.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "ble_advertising_id"   TEXT,
  ADD COLUMN "ble_advertising_kind" TEXT;
