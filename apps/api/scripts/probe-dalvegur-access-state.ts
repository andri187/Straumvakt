#!/usr/bin/env tsx
// Read-only probe — finds rows we'd need to wire up Dalvegur access
// for the EE43C609263CC7 default tag. No writes. Run before any
// INSERT to avoid creating duplicate users / orgs / agreements.

import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // 1. Look for an existing User named anything close to "N1 Drivers"
  const u = await c.query(
    `select id, email, display_name, status
       from identity.users
      where lower(coalesce(display_name, email)) like '%n1%'
         or lower(coalesce(display_name, email)) like '%drivers%'
      order by created_at desc
      limit 20`,
  );
  console.log(`=== Possible "N1 Drivers" users (${u.rowCount}) ===`);
  for (const r of u.rows) console.log("  " + JSON.stringify(r));

  // 2. Dalvegur Installation(s)
  const i = await c.query(
    `select i.id, i.display_name, i.org_id, i.installation_type, i.enforce_authorize,
            o.display_name as org_display_name
       from properties.installations i
       join tenancy.organizations o on o.id = i.org_id
      where lower(i.display_name) like '%dalvegur%'
      order by i.created_at`,
  );
  console.log(`\n=== Dalvegur installations (${i.rowCount}) ===`);
  for (const r of i.rows) console.log("  " + JSON.stringify(r));

  // 3. EE43C609263CC7 IdToken (if any)
  const t = await c.query(
    `select t.id, t.value, t.user_id, t.status, t.expires_at, t.scope_installation_id, t.kind, t.label,
            u.display_name as user_display_name
       from identity.id_tokens t
  left join identity.users u on u.id = t.user_id
      where t.value = 'EE43C609263CC7'`,
  );
  console.log(`\n=== EE43C609263CC7 IdToken (${t.rowCount}) ===`);
  for (const r of t.rows) console.log("  " + JSON.stringify(r));

  // 4. Existing Agreements anchored at any Dalvegur installation
  const a = await c.query(
    `select a.id, a.agreement_type, a.status, a.display_name, a.installation_id, a.counterparty_org_id
       from agreements.agreements a
       join properties.installations i on i.id = a.installation_id
      where lower(i.display_name) like '%dalvegur%'`,
  );
  console.log(`\n=== Existing Dalvegur agreements (${a.rowCount}) ===`);
  for (const r of a.rows) console.log("  " + JSON.stringify(r));

  // 5. Any DriverGroups / Memberships pointed at the user (in case work was started)
  const dg = await c.query(
    `select dg.id, dg.display_name, dg.agreement_id, dg.owner_org_id,
            (select count(*)::int from agreements.driver_group_memberships m where m.driver_group_id = dg.id) as members
       from agreements.driver_groups dg`,
  );
  console.log(`\n=== Existing DriverGroups (${dg.rowCount}) ===`);
  for (const r of dg.rows) console.log("  " + JSON.stringify(r));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
