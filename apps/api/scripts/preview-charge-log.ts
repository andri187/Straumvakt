#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `select cs.started_at, cs.ended_at, cs.stop_reason,
            sa.display_name as charger_name,
            cs.energy_wh, sl.cost_isk_minor, sl.driver_id_tag
     from charging.sessions cs
     join charging.imported_cdr_refs icr on icr.session_id = cs.id
     left join properties.site_assets sa on sa.id = cs.charging_station_id
     left join reports.session_ledger sl on sl.session_id = cs.id
     where icr.source_kind = 'zaptec'
     order by cs.started_at desc`,
  );
  console.log(
    "started_at         charger          stop_reason   energy   cost   driver",
  );
  console.log("─".repeat(85));
  for (const row of r.rows) {
    const kr = row.cost_isk_minor
      ? (Number(row.cost_isk_minor) / 100).toFixed(0)
      : "-";
    const kwh = row.energy_wh
      ? (Number(row.energy_wh) / 1000).toFixed(2)
      : "-";
    console.log(
      `${row.started_at.toISOString().slice(0, 16)}  ` +
        `${(row.charger_name ?? "-").padEnd(15)}  ` +
        `${(row.stop_reason ?? "-").padEnd(13)}  ` +
        `${kwh.padStart(6)}  ${kr.padStart(5)} kr  ` +
        `${row.driver_id_tag ?? "(anon)"}`,
    );
  }
  await c.end();
})();
