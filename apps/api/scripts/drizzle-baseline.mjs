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
// USAGE
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs            # dry run
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs --apply
//   DATABASE_URL=... node scripts/drizzle-baseline.mjs --verify
//
// RULE 3: pass the connection string explicitly. RULE: staging needs
// go-ahead — this writes to a shared branch.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FOLDER = path.join(HERE, "..", "drizzle");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");

const journal = JSON.parse(fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"));
const entries = journal.entries.map((e) => {
  const sql = fs.readFileSync(path.join(FOLDER, `${e.tag}.sql`), "utf8");
  return {
    tag: e.tag,
    when: e.when,
    hash: crypto.createHash("sha256").update(sql).digest("hex"),
    statements: sql.split("--> statement-breakpoint").length,
  };
});

const c = new Client({ connectionString: url });
await c.connect();
console.log(`  target ${url.match(/@([^/]+)\//)?.[1]}`);

try {
  if (verify) {
    const { rows } = await c.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    const recorded = new Set(rows.map((r) => r.hash));
    let ok = true;
    for (const e of entries) {
      const hit = recorded.has(e.hash);
      console.log(`  ${hit ? "applied " : "PENDING "} ${e.tag}  ${e.hash.slice(0, 12)}`);
      if (!hit) ok = false;
    }
    // A hash in the table that no file produces means the files were edited
    // after being applied — drizzle would re-run nothing, but the snapshot
    // and the database have silently diverged.
    for (const r of rows) {
      if (!entries.some((e) => e.hash === r.hash)) {
        console.log(`  ORPHAN   recorded hash ${String(r.hash).slice(0, 12)} matches no file`);
        ok = false;
      }
    }
    process.exit(ok ? 0 : 1);
  }

  await c.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await c.query(
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  const { rows: existing } = await c.query("SELECT hash FROM drizzle.__drizzle_migrations");
  const have = new Set(existing.map((r) => r.hash));

  for (const e of entries) {
    if (have.has(e.hash)) {
      console.log(`  already baselined  ${e.tag}`);
      continue;
    }
    console.log(
      `  ${apply ? "BASELINING" : "would baseline"}  ${e.tag}  ` +
        `(${e.statements} statements, NOT executed)  ${e.hash.slice(0, 12)}`,
    );
    if (apply) {
      await c.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [
        e.hash,
        e.when,
      ]);
    }
  }
  if (!apply) console.log("\n  dry run — pass --apply to write");
} finally {
  await c.end();
}
