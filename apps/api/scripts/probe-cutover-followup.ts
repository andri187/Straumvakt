#!/usr/bin/env tsx
/**
 * probe-cutover-followup.ts — targeted follow-up on three open questions
 * from probe-billing-cutover.ts.
 *
 * Reads ONLY. Writes nothing. Safe to run against any branch.
 *
 * Three questions answered:
 *   Q1. What are the 2 existing agreements.agreements rows?
 *   Q2. What's in agreements.cost_factors? (17 rows, anchor_tier col failed before)
 *   Q3. Duplicate "N1 Drivers" DriverGroup — same user, different users, or orphan?
 *
 * Sprint 9 — cutover probe follow-up (CO-1).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

const SEP = "═══════════════════════════════════════════════════════════════════";
const SUB = "──────────────────────────────────────────────────────────────────";

// Legacy codes from billing.cost_factors (from probe-billing-cutover § 9)
const LEGACY_CODES = ["DSOF", "REPF", "USRF", "USRF_PREM", "XTRRF", "SPVIVF", "CHRGRF", "WRKPF"];

// Pilot-scope codes from apps/api/src/lib/billing/pilot-scope.ts
const PILOT_CODES = ["USRF", "INT", "DSO", "MTR", "ELE", "TRF_CHG", "TRF_IDLE", "TRF_PLUG"];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log("  CUTOVER FOLLOW-UP PROBE — 3 open questions (CO-1)");
  console.log(`${SEP}\n`);

  // ─── Q1. Existing agreements.agreements rows ──────────────────────────────
  console.log("┌─ Q1. Existing agreements.agreements rows");
  console.log(SUB);

  try {
    const agRows = await c.query(`
      select a.id,
             a.agreement_type,
             a.display_name,
             a.status,
             a.counterparty_org_id,
             co.display_name as counterparty_org,
             a.cpo_org_id,
             cpo.display_name as cpo_org,
             a.installation_id,
             i.display_name as installation,
             a.default_driver_group_id,
             a.effective_from,
             a.effective_until,
             a.notes,
             (select count(*) from agreements.agreement_clauses ac where ac.agreement_id = a.id)::int as clause_count,
             (select count(*) from agreements.bearer_rules br where br.agreement_id = a.id)::int as rule_count,
             (select count(*) from agreements.driver_groups dg where dg.agreement_id = a.id)::int as group_count
        from agreements.agreements a
        left join tenancy.organizations co on co.id = a.counterparty_org_id
        left join tenancy.organizations cpo on cpo.id = a.cpo_org_id
        left join properties.installations i on i.id = a.installation_id
       order by a.effective_from
    `);

    if (agRows.rowCount === 0) {
      console.log("     (no rows — agreements.agreements is empty)");
    } else {
      console.log(`     Found ${agRows.rowCount} agreement(s):\n`);
      for (const r of agRows.rows) {
        console.log(`     ── Agreement ${r.id}`);
        console.log(`        agreement_type:    ${r.agreement_type}`);
        console.log(`        display_name:      ${r.display_name ?? "(none)"}`);
        console.log(`        status:            ${r.status}`);
        console.log(`        counterparty_org:  ${r.counterparty_org ?? "(none)"} (id=${r.counterparty_org_id ?? "null"})`);
        console.log(`        cpo_org:           ${r.cpo_org ?? "(none)"} (id=${r.cpo_org_id ?? "null"})`);
        console.log(`        installation:      ${r.installation ?? "(none)"} (id=${r.installation_id ?? "null"})`);
        console.log(`        default_dg_id:     ${r.default_driver_group_id ?? "null"}`);
        console.log(`        effective_from:    ${r.effective_from?.toISOString() ?? "null"}`);
        console.log(`        effective_until:   ${r.effective_until?.toISOString() ?? "(open)"}`);
        console.log(`        notes:             ${r.notes ?? "(none)"}`);
        console.log(`        clauses:           ${r.clause_count}`);
        console.log(`        bearer_rules:      ${r.rule_count}`);
        console.log(`        driver_groups:     ${r.group_count}`);
        console.log("");
      }

      // Also print raw JSON for any fields the SELECT above missed
      console.log("     Raw JSON dump:");
      for (const r of agRows.rows) {
        console.log("     " + JSON.stringify(r, null, 0));
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  // ─── Q2. agreements.cost_factors — discover columns then dump all rows ─────
  console.log(`\n${SUB}`);
  console.log("┌─ Q2. agreements.cost_factors — actual columns + all rows");
  console.log(SUB);

  let actualColumns: string[] = [];
  try {
    const colsResult = await c.query(`
      select column_name, data_type
        from information_schema.columns
       where table_schema = 'agreements'
         and table_name = 'cost_factors'
       order by ordinal_position
    `);

    console.log(`\n     Columns (${colsResult.rowCount}):`);
    console.log(`       ${"column_name".padEnd(30)} data_type`);
    for (const r of colsResult.rows) {
      console.log(`       ${(r.column_name ?? "").padEnd(30)} ${r.data_type}`);
      actualColumns.push(r.column_name as string);
    }
  } catch (e: any) {
    console.log(`     (column discovery failed: ${e.message.split("\n")[0]})`);
  }

  try {
    const cfRows = await c.query(`
      select * from agreements.cost_factors order by code
    `);

    console.log(`\n     All rows (${cfRows.rowCount}):\n`);
    if (cfRows.rowCount === 0) {
      console.log("     (empty)");
    } else {
      // Compact per-row output
      for (const r of cfRows.rows) {
        const compact = Object.entries(r)
          .map(([k, v]) => `${k}=${v === null ? "null" : JSON.stringify(v)}`)
          .join("  ");
        console.log(`     ${compact}`);
      }
    }

    // ── Code overlap analysis ────────────────────────────────────────────────
    const newCodes = cfRows.rows.map((r: any) => r.code as string);

    console.log(`\n     Code overlap analysis:`);
    console.log(`       Legacy codes (billing.cost_factors, 8 codes): ${LEGACY_CODES.join(", ")}`);
    console.log(`       Pilot codes  (pilot-scope.ts, 8 codes):        ${PILOT_CODES.join(", ")}`);
    console.log(`       New codes    (agreements.cost_factors, ${newCodes.length} codes): ${newCodes.join(", ")}`);

    const legacyMissingInNew = LEGACY_CODES.filter((c) => !newCodes.includes(c));
    const pilotMissingInNew = PILOT_CODES.filter((c) => !newCodes.includes(c));
    const newMissingInLegacy = newCodes.filter((c) => !LEGACY_CODES.includes(c));
    const newMissingInPilot = newCodes.filter((c) => !PILOT_CODES.includes(c));

    console.log(`\n       Legacy codes NOT in new catalogue:  ${legacyMissingInNew.length === 0 ? "(none)" : legacyMissingInNew.join(", ")}`);
    console.log(`       Pilot codes  NOT in new catalogue:  ${pilotMissingInNew.length === 0 ? "(none)" : pilotMissingInNew.join(", ")}`);
    console.log(`       New codes    NOT in legacy:          ${newMissingInLegacy.length === 0 ? "(none)" : newMissingInLegacy.join(", ")}`);
    console.log(`       New codes    NOT in pilot-scope.ts:  ${newMissingInPilot.length === 0 ? "(none)" : newMissingInPilot.join(", ")}`);
  } catch (e: any) {
    console.log(`     (cost_factors dump failed: ${e.message.split("\n")[0]})`);
  }

  // ─── Q3. Duplicate DriverGroup investigation ──────────────────────────────
  console.log(`\n${SUB}`);
  console.log("┌─ Q3. Duplicate DriverGroup investigation");
  console.log(SUB);

  try {
    const dgRows = await c.query(`
      select dg.id,
             dg.display_name,
             dg.owner_org_id,
             o.display_name as owner_org,
             dg.agreement_id,
             a.agreement_type,
             dg.created_at,
             (select count(*)::int from agreements.driver_group_memberships m where m.driver_group_id = dg.id) as members,
             (select array_agg(u.email::text) from agreements.driver_group_memberships m
                join identity.users u on u.id = m.user_id
              where m.driver_group_id = dg.id) as member_emails
        from agreements.driver_groups dg
        left join tenancy.organizations o on o.id = dg.owner_org_id
        left join agreements.agreements a on a.id = dg.agreement_id
       order by dg.display_name, dg.created_at
    `);

    if (dgRows.rowCount === 0) {
      console.log("     (no DriverGroups)");
    } else {
      console.log(`\n     All DriverGroups (${dgRows.rowCount}):\n`);
      for (const r of dgRows.rows) {
        console.log(`     ── DriverGroup ${r.id}`);
        console.log(`        display_name:   ${r.display_name}`);
        console.log(`        owner_org:      ${r.owner_org ?? "(none)"} (id=${r.owner_org_id ?? "null"})`);
        console.log(`        agreement_id:   ${r.agreement_id ?? "(ORPHAN — no agreement linkage)"}`);
        console.log(`        agreement_type: ${r.agreement_type ?? "n/a (orphan)"}`);
        console.log(`        created_at:     ${r.created_at?.toISOString() ?? "null"}`);
        console.log(`        members:        ${r.members}`);
        console.log(`        member_emails:  ${r.member_emails ? r.member_emails.join(", ") : "(none)"}`);
        console.log("");
      }

      // Surface duplicate display_names
      const nameGroups: Record<string, typeof dgRows.rows> = {};
      for (const r of dgRows.rows) {
        const key = `${r.display_name}__${r.owner_org_id}`;
        if (!nameGroups[key]) nameGroups[key] = [];
        nameGroups[key].push(r);
      }
      const dups = Object.entries(nameGroups).filter(([, rows]) => rows.length > 1);

      if (dups.length === 0) {
        console.log("     No duplicate (display_name + owner_org) pairs found.");
      } else {
        console.log(`     Duplicate (display_name + owner_org) pairs:\n`);
        for (const [key, rows] of dups) {
          const [name, orgId] = key.split("__");
          console.log(`     display_name="${name}" owner_org_id=${orgId}`);

          const allEmails: string[][] = rows.map((r) => (r.member_emails as string[] | null) ?? []);
          const flatEmails = allEmails.flat();
          const uniqueEmails = [...new Set(flatEmails)];

          const sameUser = flatEmails.length > 0 && uniqueEmails.length === 1 && flatEmails.length === rows.length;
          const differentUsers = uniqueEmails.length > 1;
          const orphans = rows.filter((r) => r.agreement_id === null);

          console.log(`       rows: ${rows.length}`);
          console.log(`       ids:  ${rows.map((r) => r.id).join(", ")}`);
          console.log(
            `       agreement_ids: ${rows.map((r) => r.agreement_id ?? "NULL(orphan)").join(", ")}`,
          );
          console.log(`       member_emails per group: ${allEmails.map((e) => e.join("|") || "(none)").join(" / ")}`);
          console.log("");

          if (orphans.length > 0) {
            console.log(`       FINDING: ${orphans.length} orphan(s) (no agreement_id) — safe to DROP`);
            console.log(`       Orphan id(s): ${orphans.map((r) => r.id).join(", ")}`);
          }
          if (sameUser) {
            console.log(`       FINDING: Same user (${uniqueEmails[0]}) in both groups — MERGE by keeping one, dropping the other`);
          } else if (differentUsers) {
            console.log(`       FINDING: Different users — legitimate split? Investigate why two groups exist for same org+name`);
            console.log(`       Unique emails: ${uniqueEmails.join(", ")}`);
          } else if (flatEmails.length === 0) {
            console.log(`       FINDING: No members in either group — both are empty shells`);
          }
        }
      }
    }
  } catch (e: any) {
    console.log(`     (failed: ${e.message.split("\n")[0]})`);
  }

  console.log(`\n${SEP}\n`);

  await c.end();
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
