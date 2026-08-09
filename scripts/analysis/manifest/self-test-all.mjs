#!/usr/bin/env node
// One entry point for every offline check in scripts/analysis.
//
// Two validators with two self-tests is two chances to run only one, and the
// less-used one is the one that rots. This runs all of them and fails if any
// fails. It shells out to node deliberately: each checker stays independently
// runnable, and a crash in one does not take the others down.
//
// Usage: node self-test-all.mjs
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANALYSIS = resolve(HERE, '..');
const CHECKS = [
  ['environment manifests',  join(HERE, 'validate-manifest.mjs')],
  ['release manifests',      join(HERE, 'validate-release-manifest.mjs')],
  ['preservation manifests', join(HERE, 'validate-preservation-manifest.mjs')],
  ['wrangler configs',       join(ANALYSIS, 'lint', 'lint-wrangler.mjs')],
  ['branch safety',          join(ANALYSIS, 'git', 'check-branch-safety.mjs')],
];

let failed = 0, total = 0;
for (const [label, script] of CHECKS) {
  const r = spawnSync(process.execPath, [script, '--self-test'], { encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0, fails = m ? Number(m[2]) : 1;
  total += passed + fails;
  if (r.status !== 0 || fails) { failed += fails || 1; console.log(`FAIL  ${label}`); console.log(out); }
  else console.log(`ok    ${label.padEnd(22)} ${passed} fixtures`);
}
console.log(`\n${failed ? 'FAILED' : 'ALL GREEN'} — ${total - failed}/${total} fixtures across ${CHECKS.length} checkers`);
process.exit(failed ? 1 : 0);
