#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { EVENT_LOG_ALL } from "./_protocol-log-union";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const id = await c.query(`select id from ocpp.ocpp_identities where identity_string = 'vcp-001'`);
  const identityId = id.rows[0]?.id;
  console.log(`vcp-001 identity_id: ${identityId}`);

  // ADR 0039 D1 — vcp-001's frames are `ocpp.raw.*`, so post-split they
  // live in protocol_log while the pre-split ones remain in event_log.
  const events = await c.query(`
    select event_type, occurred_at, recorded_at, payload->'action' as action
      from ${EVENT_LOG_ALL} el
     where aggregate_id = $1
     order by occurred_at desc
     limit 15
  `, [identityId]);
  console.log(`\nRecent log rows for vcp-001, both tables (${events.rowCount}):`);
  for (const e of events.rows) {
    console.log(`  ${e.occurred_at.toISOString()}  ${e.event_type}  action=${e.action ?? "—"}  recorded=${e.recorded_at.toISOString()}`);
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
