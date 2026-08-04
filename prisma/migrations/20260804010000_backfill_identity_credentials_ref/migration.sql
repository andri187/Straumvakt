-- Backfill ocpp_identities.credentials_ref — 30 of 31 were NULL.
--
-- The Zaptec importer never set it; only attach-vendor did, which is why
-- exactly one identity had it. PROBE-1 (7d20303) then made credentials_ref
-- authoritative and hard-failed on NULL, blanking the technical-read for
-- the entire fleet. 9ac5c53 added a fallback chain
-- (identity.credentials_ref → installation.credentialsRef → the sole
-- active credential) which masked it.
--
-- That fallback is a footgun, not a fix: it resolves today only because
-- exactly one credential exists, and it refuses to guess among two or
-- more. The day a second Zaptec credential is added, all 30 identities
-- re-blank simultaneously. This removes the dependency on that accident.
--
-- Resolution order, most precise first:
--   1. the installation's own credentials_ref, via
--      identity → charging_station → installation  (both installations
--      have one set, so this covers the fleet precisely)
--   2. the sole active credential, only if exactly one exists
--
-- Step 2 is guarded: if two or more active credentials exist it does
-- nothing rather than guessing, which is the same refusal the application
-- fallback makes. Anything left NULL after this is a real gap and should
-- surface as no_credential rather than be papered over.

-- 1. Via the installation chain.
UPDATE "ocpp"."ocpp_identities" oi
   SET credentials_ref = i.credentials_ref,
       updated_at      = now()
  FROM "assets"."charging_stations" cs
  JOIN "properties"."installations" i ON i.id = cs.installation_id
 WHERE cs.site_asset_id = oi.charging_station_id
   AND oi.credentials_ref IS NULL
   AND i.credentials_ref IS NOT NULL;

-- 2. Sole active credential, only when unambiguous.
UPDATE "ocpp"."ocpp_identities" oi
   SET credentials_ref = (SELECT id FROM "hardware"."vendor_credentials" WHERE status = 'active'),
       updated_at      = now()
 WHERE oi.credentials_ref IS NULL
   AND (SELECT count(*) FROM "hardware"."vendor_credentials" WHERE status = 'active') = 1;
