-- charging.tap_intents — add the four foreign keys it shipped without.
-- Schema audit 2026-08-03, finding 2.
--
-- The table was created by 20260802190000_tap_intents with org_id,
-- user_id, charging_station_id and evse_id as bare UUIDs. Unlike
-- protocol_log, which carries a written justification for omitting its
-- org FK (cascading an org delete across every day partition of a
-- 2M-rows/day table is the heavy operation partitioning exists to
-- avoid), nothing explained their absence here — and this table feeds
-- ACCESS-GRANT RESOLUTION. Without them a deleted user leaves live
-- intents that still authorise a charge.
--
-- Applied while the table is still empty (0 rows, verified 2026-08-03 on
-- br-withered-hat-abtc5gzi), so there is nothing to repair first. The
-- mobile app is being wired to these endpoints now; after that, this
-- becomes a data-repair migration rather than four ALTERs.
--
-- CASCADE on user and station: an intent is meaningless without either,
-- it is short-lived by construction (expires_at NOT NULL), and it is not
-- financial evidence — the ChargeSession it authorises is, and that is a
-- separate table with its own retention. RESTRICT on org, matching the
-- treatment of tenancy edges elsewhere: deleting an organisation should
-- be an explicit offboarding routine, never a side effect.

ALTER TABLE "charging"."tap_intents"
    ADD CONSTRAINT "tap_intents_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "charging"."tap_intents"
    ADD CONSTRAINT "tap_intents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "charging"."tap_intents"
    ADD CONSTRAINT "tap_intents_charging_station_id_fkey"
    FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "charging"."tap_intents"
    ADD CONSTRAINT "tap_intents_evse_id_fkey"
    FOREIGN KEY ("evse_id") REFERENCES "assets"."evses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Note: org_id is written but never filtered on — the resolver keys on
-- (charging_station_id, consumed_id_tag, consumed_at) alone, so the
-- column is decorative. The FK at least guarantees it names a real
-- organisation. The resolver should either filter on it or the column
-- should go; see audit finding 2.

-- NOTE — assets.charging_stations is keyed on site_asset_id, not id; it
-- has no id column at all, being a 1:1 extension of
-- properties.site_assets. So tap_intents.charging_station_id in fact
-- holds a site_asset_id. The column name says otherwise and is
-- misleading; discovered only because adding this FK failed against
-- "id". Worth renaming, but not in the same migration that adds the
-- constraint.
