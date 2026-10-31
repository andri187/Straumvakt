#!/usr/bin/env node
//
// Drizzle-led validation of the ADOPTED path's schema. No database, no network,
// no Prisma.
//
// It answers three questions the old Prisma-mirror check could not:
//
//   1. DRIFT  Do the Drizzle declarations in packages/shared/src/db still match the
//      latest migration snapshot? `drizzle-kit generate` is run into a THROWAWAY
//      directory seeded with a copy of apps/api/drizzle; if it would write a new
//      migration, the snapshot is stale and this fails. (It never touches
//      apps/api/drizzle and never connects anywhere.)
//   2. CHAIN  Is the journal contiguous (idx 0..n), does every entry have its SQL
//      file and snapshot, and does every snapshot's `prevId` equal its
//      predecessor's `id`?
//   3. SAFETY Is every migration after the baseline additive (no DROP TABLE /
//      COLUMN / SCHEMA / SEQUENCE, no unapproved data statement)? Migration 0008's
//      exact reviewed identity-column backfill is the sole exception. Hand-written CHECKs live in
//      the SQL tail that snapshots cannot express, so the named ones are required.
//
// What this does NOT prove: that the SQL executes, that constraints hold, or that
// the real database matches. Those need an approved PostgreSQL run.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasUnapprovedDataStatement } from "./adopted-migration-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE = path.join(ROOT, "apps/api/drizzle");
const problems = [];
const fail = (m) => problems.push(m);

// ── 2. chain ────────────────────────────────────────────────────────────
const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8"));
const snaps = [];
journal.entries.forEach((e, i) => {
  if (e.idx !== i) fail(`journal entry ${i} has idx ${e.idx}`);
  const sql = path.join(DRIZZLE, `${e.tag}.sql`);
  const snap = path.join(DRIZZLE, `meta/${String(i).padStart(4, "0")}_snapshot.json`);
  if (!fs.existsSync(sql)) fail(`${e.tag}.sql is missing`);
  if (!fs.existsSync(snap)) fail(`snapshot ${String(i).padStart(4, "0")} is missing`);
  else snaps.push(JSON.parse(fs.readFileSync(snap, "utf8")));
});
for (let i = 1; i < snaps.length; i++) {
  if (snaps[i].prevId !== snaps[i - 1].id) fail(`snapshot ${i} prevId does not match snapshot ${i - 1} id`);
}

// ── 3. safety + named hand-written constraints ─────────────────────────
const REQUIRED = {
  "0002_installation_management": ["circuits_ampere_ceiling_non_negative", "installations_ocpp_password_verifier_matches_mode"],
  "0003_ocpp_engine_transactions": ["ocpp_transactions_unauthorized_never_costed", "protocol_receipts_payload_bounded", "ocpp_transactions_stop_fields_together"],
  "0004_sync_operational_state": ["device_operational_state_seq_positive", "installations_status_version_non_negative"],
  "0005_ocpp_costing_handoff": ["ocpp_transactions_costing_state_known", "ocpp_transactions_costed_has_timestamp"],
  "0006_charger_lifecycle": ["lifecycle_requests_one_open_per_device", "lifecycle_requests_state_known"],
  "0007_terms_snapshot": ["ocpp_transactions_terms_immutable"],
};
for (const e of journal.entries.slice(1)) {
  const sql = fs.readFileSync(path.join(DRIZZLE, `${e.tag}.sql`), "utf8");
  if (/\bDROP\s+(TABLE|COLUMN|SCHEMA|SEQUENCE)\b/i.test(sql)) fail(`${e.tag} drops a table/column/schema/sequence`);
  if (hasUnapprovedDataStatement(e.tag, sql)) fail(`${e.tag} contains an unapproved data statement`);
  for (const name of REQUIRED[e.tag] ?? []) if (!sql.includes(name)) fail(`${e.tag} lacks required constraint ${name}`);
}

// ── 1. drift (drizzle-kit generate into a throwaway dir) ───────────────
// Inside the repo (gitignored scratch), addressed RELATIVE to apps/api: drizzle-kit mangles absolute Windows
// paths in `out`, which would make a drift go unnoticed. The result is also required to be conclusive below.
const SCRATCH = path.join(ROOT, ".agent-mail", "adopted-schema-check");
fs.mkdirSync(SCRATCH, { recursive: true });
const tmp = fs.mkdtempSync(path.join(SCRATCH, "run-"));
try {
  fs.cpSync(DRIZZLE, tmp, { recursive: true });
  const cfgSrc = fs.readFileSync(path.join(ROOT, "apps/api/drizzle.config.ts"), "utf8");
  const cfgPath = path.join(ROOT, "apps/api/drizzle.check.config.ts");
  fs.writeFileSync(cfgPath, cfgSrc.replace('out: "./drizzle"', `out: ${JSON.stringify(path.relative(path.join(ROOT, "apps/api"), tmp).replaceAll("\\", "/"))}`));
  try {
    const before = new Set(fs.readdirSync(tmp));
    const r = spawnSync("npx", ["drizzle-kit", "generate", "--config", "drizzle.check.config.ts", "--name", "drift_probe"], { cwd: path.join(ROOT, "apps/api"), encoding: "utf8", shell: true, env: { ...process.env, DATABASE_URL: "" } });
    const out = `${r.stdout}\n${r.stderr}`;
    const created = fs.readdirSync(tmp).filter((f) => !before.has(f) && f.endsWith(".sql"));
    if (created.length > 0) fail(`schema drift: the Drizzle declarations differ from the latest snapshot (drizzle-kit would write ${created.join(", ")}):\n${fs.readFileSync(path.join(tmp, created[0]), "utf8")}`);
    else if (r.status !== 0 && !/No schema changes/i.test(out)) fail(`drizzle-kit generate failed:\n${out.slice(-800)}`);
  } finally {
    fs.rmSync(cfgPath, { force: true });
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`check-adopted-schema: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-adopted-schema: OK (${journal.entries.length} migrations, chain intact, no drift, approved migration policy). This does not prove the SQL executes.`);
