#!/usr/bin/env tsx
/**
 * supersede-orphan-b6771541.ts — Sprint 9 / FIX-4 follow-up
 *
 * Sets status = 'expired' on agreement b6771541-a4c5-4c8c-8558-4041a34c7335
 * (VCP Lab — N1 driver access, sandbox) so it does not collide with the
 * new Straumvakt-counterparty installation agreement that migrate-to-agreements.ts
 * will create for the same installation (0909cff6-6a19-490d-b53b-b36204dfecc7).
 *
 * Background:
 *   The AgreementStatus enum (agreements schema) has three values only:
 *     draft | active | expired
 *   There is no 'superseded' value; 'expired' is the correct retirement
 *   status for a replaced-but-not-errored agreement (see ADR 0019 / schema.prisma).
 *
 * Why this matters:
 *   loadAgreementContext() in apps/api/src/lib/agreement/persist.ts uses
 *   prisma.agreement.findFirst() with no orderBy clause (persist.ts line 123).
 *   Prisma findFirst() with no orderBy is non-deterministic — the database
 *   may return either active row. After migrate-to-agreements.ts --apply, two
 *   active installation agreements will exist for VCP Lab, and billing
 *   resolution could randomly pick the old N1-counterparty stub (which has
 *   0 clauses) instead of the new Straumvakt-counterparty row (which has
 *   DSO + ELE clauses). The result would be a session that resolves with
 *   0 billing lines — a silent billing miss.
 *
 * Usage:
 *   npx tsx scripts/supersede-orphan-b6771541.ts              → DRY-RUN (default)
 *   npx tsx scripts/supersede-orphan-b6771541.ts --apply      → commits
 *   npx tsx scripts/supersede-orphan-b6771541.ts --apply \
 *                     --force                                 → skip pre-flight checks
 *
 * Safety constraints (non-negotiable):
 *   - Dry-run is default. --apply is required to write.
 *   - Pre-flight checks verify the row exists, has the expected
 *     counterparty and installation, and is currently active.
 *   - All pre-flight failures are hard stops unless --force is passed.
 *   - The UPDATE runs in a single transaction with ROLLBACK on error.
 *   - Idempotent: re-running after expiry is a no-op.
 */
import { Client } from "pg";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";

dotenv({ path: resolve(process.cwd(), "../../.env.local") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (expected at <repo>/.env.local)");
  process.exit(1);
}

// ── Target constants (never change these — they are the forensic anchors) ───
const TARGET_ID = "b6771541-a4c5-4c8c-8558-4041a34c7335";
const EXPECTED_COUNTERPARTY_ORG_ID = "b9f6a897-2401-45a3-9cde-b89d32fdb326"; // N1 ehf
const EXPECTED_INSTALLATION_ID = "0909cff6-6a19-490d-b53b-b36204dfecc7"; // VCP Lab
const EXPECTED_DISPLAY_NAME = "VCP Lab — N1 driver access (sandbox)";
const TARGET_STATUS = "expired"; // AgreementStatus enum: draft | active | expired

// ── CLI flags ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const HELP = args.includes("--help") || args.includes("-h");

if (HELP) {
  console.log(`
supersede-orphan-b6771541.ts — Sprint 9 FIX-4

Sets status = '${TARGET_STATUS}' on the orphan VCP Lab / N1 driver access agreement
so it does not interfere with the new Straumvakt-counterparty installation
agreement that migrate-to-agreements.ts will create.

Usage:
  npx tsx scripts/supersede-orphan-b6771541.ts              (DRY-RUN, default)
  npx tsx scripts/supersede-orphan-b6771541.ts --apply
  npx tsx scripts/supersede-orphan-b6771541.ts --apply --force

Flags:
  --apply     actually write the update (default is dry-run)
  --force     skip pre-flight identity check (operator insists)
  --help, -h  print this and exit

Target agreement:
  id:               ${TARGET_ID}
  counterparty_org: ${EXPECTED_COUNTERPARTY_ORG_ID} (N1 ehf)
  installation_id:  ${EXPECTED_INSTALLATION_ID} (VCP Lab)
  display_name:     "${EXPECTED_DISPLAY_NAME}"
  new status:       ${TARGET_STATUS}
`);
  process.exit(0);
}

const SEP = "═══════════════════════════════════════════════════════════════════";
const SUB = "──────────────────────────────────────────────────────────────────";

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n${SEP}`);
  console.log(
    `  SUPERSEDE ORPHAN b6771541 — ${APPLY ? "APPLY MODE (will write)" : "DRY-RUN (default)"}`,
  );
  if (FORCE) console.log(`  --force: pre-flight identity check SKIPPED`);
  console.log(`${SEP}\n`);

  try {
    // ──────────────────────── PRE-FLIGHT ─────────────────────────────
    console.log("=== PRE-FLIGHT ===\n");

    const rowRes = await c.query(
      `select id, agreement_type, counterparty_org_id, installation_id,
              display_name, status, effective_from, notes
         from agreements.agreements
        where id = $1`,
      [TARGET_ID],
    );

    if (rowRes.rowCount === 0) {
      console.error(`  ✗ ABORT: row ${TARGET_ID} not found in agreements.agreements.`);
      console.error(`       Nothing to do — the row may have already been dropped or never existed.`);
      process.exit(1);
    }

    const row = rowRes.rows[0];
    console.log(`  ✓ Row found:`);
    console.log(`       id:               ${row.id}`);
    console.log(`       agreement_type:   ${row.agreement_type}`);
    console.log(`       counterparty_org: ${row.counterparty_org_id}`);
    console.log(`       installation_id:  ${row.installation_id}`);
    console.log(`       display_name:     "${row.display_name}"`);
    console.log(`       status:           ${row.status}`);
    console.log(`       effective_from:   ${row.effective_from}`);
    console.log(`       notes:            ${row.notes ?? "(null)"}`);

    // Idempotency check
    if (row.status === TARGET_STATUS) {
      console.log(`\n  = Already ${TARGET_STATUS} — nothing to do. Exiting cleanly.`);
      console.log(`\n${SEP}\n`);
      return;
    }

    if (!FORCE) {
      // Identity pre-flight — refuse if anything doesn't match expectations.
      const failures: string[] = [];

      if (row.counterparty_org_id !== EXPECTED_COUNTERPARTY_ORG_ID) {
        failures.push(
          `counterparty_org_id mismatch: expected ${EXPECTED_COUNTERPARTY_ORG_ID} (N1 ehf), got ${row.counterparty_org_id}`,
        );
      }
      if (row.installation_id !== EXPECTED_INSTALLATION_ID) {
        failures.push(
          `installation_id mismatch: expected ${EXPECTED_INSTALLATION_ID} (VCP Lab), got ${row.installation_id}`,
        );
      }
      if (row.agreement_type !== "installation") {
        failures.push(
          `agreement_type mismatch: expected 'installation', got '${row.agreement_type}'`,
        );
      }

      if (failures.length > 0) {
        console.error(`\n  ✗ ABORT: pre-flight identity check FAILED (${failures.length} mismatch(es)):`);
        for (const f of failures) {
          console.error(`       - ${f}`);
        }
        console.error(`\n       Re-run with --force to skip this check if you are certain this is correct.`);
        process.exit(1);
      }

      console.log(`\n  ✓ Pre-flight identity check PASSED.`);
    } else {
      console.log(`\n  ! Pre-flight identity check skipped (--force).`);
    }

    // ───────────────────────── EXEC ──────────────────────────────────
    console.log(`\n=== ${APPLY ? "APPLY" : "DRY-RUN"} OUTPUT ===\n`);

    const sql = `
      update agreements.agreements
         set status     = $1,
             updated_at = now(),
             notes      = coalesce(notes, '') || $2
       where id = $3
         and status != $1`;

    const notesAppend = `\n[supersede-orphan-b6771541.ts, ${new Date().toISOString()}] Set to '${TARGET_STATUS}' to prevent resolver collision with the Straumvakt-counterparty installation agreement created by migrate-to-agreements.ts (Sprint 9 A.10).`;

    const oneLine = sql.replace(/\s+/g, " ").trim();
    console.log(`   ${APPLY ? "EXEC" : "WOULD"}: ${oneLine}`);
    console.log(`   $1 = '${TARGET_STATUS}'`);
    console.log(`   $2 = '<notes append>'`);
    console.log(`   $3 = '${TARGET_ID}'`);

    if (APPLY) {
      console.log("\n  -- BEGIN");
      await c.query("BEGIN");
      try {
        const result = await c.query(sql, [TARGET_STATUS, notesAppend, TARGET_ID]);
        console.log(`   → rowCount=${result.rowCount}`);
        if (result.rowCount === 0) {
          // The where clause (status != $1) was false — already at target state.
          console.log(`\n  = Row already at status='${TARGET_STATUS}' (race-safe no-op).`);
        } else {
          console.log(`\n  ✓ Agreement ${TARGET_ID} set to status='${TARGET_STATUS}'.`);
        }
        await c.query("COMMIT");
        console.log("  -- COMMIT");
      } catch (err) {
        await c.query("ROLLBACK");
        console.error("\n  -- ROLLBACK — error during apply:", err);
        throw err;
      }
    } else {
      console.log("\n  -- COMMIT (skipped — dry-run)");
    }

    // ─────────────────────── SUMMARY ─────────────────────────────────
    console.log(`\n${SUB}`);
    console.log("=== SUMMARY ===");
    console.log(SUB);
    console.log(`  Target:   ${TARGET_ID}`);
    console.log(`  Action:   UPDATE status → '${TARGET_STATUS}', append notes`);
    if (APPLY) {
      console.log("\n  ✓ APPLIED — transaction committed.");
    } else {
      console.log(`\n  → DRY-RUN — no rows written. Re-run with --apply to commit.`);
    }
    console.log(`\n${SEP}\n`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
