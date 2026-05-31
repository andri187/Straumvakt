#!/usr/bin/env tsx
/**
 * backfill-enrichment-sources.ts — Sprint 9 ENRICH-3
 *
 * Backfills the per-source provenance columns added by ENRICH-1 for
 * historical charging.sessions and reports.session_ledger rows that
 * pre-date the per-source write paths.
 *
 * Run AFTER the ENRICH-1 migration has applied (which adds the new
 * nullable columns to both tables). Safe to run before — the WHERE
 * predicates target NULL columns, and a pre-migration run will simply
 * produce 0 candidate rows.
 *
 *   npx tsx scripts/backfill-enrichment-sources.ts             (DRY-RUN, default)
 *   npx tsx scripts/backfill-enrichment-sources.ts --apply     (writes in one tx)
 *   npx tsx scripts/backfill-enrichment-sources.ts --limit=100 (cap for testing)
 *
 * Rule 5 constraints (non-negotiable):
 *   - --dry-run is default; --apply is required to write.
 *   - DOES NOT modify energy_kwh, stopped_at, cost, or any billing column.
 *   - DOES NOT touch charging.imported_cdr_refs (read-only).
 *   - --apply runs everything in a SINGLE transaction with ROLLBACK on error.
 *   - Idempotent — re-running is a no-op once eligible rows are filled
 *     (WHERE predicates filter on the backfilled columns being NULL).
 *
 * What it populates (all three steps run sequentially in the same tx):
 *
 *   Step 1 — charging.sessions: backfill ocpp_energy_kwh + ocpp_stopped_at
 *     from existing energy_kwh / stopped_at for rows that pre-date ENRICH-1.
 *     Rationale: legacy writes were OCPP-sourced (StopTransaction projection
 *     or CDR overlay that already overwrote both columns). CDR sync later
 *     overlays these anyway, so copying from the canonical column is safe.
 *
 *   Step 2 — charging.sessions: backfill cdr_energy_kwh + cdr_stopped_at
 *     for sessions that have a matching charging.imported_cdr_refs row.
 *     CDR energy is read from raw_payload->>'Energy' (Zaptec kWh float) and
 *     CDR stop time from raw_payload->>'EndDateTime'. These are the exact
 *     fields the live CDR sync writes; the ENRICH-1 migration adds a
 *     dedicated extracted_energy_kwh column to imported_cdr_refs for future
 *     writes — this backfill reads raw_payload directly since historical rows
 *     pre-date that column.
 *
 *   Step 3 — reports.session_ledger: backfill verified_source + enrichment_status
 *     using the per-source columns just written to charging.sessions.
 *     verified_source = "cdr" if a CDR row exists, else "ocpp".
 *     enrichment_status:
 *       "complete"  — CDR present AND abs(cdr_energy - ocpp_energy) <= 0.05 kWh
 *       "mismatch"  — CDR present BUT energies diverge by more than 0.05 kWh
 *       "ocpp_only" — no CDR row found for this session
 *
 * CDR energy source note:
 *   charging.imported_cdr_refs.raw_payload->>'Energy' is the Zaptec
 *   ChargeHistory `Energy` field (kWh, float). This is the same field
 *   used by the live CDR sync path (zaptec-session-sync.ts line ~195).
 *   When ENRICH-1 lands, the live path will ALSO persist this into
 *   imported_cdr_refs.extracted_energy_kwh; this backfill queries
 *   raw_payload directly since historical rows won't have that column
 *   populated until this script runs (or a separate ENRICH-1 backfill
 *   targets that column).
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (expected at <repo>/.env.local)");
  process.exit(1);
}

// ── CLI flags ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT_ARG = args
  .find((a) => a.startsWith("--limit="))
  ?.slice("--limit=".length)
  ?.trim();
const LIMIT = LIMIT_ARG ? Math.max(0, parseInt(LIMIT_ARG, 10)) : null;
const HELP = args.includes("--help") || args.includes("-h");

if (HELP) {
  console.log(`
backfill-enrichment-sources.ts — Sprint 9 ENRICH-3

Usage:
  npx tsx scripts/backfill-enrichment-sources.ts                (DRY-RUN, default)
  npx tsx scripts/backfill-enrichment-sources.ts --apply
  npx tsx scripts/backfill-enrichment-sources.ts --apply --limit=100

Flags:
  --apply           actually write the backfill (default is dry-run)
  --limit=<n>       cap the sessions processed (smoke-test before full run)
  --help, -h        print this and exit

What it does:
  Step 1 — charging.sessions: set ocpp_energy_kwh = energy_kwh,
            ocpp_stopped_at = stopped_at for rows where ocpp_energy_kwh is NULL
            and energy_kwh is not NULL.
  Step 2 — charging.sessions: set cdr_energy_kwh (+ cdr_stopped_at) from
            imported_cdr_refs.raw_payload for sessions that have a CDR row.
  Step 3 — reports.session_ledger: set verified_source + enrichment_status
            based on whether a CDR row exists and whether the energies agree.

Run AFTER the ENRICH-1 migration applies.
Idempotent — safe to re-run.
`);
  process.exit(0);
}

const SEP =
  "═══════════════════════════════════════════════════════════════════";
const SUB =
  "──────────────────────────────────────────────────────────────────";

// ── Mismatch tolerance ──────────────────────────────────────────────────────
// Sessions where |cdr_energy - ocpp_energy| <= this threshold get
// enrichment_status = "complete". Larger divergence = "mismatch".
const MISMATCH_THRESHOLD_KWH = 0.05;

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log(
    `  BACKFILL per-source columns (ENRICH-3) — ${APPLY ? "APPLY MODE (will write)" : "DRY-RUN (default)"}`,
  );
  if (LIMIT !== null) console.log(`  row cap: --limit=${LIMIT}`);
  console.log(
    `  mismatch tolerance: ±${MISMATCH_THRESHOLD_KWH} kWh`,
  );
  console.log(`${SEP}\n`);

  // Counters
  let step1Rows = 0;
  let step2Rows = 0;
  let step2NullEnergy = 0;
  let step2NullStoppedAt = 0;
  let step3OcppOnly = 0;
  let step3Complete = 0;
  let step3Mismatch = 0;
  let step3Rows = 0;

  try {
    // ── PRE-FLIGHT ─────────────────────────────────────────────────────────
    console.log("=== PRE-FLIGHT ===\n");

    // Check that ENRICH-1 columns exist — if any column is missing we abort
    // cleanly rather than producing a confusing SQL error mid-transaction.
    const columnsRes = await c.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'charging'
          and table_name   = 'sessions'
          and column_name  in (
            'ocpp_energy_kwh', 'cdr_energy_kwh', 'amqp_energy_kwh',
            'ocpp_stopped_at', 'cdr_stopped_at',  'ocmf_blob_ref'
          )`,
    );
    const sessionCols = new Set(
      columnsRes.rows.map((r: { column_name: string }) => r.column_name),
    );
    const ledgerColsRes = await c.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'reports'
          and table_name   = 'session_ledger'
          and column_name  in ('verified_source', 'enrichment_status')`,
    );
    const ledgerCols = new Set(
      ledgerColsRes.rows.map((r: { column_name: string }) => r.column_name),
    );

    const required = {
      "charging.sessions.ocpp_energy_kwh": sessionCols.has("ocpp_energy_kwh"),
      "charging.sessions.cdr_energy_kwh": sessionCols.has("cdr_energy_kwh"),
      "charging.sessions.ocpp_stopped_at": sessionCols.has("ocpp_stopped_at"),
      "charging.sessions.cdr_stopped_at": sessionCols.has("cdr_stopped_at"),
      "reports.session_ledger.verified_source": ledgerCols.has("verified_source"),
      "reports.session_ledger.enrichment_status":
        ledgerCols.has("enrichment_status"),
    };

    let allPresent = true;
    for (const [col, present] of Object.entries(required)) {
      if (present) {
        console.log(`  ✓ ${col} — present`);
      } else {
        console.log(`  ✗ ${col} — MISSING (ENRICH-1 migration not yet applied?)`);
        allPresent = false;
      }
    }

    if (!allPresent) {
      console.error(
        "\n  ABORT: required columns not found. Apply the ENRICH-1 migration first.",
      );
      process.exit(1);
    }

    // --limit cap: PostgreSQL UPDATE doesn't support LIMIT directly.
    // We implement it via a CTE subquery: UPDATE ... WHERE id IN (SELECT id ... LIMIT n).
    const limitClause = LIMIT !== null ? `limit ${LIMIT}` : "";

    const step1CountRes = await c.query(
      `select count(*)::int as n
         from charging.sessions
        where ocpp_energy_kwh is null
          and energy_kwh is not null`,
    );
    const step1Count = step1CountRes.rows[0].n ?? 0;
    console.log(
      `\n  Step 1 candidates (ocpp_energy_kwh NULL + energy_kwh not null): ${step1Count}`,
    );

    // Step 2 candidate count — sessions with a CDR but no cdr_energy_kwh yet
    const step2CountRes = await c.query(
      `select count(*)::int as n
         from charging.sessions s
        where s.cdr_energy_kwh is null
          and exists (
            select 1 from charging.imported_cdr_refs icr
             where icr.session_id = s.id
          )`,
    );
    const step2Count = step2CountRes.rows[0].n ?? 0;
    console.log(
      `  Step 2 candidates (CDR exists but cdr_energy_kwh NULL):           ${step2Count}`,
    );

    // Step 3 candidate count
    const step3CountRes = await c.query(
      `select count(*)::int as n
         from reports.session_ledger
        where verified_source is null`,
    );
    const step3Count = step3CountRes.rows[0].n ?? 0;
    console.log(
      `  Step 3 candidates (ledger verified_source NULL):                  ${step3Count}`,
    );

    // Already-OK counts (sanity)
    const alreadyOkSessionsRes = await c.query(
      `select count(*)::int as n
         from charging.sessions
        where ocpp_energy_kwh is not null`,
    );
    const alreadyOkLedgerRes = await c.query(
      `select count(*)::int as n
         from reports.session_ledger
        where verified_source is not null`,
    );
    console.log(
      `\n  Already backfilled — sessions.ocpp_energy_kwh:    ${alreadyOkSessionsRes.rows[0].n ?? 0}`,
    );
    console.log(
      `  Already backfilled — ledger.verified_source:      ${alreadyOkLedgerRes.rows[0].n ?? 0}`,
    );

    if (step1Count === 0 && step2Count === 0 && step3Count === 0) {
      console.log(
        "\n  → Nothing to do. All eligible rows already carry per-source columns.",
      );
      console.log(`\n${SEP}\n`);
      return; // finally{} closes the client
    }

    // ── PLAN ───────────────────────────────────────────────────────────────
    console.log("\n=== PLAN ===\n");
    console.log(`  Step 1 — UPDATE charging.sessions`);
    console.log(`           SET ocpp_energy_kwh = energy_kwh,`);
    console.log(`               ocpp_stopped_at = stopped_at`);
    console.log(`         WHERE ocpp_energy_kwh IS NULL`);
    console.log(`           AND energy_kwh IS NOT NULL`);
    if (LIMIT !== null) console.log(`         LIMIT ${LIMIT}  (--limit cap)`);
    console.log(`         Expected rows: ${step1Count}`);

    console.log(`\n  Step 2 — UPDATE charging.sessions`);
    console.log(`           SET cdr_energy_kwh = (raw_payload->>'Energy')::numeric,`);
    console.log(
      `               cdr_stopped_at  = (raw_payload->>'EndDateTime')::timestamptz`,
    );
    console.log(`         FROM charging.imported_cdr_refs`);
    console.log(`        WHERE cdr_energy_kwh IS NULL AND a CDR row exists`);
    console.log(`         Expected rows: ${step2Count}`);

    console.log(`\n  Step 3 — UPDATE reports.session_ledger`);
    console.log(`           SET verified_source   = 'cdr' | 'ocpp',`);
    console.log(`               enrichment_status = 'complete' | 'mismatch' | 'ocpp_only'`);
    console.log(`        WHERE verified_source IS NULL`);
    console.log(`         Expected rows: ${step3Count}`);

    // ── EXEC ───────────────────────────────────────────────────────────────
    console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} OUTPUT ===\n`);

    if (APPLY) {
      console.log("  -- BEGIN");
      await c.query("BEGIN");
    } else {
      console.log("  -- BEGIN (skipped — dry-run)");
    }

    try {
      // ── Step 1: ocpp_energy_kwh + ocpp_stopped_at ─────────────────────
      console.log("\n  --- Step 1: ocpp_energy_kwh + ocpp_stopped_at ---\n");

      // PostgreSQL UPDATE has no native LIMIT — use a CTE to enforce the cap.
      const step1Sql = LIMIT !== null
        ? `update charging.sessions s
              set ocpp_energy_kwh = s.energy_kwh,
                  ocpp_stopped_at = s.stopped_at,
                  updated_at      = now()
            where s.id in (
              select id
                from charging.sessions
               where ocpp_energy_kwh is null
                 and energy_kwh is not null
               limit ${LIMIT}
            )`
        : `update charging.sessions s
              set ocpp_energy_kwh = s.energy_kwh,
                  ocpp_stopped_at = s.stopped_at,
                  updated_at      = now()
            where ocpp_energy_kwh is null
              and energy_kwh is not null`;

      if (APPLY) {
        const r = await c.query(step1Sql);
        step1Rows = r.rowCount ?? 0;
        console.log(`   EXEC: set ocpp_energy_kwh = energy_kwh, ocpp_stopped_at = stopped_at`);
        console.log(`         → rowCount=${step1Rows}`);
      } else {
        step1Rows = step1Count; // dry-run estimate
        console.log(`   WOULD: set ocpp_energy_kwh = energy_kwh, ocpp_stopped_at = stopped_at`);
        console.log(`          (estimated ${step1Rows} rows)`);
      }

      // ── Step 2: cdr_energy_kwh + cdr_stopped_at ───────────────────────
      // We read from imported_cdr_refs.raw_payload. The Zaptec CDR sync
      // writes raw_payload->'Energy' (kWh float) and
      // raw_payload->'EndDateTime' (ISO-8601 string).
      // Only the most-recent CDR row per session is used (per the
      // original spec's `limit 1`); in practice sessions have at most
      // one CDR row each.
      console.log("\n  --- Step 2: cdr_energy_kwh + cdr_stopped_at ---\n");

      // In dry-run we fetch rows to report per-row. In apply mode we do
      // a single bulk UPDATE for efficiency, then report the count.
      if (APPLY) {
        // PostgreSQL UPDATE has no native LIMIT — use a CTE to enforce cap.
        const step2LimitWhere = LIMIT !== null
          ? `and s.id in (
               select id
                 from charging.sessions
                where cdr_energy_kwh is null
                  and exists (
                    select 1 from charging.imported_cdr_refs
                     where session_id = charging.sessions.id
                  )
                limit ${LIMIT}
             )`
          : "";
        const step2Sql = `
          update charging.sessions s
             set cdr_energy_kwh = (
                   select (icr.raw_payload->>'Energy')::numeric
                     from charging.imported_cdr_refs icr
                    where icr.session_id = s.id
                      and icr.raw_payload->>'Energy' is not null
                    order by icr.imported_at desc
                    limit 1
                 ),
                 cdr_stopped_at = (
                   select (icr.raw_payload->>'EndDateTime')::timestamptz
                     from charging.imported_cdr_refs icr
                    where icr.session_id = s.id
                      and icr.raw_payload->>'EndDateTime' is not null
                    order by icr.imported_at desc
                    limit 1
                 ),
                 updated_at = now()
           where s.cdr_energy_kwh is null
             and exists (
               select 1 from charging.imported_cdr_refs icr2
                where icr2.session_id = s.id
             )
             ${step2LimitWhere}
        `;
        const r2 = await c.query(step2Sql);
        step2Rows = r2.rowCount ?? 0;
        console.log(
          `   EXEC: set cdr_energy_kwh from raw_payload->>'Energy', cdr_stopped_at from raw_payload->>'EndDateTime'`,
        );
        console.log(`         → rowCount=${step2Rows}`);

        // Count how many got a null energy (raw_payload had no 'Energy' key)
        const nullEnergyRes = await c.query(
          `select count(*)::int as n
             from charging.sessions s
            where s.cdr_energy_kwh is null
              and exists (
                select 1 from charging.imported_cdr_refs icr
                 where icr.session_id = s.id
              )`,
        );
        step2NullEnergy = nullEnergyRes.rows[0].n ?? 0;
        if (step2NullEnergy > 0) {
          console.log(
            `         ⚠ ${step2NullEnergy} session(s) have a CDR row but raw_payload->'Energy' was NULL — cdr_energy_kwh stays NULL for those`,
          );
        }

        // Count how many got a null stopped_at
        const nullStoppedAtRes = await c.query(
          `select count(*)::int as n
             from charging.sessions s
            where s.cdr_stopped_at is null
              and exists (
                select 1 from charging.imported_cdr_refs icr
                 where icr.session_id = s.id
              )`,
        );
        step2NullStoppedAt = nullStoppedAtRes.rows[0].n ?? 0;
        if (step2NullStoppedAt > 0) {
          console.log(
            `         ⚠ ${step2NullStoppedAt} session(s) have a CDR row but raw_payload->'EndDateTime' was NULL — cdr_stopped_at stays NULL for those`,
          );
        }
      } else {
        // Dry-run: fetch the candidate rows and print a sample
        const step2PreviewRes = await c.query(
          `select s.id                                                  as session_id,
                  s.energy_kwh                                          as energy_kwh,
                  (icr.raw_payload->>'Energy')::numeric                 as cdr_energy,
                  (icr.raw_payload->>'EndDateTime')                     as cdr_stopped_at_raw,
                  icr.raw_payload->>'Energy' is null                    as cdr_energy_null,
                  icr.raw_payload->>'EndDateTime' is null               as cdr_stopped_null,
                  s.stopped_at
             from charging.sessions s
             join lateral (
               select raw_payload, imported_at
                 from charging.imported_cdr_refs
                where session_id = s.id
                order by imported_at desc
                limit 1
             ) icr on true
            where s.cdr_energy_kwh is null
            order by s.started_at asc
            ${limitClause}`,
        );
        step2Rows = step2PreviewRes.rowCount ?? 0;
        console.log(`   WOULD: set cdr_energy_kwh from raw_payload->>'Energy', cdr_stopped_at from raw_payload->>'EndDateTime'`);
        for (const row of step2PreviewRes.rows) {
          const energyStr =
            row.cdr_energy_null === true
              ? "Energy=NULL"
              : `Energy=${row.cdr_energy} kWh`;
          const stoppedStr =
            row.cdr_stopped_null === true
              ? "EndDateTime=NULL"
              : `EndDateTime=${row.cdr_stopped_at_raw}`;
          if (row.cdr_energy_null === true) step2NullEnergy++;
          if (row.cdr_stopped_null === true) step2NullStoppedAt++;
          console.log(
            `          session=${row.session_id}  ${energyStr}  ${stoppedStr}`,
          );
        }
        if (step2NullEnergy > 0) {
          console.log(
            `          ⚠ ${step2NullEnergy} row(s) with no Energy in raw_payload — cdr_energy_kwh will stay NULL`,
          );
        }
        if (step2NullStoppedAt > 0) {
          console.log(
            `          ⚠ ${step2NullStoppedAt} row(s) with no EndDateTime in raw_payload — cdr_stopped_at will stay NULL`,
          );
        }
      }

      // ── Step 3: verified_source + enrichment_status in ledger ─────────
      console.log("\n  --- Step 3: ledger.verified_source + enrichment_status ---\n");

      // The enrichment_status logic:
      //   "complete"  — CDR row exists AND |cdr_energy - ocpp_energy| <= threshold
      //   "mismatch"  — CDR row exists AND energies diverge beyond threshold
      //   "ocpp_only" — no CDR row for this session
      //
      // We use a single UPDATE with CASE expressions joining out to the
      // sessions table for the energy columns.
      // Note: reports.session_ledger has no updated_at column — it uses
      // computed_at which is immutable (set at write time by the projection).
      // We update only the two provenance columns.
      const thresholdStr = MISMATCH_THRESHOLD_KWH.toFixed(4);
      const step3Sql = `
        update reports.session_ledger sl
           set verified_source   = case
                 when exists (
                   select 1 from charging.imported_cdr_refs cdr
                    where cdr.session_id = sl.session_id
                 ) then 'cdr'
                 else 'ocpp'
               end,
               enrichment_status = case
                 when not exists (
                   select 1 from charging.imported_cdr_refs cdr
                    where cdr.session_id = sl.session_id
                 ) then 'ocpp_only'
                 when exists (
                   select 1 from charging.sessions s
                    where s.id = sl.session_id
                      and s.ocpp_energy_kwh is not null
                      and s.cdr_energy_kwh  is not null
                      and abs(s.cdr_energy_kwh - s.ocpp_energy_kwh) <= ${thresholdStr}
                 ) then 'complete'
                 else 'mismatch'
               end
         where sl.verified_source is null
      `;

      if (APPLY) {
        const r3 = await c.query(step3Sql);
        step3Rows = r3.rowCount ?? 0;
        console.log(
          `   EXEC: set verified_source, enrichment_status on ${step3Rows} ledger row(s)`,
        );

        // Break down by status (diagnostic)
        const distRes = await c.query(
          `select verified_source, enrichment_status, count(*)::int as n
             from reports.session_ledger
            where verified_source is not null
            group by 1, 2
            order by 3 desc`,
        );
        console.log(`\n         Distribution after backfill:`);
        for (const r of distRes.rows) {
          const src = (r.verified_source ?? "(null)").padEnd(8);
          const status = (r.enrichment_status ?? "(null)").padEnd(12);
          console.log(`           verified_source=${src} enrichment_status=${status} n=${r.n}`);
          if (r.verified_source === "cdr") {
            if (r.enrichment_status === "complete") step3Complete += r.n;
            else if (r.enrichment_status === "mismatch") step3Mismatch += r.n;
          } else {
            step3OcppOnly += r.n;
          }
        }
      } else {
        // Dry-run: compute distribution without writing
        const step3PreviewRes = await c.query(
          `select
               case
                 when exists (
                   select 1 from charging.imported_cdr_refs cdr
                    where cdr.session_id = sl.session_id
                 ) then 'cdr'
                 else 'ocpp'
               end                                                   as would_verified_source,
               case
                 when not exists (
                   select 1 from charging.imported_cdr_refs cdr
                    where cdr.session_id = sl.session_id
                 ) then 'ocpp_only'
                 when exists (
                   select 1 from charging.sessions s
                    where s.id = sl.session_id
                      and s.ocpp_energy_kwh is not null
                      and s.cdr_energy_kwh  is not null
                      and abs(s.cdr_energy_kwh - s.ocpp_energy_kwh) <= ${thresholdStr}
                 ) then 'complete'
                 else 'mismatch'
               end                                                   as would_enrichment_status,
               count(*)::int                                          as n
             from reports.session_ledger sl
            where sl.verified_source is null
            group by 1, 2
            order by 3 desc`,
        );
        step3Rows = step3Count; // known from pre-flight
        console.log(
          `   WOULD: set verified_source + enrichment_status on ${step3Rows} ledger row(s)`,
        );
        console.log(`\n         Projected distribution:`);
        for (const r of step3PreviewRes.rows) {
          const src = (r.would_verified_source ?? "(null)").padEnd(8);
          const status = (r.would_enrichment_status ?? "(null)").padEnd(12);
          console.log(
            `           verified_source=${src} enrichment_status=${status} n=${r.n}`,
          );
          if (r.would_verified_source === "cdr") {
            if (r.would_enrichment_status === "complete")
              step3Complete += r.n;
            else if (r.would_enrichment_status === "mismatch")
              step3Mismatch += r.n;
          } else {
            step3OcppOnly += r.n;
          }
        }
      }

      if (APPLY) {
        await c.query("COMMIT");
        console.log("\n  -- COMMIT");
      } else {
        console.log("\n  -- COMMIT (skipped — dry-run)");
        console.log(
          `\n  Rollback SQL (for reference — not needed in dry-run):\n` +
          `    -- Step 1 undo:\n` +
          `    UPDATE charging.sessions SET ocpp_energy_kwh = NULL, ocpp_stopped_at = NULL WHERE ocpp_energy_kwh IS NOT NULL;\n` +
          `    -- Step 2 undo:\n` +
          `    UPDATE charging.sessions SET cdr_energy_kwh = NULL, cdr_stopped_at = NULL WHERE cdr_energy_kwh IS NOT NULL;\n` +
          `    -- Step 3 undo:\n` +
          `    UPDATE reports.session_ledger SET verified_source = NULL, enrichment_status = NULL WHERE verified_source IS NOT NULL;`,
        );
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

    // ── SUMMARY ────────────────────────────────────────────────────────────
    console.log(`\n${SUB}`);
    console.log("=== SUMMARY ===");
    console.log(SUB);
    console.log(
      `  Step 1 — sessions.ocpp_energy_kwh + ocpp_stopped_at:`,
    );
    console.log(
      `    ${APPLY ? "Updated" : "Would update"}: ${step1Rows} row(s)`,
    );
    console.log(
      `  Step 2 — sessions.cdr_energy_kwh + cdr_stopped_at:`,
    );
    console.log(
      `    ${APPLY ? "Updated" : "Would update"}: ${step2Rows} row(s)`,
    );
    if (step2NullEnergy > 0) {
      console.log(
        `    ⚠ ${step2NullEnergy} row(s) had no Energy in CDR raw_payload — cdr_energy_kwh left NULL`,
      );
    }
    if (step2NullStoppedAt > 0) {
      console.log(
        `    ⚠ ${step2NullStoppedAt} row(s) had no EndDateTime in CDR raw_payload — cdr_stopped_at left NULL`,
      );
    }
    console.log(
      `  Step 3 — ledger.verified_source + enrichment_status:`,
    );
    console.log(
      `    ${APPLY ? "Updated" : "Would update"}: ${step3Rows} row(s)`,
    );
    console.log(`      ocpp_only: ${step3OcppOnly}`);
    console.log(`      complete:  ${step3Complete}`);
    console.log(`      mismatch:  ${step3Mismatch}`);
    if (step3Mismatch > 0) {
      console.log(
        `      ⚠ ${step3Mismatch} mismatch(es) — CDR and OCPP energies diverge by > ${MISMATCH_THRESHOLD_KWH} kWh. Operator review recommended.`,
      );
    }

    if (APPLY) {
      console.log("\n  ✓ APPLIED — transaction committed.");
    } else {
      console.log(
        "\n  → DRY-RUN — no rows written. Re-run with --apply to commit.",
      );
    }

    console.log(`\n${SEP}\n`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
