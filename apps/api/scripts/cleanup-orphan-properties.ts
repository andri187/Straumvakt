#!/usr/bin/env tsx
/**
 * Sprint 8.14 — one-shot cleanup of properties that became orphans
 * from earlier site-move runs (before the auto-cleanup landed in
 * moveSiteToOrg).
 *
 * Identifies properties with zero sites, prints them for review,
 * and deletes them. Idempotent + cheap.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Orphan properties (zero sites) ===");
  const orphans = await c.query(
    `select p.id, p.org_id, o.display_name as org, p.display_name
     from properties.properties p
     join tenancy.organizations o on o.id = p.org_id
     left join properties.sites s on s.property_id = p.id
     where s.id is null
     order by o.display_name, p.display_name`,
  );
  console.log(`  Found ${orphans.rowCount} orphan(s):`);
  for (const r of orphans.rows) {
    console.log(`    ${r.id}  org=${r.org}  name='${r.display_name}'`);
  }

  if (orphans.rowCount && orphans.rowCount > 0) {
    console.log("\n=== Deleting ===");
    const ids = orphans.rows.map((r) => r.id);
    const del = await c.query(
      `delete from properties.properties where id = ANY($1::uuid[]) returning id`,
      [ids],
    );
    console.log(`  deleted ${del.rowCount} row(s)`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
