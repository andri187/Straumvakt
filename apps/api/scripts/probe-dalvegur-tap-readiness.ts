#!/usr/bin/env tsx
// Read-only probe: what's required to enable tap-and-access at Dalvegur,
// and which of those preconditions are already met.

import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { EVENT_LOG_ALL } from "./_protocol-log-union";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const DALVEGUR_INSTALLATION_ID = "37de71e8-10bc-458e-ab5d-164eaccd75e6";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // 1. Installation: enforce_authorize flag + onboarding status
  const i = await c.query(
    `select id, display_name, enforce_authorize, onboarding_status,
            credentials_status, installation_type, org_id
       from properties.installations
      where id = $1`,
    [DALVEGUR_INSTALLATION_ID],
  );
  console.log("=== Dalvegur installation ===");
  for (const r of i.rows) console.log("  " + JSON.stringify(r));

  // 2. Active installation Agreement covering this installation
  const a = await c.query(
    `select a.id, a.display_name, a.agreement_type, a.status,
            a.effective_from, a.effective_until
       from agreements.agreements a
      where a.installation_id = $1
        and a.status = 'active'
        and a.effective_from <= now()
        and (a.effective_until is null or a.effective_until > now())`,
    [DALVEGUR_INSTALLATION_ID],
  );
  console.log(`\n=== Active installation Agreement (${a.rowCount}) ===`);
  for (const r of a.rows) console.log("  " + JSON.stringify(r));

  // 3. DriverGroups under that agreement
  const dg = await c.query(
    `select dg.id, dg.display_name,
            (select count(*)::int from agreements.driver_group_memberships m where m.driver_group_id = dg.id) as members
       from agreements.driver_groups dg
       join agreements.agreements a on a.id = dg.agreement_id
      where a.installation_id = $1
        and a.status = 'active'`,
    [DALVEGUR_INSTALLATION_ID],
  );
  console.log(`\n=== DriverGroups (${dg.rowCount}) ===`);
  for (const r of dg.rows) console.log("  " + JSON.stringify(r));

  // 4. Members + their IdTokens
  const m = await c.query(
    `select u.id as user_id, u.email, u.display_name, u.audience, u.status as user_status,
            t.id as token_id, t.value as token_value, t.kind, t.status as token_status,
            t.scope_installation_id
       from agreements.driver_group_memberships dgm
       join agreements.driver_groups dg on dg.id = dgm.driver_group_id
       join agreements.agreements a on a.id = dg.agreement_id
       join identity.users u on u.id = dgm.user_id
  left join identity.id_tokens t on t.user_id = u.id and t.status = 'active'
      where a.installation_id = $1`,
    [DALVEGUR_INSTALLATION_ID],
  );
  console.log(`\n=== Drivers + their active tokens (${m.rowCount}) ===`);
  for (const r of m.rows) console.log("  " + JSON.stringify(r));

  // 5. OCPP identities (chargers) associated with Dalvegur via charging stations
  const oc = await c.query(
    `select oi.id, oi.identity_string, cs.serial_number,
            sa.display_name as charger_name
       from ocpp.ocpp_identities oi
       join assets.charging_stations cs on cs.site_asset_id = oi.charging_station_id
       join assets.site_assets sa on sa.id = cs.site_asset_id
      where cs.installation_id = $1
      limit 5`,
    [DALVEGUR_INSTALLATION_ID],
  );
  console.log(`\n=== Sample of OCPP identities under Dalvegur (showing 5) ===`);
  for (const r of oc.rows) console.log("  " + JSON.stringify(r));

  // 6. Recent OCPP events from any of these chargers — proves connectivity
  const ev = await c.query(
    `select event_type, count(*)::int as n, max(occurred_at) as latest
       from ${EVENT_LOG_ALL} el
      where event_type ilike 'ocpp%'
        and occurred_at > now() - interval '24 hours'
      group by 1 order by 3 desc limit 10`,
  );
  console.log(`\n=== Recent OCPP events (last 24h) ===`);
  if (ev.rowCount === 0) console.log("  (no OCPP traffic — gateway may be quiet)");
  for (const r of ev.rows) {
    console.log(
      `  ${(r.event_type as string).padEnd(40)} n=${String(r.n).padStart(4)}  latest=${r.latest?.toISOString?.()}`,
    );
  }

  await c.end();

  // 7. Verdict
  console.log("\n=== Tap-and-access readiness ===");
  const inst = i.rows[0];
  if (!inst) {
    console.log("  ❌ Dalvegur installation not found");
    return;
  }
  console.log(
    `  ${inst.enforce_authorize ? "✅" : "❌"} Straumvakt enforce_authorize: ${inst.enforce_authorize}`,
  );
  console.log(
    `  ${a.rowCount && a.rowCount > 0 ? "✅" : "❌"} Active installation Agreement: ${a.rowCount}`,
  );
  console.log(
    `  ${dg.rowCount && dg.rowCount > 0 ? "✅" : "❌"} DriverGroup(s) under Agreement: ${dg.rowCount}`,
  );
  const driversWithTokens = m.rows.filter((r) => r.token_value).length;
  console.log(
    `  ${driversWithTokens > 0 ? "✅" : "❌"} Drivers with active tokens: ${driversWithTokens}`,
  );
  console.log(
    `\n  Zaptec-side "Authorisation required" flag: operator-only check — verify in Zaptec portal.`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
