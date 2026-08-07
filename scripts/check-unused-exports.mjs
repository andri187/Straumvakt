#!/usr/bin/env node
//
// Exported FUNCTIONS that nothing references.
//
// dependency-cruiser already finds orphan modules — files nobody imports.
// This finds the next layer down: live files still carrying functions nobody
// calls. That is where dead code hides once the obvious files are gone, and
// it is how a no-op stub survived months past the commit that was supposed to
// delete it (runZaptecChargerStatusCron, removed 2026-08-06 — its own comment
// said "remove after the index.ts cron block is updated", and index.ts had
// been updated).
//
// FUNCTIONS ONLY, deliberately. Exported types and interfaces are legitimate
// API surface whether or not anything imports them today; flagging 279 of
// those buries the ~20 that matter.
//
// Deliberately conservative: a name counts as used if it appears anywhere
// outside its own file, including in a comment or a string. A false "used" is
// harmless; a false "dead" gets something deleted.
//
// Baselined, like dependency-cruiser. The point is to stop NEW dead functions,
// not to demand the existing ones be cleared today — several are deliberately
// ahead of their caller (people.vehicles has no UI yet) and several are
// billing, which is frozen pending ADR 0025 D1-D5.
//
//   node scripts/check-unused-exports.mjs             fail on anything unbaselined
//   node scripts/check-unused-exports.mjs --baseline  rewrite the baseline
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "apps/api/src");
// Parity tests live OUTSIDE src/ and are real callers. Without this, every
// repository test converted from a fake client to test/parity/ makes its
// subject look newly unused — which happened to findEmailDomainByDomain on
// 2026-08-07 and would have been baselined as a false positive.
const TEST = path.join(ROOT, "apps/api/test");
const BASELINE = path.join(ROOT, ".unused-exports-known.json");
const rewrite = process.argv.includes("--baseline");

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "generated") walk(p); }
    else if (e.name.endsWith(".ts")) files.push(p);
  }
};
walk(SRC);
const srcCount = files.length;
if (fs.existsSync(TEST)) walk(TEST);

const text = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const EXPORT_FN = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;

const found = [];
for (const f of files) {
  if (f.endsWith(".test.ts")) continue;
  // Only report on src/ files; test files are callers, never subjects.
  if (files.indexOf(f) >= srcCount) continue;
  const rest = files.filter((g) => g !== f).map((g) => text.get(g)).join("\n");
  for (const m of text.get(f).matchAll(EXPORT_FN)) {
    if (!new RegExp(`\\b${m[1]}\\b`).test(rest)) {
      found.push(`${path.relative(SRC, f).split(path.sep).join("/")}#${m[1]}`);
    }
  }
}
found.sort();

if (rewrite) {
  fs.writeFileSync(BASELINE, JSON.stringify(found, null, 2) + "\n");
  console.log(`baselined ${found.length} unused exported functions.`);
  process.exit(0);
}

const known = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : [];
const knownSet = new Set(known);
const isNew = found.filter((x) => !knownSet.has(x));
const goneStale = known.filter((x) => !found.includes(x));

if (isNew.length) {
  console.error(`${isNew.length} newly-unused exported function(s):`);
  for (const x of isNew) console.error(`  ${x}`);
  console.error("\nEither something stopped calling it, or it was added without a caller.");
  console.error("If it is deliberately ahead of its caller, run --baseline and say why in the commit.");
  process.exit(1);
}
console.log(
  `no new unused exports (${found.length} known${goneStale.length ? `, ${goneStale.length} baseline entries now resolved — rerun --baseline` : ""}).`,
);
