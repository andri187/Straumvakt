#!/usr/bin/env tsx
// Read-only — sample rate per StateId in the last 15 min.
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(`
    select state_id,
           count(*)::int n,
           min(observed_at) earliest,
           max(observed_at) latest,
           round(extract(epoch from (max(observed_at) - min(observed_at))) / nullif(count(*) - 1, 0), 1)::float avg_interval_sec
      from charging.live_session_samples
     where observed_at > now() - interval '15 minutes'
     group by state_id
     order by n desc
     limit 20
  `);
  console.table(r.rows);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
