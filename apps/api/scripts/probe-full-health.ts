#!/usr/bin/env tsx
/**
 * Comprehensive health + reliability sweep across everything DB-visible.
 * Read-only. Run after deploys, during operational reviews, or any time
 * the operator wants a single "is everything ok" snapshot.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { EVENT_LOG_ALL } from "./_protocol-log-union";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const FRESH_MS = 5 * 60 * 1000;

function status(condition: boolean, ok = "✅", warn = "⚠️", bad = "🔴"): string {
  return condition ? ok : bad;
}

function ageHr(d: Date | null): string {
  if (!d) return "(never)";
  const hr = Math.round((Date.now() - d.getTime()) / 3_600_000);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function ageMin(d: Date | null): string {
  if (!d) return "(never)";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 60) return `${min}m ago`;
  return ageHr(d);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("════════════════════════════════════════════════════════════");
  console.log("     STRAUMVAKT FULL HEALTH + RELIABILITY SWEEP");
  console.log(`     ${new Date().toISOString()}`);
  console.log("════════════════════════════════════════════════════════════\n");

  // ───────────────────────────────────────────────────────────────────
  // 1. INGEST PIPELINE — event_log + protocol_log + recent rates
  // ───────────────────────────────────────────────────────────────────
  //
  // ADR 0039 D1 split raw frames into events.protocol_log. Since
  // heartbeats alone are ~80% of ingest, reading event_log alone here
  // would show an 80% cliff on the day the migration lands and then
  // report a healthy pipeline as STALE. The union is the whole point.
  console.log("── 1. Ingest pipeline (event_log + protocol_log writes) ─────");
  const ingest = await c.query(`
    select count(*) filter (where recorded_at > now() - interval '5 minutes')::int last_5m,
           count(*) filter (where recorded_at > now() - interval '1 hour')::int last_1h,
           count(*) filter (where recorded_at > now() - interval '24 hours')::int last_24h,
           max(recorded_at) latest
      from ${EVENT_LOG_ALL} el
  `);
  const i = ingest.rows[0];
  console.log(`  last 5min:  ${i.last_5m}    last 1h: ${i.last_1h}    last 24h: ${i.last_24h}`);
  console.log(`  latest:     ${i.latest?.toISOString?.() ?? "(never)"}   ${ageMin(i.latest)}`);
  console.log(`  ${status(i.last_5m > 0 || i.last_1h > 0)} ingest pipeline ${i.last_5m > 0 ? "active" : i.last_1h > 0 ? "quiet but recent" : "STALE"}`);

  // Event type breakdown last hour
  const types = await c.query(`
    select event_type, count(*)::int n
      from ${EVENT_LOG_ALL} el
     where recorded_at > now() - interval '1 hour'
     group by event_type
     order by n desc
     limit 10
  `);
  console.log("\n  Event types last 1h:");
  if (types.rowCount === 0) {
    console.log("    (none)");
  }
  for (const r of types.rows) {
    console.log(`    ${r.n.toString().padStart(5)}  ${r.event_type}`);
  }

  // ───────────────────────────────────────────────────────────────────
  // 2. CRON / SCHEDULED JOB ACTIVITY (proxy via Zaptec sync results)
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 2. Cron / scheduled activity ─────────────────────────────");
  const hbAge = await c.query(`
    select count(*) filter (where last_seen_at > now() - interval '5 minutes')::int fresh_5m,
           count(*) filter (where last_seen_at > now() - interval '1 hour')::int fresh_1h,
           count(*)::int total,
           max(last_seen_at) latest
      from ocpp.ocpp_identities
     where status != 'decommissioned'
  `);
  const h = hbAge.rows[0];
  console.log(`  identities total: ${h.total}    fresh <5m: ${h.fresh_5m}    fresh <1h: ${h.fresh_1h}`);
  console.log(`  latest heartbeat: ${ageMin(h.latest)}`);
  console.log(`  ${status(h.fresh_5m > 0 || h.fresh_1h > 0)} cron / fast-path consumer ${h.fresh_5m > 0 ? "advancing lastSeenAt" : h.fresh_1h > 0 ? "stale but recent" : "FROZEN"}`);

  // ───────────────────────────────────────────────────────────────────
  // 3. AMQP / Fly consumer (live_session_samples)
  //
  // NOTE: stale samples in this table can mean THREE things, only one
  // of which is a real failure:
  //   1. Fly consumer machine stopped (real failure)
  //   2. AMQP socket disconnected, consumer not reconnecting (real)
  //   3. Consumer alive + receiving only low-priority StateIds (e.g.
  //      809 signal pings) that our API correctly drops — IDLE,
  //      not failed
  // The probe can't distinguish (3) from (1)/(2) from the DB alone;
  // it can only flag low-write activity as something to verify
  // externally via `flyctl status` + `flyctl logs`.
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 3. AMQP feed (Fly consumer + Azure SB) ───────────────────");
  const amqp = await c.query(`
    select count(*) filter (where observed_at > now() - interval '5 minutes')::int last_5m,
           count(*) filter (where observed_at > now() - interval '1 hour')::int last_1h,
           count(*) filter (where observed_at > now() - interval '24 hours')::int last_24h,
           count(*) filter (where observed_at > now() - interval '7 days')::int last_7d,
           count(*)::int total,
           max(observed_at) latest
      from charging.live_session_samples
  `);
  const a = amqp.rows[0];
  console.log(`  samples total:    ${a.total}`);
  console.log(`  last 5min:        ${a.last_5m}    last 1h: ${a.last_1h}    last 24h: ${a.last_24h}`);
  console.log(`  latest:           ${a.latest?.toISOString?.() ?? "(never)"}   ${ageMin(a.latest)}`);
  if (a.last_5m > 0) {
    console.log(`  ✅ AMQP writing samples actively`);
  } else if (a.last_1h > 0) {
    console.log(`  ✅ AMQP wrote samples recently (within last hour). Idle or low traffic.`);
  } else if (a.last_24h > 0) {
    console.log(`  ⚠️  AMQP samples stale — last write ${ageMin(a.latest)}. Could be: (a) genuine idle window, (b) consumer alive but receiving only filtered StateIds, OR (c) consumer dead. Verify with: flyctl status -a straumvakt-zaptec-consumer-staging`);
  } else {
    console.log(`  🔴 AMQP samples not written in last 24h — likely real failure. Verify with: flyctl status -a straumvakt-zaptec-consumer-staging`);
  }

  // AMQP enrichment landing on sessions
  const enrich = await c.query(`
    select count(*) filter (where started_at > now() - interval '24 hours')::int recent,
           count(*) filter (where started_at > now() - interval '24 hours' and completed_session_raw_json is not null)::int with_raw,
           count(*) filter (where started_at > now() - interval '24 hours' and ocmf_signed_session is not null)::int with_ocmf,
           count(*) filter (where started_at > now() - interval '24 hours' and ev_plc_mac is not null)::int with_mac,
           max(completed_session_seen_at) latest_amqp_close
      from charging.sessions
  `);
  const e = enrich.rows[0];
  console.log(`\n  Sessions last 24h: ${e.recent}   with raw_json: ${e.with_raw}   with OCMF: ${e.with_ocmf}   with PLC MAC: ${e.with_mac}`);
  console.log(`  latest AMQP close seen: ${e.latest_amqp_close?.toISOString?.() ?? "(never)"}`);
  console.log(`  ${status(e.with_raw > 0 && e.recent > 0)} AMQP→session enrichment ${e.with_raw > 0 ? "landing" : "DEAD — separate bug, pre-existing"}`);

  // ───────────────────────────────────────────────────────────────────
  // 4. CHARGE SESSIONS (last 24h)
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 4. Session activity (last 24h) ───────────────────────────");
  const sess = await c.query(`
    select count(*)::int total,
           count(*) filter (where status='in_progress')::int in_prog,
           count(*) filter (where status='completed')::int completed,
           count(*) filter (where status='aborted')::int aborted,
           count(*) filter (where user_id is not null)::int with_user,
           count(*) filter (where id_tag is not null)::int with_id_tag,
           count(*) filter (where cost_inc_vat_minor is not null)::int with_cost,
           max(started_at) latest_start,
           max(ended_at) latest_end
      from charging.sessions
     where started_at > now() - interval '24 hours' or ended_at > now() - interval '24 hours'
  `);
  const s = sess.rows[0];
  console.log(`  sessions:          ${s.total}    in_progress: ${s.in_prog}    completed: ${s.completed}    aborted: ${s.aborted}`);
  console.log(`  driver attributed: ${s.with_user} / ${s.total}    with id_tag: ${s.with_id_tag} / ${s.total}    with cost: ${s.with_cost} / ${s.total}`);
  console.log(`  latest start:      ${s.latest_start?.toISOString?.() ?? "(none)"}   ${ageMin(s.latest_start)}`);
  console.log(`  ${status(s.total > 0)} sessions writing ${s.total > 0 ? "✓" : "(idle window)"}`);

  // ───────────────────────────────────────────────────────────────────
  // 5. FIX-A PROJECTION HANDLERS (connector status writes)
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 5. Fix-A handlers (connectors.status_updated_at) ─────────");
  const cn = await c.query(`
    select count(*) filter (where status_updated_at > now() - interval '5 minutes')::int last_5m,
           count(*) filter (where status_updated_at > now() - interval '1 hour')::int last_1h,
           count(*) filter (where status_updated_at > now() - interval '24 hours')::int last_24h,
           count(*) filter (where status_updated_at is not null)::int ever_written,
           count(*)::int total_connectors,
           max(status_updated_at) latest
      from assets.connectors
  `);
  const cnr = cn.rows[0];
  console.log(`  total connectors:    ${cnr.total_connectors}    ever written: ${cnr.ever_written}`);
  console.log(`  fresh writes 5m:     ${cnr.last_5m}    1h: ${cnr.last_1h}    24h: ${cnr.last_24h}`);
  console.log(`  latest write:        ${ageMin(cnr.latest)}`);
  console.log(`  ${status(cnr.ever_written > 0)} fix-A handler ${cnr.last_1h > 0 ? "active" : cnr.ever_written > 0 ? "registered but quiet (idle)" : "NEVER WRITTEN — likely reverted"}`);

  // ───────────────────────────────────────────────────────────────────
  // 6. LEDGER + TARIFF RESOLUTION
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 6. Ledger / tariff resolution ────────────────────────────");
  const led = await c.query(`
    select count(*) filter (where stopped_at > now() - interval '24 hours')::int last_24h,
           count(*) filter (where stopped_at > now() - interval '24 hours' and cost_isk_minor > 0)::int with_cost,
           count(*) filter (where stopped_at > now() - interval '24 hours' and driver_user_id is not null)::int with_driver,
           sum(cost_isk_minor) filter (where stopped_at > now() - interval '24 hours')::bigint total_isk_minor,
           sum(energy_kwh) filter (where stopped_at > now() - interval '24 hours')::numeric total_kwh,
           max(stopped_at) latest
      from reports.session_ledger
  `);
  const l = led.rows[0];
  console.log(`  ledger entries 24h:  ${l.last_24h}    with cost: ${l.with_cost}    with driver: ${l.with_driver}`);
  console.log(`  total revenue 24h:   ${l.total_isk_minor ? (Number(l.total_isk_minor)/100).toFixed(2) + " kr." : "0 kr."}`);
  console.log(`  total energy 24h:    ${l.total_kwh ?? 0} kWh`);
  console.log(`  latest entry:        ${ageMin(l.latest)}`);
  console.log(`  ${status(l.last_24h === 0 || l.with_cost > 0)} tariff resolution ${l.with_cost > 0 ? "✓" : l.last_24h > 0 ? "WRITING ZERO COSTS — bug" : "(no entries to evaluate)"}`);

  // ───────────────────────────────────────────────────────────────────
  // 7. CDR SYNC (Zaptec REST writeback)
  //
  // NOTE: zero recent imports does NOT necessarily mean the cron is
  // broken — if there are no new sessions at Dalvegur in the window,
  // the sync correctly finds nothing to import. Cross-reference with
  // section 4 (Session activity): if sessions are also 0, CDR sync is
  // probably idle-correct.
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 7. Zaptec REST CDR sync ──────────────────────────────────");
  const cdr = await c.query(`
    select count(*) filter (where imported_at > now() - interval '1 hour')::int last_1h,
           count(*) filter (where imported_at > now() - interval '24 hours')::int last_24h,
           count(*) filter (where imported_at > now() - interval '7 days')::int last_7d,
           max(imported_at) latest
      from charging.imported_cdr_refs
     where source_kind = 'zaptec'
  `);
  const cdrR = cdr.rows[0];
  console.log(`  CDRs imported 1h:    ${cdrR.last_1h}    24h: ${cdrR.last_24h}    7d: ${cdrR.last_7d}`);
  console.log(`  latest import:       ${ageMin(cdrR.latest)}`);
  if (cdrR.last_1h > 0) {
    console.log(`  ✅ CDR sync actively importing`);
  } else if (cdrR.last_24h > 0) {
    console.log(`  ✅ CDR sync recent (within 24h). Idle if no new sessions.`);
  } else if (s.total > 0) {
    console.log(`  🔴 CDR sync stalled — ${s.total} session(s) in last 24h but no CDR imports. Investigate Zaptec OAuth / cron.`);
  } else if (cdrR.last_7d > 0) {
    console.log(`  ⚠️  No CDR imports in 24h AND no sessions either. Likely idle window (weekend, no driver activity). Verify with: wrangler tail hlada-api-staging | Select-String "zaptec-sync-cron"`);
  } else {
    console.log(`  🔴 No CDR imports in 7 days. Real failure — investigate.`);
  }

  // ───────────────────────────────────────────────────────────────────
  // 8. PENDING DISCOVERIES (auth-rejected chargers)
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 8. Pending discoveries ───────────────────────────────────");
  const pend = await c.query(`
    select count(*)::int total,
           count(*) filter (where last_seen_at > now() - interval '5 minutes')::int live,
           max(last_seen_at) latest
      from ocpp.pending_discoveries
  `);
  const p = pend.rows[0];
  console.log(`  total in pool:   ${p.total}    live (<5m): ${p.live}`);
  console.log(`  latest attempt:  ${ageMin(p.latest)}`);
  if (p.live > 0) {
    console.log(`  ⚠️  ${p.live} unprovisioned chargers actively retrying — go to /chargers/pending`);
  } else {
    console.log(`  ✅ no live unprovisioned chargers`);
  }

  // ───────────────────────────────────────────────────────────────────
  // 9. STALE in_progress sessions (would indicate Stop handler missed)
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 9. Stale in_progress sessions ────────────────────────────");
  const stale = await c.query(`
    select count(*)::int n,
           min(started_at) oldest
      from charging.sessions
     where status = 'in_progress'
       and started_at < now() - interval '6 hours'
  `);
  const st = stale.rows[0];
  console.log(`  in_progress > 6h:    ${st.n}`);
  if (st.n > 0) {
    console.log(`  oldest:              ${st.oldest?.toISOString?.()}   ${ageHr(st.oldest)}`);
    console.log(`  🔴 sessions stuck open — likely missed StopTransaction; manual cleanup needed`);
  } else {
    console.log(`  ✅ no stuck sessions`);
  }

  // ───────────────────────────────────────────────────────────────────
  // 10. ORG / DATA INTEGRITY
  // ───────────────────────────────────────────────────────────────────
  console.log("\n── 10. Data integrity ───────────────────────────────────────");
  const orphans = await c.query(`
    select
      (select count(*)::int from charging.sessions where org_id is null)               as sess_no_org,
      (select count(*)::int from charging.sessions where site_id is null)              as sess_no_site,
      (select count(*)::int from charging.sessions where charging_station_id is null)  as sess_no_station,
      (select count(*)::int from assets.connectors where evse_id is null)              as conn_no_evse,
      (select count(*)::int from ocpp.ocpp_identities where charging_station_id is null) as ident_no_station
  `);
  const o = orphans.rows[0];
  console.log(`  sessions missing org_id:        ${o.sess_no_org}`);
  console.log(`  sessions missing site_id:       ${o.sess_no_site}`);
  console.log(`  sessions missing chargingStation: ${o.sess_no_station}`);
  console.log(`  connectors missing EVSE:        ${o.conn_no_evse}`);
  console.log(`  identities missing station:     ${o.ident_no_station}`);
  const integrityOk = o.sess_no_org + o.sess_no_site + o.sess_no_station + o.conn_no_evse + o.ident_no_station === 0;
  console.log(`  ${status(integrityOk)} data integrity ${integrityOk ? "clean" : "ORPHANS — investigate"}`);

  // ───────────────────────────────────────────────────────────────────
  // VERDICT
  // ───────────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("                   VERDICT SUMMARY");
  console.log("════════════════════════════════════════════════════════════");
  // "warn" = something to verify externally; "fail" = real failure.
  // Idle correctness is not a fail.
  type Check = { name: string; state: "ok" | "warn" | "fail"; note?: string };
  const checks: Check[] = [
    { name: "Ingest pipeline",   state: i.last_1h > 0 ? "ok" : i.last_24h > 0 ? "warn" : "fail" },
    { name: "Cron / heartbeats", state: h.fresh_1h > 0 ? "ok" : "fail" },
    {
      name: "AMQP feed",
      state: a.last_1h > 0
        ? "ok"
        : a.last_24h > 0
          ? "ok" // recent enough; idle is fine
          : a.last_7d > 0
            ? "warn" // could be long idle window; verify externally
            : "fail",
      note: a.last_1h === 0 && a.last_24h === 0 && a.last_7d > 0
        ? "no writes 24h; verify via flyctl status + logs (could be idle weekend)"
        : a.last_7d === 0 ? "no writes 7d; likely real failure" : undefined,
    },
    { name: "AMQP enrichment",   state: e.with_raw > 0 ? "ok" : e.recent === 0 ? "ok" : "fail" },
    { name: "Sessions writing",  state: "ok" /* idle is fine */ },
    { name: "Fix-A handlers",    state: cnr.ever_written > 0 ? "ok" : "fail" },
    { name: "Tariff resolution", state: l.last_24h === 0 || l.with_cost > 0 ? "ok" : "fail" },
    {
      name: "CDR sync",
      state: cdrR.last_24h > 0 ? "ok" : s.total === 0 ? "warn" : "fail",
      note: cdrR.last_24h === 0 && s.total === 0 ? "no sessions to import" : undefined,
    },
    { name: "No live pending",   state: p.live === 0 ? "ok" : "warn" },
    { name: "No stuck sessions", state: st.n === 0 ? "ok" : "fail" },
    { name: "Data integrity",    state: integrityOk ? "ok" : "fail" },
  ];
  const sym = { ok: "✅", warn: "⚠️", fail: "🔴" } as const;
  for (const k of checks) {
    const noteStr = k.note ? `  (${k.note})` : "";
    console.log(`  ${sym[k.state]} ${k.name}${noteStr}`);
  }
  const fails = checks.filter((k) => k.state === "fail").length;
  const warns = checks.filter((k) => k.state === "warn").length;
  console.log("");
  if (fails === 0 && warns === 0) {
    console.log("  🟢 ALL CHECKS PASS");
  } else if (fails === 0) {
    console.log(`  🟡 ${warns} WARNING(S) — verify externally, not necessarily a failure`);
  } else {
    console.log(`  🔴 ${fails} FAILURE(S)${warns > 0 ? ` + ${warns} warning(s)` : ""}`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
