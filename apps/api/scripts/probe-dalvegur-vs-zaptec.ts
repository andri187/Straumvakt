#!/usr/bin/env tsx
/**
 * Read-only — compare what we have in the DB for Dalvegur against
 * Zaptec Portal ground truth (operator-pasted snapshot 2026-05-12).
 *
 * Join key: ChargingStation.serial_number (uppercased) matched
 * against Zaptec deviceId.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

interface ZaptecRow {
  name: string;
  serial: string;
  zaptecStatus: string;
}

// Operator-pasted snapshot, 2026-05-12.
const ZAPTEC_TRUTH: ZaptecRow[] = [
  { name: "A1",       serial: "ZPR042645", zaptecStatus: "Car disconnected" },
  { name: "A2",       serial: "ZPR042727", zaptecStatus: "Car disconnected" },
  { name: "Klettas 1",serial: "ZCS029403", zaptecStatus: "Car disconnected" },
  { name: "Klettas 3",serial: "ZPR103043", zaptecStatus: "Car disconnected" },
  { name: "Klettas 5",serial: "ZCS029381", zaptecStatus: "Car disconnected" },
  { name: "K1",       serial: "ZPR042344", zaptecStatus: "Car disconnected" },
  { name: "K2",       serial: "ZPR042316", zaptecStatus: "Car disconnected" },
  { name: "K3",       serial: "ZPR042320", zaptecStatus: "Car disconnected" },
  { name: "K4",       serial: "ZPR148882", zaptecStatus: "Car disconnected" },
  { name: "N1 - 1",   serial: "ZCS029369", zaptecStatus: "Vehicle stopped charging" },
  { name: "N1 - 2",   serial: "ZPR042319", zaptecStatus: "Vehicle stopped charging" },
  { name: "N1 - 3",   serial: "ZPR042325", zaptecStatus: "Car disconnected" },
  { name: "N1 - 4",   serial: "ZPR042345", zaptecStatus: "Car disconnected" },
  { name: "Festi 2",  serial: "ZCS029401", zaptecStatus: "Car disconnected" },
  { name: "Festi 3",  serial: "ZPR149367", zaptecStatus: "Car disconnected" },
  { name: "Festi 4",  serial: "ZCS029397", zaptecStatus: "Car disconnected" },
  { name: "Festi 5",  serial: "ZCS032822", zaptecStatus: "Car disconnected" },
  { name: "Festi 6",  serial: "ZCS029392", zaptecStatus: "Car disconnected" },
  { name: "Festi 7",  serial: "ZCS029394", zaptecStatus: "Car disconnected" },
  { name: "Festi 8",  serial: "ZCS029398", zaptecStatus: "Car disconnected" },
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Dalvegur reconciliation  (Zaptec Portal vs DB) ===");
  console.log(`Zaptec ground truth: ${ZAPTEC_TRUTH.length} chargers\n`);

  const dbRows = await c.query(
    `select sa.id as site_asset_id,
            sa.display_name as db_name,
            cs.serial_number,
            cs.installation_id,
            oi.id as ocpp_identity_id,
            oi.identity_string,
            oi.status as identity_status,
            oi.last_seen_at,
            cn.id as connector_id,
            cn.connector_index,
            cn.status as connector_status,
            cn.status_updated_at as connector_updated_at
       from properties.installations i
       join assets.charging_stations cs on cs.installation_id = i.id
       join properties.site_assets sa on sa.id = cs.site_asset_id
       left join ocpp.ocpp_identities oi on oi.charging_station_id = cs.site_asset_id
       left join assets.evses ev on ev.charging_station_id = cs.site_asset_id
       left join assets.connectors cn on cn.evse_id = ev.id
      where i.display_name ilike 'Dalvegur%'
      order by sa.display_name`,
  );

  console.log(`DB rows for Dalvegur:  ${dbRows.rowCount}\n`);

  // Index DB by upper-cased serial for the join.
  const dbBySerial = new Map<string, (typeof dbRows.rows)[number]>();
  const dbWithoutSerial: (typeof dbRows.rows)[number][] = [];
  for (const r of dbRows.rows) {
    if (r.serial_number) {
      dbBySerial.set(String(r.serial_number).toUpperCase(), r);
    } else {
      dbWithoutSerial.push(r);
    }
  }

  // ── Section 1: matched chargers — does our state match Zaptec? ─────
  console.log("── 1. Matched chargers (by serial) ──────────────────────");
  console.log("  name             db_name              ocpp_id_status  conn_status   last_seen     conn_seen");
  const matched = new Set<string>();
  for (const zt of ZAPTEC_TRUTH) {
    const db = dbBySerial.get(zt.serial.toUpperCase());
    if (!db) continue;
    matched.add(zt.serial.toUpperCase());
    const ageMin = db.last_seen_at
      ? Math.round((Date.now() - new Date(db.last_seen_at).getTime()) / 60000)
      : null;
    const cnAge = db.connector_updated_at
      ? Math.round((Date.now() - new Date(db.connector_updated_at).getTime()) / 60000)
      : null;
    console.log(
      `  ${zt.name.padEnd(16)} ${(db.db_name ?? "—").padEnd(20)} ${(db.identity_status ?? "—").padEnd(15)} ${(db.connector_status ?? "—").padEnd(13)} ${ageMin != null ? ageMin + "m" : "never"}        ${cnAge != null ? cnAge + "m" : "never"}`,
    );
  }

  // ── Section 2: chargers in Zaptec but NOT in our DB ─────────────────
  console.log("\n── 2. In Zaptec but missing from DB ─────────────────────");
  const missing = ZAPTEC_TRUTH.filter(
    (z) => !dbBySerial.has(z.serial.toUpperCase()),
  );
  if (missing.length === 0) {
    console.log("  (none — every Zaptec charger has a DB row)");
  } else {
    for (const z of missing) {
      console.log(`  ✗ ${z.name.padEnd(16)} serial=${z.serial}`);
    }
  }

  // ── Section 3: chargers in DB but NOT in Zaptec (= ghosts) ──────────
  console.log("\n── 3. In DB but NOT in Zaptec (ghost rows) ──────────────");
  const ghosts: (typeof dbRows.rows)[number][] = [];
  for (const [serial, row] of dbBySerial.entries()) {
    if (!matched.has(serial)) ghosts.push(row);
  }
  if (ghosts.length === 0 && dbWithoutSerial.length === 0) {
    console.log("  (none)");
  } else {
    for (const g of ghosts) {
      console.log(
        `  ✗ ${(g.db_name ?? "—").padEnd(28)} serial=${g.serial_number ?? "—"} identity_status=${g.identity_status ?? "—"}`,
      );
    }
    for (const g of dbWithoutSerial) {
      console.log(
        `  ✗ ${(g.db_name ?? "—").padEnd(28)} serial=NULL identity_status=${g.identity_status ?? "—"}  (orphan — never imported)`,
      );
    }
  }

  // ── Section 4: heartbeat freshness ──────────────────────────────────
  console.log("\n── 4. Heartbeat / last_seen freshness (matched only) ────");
  const ages: number[] = [];
  for (const zt of ZAPTEC_TRUTH) {
    const db = dbBySerial.get(zt.serial.toUpperCase());
    if (!db?.last_seen_at) continue;
    ages.push(
      Math.round((Date.now() - new Date(db.last_seen_at).getTime()) / 60000),
    );
  }
  ages.sort((a, b) => a - b);
  console.log(`  matched chargers seen recently: ${ages.length}`);
  if (ages.length > 0) {
    console.log(`  min age (freshest): ${ages[0]} min`);
    console.log(`  median age:         ${ages[Math.floor(ages.length / 2)]} min`);
    console.log(`  max age (stalest):  ${ages[ages.length - 1]} min`);
    const fresh = ages.filter((a) => a < 5).length;
    console.log(`  fresh (<5min):      ${fresh} / ${ages.length}`);
  }

  // ── Section 5: connector status coverage ────────────────────────────
  console.log("\n── 5. Per-connector status coverage (matched only) ──────");
  let cnFresh = 0;
  let cnEverWritten = 0;
  let cnNeverWritten = 0;
  for (const zt of ZAPTEC_TRUTH) {
    const db = dbBySerial.get(zt.serial.toUpperCase());
    if (!db) continue;
    if (db.connector_updated_at) {
      cnEverWritten++;
      const ageMin = Math.round(
        (Date.now() - new Date(db.connector_updated_at).getTime()) / 60000,
      );
      if (ageMin < 5) cnFresh++;
    } else {
      cnNeverWritten++;
    }
  }
  console.log(`  connector_status ever written : ${cnEverWritten} / ${ZAPTEC_TRUTH.length}`);
  console.log(`  connector_status fresh (<5min): ${cnFresh} / ${ZAPTEC_TRUTH.length}`);
  console.log(`  connector_status NEVER written: ${cnNeverWritten} / ${ZAPTEC_TRUTH.length}`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
