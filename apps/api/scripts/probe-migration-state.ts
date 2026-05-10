#!/usr/bin/env tsx
// Read-only probe of migration state vs actual schema. No writes.
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const m = await c.query(
    `select migration_name, finished_at, rolled_back_at, applied_steps_count
       from _prisma_migrations
      order by started_at desc
      limit 15`,
  );
  console.log(`=== _prisma_migrations (last 15) ===`);
  for (const r of m.rows) {
    const ok = r.finished_at && !r.rolled_back_at;
    console.log(`  ${ok ? "✓" : "✗"} ${r.migration_name}  finished=${r.finished_at?.toISOString?.() ?? "—"}  rolled_back=${r.rolled_back_at?.toISOString?.() ?? "—"}  steps=${r.applied_steps_count}`);
  }

  // Verify the agreements schema actually exists
  const a = await c.query(
    `select count(*)::int as n
       from information_schema.tables
      where table_schema = 'agreements'`,
  );
  console.log(`\n=== agreements schema tables: ${a.rows[0].n}`);

  // Verify the InstallationType enum exists
  const t = await c.query(
    `select 1
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'properties' and t.typname = 'InstallationType'`,
  );
  console.log(`=== InstallationType enum present: ${t.rowCount === 1 ? "yes" : "no"}`);

  // Check IdTokenKind enum values
  const e = await c.query(
    `select e.enumlabel
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'identity' and t.typname = 'IdTokenKind'
      order by e.enumsortorder`,
  );
  console.log(`=== identity.IdTokenKind values: ${e.rows.map((r) => r.enumlabel).join(", ")}`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
