#!/usr/bin/env tsx
/**
 * Cleanup zombie `in_progress` ChargeSession rows left behind by the
 * brief fix-A deploy window on 2026-05-12 that was reverted before its
 * StopTransaction handlers could fire. The rows have:
 *   - status = 'in_progress'
 *   - started_at very old (>= 24h)
 *   - no matching ended_at
 *   - energy_wh = whatever meterStart was at Start (typically 0 or a
 *     small number)
 *
 * What this script does, in one transaction:
 *   1. SELECT preview — show the rows about to be touched (count +
 *      per-row charger / start time / id_tag)
 *   2. UPDATE them: status='aborted', ended_at = started_at + 1 minute
 *      (synthetic; no real meter data was ever captured), stop_reason
 *      = 'abandoned_fix_a_revert'
 *
 * No ledger row is created — these sessions have no real billing
 * impact (zero or near-zero energy, no Stop event). `reports.session_
 * ledger` rows for them are left untouched if they exist, but the
 * ChargeSession status flips so the operator UI stops showing them
 * as active.
 *
 * Idempotent — re-running finds zero rows once they're all aborted.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const STALE_THRESHOLD = "24 hours";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Zombie session cleanup ===\n");

  // 1. Preview
  const preview = await c.query(`
    select s.id,
           s.started_at,
           s.id_tag,
           s.energy_wh,
           s.ocpp_identity_id,
           sa.display_name as charger,
           i.display_name as installation
      from charging.sessions s
      left join properties.site_assets sa on sa.id = s.charging_station_id
      left join assets.charging_stations cs on cs.site_asset_id = s.charging_station_id
      left join properties.installations i on i.id = cs.installation_id
     where s.status = 'in_progress'
       and s.started_at < now() - interval '${STALE_THRESHOLD}'
     order by s.started_at asc
  `);

  if (preview.rowCount === 0) {
    console.log("Nothing to clean — no in_progress sessions older than 24h. Done.");
    await c.end();
    return;
  }

  console.log(`Found ${preview.rowCount} zombie session(s):`);
  console.log("  charger              installation         started_at                 id_tag         energy_wh");
  for (const r of preview.rows) {
    console.log(
      `  ${(r.charger ?? "(none)").padEnd(20)} ${(r.installation ?? "(none)").padEnd(20)} ${r.started_at.toISOString()}  ${(r.id_tag ?? "—").padEnd(13)} ${r.energy_wh ?? 0}`,
    );
  }

  // 2. Apply
  console.log("\nApplying update...");
  await c.query("BEGIN");
  try {
    const upd = await c.query(`
      update charging.sessions
         set status      = 'aborted',
             ended_at    = started_at + interval '1 minute',
             stop_reason = 'abandoned_fix_a_revert',
             updated_at  = now()
       where status = 'in_progress'
         and started_at < now() - interval '${STALE_THRESHOLD}'
      returning id
    `);
    console.log(`  ✓ Aborted ${upd.rowCount} row(s)`);

    await c.query("COMMIT");
    console.log("\n✅ COMMIT — zombie sessions cleaned.");
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("\n❌ ROLLBACK — error:", err);
    process.exit(1);
  }

  // 3. Verify
  const after = await c.query(`
    select count(*)::int n
      from charging.sessions
     where status = 'in_progress'
       and started_at < now() - interval '${STALE_THRESHOLD}'
  `);
  console.log(`\nRemaining stale in_progress sessions: ${after.rows[0].n}`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
