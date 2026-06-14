#!/usr/bin/env tsx
/**
 * Seed "Veitur ohf" as a supplier (DSO) Organization and link the
 * VEITUR-AD1 rate reference to it, so the driver app shows the actual DSO
 * name on the contract pricing breakdown (alongside the retailer, which
 * already carries supplier_org_id = N1 ehf).
 *
 * The driver app resolves each agreement clause's rate reference → its
 * supplier org → display name. The DSO rate (VEITUR-AD1) was migrated with
 * supplier_org_id = NULL ("Veitur ohf — not seeded as an Organization row"),
 * so the DSO line fell back to the cost-factor name. This links it.
 *
 * Idempotent — safe to re-run. MUST be run while DATABASE_URL points at
 * staging (root .env.local).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const VEITUR_NAME = "Veitur ohf";
const DSO_RATE_CODE = "VEITUR-AD1";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // 1. Find or create the Veitur org (a supplier/DSO org — kind stays NULL
  //    per the model's "Null for non-host orgs (operators, vendors, DSOs…)").
  const existing = await c.query(
    `select id from tenancy.organizations where display_name = $1 limit 1`,
    [VEITUR_NAME],
  );
  let veiturId: string;
  if (existing.rowCount && existing.rowCount > 0) {
    veiturId = existing.rows[0].id;
    console.log(`  reusing existing org '${VEITUR_NAME}' = ${veiturId}`);
  } else {
    veiturId = randomUUID();
    await c.query(
      `insert into tenancy.organizations
         (id, display_name, country_code, created_at, updated_at)
       values ($1, $2, 'IS', now(), now())`,
      [veiturId, VEITUR_NAME],
    );
    console.log(`  inserted org '${VEITUR_NAME}' = ${veiturId}`);
  }

  // 2. Link the DSO rate reference to Veitur (only if not already set).
  const upd = await c.query(
    `update agreements.rate_references
        set supplier_org_id = $1
      where code = $2 and supplier_org_id is null
      returning id`,
    [veiturId, DSO_RATE_CODE],
  );
  console.log(
    `  rate_reference '${DSO_RATE_CODE}' linked to ${VEITUR_NAME}: ${upd.rowCount} row(s) updated`,
  );

  // 3. Report final state for both supplier rate refs.
  const final = await c.query(
    `select rr.code, rr.supplier_org_id, o.display_name as supplier
       from agreements.rate_references rr
       left join tenancy.organizations o on o.id = rr.supplier_org_id
      where rr.code in ('VEITUR-AD1', 'N1-RAFMAGN-REPF-01')
      order by rr.code`,
  );
  console.log("  final supplier links:");
  for (const r of final.rows) console.log("   " + JSON.stringify(r));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
