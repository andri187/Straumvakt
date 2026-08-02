#!/usr/bin/env tsx
/**
 * Read-only probe — confirms the access path from N1 Drivers User to
 * the VCP Lab installation works end-to-end. Mirrors the join shape
 * the driver.ts /api/driver/chargers route uses.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const N1_DRIVERS_USER_ID = "91a2fae3-8fb0-467a-be99-d613e6d3fd78";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Same shape as driver.ts:205-240 — installations the user has
  // membership at via an active installation Agreement.
  const installations = await c.query(
    `select distinct
        a.installation_id,
        i.display_name as installation_name,
        s.display_name as site_name,
        a.id          as agreement_id,
        a.status      as agreement_status,
        a.effective_from,
        a.effective_until,
        dg.display_name as driver_group_name
       from agreements.driver_group_memberships m
       join agreements.driver_groups dg on dg.id = m.driver_group_id
       join agreements.agreements    a  on a.id = dg.agreement_id
       left join properties.installations i on i.id = a.installation_id
       left join properties.sites s on s.id = i.site_id
      where m.user_id = $1
        and a.agreement_type = 'installation'
        and a.status = 'active'
        and a.effective_from <= now()
        and (a.effective_until is null or a.effective_until > now())
      order by i.display_name`,
    [N1_DRIVERS_USER_ID],
  );

  console.log(`N1 Drivers User can access ${installations.rowCount} installation(s):\n`);
  for (const r of installations.rows) {
    console.log(`  ✓ ${r.installation_name}`);
    console.log(`      site         : ${r.site_name}`);
    console.log(`      installation : ${r.installation_id}`);
    console.log(`      agreement    : ${r.agreement_id} (group "${r.driver_group_name}")`);
    console.log("");
  }

  // For each accessible installation, list the chargers visible.
  for (const r of installations.rows) {
    const simple = await c.query(
      `select cs.site_asset_id,
              sa.display_name as charger_name,
              cs.vendor, cs.model,
              o.identity_string as ocpp_identity
         from assets.charging_stations cs
         join properties.site_assets sa on sa.id = cs.site_asset_id
         left join ocpp.ocpp_identities o on o.charging_station_id = cs.site_asset_id
        where cs.installation_id = $1
        order by sa.display_name`,
      [r.installation_id],
    );
    console.log(`  Chargers under ${r.installation_name} (${simple.rowCount}):`);
    for (const ch of simple.rows) {
      console.log(
        `    • ${ch.charger_name}  vendor=${ch.vendor ?? "—"}  model=${ch.model ?? "—"}  ocpp=${ch.ocpp_identity ?? "—"}`,
      );
    }
    console.log("");
  }

  // Also check the IdToken side — what tags route to this user?
  const tokens = await c.query(
    `select t.value, t.kind, t.status, t.scope_installation_id,
            i.display_name as scope_installation_name
       from identity.id_tokens t
       left join properties.installations i on i.id = t.scope_installation_id
      where t.user_id = $1
      order by t.value`,
    [N1_DRIVERS_USER_ID],
  );
  console.log(`IdTokens routing to N1 Drivers User (${tokens.rowCount}):`);
  for (const t of tokens.rows) {
    const scope = t.scope_installation_name
      ? `scoped to ${t.scope_installation_name}`
      : "global";
    console.log(`  • ${t.value}  kind=${t.kind}  status=${t.status}  ${scope}`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
