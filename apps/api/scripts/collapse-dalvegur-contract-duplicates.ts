#!/usr/bin/env tsx
/**
 * Sprint 8.14 — collapse the dual-row Dalvegur contract into a single
 * row with counterpartyOrgId set.
 *
 * Pre 8.14 we wrote two rows for each bilateral arrangement
 * (Straumvakt-side + N1-side) because the schema didn't have a
 * counterparty column. The 8.14 migration adds counterpartyOrgId,
 * and this script:
 *   1. Picks the customer-side row as the survivor (orgId = N1)
 *   2. Sets its counterpartyOrgId = Straumvakt
 *   3. Updates displayName to a neutral form
 *   4. Deletes the operator-side mirror (orgId = Straumvakt)
 *
 * Idempotent — safe to re-run; checks for the surviving row first.
 *
 * MUST be run AFTER prisma migrate deploy adds the counterparty
 * column. Will throw with a clear message if the column is missing.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326";
const STRAUMVAKT_ORG = "fe7ed894-7ac4-48f6-9fdc-92b620fd10d1";
const DALVEGUR_SITE = "536987d3-04e4-4c89-a27c-105fa21d8364";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Sanity check: the column must exist or the merge would silently
  // skip. Hard-fail with a useful message if migrate hasn't run.
  const colCheck = await c.query(
    `select column_name from information_schema.columns
     where table_schema = 'billing' and table_name = 'contracts'
       and column_name = 'counterparty_org_id'`,
  );
  if (colCheck.rowCount === 0) {
    throw new Error(
      "billing.contracts.counterparty_org_id column missing — run prisma migrate deploy first",
    );
  }

  console.log("=== Step 1: Inspect current state ===");
  const before = await c.query(
    `select id, org_id, counterparty_org_id, display_name
     from billing.contracts
     where scope_type = 'site' and scope_id = $1
     order by org_id`,
    [DALVEGUR_SITE],
  );
  console.log(`  Found ${before.rowCount} row(s):`);
  for (const r of before.rows) {
    console.log(
      `    id=${r.id} org=${r.org_id} counterparty=${r.counterparty_org_id ?? "—"} name='${r.display_name}'`,
    );
  }

  const customerRow = before.rows.find((r) => r.org_id === N1_ORG);
  const operatorRow = before.rows.find((r) => r.org_id === STRAUMVAKT_ORG);

  if (!customerRow) {
    console.log("  No N1-side row found — nothing to collapse.");
    await c.end();
    return;
  }

  console.log("\n=== Step 2: Update N1-side row ===");
  const newName = "Dalvegur 10–14 — N1 / Straumvakt operator agreement";
  const upd = await c.query(
    `update billing.contracts
        set counterparty_org_id = $1,
            display_name = $2,
            updated_at = now()
      where id = $3
      returning id, display_name, counterparty_org_id`,
    [STRAUMVAKT_ORG, newName, customerRow.id],
  );
  for (const r of upd.rows) {
    console.log(`  updated: ${r.id}  name='${r.display_name}'  counterparty=${r.counterparty_org_id}`);
  }

  console.log("\n=== Step 3: Drop Straumvakt-side mirror ===");
  if (!operatorRow) {
    console.log("  No Straumvakt-side row to drop.");
  } else {
    const del = await c.query(
      `delete from billing.contracts where id = $1 returning id`,
      [operatorRow.id],
    );
    console.log(`  deleted ${del.rowCount} row(s): ${operatorRow.id}`);
  }

  console.log("\n=== Final state ===");
  const after = await c.query(
    `select id, org_id, counterparty_org_id, display_name
     from billing.contracts
     where scope_type = 'site' and scope_id = $1`,
    [DALVEGUR_SITE],
  );
  for (const r of after.rows) console.log("  " + JSON.stringify(r));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
