#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { EVENT_LOG_ALL } from "./_protocol-log-union";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // 1. AMQP-fed tables
  const lss = await c.query(`select count(*)::int n, max(observed_at) latest from charging.live_session_samples`);
  const ls = await c.query(`select count(*)::int n, max(last_mode_at) latest from charging.live_sessions`);
  console.log("=== AMQP-fed tables ===");
  console.log(`  live_session_samples: ${lss.rows[0].n} rows, latest=${lss.rows[0].latest?.toISOString?.() ?? "(none)"}`);
  console.log(`  live_sessions:        ${ls.rows[0].n} rows, latest=${ls.rows[0].latest?.toISOString?.() ?? "(none)"}`);

  // 2. Vehicle-identity captures across all sessions
  const vid = await c.query(
    `select
       count(*) filter (where ev_plc_mac is not null)::int as with_mac,
       count(*) filter (where auth_id_value is not null)::int as with_ocmf_id,
       count(*) filter (where pnc_attempted is not null)::int as with_pnc,
       count(*) filter (where cable_type is not null)::int as with_cable
     from charging.sessions`,
  );
  console.log("\n=== Vehicle-identity captures (Autocharge) ===");
  console.log(`  with ev_plc_mac:     ${vid.rows[0].with_mac}`);
  console.log(`  with auth_id_value:  ${vid.rows[0].with_ocmf_id}`);
  console.log(`  with pnc_attempted:  ${vid.rows[0].with_pnc}`);
  console.log(`  with cable_type:     ${vid.rows[0].with_cable}`);

  // 3. New sessions created since OCPP cutover (~21:00 UTC May 8)
  const newSessions = await c.query(
    `select count(*)::int as total,
            count(*) filter (where ocmf_signed_session is not null)::int as with_ocmf,
            min(created_at) as first_new,
            max(created_at) as latest_new
       from charging.sessions
      where created_at > '2026-05-08 21:00:00+00'::timestamptz`,
  );
  console.log("\n=== Sessions created since OCPP cutover (2026-05-08 21:00 UTC) ===");
  console.log(`  total: ${newSessions.rows[0].total}`);
  console.log(`  with OCMF: ${newSessions.rows[0].with_ocmf}`);
  console.log(`  first: ${newSessions.rows[0].first_new?.toISOString?.() ?? "(none)"}`);
  console.log(`  latest: ${newSessions.rows[0].latest_new?.toISOString?.() ?? "(none)"}`);

  // 4. Recent OCPP events (any kind) in last 12 hours — confirms gateway alive
  const events = await c.query(
    `select event_type, count(*)::int as n,
            max(occurred_at) as latest
       from ${EVENT_LOG_ALL} el
      where occurred_at > now() - interval '12 hours'
        and event_type ilike 'ocpp%'
      group by 1 order by 2 desc`,
  );
  console.log("\n=== Recent OCPP events (last 12h) ===");
  if (events.rowCount === 0) console.log("  (none — gateway silent)");
  for (const r of events.rows) {
    console.log(`  ${(r.event_type as string).padEnd(40)} ${String(r.n).padStart(5)}  latest=${r.latest?.toISOString?.()}`);
  }

  // 5. Active in-progress sessions right now
  const active = await c.query(
    `select count(*)::int as n, max(started_at) as latest
       from charging.sessions where status = 'in_progress'`,
  );
  console.log("\n=== Active in-progress sessions right now ===");
  console.log(`  count: ${active.rows[0].n}, latest start: ${active.rows[0].latest?.toISOString?.() ?? "(none)"}`);

  await c.end();

  console.log("\n=== Verdict ===");
  const caughtSomething =
    lss.rows[0].n > 0 ||
    ls.rows[0].n > 0 ||
    vid.rows[0].with_mac > 0 ||
    vid.rows[0].with_ocmf_id > 0;
  if (caughtSomething) {
    console.log("  ✅ Some capture has occurred — see numbers above");
  } else {
    console.log("  ⚠ Nothing caught yet. Need a real plug-in at Dalvegur.");
  }
})().catch((e) => { console.error(e); process.exit(1); });
