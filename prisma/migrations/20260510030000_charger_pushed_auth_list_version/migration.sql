-- Sprint 9 / 2026-05-10 — Track CSMS-side local auth list version per charger.
--
-- OCPP 1.6J SendLocalList requires a strictly increasing listVersion. The
-- charger reports its current version via StateId 751 / GetLocalListVersion,
-- but we can't read its contents — so we track our own pushed version
-- separately. Half B / "push idTag" support uses this column to mint the
-- next listVersion when enqueueing the OCPP Call.
--
-- Per-charger because OCPP versions are per-charge-point. NOT NULL with a
-- default of 0 (matches the OCPP convention "no list synced") so the
-- backfill is implicit; existing rows get 0 automatically.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "pushed_auth_list_version" INTEGER NOT NULL DEFAULT 0;
