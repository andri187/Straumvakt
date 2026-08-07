#!/usr/bin/env node
//
// Run every check, report every result.
//
// `npm run check` used to be `a && b && c && ...`, which stops at the first
// failure. That is how check:schema-parity stayed invisible while it was RED:
// typecheck died ahead of it in the chain, so nobody saw the parity error
// underneath, and the two Prisma schemas drifted twice.
//
// A gate you cannot see fail is not a gate. This runs all of them and prints
// a summary, exiting non-zero if any failed.
import { spawnSync } from "node:child_process";

const CHECKS = [
  ["typecheck", "npm run typecheck"],
  ["schemas", "npm run check:schemas"],
  ["api-schema", "npm run check:api-schema"],
  // Replaced check:schema-parity on 2026-08-07 (ADR 0051). That one ran
  // `prisma migrate diff` between prisma/schema and apps/api/prisma/schema —
  // two copies of the same files, one generated from the other, so it could
  // only ever catch a stale copy that check:api-schema already catches.
  // Drizzle is authoritative now, and this catches the divergence that can
  // actually happen: Drizzle and Prisma describing different databases while
  // ~500 un-ported calls still use the Prisma client. It goes away with them.
  ["schema-consistency", "npm run check:schema-consistency"],
  ["deps", "npm run check:deps"],
  ["deps-graph", "npm run check:deps-graph"],
  ["api-endpoints", "npm run check:api-endpoints"],
  ["unused-exports", "npm run check:unused-exports"],
];

const results = [];
for (const [name, cmd] of CHECKS) {
  process.stdout.write(`\n─── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}\n`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  results.push([name, r.status === 0]);
}

const failed = results.filter(([, ok]) => !ok);
process.stdout.write(`\n${"═".repeat(66)}\n`);
for (const [name, ok] of results) process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${name}\n`);
process.stdout.write(`${"═".repeat(66)}\n`);

if (failed.length) {
  process.stdout.write(`\n${failed.length} of ${results.length} checks failed: ${failed.map(([n]) => n).join(", ")}\n`);
  process.exit(1);
}
process.stdout.write(`\nall ${results.length} checks passed\n`);
