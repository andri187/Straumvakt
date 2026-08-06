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
  ["schema-parity", "npm run check:schema-parity"],
  ["deps", "npm run check:deps"],
  ["deps-graph", "npm run check:deps-graph"],
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
