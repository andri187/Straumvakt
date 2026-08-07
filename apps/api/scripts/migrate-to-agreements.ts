#!/usr/bin/env tsx
/**
 * migrate-to-agreements.ts — Sprint 9 cutover A.10
 *
 * Dry-run-by-default migration script. Seeds the new agreements.* model
 * (Agreement, AgreementClause, RateReference) from the legacy billing.*
 * model for the 3 known installations in this database:
 *
 *     N1 ehf      / Dalvegur 10–14  / Dalvegur 10–14   (30 stations)
 *     N1 ehf      / Reykjavík HQ    / Reykjavík HQ     ( 1 station)
 *     Straumvakt  / Virtual Sandbox / VCP Lab          ( 1 station)
 *
 * Drives off ADR 0019 (2026-05-31 addendum) and the snapshot produced by
 * probe-billing-cutover.ts.
 *
 *   npx tsx scripts/migrate-to-agreements.ts                  → DRY-RUN (default)
 *   npx tsx scripts/migrate-to-agreements.ts --apply          → writes in one tx
 *   npx tsx scripts/migrate-to-agreements.ts --apply \
 *                       --org-filter=N1                       → optional scope
 *
 * Rule 5 constraints (non-negotiable):
 *   - --dry-run is default. --apply is required to write.
 *   - billing.* rows are NEVER modified (legacy stays until cutover ADR).
 *   - agreements.cost_factors is NEVER modified (catalog already seeded).
 *   - agreements.billing_lines is NEVER touched (resolver output).
 *   - Site / Installation / ChargingStation FK columns (dso_tariff_id,
 *     retailer_tariff_id, chrgrf_tariff_id) are NEVER touched.
 *   - --apply runs everything in a SINGLE transaction with ROLLBACK on error.
 *   - Idempotent — re-running is a no-op once target state is reached.
 *
 * What it creates per installation:
 *   - 1 'installation'-type Agreement (counterparty = the CPO org)
 *   - 2 AgreementClause rows on that Agreement (DSO + ELE)
 *
 * Plus, per CPO org (N1 ehf, Straumvakt):
 *   - 1 'service_cpo'-type Agreement (no clauses in pilot — see ADR 0019
 *     2026-05-09 addendum; USRF / INT are pilot-editable later)
 *
 * Plus, globally:
 *   - 1 RateReference per supplier code (VEITUR-AD1, N1-RAFMAGN-REPF-01)
 *
 * No BearerRule rows — pilot defaults cover everything.
 *
 * Reconciliation: the 2 existing agreements.agreements rows are queried
 * and matched by (counterparty_org_id, installation_id, agreement_type).
 * Matches are UPDATEd in place; non-matches are logged as ORPHAN warnings
 * and left untouched (operator cleans up by hand).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (expected at <repo>/.env.local)");
  process.exit(1);
}

// ── CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ORG_FILTER = args
  .find((a) => a.startsWith("--org-filter="))
  ?.slice("--org-filter=".length)
  ?.trim();
const HELP = args.includes("--help") || args.includes("-h");

if (HELP) {
  console.log(`
migrate-to-agreements.ts — Sprint 9 cutover A.10

Usage:
  npx tsx scripts/migrate-to-agreements.ts                 (DRY-RUN, default)
  npx tsx scripts/migrate-to-agreements.ts --apply
  npx tsx scripts/migrate-to-agreements.ts --apply --org-filter=N1

Flags:
  --apply             actually write the migration (default is dry-run)
  --org-filter=<s>    restrict to installations whose org display_name
                      contains <s> (case-insensitive substring)
  --help, -h          print this and exit
`);
  process.exit(0);
}

// ── Known constants (verified via seed-vcp-sandbox.ts + probe output) ───
// Straumvakt's org-id is referenced indirectly through the installation
// list — we never need it as a literal.
//
// `supplierOrgId` on a rate reference is WHO GETS PAID, and it is the only
// thing that puts a name on each leg of the cost ledger. Corrected
// 2026-08-07 — both original values were wrong, in opposite directions:
//
//   - Veitur was recorded as "not seeded as an Organization row". It is:
//     f5f003d9, roles {dso}. The DSO leg was being credited to nobody.
//   - The retailer rate pointed at N1 ehf, which is the SITE HOST and CPO
//     (roles {cpo,site_host}). The retailer is N1 Rafmagn — a separate
//     kennitala, roles {retailer}, and the org the rate code is named for.
//     The energy leg was being credited to the host.
//
// Neither surfaced because no billing line had ever been emitted.
const N1_EHF_ORG = "b9f6a897-2401-45a3-9cde-b89d32fdb326"; // site host + CPO
const N1_RAFMAGN_ORG = "e8c0d219-a9a1-4ccd-8964-3be312c90e22"; // retailer
const VEITUR_ORG = "f5f003d9-76e3-42de-870e-b62170fdc91a"; // DSO

// Supplier rate codes — stable identifiers, ADR 0019 §rate-reference.
// Both rates are flat per the whole effective window (pilot scope —
// no time-of-day / seasonal variation). Prices are read from the
// authoritative billing.tariff_definitions rows at pre-flight time;
// these defaults are only used as fall-back if the DB read returns
// something unexpected.
const DSO_RATE_CODE = "VEITUR-AD1";
const ELE_RATE_CODE = "N1-RAFMAGN-REPF-01";

const DSO_PRICE_MINOR_DEFAULT = 864n; // 8.64 kr/kWh (Veitur AD1)
const ELE_PRICE_MINOR_DEFAULT = 883n; // 8.83 kr/kWh (N1 retailer)
const VAT_RATE_PCT_DEFAULT = "24.00";

// Pilot allocation: 100% driver-paid passthrough, no markup.
//
// LOWERCASE, corrected 2026-08-07. ADR 0019 §Allocation writes its JSON
// examples uppercase ("USR"); this script followed them, and the resolver —
// which validates against the lowercase `BEARER_CODES`, matching the
// Postgres enum on the sibling `default_bearer_type` column — rejected every
// clause seeded from it. Nothing surfaced the mismatch for three months
// because no session carried a user_id, so the resolver was never reached.
//
// The reader now lowercases before validating, so rows already seeded
// uppercase still resolve. Writes are canonical from here.
const ALLOCATION_DRIVER_PAYS = {
  passthrough: { splits: [{ bearer_type: "usr", share_pct: 100 }] },
  markup: null,
};

const SEP = "═══════════════════════════════════════════════════════════════════";
const SUB = "──────────────────────────────────────────────────────────────────";

// ── Types ───────────────────────────────────────────────────────────────
interface InstallationRow {
  orgId: string;
  orgName: string;
  siteId: string;
  siteName: string;
  siteCreatedAt: Date;
  installationId: string;
  installationName: string;
  installationCreatedAt: Date;
  dsoTariffId: string | null;
  dsoTariffDisplayName: string | null;
  retailerTariffId: string | null;
  retailerTariffDisplayName: string | null;
  stationCount: number;
}

interface TariffSnapshot {
  id: string;
  orgId: string;
  displayName: string;
  costFactorCode: string | null;
  priceMinor: bigint | null;
  vatRatePct: string;
  validFrom: Date;
}

interface ExistingAgreement {
  id: string;
  agreementType: string;
  counterpartyOrgId: string;
  installationId: string | null;
  cpoOrgId: string | null;
  displayName: string;
  status: string;
  effectiveFrom: Date;
}

interface CostFactorRow {
  id: string;
  code: string;
}

interface ExistingRateRef {
  id: string;
  code: string;
  priceMinor: bigint;
  effectiveFrom: Date;
}

// ── Tiny SQL logger ─────────────────────────────────────────────────────
// In dry-run, this just prints. In --apply, it executes via the live
// transaction client AND prints. Either way the operator sees every
// statement and its parameters before commit.
type SqlRunner = (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;

function makeRunner(c: Client, apply: boolean): SqlRunner {
  return async (sql, params = []) => {
    const oneLine = sql.replace(/\s+/g, " ").trim();
    const renderedParams = params
      .map((p, i) => `  $${i + 1} = ${renderParam(p)}`)
      .join("\n");
    console.log(`   ${apply ? "EXEC" : "WOULD"}: ${oneLine}`);
    if (params.length > 0) console.log(renderedParams);
    if (!apply) return { rowCount: null };
    const res = await c.query(sql, params);
    console.log(`   → rowCount=${res.rowCount}`);
    return { rowCount: res.rowCount };
  };
}

function renderParam(p: unknown): string {
  if (p === null || p === undefined) return "NULL";
  if (typeof p === "string") return `'${p.replace(/'/g, "''")}'`;
  if (typeof p === "number") return String(p);
  if (typeof p === "bigint") return `${p}::bigint`;
  if (p instanceof Date) return `'${p.toISOString()}'::timestamptz`;
  if (typeof p === "object") return `'${JSON.stringify(p).replace(/'/g, "''")}'::jsonb`;
  return String(p);
}

// ── Main ────────────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log(
    `  MIGRATE TO AGREEMENTS — ${APPLY ? "APPLY MODE (will write)" : "DRY-RUN (default)"}`,
  );
  if (ORG_FILTER) console.log(`  org filter: '${ORG_FILTER}'`);
  console.log(`${SEP}\n`);

  try {
    // ────────────────────────── PRE-FLIGHT ──────────────────────────
    console.log("=== PRE-FLIGHT ===\n");

    // (a) Installations + their currently-wired tariff anchors
    const instWhere = ORG_FILTER ? `where o.display_name ILIKE $1` : "";
    const instParams = ORG_FILTER ? [`%${ORG_FILTER}%`] : [];
    const installations = await c.query(
      `select i.id            as installation_id,
              i.display_name  as installation_name,
              i.created_at    as installation_created_at,
              s.id            as site_id,
              s.display_name  as site_name,
              s.created_at    as site_created_at,
              o.id            as org_id,
              o.display_name  as org_name,
              s.dso_tariff_id as dso_tariff_id,
              ds.display_name as dso_tariff_display_name,
              i.retailer_tariff_id as retailer_tariff_id,
              rt.display_name as retailer_tariff_display_name,
              (select count(*)::int from assets.charging_stations cs
                where cs.installation_id = i.id) as station_count
         from properties.installations i
         join properties.sites s on s.id = i.site_id
         join tenancy.organizations o on o.id = i.org_id
         left join billing.tariff_definitions ds on ds.id = s.dso_tariff_id
         left join billing.tariff_definitions rt on rt.id = i.retailer_tariff_id
         ${instWhere}
         order by o.display_name, s.display_name`,
      instParams,
    );

    if (installations.rowCount === 0) {
      console.log("  ✗ No installations found (after org filter). Nothing to do.");
      return; // finally{} closes the client
    }

    const installs: InstallationRow[] = installations.rows.map((r: any) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      siteId: r.site_id,
      siteName: r.site_name,
      siteCreatedAt: new Date(r.site_created_at),
      installationId: r.installation_id,
      installationName: r.installation_name,
      installationCreatedAt: new Date(r.installation_created_at),
      dsoTariffId: r.dso_tariff_id,
      dsoTariffDisplayName: r.dso_tariff_display_name,
      retailerTariffId: r.retailer_tariff_id,
      retailerTariffDisplayName: r.retailer_tariff_display_name,
      stationCount: r.station_count ?? 0,
    }));

    console.log(`  ✓ ${installs.length} installation(s) found:`);
    for (const ins of installs) {
      console.log(
        `       ${ins.orgName.padEnd(14)} ${ins.siteName.padEnd(20)} ${ins.installationName.padEnd(20)}  ${ins.stationCount.toString().padStart(3)} stations`,
      );
      console.log(
        `         dso       = ${ins.dsoTariffDisplayName ?? "(unwired)"}   ${ins.dsoTariffId ?? ""}`,
      );
      console.log(
        `         retailer  = ${ins.retailerTariffDisplayName ?? "(unwired)"}   ${ins.retailerTariffId ?? ""}`,
      );
    }

    // (b) The 4 legacy tariff definitions involved — read their prices so
    //     we copy the authoritative value into rate_references rather than
    //     hardcoding.
    const referencedTariffIds = Array.from(
      new Set(
        installs
          .flatMap((i) => [i.dsoTariffId, i.retailerTariffId])
          .filter((x): x is string => x !== null),
      ),
    );

    const tariffSnapshots = new Map<string, TariffSnapshot>();
    if (referencedTariffIds.length > 0) {
      const tdRes = await c.query(
        `select td.id, td.org_id, td.display_name,
                cf.code as cost_factor_code,
                (td.compute_rule->>'pricePerKwhMinor')::bigint as price_minor,
                td.vat_rate_pct::text as vat_rate_pct,
                td.valid_from
           from billing.tariff_definitions td
           left join billing.cost_factors cf on cf.id = td.cost_factor_id
          where td.id = any($1::uuid[])`,
        [referencedTariffIds],
      );
      for (const r of tdRes.rows) {
        tariffSnapshots.set(r.id, {
          id: r.id,
          orgId: r.org_id,
          displayName: r.display_name,
          costFactorCode: r.cost_factor_code,
          priceMinor: r.price_minor !== null ? BigInt(r.price_minor) : null,
          vatRatePct: r.vat_rate_pct,
          validFrom: new Date(r.valid_from),
        });
      }
    }

    console.log(`\n  ✓ ${tariffSnapshots.size} legacy TariffDefinition(s) referenced:`);
    for (const [, t] of tariffSnapshots) {
      const price = t.priceMinor !== null ? `${Number(t.priceMinor) / 100} kr/kWh` : "(no price in compute_rule)";
      console.log(
        `       ${t.displayName.padEnd(27)} factor=${(t.costFactorCode ?? "?").padEnd(9)} ${price}  vat=${t.vatRatePct}%`,
      );
    }

    // (c) Existing agreements.agreements rows — reconciliation source
    const existingAgsRes = await c.query(
      `select id, agreement_type, counterparty_org_id, installation_id,
              cpo_org_id, display_name, status, effective_from
         from agreements.agreements`,
    );
    const existingAgs: ExistingAgreement[] = existingAgsRes.rows.map((r: any) => ({
      id: r.id,
      agreementType: r.agreement_type,
      counterpartyOrgId: r.counterparty_org_id,
      installationId: r.installation_id,
      cpoOrgId: r.cpo_org_id,
      displayName: r.display_name,
      status: r.status,
      effectiveFrom: new Date(r.effective_from),
    }));

    console.log(`\n  ✓ ${existingAgs.length} existing agreements.agreements row(s):`);
    for (const a of existingAgs) {
      console.log(
        `       id=${a.id}  type=${a.agreementType}  status=${a.status}`,
      );
      console.log(
        `         counterparty_org_id=${a.counterpartyOrgId}  installation_id=${a.installationId ?? "(null)"}`,
      );
      console.log(`         display_name="${a.displayName}"`);
    }

    // (d) Existing rate_references — never overwritten
    const existingRatesRes = await c.query(
      `select id, code, price_minor, effective_from
         from agreements.rate_references
        where code = any($1::text[])`,
      [[DSO_RATE_CODE, ELE_RATE_CODE]],
    );
    const existingRates: ExistingRateRef[] = existingRatesRes.rows.map((r: any) => ({
      id: r.id,
      code: r.code,
      priceMinor: BigInt(r.price_minor),
      effectiveFrom: new Date(r.effective_from),
    }));

    console.log(`\n  ✓ ${existingRates.length} existing rate_reference(s) for codes (${DSO_RATE_CODE}, ${ELE_RATE_CODE}):`);
    for (const r of existingRates) {
      console.log(
        `       id=${r.id}  code=${r.code}  price=${Number(r.priceMinor) / 100} kr/kWh  effective_from=${r.effectiveFrom.toISOString()}`,
      );
    }

    // (e) agreements.cost_factors — confirm DSO + ELE codes are ready
    const factorRowsRes = await c.query(
      `select id, code from agreements.cost_factors where code in ('DSO', 'ELE')`,
    );
    const factorRows: CostFactorRow[] = factorRowsRes.rows.map((r: any) => ({
      id: r.id,
      code: r.code,
    }));
    const factorByCode = new Map(factorRows.map((f) => [f.code, f.id]));

    if (!factorByCode.has("DSO") || !factorByCode.has("ELE")) {
      console.error(
        `\n  ✗ ABORT: agreements.cost_factors missing required codes. Found: ${factorRows.map((f) => f.code).join(", ") || "(none)"}`,
      );
      console.error("       Run prisma seed before re-attempting.");
      process.exit(1); // finally{} still closes the client
    }
    console.log(
      `\n  ✓ agreements.cost_factors has 'DSO' (${factorByCode.get("DSO")}) and 'ELE' (${factorByCode.get("ELE")}) ready`,
    );

    // ──────────────────────────── PLAN ─────────────────────────────
    console.log("\n=== PLAN ===\n");

    // Decide which CPO org owns each installation. For the pilot the
    // CPO org equals the installation's owner org (i.org_id) — Dalvegur,
    // Reykjavík HQ both belong to N1 ehf; VCP Lab belongs to Straumvakt.
    const cpoOrgIds = Array.from(new Set(installs.map((i) => i.orgId)));
    const cpoOrgs = new Map<string, string>();
    for (const ins of installs) cpoOrgs.set(ins.orgId, ins.orgName);

    console.log(`  • ${installs.length} 'installation'-type Agreements to UPSERT`);
    console.log(`  • ${cpoOrgIds.length} 'service_cpo'-type Agreements to UPSERT`);
    console.log(`  • ${installs.length * 2} AgreementClause rows to UPSERT (DSO + ELE per installation)`);
    console.log(`  • 2 RateReference rows (${DSO_RATE_CODE}, ${ELE_RATE_CODE}) — UPSERT if missing`);
    console.log(`  • 0 BearerRule rows (pilot uses agreement defaults — see ADR 0019)`);

    // ──────────────────────────── EXEC ─────────────────────────────
    console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} OUTPUT ===\n`);

    if (APPLY) {
      console.log("  -- BEGIN");
      await c.query("BEGIN");
    } else {
      console.log("  -- BEGIN (skipped — dry-run)");
    }

    const run = makeRunner(c, APPLY);

    // Counters
    let installAgsInserted = 0;
    let installAgsUpdated = 0;
    let installAgsAlreadyOk = 0;
    let serviceAgsInserted = 0;
    let serviceAgsUpdated = 0;
    let serviceAgsAlreadyOk = 0;
    let clausesInserted = 0;
    let ratesInserted = 0;
    let ratesSkipped = 0;
    const orphanWarnings: string[] = [];

    // Track matched-existing agreements so we can flag unmatched as orphans.
    const matchedExistingIds = new Set<string>();

    try {
      // ── 1. RateReferences first (Agreement clauses point at them by code,
      //       but code is a string identifier so order does not strictly
      //       matter; we still seed them first for clarity).
      console.log("\n  --- RateReferences ---");
      // Prefer the N1 ehf snapshot when both orgs have copies of the same
      // legacy tariff — N1 is the production owner; Straumvakt's copies
      // exist for the VCP sandbox. The price/vat should be identical.
      const pickTariffId = (
        kind: "dso" | "retailer",
      ): string | null => {
        const get = (i: InstallationRow) =>
          kind === "dso" ? i.dsoTariffId : i.retailerTariffId;
        const n1 = installs.find((i) => i.orgId === N1_EHF_ORG && get(i));
        if (n1) return get(n1);
        const any = installs.find((i) => get(i));
        return any ? get(any) : null;
      };
      for (const { code, costFactorKey, defaultPrice, supplierOrgId, sourceTariffId } of [
        {
          code: DSO_RATE_CODE,
          costFactorKey: "DSO" as const,
          defaultPrice: DSO_PRICE_MINOR_DEFAULT,
          supplierOrgId: VEITUR_ORG as string | null, // the DSO on this installation
          sourceTariffId: pickTariffId("dso"),
        },
        {
          code: ELE_RATE_CODE,
          costFactorKey: "ELE" as const,
          defaultPrice: ELE_PRICE_MINOR_DEFAULT,
          supplierOrgId: N1_RAFMAGN_ORG, // the retailer, NOT the site host
          sourceTariffId: pickTariffId("retailer"),
        },
      ]) {
        const existing = existingRates.find((r) => r.code === code);
        if (existing) {
          ratesSkipped++;
          console.log(
            `   skip  rate_reference code='${code}' already present (id=${existing.id}, price=${Number(existing.priceMinor) / 100} kr/kWh) — not overwritten`,
          );
          continue;
        }
        const snapshot = sourceTariffId ? tariffSnapshots.get(sourceTariffId) : undefined;
        const priceMinor = snapshot?.priceMinor ?? defaultPrice;
        const vatPct = snapshot?.vatRatePct ?? VAT_RATE_PCT_DEFAULT;
        const effectiveFrom = snapshot?.validFrom ?? new Date("2024-01-01T00:00:00Z");
        const newId = randomUUID();
        await run(
          `insert into agreements.rate_references
             (id, code, cost_factor_id, supplier_org_id, basis, price_minor,
              currency, vat_rate_pct, effective_from, effective_until, notes)
           values ($1, $2, $3, $4, 'per_kwh', $5,
                   'ISK', $6::numeric, $7, NULL,
                   $8)`,
          [
            newId,
            code,
            factorByCode.get(costFactorKey)!,
            supplierOrgId,
            priceMinor,
            vatPct,
            effectiveFrom,
            `Seeded by migrate-to-agreements.ts from billing.tariff_definitions${snapshot ? ` (source td=${snapshot.id})` : ""}.`,
          ],
        );
        ratesInserted++;
        console.log(
          `   +     rate_reference code='${code}' inserted (price=${Number(priceMinor) / 100} kr/kWh, vat=${vatPct}%, effective_from=${effectiveFrom.toISOString()})`,
        );
      }

      // ── 2. service_cpo Agreements — one per CPO org
      console.log("\n  --- 'service_cpo' Agreements (one per CPO org) ---");
      for (const orgId of cpoOrgIds) {
        const orgName = cpoOrgs.get(orgId)!;
        const displayName = `${orgName} — Straumvakt CPO services`;

        // Earliest installation created_at under this org = effective_from anchor.
        const earliest = installs
          .filter((i) => i.orgId === orgId)
          .map((i) =>
            i.siteCreatedAt < i.installationCreatedAt
              ? i.siteCreatedAt
              : i.installationCreatedAt,
          )
          .reduce((a, b) => (a < b ? a : b));

        const match = existingAgs.find(
          (e) =>
            e.agreementType === "service_cpo" &&
            e.counterpartyOrgId === orgId &&
            e.installationId === null,
        );

        if (match) {
          matchedExistingIds.add(match.id);
          // Reconcile: bring display_name + effective_from into target shape.
          const needsUpdate =
            match.displayName !== displayName ||
            match.effectiveFrom.getTime() !== earliest.getTime();
          if (needsUpdate) {
            await run(
              `update agreements.agreements
                  set display_name = $1,
                      effective_from = $2,
                      updated_at = now()
                where id = $3`,
              [displayName, earliest, match.id],
            );
            serviceAgsUpdated++;
            console.log(
              `   ~     service_cpo Agreement ${match.id} reconciled (org=${orgName})`,
            );
          } else {
            serviceAgsAlreadyOk++;
            console.log(
              `   =     service_cpo Agreement ${match.id} already matches target (org=${orgName})`,
            );
          }
          // TODO (post-pilot): once USRF / INT rates are set on this org,
          // seed AgreementClause rows here (one per pilot-editable factor).
          continue;
        }

        const newId = randomUUID();
        await run(
          `insert into agreements.agreements
             (id, agreement_type, counterparty_org_id, cpo_org_id,
              installation_id, display_name, status,
              effective_from, effective_until, notes)
           values ($1, 'service_cpo', $2, NULL,
                   NULL, $3, 'active',
                   $4, NULL,
                   'Created by migrate-to-agreements.ts (Sprint 9 A.10). No clauses in pilot — USRF / INT seeded post-pilot per ADR 0019 §2026-05-09.')`,
          [newId, orgId, displayName, earliest],
        );
        serviceAgsInserted++;
        console.log(
          `   +     service_cpo Agreement ${newId} inserted for ${orgName} (effective_from=${earliest.toISOString()})`,
        );
      }

      // ── 3. installation Agreements — one per installation
      console.log("\n  --- 'installation' Agreements (one per installation) ---");
      const installAgreementIds = new Map<string, string>(); // installationId → agreementId
      for (const ins of installs) {
        const displayName = `${ins.installationName} — operating costs`;
        const effectiveFrom =
          ins.siteCreatedAt < ins.installationCreatedAt
            ? ins.siteCreatedAt
            : ins.installationCreatedAt;

        const match = existingAgs.find(
          (e) =>
            e.agreementType === "installation" &&
            e.counterpartyOrgId === ins.orgId &&
            e.installationId === ins.installationId,
        );

        if (match) {
          matchedExistingIds.add(match.id);
          installAgreementIds.set(ins.installationId, match.id);
          // Reconcile display_name and effective_from to canonical shape,
          // but DO NOT overwrite a manually-set display_name that already
          // ends with "operating costs" — only force when divergent.
          const needsUpdate =
            match.displayName !== displayName ||
            match.effectiveFrom.getTime() !== effectiveFrom.getTime();
          if (needsUpdate) {
            await run(
              `update agreements.agreements
                  set display_name = $1,
                      effective_from = $2,
                      updated_at = now()
                where id = $3`,
              [displayName, effectiveFrom, match.id],
            );
            installAgsUpdated++;
            console.log(
              `   ~     installation Agreement ${match.id} reconciled (${ins.installationName})`,
            );
          } else {
            installAgsAlreadyOk++;
            console.log(
              `   =     installation Agreement ${match.id} already matches target (${ins.installationName})`,
            );
          }
          continue;
        }

        const newId = randomUUID();
        await run(
          `insert into agreements.agreements
             (id, agreement_type, counterparty_org_id, cpo_org_id,
              installation_id, display_name, status,
              effective_from, effective_until, notes)
           values ($1, 'installation', $2, NULL,
                   $3, $4, 'active',
                   $5, NULL,
                   'Created by migrate-to-agreements.ts (Sprint 9 A.10). Reconciles legacy billing.tariff_definitions pointers (Site.dso_tariff_id, Installation.retailer_tariff_id).')`,
          [newId, ins.orgId, ins.installationId, displayName, effectiveFrom],
        );
        installAgsInserted++;
        installAgreementIds.set(ins.installationId, newId);
        console.log(
          `   +     installation Agreement ${newId} inserted for ${ins.installationName} (org=${ins.orgName}, effective_from=${effectiveFrom.toISOString()})`,
        );
      }

      // ── 4. AgreementClause rows — 2 per installation Agreement
      console.log("\n  --- AgreementClause rows (DSO + ELE per installation) ---");
      const dsoFactorId = factorByCode.get("DSO")!;
      const eleFactorId = factorByCode.get("ELE")!;

      for (const ins of installs) {
        const agreementId = installAgreementIds.get(ins.installationId)!;

        for (const { factorId, rateRefCode, label } of [
          { factorId: dsoFactorId, rateRefCode: DSO_RATE_CODE, label: "DSO" },
          { factorId: eleFactorId, rateRefCode: ELE_RATE_CODE, label: "ELE" },
        ]) {
          // Idempotent UPSERT — unique on (agreement_id, cost_factor_id).
          // We rely on the @@unique constraint declared in prisma/schema.prisma.
          const newId = randomUUID();
          await run(
            `insert into agreements.agreement_clauses
               (id, agreement_id, cost_factor_id,
                default_bearer_type, default_bearer_ref,
                default_rate_ref_code, allocation_json)
             values ($1, $2, $3,
                     'usr', NULL,
                     $4, $5::jsonb)
             on conflict (agreement_id, cost_factor_id) do update
               set default_bearer_type  = excluded.default_bearer_type,
                   default_bearer_ref   = excluded.default_bearer_ref,
                   default_rate_ref_code = excluded.default_rate_ref_code,
                   allocation_json      = excluded.allocation_json,
                   updated_at           = now()`,
            [
              newId,
              agreementId,
              factorId,
              rateRefCode,
              JSON.stringify(ALLOCATION_DRIVER_PAYS),
            ],
          );
          // Bucket every clause write — insert and update both produce the
          // target state. The EXEC log already shows raw rowCount per stmt
          // if the operator wants to disambiguate.
          clausesInserted++;
          console.log(
            `   ±     Clause ${label} on agreement ${agreementId} (${ins.installationName}) → rate_ref_code='${rateRefCode}', bearer=usr`,
          );
        }
      }
      // (All clause writes bucket into clausesInserted; the ON CONFLICT
      // path collapses insert vs update from the operator's standpoint —
      // both produce the same target state. The EXEC log above shows the
      // raw rowCount per statement if you need to disambiguate.)

      // ── 5. Orphan reporting on existing agreements not matched above
      for (const a of existingAgs) {
        if (matchedExistingIds.has(a.id)) continue;
        const msg =
          `orphan agreement id=${a.id} type=${a.agreementType} counterparty=${a.counterpartyOrgId} ` +
          `installation=${a.installationId ?? "(null)"} display_name="${a.displayName}" — not matched to any in-scope (org_filter='${ORG_FILTER ?? "*"}') installation. NOT deleted.`;
        orphanWarnings.push(msg);
        console.log(`   ⚠     WARNING: ${msg}`);
      }

      if (APPLY) {
        await c.query("COMMIT");
        console.log("\n  -- COMMIT");
      } else {
        console.log("\n  -- COMMIT (skipped — dry-run)");
      }
    } catch (err) {
      if (APPLY) {
        await c.query("ROLLBACK");
        console.error("\n  -- ROLLBACK — error during apply:", err);
      } else {
        console.error("\n  -- (dry-run) error:", err);
      }
      throw err;
    }

    // ─────────────────────────── SUMMARY ───────────────────────────
    console.log(`\n${SUB}`);
    console.log("=== SUMMARY ===");
    console.log(SUB);
    console.log(
      `  installation Agreements:  inserted=${installAgsInserted}  updated=${installAgsUpdated}  unchanged=${installAgsAlreadyOk}`,
    );
    console.log(
      `  service_cpo  Agreements:  inserted=${serviceAgsInserted}  updated=${serviceAgsUpdated}  unchanged=${serviceAgsAlreadyOk}`,
    );
    console.log(
      `  AgreementClauses:         written=${clausesInserted}   (upsert — insert or update via ON CONFLICT)`,
    );
    console.log(
      `  RateReferences:           inserted=${ratesInserted}    skipped (already present)=${ratesSkipped}`,
    );
    console.log(`  BearerRules:              0 (pilot uses agreement defaults)`);
    console.log(
      `  Orphan warnings:          ${orphanWarnings.length}  (existing agreement rows not matched; left untouched)`,
    );
    if (APPLY) {
      console.log("\n  ✓ APPLIED — transaction committed.");
    } else {
      console.log("\n  → DRY-RUN — no rows written. Re-run with --apply to commit.");
    }

    console.log(`\n${SEP}\n`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
