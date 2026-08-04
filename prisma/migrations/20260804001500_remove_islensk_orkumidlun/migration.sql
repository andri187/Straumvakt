-- Íslensk orkumiðlun no longer exists — acquired by N1.
--
-- Seeded in 20260804000500_seed_grid_parties from a list that was already
-- out of date. Removed here rather than by editing that migration, which
-- is applied and checksummed.
--
-- Safe: seeded minutes earlier, referenced by nothing.
--
-- N1 gains the retailer role as a consequence. It already held site_host,
-- so it now carries {site_host,retailer} — the second real instance of a
-- company in two roles, after Orkubú Vestfjarða. This is exactly the case
-- that ruled out a separate grid-parties table: N1 is simultaneously a
-- charging customer and an electricity retailer, and must be one row.

DELETE FROM "tenancy"."organizations"
 WHERE id = '0e5d0033-0000-4000-8000-00000000d533';

UPDATE "tenancy"."organizations"
   SET roles = array_append(roles, 'retailer'::"tenancy"."OrganizationRole"),
       updated_at = now()
 WHERE display_name = 'N1 ehf'
   AND NOT ('retailer' = ANY(roles));
