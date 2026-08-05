-- Persist Zaptec's two authentication settings per charger.
--
-- Both were readable from the bulk listing and neither was stored, so the
-- fleet view could only show Straumvakt's own `enforce_authorize` — a
-- column that nothing writes and that no installation has ever had set.
-- The key emblem on /chargers was therefore reporting an untouched default
-- rather than the setting that actually governs the charger.
--
-- These are TWO DIFFERENT THINGS and the names invite conflating them:
--
--   vendor_auth_required        StateId 120. Whether the CHARGER sends
--                               OCPP Basic-Auth on the WSS upgrade. About
--                               the charger authenticating to our gateway.
--                               This is what the /sites tree toggle writes
--                               (zaptec-bulk-config.ts).
--
--   vendor_authentication_type  Who authorises the DRIVER. This is the one
--                               that decides whether an unknown card can
--                               start a charge.
--
-- NOTE — the enum meaning is documented two contradictory ways in our own
-- code and is NOT resolved here:
--     lib/zaptec.ts:212             0=None, 1=Vendor app, 2=OCPP cloud, 3=Native OCPP
--     charger-technical-read.ts:156 0 = Zaptec Portal owns the list
-- Stored as the raw integer deliberately. Do not map it to a label until
-- the meaning is confirmed against Zaptec's documentation; a wrong mapping
-- here would render a charger as open when it is closed, or the reverse.

ALTER TABLE "assets"."charging_stations"
  ADD COLUMN "vendor_auth_required"       BOOLEAN,
  ADD COLUMN "vendor_authentication_type" INTEGER,
  ADD COLUMN "vendor_auth_seen_at"        TIMESTAMPTZ(6);

COMMENT ON COLUMN "assets"."charging_stations"."vendor_auth_required" IS
  'Zaptec StateId 120 — charger sends OCPP Basic-Auth on the WSS upgrade. NOT driver authorization.';
COMMENT ON COLUMN "assets"."charging_stations"."vendor_authentication_type" IS
  'Zaptec AuthenticationType — who authorises the driver. Raw integer; enum meaning unconfirmed, see migration note.';
COMMENT ON COLUMN "assets"."charging_stations"."vendor_auth_seen_at" IS
  'When the two values above were last refreshed from the vendor. NULL means never synced, which is different from "no auth".';
