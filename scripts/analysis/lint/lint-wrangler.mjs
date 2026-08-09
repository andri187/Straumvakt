#!/usr/bin/env node
// Offline wrangler-config linter.
//
// It exists for one reason. Cloudflare infers `workers_dev = false` the moment a
// `routes` array appears in an environment. So a diff that reads as "add a custom
// domain" — small, reasonable, easy to approve — silently removes the
// *.workers.dev hostname. In this project the shipped mobile app pins the API's
// workers.dev host, and the OCPP gateway's clients are chargers in the field.
// The failure is invisible server-side: the Worker is healthy, the deploy
// succeeded, and only the pinned clients notice.
//
// This check is worth having as code rather than as a document because the
// document is not present in the review.
//
// SAFETY: imports only node:fs / node:path / node:url. No network, no shell, no
// writes. It reads configs and prints findings.
//
// Usage:
//   node lint-wrangler.mjs                 # lint the repo's three configs
//   node lint-wrangler.mjs <file>...       # lint specific files
//   node lint-wrangler.mjs --self-test     # run against fixtures

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const DEFAULT_CONFIGS = ['wrangler.jsonc', 'apps/api/wrangler.jsonc', 'gateway/wrangler.jsonc'];

// Minimal JSONC reader: strips // and /* */ comments outside string literals,
// and trailing commas. Hand-rolled so the linter stays dependency-free.
function parseJsonc(text) {
  let out = '', inStr = false, esc = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (line) { if (c === '\n') { line = false; out += c; } continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// An "environment" for our purposes is the top-level config plus each named
// env.* block. Wrangler resolves each independently, so each is checked on its
// own — a `workers_dev` at the top level does NOT cover a named environment.
function environments(cfg) {
  const list = [{ label: 'top-level', node: cfg }];
  for (const [name, node] of Object.entries(cfg.env ?? {})) {
    list.push({ label: `env.${name}`, node });
  }
  return list;
}

const RULES = [
  {
    id: 'L1',
    title: 'routes without an explicit workers_dev',
    check: (env) => {
      const hasRoutes = Array.isArray(env.node.routes) && env.node.routes.length > 0;
      const declares = Object.prototype.hasOwnProperty.call(env.node, 'workers_dev');
      if (hasRoutes && !declares) {
        return `declares routes but not workers_dev — Cloudflare infers workers_dev=false, silently removing the *.workers.dev hostname`;
      }
      return null;
    },
    severity: 'error',
  },
  {
    id: 'L2',
    title: 'no routes and no workers_dev (latent)',
    check: (env) => {
      const hasRoutes = Array.isArray(env.node.routes) && env.node.routes.length > 0;
      const declares = Object.prototype.hasOwnProperty.call(env.node, 'workers_dev');
      if (!hasRoutes && !declares && env.node.name) {
        return `declares neither routes nor workers_dev — the live hostname state is inferred, not declared, so adding routes later would disable it without appearing to`;
      }
      return null;
    },
    severity: 'warn',
  },
  {
    id: 'L3',
    title: 'service binding target recorded',
    check: (env) => {
      const bindings = env.node.services ?? [];
      const byName = bindings.filter((b) => b.service).map((b) => `${b.binding}->${b.service}`);
      if (byName.length) {
        return `binds another Worker BY NAME (${byName.join(', ')}) — a rename of the target breaks this binding and must be made in the same change`;
      }
      return null;
    },
    severity: 'info',
  },
];

function lintFile(file) {
  const findings = [];
  let cfg;
  try { cfg = parseJsonc(readFileSync(file, 'utf8')); }
  catch (e) { return [{ id: 'L0', severity: 'error', env: '-', message: `unparseable: ${e.message}` }]; }
  for (const env of environments(cfg)) {
    for (const rule of RULES) {
      const msg = rule.check(env);
      if (msg) findings.push({ id: rule.id, severity: rule.severity, env: env.label, name: env.node.name ?? '(unnamed)', message: msg });
    }
  }
  return findings;
}

function report(files) {
  let errors = 0;
  for (const f of files) {
    const findings = lintFile(f);
    const label = relative(REPO, f) || basename(f);
    if (!findings.length) { console.log(`OK      ${label}`); continue; }
    console.log(`        ${label}`);
    for (const x of findings) {
      const tag = x.severity === 'error' ? 'ERROR ' : x.severity === 'warn' ? 'WARN  ' : 'INFO  ';
      if (x.severity === 'error') errors++;
      console.log(`  ${tag}${x.id} [${x.env} ${x.name}] ${x.message}`);
    }
  }
  return errors;
}

function selfTest() {
  const dir = join(HERE, 'wrangler-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonc')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    // Filename encodes the expected outcome: *.error.jsonc must produce an L1
    // error; *.latent.jsonc must produce an L2 warning and no error;
    // *.clean.jsonc must produce neither.
    const kind = f.includes('.error.') ? 'error' : f.includes('.latent.') ? 'latent' : 'clean';
    const found = lintFile(join(dir, f));
    const hasErr = found.some((x) => x.severity === 'error');
    const hasWarn = found.some((x) => x.severity === 'warn');
    const ok = kind === 'error' ? hasErr : kind === 'latent' ? (!hasErr && hasWarn) : (!hasErr && !hasWarn);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${f}  (${kind})`);
    if (ok) { pass++; const first = found.find((x) => x.severity === 'error') ?? found.find((x) => x.severity === 'warn'); if (first) console.log(`          ${first.id}: ${first.message.slice(0, 90)}…`); }
    else { fail++; found.forEach((x) => console.log(`          ${x.severity} ${x.id} ${x.message}`)); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed  (${files.length} fixtures)`);
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());
const targets = args.length
  ? args.map((a) => resolve(a))
  : DEFAULT_CONFIGS.map((p) => join(REPO, p)).filter(existsSync);
if (!targets.length) { console.error('no wrangler configs found'); process.exit(2); }
process.exit(report(targets) ? 1 : 0);
