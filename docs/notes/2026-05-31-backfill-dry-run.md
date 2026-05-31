# Backfill tariff_definition_id — dry-run 2026-05-31

## Script
- `apps/api/scripts/backfill-tariff-definition-id.ts`
- Mode: dry-run (default)
- Database: staging Neon (per `.env.local`)
- Executed at: 2026-05-31

## History

FINAL-2 agent's first run failed at the candidates query with
`relation "assets.site_assets" does not exist`. Root cause: the script
referenced `assets.site_assets` but the table actually lives in the
`properties` schema (`properties.site_assets`). The schema reference
was fixed (`assets.site_assets` → `properties.site_assets` on
line 197 of the script) and the dry-run re-ran cleanly. The output
below is from the corrected run.

The `ChargingStation` model uses `site_asset_id` as both its primary
key and its FK to `properties.site_assets` (`siteAssetId String @id`),
which is why the simple two-step join works without explicitly going
through `assets.charging_stations`.

## Summary

| Metric | Count |
|---|---|
| Candidates evaluated (priced rows with NULL FK) | **489** |
| Would be backfilled (chain resolves cleanly) | **488** |
| Would be skipped (chain incomplete) | **1** |
| Cost-sanity warnings | 0 |
| Already-OK (existing FK) | 0 |

## Skipped rows analysis

One session row has no `charging_station_id` — it's an orphan ledger
row that the resolver can't trace back through Site→TariffDefinition.

| session_id | reason | notes |
|---|---|---|
| `0b308456-f1f1-411b-8385-f5279c5b7fdd` | `no_charging_station` | Pre-existing data quality issue. Survives backfill untouched; can be left as-is. |

## Risks noticed

- **None blocking.** The 1 skipped row is the same data-quality
  issue AUD-1 hinted at (orphan ledger rows with broken FK chain).
  It doesn't impede the backfill of the other 488 rows.
- All 488 rows would resolve to the same TariffDefinition
  `7c38fab3-69a6-4938-8ed6-4704962e7c3d` ("Veitur AD1") — makes
  sense because every staging session ran at Dalvegur, and the
  script writes only the DSO id as the canonical anchor per ADR 0008
  (same pattern as the live resolver writes via FIX-1).

## Recommendation

**Backfill is clean — operator can run `--apply` directly.**

```
cd apps/api
npx tsx scripts/backfill-tariff-definition-id.ts --apply
```

Expected result: 488 ledger rows get `tariff_definition_id` set, 1
row skipped, no cost values touched.
