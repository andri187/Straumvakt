#!/usr/bin/env tsx
/**
 * Inspect + fix the existing zpr074002 OcppIdentity:
 *   1. Show current state (site, installation, auth_secret_hash, etc.)
 *   2. UPDATE auth_secret_hash to NULL
 *   3. DELETE any pending_discoveries row
 *
 * Cheap recovery from the partial-delete state the operator hit
 * after the failed initial claim. Safer than re-seeding because we
 * don't have to know which Site/Installation the operator originally
 * picked.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const IDENTITY = "zpr074002";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("=== Current state ===\n");
  const cur = await c.query(
    `select oi.id as identity_id,
            oi.identity_string,
            oi.auth_secret_hash is null as no_auth,
            oi.status as identity_status,
            oi.last_seen_at,
            cs.installation_id,
            i.display_name as installation_name,
            i.enforce_authorize,
            sa.site_id,
            s.display_name as site_name,
            sa.display_name as charger_name
       from ocpp.ocpp_identities oi
       join properties.site_assets sa on sa.id = oi.charging_station_id
       join assets.charging_stations cs on cs.site_asset_id = sa.id
       left join properties.installations i on i.id = cs.installation_id
       join properties.sites s on s.id = sa.site_id
      where lower(oi.identity_string) = lower($1)`,
    [IDENTITY],
  );
  if (cur.rowCount === 0) {
    console.error(`No OcppIdentity for ${IDENTITY}`);
    await c.end();
    process.exit(1);
  }
  console.log(cur.rows[0]);

  const r = cur.rows[0];
  if (r.no_auth) {
    console.log("\n✓ Already on no-auth path. Nothing to update.");
  } else {
    console.log("\nUpdating to no-auth...");
    await c.query("BEGIN");
    try {
      const upd = await c.query(
        `update ocpp.ocpp_identities
            set auth_secret_hash = NULL,
                updated_at = now()
          where id = $1
         returning id`,
        [r.identity_id],
      );
      console.log(`  ✓ auth_secret_hash set NULL on ${upd.rows[0].id}`);

      const pd = await c.query(
        `delete from ocpp.pending_discoveries
          where lower(identity_string) = lower($1)
         returning identity_string, attempt_count`,
        [IDENTITY],
      );
      if (pd.rowCount && pd.rowCount > 0) {
        console.log(`  ✓ pending_discoveries row dropped (was ${pd.rows[0].attempt_count} attempts)`);
      } else {
        console.log(`  · No pending_discoveries row to clear`);
      }

      await c.query("COMMIT");
      console.log("\n✅ COMMIT — zpr074002 is now no-auth.");
      console.log("\nNext OCPP retry should land 101 not 403.");
    } catch (err) {
      await c.query("ROLLBACK");
      console.error("\n❌ ROLLBACK — error:", err);
      process.exit(1);
    }
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
