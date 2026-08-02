#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const id = await c.query(`
    select oi.identity_string, oi.status as ocpp_status, oi.last_seen_at,
           cs.vendor, cs.model, cs.serial_number, cs.firmware_version,
           cn.status as connector_status, cn.status_updated_at as cn_updated_at
      from ocpp.ocpp_identities oi
      join assets.charging_stations cs on cs.site_asset_id = oi.charging_station_id
      left join assets.evses ev on ev.charging_station_id = cs.site_asset_id
      left join assets.connectors cn on cn.evse_id = ev.id
     where oi.identity_string = 'vcp-001'
  `);
  console.log("=== vcp-001 state ===");
  console.log(id.rows[0]);

  const sessions = await c.query(`
    select id, status, started_at, ended_at, energy_wh, id_tag, user_id, cost_inc_vat_minor
      from charging.sessions
     where ocpp_identity_id = (select id from ocpp.ocpp_identities where identity_string = 'vcp-001')
     order by started_at desc
     limit 3
  `);
  console.log(`\n=== Recent vcp-001 sessions (${sessions.rowCount}): ===`);
  for (const s of sessions.rows) {
    console.log(`  ${s.id}  ${s.status}  ${s.started_at.toISOString()}  energy=${s.energy_wh} idTag=${s.id_tag} user=${s.user_id} cost=${s.cost_inc_vat_minor}`);
  }

  const ledger = await c.query(`
    select session_id, driver_user_id, driver_id_tag, energy_kwh, cost_isk_minor
      from reports.session_ledger
     where session_id in (select id from charging.sessions where ocpp_identity_id = (select id from ocpp.ocpp_identities where identity_string = 'vcp-001'))
     order by stopped_at desc
     limit 3
  `);
  console.log(`\n=== Ledger entries (${ledger.rowCount}): ===`);
  for (const l of ledger.rows) {
    console.log(`  ${l.session_id}  user=${l.driver_user_id} tag=${l.driver_id_tag} kwh=${l.energy_kwh} cost=${l.cost_isk_minor}`);
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
