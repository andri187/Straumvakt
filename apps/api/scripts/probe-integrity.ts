#!/usr/bin/env tsx
/**
 * probe-integrity.ts — comprehensive read-only DB integrity audit.
 *
 * Reads ONLY. Writes nothing. Safe to run against any branch.
 *
 * 10 categories:
 *   1. Cross-tenant FK pollution
 *   2. Orphan FK references (constraint coverage)
 *   3. NULL fields that shouldn't be NULL
 *   4. Charger physical chain (Station → EVSE → Connector)
 *   5. Tariff anchor coverage
 *   6. OCPP identity ↔ ChargingStation wiring
 *   7. IdToken ↔ User mapping
 *   8. Membership graph integrity
 *   9. Session ledger integrity
 *  10. Recent additions still valid
 *
 * Sprint 9 — DB integrity audit (AUD-1)
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const SEP = "═══════════════════════════════════════════════════════════════════════";
const SUB = "───────────────────────────────────────────────────────────────────────";

// ─── Counters ────────────────────────────────────────────────────────────────
let criticalCount = 0;
let failCount = 0;
let warnCount = 0;
let passCount = 0;

function pass(label: string, detail: string) {
  passCount++;
  console.log(`   PASS  ${label.padEnd(58)} ${detail}`);
}

function warn(label: string, detail: string) {
  warnCount++;
  console.log(`   WARN  ${label.padEnd(58)} ${detail}`);
}

function fail(label: string, detail: string) {
  failCount++;
  console.log(`   FAIL  ${label.padEnd(58)} ${detail}`);
}

function critical(label: string, detail: string) {
  criticalCount++;
  failCount++;
  console.log(`   CRIT  ${label.padEnd(58)} ${detail}`);
}

// ─── Helper: safe query that returns [] on error ──────────────────────────────
async function q(c: Client, sql: string, params: any[] = []) {
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } catch (e: any) {
    console.log(`         (query error: ${e.message.split("\n")[0]})`);
    return null;
  }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log("  DB INTEGRITY AUDIT — Straumvakt staging  (AUD-1 / 2026-05-31)");
  console.log(`${SEP}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Cross-tenant FK pollution
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("┌─ 1. Cross-tenant FK pollution");
  console.log(SUB);

  // 1a. sites.dso_tariff_id → billing.tariff_definitions
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where s.org_id = t.org_id)::int as same_org,
             count(*) filter (where s.org_id != t.org_id)::int as cross_org
        from properties.sites s
        join billing.tariff_definitions t on t.id = s.dso_tariff_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.cross_org > 0) {
        critical("sites.dso_tariff_id → tariff_definitions", `${r.cross_org} CROSS-ORG FK pollution (${r.total} wired)`);
        const bad = await q(c, `
          select s.id as site_id, s.org_id as site_org, t.id as tariff_id, t.org_id as tariff_org
            from properties.sites s join billing.tariff_definitions t on t.id = s.dso_tariff_id
           where s.org_id != t.org_id
        `);
        if (bad) for (const b of bad) console.log(`         site=${b.site_id} (org=${b.site_org}) → tariff=${b.tariff_id} (org=${b.tariff_org})`);
      } else {
        pass("sites.dso_tariff_id → tariff_definitions", `${r.same_org}/${r.total} wired rows same-org`);
      }
    }
  }

  // 1b. installations.retailer_tariff_id → billing.tariff_definitions
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where i.org_id = t.org_id)::int as same_org,
             count(*) filter (where i.org_id != t.org_id)::int as cross_org
        from properties.installations i
        join billing.tariff_definitions t on t.id = i.retailer_tariff_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.cross_org > 0) {
        critical("installations.retailer_tariff_id → tariff_definitions", `${r.cross_org} CROSS-ORG FK pollution (${r.total} wired)`);
      } else {
        pass("installations.retailer_tariff_id → tariff_definitions", `${r.same_org}/${r.total} wired rows same-org`);
      }
    }
  }

  // 1c. charging_stations.chrgrf_tariff_id → billing.tariff_definitions
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where cs.org_id = t.org_id)::int as same_org,
             count(*) filter (where cs.org_id != t.org_id)::int as cross_org
        from assets.charging_stations cs
        join billing.tariff_definitions t on t.id = cs.chrgrf_tariff_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.total === 0) {
        pass("charging_stations.chrgrf_tariff_id → tariff_definitions", "0 wired (all NULL — acceptable per design)");
      } else if (r.cross_org > 0) {
        critical("charging_stations.chrgrf_tariff_id → tariff_definitions", `${r.cross_org} CROSS-ORG FK pollution`);
      } else {
        pass("charging_stations.chrgrf_tariff_id → tariff_definitions", `${r.same_org}/${r.total} wired rows same-org`);
      }
    }
  }

  // 1d. charging_stations.installation_id → properties.installations (same org)
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where cs.org_id = i.org_id)::int as same_org,
             count(*) filter (where cs.org_id != i.org_id)::int as cross_org
        from assets.charging_stations cs
        join properties.installations i on i.id = cs.installation_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.cross_org > 0) {
        critical("charging_stations.installation_id → installations", `${r.cross_org} CROSS-ORG FK pollution (${r.total} wired)`);
        const bad = await q(c, `
          select cs.site_asset_id, cs.org_id as cs_org, i.id as inst_id, i.org_id as inst_org
            from assets.charging_stations cs join properties.installations i on i.id = cs.installation_id
           where cs.org_id != i.org_id limit 10
        `);
        if (bad) for (const b of bad) console.log(`         cs=${b.site_asset_id} (org=${b.cs_org}) → inst=${b.inst_id} (org=${b.inst_org})`);
      } else {
        pass("charging_stations.installation_id → installations", `${r.same_org}/${r.total} wired rows same-org`);
      }
    }
  }

  // 1e. installations.site_id → properties.sites (same org)
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where i.org_id = s.org_id)::int as same_org,
             count(*) filter (where i.org_id != s.org_id)::int as cross_org
        from properties.installations i
        join properties.sites s on s.id = i.site_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.cross_org > 0) {
        critical("installations.site_id → sites", `${r.cross_org} CROSS-ORG FK pollution`);
      } else {
        pass("installations.site_id → sites", `${r.same_org}/${r.total} rows same-org`);
      }
    }
  }

  // 1f. agreements.counterparty_org_id and cpo_org_id → valid orgs
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where co.id is null)::int as missing_counterparty,
             count(*) filter (where a.cpo_org_id is not null and cpo.id is null)::int as missing_cpo
        from agreements.agreements a
        left join tenancy.organizations co on co.id = a.counterparty_org_id
        left join tenancy.organizations cpo on cpo.id = a.cpo_org_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.missing_counterparty > 0 || r.missing_cpo > 0) {
        critical("agreements.counterparty_org_id / cpo_org_id → orgs", `missing_counterparty=${r.missing_counterparty} missing_cpo=${r.missing_cpo}`);
      } else {
        pass("agreements.counterparty_org_id / cpo_org_id → orgs", `${r.total} agreements, all org refs valid`);
      }
    }
  }

  // 1g. agreements.installation_id → properties.installations
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where a.installation_id is not null and i.id is null)::int as dangling
        from agreements.agreements a
        left join properties.installations i on i.id = a.installation_id
    `);
    if (rows) {
      const r = rows[0];
      const wiredCount = (await q(c, `select count(*) filter (where installation_id is not null)::int as n from agreements.agreements`))![0].n;
      if (r.dangling > 0) {
        critical("agreements.installation_id → installations", `${r.dangling} dangling (no matching installation)`);
      } else {
        pass("agreements.installation_id → installations", `${wiredCount} wired, 0 dangling`);
      }
    }
  }

  // 1h. driver_groups.owner_org_id → tenancy.organizations
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where o.id is null)::int as dangling
        from agreements.driver_groups dg
        left join tenancy.organizations o on o.id = dg.owner_org_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.dangling > 0) {
        critical("driver_groups.owner_org_id → organizations", `${r.dangling} dangling`);
      } else {
        pass("driver_groups.owner_org_id → organizations", `${r.total} groups, all owner_org valid`);
      }
    }
  }

  // 1i. driver_groups.agreement_id → agreements.agreements
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where a.id is null)::int as dangling
        from agreements.driver_groups dg
        left join agreements.agreements a on a.id = dg.agreement_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.dangling > 0) {
        critical("driver_groups.agreement_id → agreements", `${r.dangling} ORPHAN groups (no agreement)`);
      } else {
        pass("driver_groups.agreement_id → agreements", `${r.total} groups, all agreement refs valid`);
      }
    }
  }

  // 1j. driver_group_memberships.user_id → identity.users
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where u.id is null)::int as dangling
        from agreements.driver_group_memberships m
        left join identity.users u on u.id = m.user_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.dangling > 0) {
        critical("driver_group_memberships.user_id → identity.users", `${r.dangling} dangling (ghost memberships)`);
      } else {
        pass("driver_group_memberships.user_id → identity.users", `${r.total} memberships, all user refs valid`);
      }
    }
  }

  // 1k. driver_group_memberships.driver_group_id → driver_groups
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where dg.id is null)::int as dangling
        from agreements.driver_group_memberships m
        left join agreements.driver_groups dg on dg.id = m.driver_group_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.dangling > 0) {
        critical("driver_group_memberships.driver_group_id → driver_groups", `${r.dangling} dangling`);
      } else {
        pass("driver_group_memberships.driver_group_id → driver_groups", `${r.total} memberships, all group refs valid`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Orphan FK references (constraint coverage)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 2. Orphan FK references / constraint coverage`);
  console.log(SUB);

  {
    // Count FK constraints across relevant schemas
    const fkRows = await q(c, `
      select tc.constraint_schema, tc.table_name, tc.constraint_name,
             kcu.column_name,
             ccu.table_schema as foreign_table_schema,
             ccu.table_name as foreign_table_name,
             ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.constraint_schema = kcu.constraint_schema
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
         and tc.constraint_schema = ccu.constraint_schema
       where tc.constraint_type = 'FOREIGN KEY'
         and tc.constraint_schema in ('properties','assets','ocpp','agreements','billing','charging','reports','tenancy','identity','people')
       order by tc.constraint_schema, tc.table_name, kcu.column_name
    `);
    if (fkRows) {
      pass("FK constraints enumerated", `${fkRows.length} FK constraints in relevant schemas`);

      // Spot-check: are there any FK columns that lack constraints?
      // Known NK columns that should have FK constraints but might not:
      // We verify a few key ones are present
      const expectedFKs = [
        { schema: "properties", table: "sites", col: "dso_tariff_id" },
        { schema: "properties", table: "installations", col: "retailer_tariff_id" },
        { schema: "assets", table: "charging_stations", col: "installation_id" },
        { schema: "ocpp", table: "ocpp_identities", col: "charging_station_id" },
        { schema: "agreements", table: "driver_groups", col: "agreement_id" },
        { schema: "agreements", table: "driver_group_memberships", col: "user_id" },
      ];
      let missingConstraints = 0;
      for (const exp of expectedFKs) {
        const found = fkRows.some(r =>
          r.constraint_schema === exp.schema &&
          r.table_name === exp.table &&
          r.column_name === exp.col
        );
        if (!found) {
          warn(`Missing FK constraint: ${exp.schema}.${exp.table}.${exp.col}`, "No FK constraint enforcing referential integrity");
          missingConstraints++;
        }
      }
      if (missingConstraints === 0) {
        pass("Key FK constraints all present", `All ${expectedFKs.length} spot-checked FK constraints enforced`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. NULL fields that shouldn't be NULL
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 3. NULL fields that shouldn't be NULL`);
  console.log(SUB);

  const nullChecks: Array<{ table: string; col: string; label: string }> = [
    { table: "properties.sites",                         col: "org_id",            label: "sites.org_id" },
    { table: "properties.installations",                  col: "site_id",           label: "installations.site_id" },
    { table: "properties.installations",                  col: "org_id",            label: "installations.org_id" },
    { table: "assets.charging_stations",                  col: "installation_id",   label: "charging_stations.installation_id" },
    { table: "assets.charging_stations",                  col: "org_id",            label: "charging_stations.org_id" },
    { table: "ocpp.ocpp_identities",                      col: "charging_station_id", label: "ocpp_identities.charging_station_id" },
    { table: "agreements.agreements",                     col: "counterparty_org_id", label: "agreements.counterparty_org_id" },
    { table: "agreements.driver_groups",                  col: "owner_org_id",      label: "driver_groups.owner_org_id" },
    { table: "agreements.driver_groups",                  col: "agreement_id",      label: "driver_groups.agreement_id" },
    { table: "agreements.driver_group_memberships",       col: "user_id",           label: "driver_group_memberships.user_id" },
    { table: "agreements.driver_group_memberships",       col: "driver_group_id",   label: "driver_group_memberships.driver_group_id" },
  ];

  for (const chk of nullChecks) {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where ${chk.col} is null)::int as nulls
        from ${chk.table}
    `);
    if (rows) {
      const r = rows[0];
      if (r.nulls > 0) {
        fail(chk.label, `${r.nulls} NULL out of ${r.total} rows`);
      } else {
        pass(chk.label, `${r.total} rows, 0 NULL`);
      }
    }
  }

  // Special: charging_stations with NULL installation_id get a WARN not FAIL
  // (some may legitimately not be assigned yet — just flag)
  {
    const rows = await q(c, `
      select count(*)::int as total, count(*) filter (where installation_id is null)::int as unassigned
        from assets.charging_stations
    `);
    if (rows) {
      const r = rows[0];
      if (r.unassigned > 0) {
        warn("charging_stations without installation_id", `${r.unassigned}/${r.total} have NULL installation_id`);
      }
      // (already covered by nullChecks above — this is a more visible warning)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Physical charger chain (Station → EVSE → Connector)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 4. Physical charger chain (Station → EVSE → Connector)`);
  console.log(SUB);

  // 4a. Stations with zero EVSEs
  {
    const rows = await q(c, `
      select count(*)::int as total_stations,
             count(*) filter (where evse_count = 0)::int as no_evse
        from (
          select cs.site_asset_id,
                 (select count(*)::int from assets.evses e where e.charging_station_id = cs.site_asset_id) as evse_count
            from assets.charging_stations cs
        ) sub
    `);
    if (rows) {
      const r = rows[0];
      if (r.no_evse > 0) {
        warn("charging_stations without EVSEs", `${r.no_evse}/${r.total_stations} stations have no EVSE rows`);
        // List offenders (first 5)
        const bad = await q(c, `
          select cs.site_asset_id, sa.display_name
            from assets.charging_stations cs
            join properties.site_assets sa on sa.id = cs.site_asset_id
           where not exists (select 1 from assets.evses e where e.charging_station_id = cs.site_asset_id)
           limit 5
        `);
        if (bad) for (const b of bad) console.log(`         station_id=${b.site_asset_id} name=${b.display_name}`);
      } else {
        pass("All charging_stations have at least 1 EVSE", `${r.total_stations} stations, 0 without EVSE`);
      }
    }
  }

  // 4b. EVSEs with zero Connectors
  {
    const rows = await q(c, `
      select count(*)::int as total_evses,
             count(*) filter (where conn_count = 0)::int as no_connector
        from (
          select e.id,
                 (select count(*)::int from assets.connectors co where co.evse_id = e.id) as conn_count
            from assets.evses e
        ) sub
    `);
    if (rows) {
      const r = rows[0];
      if (r.no_connector > 0) {
        warn("EVSEs without Connectors", `${r.no_connector}/${r.total_evses} EVSEs have no connector rows`);
      } else {
        pass("All EVSEs have at least 1 Connector", `${r.total_evses} EVSEs, 0 without connector`);
      }
    }
  }

  // 4c. Connector.evse_id resolves to EVSE belonging to same ChargingStation
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where co.org_id != e.org_id)::int as org_mismatch
        from assets.connectors co
        join assets.evses e on e.id = co.evse_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.org_mismatch > 0) {
        critical("Connectors with org_id mismatch vs parent EVSE", `${r.org_mismatch} cross-org connector→EVSE pairs`);
      } else {
        pass("Connector.org_id matches parent EVSE.org_id", `${r.total} connectors, 0 org mismatches`);
      }
    }
  }

  // 4d. ChargingStation.installation_id → Installation.site_id sanity
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where site_id_mismatch)::int as bad
        from (
          select cs.site_asset_id,
                 sa.site_id as sa_site_id,
                 i.site_id as inst_site_id,
                 (sa.site_id is distinct from i.site_id) as site_id_mismatch
            from assets.charging_stations cs
            join properties.site_assets sa on sa.id = cs.site_asset_id
            join properties.installations i on i.id = cs.installation_id
           where cs.installation_id is not null
        ) sub
    `);
    if (rows) {
      const r = rows[0];
      if (r.bad > 0) {
        critical("ChargingStation site vs Installation site mismatch", `${r.bad}/${r.total} stations disagree on site`);
      } else {
        pass("ChargingStation site matches Installation site", `${r.total} wired stations consistent`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Tariff anchor coverage
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 5. Tariff anchor coverage`);
  console.log(SUB);

  {
    const rows = await q(c, `
      select o.display_name as org,
             s.display_name as site,
             s.id as site_id,
             dso.display_name as dso_tariff,
             dso.status as dso_status,
             i.display_name as installation,
             i.id as inst_id,
             ret.display_name as retailer_tariff,
             ret.status as retailer_status
        from properties.sites s
        join tenancy.organizations o on o.id = s.org_id
        join properties.installations i on i.site_id = s.id
        left join billing.tariff_definitions dso on dso.id = s.dso_tariff_id
        left join billing.tariff_definitions ret on ret.id = i.retailer_tariff_id
       order by o.display_name, s.display_name
    `);
    if (rows) {
      let missingDso = 0, missingRet = 0, retiredDso = 0, retiredRet = 0;
      console.log(`       org              site                installation         dso_tariff           dso_status  retailer_tariff         ret_status`);
      for (const r of rows) {
        const dsoBadge = r.dso_tariff ? (r.dso_status === 'active' ? '' : ' ← RETIRED') : ' ← MISSING';
        const retBadge = r.retailer_tariff ? (r.retailer_status === 'active' ? '' : ' ← RETIRED') : ' ← MISSING';
        console.log(`       ${(r.org ?? "").padEnd(16)} ${(r.site ?? "").padEnd(19)} ${(r.installation ?? "").padEnd(20)} ${(r.dso_tariff ?? "(none)").padEnd(20)} ${(r.dso_status ?? "n/a").padEnd(11)} ${(r.retailer_tariff ?? "(none)").padEnd(23)} ${(r.retailer_status ?? "n/a")}${dsoBadge}${retBadge}`);
        if (!r.dso_tariff) missingDso++;
        if (!r.retailer_tariff) missingRet++;
        if (r.dso_tariff && r.dso_status !== 'active') retiredDso++;
        if (r.retailer_tariff && r.retailer_status !== 'active') retiredRet++;
      }
      console.log("");
      if (missingDso > 0) warn("DSO tariff anchor", `${missingDso} installations missing site.dso_tariff_id`);
      else pass("DSO tariff anchor", `All installations have dso_tariff_id`);

      if (missingRet > 0) warn("Retailer tariff anchor", `${missingRet} installations missing retailer_tariff_id`);
      else pass("Retailer tariff anchor", `All installations have retailer_tariff_id`);

      if (retiredDso > 0) fail("DSO tariff status", `${retiredDso} installations reference non-active DSO tariff`);
      else pass("DSO tariff status", `All referenced DSO tariffs are active`);

      if (retiredRet > 0) fail("Retailer tariff status", `${retiredRet} installations reference non-active retailer tariff`);
      else pass("Retailer tariff status", `All referenced retailer tariffs are active`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. OCPP identity ↔ ChargingStation wiring
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 6. OCPP identity ↔ ChargingStation wiring`);
  console.log(SUB);

  // 6a. OcppIdentity with null charging_station_id (shouldn't exist — column NOT NULL in schema)
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where charging_station_id is null)::int as unbound
        from ocpp.ocpp_identities
    `);
    if (rows) {
      const r = rows[0];
      if (r.unbound > 0) {
        critical("ocpp_identities.charging_station_id", `${r.unbound} identities not bound to a charging station`);
      } else {
        pass("ocpp_identities.charging_station_id", `${r.total} identities, all bound to stations`);
      }
    }
  }

  // 6b. Stations with zero OcppIdentities
  {
    const rows = await q(c, `
      select count(*)::int as total_stations,
             count(*) filter (where ocpp_count = 0)::int as no_ocpp
        from (
          select cs.site_asset_id,
                 (select count(*)::int from ocpp.ocpp_identities oi where oi.charging_station_id = cs.site_asset_id) as ocpp_count
            from assets.charging_stations cs
        ) sub
    `);
    if (rows) {
      const r = rows[0];
      if (r.no_ocpp > 0) {
        warn("Stations without OcppIdentity", `${r.no_ocpp}/${r.total_stations} stations have no OCPP identity (non-OCPP or unprovisioned)`);
      } else {
        pass("All stations have OcppIdentity", `${r.total_stations} stations, all have at least 1 OCPP identity`);
      }
    }
  }

  // 6c. Duplicate identity_string per org (should be unique — but check anyway)
  {
    const rows = await q(c, `
      select count(*)::int as duplicates
        from (
          select org_id, identity_string, count(*) as n
            from ocpp.ocpp_identities
           group by org_id, identity_string
          having count(*) > 1
        ) dups
    `);
    if (rows) {
      const r = rows[0];
      if (r.duplicates > 0) {
        fail("OcppIdentity identity_string uniqueness (per org)", `${r.duplicates} duplicate (org_id, identity_string) pairs`);
      } else {
        pass("OcppIdentity identity_string uniqueness (per org)", "0 duplicates");
      }
    }
  }

  // 6d. Identities without auth_secret_hash (no-auth setup — expected for Dalvegur, flag others)
  {
    const rows = await q(c, `
      select oi.id, oi.identity_string, oi.org_id,
             o.display_name as org_name,
             i.display_name as installation_name,
             cs.site_asset_id
        from ocpp.ocpp_identities oi
        left join tenancy.organizations o on o.id = oi.org_id
        left join assets.charging_stations cs on cs.site_asset_id = oi.charging_station_id
        left join properties.installations i on i.id = cs.installation_id
       where oi.auth_secret_hash is null
    `);
    if (rows) {
      if (rows.length === 0) {
        pass("OcppIdentity auth_secret_hash", "All identities have auth_secret_hash");
      } else {
        warn("OcppIdentity auth_secret_hash NULL", `${rows.length} identities with NULL auth_secret_hash (no-auth mode)`);
        for (const r of rows) {
          console.log(`         id=${r.id} identity=${r.identity_string} org=${r.org_name} install=${r.installation_name}`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. IdToken ↔ User mapping
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 7. IdToken ↔ User mapping`);
  console.log(SUB);

  // 7a. IdTokens with no matching User
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where u.id is null)::int as orphan
        from identity.id_tokens it
        left join identity.users u on u.id = it.user_id
    `);
    if (rows) {
      const r = rows[0];
      if (r.orphan > 0) {
        critical("id_tokens.user_id → identity.users", `${r.orphan} IdTokens with dangling user_id`);
      } else {
        pass("id_tokens.user_id → identity.users", `${r.total} tokens, all user refs valid`);
      }
    }
  }

  // 7b. Active IdTokens with null user_id (schema has NOT NULL but verify)
  {
    const rows = await q(c, `
      select count(*)::int as total,
             count(*) filter (where user_id is null)::int as null_user
        from identity.id_tokens
       where status = 'active'
    `);
    if (rows) {
      const r = rows[0];
      if (r.null_user > 0) {
        critical("Active IdToken with NULL user_id", `${r.null_user} active tokens have no user`);
      } else {
        pass("Active IdTokens all have user_id", `${r.total} active tokens`);
      }
    }
  }

  // 7c. Users with no IdToken (informational)
  {
    const rows = await q(c, `
      select u.id, u.email, u.audience, u.status
        from identity.users u
       where not exists (select 1 from identity.id_tokens it where it.user_id = u.id)
         and u.status = 'active'
         and u.audience = 'driver'
       order by u.email
    `);
    if (rows) {
      if (rows.length === 0) {
        pass("Active driver Users all have IdTokens", "0 active drivers without an IdToken");
      } else {
        warn("Active driver Users without IdToken", `${rows.length} driver(s) have no IdToken (cannot charge)`);
        for (const r of rows) console.log(`         user_id=${r.id} email=${r.email}`);
      }
    }
  }

  // 7d. EE43C609263CC7 (Dalvegur default tag) mapped to a user?
  {
    const rows = await q(c, `
      select it.id, it.value, it.status, it.user_id,
             u.email, u.display_name
        from identity.id_tokens it
        left join identity.users u on u.id = it.user_id
       where upper(it.value) = 'EE43C609263CC7'
    `);
    if (rows) {
      if (rows.length === 0) {
        warn("Dalvegur default tag EE43C609263CC7", "NOT FOUND in id_tokens — Authorize requests will fail");
      } else {
        const r = rows[0];
        if (!r.user_id) {
          warn("Dalvegur default tag EE43C609263CC7", `Found but user_id=NULL — not attributed to any driver`);
        } else if (r.status !== 'active') {
          warn("Dalvegur default tag EE43C609263CC7", `Found but status=${r.status} — Authorize will reject`);
        } else {
          pass("Dalvegur default tag EE43C609263CC7", `active, mapped to ${r.email ?? r.display_name ?? r.user_id}`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Membership graph integrity
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 8. Membership graph integrity`);
  console.log(SUB);

  // 8a. Full chain: DriverGroupMembership → DriverGroup → Agreement → Installation
  {
    const rows = await q(c, `
      select dgm.id as membership_id,
             u.email as user_email,
             dg.id as group_id,
             dg.display_name as group_name,
             a.id as agreement_id,
             a.agreement_type,
             a.status as agreement_status,
             i.id as installation_id,
             i.display_name as installation_name
        from agreements.driver_group_memberships dgm
        left join identity.users u on u.id = dgm.user_id
        left join agreements.driver_groups dg on dg.id = dgm.driver_group_id
        left join agreements.agreements a on a.id = dg.agreement_id
        left join properties.installations i on i.id = a.installation_id
       order by dg.display_name, u.email
    `);
    if (rows) {
      let chainBreaks = 0;
      console.log(`       membership_id                          user_email               group_name                   agmt_status  install`);
      for (const r of rows) {
        const instLabel = r.installation_name ?? (r.agreement_type === 'installation' ? '(MISSING!)' : 'n/a (not install-type)');
        const broken = (!r.group_id || !r.agreement_id || (r.agreement_type === 'installation' && !r.installation_id));
        if (broken) chainBreaks++;
        const flag = broken ? " ← BROKEN" : "";
        console.log(`       ${(r.membership_id ?? "").padEnd(38)} ${(r.user_email ?? "(no user)").padEnd(24)} ${(r.group_name ?? "(no group)").padEnd(28)} ${(r.agreement_status ?? "n/a").padEnd(12)} ${instLabel}${flag}`);
      }
      console.log("");
      if (chainBreaks > 0) {
        fail("Membership → DriverGroup → Agreement chain", `${chainBreaks} memberships have broken chain`);
      } else {
        pass("Membership → DriverGroup → Agreement chain", `${rows.length} memberships, full chain intact`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Session ledger integrity
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 9. Session ledger integrity`);
  console.log(SUB);

  // 9a. Summary stats
  {
    const rows = await q(c, `
      select count(*)::int as total_30d,
             count(*) filter (where cost_isk_minor is not null)::int as priced,
             count(*) filter (where cost_isk_minor is null)::int as unpriced,
             count(*) filter (where cost_isk_minor < 0)::int as negative_cost,
             count(*) filter (where cost_isk_minor = 0)::int as zero_cost,
             count(*) filter (where cost_isk_minor > 0)::int as positive_cost,
             count(*) filter (where tariff_definition_id is null and cost_isk_minor is not null)::int as priced_no_tariff_ref
        from reports.session_ledger
       where stopped_at > now() - interval '30 days'
    `);
    if (rows) {
      const r = rows[0];
      const pct = r.total_30d > 0 ? Math.round((r.priced / r.total_30d) * 100) : 0;
      console.log(`       last-30d totals: ${r.total_30d} sessions, ${r.priced} priced (${pct}%), ${r.unpriced} unpriced`);

      if (r.negative_cost > 0) {
        fail("Session cost_isk_minor >= 0", `${r.negative_cost} sessions have negative cost`);
      } else {
        pass("Session cost_isk_minor >= 0", "0 negative-cost sessions");
      }

      if (r.zero_cost > 0) {
        warn("Session cost_isk_minor > 0 for priced sessions", `${r.zero_cost} sessions have cost_isk_minor = 0`);
      } else {
        pass("Priced sessions have cost_isk_minor > 0", `${r.positive_cost} sessions all positive`);
      }

      if (r.priced_no_tariff_ref > 0) {
        warn("Priced sessions missing tariff_definition_id", `${r.priced_no_tariff_ref} priced sessions have no tariff_definition_id`);
      } else if (r.priced > 0) {
        pass("Priced sessions have tariff_definition_id", `${r.priced} priced sessions all have tariff ref`);
      }
    }
  }

  // 9b. Completed sessions older than 7d with no stopped_at (zombie sessions)
  {
    const rows = await q(c, `
      select count(*)::int as zombies
        from reports.session_ledger
       where stopped_at is null
         and started_at < now() - interval '7 days'
    `);
    if (rows) {
      const r = rows[0];
      if (r.zombies > 0) {
        fail("No zombie sessions (>7d, stopped_at NULL)", `${r.zombies} sessions older than 7d with stopped_at NULL`);
      } else {
        pass("No zombie sessions (>7d, stopped_at NULL)", "0 zombie sessions");
      }
    }
  }

  // 9c. Sessions with cost but no energy (data quality)
  {
    const rows = await q(c, `
      select count(*)::int as n
        from reports.session_ledger
       where cost_isk_minor is not null
         and cost_isk_minor > 0
         and (energy_kwh is null or energy_kwh = 0)
         and stopped_at > now() - interval '30 days'
    `);
    if (rows) {
      const r = rows[0];
      if (r.n > 0) {
        warn("Priced sessions with 0 energy", `${r.n} sessions have cost > 0 but energy_kwh = 0`);
      } else {
        pass("Priced sessions have energy_kwh > 0", "0 zero-energy priced sessions");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Recent additions still valid
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n┌─ 10. Recent additions still valid`);
  console.log(SUB);

  // 10a. Reykjavík HQ — Site has dso_tariff_id = Veitur AD1
  {
    const rows = await q(c, `
      select s.display_name as site,
             dso.display_name as dso_tariff,
             dso.status as dso_status,
             cf.code as dso_factor_code
        from properties.sites s
        left join billing.tariff_definitions dso on dso.id = s.dso_tariff_id
        left join billing.cost_factors cf on cf.id = dso.cost_factor_id
       where lower(s.display_name) like '%reykjav%'
    `);
    if (rows && rows.length > 0) {
      for (const r of rows) {
        const isVeiturDso = r.dso_tariff && (r.dso_factor_code === 'DSOF' || r.dso_tariff.toLowerCase().includes('veitur'));
        if (isVeiturDso && r.dso_status === 'active') {
          pass(`Reykjavík HQ site.dso_tariff_id`, `${r.dso_tariff} (${r.dso_factor_code}) active`);
        } else {
          warn(`Reykjavík HQ site.dso_tariff_id`, `dso_tariff=${r.dso_tariff ?? "(none)"} status=${r.dso_status ?? "n/a"}`);
        }
      }
    } else {
      warn("Reykjavík HQ site", "No site matching 'reykjav%' found");
    }
  }

  // 10b. Reykjavík HQ — Installation has retailer_tariff_id = N1 retailer
  {
    const rows = await q(c, `
      select i.display_name as installation,
             ret.display_name as retailer_tariff,
             ret.status as ret_status,
             cf.code as ret_factor_code
        from properties.installations i
        join properties.sites s on s.id = i.site_id
        left join billing.tariff_definitions ret on ret.id = i.retailer_tariff_id
        left join billing.cost_factors cf on cf.id = ret.cost_factor_id
       where lower(s.display_name) like '%reykjav%'
    `);
    if (rows && rows.length > 0) {
      for (const r of rows) {
        const isN1Retailer = r.retailer_tariff && (r.ret_factor_code === 'REPF' || r.retailer_tariff.toLowerCase().includes('n1'));
        if (isN1Retailer && r.ret_status === 'active') {
          pass(`Reykjavík HQ installation.retailer_tariff_id`, `${r.retailer_tariff} (${r.ret_factor_code}) active`);
        } else {
          warn(`Reykjavík HQ installation.retailer_tariff_id`, `retailer_tariff=${r.retailer_tariff ?? "(none)"} status=${r.ret_status ?? "n/a"}`);
        }
      }
    } else {
      warn("Reykjavík HQ installation", "No installation for Reykjavík HQ found");
    }
  }

  // 10c. VCP Lab sandbox chain complete
  {
    const rows = await q(c, `
      select s.display_name as site,
             i.display_name as installation,
             ci.display_name as circuit,
             cs.site_asset_id,
             sa.display_name as cs_name,
             (select count(*) from assets.evses e where e.charging_station_id = cs.site_asset_id)::int as evse_count,
             (select count(*) from assets.connectors co
                join assets.evses e2 on e2.id = co.evse_id
               where e2.charging_station_id = cs.site_asset_id)::int as conn_count
        from properties.sites s
        join properties.installations i on i.site_id = s.id
        left join properties.circuits ci on ci.installation_id = i.id
        join assets.charging_stations cs on cs.installation_id = i.id
        join properties.site_assets sa on sa.id = cs.site_asset_id
       where lower(s.display_name) like '%vcp%'
          or lower(i.display_name) like '%vcp%'
       order by s.display_name
    `);
    if (rows && rows.length > 0) {
      let vcpChainOk = true;
      for (const r of rows) {
        if (r.evse_count === 0 || r.conn_count === 0) {
          vcpChainOk = false;
          fail(`VCP Lab station chain`, `station=${r.cs_name} evses=${r.evse_count} connectors=${r.conn_count}`);
        }
      }
      if (vcpChainOk) {
        pass("VCP Lab sandbox chain (Site→Install→Station→EVSE→Connector)", `${rows.length} station(s), chain complete`);
      }
      // Detail
      for (const r of rows) {
        console.log(`         site=${r.site} install=${r.installation} circuit=${r.circuit ?? "(none)"} station=${r.cs_name} evses=${r.evse_count} conns=${r.conn_count}`);
      }
    } else {
      warn("VCP Lab sandbox", "No VCP site/installation found");
    }
  }

  // 10d. N1 driver access — 1 User in driver_group_memberships with active IdToken
  {
    const rows = await q(c, `
      select u.id, u.email, u.audience, u.status as user_status,
             it.value as id_token_value, it.status as token_status,
             dg.display_name as group_name,
             a.agreement_type
        from agreements.driver_group_memberships dgm
        join identity.users u on u.id = dgm.user_id
        join agreements.driver_groups dg on dg.id = dgm.driver_group_id
        join agreements.agreements a on a.id = dg.agreement_id
        left join identity.id_tokens it on it.user_id = u.id and it.status = 'active'
       order by u.email
    `);
    if (rows && rows.length > 0) {
      let driverOk = 0;
      for (const r of rows) {
        if (r.token_status === 'active') driverOk++;
      }
      if (driverOk > 0) {
        pass("N1 driver(s) with active IdToken in DriverGroup", `${driverOk}/${rows.length} driver group member(s) have active IdToken`);
      } else {
        warn("N1 driver(s) with active IdToken", `${rows.length} member(s) but 0 have active IdToken`);
      }
      for (const r of rows) {
        console.log(`         user=${r.email} audience=${r.audience} token=${r.id_token_value ?? "(none)"} token_status=${r.token_status ?? "n/a"} group=${r.group_name}`);
      }
    } else {
      warn("N1 driver DriverGroupMembership", "No driver group memberships found");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADLINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${SEP}`);
  console.log("  HEADLINE SUMMARY");
  console.log(SUB);
  console.log(`   CRITICAL findings:  ${criticalCount}`);
  console.log(`   FAIL findings:      ${failCount - criticalCount}`);
  console.log(`   WARN findings:      ${warnCount}`);
  console.log(`   PASS:               ${passCount}`);
  console.log(SEP);
  console.log("");

  if (criticalCount > 0) {
    console.log("  !! CRITICAL issues require immediate attention:");
    console.log("     Cross-tenant FK pollution or broken chain can cause data leaks / mis-billing.");
  } else if (failCount > 0) {
    console.log("  Failures found — review FAIL lines above and remediate.");
  } else if (warnCount > 0) {
    console.log("  No failures. Warnings are informational or known acceptable conditions.");
  } else {
    console.log("  Clean audit — no failures or warnings.");
  }

  console.log(`\n${SEP}\n`);

  await c.end();
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
