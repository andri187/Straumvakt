#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== TariffDefinition rows by org ===");
  const r = await c.query(
    `select td.id, td.org_id, o.display_name as org,
            td.display_name as tariff, td.compute_rule, td.status
     from billing.tariff_definitions td
     join tenancy.organizations o on o.id = td.org_id
     order by o.display_name, td.display_name`,
  );
  for (const row of r.rows) {
    console.log(
      `  org=${row.org}  tariff=${row.tariff}  status=${row.status}  rule=${JSON.stringify(row.compute_rule)}`,
    );
  }

  console.log("\n=== Dalvegur site ===");
  const s = await c.query(
    `select s.id, s.display_name, s.org_id, o.display_name as org,
            s.dso_tariff_id
     from properties.sites s
     join tenancy.organizations o on o.id = s.org_id
     where s.id = '536987d3-04e4-4c89-a27c-105fa21d8364'`,
  );
  for (const row of s.rows) console.log("  " + JSON.stringify(row));

  console.log("\n=== Dalvegur 10 installation ===");
  const i = await c.query(
    `select i.id, i.display_name, i.org_id, o.display_name as org,
            i.retailer_tariff_id, i.credentials_id
     from properties.installations i
     join tenancy.organizations o on o.id = i.org_id
     where i.id = '37de71e8-10bc-458e-ab5d-164eaccd75e6'`,
  );
  for (const row of i.rows) console.log("  " + JSON.stringify(row));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
