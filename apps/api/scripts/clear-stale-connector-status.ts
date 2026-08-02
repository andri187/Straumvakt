#!/usr/bin/env tsx
/**
 * Clear stale `connectors.status` rows left behind by the earlier
 * fix-A run (2026-05-12 ~02:07 UTC). Those rows hold values like
 * "Charging" / "SuspendedEV" frozen since when the projection handlers
 * were last writing — now misleading the operator UI which displays
 * them as if real-time.
 *
 * What this script does, in one transaction:
 *   1. SELECT the rows about to change (count + sample)
 *   2. UPDATE them: status='unknown', status_updated_at=NULL,
 *      error_code=NULL, vendor_error_code=NULL
 *   3. Print before/after for the operator to verify
 *
 * Staleness threshold: status_updated_at older than 5 minutes.
 * Anything fresher would be real-time (which would mean fix-A is back
 * live and we don't want to clear it).
 *
 * Safe to re-run — idempotent. Second run finds nothing to clear.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Clear stale connector status ===\n");

  // 1. Preview what would change
  const preview = await c.query(`
    select cn.status,
           count(*)::int n,
           min(cn.status_updated_at) oldest,
           max(cn.status_updated_at) newest
      from assets.connectors cn
     where cn.status <> 'unknown'
       and (cn.status_updated_at is null
            or cn.status_updated_at < now() - interval '5 minutes')
     group by cn.status
     order by n desc
  `);

  if (preview.rowCount === 0) {
    console.log("Nothing to clear — all connector.status rows are either");
    console.log("'unknown' already, or fresh (<5 min). Done.");
    await c.end();
    return;
  }

  console.log("Rows about to be reset to 'unknown':");
  let total = 0;
  for (const r of preview.rows) {
    console.log(
      `  ${r.status.padEnd(15)} n=${r.n}  oldest=${r.oldest?.toISOString?.() ?? "(null)"}  newest=${r.newest?.toISOString?.() ?? "(null)"}`,
    );
    total += r.n;
  }
  console.log(`  ─────────────────`);
  console.log(`  total:           ${total}\n`);

  // 2. Apply in one transaction
  await c.query("BEGIN");
  try {
    const upd = await c.query(`
      update assets.connectors
         set status = 'unknown',
             status_updated_at = NULL,
             error_code = NULL,
             vendor_error_code = NULL,
             updated_at = now()
       where status <> 'unknown'
         and (status_updated_at is null
              or status_updated_at < now() - interval '5 minutes')
      returning id
    `);
    console.log(`✓ Updated ${upd.rowCount} rows.`);
    await c.query("COMMIT");
    console.log("✅ COMMIT — stale connector status cleared.");
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("❌ ROLLBACK — error:", err);
    process.exit(1);
  }

  // 3. Verify post-state
  const after = await c.query(`
    select status, count(*)::int n
      from assets.connectors
     group by status
     order by n desc
  `);
  console.log("\nFinal connector.status distribution:");
  for (const r of after.rows) {
    console.log(`  ${r.status.padEnd(15)} n=${r.n}`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
