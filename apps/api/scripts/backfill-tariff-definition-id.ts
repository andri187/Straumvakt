#!/usr/bin/env tsx
/**
 * backfill-tariff-definition-id.ts — Sprint 9 FIX-1
 *
 * Backfill `reports.session_ledger.tariff_definition_id` for the legacy
 * rows priced before Sprint 9 (FIX-1) wired the resolver's resolved
 * DSO TariffDefinition id into the ledger write path.
 *
 * AUD-1 / WARN-4 surfaced 489 priced rows (cost_isk_minor IS NOT NULL)
 * with tariff_definition_id IS NULL. The shadow-comparison harness
 * needs the FK to verify the new resolver picks the same tariff.
 *
 *   npx tsx scripts/backfill-tariff-definition-id.ts            (DRY-RUN, default)
 *   npx tsx scripts/backfill-tariff-definition-id.ts --apply    (writes in one tx)
 *   npx tsx scripts/backfill-tariff-definition-id.ts --apply \
 *                       --limit=50                              (cap rows touched)
 *
 * Rule 5 constraints (non-negotiable):
 *   - --dry-run is default; --apply is required to write.
 *   - DOES NOT modify cost_isk_minor (no cost math).
 *   - DOES NOT modify tariff selection (uses the SAME Site→DSO walk
 *     as the resolver did at session-priced-time).
 *   - DOES NOT modify billing.tariff_definitions / Site / Installation
 *     / ChargingStation. Read-only on the upstream FK chain.
 *   - --apply runs everything in a SINGLE transaction with ROLLBACK on error.
 *   - Idempotent — re-running is a no-op once all eligible rows are filled.
 *
 * Scope:
 *   - Only touches rows where tariff_definition_id IS NULL
 *     AND cost_isk_minor IS NOT NULL (priced legacy rows).
 *   - Unpriced rows (cost_isk_minor IS NULL) are NOT backfilled —
 *     they were never priced so there is no resolver outcome to record.
 *
 * Resolution per row:
 *   ledger.session_id → charging.sessions.charging_station_id
 *                    → assets.site_assets.site_id
 *                    → properties.sites.dso_tariff_id     (= TariffDefinition.id)
 *
 *   If any link is null/missing → log SKIP with a reason; do NOT update.
 *   If the chain resolves       → UPDATE tariff_definition_id = <DSO TD id>.
 *
 * Note on "as-of" semantics: properties.sites.dso_tariff_id is a single
 * mutable column (no history table). "What would have resolved at
 * started_at" effectively means "what the Site has TODAY" — there is
 * no historical record we can consult. For the 489 known rows in
 * staging, every site's anchor has been stable since Sprint 8.3 so this
 * is correct in practice. If the operator detects a drift (e.g. they
 * swap the Site's DSO tariff in the future and re-run this script),
 * rows with non-null tariff_definition_id are skipped (idempotency).
 *
 * Reads-with-cost-mismatch warning: as a forensic aid we re-compute
 * the cost from the live chain and compare with the persisted
 * cost_isk_minor. A mismatch warns but DOES NOT BLOCK the FK write —
 * the FK identifies which tariff the ledger row references TODAY, and
 * the operator decides whether the legacy cost still matches the
 * tariff's current rate. (Cost math itself is never altered.)
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (expected at <repo>/.env.local)");
  process.exit(1);
}

// ── CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT_ARG = args
  .find((a) => a.startsWith("--limit="))
  ?.slice("--limit=".length)
  ?.trim();
const LIMIT = LIMIT_ARG ? Math.max(0, Number.parseInt(LIMIT_ARG, 10)) : null;
const HELP = args.includes("--help") || args.includes("-h");

if (HELP) {
  console.log(`
backfill-tariff-definition-id.ts — Sprint 9 FIX-1

Usage:
  npx tsx scripts/backfill-tariff-definition-id.ts                (DRY-RUN, default)
  npx tsx scripts/backfill-tariff-definition-id.ts --apply
  npx tsx scripts/backfill-tariff-definition-id.ts --apply --limit=50

Flags:
  --apply           actually write the backfill (default is dry-run)
  --limit=<n>       cap the rows touched (smoke-test before full backfill)
  --help, -h        print this and exit

What it does:
  Fills reports.session_ledger.tariff_definition_id by walking
  session → charging_station → site_asset → site.dso_tariff_id.
  Only acts on rows where tariff_definition_id IS NULL AND
  cost_isk_minor IS NOT NULL. Idempotent on re-run.
`);
  process.exit(0);
}

const SEP = "═══════════════════════════════════════════════════════════════════";
const SUB = "──────────────────────────────────────────────────────────────────";

// ── Row shapes ──────────────────────────────────────────────────────────
interface CandidateRow {
  sessionId: string;
  orgId: string;
  startedAt: Date;
  costIskMinor: bigint | null;
  energyKwh: string;
  // Chain (LEFT JOINed; any may be null)
  chargingStationId: string | null;
  siteId: string | null;
  dsoTariffId: string | null;
  dsoTariffDisplayName: string | null;
  dsoTariffStatus: string | null;
  // Forensics — current Veitur AD1 price (for the optional cost re-check
  // we log against legacy rows). Not used to gate the write.
  dsoPriceMinor: string | null;
  vatRatePct: string | null;
}

interface SkipReason {
  sessionId: string;
  reason:
    | "no_charging_station"
    | "no_site_asset"
    | "no_site"
    | "no_dso_tariff_id"
    | "dso_tariff_missing"
    | "dso_tariff_inactive";
  detail: string;
}

// ── Main ────────────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log(
    `  BACKFILL session_ledger.tariff_definition_id — ${APPLY ? "APPLY MODE (will write)" : "DRY-RUN (default)"}`,
  );
  if (LIMIT !== null) console.log(`  row cap: --limit=${LIMIT}`);
  console.log(`${SEP}\n`);

  let updated = 0;
  let skipped = 0;
  let alreadyOk = 0;
  let costMismatchWarnings = 0;
  const skipDetails: SkipReason[] = [];

  try {
    // ────────────────────────── PRE-FLIGHT ──────────────────────────
    console.log("=== PRE-FLIGHT ===\n");

    // Total ledger rows that already have the FK (sanity: should equal
    // total priced minus the count of NULLs we are about to fix).
    const alreadyFilledRes = await c.query(
      `select count(*)::int as n
         from reports.session_ledger
        where tariff_definition_id is not null
          and cost_isk_minor is not null`,
    );
    alreadyOk = alreadyFilledRes.rows[0].n ?? 0;
    console.log(`  ✓ ${alreadyOk} priced row(s) already have tariff_definition_id (skipped on re-run)`);

    // Unpriced rows — we never backfill these (no resolver outcome to record).
    const unpricedRes = await c.query(
      `select count(*)::int as n
         from reports.session_ledger
        where cost_isk_minor is null`,
    );
    const unpricedCount = unpricedRes.rows[0].n ?? 0;
    console.log(`  ✓ ${unpricedCount} unpriced row(s) in ledger — intentionally NOT backfilled`);

    // ────────────────────────── CANDIDATES ──────────────────────────
    // Pull every NULL-FK priced row + its resolver inputs in one query.
    // The LEFT JOINs let us classify the reason for null at each step.
    const limitClause = LIMIT !== null ? `limit ${LIMIT}` : "";
    const candidatesRes = await c.query(
      `select sl.session_id        as session_id,
              sl.org_id             as org_id,
              sl.started_at         as started_at,
              sl.cost_isk_minor     as cost_isk_minor,
              sl.energy_kwh         as energy_kwh,
              cs.charging_station_id as charging_station_id,
              sa.site_id            as site_id,
              s.dso_tariff_id       as dso_tariff_id,
              td.display_name       as dso_tariff_display_name,
              td.status             as dso_tariff_status,
              (td.compute_rule->>'pricePerKwhMinor') as dso_price_minor,
              td.vat_rate_pct::text as vat_rate_pct
         from reports.session_ledger sl
         left join charging.sessions cs    on cs.id  = sl.session_id
         left join properties.site_assets sa on sa.id  = cs.charging_station_id
         left join properties.sites s      on s.id   = sa.site_id
         left join billing.tariff_definitions td on td.id = s.dso_tariff_id
        where sl.tariff_definition_id is null
          and sl.cost_isk_minor is not null
        order by sl.started_at asc
        ${limitClause}`,
    );

    const candidates: CandidateRow[] = candidatesRes.rows.map((r: any) => ({
      sessionId: r.session_id,
      orgId: r.org_id,
      startedAt: new Date(r.started_at),
      costIskMinor: r.cost_isk_minor !== null ? BigInt(r.cost_isk_minor) : null,
      energyKwh: r.energy_kwh?.toString() ?? "0",
      chargingStationId: r.charging_station_id,
      siteId: r.site_id,
      dsoTariffId: r.dso_tariff_id,
      dsoTariffDisplayName: r.dso_tariff_display_name,
      dsoTariffStatus: r.dso_tariff_status,
      dsoPriceMinor: r.dso_price_minor ?? null,
      vatRatePct: r.vat_rate_pct ?? null,
    }));

    console.log(`\n  ✓ ${candidates.length} candidate row(s) to evaluate`);
    if (candidates.length === 0) {
      console.log("\n  → Nothing to do. All priced ledger rows already carry tariff_definition_id.");
      console.log(`\n${SEP}\n`);
      return; // finally{} closes the client
    }

    // ──────────────────────────── PLAN ─────────────────────────────
    console.log("\n=== PLAN ===\n");

    // Pre-classify: how many will write vs skip, and group skip reasons.
    const eligible: CandidateRow[] = [];
    for (const row of candidates) {
      if (!row.chargingStationId) {
        skipDetails.push({
          sessionId: row.sessionId,
          reason: "no_charging_station",
          detail: `session has no charging_station_id (orphan session row)`,
        });
        continue;
      }
      if (!row.siteId) {
        skipDetails.push({
          sessionId: row.sessionId,
          reason: "no_site_asset",
          detail: `charging_station_id ${row.chargingStationId} has no site_asset row (orphan FK)`,
        });
        continue;
      }
      if (!row.dsoTariffId) {
        skipDetails.push({
          sessionId: row.sessionId,
          reason: "no_dso_tariff_id",
          detail: `site ${row.siteId} has no dso_tariff_id wired (unconfigured)`,
        });
        continue;
      }
      if (!row.dsoTariffDisplayName) {
        skipDetails.push({
          sessionId: row.sessionId,
          reason: "dso_tariff_missing",
          detail: `dso_tariff_id ${row.dsoTariffId} references a missing TariffDefinition row`,
        });
        continue;
      }
      if (row.dsoTariffStatus !== "active") {
        // Same guard as resolveTariffChainForSession. Log + skip; the
        // resolver would never have produced a price from an inactive
        // row, so we won't backfill against one either.
        skipDetails.push({
          sessionId: row.sessionId,
          reason: "dso_tariff_inactive",
          detail: `TariffDefinition ${row.dsoTariffId} status=${row.dsoTariffStatus}`,
        });
        continue;
      }
      eligible.push(row);
    }

    console.log(`  • ${eligible.length} row(s) will be UPDATEd (chain resolves cleanly)`);
    console.log(`  • ${skipDetails.length} row(s) will be SKIPped (chain incomplete)`);
    if (skipDetails.length > 0) {
      // Group counts by reason for the summary header — full per-row
      // log appears later under EXEC OUTPUT.
      const byReason = new Map<string, number>();
      for (const s of skipDetails) {
        byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
      }
      for (const [reason, n] of byReason) {
        console.log(`         skip[${reason}] = ${n}`);
      }
    }

    // ──────────────────────────── EXEC ─────────────────────────────
    console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} OUTPUT ===\n`);

    if (APPLY) {
      console.log("  -- BEGIN");
      await c.query("BEGIN");
    } else {
      console.log("  -- BEGIN (skipped — dry-run)");
    }

    try {
      // 1. UPDATE eligible rows in batches. One UPDATE per row keeps
      //    the EXEC log readable; at 489 rows this is fine (single tx).
      for (const row of eligible) {
        const oneLine =
          `update reports.session_ledger set tariff_definition_id = $1 where session_id = $2 and tariff_definition_id is null`;
        const params = [row.dsoTariffId, row.sessionId];
        const tag = APPLY ? "EXEC" : "WOULD";
        console.log(
          `   ${tag}: ${oneLine}`,
        );
        console.log(
          `         $1 = '${row.dsoTariffId}'  (TariffDefinition '${row.dsoTariffDisplayName}')`,
        );
        console.log(
          `         $2 = '${row.sessionId}'    (started_at=${row.startedAt.toISOString()}, cost=${row.costIskMinor !== null ? Number(row.costIskMinor) / 100 + " kr." : "null"})`,
        );

        // Forensic cost re-check (warn-only). The legacy ledger was
        // priced as 30 kWh × (DSO + retailer) × VAT. We only have the
        // DSO half here, but we can still flag obvious drift if the
        // recomputed DSO-only sanity bound deviates wildly from the
        // persisted total. This is purely informational; the FK write
        // proceeds regardless.
        if (
          row.dsoPriceMinor !== null &&
          row.vatRatePct !== null &&
          row.energyKwh !== null
        ) {
          try {
            const energyKwh = Number(row.energyKwh);
            const dsoPrice = BigInt(row.dsoPriceMinor); // 1/100 kr per kWh
            const milliKwh = BigInt(Math.round(energyKwh * 1000));
            const dsoExVat = (milliKwh * dsoPrice + 500n) / 1000n;
            const persistedTotal = row.costIskMinor ?? 0n;
            // DSO-only is half the picture; sanity = DSO ex-VAT must be
            // less than the persisted incl-VAT total (DSO + retailer
            // both contribute, then VAT is added on top).
            if (dsoExVat > persistedTotal) {
              costMismatchWarnings++;
              console.log(
                `         ⚠ cost-sanity warning: DSO ex-VAT alone (${dsoExVat} minor) > persisted total (${persistedTotal} minor). ` +
                  `Possible tariff drift since pricing — operator review recommended.`,
              );
            }
          } catch {
            // Sanity check is best-effort; never block the FK write.
          }
        }

        if (APPLY) {
          const res = await c.query(oneLine, params);
          console.log(`         → rowCount=${res.rowCount}`);
          updated += res.rowCount ?? 0;
        } else {
          updated++;
        }
      }

      // 2. SKIP log (per-row details now that EXEC plan above is done).
      if (skipDetails.length > 0) {
        console.log("\n  --- Skipped rows ---");
        for (const s of skipDetails) {
          console.log(`   SKIP  session=${s.sessionId}  reason=${s.reason}`);
          console.log(`         ${s.detail}`);
          skipped++;
        }
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
    console.log(`  Candidates evaluated: ${candidates.length}`);
    console.log(`    → updated:          ${updated}${APPLY ? "" : "   (would update — dry-run)"}`);
    console.log(`    → skipped:          ${skipped}    (chain incomplete; see SKIP log above)`);
    console.log(`  Cost-sanity warnings: ${costMismatchWarnings}    (FK still written; operator review)`);
    console.log(`  Already-OK (existing FK): ${alreadyOk}`);
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
