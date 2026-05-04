#!/usr/bin/env tsx
/**
 * Seed N1's tariff catalogue + contract for Dalvegur.
 *
 * Background: Dalvegur (site 536987d3-…) was moved from Straumvakt
 * to N1 hef (org b9f6a897-…). The move correctly nulled the
 * installation retailer tariff but left the site DSO pointing at
 * Straumvakt's catalogue (cross-org orphan), and N1's catalogue is
 * empty. This script:
 *
 *   1. Inserts Veitur AD1 + N1_RAFMAGN-REPF-01 into N1's catalogue.
 *   2. Rebinds site.dso_tariff_id and installation.retailer_tariff_id
 *      to the N1-owned rows.
 *   3. Creates a Contract row on N1 representing the operations
 *      agreement with Straumvakt for Dalvegur.
 *
 * Idempotent — safe to re-run; uses ON CONFLICT DO NOTHING for the
 * inserts and only updates FKs that aren't already pointing at the
 * N1-owned rows.
 *
 * MUST be run while DATABASE_URL points at staging (root .env.local).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const STRAUMVAKT_ORG = "fe7ed894-7ac4-48f6-9fdc-92b620fd10d1";
const DALVEGUR_SITE = "536987d3-04e4-4c89-a27c-105fa21d8364";
const DALVEGUR_INSTALL = "37de71e8-10bc-458e-ab5d-164eaccd75e6";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Step 1: Inspect N1 catalogue ===");
  const before = await c.query(
    `select id, display_name, compute_rule
     from billing.tariff_definitions
     where org_id = $1
     order by display_name`,
    [N1_ORG],
  );
  console.log(`  N1 catalogue currently has ${before.rowCount} row(s)`);

  // Reuse cost factors from Straumvakt's catalogue if N1 doesn't have
  // its own — cost factors are reference data (DSOF, REPF, etc.) and
  // can legitimately cross orgs in this MVP. Future enrichment will
  // give each org its own.
  const factorRows = await c.query(
    `select id, code from billing.cost_factors
     where code in ('DSOF', 'REPF') order by code`,
  );
  const factorByCode = new Map<string, string>();
  for (const r of factorRows.rows) factorByCode.set(r.code, r.id);
  console.log(
    `  cost factors found: DSOF=${factorByCode.get("DSOF") ?? "MISSING"} REPF=${factorByCode.get("REPF") ?? "MISSING"}`,
  );
  if (!factorByCode.get("DSOF") || !factorByCode.get("REPF")) {
    throw new Error("DSOF or REPF cost_factor missing — seed those first");
  }

  // Idempotent seed: pick existing row if one already exists in N1's
  // org with the same display_name, else insert.
  async function ensureTariff(
    displayName: string,
    rule: object,
    factorId: string,
  ): Promise<string> {
    const existing = await c.query(
      `select id from billing.tariff_definitions
       where org_id = $1 and display_name = $2 limit 1`,
      [N1_ORG, displayName],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log(`  reusing existing N1 tariff '${displayName}' = ${existing.rows[0].id}`);
      return existing.rows[0].id;
    }
    const id = randomUUID();
    await c.query(
      `insert into billing.tariff_definitions
         (id, org_id, display_name, currency, vat_rate_pct,
          cost_factor_id, compute_rule, status, valid_from,
          created_at, updated_at)
       values ($1, $2, $3, 'ISK', 24, $4, $5::jsonb, 'active', now(),
               now(), now())`,
      [id, N1_ORG, displayName, factorId, JSON.stringify(rule)],
    );
    console.log(`  inserted N1 tariff '${displayName}' = ${id}`);
    return id;
  }

  console.log("\n=== Step 2: Seed N1 tariff catalogue ===");
  const veiturN1 = await ensureTariff(
    "Veitur AD1",
    { kind: "flat", pricePerKwhMinor: 864 },
    factorByCode.get("DSOF")!,
  );
  const retailerN1 = await ensureTariff(
    "N1 N1_RAFMAGN-REPF-01",
    { kind: "flat", pricePerKwhMinor: 883 },
    factorByCode.get("REPF")!,
  );

  console.log("\n=== Step 3: Rebind Dalvegur site + installation ===");
  const siteUpdate = await c.query(
    `update properties.sites
        set dso_tariff_id = $1, updated_at = now()
      where id = $2 and (dso_tariff_id is null or dso_tariff_id <> $1)
      returning id`,
    [veiturN1, DALVEGUR_SITE],
  );
  console.log(
    `  site dso_tariff_id rebound: ${siteUpdate.rowCount} row(s) updated`,
  );
  const installUpdate = await c.query(
    `update properties.installations
        set retailer_tariff_id = $1, updated_at = now()
      where id = $2 and (retailer_tariff_id is null or retailer_tariff_id <> $1)
      returning id`,
    [retailerN1, DALVEGUR_INSTALL],
  );
  console.log(
    `  installation retailer_tariff_id rebound: ${installUpdate.rowCount} row(s) updated`,
  );

  console.log("\n=== Step 4: Seed N1 ↔ Straumvakt operations contract ===");
  const existingContract = await c.query(
    `select id, display_name from billing.contracts
      where org_id = $1 and scope_type = 'site' and scope_id = $2
      limit 1`,
    [N1_ORG, DALVEGUR_SITE],
  );
  if (existingContract.rowCount && existingContract.rowCount > 0) {
    console.log(
      `  contract already exists: ${existingContract.rows[0].id} (${existingContract.rows[0].display_name})`,
    );
  } else {
    const cid = randomUUID();
    await c.query(
      `insert into billing.contracts
         (id, org_id, scope_type, scope_id, display_name, status,
          valid_from, created_at, updated_at)
       values ($1, $2, 'site', $3, $4, 'active', now(), now(), now())`,
      [
        cid,
        N1_ORG,
        DALVEGUR_SITE,
        "Dalvegur 10–14 — operations agreement with Straumvakt",
      ],
    );
    console.log(`  inserted N1-side contract: ${cid}`);
  }

  console.log("\n=== Step 5: Mirror contract on Straumvakt's side ===");
  const existingMirror = await c.query(
    `select id, display_name from billing.contracts
      where org_id = $1 and scope_type = 'site' and scope_id = $2
      limit 1`,
    [STRAUMVAKT_ORG, DALVEGUR_SITE],
  );
  if (existingMirror.rowCount && existingMirror.rowCount > 0) {
    console.log(
      `  mirror already exists: ${existingMirror.rows[0].id} (${existingMirror.rows[0].display_name})`,
    );
  } else {
    const mid = randomUUID();
    await c.query(
      `insert into billing.contracts
         (id, org_id, scope_type, scope_id, display_name, status,
          valid_from, created_at, updated_at)
       values ($1, $2, 'site', $3, $4, 'active', now(), now(), now())`,
      [
        mid,
        STRAUMVAKT_ORG,
        DALVEGUR_SITE,
        "Dalvegur 10–14 — operations agreement with N1",
      ],
    );
    console.log(`  inserted Straumvakt-side contract: ${mid}`);
  }

  console.log("\n=== Final state ===");
  const final = await c.query(
    `select s.display_name as site, s.dso_tariff_id,
            td.display_name as dso_tariff,
            td.org_id as dso_tariff_org,
            i.retailer_tariff_id, td2.display_name as retailer_tariff,
            td2.org_id as retailer_tariff_org
     from properties.sites s
     left join billing.tariff_definitions td on td.id = s.dso_tariff_id
     left join properties.installations i on i.site_id = s.id
     left join billing.tariff_definitions td2 on td2.id = i.retailer_tariff_id
     where s.id = $1`,
    [DALVEGUR_SITE],
  );
  for (const r of final.rows) console.log("  " + JSON.stringify(r));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
