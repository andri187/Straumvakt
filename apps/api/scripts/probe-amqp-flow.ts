#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const s = await c.query(`select count(*)::int n, max(observed_at) latest from charging.live_session_samples`);
  const ls = await c.query(`select count(*)::int n, max(last_mode_at) latest from charging.live_sessions`);
  const recent = await c.query(`select count(*)::int n from charging.live_session_samples where observed_at > now() - interval '5 minutes'`);
  console.log(`live_session_samples: total=${s.rows[0].n}, last_5m=${recent.rows[0].n}, latest=${s.rows[0].latest?.toISOString?.() ?? "(none)"}`);
  console.log(`live_sessions:        total=${ls.rows[0].n}, latest=${ls.rows[0].latest?.toISOString?.() ?? "(none)"}`);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
