-- Remove the placeholder 'Veitur ohf' row, superseded by the
-- reference-derived 'Veitur' (kt 5012131870).
--
-- The placeholder predates tonight: it was kept during the 2026-08-03 org
-- cleanup because Veitur is the DSO in the tariff chain, but it carried no
-- kennitala, no address and no legal name. 20260804030000 seeded the real
-- entity from docs/reference/iceland-energy-parties.json, leaving two rows
-- for one company.
--
-- The previous migration's DELETE only caught rows it had itself created
-- (the 0e5d… fixed UUIDs); this one predates that and survived.
--
-- Verified before deletion: 0 properties, 0 chargers, 0 memberships,
-- 0 sessions. Nothing references it.

DELETE FROM "tenancy"."organizations"
 WHERE id = '9ca67a0d-b408-4070-bd37-047592192817'
   AND kennitala IS NULL
   AND NOT EXISTS (SELECT 1 FROM "properties"."properties"    WHERE org_id = '9ca67a0d-b408-4070-bd37-047592192817')
   AND NOT EXISTS (SELECT 1 FROM "assets"."charging_stations" WHERE org_id = '9ca67a0d-b408-4070-bd37-047592192817')
   AND NOT EXISTS (SELECT 1 FROM "tenancy"."memberships"      WHERE org_id = '9ca67a0d-b408-4070-bd37-047592192817');
