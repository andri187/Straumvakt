#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const id = await c.query(`select id from ocpp.ocpp_identities where identity_string = 'vcp-001'`);
  const identityId = id.rows[0]?.id;
  console.log(`vcp-001 identity_id: ${identityId}`);

  const events = await c.query(`
    select event_type, occurred_at, recorded_at, payload->'action' as action
      from events.event_log
     where aggregate_id = $1
     order by occurred_at desc
     limit 15
  `, [identityId]);
  console.log(`\nRecent event_log for vcp-001 (${events.rowCount}):`);
  for (const e of events.rows) {
    console.log(`  ${e.occurred_at.toISOString()}  ${e.event_type}  action=${e.action ?? "—"}  recorded=${e.recorded_at.toISOString()}`);
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
