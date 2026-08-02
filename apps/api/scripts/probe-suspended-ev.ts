#!/usr/bin/env tsx
// Read-only — what's in connectors.error_code / vendor_error_code
// for chargers currently in SuspendedEV, plus the OCPP info field from
// the last StatusNotification event for each.
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { EVENT_LOG_ALL } from "./_protocol-log-union";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Current connector state
  const cur = await c.query(`
    select sa.display_name as charger,
           cn.id as connector_id,
           cn.status,
           cn.status_updated_at,
           cn.error_code,
           cn.vendor_error_code
      from assets.connectors cn
      join assets.evses ev on ev.id = cn.evse_id
      join properties.site_assets sa on sa.id = ev.charging_station_id
      join assets.charging_stations cs on cs.site_asset_id = ev.charging_station_id
      join properties.installations i on i.id = cs.installation_id
     where i.display_name ilike 'Dalvegur%'
       and cn.status = 'SuspendedEV'
     order by cn.status_updated_at desc
  `);

  console.log("=== Connectors currently SuspendedEV ===\n");
  for (const r of cur.rows) {
    console.log(`  ${r.charger}`);
    console.log(`    status_updated_at  : ${r.status_updated_at?.toISOString?.()}`);
    console.log(`    error_code         : ${r.error_code ?? "(null)"}`);
    console.log(`    vendor_error_code  : ${r.vendor_error_code ?? "(null)"}`);
    console.log();
  }

  // Last few StatusNotification events for those identities,
  // showing the full payload (especially `info` field)
  const recent = await c.query(`
    select sa.display_name as charger,
           el.occurred_at,
           el.payload->'request'->>'status' as status,
           el.payload->'request'->>'errorCode' as error_code,
           el.payload->'request'->>'vendorErrorCode' as vendor_error_code,
           el.payload->'request'->>'info' as info,
           el.payload->'request'->>'vendorId' as vendor_id
      from ${EVENT_LOG_ALL} el
      join ocpp.ocpp_identities oi on oi.id = el.aggregate_id
      join assets.charging_stations cs on cs.site_asset_id = oi.charging_station_id
      join properties.installations i on i.id = cs.installation_id
      join properties.site_assets sa on sa.id = cs.site_asset_id
     where i.display_name ilike 'Dalvegur%'
       and el.event_type = 'ocpp.raw.StatusNotification'
       and el.occurred_at > now() - interval '12 hours'
       and el.payload->'request'->>'status' = 'SuspendedEV'
     order by el.occurred_at desc
     limit 20
  `);

  console.log("=== Recent SuspendedEV StatusNotification raw payloads ===\n");
  if (recent.rowCount === 0) {
    console.log("  (none in the last 12 hours)");
  }
  for (const r of recent.rows) {
    console.log(
      `  ${r.charger.padEnd(15)} ${r.occurred_at.toISOString()}  err=${r.error_code ?? "—"}  vErr=${r.vendor_error_code ?? "—"}  info=${r.info ?? "—"}  vId=${r.vendor_id ?? "—"}`,
    );
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
