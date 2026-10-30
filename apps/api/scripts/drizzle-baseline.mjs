#!/usr/bin/env node
//
// Mark drizzle migrations as ALREADY APPLIED, without running them.
//
// WHY THIS IS NEEDED
// ------------------
// Prisma created every table in this database. drizzle-kit does not know
// that: `drizzle-kit generate` diffs the declarations against an empty
// snapshot and writes a migration that CREATEs all 66 tables. Running that
// against a database 21 chargers write to would fail on the first table and,
// worse, a `push` would try to reconcile the difference.
//
// So the handover is a baseline: record the generated migration's hash in
// drizzle.__drizzle_migrations so `drizzle-kit migrate` considers it done,
// and every LATER `generate` diffs against its snapshot and produces only
// the real delta.
//
// The table shape below is copied from drizzle-orm/pg-core/dialect.js
// `migrate()` — schema `drizzle`, table `__drizzle_migrations`, columns
// (id serial, hash text, created_at bigint), and the hash is
// sha256(migration file contents). If drizzle-orm changes any of that this
// script silently stops matching, which is why --verify exists.
//
// SCOPE: THE COLD BASELINE ONLY
// -----------------------------
// This helper records ONLY the baseline entry (0000_cold_hex) as applied. Every
// later journal entry (0001 restores 11 constraints that are NOT in the
// existing tables) is left pending: run it with the migration runner so the SQL
// actually executes. Recording a later hash here would make
// `drizzle-kit migrate` skip SQL that never ran. If the journal no longer
// starts with 0000_cold_hex, or the table already holds other history, the
// script refuses. Logic lives in drizzle-baseline-lib.mjs (unit-tested with a
// fake client, no database).
//
// USAGE (exactly one mode; combining flags is an error)
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs              # preview: READ ONLY, writes nothing
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs --apply      # records the baseline hash only
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs --verify     # READ ONLY, baseline only
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs --verify-all # READ ONLY, whole chain; exit 1 if any pending
//
// Preview and verify run in a BEGIN READ ONLY transaction: Postgres itself
// rejects a write. `--verify` / `--verify-all` check the migration LEDGER (recorded
// hashes vs the files); they do not prove any SQL ran or any constraint exists, and
// a passing `--verify` does NOT mean 0001+ were applied.
//
// RULE 3: pass the connection string explicitly. RULE: staging needs
// go-ahead — --apply writes to a shared branch.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { parseMode, readJournalEntries, run } from "./drizzle-baseline-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FOLDER = path.join(HERE, "..", "drizzle");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

let mode;
let entries;
try {
  mode = parseMode(process.argv.slice(2));
  entries = readJournalEntries(FOLDER);
} catch (err) {
  console.error(`  refused: ${err.message}`);
  process.exit(2);
}

const c = new Client({ connectionString: url });
await c.connect();
console.log(`  mode ${mode}, target ${url.match(/@([^/]+)\//)?.[1]}`);

let code = 0;
try {
  const { ok } = await run({ client: c, entries, mode, log: (m) => console.log(m) });
  code = ok ? 0 : 1;
} catch (err) {
  console.error(`  refused: ${err.message}`);
  code = 2;
} finally {
  await c.end();
}
process.exit(code);
