#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  // Find vendors table
  const tables = await c.query(
    `select table_schema, table_name from information_schema.tables
     where table_name like '%vendor%'`,
  );
  for (const row of tables.rows) {
    console.log(`  ${row.table_schema}.${row.table_name}`);
  }

  const r = await c.query(
    `select vc.id, vc.username, o.display_name as owner
     from hardware.vendor_credentials vc
     join tenancy.organizations o on o.id = vc.owner_org_id
     where vc.status = 'active'`,
  );
  console.log("Active Zaptec credentials:");
  for (const row of r.rows) {
    console.log(`  id=${row.id}  user=${row.username}  owner=${row.owner}`);
  }
  await c.end();
})();
