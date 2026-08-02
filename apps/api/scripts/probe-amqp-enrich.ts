#!/usr/bin/env tsx
// Read-only — CDR-enrichment-via-AMQP coverage for the last 24h.
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(`
    select count(*)::int sessions_24h,
           count(*) filter (where completed_session_raw_json is not null)::int with_raw_json,
           count(*) filter (where ocmf_signed_session is not null)::int with_ocmf,
           count(*) filter (where ev_plc_mac is not null)::int with_plc_mac,
           count(*) filter (where user_id is not null)::int with_user_id,
           count(*) filter (where id_tag is not null)::int with_id_tag,
           max(completed_session_seen_at) latest_amqp_close
      from charging.sessions
     where started_at >= now() - interval '24 hours'
  `);
  console.log(r.rows[0]);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
