#!/usr/bin/env tsx
/**
 * Amend the existing VCP sandbox by adding a Circuit and binding the
 * vcp-001 ChargingStation to it. Closes a gap in the original
 * seed-vcp-sandbox.ts (2026-05-10) which left circuit_id NULL — that
 * landed vcp-001 under "Unassigned circuit" in the /chargers grouped
 * list view.
 *
 * Idempotent: aborts if a Circuit already exists for the VCP Lab site.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/amend-vcp-circuit.ts
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Resolved by display_name lookup so the script keeps working even if
// the row IDs differ from a fresh seed run.
const STRAUMVAKT_ORG = "fe7ed894-7ac4-48f6-9fdc-92b620fd10d1";
const SITE_NAME = "Virtual Sandbox";
const INSTALLATION_NAME = "VCP Lab";
const CIRCUIT_NAME = "Lab circuit 1";
const VCP_IDENTITY = "vcp-001";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Pre-flight ===\n");

  const site = await c.query(
    `select id from properties.sites
      where org_id=$1 and display_name=$2`,
    [STRAUMVAKT_ORG, SITE_NAME],
  );
  if (site.rowCount !== 1) {
    abort(c, `Site '${SITE_NAME}' not found under Straumvakt — run seed-vcp-sandbox first`);
  }
  const siteId = site.rows[0].id;
  console.log(`  ✓ Site                    : ${siteId}`);

  const inst = await c.query(
    `select id from properties.installations
      where org_id=$1 and site_id=$2 and display_name=$3`,
    [STRAUMVAKT_ORG, siteId, INSTALLATION_NAME],
  );
  if (inst.rowCount !== 1) {
    abort(c, `Installation '${INSTALLATION_NAME}' not found under site ${siteId}`);
  }
  const installationId = inst.rows[0].id;
  console.log(`  ✓ Installation            : ${installationId}`);

  const station = await c.query(
    `select s.site_asset_id, s.circuit_id
       from assets.charging_stations s
       join ocpp.ocpp_identities o on o.charging_station_id = s.site_asset_id
      where s.org_id=$1 and o.identity_string=$2`,
    [STRAUMVAKT_ORG, VCP_IDENTITY],
  );
  if (station.rowCount !== 1) {
    abort(c, `ChargingStation for identity '${VCP_IDENTITY}' not found`);
  }
  const stationId = station.rows[0].site_asset_id as string;
  const existingCircuitId = station.rows[0].circuit_id as string | null;
  console.log(`  ✓ ChargingStation         : ${stationId}`);
  if (existingCircuitId) {
    abort(
      c,
      `ChargingStation already bound to circuit ${existingCircuitId} — nothing to amend`,
    );
  }

  const circuitClash = await c.query(
    `select id from properties.circuits
      where org_id=$1 and site_id=$2 and display_name=$3`,
    [STRAUMVAKT_ORG, siteId, CIRCUIT_NAME],
  );
  if (circuitClash.rowCount && circuitClash.rowCount > 0) {
    abort(
      c,
      `Circuit '${CIRCUIT_NAME}' already exists at site ${siteId} (id=${circuitClash.rows[0].id})`,
    );
  }

  console.log("\n  All pre-flight checks passed.\n");
  console.log("=== Beginning transaction ===\n");

  await c.query("BEGIN");
  try {
    const circuitId = randomUUID();
    await c.query(
      `insert into properties.circuits
         (id, org_id, site_id, installation_id, display_name,
          ampere_ceiling, phase_count, metadata,
          created_at, updated_at)
       values ($1, $2, $3, $4, $5,
               32, 3, '{}'::jsonb,
               now(), now())`,
      [circuitId, STRAUMVAKT_ORG, siteId, installationId, CIRCUIT_NAME],
    );
    console.log(`  ✓ Circuit created         : ${circuitId} (${CIRCUIT_NAME}, 32A, 3-phase)`);

    const upd = await c.query(
      `update assets.charging_stations
          set circuit_id=$1, updated_at=now()
        where site_asset_id=$2 and circuit_id is null
        returning site_asset_id`,
      [circuitId, stationId],
    );
    if (upd.rowCount !== 1) {
      throw new Error(
        `Expected to update 1 ChargingStation (id=${stationId}); got ${upd.rowCount}`,
      );
    }
    console.log(`  ✓ ChargingStation rebound : ${stationId} → circuit ${circuitId}`);

    await c.query("COMMIT");
    console.log("\n✅ COMMIT — VCP Lab circuit amended.");
    console.log(`\n  Circuit         : ${circuitId}  ${CIRCUIT_NAME}`);
    console.log(`  Bound station   : ${stationId}      identity=${VCP_IDENTITY}`);
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("\n❌ ROLLBACK — transaction failed, no rows committed.");
    console.error(err);
    process.exit(1);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function abort(c: Client, msg: string): Promise<never> {
  console.error(`ABORT: ${msg}`);
  await c.end();
  process.exit(1);
}
