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

// Wrangler splits configuration into INHERITABLE keys, which a named environment
// receives from the top level unless it overrides them, and NON-INHERITABLE keys
// — the bindings — which an environment does not receive at all and must declare
// for itself.
//
//   "The majority of keys are inheritable, meaning that top-level configuration
//    can be used in environments. Bindings, such as vars or kv_namespaces, are
//    not inheritable and need to be defined explicitly."
//   — developers.cloudflare.com/workers/wrangler/configuration/ (Environments)
//
// `workers_dev` and `routes` are both on the INHERITABLE list. An earlier version
// of this linter modelled them as non-inheritable, which was wrong in both
// directions: it flagged a safe config as an error, and — worse — it downgraded a
// genuinely unsafe one (top-level `routes`, environment declaring neither key, so
// the environment inherits the routes and the inference fires today) from an error
// to a "latent" warning. Rules are therefore evaluated against the EFFECTIVE
// config, not the literal block.
const NON_INHERITABLE = [
  'define', 'vars', 'durable_objects', 'kv_namespaces', 'r2_buckets', 'd1_databases',
  'services', 'queues', 'workflows', 'hyperdrive', 'vectorize', 'ai', 'browser',
  'send_email', 'mtls_certificates', 'analytics_engine_datasets', 'tail_consumers',
  'version_metadata', 'unsafe', 'ai_search', 'ai_search_namespaces', 'pipelines',
];

function effective(cfg, node) {
  const out = { ...node };
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'env') continue;
    if (NON_INHERITABLE.includes(k)) continue;      // bindings do not carry over
    if (!(k in out)) out[k] = v;                    // inheritable, not overridden
  }
  return out;
}

function environments(cfg) {
  const list = [{ label: 'top-level', node: cfg, effective: cfg, declared: cfg }];
  for (const [name, node] of Object.entries(cfg.env ?? {})) {
    list.push({ label: `env.${name}`, node, effective: effective(cfg, node), declared: node });
  }
  return list;
}

// `route` (singular) and `routes` (plural) are both accepted by wrangler.
const hasRoutes = (n) =>
  (Array.isArray(n.routes) && n.routes.length > 0) || (n.route != null);
const declaresWorkersDev = (n) => Object.prototype.hasOwnProperty.call(n, 'workers_dev');

const RULES = [
  {
    id: 'L1',
    title: 'routes without an explicit workers_dev',
    check: (env) => {
      if (!hasRoutes(env.effective) || declaresWorkersDev(env.effective)) return null;
      const inherited = !hasRoutes(env.declared);
      return inherited
        ? `INHERITS routes from the top level and declares no workers_dev anywhere in its chain — the inference fires for this environment TODAY, so its *.workers.dev hostname is already disabled or goes on the next deploy`
        : `declares routes but not workers_dev — Cloudflare infers workers_dev=false, silently removing the *.workers.dev hostname`;
    },
    severity: 'error',
  },
  {
    id: 'L2',
    title: 'no routes and no workers_dev (latent)',
    check: (env) => {
      if (!hasRoutes(env.effective) && !declaresWorkersDev(env.effective) && env.effective.name) {
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
      const bindings = env.declared.services ?? [];
      const byName = bindings.filter((b) => b.service).map((b) => `${b.binding}->${b.service}`);
      if (byName.length) {
        return `binds another Worker BY NAME (${byName.join(', ')}) — a rename of the target breaks this binding and must be made in the same change`;
      }
      return null;
    },
    severity: 'info',
  },
  {
    id: 'L4',
    title: 'binding declared at top level but absent from a named environment',
    // Wrangler does NOT inherit binding-shaped keys into a named environment.
    // A binding present at the top level and missing from env.staging is simply
    // absent in staging — and the failure is at first request, not at deploy.
    check: (env, cfg) => {
      if (env.label === 'top-level') return null;
      const missing = NON_INHERITABLE.filter((k) => present(cfg[k]) && !present(env.declared[k]));
      if (missing.length) {
        return `top level declares [${missing.join(', ')}] but this environment does not — wrangler does NOT inherit bindings into a named environment, so they are absent here and the failure appears at first request, not at deploy`;
      }
      return null;
    },
    severity: 'error',
  },
  {
    id: 'L5',
    title: 'Durable Object binding owned by another script',
    check: (env) => {
      const dos = env.declared.durable_objects?.bindings ?? [];
      const foreign = dos.filter((d) => d.script_name).map((d) => `${d.name}@${d.script_name}`);
      if (foreign.length) {
        return `binds Durable Objects owned by another script (${foreign.join(', ')}) — renaming or deleting that script orphans the namespace, and charger identity lives in one of these`;
      }
      return null;
    },
    severity: 'warn',
  },
  {
    id: 'L6',
    title: 'named environment without its own compatibility_date',
    check: (env, cfg) => {
      if (env.label === 'top-level') return null;
      if (!env.declared.compatibility_date && cfg.compatibility_date) {
        return `no compatibility_date of its own — it inherits "${cfg.compatibility_date}", so changing the top level silently changes this environment's runtime semantics`;
      }
      return null;
    },
    severity: 'info',
  },
  {
    id: 'L7',
    title: 'environment Worker name unrelated to the base name',
    check: (env, cfg) => {
      if (env.label === 'top-level' || !env.declared.name || !cfg.name) return null;
      if (!env.declared.name.startsWith(cfg.name)) {
        return `Worker name "${env.declared.name}" does not extend the base name "${cfg.name}" — in an account where two projects already declare the same names, an unrelated name is how a collision hides`;
      }
      return null;
    },
    severity: 'warn',
  },
];

const present = (v) => v != null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);

function lintFile(file) {
  const findings = [];
  let cfg;
  try { cfg = parseJsonc(readFileSync(file, 'utf8')); }
  catch (e) { return [{ id: 'L0', severity: 'error', env: '-', message: `unparseable: ${e.message}` }]; }
  for (const env of environments(cfg)) {
    for (const rule of RULES) {
      const msg = rule.check(env, cfg);
      if (msg) findings.push({ id: rule.id, severity: rule.severity, env: env.label, name: env.effective.name ?? '(unnamed)', message: msg });
    }
  }
  return findings;
}

// L8 is the only cross-file rule: a queue with a producer somewhere in the estate
// and a consumer nowhere is a message path that accepts work and drops it.
function lintEstate(files) {
  const produced = new Map(), consumed = new Set();
  for (const f of files) {
    let cfg;
    try { cfg = parseJsonc(readFileSync(f, 'utf8')); } catch { continue; }
    for (const env of environments(cfg)) {
      for (const p of env.declared.queues?.producers ?? []) if (p.queue) produced.set(p.queue, `${basename(dirname(f))}/${env.label}`);
      for (const c of env.declared.queues?.consumers ?? []) if (c.queue) consumed.add(c.queue);
    }
  }
  const orphans = [...produced.entries()].filter(([q]) => !consumed.has(q));
  return orphans.map(([q, where]) => ({
    id: 'L8', severity: 'warn', env: where, name: q,
    message: `queue "${q}" has a producer but no consumer declared anywhere in this estate — work is accepted and then goes nowhere, silently`,
  }));
}

function report(files) {
  let errors = 0;
  const estate = lintEstate(files);
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
  if (estate.length) {
    console.log(`        (estate-wide)`);
    for (const x of estate) {
      if (x.severity === 'error') errors++;
      console.log(`  ${x.severity === 'error' ? 'ERROR ' : 'WARN  '}${x.id} [${x.env} ${x.name}] ${x.message}`);
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
