-- vendor_asset_refs: let one vendor asset be covered by several credentials.
--
-- The old unique was (vendor_slug, vendor_asset_id) — one Zaptec asset, one
-- row, one credential. That encodes "which credential OWNS this charger",
-- which is the wrong question and has no answer when an org holds two
-- Zaptec accounts that both see the same serial.
--
-- The right question is "which credentials CAN READ this charger". A
-- credential is a capability, not a claim of ownership: if several grant
-- access, any of them works, and revocation of one becomes a fallthrough
-- to the next rather than a blanked technical read.
--
-- A vendor asset id is globally unique to a physical charger, so recording
-- the same serial under several credentials is not duplication — it is the
-- coverage map.

ALTER TABLE "vendors"."vendor_asset_refs"
  DROP CONSTRAINT IF EXISTS "vendor_asset_refs_vendor_slug_vendor_asset_id_key";

CREATE UNIQUE INDEX "vendor_asset_refs_vendor_slug_vendor_asset_id_credentials_ref_key"
  ON "vendors"."vendor_asset_refs" ("vendor_slug", "vendor_asset_id", "credentials_ref");

-- Resolution order is last_used_at DESC: prefer whichever credential most
-- recently worked. A credential that succeeded minutes ago is likelier to
-- work now than the oldest one, which may be dormant or half-revoked — so
-- the system converges on whichever access is healthy instead of failing
-- on a stale first choice. This index serves that lookup.
CREATE INDEX IF NOT EXISTS "vendor_asset_refs_station_vendor_idx"
  ON "vendors"."vendor_asset_refs" ("charging_station_id", "vendor_slug");
