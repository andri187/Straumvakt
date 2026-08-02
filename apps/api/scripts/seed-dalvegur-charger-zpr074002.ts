#!/usr/bin/env tsx
/**
 * One-off — provision zpr074002 under Reykjavík HQ with no-auth.
 *
 * Context:
 *   - Operator created a new Site "Reykjavík HQ" under N1 ehf earlier
 *     tonight; it has no Installation yet
 *   - Operator tried to claim zpr074002 via the operator console.
 *     The claim flow generated a Basic-Auth password; physical charger
 *     is on the no-auth path. Result: 403 from gateway. See the
 *     pickup note for the operator-console UX issues this exposed.
 *
 * What this script does, idempotently:
 *   1. Verify Reykjavík HQ site exists under N1 ehf
 *   2. Create Installation "Reykjavík HQ" (enforce_authorize=false) if
 *      one doesn't exist under that site
 *   3. Create ChargingStation + EVSE + Connector + OcppIdentity for
 *      zpr074002 with authSecretHash=NULL
 *   4. Drop the pending_discoveries row
 *
 * Aborts if an OcppIdentity for zpr074002 already exists.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_EHF_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const SITE_NAME = "Reykjavík HQ";

const IDENTITY = "zpr074002";
const DISPLAY_NAME = "ZPR074002"; // operator can rename later

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Pre-flight ===\n");

  // Idempotency
  const existing = await c.query(
    `select id from ocpp.ocpp_identities where lower(identity_string) = lower($1)`,
    [IDENTITY],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    console.error(
      `ABORT: OcppIdentity for ${IDENTITY} already exists (id=${existing.rows[0].id}).`,
    );
    await c.end();
    process.exit(1);
  }

  // Look up Reykjavík HQ site
  const siteRow = await c.query(
    `select id from properties.sites
      where org_id = $1 and display_name = $2`,
    [N1_EHF_ORG, SITE_NAME],
  );
  if (siteRow.rowCount !== 1) {
    console.error(
      `ABORT: Could not find unique site '${SITE_NAME}' under N1 ehf (found ${siteRow.rowCount} rows). Confirm operator created it.`,
    );
    await c.end();
    process.exit(1);
  }
  const siteId = siteRow.rows[0].id;
  console.log(`  ✓ Site '${SITE_NAME}':       ${siteId}`);

  // Find or create Installation under the site
  let installationId: string;
  const existingInst = await c.query(
    `select id, enforce_authorize from properties.installations
      where org_id = $1 and site_id = $2
      order by created_at asc
      limit 1`,
    [N1_EHF_ORG, siteId],
  );
  let createdInstallation = false;
  if (existingInst.rowCount && existingInst.rowCount > 0) {
    installationId = existingInst.rows[0].id;
    console.log(`  ✓ Reusing Installation:    ${installationId} (enforce_authorize=${existingInst.rows[0].enforce_authorize})`);
  } else {
    installationId = randomUUID();
    createdInstallation = true;
    console.log(`  ? No Installation under site — will create one in tx`);
  }

  console.log("\n=== Beginning transaction ===\n");

  await c.query("BEGIN");
  try {
    if (createdInstallation) {
      await c.query(
        `insert into properties.installations
           (id, org_id, site_id, display_name, onboarding_status,
            metadata, enforce_authorize, installation_type,
            created_at, updated_at)
         values ($1, $2, $3, $4, 'active',
                 '{}'::jsonb, false, 'workplace',
                 now(), now())`,
        [installationId, N1_EHF_ORG, siteId, SITE_NAME],
      );
      console.log(`  ✓ Installation created:   ${installationId}  (enforce_authorize=false)`);
    }

    const siteAssetId = randomUUID();
    await c.query(
      `insert into properties.site_assets
         (id, org_id, site_id, kind, display_name, status, metadata, created_at, updated_at)
       values ($1, $2, $3, 'charger', $4, 'active', '{}'::jsonb, now(), now())`,
      [siteAssetId, N1_EHF_ORG, siteId, DISPLAY_NAME],
    );
    console.log(`  ✓ SiteAsset:              ${siteAssetId} (${DISPLAY_NAME})`);

    await c.query(
      `insert into assets.charging_stations
         (site_asset_id, org_id, installation_id, vendor, model, serial_number,
          pushed_auth_list_version, created_at, updated_at)
       values ($1, $2, $3, 'Zaptec', 'Pro', $4, 0, now(), now())`,
      [siteAssetId, N1_EHF_ORG, installationId, DISPLAY_NAME],
    );
    console.log(`  ✓ ChargingStation:        ${siteAssetId}  vendor=Zaptec model=Pro`);

    const evseId = randomUUID();
    await c.query(
      `insert into assets.evses
         (id, org_id, charging_station_id, evse_index, max_power_kw, phase_count,
          status, created_at, updated_at)
       values ($1, $2, $3, 1, 22.00, 3, 'unknown', now(), now())`,
      [evseId, N1_EHF_ORG, siteAssetId],
    );
    console.log(`  ✓ EVSE:                   ${evseId}`);

    const connectorId = randomUUID();
    await c.query(
      `insert into assets.connectors
         (id, org_id, evse_id, connector_index, type, max_power_kw, status,
          created_at, updated_at)
       values ($1, $2, $3, 1, 'Type2', 22.00, 'unknown', now(), now())`,
      [connectorId, N1_EHF_ORG, evseId],
    );
    console.log(`  ✓ Connector:              ${connectorId} (Type2, 22 kW)`);

    const identityId = randomUUID();
    await c.query(
      `insert into ocpp.ocpp_identities
         (id, org_id, charging_station_id, identity_string,
          auth_secret_hash, ocpp_version, asset_class, vendor,
          status, created_at, updated_at)
       values ($1, $2, $3, $4,
               NULL, 'ocpp_1_6', 'ac', 'Zaptec',
               'provisioned', now(), now())`,
      [identityId, N1_EHF_ORG, siteAssetId, IDENTITY],
    );
    console.log(`  ✓ OcppIdentity:           ${identityId}  identity=${IDENTITY}  no-auth`);

    const pdRow = await c.query(
      `delete from ocpp.pending_discoveries
        where lower(identity_string) = lower($1)
       returning identity_string, attempt_count`,
      [IDENTITY],
    );
    if (pdRow.rowCount && pdRow.rowCount > 0) {
      console.log(`  ✓ PendingDiscovery dropped: ${pdRow.rows[0].identity_string} (was ${pdRow.rows[0].attempt_count} attempts)`);
    } else {
      console.log(`  · No pending_discoveries row to clear`);
    }

    await c.query("COMMIT");
    console.log("\n✅ COMMIT — zpr074002 provisioned under Reykjavík HQ, no-auth path.");
    console.log("\nNext OCPP retry from the charger should succeed (101 not 403).");
    console.log("Verify by:");
    console.log("  1. Watch /chargers — ZPR074002 should appear online within ~30s");
    console.log("  2. wrangler tail straumvakt-ocpp-staging  → look for an Accept (101) for zpr074002");
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("\n❌ ROLLBACK — error:", err);
    process.exit(1);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
