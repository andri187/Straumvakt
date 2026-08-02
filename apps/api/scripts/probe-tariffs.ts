#!/usr/bin/env tsx
/**
 * Tariff situation probe — catalogue, attachment, recent cost writes.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
dotenv({ path: resolve(process.cwd(), "../../.env.local") });

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log("════════ TARIFF SITUATION ════════\n");

  // 1. Catalogue — what TariffDefinitions exist per org
  console.log("── 1. TariffDefinition catalogue (per org) ────────────────");
  const cat = await c.query(`
    select o.display_name as org,
           td.display_name as tariff,
           td.status,
           td.currency,
           td.vat_rate_pct,
           td.compute_rule->>'kind' as rule_kind,
           td.compute_rule->>'pricePerKwhMinor' as price_minor,
           cf.code as cost_factor
      from billing.tariff_definitions td
      join tenancy.organizations o on o.id = td.org_id
      left join billing.cost_factors cf on cf.id = td.cost_factor_id
     order by o.display_name, td.display_name
  `);
  console.log("  org              tariff                     status   currency  vat%  rule    price/kwh    factor");
  for (const r of cat.rows) {
    const priceKr = r.price_minor ? (Number(r.price_minor) / 100).toFixed(2) : "—";
    console.log(
      `  ${(r.org ?? "").padEnd(16)} ${(r.tariff ?? "").padEnd(26)} ${(r.status ?? "").padEnd(8)} ${(r.currency ?? "").padEnd(9)} ${(r.vat_rate_pct ?? "").toString().padEnd(5)} ${(r.rule_kind ?? "").padEnd(7)} ${priceKr.padEnd(12)} ${r.cost_factor ?? "—"}`,
    );
  }

  // 2. Attachment — which sites/installations have tariffs wired
  console.log("\n── 2. Sites with DSO tariff anchor ────────────────────────");
  const sites = await c.query(`
    select s.display_name as site,
           o.display_name as org,
           td.display_name as dso_tariff,
           td.org_id = s.org_id as same_org
      from properties.sites s
      join tenancy.organizations o on o.id = s.org_id
      left join billing.tariff_definitions td on td.id = s.dso_tariff_id
     order by o.display_name, s.display_name
  `);
  console.log("  site                org              dso_tariff                  same-org?");
  for (const r of sites.rows) {
    const sameOrg = r.same_org === true ? "✓" : r.same_org === false ? "✗ CROSS-ORG ORPHAN" : "(no tariff)";
    console.log(
      `  ${(r.site ?? "").padEnd(19)} ${(r.org ?? "").padEnd(16)} ${(r.dso_tariff ?? "(none)").padEnd(27)} ${sameOrg}`,
    );
  }

  console.log("\n── 3. Installations with retailer tariff anchor ───────────");
  const insts = await c.query(`
    select i.display_name as installation,
           s.display_name as site,
           o.display_name as org,
           td.display_name as retailer_tariff,
           td.org_id = i.org_id as same_org
      from properties.installations i
      join properties.sites s on s.id = i.site_id
      join tenancy.organizations o on o.id = i.org_id
      left join billing.tariff_definitions td on td.id = i.retailer_tariff_id
     order by o.display_name, s.display_name, i.display_name
  `);
  console.log("  installation         site                 org              retailer_tariff               same-org?");
  for (const r of insts.rows) {
    const sameOrg = r.same_org === true ? "✓" : r.same_org === false ? "✗ CROSS-ORG ORPHAN" : "(no tariff)";
    console.log(
      `  ${(r.installation ?? "").padEnd(20)} ${(r.site ?? "").padEnd(20)} ${(r.org ?? "").padEnd(16)} ${(r.retailer_tariff ?? "(none)").padEnd(29)} ${sameOrg}`,
    );
  }

  // 4. Recent session cost computations
  console.log("\n── 4. Recent ledger entries (cost computation working?) ───");
  const recent = await c.query(`
    select sl.session_id,
           sa.display_name as charger,
           sl.energy_kwh,
           sl.cost_isk_minor,
           sl.driver_user_id is not null as has_driver,
           sl.stopped_at
      from reports.session_ledger sl
      left join properties.site_assets sa on sa.id = sl.charging_station_id
     where sl.stopped_at > now() - interval '30 days'
     order by sl.stopped_at desc
     limit 10
  `);
  console.log(`  ledger entries last 30d: ${recent.rowCount}`);
  if (recent.rowCount === 0) {
    console.log("  (none — system has been idle, can't validate cost computation)");
  } else {
    console.log("  charger                 energy_kwh    cost_isk      driver?  stopped_at");
    for (const r of recent.rows) {
      const cost = r.cost_isk_minor ? (Number(r.cost_isk_minor) / 100).toFixed(2) + " kr." : "—";
      console.log(
        `  ${(r.charger ?? "—").padEnd(23)} ${(r.energy_kwh ?? "—").toString().padEnd(13)} ${cost.padEnd(13)} ${r.has_driver ? "✓" : "—"}        ${r.stopped_at.toISOString()}`,
      );
    }
  }

  // 5. Sessions WITHOUT cost (would indicate tariff resolution failures)
  console.log("\n── 5. Sessions without cost computation (last 30d) ───────");
  const noCost = await c.query(`
    select count(*)::int total,
           count(*) filter (where cost_inc_vat_minor is null)::int no_cost,
           count(*) filter (where cost_inc_vat_minor = 0)::int zero_cost
      from charging.sessions
     where status = 'completed'
       and ended_at > now() - interval '30 days'
  `);
  const nc = noCost.rows[0];
  console.log(`  completed sessions last 30d:  ${nc.total}`);
  console.log(`    without cost:               ${nc.no_cost}`);
  console.log(`    zero cost:                  ${nc.zero_cost}`);
  if (nc.total > 0) {
    const pctOk = Math.round(((nc.total - nc.no_cost - nc.zero_cost) / nc.total) * 100);
    console.log(`    cost computed:              ${nc.total - nc.no_cost - nc.zero_cost} / ${nc.total}  (${pctOk}%)`);
  }

  // 6. Tariffs in use vs orphans
  console.log("\n── 6. TariffDefinition utilization ────────────────────────");
  const util = await c.query(`
    select td.id, td.display_name,
           (select count(*) from properties.sites where dso_tariff_id = td.id)::int sites_using,
           (select count(*) from properties.installations where retailer_tariff_id = td.id)::int installations_using,
           (select count(*) from assets.charging_stations where chrgrf_tariff_id = td.id)::int stations_using
      from billing.tariff_definitions td
     order by sites_using + installations_using + stations_using desc, td.display_name
  `);
  console.log("  tariff                            sites  installs  stations  used?");
  for (const r of util.rows) {
    const total = r.sites_using + r.installations_using + r.stations_using;
    const used = total > 0 ? "✓" : "✗ ORPHAN";
    console.log(
      `  ${(r.display_name ?? "").padEnd(33)} ${r.sites_using.toString().padStart(5)} ${r.installations_using.toString().padStart(9)} ${r.stations_using.toString().padStart(9)}  ${used}`,
    );
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
