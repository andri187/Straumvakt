#!/usr/bin/env tsx
/**
 * Recent-session probe — local diagnostic. Hits the staging Neon DB
 * (root .env.local DATABASE_URL points at staging) via raw pg and
 * prints the latest activity across the three tables that matter
 * for Sprint 8.7 + 8.9 verification:
 *
 *   • charging.imported_cdr_refs     — vendor-imported CDR pointers
 *   • charging.sessions              — synthetic + real ChargeSessions
 *   • reports.session_ledger         — computed-cost ledger rows
 *
 * Pass --since=ISO to restrict to a window (defaults to last 4h).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env.local");
  process.exit(1);
}

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const since = sinceArg
  ? new Date(sinceArg.split("=", 2)[1]!)
  : new Date(Date.now() - 4 * 60 * 60 * 1000);

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  console.log(`Checking activity since ${since.toISOString()}\n`);

  const refs = await client.query(
    `select source_kind, source_cdr_id, session_id, org_id, imported_at
     from charging.imported_cdr_refs
     where imported_at >= $1
     order by imported_at desc
     limit 20`,
    [since],
  );
  console.log(`[ImportedCdrRef] ${refs.rowCount} row(s):`);
  for (const r of refs.rows) {
    console.log(
      `  ${r.imported_at.toISOString()}  ${r.source_kind}/${r.source_cdr_id} → ${String(r.session_id).slice(0, 8)}…`,
    );
  }

  const sessions = await client.query(
    `select id, org_id, charging_station_id, id_tag, started_at, ended_at,
            energy_wh, stop_reason, status
     from charging.sessions
     where started_at >= $1
     order by started_at desc
     limit 20`,
    [since],
  );
  console.log(`\n[ChargeSession] ${sessions.rowCount} row(s):`);
  for (const s of sessions.rows) {
    const kwh = s.energy_wh !== null ? Number(s.energy_wh) / 1000 : null;
    console.log(
      `  ${s.started_at.toISOString()}  station=${String(s.charging_station_id).slice(0, 8)}…  status=${s.status}  energy=${kwh?.toFixed(3) ?? "—"} kWh  reason=${s.stop_reason ?? "—"}  id=${String(s.id).slice(0, 8)}…`,
    );
  }

  const ledger = await client.query(
    `select session_id, org_id, site_id, charging_station_id, driver_id_tag,
            energy_kwh, cost_isk_minor, computed_at
     from reports.session_ledger
     where computed_at >= $1
     order by computed_at desc
     limit 20`,
    [since],
  );
  console.log(`\n[session_ledger] ${ledger.rowCount} row(s):`);
  for (const l of ledger.rows) {
    const kr =
      l.cost_isk_minor !== null
        ? (Number(l.cost_isk_minor) / 100).toFixed(2)
        : "—";
    console.log(
      `  ${l.computed_at.toISOString()}  ${Number(l.energy_kwh).toFixed(3)} kWh  ${kr} kr  driver=${l.driver_id_tag ?? "(anon)"}  session=${String(l.session_id).slice(0, 8)}…`,
    );
  }

  // OcppIdentity status as a side benefit — shows what 8.8 wrote.
  const idents = await client.query(
    `select identity_string, vendor_resource_id, status, last_seen_at
     from ocpp.ocpp_identities
     where vendor = 'Zaptec'
     order by last_seen_at desc nulls last
     limit 30`,
  );
  console.log(`\n[OcppIdentity Zaptec] ${idents.rowCount} row(s) (top by last_seen_at):`);
  for (const i of idents.rows) {
    console.log(
      `  ${i.last_seen_at?.toISOString() ?? "(never)"}  status=${i.status}  resourceId=${i.vendor_resource_id}  ident=${i.identity_string}`,
    );
  }

  console.log(
    `\nSummary: ${refs.rowCount} import refs · ${sessions.rowCount} sessions · ${ledger.rowCount} ledger rows in last 4h.`,
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
