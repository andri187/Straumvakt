#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const DALVEGUR = "37de71e8-10bc-458e-ab5d-164eaccd75e6";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // 0. Show all columns on charging_stations so we know what flags exist
  const cols = await c.query(
    `select column_name from information_schema.columns
      where table_schema='assets' and table_name='charging_stations'
      order by ordinal_position`,
  );
  console.log("=== charging_stations columns ===");
  console.log("  " + cols.rows.map((r) => r.column_name).join(", "));

  // 1. Total ChargingStations under Dalvegur
  const cs = await c.query(
    `select count(*)::int as total
       from assets.charging_stations
      where installation_id = $1`,
    [DALVEGUR],
  );
  console.log("\n=== ChargingStations under Dalvegur ===");
  console.log("  total:", cs.rows[0].total);

  // 2. Per-charger view
  const conn = await c.query(
    `select cs.site_asset_id, sa.display_name, count(co.id)::int as connectors,
            cs.firmware_version, cs.online_since_at, cs.last_telemetry_at,
            sa.metadata
       from assets.charging_stations cs
       join properties.site_assets sa on sa.id = cs.site_asset_id
       left join assets.evses ev on ev.charging_station_id = cs.site_asset_id
       left join assets.connectors co on co.evse_id = ev.id
      where cs.installation_id = $1
      group by 1,2,4,5,6,7
      order by sa.display_name`,
    [DALVEGUR],
  );
  console.log(`\n=== Per-charger view (${conn.rowCount}) ===`);
  console.log(
    "  display_name".padEnd(40),
    "conn",
    "online_since_at".padEnd(28),
    "last_telemetry_at".padEnd(28),
    "active",
  );
  let activeCount = 0;
  let totalConnectors = 0;
  for (const r of conn.rows) {
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    // Zaptec mirrors the IsActive flag into site_assets.metadata.zaptec.isActive.
    const z = (meta["zaptec"] as Record<string, unknown> | undefined) ?? {};
    const isActive = z["isActive"] ?? z["active"] ?? meta["active"];
    if (isActive !== false) activeCount++;
    totalConnectors += r.connectors as number;
    console.log(
      "  " + (r.display_name as string).padEnd(38),
      String(r.connectors).padEnd(4),
      (r.online_since_at?.toISOString?.() ?? "—").padEnd(28),
      (r.last_telemetry_at?.toISOString?.() ?? "—").padEnd(28),
      String(isActive ?? "—"),
    );
  }
  console.log(
    `\n  Sum: ${conn.rowCount} chargers, ${totalConnectors} connectors, ` +
      `${activeCount} not-marked-inactive`,
  );

  // 3. Distinct connector status values
  const st = await c.query(
    `select co.status, count(*)::int as n
       from assets.connectors co
       join assets.evses ev on ev.id = co.evse_id
       join assets.charging_stations cs on cs.site_asset_id = ev.charging_station_id
      where cs.installation_id = $1
      group by 1`,
    [DALVEGUR],
  );
  console.log(`\n=== Connector status values ===`);
  for (const r of st.rows) console.log(`  ${r.status?.padEnd?.(20) ?? "<null>"} ${r.n}`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
