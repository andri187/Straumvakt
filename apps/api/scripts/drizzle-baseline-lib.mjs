// Pure logic for drizzle-baseline.mjs. No `pg` import, no process.exit, no
// top-level side effects, so tests can drive it with a fake client.
//
// THE TWO HAZARDS THIS EXISTS TO PREVENT
// 1. The baseline helper records a migration as applied WITHOUT running it.
//    That is only honest for the cold baseline, which describes tables that
//    already exist. Any later migration (0001 restores 11 constraints) must be
//    run by the real migration runner; recording its hash would leave the
//    constraints absent while `drizzle-kit migrate` reports them applied.
// 2. A preview that creates the drizzle schema/table is not a preview.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The only migration this helper may record without executing. */
export const BASELINE_TAG = "0000_cold_hex";

export const MODES = ["preview", "apply", "verify", "verify-all"];

const FLAGS = { "--apply": "apply", "--verify": "verify", "--verify-all": "verify-all" };

/** Throws on unknown or conflicting flags; no flag means preview. */
export function parseMode(argv) {
  const modes = new Set();
  for (const arg of argv) {
    if (!(arg in FLAGS)) throw new Error(`unknown argument ${arg} (allowed: ${Object.keys(FLAGS).join(", ")})`);
    modes.add(FLAGS[arg]);
  }
  if (modes.size > 1) throw new Error(`incompatible flags: ${[...argv].join(" ")} — choose one mode`);
  return [...modes][0] ?? "preview";
}

export function readJournalEntries(folder, fsImpl = fs) {
  const journal = JSON.parse(fsImpl.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((e) => {
    const sql = fsImpl.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8");
    return {
      tag: e.tag,
      when: e.when,
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint").length,
    };
  });
}

/**
 * Split journal entries into the single baseline and everything after it.
 * Fails closed if the journal no longer starts with the expected baseline.
 */
export function selectBaseline(entries) {
  if (entries.length === 0) throw new Error("journal has no entries");
  const [first, ...later] = entries;
  if (first.tag !== BASELINE_TAG) {
    throw new Error(
      `journal entry 0 is ${first.tag}, expected ${BASELINE_TAG}; refusing to baseline an unrecognised migration`,
    );
  }
  if (entries.filter((e) => e.tag === BASELINE_TAG).length !== 1) {
    throw new Error(`${BASELINE_TAG} appears more than once in the journal`);
  }
  return { baseline: first, later };
}

async function readRecorded(client) {
  const { rows: reg } = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS t");
  if (!reg[0]?.t) return { tableExists: false, hashes: new Set(), rows: [] };
  const { rows } = await client.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at");
  return { tableExists: true, hashes: new Set(rows.map((r) => r.hash)), rows };
}

/**
 * Runs one mode against a pg-like client. Returns { ok, wrote }.
 * preview / verify / verify-all run inside a READ ONLY transaction, so the
 * database itself rejects a write even if this code were wrong.
 */
export async function run({ client, entries, mode, log = () => {} }) {
  const { baseline, later } = selectBaseline(entries);

  if (mode === "apply") return applyBaseline({ client, baseline, later, log });

  await client.query("BEGIN READ ONLY");
  try {
    const rec = await readRecorded(client);
    const baselineHit = rec.hashes.has(baseline.hash);

    if (mode === "preview") {
      if (baselineHit) log(`  already baselined  ${baseline.tag}`);
      else {
        log(
          `  would baseline  ${baseline.tag}  (${baseline.statements} statements, NOT executed)  ` +
            `${baseline.hash.slice(0, 12)}`,
        );
      }
      for (const e of later) {
        log(
          rec.hashes.has(e.hash)
            ? `  ledger already records  ${e.tag}  (baseline mode does not touch it)`
            : `  not in ledger  ${e.tag}  (baseline mode will not execute or record it; run the migration runner)`,
        );
      }
      log("\n  preview only — nothing written; pass --apply to record the baseline hash only");
      return { ok: true, wrote: false };
    }

    // verify: baseline only. verify-all: whole chain.
    let ok = true;
    log(`  ${baselineHit ? "applied " : "PENDING "} ${baseline.tag}  ${baseline.hash.slice(0, 12)}`);
    if (!baselineHit) ok = false;
    for (const e of later) {
      const hit = rec.hashes.has(e.hash);
      if (mode === "verify-all") {
        log(`  ${hit ? "applied " : "PENDING "} ${e.tag}  ${e.hash.slice(0, 12)}`);
        if (!hit) ok = false;
      } else {
        log(`  ${hit ? "applied " : "pending "} ${e.tag}  (not checked by --verify; use --verify-all)`);
      }
    }
    // A recorded hash that no file produces means a file was edited after it
    // was applied: the snapshot and the database have silently diverged.
    for (const r of rec.rows) {
      if (!entries.some((e) => e.hash === r.hash)) {
        log(`  ORPHAN   recorded hash ${String(r.hash).slice(0, 12)} matches no file`);
        ok = false;
      }
    }
    const scope = mode === "verify-all" ? "whole chain" : "baseline only";
    log(
      ok
        ? `\n  ledger check passed (${scope}): recorded hashes match the migration files. ` +
            "This does not prove the migrations' SQL ran or that any constraint exists."
        : `\n  ledger check FAILED (${scope}): see PENDING / ORPHAN lines above.`,
    );
    return { ok, wrote: false };
  } finally {
    await client.query("ROLLBACK");
  }
}

async function applyBaseline({ client, baseline, later, log }) {
  await client.query("BEGIN");
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    const { rows } = await client.query("SELECT hash FROM drizzle.__drizzle_migrations");
    const have = new Set(rows.map((r) => r.hash));

    if (have.has(baseline.hash)) {
      log(`  already baselined  ${baseline.tag}`);
      await client.query("ROLLBACK");
      return { ok: true, wrote: false };
    }
    // Baselining is a bootstrap step. A table that already holds other
    // migrations (or a different baseline hash) is not a bootstrap.
    if (rows.length > 0) {
      throw new Error(
        `drizzle.__drizzle_migrations already has ${rows.length} row(s) but not the ${baseline.tag} hash; ` +
          "refusing to baseline over an unrecognised history",
      );
    }
    log(`  BASELINING  ${baseline.tag}  (${baseline.statements} statements, NOT executed)  ${baseline.hash.slice(0, 12)}`);
    await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [
      baseline.hash,
      baseline.when,
    ]);
    await client.query("COMMIT");
    for (const e of later) log(`  left pending (run the migration runner)  ${e.tag}`);
    return { ok: true, wrote: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
