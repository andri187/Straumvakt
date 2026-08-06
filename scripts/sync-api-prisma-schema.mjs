#!/usr/bin/env node
//
// Generate apps/api/prisma/schema/ from prisma/schema/.
//
// WHY THIS EXISTS
// ---------------
// There are two Prisma schemas in this repo and there always will be: the
// console (Next.js on Workers, via OpenNext) and the API Worker generate
// different clients to different places with different bundling steps.
// Only the *generator* blocks differ — the ~157 models are meant to be
// byte-identical.
//
// They drifted anyway. `ArchiveWatermark` went missing from apps/api and
// nobody noticed until the 2026-08-03 audit, because `check:schema-parity`
// existed and nothing called it. Then it drifted a second time (the
// vendor-auth columns landed in the root schema only).
//
// Copying by hand is what failed twice. So the API's model files are now a
// build artefact: this script writes them, `--check` fails if the tree is
// stale, and `npm run check` runs `--check`. The only hand-maintained file
// on the API side is header.prisma, which holds its generator block.
//
// USAGE
//   node scripts/sync-api-prisma-schema.mjs           write
//   node scripts/sync-api-prisma-schema.mjs --check   verify, exit 1 if stale
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "prisma", "schema");
const OUT_DIR = path.join(ROOT, "apps", "api", "prisma", "schema");
const API_HEADER = path.join(ROOT, "apps", "api", "prisma", "header.prisma");

// prisma/schema/schema.prisma carries the console's generators + datasource.
// The API supplies its own; everything else is copied verbatim.
const HEADER_FILE = "schema.prisma";

const check = process.argv.includes("--check");

const BANNER = [
  "// ╔══════════════════════════════════════════════════════════════════════╗",
  "// ║  GENERATED FILE — DO NOT EDIT                                        ║",
  "// ║                                                                      ║",
  "// ║  Source:    prisma/schema/%SRC%",
  "// ║  Generator: scripts/sync-api-prisma-schema.mjs                       ║",
  "// ║                                                                      ║",
  "// ║  Edit the source, then run `npm run sync:api-schema`.                ║",
  "// ║  `npm run check` fails if this file is stale.                        ║",
  "// ╚══════════════════════════════════════════════════════════════════════╝",
  "",
];

function bannerFor(name) {
  return BANNER.map((l) => l.replace("%SRC%", name)).join("\n");
}

if (!fs.existsSync(API_HEADER)) {
  console.error(`missing ${path.relative(ROOT, API_HEADER)} — it holds the API's generator block and is hand-maintained`);
  process.exit(1);
}

// The datasource must be identical on both sides or the schemas are not the
// same database. Lift it out of the console header rather than duplicating
// the 20-schema list into a second file that can rot.
const consoleHeader = fs.readFileSync(path.join(SRC_DIR, HEADER_FILE), "utf8");
const datasource = consoleHeader.match(/^datasource\s+db\s*\{[\s\S]*?^\}/m);
if (!datasource) {
  console.error("could not find the datasource block in prisma/schema/schema.prisma");
  process.exit(1);
}

const domainFiles = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.endsWith(".prisma") && f !== HEADER_FILE)
  .sort();

if (domainFiles.length === 0) {
  console.error("no domain files found in prisma/schema/");
  process.exit(1);
}

/** @type {Record<string,string>} */
const want = {};

for (const f of domainFiles) {
  want[f] = bannerFor(f) + "\n" + fs.readFileSync(path.join(SRC_DIR, f), "utf8");
}
want[HEADER_FILE] =
  bannerFor("schema.prisma (datasource only — generator is apps/api/prisma/header.prisma)") +
  "\n" +
  fs.readFileSync(API_HEADER, "utf8").replace(/\s*$/, "") +
  "\n\n" +
  datasource[0] +
  "\n";

// Normalise line endings so a CRLF checkout does not read as stale.
const norm = (s) => s.replace(/\r\n/g, "\n");

let stale = [];

fs.mkdirSync(OUT_DIR, { recursive: true });

// Anything in the output dir that is not produced here is a leftover.
for (const existing of fs.readdirSync(OUT_DIR)) {
  if (!(existing in want)) {
    stale.push(`${existing} (orphan — no longer generated)`);
    if (!check) fs.rmSync(path.join(OUT_DIR, existing), { recursive: true, force: true });
  }
}

for (const [name, content] of Object.entries(want)) {
  const dest = path.join(OUT_DIR, name);
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (current === null || norm(current) !== norm(content)) {
    stale.push(current === null ? `${name} (missing)` : `${name} (differs)`);
    if (!check) fs.writeFileSync(dest, content, "utf8");
  }
}

if (check) {
  if (stale.length) {
    console.error("apps/api/prisma/schema/ is out of date with prisma/schema/:");
    for (const s of stale) console.error(`  - ${s}`);
    console.error("\nRun `npm run sync:api-schema` and commit the result.");
    process.exit(1);
  }
  console.log(`apps/api/prisma/schema/ is in sync (${Object.keys(want).length} files).`);
} else {
  if (stale.length) {
    console.log(`wrote apps/api/prisma/schema/ (${stale.length} changed):`);
    for (const s of stale) console.log(`  - ${s}`);
  } else {
    console.log(`apps/api/prisma/schema/ already in sync (${Object.keys(want).length} files).`);
  }
}
