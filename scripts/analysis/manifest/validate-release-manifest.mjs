#!/usr/bin/env node
// Offline release-manifest validator.
//
// SAFETY, deliberate and inspectable:
//   * imports only node:fs and node:path/url — no fetch, no http/https,
//     no child_process, no dynamic import. It cannot reach a network.
//   * reads the files it is given; writes only to stdout/stderr.
//   * no dependency: the JSON Schema subset is hand-rolled so it runs with
//     zero install, including on a fork PR.
//
// A release manifest is EVIDENCE, not an instruction. Nothing applies it.
//
// Usage:
//   node validate-release-manifest.mjs releases/*.json
//   node validate-release-manifest.mjs --strict releases/prod.json   # warnings become errors
//   node validate-release-manifest.mjs --json releases/prod.json     # machine-readable
//   node validate-release-manifest.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'release-manifest.schema.json'), 'utf8'));
const KNOWN_WORKERS = JSON.parse(readFileSync(join(HERE, 'known-workers.json'), 'utf8'));
const FORBIDDEN = JSON.parse(readFileSync(join(HERE, 'forbidden-commits.json'), 'utf8'));

function validate(node, schema, path, errs, root) {
  if (schema.$ref) return validate(node, root.$defs[schema.$ref.replace('#/$defs/', '')], path, errs, root);
  if (schema.const !== undefined && node !== schema.const) {
    errs.push(`${path}: expected ${JSON.stringify(schema.const)}`); return;
  }
  if (schema.enum && !schema.enum.includes(node)) {
    errs.push(`${path}: ${JSON.stringify(node)} not in [${schema.enum.join(', ')}]`); return;
  }
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  if (types) {
    const actual = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
    if (!types.some((t) => (t === 'integer' ? Number.isInteger(node) : t === actual))) {
      errs.push(`${path}: expected ${types.join('|')}, got ${actual}`); return;
    }
  }
  if (node === null) return;
  if (typeof node === 'string') {
    if (schema.minLength != null && node.length < schema.minLength) errs.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(node)) errs.push(`${path}: ${JSON.stringify(node)} fails /${schema.pattern}/`);
  }
  if (typeof node === 'number' && schema.minimum != null && node < schema.minimum) errs.push(`${path}: below minimum`);
  if (Array.isArray(node)) {
    if (schema.minItems != null && node.length < schema.minItems) errs.push(`${path}: needs >= ${schema.minItems}`);
    if (schema.items) node.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errs, root));
    return;
  }
  if (node && typeof node === 'object') {
    for (const r of schema.required ?? []) if (!(r in node)) errs.push(`${path}: missing required "${r}"`);
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(node)) if (!(k in schema.properties)) errs.push(`${path}: unexpected property "${k}"`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const [k, v] of Object.entries(node)) validate(v, schema.additionalProperties, `${path}.${k}`, errs, root);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in node) validate(node[k], sub, `${path}.${k}`, errs, root);
  }
}

// ── Secret-shape detection, used by R5 and R10 ───────────────────────
// Deliberately targeted rather than broad: a rule that fires on ordinary prose
// gets disabled, and a disabled rule protects nothing.
const SECRET_SHAPES = [
  { re: /postgres(ql)?:\/\/[^\s]/i, why: 'looks like a Postgres DSN' },
  { re: /\bnpg_[A-Za-z0-9]{8,}/, why: 'looks like a Neon credential' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i, why: 'looks like a bearer token' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'looks like an AWS access key id' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, why: 'looks like a GitHub token' },
];
function secretShape(s) {
  for (const { re, why } of SECRET_SHAPES) if (re.test(s)) return why;
  // Long unbroken high-entropy run. Pure hex is excluded: git shas and
  // Cloudflare resource ids are legitimately 32-40 hex characters.
  const m = s.match(/[A-Za-z0-9+/=_-]{40,}/);
  if (m && !/^[0-9a-f]+$/.test(m[0]) && /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0]) && /[0-9]/.test(m[0])) {
    return 'long mixed-case high-entropy run';
  }
  return null;
}
function walkStrings(node, path, visit) {
  if (typeof node === 'string') return visit(node, path);
  if (Array.isArray(node)) return node.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walkStrings(v, `${path}.${k}`, visit);
}

// ── Policy: judgements the schema cannot express ─────────────────────
function policy(m, errs, warns) {
  const workers = m.workers ?? [];
  const names = workers.map((w) => w.name);
  const roles = new Set(workers.map((w) => w.role));
  const isProd = m.environment === 'production';

  // R1. Every Worker must have a recorded prior version — the rollback target.
  for (const n of names) {
    if (!m.rollback?.workerVersionsBefore || !m.rollback.workerVersionsBefore[n]) {
      errs.push(`R1 POLICY: no workerVersionsBefore for "${n}" — this release has no rollback target`);
    }
  }
  // R2. A production release must prove it ran in beta, and must be promoted.
  if (isProd) {
    if (!m.commit?.betaTestedSince) errs.push('R2 POLICY: production release must record betaTestedSince');
    if (m.sourceBranch !== 'staging') errs.push('R2 POLICY: production must be promoted from staging, not rebuilt');
  }
  // R17. Fast-forward must be verified, always. Promotion that is not a
  //      fast-forward silently drops or duplicates work.
  if (m.commit?.verifiedFastForward !== true) {
    errs.push('R17 POLICY: commit.verifiedFastForward must be true — prove it with rev-list --left-right --count showing 0 on the left');
  }
  // R3. A release containing the gateway must state OCPP endpoint continuity.
  //     Promoted from warning to error: this is the highest-consequence omission
  //     in the manifest, and the clients are physical equipment.
  if (roles.has('ocpp') && m.ocpp?.endpointUnchanged !== true) {
    errs.push('R3 POLICY: release includes an ocpp Worker but does not state ocpp.endpointUnchanged: true');
  }
  // R4. A Worker whose workers.dev host is pinned must declare workers_dev.
  for (const w of workers) {
    if (w.workersDevRequired && w.workersDevDeclaredInConfig !== true) {
      errs.push(`R4 POLICY: worker "${w.name}" has a pinned workers.dev host but does not declare workers_dev in config — adding routes would disable it`);
    }
  }
  // R5. Secret NAMES must not be values. Names are all a manifest ever needs.
  for (const w of workers) for (const s of w.secretNames ?? []) {
    const why = secretShape(s);
    if (why || /[=:/]/.test(s) || s.length > 40) {
      errs.push(`R5 POLICY: workers[${w.name}].secretNames contains something value-shaped${why ? ` (${why})` : ''}`);
    }
  }
  // R6. Production must not reuse a beta Neon branch.
  if (isProd && (KNOWN_WORKERS.betaNeonBranchIds ?? []).includes(m.data?.neonBranchId)) {
    errs.push(`R6 POLICY: production must not use the beta Neon branch "${m.data.neonBranchId}"`);
  }
  // R7. OCPP continuity is stated for non-gateway releases too, as a warning.
  if (!roles.has('ocpp') && m.ocpp?.endpointUnchanged !== true) {
    warns.push('R7 WARN: ocpp.endpointUnchanged is not true — confirm no field device is affected');
  }
  // R8. Service-binding targets should be declared workers.
  for (const w of workers) for (const b of w.serviceBindings ?? []) {
    if (!names.includes(b.target)) warns.push(`R8 WARN: ${w.name}.${b.binding} targets "${b.target}", not declared here`);
  }
  // R9. A backup branch is the only recovery beyond the 7-day PITR window.
  if (isProd && !m.data?.backupBranchId) {
    warns.push('R9 WARN: no backupBranchId — point-in-time restore is limited to 7 days');
  }
  // R10. No value-shaped string ANYWHERE. R5 guards the field a secret is least
  //      likely to be pasted into; `notes` is where it would actually happen.
  walkStrings(m, '$', (s, path) => {
    const why = secretShape(s);
    if (why) errs.push(`R10 POLICY: ${path} contains a value-shaped string (${why})`);
  });
  // R11. Worker names must be known. A typo validates perfectly and describes nothing.
  for (const w of workers) {
    if (!KNOWN_WORKERS.workers.includes(w.name) && !w.newWorkerJustification) {
      errs.push(`R11 POLICY: worker "${w.name}" is not a known Worker name and has no newWorkerJustification`);
    }
  }
  // R12. CPMS declares the same Worker names. A production release while another
  //      project can redeploy those names is not a controlled release.
  if (isProd && m.cpmsSeparationVerified !== true) {
    errs.push('R12 POLICY: production requires cpmsSeparationVerified: true — CPMS declares the same Worker names');
  }
  // R13. A gateway release alongside web/api means one rollback decision for
  //      three blast radii. Allowed, but only when acknowledged explicitly.
  if (roles.has('ocpp') && roles.size > 1 && m.ocpp?.mixedReleaseAcknowledged !== true) {
    errs.push('R13 POLICY: gateway is released alongside other Workers without ocpp.mixedReleaseAcknowledged — one rollback decision would cover three blast radii');
  }
  // R14. A rollback plan with an unmeasured duration is an estimate.
  if (isProd && (m.rollback?.restoreTimeMeasuredSec === null || m.rollback?.restoreTimeMeasuredSec === undefined)) {
    errs.push('R14 POLICY: production requires a measured rollback.restoreTimeMeasuredSec, not an estimate');
  }
  // R15. Forbidden commits must be listed as verified absent.
  const verified = new Set(m.approval?.excludedCommitsVerifiedAbsent ?? []);
  for (const sha of FORBIDDEN.shas) {
    if (!verified.has(sha)) {
      errs.push(`R15 POLICY: approval.excludedCommitsVerifiedAbsent does not include forbidden commit "${sha}"`);
    }
  }
  // R16. betaTestedSince must precede releasedAt. Both are strict UTC instants,
  //      so lexicographic comparison is exact and avoids timezone parsing.
  if (isProd && !m.releasedAt) errs.push('R16 POLICY: production requires releasedAt so ordering can be checked');
  if (m.releasedAt && m.commit?.betaTestedSince && m.commit.betaTestedSince >= m.releasedAt) {
    errs.push(`R16 POLICY: betaTestedSince (${m.commit.betaTestedSince}) is not before releasedAt (${m.releasedAt})`);
  }
}

function check(file) {
  const errs = [], warns = [];
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { return { file, errs: [`unparseable: ${e.message}`], warns }; }
  validate(doc, SCHEMA, '$', errs, SCHEMA);
  if (!errs.length) policy(doc, errs, warns);
  return { file, errs, warns };
}

// Three fixture classes, by filename:
//   *.valid.json   must pass in BOTH default and strict mode
//   *.invalid.json must fail
//   *.warns.json   must pass by default and FAIL under --strict. These prove the
//                  strict mode does something, which a valid/invalid split alone
//                  cannot show.
function selfTest() {
  const dir = join(HERE, 'release-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const kind = f.includes('.valid.') ? 'valid' : f.includes('.warns.') ? 'warns' : 'invalid';
    const r = check(join(dir, f));
    const isValid = r.errs.length === 0;
    let ok, note = '';
    if (kind === 'valid') {
      ok = isValid && r.warns.length === 0;
      if (isValid && r.warns.length) note = `  (unexpected warning: ${r.warns[0]})`;
    } else if (kind === 'warns') {
      ok = isValid && r.warns.length > 0;
      if (isValid && !r.warns.length) note = '  (expected a warning, got none — --strict would be a no-op here)';
    } else {
      ok = !isValid;
    }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (${kind})${note}`);
    if (ok) {
      pass++;
      if (kind === 'invalid') console.log(`          rejected: ${r.errs[0]}`);
      if (kind === 'warns') console.log(`          strict-only: ${r.warns[0]}`);
    } else { fail++; r.errs.forEach((e) => console.log(`          ${e}`)); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed  (${files.length} fixtures)`);
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());
const strict = args.includes('--strict');
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node validate-release-manifest.mjs [--strict] [--json] <file.json>... | --self-test');
  process.exit(2);
}
let bad = 0;
const results = [];
for (const f of files) {
  const r = check(f);
  // --strict: production must not proceed on a warning.
  if (strict && r.warns.length) { r.errs.push(...r.warns.map((w) => w.replace(' WARN:', ' STRICT:'))); r.warns = []; }
  if (r.errs.length) bad++;
  results.push({ file: basename(f), valid: r.errs.length === 0, errors: r.errs, warnings: r.warns });
  if (!asJson) {
    console.log(r.errs.length ? `INVALID ${basename(f)}` : `VALID   ${basename(f)}`);
    r.errs.forEach((e) => console.log(`  ERROR ${e}`));
    r.warns.forEach((w) => console.log(`  ${w}`));
  }
}
if (asJson) console.log(JSON.stringify({ strict, results }, null, 2));
process.exit(bad ? 1 : 0);
