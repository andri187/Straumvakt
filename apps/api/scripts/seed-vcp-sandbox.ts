#!/usr/bin/env tsx
/**
 * Seed the Virtual Charger Sandbox under Straumvakt internal — used by
 * apps/api/scripts/virtual-cp.ts to drive end-to-end OCPP traffic into
 * staging without touching customer installations.
 *
 * What it builds:
 *
 *   Property "Virtual Sandbox" (Straumvakt org)
 *   └─ Site "Virtual Sandbox"      dso_tariff = Veitur AD1 (Straumvakt cat.)
 *      └─ Installation "VCP Lab"   retailer_tariff = N1 retailer (Straumvakt cat.)
 *      │                           enforce_authorize = false (mirrors Dalvegur)
 *      │                           installation_type = private
 *      └─ Circuit "Lab circuit 1"  32 A, 3-phase
 *         └─ SiteAsset "vcp-001"   kind=charger
 *            └─ ChargingStation    vendor=Zaptec, model=VCP-Sim,
 *                                  installation=VCP Lab, circuit=Lab circuit 1
 *               ├─ EVSE 1          22 kW, 3-phase
 *               │  └─ Connector 1  Type2, 22 kW
 *               └─ OcppIdentity    identity=vcp-001, ocpp_1_6, no-auth (NULL hash)
 *
 *   Plus N1 driver access (mirrors apps/api/scripts/seed-dalvegur-n1-access.ts):
 *   ├─ agreements.agreements              counterparty=N1 ehf, installation=VCP Lab
 *   ├─ agreements.driver_groups           "N1 Drivers" (owner=N1 ehf)
 *   ├─ agreements.driver_group_memberships  N1 Drivers User
 *   └─ identity.id_tokens                 STRMV-VCP-TEST-001 → N1 Drivers User,
 *                                          scope_installation_id = VCP Lab
 *
 * Idempotency: pre-flight aborts on any already-existing fingerprint
 * row (Property name, OcppIdentity identity_string, IdToken value).
 * After a partial failure, drop the partials manually before re-running.
 *
 * MUST be run while DATABASE_URL points at staging (root .env.local).
 *
 * Usage:
 *   cd apps/api
 *   npx tsx scripts/seed-vcp-sandbox.ts
 *
 * Test the result:
 *   npx tsx scripts/virtual-cp.ts \
 *     --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev \
 *     --identity=vcp-001 \
 *     --session
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

// ── Known constants (verified by grepping seed-dalvegur-* scripts) ──
const STRAUMVAKT_ORG = "fe7ed894-7ac4-48f6-9fdc-92b620fd10d1";
const N1_EHF_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const N1_DRIVERS_USER_ID = "91a2fae3-8fb0-467a-be99-d613e6d3fd78";

// ── Sandbox fingerprints — these names must NOT already exist ──
const PROPERTY_NAME = "Virtual Sandbox";
const SITE_NAME = "Virtual Sandbox";
const INSTALLATION_NAME = "VCP Lab";
const CIRCUIT_NAME = "Lab circuit 1";
const VCP_IDENTITY_STRING = "vcp-001";
const TEST_TAG_VALUE = "STRMV-VCP-TEST-001";

// Tariff lookup names — must already exist in Straumvakt's catalogue.
// Same names used in seed-dalvegur-n1-contract.ts so the catalogue is
// known to use these literal display_name values.
const VEITUR_AD1_NAME = "Veitur AD1";
const N1_RETAILER_NAME = "N1 N1_RAFMAGN-REPF-01";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Pre-flight checks (read-only) ===\n");

  // Orgs + user
  const sv = await c.query(
    `select id, display_name from tenancy.organizations where id=$1`,
    [STRAUMVAKT_ORG],
  );
  if (sv.rowCount !== 1) {
    abort(c, `Straumvakt org ${STRAUMVAKT_ORG} not found`);
  }
  console.log(`  ✓ Straumvakt org           : ${sv.rows[0].display_name}`);

  const n1 = await c.query(
    `select id, display_name from tenancy.organizations where id=$1`,
    [N1_EHF_ORG],
  );
  if (n1.rowCount !== 1) {
    abort(c, `N1 ehf org ${N1_EHF_ORG} not found`);
  }
  console.log(`  ✓ N1 ehf org               : ${n1.rows[0].display_name}`);

  const u = await c.query(
    `select id, display_name from identity.users where id=$1`,
    [N1_DRIVERS_USER_ID],
  );
  if (u.rowCount !== 1) {
    abort(c, `N1 Drivers User ${N1_DRIVERS_USER_ID} not found`);
  }
  console.log(`  ✓ N1 Drivers User          : ${u.rows[0].display_name}`);

  // Tariffs in Straumvakt's catalogue
  const dso = await c.query(
    `select id from billing.tariff_definitions
      where org_id=$1 and display_name=$2 and status='active'`,
    [STRAUMVAKT_ORG, VEITUR_AD1_NAME],
  );
  if (dso.rowCount !== 1) {
    abort(
      c,
      `Active '${VEITUR_AD1_NAME}' tariff not found in Straumvakt's catalogue. ` +
        `Run seed-straumvakt-tariff-catalog or insert it manually before re-running.`,
    );
  }
  const dsoTariffId = dso.rows[0].id;
  console.log(`  ✓ Veitur AD1 (Straumvakt)  : ${dsoTariffId}`);

  const repf = await c.query(
    `select id from billing.tariff_definitions
      where org_id=$1 and display_name=$2 and status='active'`,
    [STRAUMVAKT_ORG, N1_RETAILER_NAME],
  );
  if (repf.rowCount !== 1) {
    abort(
      c,
      `Active '${N1_RETAILER_NAME}' tariff not found in Straumvakt's catalogue. ` +
        `Insert it before re-running.`,
    );
  }
  const retailerTariffId = repf.rows[0].id;
  console.log(`  ✓ N1 retailer (Straumvakt) : ${retailerTariffId}`);

  // Idempotency aborts — any one of these existing means we're partway
  // through a previous run; the operator should clean up first.
  const propClash = await c.query(
    `select id from properties.properties where org_id=$1 and display_name=$2`,
    [STRAUMVAKT_ORG, PROPERTY_NAME],
  );
  if (propClash.rowCount && propClash.rowCount > 0) {
    abort(
      c,
      `Property '${PROPERTY_NAME}' already exists under Straumvakt ` +
        `(id=${propClash.rows[0].id}). Drop it (cascades) or pick a new name.`,
    );
  }
  const ocppClash = await c.query(
    `select id, charging_station_id from ocpp.ocpp_identities
      where org_id=$1 and identity_string=$2`,
    [STRAUMVAKT_ORG, VCP_IDENTITY_STRING],
  );
  if (ocppClash.rowCount && ocppClash.rowCount > 0) {
    abort(
      c,
      `OcppIdentity '${VCP_IDENTITY_STRING}' already exists under Straumvakt ` +
        `(id=${ocppClash.rows[0].id}).`,
    );
  }
  const tokenClash = await c.query(
    `select id, user_id from identity.id_tokens where value=$1`,
    [TEST_TAG_VALUE],
  );
  if (tokenClash.rowCount && tokenClash.rowCount > 0) {
    abort(
      c,
      `IdToken value '${TEST_TAG_VALUE}' already exists ` +
        `(id=${tokenClash.rows[0].id}, user_id=${tokenClash.rows[0].user_id}).`,
    );
  }

  console.log("\n  All pre-flight checks passed.\n");
  console.log("=== Beginning transaction ===\n");

  await c.query("BEGIN");
  try {
    // 1. Property
    const propertyId = randomUUID();
    await c.query(
      `insert into properties.properties
         (id, org_id, display_name, address, location_type,
          provisioning_status, external, created_at, updated_at)
       values ($1, $2, $3, '{}'::jsonb, 'sandbox',
               'provisioned', false, now(), now())`,
      [propertyId, STRAUMVAKT_ORG, PROPERTY_NAME],
    );
    console.log(`  ✓ Property created         : ${propertyId} (${PROPERTY_NAME})`);

    // 2. Site
    const siteId = randomUUID();
    await c.query(
      `insert into properties.sites
         (id, org_id, property_id, display_name, timezone,
          access_level, provisioning_status, external, site_type,
          dso_tariff_id, opening_hours, created_at, updated_at)
       values ($1, $2, $3, $4, 'Atlantic/Reykjavik',
               'private', 'provisioned', false, 'standard',
               $5, '{}'::jsonb, now(), now())`,
      [siteId, STRAUMVAKT_ORG, propertyId, SITE_NAME, dsoTariffId],
    );
    console.log(`  ✓ Site created             : ${siteId} (${SITE_NAME})`);

    // 3. Installation
    const installationId = randomUUID();
    await c.query(
      `insert into properties.installations
         (id, org_id, site_id, display_name, onboarding_status,
          metadata, retailer_tariff_id, enforce_authorize,
          installation_type, created_at, updated_at)
       values ($1, $2, $3, $4, 'active',
               '{}'::jsonb, $5, false,
               'private', now(), now())`,
      [installationId, STRAUMVAKT_ORG, siteId, INSTALLATION_NAME, retailerTariffId],
    );
    console.log(
      `  ✓ Installation created     : ${installationId} (${INSTALLATION_NAME})`,
    );

    // 4. Circuit
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
    console.log(`  ✓ Circuit created          : ${circuitId} (${CIRCUIT_NAME}, 32A, 3-phase)`);

    // 5. SiteAsset (kind=charger)
    const siteAssetId = randomUUID();
    await c.query(
      `insert into properties.site_assets
         (id, org_id, site_id, kind, display_name, status, metadata,
          created_at, updated_at)
       values ($1, $2, $3, 'charger', $4, 'active', '{}'::jsonb,
               now(), now())`,
      [siteAssetId, STRAUMVAKT_ORG, siteId, VCP_IDENTITY_STRING],
    );
    console.log(`  ✓ SiteAsset created        : ${siteAssetId} (${VCP_IDENTITY_STRING})`);

    // 6. ChargingStation (id == siteAssetId per the schema invariant)
    await c.query(
      `insert into assets.charging_stations
         (site_asset_id, org_id, installation_id, circuit_id,
          vendor, model, serial_number,
          pushed_auth_list_version, created_at, updated_at)
       values ($1, $2, $3, $4,
               'Zaptec', 'VCP-Sim', $5,
               0, now(), now())`,
      [siteAssetId, STRAUMVAKT_ORG, installationId, circuitId, VCP_IDENTITY_STRING.toUpperCase()],
    );
    console.log(`  ✓ ChargingStation created  : ${siteAssetId}`);

    // 7. EVSE
    const evseId = randomUUID();
    await c.query(
      `insert into assets.evses
         (id, org_id, charging_station_id, evse_index, max_power_kw,
          phase_count, status, created_at, updated_at)
       values ($1, $2, $3, 1, 22.00, 3, 'unknown', now(), now())`,
      [evseId, STRAUMVAKT_ORG, siteAssetId],
    );
    console.log(`  ✓ EVSE created             : ${evseId} (idx=1, 22 kW, 3-phase)`);

    // 8. Connector
    const connectorId = randomUUID();
    await c.query(
      `insert into assets.connectors
         (id, org_id, evse_id, connector_index, type, max_power_kw,
          status, created_at, updated_at)
       values ($1, $2, $3, 1, 'Type2', 22.00, 'unknown', now(), now())`,
      [connectorId, STRAUMVAKT_ORG, evseId],
    );
    console.log(`  ✓ Connector created        : ${connectorId} (Type2, 22 kW)`);

    // 9. OcppIdentity (no-auth — auth_secret_hash NULL)
    const ocppIdentityId = randomUUID();
    await c.query(
      `insert into ocpp.ocpp_identities
         (id, org_id, charging_station_id, identity_string,
          auth_secret_hash, ocpp_version, asset_class, vendor,
          status, created_at, updated_at)
       values ($1, $2, $3, $4,
               NULL, 'ocpp_1_6', 'ac', 'Zaptec',
               'provisioned', now(), now())`,
      [ocppIdentityId, STRAUMVAKT_ORG, siteAssetId, VCP_IDENTITY_STRING],
    );
    console.log(
      `  ✓ OcppIdentity created     : ${ocppIdentityId} (identity=${VCP_IDENTITY_STRING}, no-auth)`,
    );

    // 10. Agreement (counterparty = N1 ehf, installation = VCP Lab)
    const agreementId = randomUUID();
    await c.query(
      `insert into agreements.agreements
         (id, agreement_type, counterparty_org_id, installation_id,
          display_name, status, effective_from, notes)
       values ($1, 'installation', $2, $3, $4,
               'active', now(),
               'VCP Lab — N1 driver test access. Default tag ${TEST_TAG_VALUE} routes plug-ins to N1 Drivers User for billing attribution. Sandbox install; not customer-facing.')`,
      [
        agreementId,
        N1_EHF_ORG,
        installationId,
        "VCP Lab — N1 driver access (sandbox)",
      ],
    );
    console.log(`  ✓ Agreement created        : ${agreementId}`);

    // 11. DriverGroup
    const driverGroupId = randomUUID();
    await c.query(
      `insert into agreements.driver_groups
         (id, agreement_id, owner_org_id, display_name)
       values ($1, $2, $3, 'N1 Drivers')`,
      [driverGroupId, agreementId, N1_EHF_ORG],
    );
    console.log(`  ✓ DriverGroup created      : ${driverGroupId}`);

    // 12. Membership
    const membershipId = randomUUID();
    await c.query(
      `insert into agreements.driver_group_memberships
         (id, driver_group_id, user_id)
       values ($1, $2, $3)`,
      [membershipId, driverGroupId, N1_DRIVERS_USER_ID],
    );
    console.log(`  ✓ Membership created       : ${membershipId}`);

    // 13. IdToken (test tag scoped to VCP Lab)
    const tokenId = randomUUID();
    await c.query(
      `insert into identity.id_tokens
         (id, user_id, kind, value, vendor_issued_by, label,
          status, scope_installation_id)
       values ($1, $2, 'manual', $3, NULL,
               'VCP Lab default tag (sandbox — operator-set)',
               'active', $4)`,
      [tokenId, N1_DRIVERS_USER_ID, TEST_TAG_VALUE, installationId],
    );
    console.log(`  ✓ IdToken created          : ${tokenId} (value=${TEST_TAG_VALUE})`);

    await c.query("COMMIT");
    console.log("\n✅ COMMIT — VCP sandbox provisioned.\n");
    console.log("Summary:");
    console.log(`  Property        : ${propertyId}`);
    console.log(`  Site            : ${siteId}`);
    console.log(`  Installation    : ${installationId}  ${INSTALLATION_NAME}`);
    console.log(`  Circuit         : ${circuitId}  ${CIRCUIT_NAME} (32A, 3-phase)`);
    console.log(`  ChargingStation : ${siteAssetId}     vendor=Zaptec model=VCP-Sim`);
    console.log(`  EVSE            : ${evseId}`);
    console.log(`  Connector       : ${connectorId}      Type2 22 kW`);
    console.log(`  OcppIdentity    : ${ocppIdentityId}  identity=${VCP_IDENTITY_STRING}, no-auth`);
    console.log(`  Agreement       : ${agreementId}`);
    console.log(`  DriverGroup     : ${driverGroupId}`);
    console.log(`  Membership      : ${membershipId}`);
    console.log(`  IdToken         : ${tokenId}            value=${TEST_TAG_VALUE}`);
    console.log("\nDrive traffic with:");
    console.log(`  cd apps/api`);
    console.log(`  npx tsx scripts/virtual-cp.ts \\`);
    console.log(`    --gateway=wss://straumvakt-ocpp-staging.straumvakt.workers.dev \\`);
    console.log(`    --identity=${VCP_IDENTITY_STRING} \\`);
    console.log(`    --session`);
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
