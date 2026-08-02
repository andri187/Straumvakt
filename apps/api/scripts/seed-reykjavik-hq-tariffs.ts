#!/usr/bin/env tsx
/**
 * Wire tariff anchors on Reykjavík HQ — closes the gap found by the
 * tariff probe. Without these, any session ending at Reykjavík HQ
 * (zpr074002 eventually) would hit `dso_tariff_unconfigured` or
 * `retailer_tariff_unconfigured` in the tariff resolver and the
 * StopTransaction projection would roll back → DLQ.
 *
 * What this script does, in one transaction:
 *   1. Pre-flight: verify Reykjavík HQ site + installation exist
 *      under N1 ehf, and N1 ehf has the two required tariff definitions
 *      (Veitur AD1 + N1 retailer)
 *   2. UPDATE Site.dso_tariff_id        = Veitur AD1 (under N1 ehf)
 *   3. UPDATE Installation.retailer_tariff_id = N1 retailer (under N1 ehf)
 *
 * Idempotent — aborts if either anchor is already set to the correct
 * tariff. If it's set to a DIFFERENT tariff, the script aborts loudly
 * so the operator can review.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_EHF_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const SITE_NAME = "Reykjavík HQ";
const INSTALLATION_NAME = "Reykjavík HQ";
const DSO_TARIFF_NAME = "Veitur AD1";
const RETAILER_TARIFF_NAME = "N1 N1_RAFMAGN-REPF-01";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Pre-flight ===\n");

  // Site
  const siteRow = await c.query(
    `select id, dso_tariff_id from properties.sites
      where org_id = $1 and display_name = $2`,
    [N1_EHF_ORG, SITE_NAME],
  );
  if (siteRow.rowCount !== 1) {
    console.error(`ABORT: Site '${SITE_NAME}' not found under N1 ehf (found ${siteRow.rowCount})`);
    await c.end();
    process.exit(1);
  }
  const siteId = siteRow.rows[0].id;
  const currentDsoId = siteRow.rows[0].dso_tariff_id;
  console.log(`  ✓ Site '${SITE_NAME}': ${siteId}`);
  console.log(`    current dso_tariff_id: ${currentDsoId ?? "(none)"}`);

  // Installation
  const instRow = await c.query(
    `select id, retailer_tariff_id from properties.installations
      where org_id = $1 and site_id = $2 and display_name = $3`,
    [N1_EHF_ORG, siteId, INSTALLATION_NAME],
  );
  if (instRow.rowCount !== 1) {
    console.error(`ABORT: Installation '${INSTALLATION_NAME}' not found under site (found ${instRow.rowCount})`);
    await c.end();
    process.exit(1);
  }
  const installationId = instRow.rows[0].id;
  const currentRetailerId = instRow.rows[0].retailer_tariff_id;
  console.log(`  ✓ Installation: ${installationId}`);
  console.log(`    current retailer_tariff_id: ${currentRetailerId ?? "(none)"}`);

  // DSO tariff
  const dsoRow = await c.query(
    `select id from billing.tariff_definitions
      where org_id = $1 and display_name = $2 and status = 'active'`,
    [N1_EHF_ORG, DSO_TARIFF_NAME],
  );
  if (dsoRow.rowCount !== 1) {
    console.error(`ABORT: Active '${DSO_TARIFF_NAME}' tariff not found under N1 ehf (found ${dsoRow.rowCount})`);
    await c.end();
    process.exit(1);
  }
  const dsoTariffId = dsoRow.rows[0].id;
  console.log(`  ✓ DSO tariff '${DSO_TARIFF_NAME}': ${dsoTariffId}`);

  // Retailer tariff
  const repfRow = await c.query(
    `select id from billing.tariff_definitions
      where org_id = $1 and display_name = $2 and status = 'active'`,
    [N1_EHF_ORG, RETAILER_TARIFF_NAME],
  );
  if (repfRow.rowCount !== 1) {
    console.error(`ABORT: Active '${RETAILER_TARIFF_NAME}' tariff not found under N1 ehf (found ${repfRow.rowCount})`);
    await c.end();
    process.exit(1);
  }
  const retailerTariffId = repfRow.rows[0].id;
  console.log(`  ✓ Retailer tariff '${RETAILER_TARIFF_NAME}': ${retailerTariffId}`);

  // Conflict checks: if anchors already set to something OTHER than what we want, abort loudly
  if (currentDsoId !== null && currentDsoId !== dsoTariffId) {
    console.error(`ABORT: Site already has a DIFFERENT dso_tariff_id (${currentDsoId} ≠ ${dsoTariffId}). Manual review needed.`);
    await c.end();
    process.exit(1);
  }
  if (currentRetailerId !== null && currentRetailerId !== retailerTariffId) {
    console.error(`ABORT: Installation already has a DIFFERENT retailer_tariff_id (${currentRetailerId} ≠ ${retailerTariffId}). Manual review needed.`);
    await c.end();
    process.exit(1);
  }

  if (currentDsoId === dsoTariffId && currentRetailerId === retailerTariffId) {
    console.log("\n✓ Anchors already correctly set. Nothing to do.");
    await c.end();
    return;
  }

  console.log("\n=== Beginning transaction ===\n");

  await c.query("BEGIN");
  try {
    if (currentDsoId !== dsoTariffId) {
      await c.query(
        `update properties.sites
            set dso_tariff_id = $1, updated_at = now()
          where id = $2`,
        [dsoTariffId, siteId],
      );
      console.log(`  ✓ Site.dso_tariff_id wired         → Veitur AD1`);
    }
    if (currentRetailerId !== retailerTariffId) {
      await c.query(
        `update properties.installations
            set retailer_tariff_id = $1, updated_at = now()
          where id = $2`,
        [retailerTariffId, installationId],
      );
      console.log(`  ✓ Installation.retailer_tariff_id wired → N1 retailer`);
    }

    await c.query("COMMIT");
    console.log("\n✅ COMMIT — Reykjavík HQ tariff anchors wired.");
    console.log("\nNext session at zpr074002 should compute cost cleanly through:");
    console.log("  Veitur AD1 (8.64 kr/kWh) + N1 retailer (8.83 kr/kWh) × 1.24 VAT");
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
