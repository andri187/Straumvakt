#!/usr/bin/env tsx
/**
 * Quick org-count probe — confirms whether the move-site dropdown
 * has anywhere to move to.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const orgs = await client.query(
    `select id, display_name, kennitala, status
     from tenancy.organizations
     order by display_name asc`,
  );
  console.log(`Organizations (${orgs.rowCount}):`);
  for (const o of orgs.rows) {
    console.log(
      `  ${o.id}  status=${o.status}  display=${o.display_name}  kt=${o.kennitala ?? "—"}`,
    );
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
