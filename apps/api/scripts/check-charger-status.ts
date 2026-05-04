#!/usr/bin/env tsx
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const r = await c.query(
    `select i.identity_string, i.vendor_resource_id, i.status, i.last_seen_at,
            i.org_id, o.display_name as org
     from ocpp.ocpp_identities i
     join tenancy.organizations o on o.id = i.org_id
     where i.vendor = 'Zaptec'
     order by i.last_seen_at desc nulls last
     limit 25`,
  );
  console.log(`OcppIdentity Zaptec rows (${r.rowCount}):`);
  for (const row of r.rows) {
    console.log(
      `  ${row.last_seen_at?.toISOString() ?? "(never)"}  status=${row.status}  org=${row.org}  ident=${row.identity_string}`,
    );
  }
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
