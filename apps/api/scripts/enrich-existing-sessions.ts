#!/usr/bin/env tsx
/**
 * Sprint 8.14.6 — one-shot enrichment of existing Zaptec-imported
 * sessions to surface improvements that landed in 8.14.3-8.14.5.
 * Uses ONLY data already in our DB (rawPayload of ImportedCdrRef);
 * no Zaptec API calls, no need for the password.
 *
 * For each existing zaptec ImportedCdrRef:
 *   • Update SiteAsset.displayName from rawPayload.DeviceName when
 *     the current displayName is a UUID / empty / equals the
 *     ChargerId (operator-edited names preserved).
 *   • Update ChargingStation.serialNumber from rawPayload.DeviceId.
 *   • Update ChargingStation.firmwareVersion from
 *     rawPayload.ChargerFirmwareVersion (formatted Major.Minor.Rev.Build).
 *   • Update ChargeSession.stopReason — normalise legacy
 *     "synthetic_zaptec_api" / "ExternallyEnded" placeholders to
 *     "Completed" so /charge-log doesn't paint every row amber.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

interface FirmwareObject {
  Build?: number;
  Major?: number;
  Minor?: number;
  Revision?: number;
}

function formatFirmware(fw: unknown): string | null {
  if (!fw) return null;
  if (typeof fw === "string") return fw;
  if (typeof fw !== "object") return null;
  const obj = fw as FirmwareObject;
  const parts = [obj.Major, obj.Minor, obj.Revision, obj.Build].filter(
    (n): n is number => typeof n === "number",
  );
  return parts.length > 0 ? parts.join(".") : null;
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Step 1: Inspect existing zaptec imports ===");
  const refs = await c.query(
    `select icr.session_id, icr.source_cdr_id, icr.raw_payload,
            cs.id as charge_session_id,
            cs.charging_station_id,
            cs.stop_reason
     from charging.imported_cdr_refs icr
     join charging.sessions cs on cs.id = icr.session_id
     where icr.source_kind = 'zaptec'
     order by icr.imported_at`,
  );
  console.log(`  Found ${refs.rowCount} zaptec import(s).\n`);

  let stationsUpdated = 0;
  let assetsUpdated = 0;
  let stopReasonsNormalised = 0;

  for (const row of refs.rows) {
    const payload = row.raw_payload;
    const stationId = row.charging_station_id;
    if (!stationId || !payload) continue;

    // 1. SiteAsset.displayName
    if (payload.DeviceName) {
      const asset = await c.query(
        `select display_name from properties.site_assets where id = $1`,
        [stationId],
      );
      const currentName = asset.rows[0]?.display_name;
      const shouldUpdate =
        !currentName ||
        /^[0-9a-f-]{36}$/i.test(currentName) ||
        currentName === payload.ChargerId;
      if (shouldUpdate && currentName !== payload.DeviceName) {
        await c.query(
          `update properties.site_assets set display_name = $1, updated_at = now() where id = $2`,
          [payload.DeviceName, stationId],
        );
        assetsUpdated++;
      }
    }

    // 2. ChargingStation.serialNumber + firmwareVersion
    const stationUpdates: string[] = [];
    const stationParams: unknown[] = [];
    if (payload.DeviceId) {
      stationUpdates.push(`serial_number = $${stationParams.length + 1}`);
      stationParams.push(String(payload.DeviceId).toUpperCase());
    }
    const fw = formatFirmware(payload.ChargerFirmwareVersion);
    if (fw) {
      stationUpdates.push(`firmware_version = $${stationParams.length + 1}`);
      stationParams.push(fw);
    }
    if (stationUpdates.length > 0) {
      stationParams.push(stationId);
      await c.query(
        `update assets.charging_stations
         set ${stationUpdates.join(", ")}, updated_at = now()
         where site_asset_id = $${stationParams.length}`,
        stationParams,
      );
      stationsUpdated++;
    }
  }

  // 3. Normalise stopReason on ALL zaptec-imported sessions
  console.log("=== Step 2: Normalise stopReason placeholders ===");
  const stopReasonUpdate = await c.query(
    `update charging.sessions
     set stop_reason = 'Completed', updated_at = now()
     where id in (
       select session_id from charging.imported_cdr_refs where source_kind = 'zaptec'
     )
     and stop_reason in ('synthetic_zaptec_api', 'ExternallyEnded')
     returning id`,
  );
  stopReasonsNormalised = stopReasonUpdate.rowCount ?? 0;

  console.log(`\n=== Summary ===`);
  console.log(`  SiteAsset display names updated:  ${assetsUpdated}`);
  console.log(`  ChargingStation rows updated:     ${stationsUpdated}`);
  console.log(`  stopReason normalisations:        ${stopReasonsNormalised}`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
