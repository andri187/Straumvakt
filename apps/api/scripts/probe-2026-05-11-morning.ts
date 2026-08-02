#!/usr/bin/env tsx
/**
 * Read-only morning health-check — flowing-as-expected audit.
 * Window: 2026-05-11 07:00:00 UTC → now.
 *
 * Run from apps/api dir; DATABASE_URL must resolve to staging (the
 * root .env.local — local_env_is_staging memory).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const SINCE = "2026-05-11 07:00:00+00";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`=== Morning health check  (since ${SINCE})  ===\n`);

  // ── 1. CHARGE SESSION ACTIVITY ───────────────────────────────────
  console.log("── 1. ChargeSession activity ────────────────────────────");
  const sessAll = await c.query(
    `select count(*)::int total,
            count(*) filter (where status='in_progress')::int in_prog,
            count(*) filter (where status='completed')::int completed,
            count(*) filter (where status='aborted')::int aborted,
            min(started_at) earliest,
            max(coalesce(ended_at, started_at)) latest
       from charging.sessions
      where started_at >= $1::timestamptz or ended_at >= $1::timestamptz`,
    [SINCE],
  );
  const r = sessAll.rows[0];
  console.log(`  total since 07:00:    ${r.total}`);
  console.log(`    in_progress:        ${r.in_prog}`);
  console.log(`    completed:          ${r.completed}`);
  console.log(`    aborted:            ${r.aborted}`);
  console.log(`  earliest start:       ${r.earliest?.toISOString?.() ?? "(none)"}`);
  console.log(`  latest activity:      ${r.latest?.toISOString?.() ?? "(none)"}`);

  // Per-installation breakdown
  const perInst = await c.query(
    `select
        coalesce(i.display_name, '(no installation)') as installation,
        count(*)::int total,
        count(*) filter (where s.status='in_progress')::int in_prog
       from charging.sessions s
       join assets.charging_stations cs on cs.site_asset_id = s.charging_station_id
       left join properties.installations i on i.id = cs.installation_id
      where s.started_at >= $1::timestamptz or s.ended_at >= $1::timestamptz
      group by i.display_name
      order by total desc`,
    [SINCE],
  );
  console.log("\n  By installation:");
  if (perInst.rowCount === 0) console.log("    (none)");
  for (const row of perInst.rows) {
    console.log(`    ${row.installation.padEnd(35)}  total=${row.total}  in_progress=${row.in_prog}`);
  }

  // ── 2. CONNECTOR STATUS WRITES ───────────────────────────────────
  console.log("\n── 2. Connector status updates ──────────────────────────");
  const connWrites = await c.query(
    `select status, count(*)::int n, max(status_updated_at) latest
       from assets.connectors
      where status_updated_at >= $1::timestamptz
      group by status
      order by n desc`,
    [SINCE],
  );
  console.log("  Connector.status writes since 07:00:");
  if (connWrites.rowCount === 0) {
    console.log("    (NONE — projection may not be firing per-connector)");
  } else {
    for (const row of connWrites.rows) {
      console.log(`    ${row.status.padEnd(15)} n=${row.n}  latest=${row.latest?.toISOString?.() ?? "—"}`);
    }
  }

  // ── 3. OCPP IDENTITY HEARTBEATS ──────────────────────────────────
  console.log("\n── 3. OcppIdentity heartbeats ───────────────────────────");
  const hb = await c.query(
    `select count(*) filter (where last_seen_at >= now() - interval '5 minutes')::int live_5m,
            count(*) filter (where last_seen_at >= $1::timestamptz)::int seen_today,
            count(*)::int total
       from ocpp.ocpp_identities
      where status <> 'decommissioned'`,
    [SINCE],
  );
  const hb0 = hb.rows[0];
  console.log(`  identities total (active): ${hb0.total}`);
  console.log(`  seen at all since 07:00:   ${hb0.seen_today}`);
  console.log(`  live now (<=5min):         ${hb0.live_5m}`);

  // ── 4. DALVEGUR DEEP-DIVE ────────────────────────────────────────
  console.log("\n── 4. Dalvegur installation deep-dive ───────────────────");
  const dalv = await c.query(
    `with chargers as (
       select sa.id as station_id,
              sa.display_name as charger_name,
              cs.installation_id,
              oi.id as ocpp_identity_id,
              oi.identity_string,
              oi.status as identity_status,
              oi.last_seen_at as identity_last_seen
         from properties.installations i
         join assets.charging_stations cs on cs.installation_id = i.id
         join properties.site_assets sa on sa.id = cs.site_asset_id
         left join ocpp.ocpp_identities oi on oi.charging_station_id = cs.site_asset_id
        where i.display_name ilike 'Dalvegur%'
     )
     select ch.charger_name,
            ch.identity_string,
            ch.identity_status,
            ch.identity_last_seen,
            cn.connector_index,
            cn.status as connector_status,
            cn.status_updated_at as connector_updated_at,
            cn.error_code
       from chargers ch
       left join assets.evses ev on ev.charging_station_id = ch.station_id
       left join assets.connectors cn on cn.evse_id = ev.id
      order by ch.charger_name, cn.connector_index`,
  );
  if (dalv.rowCount === 0) {
    console.log("  (no Dalvegur chargers found)");
  } else {
    console.log("  charger / identity_string / identity_status / connector_status / connector_updated_at");
    for (const row of dalv.rows) {
      const idAge = row.identity_last_seen
        ? `${Math.round((Date.now() - new Date(row.identity_last_seen).getTime()) / 60000)}m`
        : "—";
      const cnUpd = row.connector_updated_at
        ? row.connector_updated_at.toISOString().substr(11, 8) + "Z"
        : "—";
      const cn = `c${row.connector_index ?? "?"}=${row.connector_status ?? "—"}`;
      console.log(
        `    ${(row.charger_name ?? "—").padEnd(20)}  id=${row.identity_status ?? "—".padEnd(12)} (${idAge} ago)  ${cn.padEnd(20)}  ${cnUpd}`,
      );
    }
  }

  // Dalvegur sessions today
  const dalvSess = await c.query(
    `select s.started_at, s.ended_at, s.status, s.id_tag,
            s.energy_wh, sa.display_name as charger
       from charging.sessions s
       join assets.charging_stations cs on cs.site_asset_id = s.charging_station_id
       join properties.installations i on i.id = cs.installation_id
       join properties.site_assets sa on sa.id = s.charging_station_id
      where i.display_name ilike 'Dalvegur%'
        and (s.started_at >= $1::timestamptz or s.ended_at >= $1::timestamptz)
      order by s.started_at desc
      limit 20`,
    [SINCE],
  );
  console.log(`\n  Dalvegur sessions today (max 20): ${dalvSess.rowCount}`);
  for (const s of dalvSess.rows) {
    const dur = s.ended_at
      ? `${Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)}m`
      : "ongoing";
    const wh = s.energy_wh ? `${Number(s.energy_wh)} Wh` : "—";
    console.log(
      `    ${s.charger.padEnd(20)}  ${s.started_at.toISOString().substr(11, 8)}Z  ${s.status.padEnd(11)}  ${dur.padEnd(8)}  ${wh}  tag=${s.id_tag ?? "—"}`,
    );
  }

  // ── 5. PENDING DISCOVERIES ───────────────────────────────────────
  console.log("\n── 5. Pending discoveries since 07:00 ───────────────────");
  const pend = await c.query(
    `select identity_string, first_seen_at, last_seen_at, attempt_count, remote_addr
       from ocpp.pending_discoveries
      where last_seen_at >= $1::timestamptz
      order by last_seen_at desc`,
    [SINCE],
  );
  if (pend.rowCount === 0) {
    console.log("  (none new)");
  } else {
    for (const p of pend.rows) {
      console.log(
        `  ${p.identity_string.padEnd(30)}  first=${p.first_seen_at.toISOString().substr(11, 8)}Z  attempts=${p.attempt_count}  addr=${p.remote_addr ?? "—"}`,
      );
    }
  }

  // ── 6. STALE in_progress sessions ────────────────────────────────
  console.log("\n── 6. Stale in_progress sessions (no movement >2h) ──────");
  const stale = await c.query(
    `select s.id, s.started_at, s.id_tag,
            sa.display_name as charger,
            coalesce(i.display_name, '(no installation)') as installation
       from charging.sessions s
       join assets.charging_stations cs on cs.site_asset_id = s.charging_station_id
       left join properties.installations i on i.id = cs.installation_id
       join properties.site_assets sa on sa.id = s.charging_station_id
      where s.status = 'in_progress'
        and s.started_at < now() - interval '2 hours'
      order by s.started_at asc
      limit 10`,
  );
  if (stale.rowCount === 0) {
    console.log("  (none)");
  } else {
    for (const s of stale.rows) {
      const age = Math.round(
        (Date.now() - new Date(s.started_at).getTime()) / 3_600_000,
      );
      console.log(
        `  ${s.charger.padEnd(20)}  ${s.installation.padEnd(20)}  age=${age}h  tag=${s.id_tag ?? "—"}`,
      );
    }
  }

  // ── 7. AMQP / live samples freshness ─────────────────────────────
  console.log("\n── 7. AMQP feed freshness ───────────────────────────────");
  const live = await c.query(
    `select count(*)::int total_today,
            count(*) filter (where observed_at >= now() - interval '5 minutes')::int last_5m,
            max(observed_at) latest
       from charging.live_session_samples
      where observed_at >= $1::timestamptz`,
    [SINCE],
  );
  const l = live.rows[0];
  console.log(`  live_session_samples today: ${l.total_today}`);
  console.log(`  last 5 min:                 ${l.last_5m}`);
  console.log(`  latest sample:              ${l.latest?.toISOString?.() ?? "(none)"}`);

  // ── 8. VCP sandbox sanity ────────────────────────────────────────
  console.log("\n── 8. VCP sandbox sanity ────────────────────────────────");
  const vcp = await c.query(
    `select oi.identity_string, oi.status, oi.last_seen_at,
            cn.status as connector_status, cn.status_updated_at as cn_updated
       from ocpp.ocpp_identities oi
       join assets.evses ev on ev.charging_station_id = oi.charging_station_id
       join assets.connectors cn on cn.evse_id = ev.id
      where oi.identity_string = 'vcp-001'`,
  );
  for (const v of vcp.rows) {
    console.log(`  vcp-001  identity_status=${v.status}  last_seen=${v.last_seen_at?.toISOString?.() ?? "(never)"}`);
    console.log(`           connector_status=${v.connector_status}  cn_updated=${v.cn_updated?.toISOString?.() ?? "(never)"}`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
