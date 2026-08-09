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
//   node validate-release-manifest.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'release-manifest.schema.json'), 'utf8'));

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

// ── Policy: judgements the schema cannot express ─────────────────────
function policy(m, errs, warns) {
  const names = (m.workers ?? []).map((w) => w.name);

  // R1. Every Worker must have a recorded prior version — the rollback target.
  for (const n of names) {
    if (!m.rollback?.workerVersionsBefore || !m.rollback.workerVersionsBefore[n]) {
      errs.push(`POLICY: no workerVersionsBefore for "${n}" — this release has no rollback target`);
    }
  }
  // R2. A production release must prove it ran in beta first.
  if (m.environment === 'production') {
    if (!m.commit?.betaTestedSince) errs.push('POLICY: production release must record betaTestedSince');
    if (m.sourceBranch !== 'staging') errs.push('POLICY: production must be promoted from staging, not rebuilt');
  }
  // R3. Fast-forward must be verified, always.
  if (m.commit?.verifiedFastForward !== true) errs.push('POLICY: verifiedFastForward must be true');
  // R4. A Worker whose workers.dev host is pinned must declare workers_dev in config.
  for (const w of m.workers ?? []) {
    if (w.workersDevRequired && w.workersDevDeclaredInConfig !== true) {
      errs.push(`POLICY: worker "${w.name}" has a pinned workers.dev host but does not declare workers_dev in config — adding routes would disable it`);
    }
  }
  // R5. Never a secret value.
  const valueShaped = /[=:/]|.{41,}/;
  for (const w of m.workers ?? []) for (const s of w.secretNames ?? []) {
    if (valueShaped.test(s)) errs.push(`POLICY: workers[${w.name}].secretNames contains something value-shaped`);
  }
  // R6. Production must not use the beta Neon branch.
  if (m.environment === 'production' && m.data?.neonBranchId === 'br-tiny-river-abgpqq37') {
    errs.push('POLICY: production must not use the beta Neon branch');
  }
  // R7. OCPP continuity must be stated explicitly, not omitted.
  if (m.ocpp?.endpointUnchanged !== true) {
    warns.push('WARN: ocpp.endpointUnchanged is not true — confirm no field device is affected');
  }
  // R8. Service-binding targets should be declared workers.
  for (const w of m.workers ?? []) for (const b of w.serviceBindings ?? []) {
    if (!names.includes(b.target)) warns.push(`WARN: ${w.name}.${b.binding} targets "${b.target}", not declared here`);
  }
  // R9. A backup branch is the only recovery beyond the 7-day PITR window.
  if (m.environment === 'production' && !m.data?.backupBranchId) {
    warns.push('WARN: no backupBranchId — point-in-time restore is limited to 7 days');
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

function selfTest() {
  const dir = join(HERE, 'release-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const expectValid = f.includes('.valid.');
    const r = check(join(dir, f));
    const isValid = r.errs.length === 0;
    const ok = isValid === expectValid;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (expected ${expectValid ? 'valid' : 'invalid'})`);
    if (ok) { pass++; if (!expectValid) r.errs.slice(0, 1).forEach((e) => console.log(`          rejected: ${e}`)); }
    else { fail++; r.errs.forEach((e) => console.log(`          ${e}`)); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());
if (!args.length) { console.error('usage: node validate-release-manifest.mjs <file.json>... | --self-test'); process.exit(2); }
let bad = 0;
for (const f of args) {
  const r = check(f);
  if (r.errs.length) { bad++; console.log(`INVALID ${basename(f)}`); r.errs.forEach((e) => console.log(`  ERROR ${e}`)); }
  else console.log(`VALID   ${basename(f)}`);
  r.warns.forEach((w) => console.log(`  ${w}`));
}
process.exit(bad ? 1 : 0);
