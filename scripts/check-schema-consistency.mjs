#!/usr/bin/env node
//
// Drizzle (authoritative) vs Prisma (downstream) — do they still describe the
// same database?
//
// WHY THIS REPLACED check:schema-parity
// -------------------------------------
// That check ran `prisma migrate diff` between prisma/schema and
// apps/api/prisma/schema — two copies of the SAME file set, one generated
// from the other by sync-api-prisma-schema.mjs. It could only ever catch a
// stale copy, which check:api-schema already catches.
//
// Since ADR 0051 the Drizzle declarations in packages/shared/src/db are the
// source of truth: a schema change starts there and `drizzle-kit generate`
// writes the SQL. But prisma/schema still exists, because ~500 un-ported
// calls need the generated Prisma client. So the two CAN diverge, and a
// divergence means the Prisma client is lying to the code still using it.
//
// This compares the two sets of tables and columns. It needs no database, so
// it runs in CI where the parity suite cannot.
//
// It goes away with the last Prisma call.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRISMA_DIR = path.join(ROOT, "prisma/schema");
const DRIZZLE_DIR = path.join(ROOT, "packages/shared/src/db");

// ── Prisma: model -> "pgschema.table" + column set ─────────────────────────
//
// Two passes, because telling a COLUMN from a RELATION needs the full model
// list and neither shape is self-describing:
//
//   modem   Modem?     <- 1:1 back-relation. No @relation, no []. Looks
//                         exactly like a column.
//   roles   String[]   <- a scalar array IS a column, despite the [].
//
// A single-pass guess gets both wrong, and a confident false report is worse
// than no check at all.
const prismaFiles = fs.readdirSync(PRISMA_DIR).filter((x) => x.endsWith(".prisma"));
const MODEL_NAMES = new Set();
for (const f of prismaFiles) {
  const src = fs.readFileSync(path.join(PRISMA_DIR, f), "utf8");
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{/gm)) MODEL_NAMES.add(m[1]);
}

const prismaTables = new Map();
for (const f of prismaFiles) {
  const lines = fs.readFileSync(path.join(PRISMA_DIR, f), "utf8").split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^model\s+(\w+)\s*\{/);
    if (m) { cur = { name: m[1], table: null, schema: null, cols: new Set() }; continue; }
    if (!cur) continue;
    const mm = l.match(/^@@map\("([^"]+)"\)/); if (mm) { cur.table = mm[1]; continue; }
    const sm = l.match(/^@@schema\("([^"]+)"\)/); if (sm) { cur.schema = sm[1]; continue; }
    if (l.startsWith("@@") || l.startsWith("//") || l === "" || l === "}") {
      if (raw === "}") {
        if (cur.schema) prismaTables.set(`${cur.schema}.${cur.table ?? cur.name}`, cur.cols);
        cur = null;
      }
      continue;
    }
    const fm = l.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
    if (!fm) continue;
    const [, field, type, , , rest] = fm;
    // A field whose TYPE is a model is a relation — list or not, @relation or
    // not. Everything else is a column, including scalar arrays.
    if (MODEL_NAMES.has(type)) continue;
    const mapped = rest.match(/@map\("([^"]+)"\)/);
    cur.cols.add(mapped ? mapped[1] : field);
  }
}

// ── Drizzle: "pgschema.table" + column set ────────────────────────────────
const drizzleTables = new Map();
for (const f of fs.readdirSync(DRIZZLE_DIR).filter((x) => x.endsWith(".ts"))) {
  const src = fs.readFileSync(path.join(DRIZZLE_DIR, f), "utf8");
  const schemaVar = new Map();
  for (const m of src.matchAll(/export const (\w+)\s*=\s*pgSchema\("([^"]+)"\)/g)) {
    schemaVar.set(m[1], m[2]);
  }
  const re = /export const \w+\s*=\s*(\w+)\.table\(\s*\n?\s*"([^"]+)",\s*\{([\s\S]*?)\n\s*\}/g;
  for (const m of src.matchAll(re)) {
    const pg = schemaVar.get(m[1]);
    if (!pg) continue;
    const cols = new Set();
    for (const c of m[3].matchAll(/^\s{4}\w+:\s*\w+\(\s*"([^"]+)"/gm)) cols.add(c[1]);
    drizzleTables.set(`${pg}.${m[2]}`, cols);
  }
}

// ── Compare ───────────────────────────────────────────────────────────────
const problems = [];
for (const [t, dcols] of drizzleTables) {
  const pcols = prismaTables.get(t);
  if (!pcols) { problems.push(`  ${t} — declared in Drizzle, missing from Prisma`); continue; }
  const onlyD = [...dcols].filter((c) => !pcols.has(c));
  const onlyP = [...pcols].filter((c) => !dcols.has(c));
  if (onlyD.length) problems.push(`  ${t} — columns only in Drizzle: ${onlyD.join(", ")}`);
  if (onlyP.length) problems.push(`  ${t} — columns only in Prisma:  ${onlyP.join(", ")}`);
}
for (const t of prismaTables.keys()) {
  if (!drizzleTables.has(t)) problems.push(`  ${t} — declared in Prisma, missing from Drizzle`);
}

if (problems.length) {
  console.error(
    `Drizzle and Prisma disagree about the schema (${problems.length} difference(s)).\n\n` +
      problems.join("\n") +
      `\n\nDrizzle is authoritative (ADR 0051). Mirror the change into\n` +
      `prisma/schema/, then run \`npm run sync:api-schema\`.\n`,
  );
  process.exit(1);
}
console.log(
  `Drizzle and Prisma agree (${drizzleTables.size} tables, ` +
    `${[...drizzleTables.values()].reduce((a, s) => a + s.size, 0)} columns).`,
);
