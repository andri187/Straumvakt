-- Sprint 8.4.7 — firmware-detail + online-since columns on charging_stations.
--
-- Cron's /state response (8.13.2) carries firmware versions and the
-- IsOnline observation timestamp; extract them into dedicated columns
-- so the /chargers list view can show them without a per-row Zaptec
-- round-trip.
--
-- Mapping:
--   mainboard_sw_version       ← StateId 908 (MainboardSoftwareApplicationVersion)
--   smart_bootloader_version   ← StateId 912 (SmartComputerBootloaderVersion)
--   hardware_version           ← StateId 913 (HardwareVersion)
--   online_since_at            ← StateId -2 (IsOnline) Timestamp when ValueAsString=true
--
-- StateId 911 (SmartComputerSoftwareApplicationVersion) reuses the
-- existing firmware_version column — the BootNotification projection
-- already writes there for OCPP-active chargers; the cron now also
-- writes from /state for Native-auth chargers (which have no OCPP boot
-- traffic).
--
-- Additive only; no defaults backfilled, no existing rows touched.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "mainboard_sw_version"     TEXT,
  ADD COLUMN "smart_bootloader_version" TEXT,
  ADD COLUMN "hardware_version"         TEXT,
  ADD COLUMN "online_since_at"          TIMESTAMPTZ(6);
