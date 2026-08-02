#!/usr/bin/env tsx
/**
 * probe-billing-cutover.ts — exhaustive snapshot of the dual billing model.
 *
 * Reads ONLY. Writes nothing. Safe to run against any branch.
 *
 * Purpose: drive the agreements.* / billing.* cutover plan. Surface what's
 * in each schema, what's wired to what at session-stop, where the catalogs
 * diverge, and which installations need migration. Output goes to stdout
 * formatted for chat.
 *
 * Sprint 9 — cutover step 1 (per ADR 0019 §2026-05-31 addendum and the
 * 2026-05-31 cutover-conversation).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const SEP = "═══════════════════════════════════════════════════════════════════";
const SUB = "──────────────────────────────────────────────────────────────────";

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log("  BILLING CUTOVER PROBE — agreements.* vs billing.*");
  console.log(`${SEP}\n`);

  // ─── 1. Schema existence sanity check ─────────────────────────────────────
  console.log("┌─ 1. Schema existence");
  const schemas = await c.query(`
    select schema_name
      from information_schema.schemata
     where schema_name in ('billing', 'agreements', 'properties', 'assets',
                           'tenancy', 'reports', 'charging', 'ocpp')
     order by schema_name
  `);
  for (const r of schemas.rows) console.log(`     ✓ schema ${r.schema_name}`);

  // ─── 2. agreements.* population ──────────────────────────────────────────
  console.log("\n┌─ 2. agreements.* population (the new model)");
  const newTables = [
    "agreements", "agreement_clauses", "bearer_rules", "rate_references",
    "driver_groups", "driver_group_memberships", "billing_lines", "cost_factors",
  ];
  for (const t of newTables) {
    try {
      const r = await c.query(`select count(*)::int as n from agreements.${t}`);
      console.log(`     agreements.${t.padEnd(28)} ${r.rows[0].n.toString().padStart(6)} rows`);
    } catch (e: any) {
      console.log(`     agreements.${t.padEnd(28)} (table missing: ${e.message.split("\n")[0]})`);
    }
  }

  // ─── 3. agreements.cost_factors catalogue ────────────────────────────────
  console.log("\n┌─ 3. agreements.cost_factors (the new 15-code catalogue)");
  try {
    const newCat = await c.query(`
      select code, display_name_en, display_name_is, anchor_tier, status
        from agreements.cost_factors
       order by code
    `);
    if (newCat.rowCount === 0) {
      console.log("     (empty — agreements.cost_factors not yet seeded)");
    } else {
      console.log(`     code        anchor_tier      status     display_name_en`);
      for (const r of newCat.rows) {
        console.log(`     ${(r.code ?? "").padEnd(11)} ${(r.anchor_tier ?? "").padEnd(16)} ${(r.status ?? "").padEnd(10)} ${r.display_name_en ?? r.display_name_is ?? ""}`);
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── 4. billing.* legacy population ──────────────────────────────────────
  console.log("\n┌─ 4. billing.* population (the legacy model — what actually runs today)");
  const legacyTables = [
    "tariff_definitions", "cost_factors", "cost_centers",
    "contracts", "contract_factor_assignments",
    "driver_contracts", "driver_contract_factor_overrides",
    "contract_period_accumulators",
  ];
  for (const t of legacyTables) {
    try {
      const r = await c.query(`select count(*)::int as n from billing.${t}`);
      console.log(`     billing.${t.padEnd(38)} ${r.rows[0].n.toString().padStart(6)} rows`);
    } catch (e: any) {
      console.log(`     billing.${t.padEnd(38)} (table missing: ${e.message.split("\n")[0]})`);
    }
  }

  // ─── 5. billing.cost_factors catalogue ───────────────────────────────────
  console.log("\n┌─ 5. billing.cost_factors (the legacy catalogue)");
  try {
    const legCat = await c.query(`
      select code, display_name, status
        from billing.cost_factors
       order by code
    `);
    if (legCat.rowCount === 0) {
      console.log("     (empty)");
    } else {
      console.log(`     code        status     display_name`);
      for (const r of legCat.rows) {
        console.log(`     ${(r.code ?? "").padEnd(11)} ${(r.status ?? "").padEnd(10)} ${r.display_name ?? ""}`);
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── 6. billing.tariff_definitions per org ───────────────────────────────
  console.log("\n┌─ 6. billing.tariff_definitions per org");
  try {
    const tdef = await c.query(`
      select o.display_name as org,
             td.display_name as tariff,
             td.status,
             td.currency,
             td.vat_rate_pct,
             td.compute_rule->>'kind' as rule_kind,
             cf.code as cost_factor_code,
             (select count(*) from properties.sites where dso_tariff_id = td.id)::int as sites_using,
             (select count(*) from properties.installations where retailer_tariff_id = td.id)::int as installs_using,
             coalesce(
               (select count(*) from assets.charging_stations where chrgrf_tariff_id = td.id)::int,
               0
             ) as stations_using
        from billing.tariff_definitions td
        left join tenancy.organizations o on o.id = td.org_id
        left join billing.cost_factors cf on cf.id = td.cost_factor_id
       order by o.display_name, td.display_name
    `);
    if (tdef.rowCount === 0) {
      console.log("     (no tariff definitions)");
    } else {
      console.log(`     org              tariff                      status   factor    sites  inst  stns`);
      for (const r of tdef.rows) {
        const used = (r.sites_using ?? 0) + (r.installs_using ?? 0) + (r.stations_using ?? 0);
        const flag = used === 0 ? "  ← ORPHAN" : "";
        console.log(`     ${(r.org ?? "").padEnd(16)} ${(r.tariff ?? "").padEnd(27)} ${(r.status ?? "").padEnd(8)} ${(r.cost_factor_code ?? "").padEnd(9)} ${(r.sites_using ?? 0).toString().padStart(5)} ${(r.installs_using ?? 0).toString().padStart(5)} ${(r.stations_using ?? 0).toString().padStart(5)}${flag}`);
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── 7. FK pointers — what wire-up the resolver walks ─────────────────────
  console.log("\n┌─ 7. FK pointers to legacy tariffs (resolver walk inputs)");
  try {
    const sites = await c.query(`
      select count(*) filter (where dso_tariff_id is not null)::int as wired,
             count(*) filter (where dso_tariff_id is null)::int as unwired,
             count(*)::int as total
        from properties.sites
    `);
    const sr = sites.rows[0];
    console.log(`     sites.dso_tariff_id           wired=${sr.wired} unwired=${sr.unwired} total=${sr.total}`);
  } catch (e: any) { console.log(`     sites: ${e.message.split("\n")[0]}`); }

  try {
    const inst = await c.query(`
      select count(*) filter (where retailer_tariff_id is not null)::int as wired,
             count(*) filter (where retailer_tariff_id is null)::int as unwired,
             count(*)::int as total
        from properties.installations
    `);
    const ir = inst.rows[0];
    console.log(`     installations.retailer_tariff wired=${ir.wired} unwired=${ir.unwired} total=${ir.total}`);
  } catch (e: any) { console.log(`     installations: ${e.message.split("\n")[0]}`); }

  try {
    const stn = await c.query(`
      select count(*) filter (where chrgrf_tariff_id is not null)::int as wired,
             count(*) filter (where chrgrf_tariff_id is null)::int as unwired,
             count(*)::int as total
        from assets.charging_stations
    `);
    const sr = stn.rows[0];
    console.log(`     charging_stations.chrgrf      wired=${sr.wired} unwired=${sr.unwired} total=${sr.total}`);
  } catch (e: any) { console.log(`     charging_stations: ${e.message.split("\n")[0]}`); }

  // ─── 8. reports.session_ledger — what the resolver has produced ──────────
  console.log("\n┌─ 8. reports.session_ledger — resolver output");
  try {
    const lit = await c.query(`
      select count(*)::int as total_30d,
             count(*) filter (where cost_isk_minor is not null)::int as priced_30d,
             count(*) filter (where cost_isk_minor is null)::int as unpriced_30d,
             count(*) filter (where stopped_at > now() - interval '30 days')::int as completed_30d
        from reports.session_ledger
       where stopped_at > now() - interval '30 days'
    `);
    const l = lit.rows[0];
    const pctPriced = l.total_30d > 0 ? Math.round((l.priced_30d / l.total_30d) * 100) : 0;
    console.log(`     last 30d sessions: ${l.total_30d}  priced: ${l.priced_30d} (${pctPriced}%)  unpriced: ${l.unpriced_30d}`);

    const byTariff = await c.query(`
      select td.display_name as tariff,
             o.display_name as org,
             count(*)::int as sessions,
             sum(sl.cost_isk_minor)::bigint as total_cost_minor
        from reports.session_ledger sl
        left join billing.tariff_definitions td on td.id = sl.tariff_definition_id
        left join tenancy.organizations o on o.id = sl.org_id
       where sl.stopped_at > now() - interval '30 days'
         and sl.tariff_definition_id is not null
       group by td.display_name, o.display_name
       order by sessions desc
    `);
    if (byTariff.rowCount === 0) {
      console.log("     (no priced sessions with tariff_definition_id last 30d)");
    } else {
      console.log(`     tariff_definitions actually resolved against last 30d:`);
      console.log(`       org              tariff                      sessions  total_cost_kr`);
      for (const r of byTariff.rows) {
        const kr = r.total_cost_minor ? (Number(r.total_cost_minor) / 100).toFixed(2) : "—";
        console.log(`       ${(r.org ?? "—").padEnd(16)} ${(r.tariff ?? "—").padEnd(27)} ${r.sessions.toString().padStart(8)}  ${kr.padStart(12)}`);
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── 9. Cost factor catalogue mapping (legacy → new) ─────────────────────
  console.log("\n┌─ 9. Cost-factor code mapping legacy → new (best-guess from ADR 0019)");
  const mapping: Record<string, string> = {
    DSOF: "DSO  (Dreifing)",
    REPF: "ELE  (Rafmagn)",
    USRF: "USRF / ACS (Notendagjald)",
    USRF_PREM: "PRM  (Premium)",
    XTRRF: "TRF_CHG / TRF_IDLE / TRF_PLUG (split)",
    SPVIVF: "SRF  (Þjónustugjald)",
    CHRGRF: "RNT  (Leiga) or part of TRF",
    WRKPF: "WRK  (Vinnan)",
  };
  console.log(`     legacy code   →   new code(s)`);
  for (const [old, fresh] of Object.entries(mapping)) {
    console.log(`     ${old.padEnd(13)} →   ${fresh}`);
  }
  console.log("     (mapping is informational — actual migration walks each TariffDefinition by FK)");

  // ─── 10. Real installations needing migration ────────────────────────────
  console.log("\n┌─ 10. Installations under each org (migration scope per A.10)");
  try {
    const inst = await c.query(`
      select o.display_name as org,
             s.display_name as site,
             i.display_name as installation,
             ds.display_name as dso_tariff,
             rt.display_name as retailer_tariff,
             (select count(*) from assets.charging_stations cs
               where cs.installation_id = i.id)::int as stations
        from properties.installations i
        join properties.sites s on s.id = i.site_id
        join tenancy.organizations o on o.id = i.org_id
        left join billing.tariff_definitions ds on ds.id = s.dso_tariff_id
        left join billing.tariff_definitions rt on rt.id = i.retailer_tariff_id
       order by o.display_name, s.display_name
    `);
    if (inst.rowCount === 0) {
      console.log("     (no installations)");
    } else {
      console.log(`     org              site                installation         dso              retailer            stns`);
      for (const r of inst.rows) {
        console.log(`     ${(r.org ?? "").padEnd(16)} ${(r.site ?? "").padEnd(19)} ${(r.installation ?? "").padEnd(20)} ${(r.dso_tariff ?? "(none)").padEnd(16)} ${(r.retailer_tariff ?? "(none)").padEnd(19)} ${(r.stations ?? 0).toString().padStart(4)}`);
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── 11. Existing DriverGroup + Membership graph (already on new model) ──
  console.log("\n┌─ 11. DriverGroup + Membership graph (already lives in agreements.*)");
  try {
    const dg = await c.query(`
      select count(*)::int as groups,
             (select count(*) from agreements.driver_group_memberships)::int as memberships,
             (select count(distinct user_id) from agreements.driver_group_memberships)::int as users
        from agreements.driver_groups
    `);
    const g = dg.rows[0];
    console.log(`     driver_groups: ${g.groups}  memberships: ${g.memberships}  distinct users: ${g.users}`);

    if (g.groups > 0) {
      const list = await c.query(`
        select dg.display_name as group_name,
               o.display_name as owner_org,
               (select count(*) from agreements.driver_group_memberships m where m.driver_group_id = dg.id)::int as member_count
          from agreements.driver_groups dg
          left join tenancy.organizations o on o.id = dg.owner_org_id
         order by o.display_name, dg.display_name
      `);
      console.log(`       owner_org        group_name                  members`);
      for (const r of list.rows) {
        console.log(`       ${(r.owner_org ?? "—").padEnd(16)} ${(r.group_name ?? "—").padEnd(27)} ${(r.member_count ?? 0).toString().padStart(7)}`);
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── 12. Headline conclusions (computed) ──────────────────────────────────
  console.log(`\n${SUB}`);
  console.log("  HEADLINE READOUT");
  console.log(`${SUB}\n`);

  try {
    const ag = await c.query(`select count(*)::int as n from agreements.agreements`);
    const td = await c.query(`select count(*)::int as n from billing.tariff_definitions`);
    const dg = await c.query(`select count(*)::int as n from agreements.driver_groups`);
    const mb = await c.query(`select count(*)::int as n from agreements.driver_group_memberships`);
    const lit = await c.query(`
      select count(*)::int as n from reports.session_ledger
       where stopped_at > now() - interval '30 days' and cost_isk_minor is not null
    `);

    const aN = ag.rows[0].n;
    const tdN = td.rows[0].n;
    const dgN = dg.rows[0].n;
    const mbN = mb.rows[0].n;
    const litN = lit.rows[0].n;

    console.log(`  • Agreements in agreements.* schema:           ${aN}`);
    console.log(`  • TariffDefinitions in billing.* schema:       ${tdN}  (these resolve sessions today)`);
    console.log(`  • DriverGroups in agreements.* schema:         ${dgN}`);
    console.log(`  • DriverGroup memberships:                     ${mbN}`);
    console.log(`  • Sessions priced via legacy last 30d:         ${litN}`);
    console.log("");

    if (aN === 0 && tdN > 0) {
      console.log("  → Confirms ADR 0019 expected state: agreements.* schema present but empty;");
      console.log("    legacy TariffDefinitions are the only source of pricing today.");
      console.log("    Cutover A.10 scope = create Agreement+Clause+RateReference rows for each");
      console.log("    TariffDefinition currently referenced by at least one site/installation/station.");
    } else if (aN > 0) {
      console.log("  → agreements.* has rows. Migration is partial-overlap; A.10 needs to handle");
      console.log("    both 'create new' and 'reconcile existing' cases.");
    }
  } catch (e: any) {
    console.log(`  (headline computation failed: ${e.message})`);
  }

  console.log(`\n${SEP}\n`);

  await c.end();
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
