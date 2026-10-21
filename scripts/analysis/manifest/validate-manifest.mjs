#!/usr/bin/env node
// Offline environment-manifest validator.
//
// SAFETY PROPERTIES, deliberate and testable:
//   * No network. It imports only node:fs and node:path. There is no fetch,
//     no http/https import, no child_process, no dynamic import of anything
//     outside this directory.
//   * No mutation. It only reads the files named on the command line and
//     writes to stdout/stderr. It never writes a file and never touches any
//     control plane.
//   * No secrets. Beyond schema validation it applies a POLICY check that
//     rejects anything value-shaped in a secretNames array, so a manifest
//     cannot smuggle a credential into the repository.
//
// A manifest is documentation of intent. Nothing applies it.
//
// Usage:
//   node validate-manifest.mjs fixtures/*.json
//   node validate-manifest.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'environment-manifest.schema.json'), 'utf8'));

// ── Minimal JSON Schema subset validator ─────────────────────────────
// Deliberately hand-rolled rather than pulling a dependency: this must run
// with zero install, and the subset used by the schema is small.

function validate(node, schema, path, errs, root) {
  if (schema.$ref) {
    const key = schema.$ref.replace('#/$defs/', '');
    return validate(node, root.$defs[key], path, errs, root);
  }
  if (schema.const !== undefined && node !== schema.const) {
    errs.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(node)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(node)) {
    errs.push(`${path}: ${JSON.stringify(node)} not in [${schema.enum.join(', ')}]`);
    return;
  }
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  if (types) {
    const actual = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
    const ok = types.some((t) => (t === 'integer' ? Number.isInteger(node) : t === actual));
    if (!ok) {
      errs.push(`${path}: expected ${types.join('|')}, got ${actual}`);
      return;
    }
  }
  if (node === null) return;

  if (typeof node === 'string') {
    if (schema.minLength != null && node.length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(node)) errs.push(`${path}: ${JSON.stringify(node)} fails /${schema.pattern}/`);
  }
  if (typeof node === 'number' && schema.minimum != null && node < schema.minimum) {
    errs.push(`${path}: ${node} < minimum ${schema.minimum}`);
  }
  if (Array.isArray(node)) {
    if (schema.minItems != null && node.length < schema.minItems) errs.push(`${path}: needs >= ${schema.minItems} items`);
    if (schema.items) node.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errs, root));
    return;
  }
  if (node && typeof node === 'object') {
    for (const r of schema.required ?? []) {
      if (!(r in node)) errs.push(`${path}: missing required "${r}"`);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(node)) {
        if (!(k in schema.properties)) errs.push(`${path}: unexpected property "${k}"`);
      }
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in node) validate(node[k], sub, `${path}.${k}`, errs, root);
    }
  }
}

// ── Policy checks — beyond the schema ────────────────────────────────
// These encode judgements the schema cannot express.

function policy(m, errs, warns) {
  // P1. Never allow anything value-shaped where only names belong.
  const valueShaped = /[=:/]|.{41,}|^[A-Za-z0-9+/]{24,}={0,2}$/;
  for (const w of m.workers ?? []) {
    for (const s of w.secretNames ?? []) {
      if (valueShaped.test(s)) errs.push(`POLICY: workers[${w.name}].secretNames contains something value-shaped: "${s.slice(0, 12)}…"`);
    }
  }
  // P2. Real customer data may not permit test identities.
  if (m.data?.classification === 'real-customer' && m.data?.allowedTestIdentities === true) {
    errs.push('POLICY: real-customer data must not allow test identities');
  }
  // P3. A production environment claiming "deployed" needs a rollback target.
  if (m.environment === 'production' && m.status === 'deployed') {
    for (const w of m.workers ?? []) {
      if (!w.versionId) errs.push(`POLICY: production worker "${w.name}" is deployed with no recorded versionId — no rollback target`);
    }
  }
  // P4. Production must not share a Neon branch with beta.
  if (m.environment === 'production' && m.data?.neonBranch === 'staging') {
    errs.push('POLICY: production must not use the beta Neon branch');
  }
  // P5. Renaming a Worker pinned by a shipped client is a breaking change.
  for (const w of m.workers ?? []) {
    if (w.pinnedByExternalClient && m.status === 'proposed') {
      warns.push(`WARN: worker "${w.name}" is pinned by a shipped client — a rename breaks installed clients and cannot be rolled back`);
    }
  }
  // P6. Service-binding targets should be declared workers where possible.
  const names = new Set((m.workers ?? []).map((w) => w.name));
  for (const w of m.workers ?? []) {
    for (const b of w.serviceBindings ?? []) {
      if (!names.has(b.target)) warns.push(`WARN: ${w.name}.${b.binding} targets "${b.target}", not declared in this manifest`);
    }
  }
  // P7. An unknown must be null, never a guess.
  for (const w of m.workers ?? []) {
    if (w.deployed === undefined) warns.push(`WARN: worker "${w.name}" omits "deployed"; use null to mean UNKNOWN`);
  }
}

function check(file) {
  const errs = [];
  const warns = [];
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { file, errs: [`unparseable: ${e.message}`], warns: [] };
  }
  validate(doc, SCHEMA, '$', errs, SCHEMA);
  if (errs.length === 0) policy(doc, errs, warns);
  return { file, errs, warns };
}

// ── Self-test against fixtures ───────────────────────────────────────
// Each fixture encodes its expectation in its filename: *.valid.json must
// pass, *.invalid.json must fail. A validator that cannot fail is useless,
// so the negative fixtures are the important ones.

function selfTest() {
  const dir = join(HERE, 'fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0;
  let fail = 0;
  for (const f of files) {
    const expectValid = f.includes('.valid.');
    const r = check(join(dir, f));
    const isValid = r.errs.length === 0;
    const ok = isValid === expectValid;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (expected ${expectValid ? 'valid' : 'invalid'}, got ${isValid ? 'valid' : 'invalid'})`);
    if (!ok) {
      fail++;
      r.errs.forEach((e) => console.log(`          ${e}`));
    } else {
      pass++;
      if (!expectValid) r.errs.slice(0, 2).forEach((e) => console.log(`          rejected because: ${e}`));
    }
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  process.exit(selfTest());
}
if (args.length === 0) {
  console.error('usage: node validate-manifest.mjs <file.json>... | --self-test');
  process.exit(2);
}
let bad = 0;
for (const f of args) {
  const r = check(f);
  if (r.errs.length) {
    bad++;
    console.log(`INVALID ${basename(f)}`);
    r.errs.forEach((e) => console.log(`  ERROR ${e}`));
  } else {
    console.log(`VALID   ${basename(f)}`);
  }
  r.warns.forEach((w) => console.log(`  ${w}`));
}
process.exit(bad ? 1 : 0);
