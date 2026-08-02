#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const STATION = process.argv[2] ?? "2440557c-d1f4-41d0-972e-c7b94707fd85";
const TEST_PWD = process.argv[3];  // optional

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `select sa.display_name as name,
            cs.installation_id,
            i.display_name as install_name,
            i.enforce_authorize,
            oi.identity_string,
            oi.auth_secret_hash,
            oi.auth_secret_hash is null as no_auth,
            oi.status as ocpp_status,
            oi.last_seen_at,
            oi.ocpp_version
       from properties.site_assets sa
       join assets.charging_stations cs on cs.site_asset_id = sa.id
       left join properties.installations i on i.id = cs.installation_id
       left join ocpp.ocpp_identities oi on oi.charging_station_id = sa.id
      where sa.id = $1`,
    [STATION],
  );
  console.log(r.rows[0]);

  if (TEST_PWD && r.rows[0]?.auth_secret_hash) {
    const sha256 = createHash("sha256").update(TEST_PWD).digest("hex");
    const match = sha256.toLowerCase() === String(r.rows[0].auth_secret_hash).toLowerCase();
    console.log(`\nTest password sha256:      ${sha256}`);
    console.log(`Stored auth_secret_hash:   ${r.rows[0].auth_secret_hash}`);
    console.log(`Match? ${match ? "✓ YES — password IS correct, problem is elsewhere" : "✗ NO — password mismatch"}`);
  }

  // Recent pending_discoveries for this identity (after claim, should be gone or re-appeared)
  if (r.rows[0]?.identity_string) {
    const pd = await c.query(
      `select identity_string, last_seen_at, attempt_count, remote_addr
         from ocpp.pending_discoveries
        where identity_string ilike $1
        order by last_seen_at desc
        limit 5`,
      [r.rows[0].identity_string],
    );
    console.log(`\nPending discoveries for ${r.rows[0].identity_string}: ${pd.rowCount} row(s)`);
    for (const row of pd.rows) {
      console.log(`  ${row.identity_string}  last_seen=${row.last_seen_at.toISOString()}  attempts=${row.attempt_count}`);
    }
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
