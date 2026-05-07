-- Sprint 9.8 — comm-mode + signal-strength columns on charging_stations.
--
-- Same pattern as the firmware columns (8.4.7): cron's per-charger
-- /state response (8.13.2) carries both StateId 150 (CommunicationMode)
-- and StateId 809 (CommunicationSignalStrength). Extract on each
-- */1 tick and write to dedicated columns so the /chargers list view
-- can render Comm + Signal without a per-row Zaptec round-trip.
--
-- comm_mode    TEXT     ← StateId 150 ("Wi-Fi" / "LTE" / "PLC" / "Ethernet")
-- signal_dbm   INTEGER  ← StateId 809 (RSSI/RSRP magnitude; usually negative)
--
-- Additive only; no defaults backfilled.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "comm_mode"  TEXT,
  ADD COLUMN "signal_dbm" INTEGER;
