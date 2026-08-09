#!/usr/bin/env node
// Offline worktree-freeze-manifest validator.
//
// The freeze manifest answers one question before any cleanup begins: what
// exists, and what would be lost if it stopped existing. These rules encode the
// judgements that made the inventory worth taking in the first place — a
// forbidden commit sitting at HEAD, an upstream pointing somewhere its own name
// does not suggest, a registration whose directory is gone, and content under the
// estate root that no preservation record covers.
//
// SAFETY, deliberate and inspectable:
//   * imports only node:fs and node:path/url — no fetch, no http/https, no
//     child_process, no dynamic import. It cannot reach a network.
//   * it reads the manifest and NOTHING ELSE. It does not stat the paths it
//     describes: a validator that touched the tree it is protecting would be one
//     bug away from being the thing that damages it.
//   * writes only to stdout/stderr. It contains no delete verb.
//
// A freeze manifest is EVIDENCE and a PRECONDITION. The suggestedAction fields
// are recorded for a human; nothing here or anywhere else executes them.
//
// Usage:
//   node validate-freeze-manifest.mjs <file.json>...
//   node validate-freeze-manifest.mjs --strict <file.json>
//   node validate-freeze-manifest.mjs --json <file.json>
//   node validate-freeze-manifest.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'freeze-manifest.schema.json'), 'utf8'));

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
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in node) validate(node[k], sub, `${path}.${k}`, errs, root);
  }
}

// Two shas match when either is a prefix of the other, so a 7-character record
// and a 40-character configuration value compare correctly. Comparing fixed
// slices would silently miss a full sha, which is exactly the kind of near-miss
// this manifest exists to catch.
const shaMatch = (a, b) => {
  if (!a || !b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
};

// Branch names that are deploy pointers. Tracking one of these from a branch
// that is not itself that branch turns a reflexive push into a production change.
const DEPLOY_POINTERS = ['staging', 'main'];

function policy(m, errs, warns) {
  const wts = m.worktrees ?? [];
  const unreg = m.unregistered ?? [];
  const forbidden = m.forbiddenCommits ?? [];

  // FZ1. A forbidden commit at HEAD. Knowing a branch can reach one is a fact
  //      about history; a working copy sitting on it is one push from publishing it.
  for (const w of wts) {
    if (w.headIsForbidden) {
      if (!forbidden.some((f) => shaMatch(w.headIsForbidden, f))) {
        errs.push(`FZ1: ${w.path} records headIsForbidden "${w.headIsForbidden}" which is not in this manifest's forbiddenCommits list — one of the two is wrong`);
      } else {
        errs.push(`FZ1: ${w.path} is checked out AT forbidden commit ${w.headIsForbidden} (branch "${w.branch ?? 'detached'}") — HEAD, not merely reachable`);
      }
    } else if (forbidden.some((f) => shaMatch(w.head, f))) {
      errs.push(`FZ1: ${w.path} HEAD ${w.head} matches a forbidden commit but headIsForbidden is null — the field was not filled from the same source as head`);
    }
  }
  // FZ2. An upstream whose name differs from the branch it tracks. The mistake is
  //      invisible in the command and invisible in the branch name.
  for (const w of wts) {
    if (!w.upstream || !w.branch) continue;
    const short = w.upstream.replace(/^[^/]+\//, '');
    if (short === w.branch) continue;
    if (DEPLOY_POINTERS.includes(short)) {
      errs.push(`FZ2: ${w.path} branch "${w.branch}" tracks deploy pointer "${w.upstream}" — a bare push publishes to the branch that may trigger a deploy`);
    } else {
      warns.push(`FZ2 WARN: ${w.path} branch "${w.branch}" tracks "${w.upstream}" — the upstream name does not match the branch name`);
    }
  }
  // FZ3. A registration whose directory is gone still holds its branch and still
  //      inflates every count derived from `git worktree list`.
  for (const w of wts) {
    if (w.existsOnDisk === false) {
      if (w.suggestedAction !== 'stale-registration-cleanup') {
        errs.push(`FZ3: ${w.path} does not exist on disk but its suggestedAction is "${w.suggestedAction}" — a stale registration needs stale-registration-cleanup, not ${w.suggestedAction}`);
      } else {
        warns.push(`FZ3 WARN: stale registration ${w.path} (HEAD ${w.head}) — prune it before trusting any worktree count`);
      }
    }
  }
  // FZ4. Content under the estate root that no preservation record covers. This
  //      is the class that gets deleted because nobody wrote it down.
  for (const u of unreg) {
    if (u.straumvaktContent === true && !u.coveredByPreservationRecord) {
      errs.push(`FZ4: ${u.path} holds Straumvakt content (${u.contentFiles} content files) and is covered by NO preservation record`);
    }
  }
  // FZ5. Retirement requires that nothing unique lives there.
  for (const w of wts) {
    if (w.suggestedAction !== 'retire') continue;
    if (w.uniqueVsCandidate > 0) errs.push(`FZ5: ${w.path} is suggested for retire with ${w.uniqueVsCandidate} unique commit(s) vs the release candidate`);
    if (w.dirtyFiles > 0) errs.push(`FZ5: ${w.path} is suggested for retire with ${w.dirtyFiles} dirty file(s) — that is someone's uncommitted work`);
    if (w.branchPreserved !== true) errs.push(`FZ5: ${w.path} is suggested for retire without branchPreserved — retiring a working copy must never delete its branch`);
  }
  // FZ6. A branch that exists nowhere else is the only copy of its work. Retiring
  //      the working copy is still fine — but only if that is said explicitly.
  for (const w of wts) {
    if (w.suggestedAction === 'retire' && w.branchExistsOnRemote === false && !w.actionRationale) {
      errs.push(`FZ6: ${w.path} is suggested for retire, its branch "${w.branch}" exists on no remote, and no actionRationale is recorded`);
    }
  }
  // FZ7. An upstream that does not exist on the remote is a push waiting to
  //      create a branch nobody expects.
  for (const w of wts) {
    if (w.upstream && w.upstreamExistsOnRemote === false) {
      warns.push(`FZ7 WARN: ${w.path} tracks "${w.upstream}" which does not exist on origin — a push would create it`);
    }
  }
  // FZ8. Two worktrees on one branch is a state git normally refuses; if it is
  //      recorded here, something is wrong with the inventory or the repository.
  const byBranch = new Map();
  for (const w of wts) {
    if (!w.branch) continue;
    if (!byBranch.has(w.branch)) byBranch.set(w.branch, []);
    byBranch.get(w.branch).push(w.path);
  }
  for (const [b, paths] of byBranch) {
    if (paths.length > 1) errs.push(`FZ8: branch "${b}" is recorded in ${paths.length} worktrees (${paths.join(', ')})`);
  }
  // FZ9. Untracked documents are the material with no remote and no reflog.
  for (const w of wts) {
    if (w.untrackedPreservationMaterial !== true) continue;
    if (!['keep', 'archive', 'needs-human-review'].includes(w.suggestedAction)) {
      errs.push(`FZ9: ${w.path} holds untracked preservation material but is suggested for "${w.suggestedAction}" — untracked documents have no remote and no reflog`);
    }
  }
  // FZ10. Archiving without a destination is an intention, not a plan.
  for (const w of wts) {
    if (w.suggestedAction === 'archive' && !w.archiveDestination && !m.archiveDestination) {
      errs.push(`FZ10: ${w.path} is suggested for archive with no archiveDestination, and the manifest declares none either`);
    }
  }
  for (const u of unreg) {
    if (u.suggestedAction === 'archive' && !m.archiveDestination) {
      errs.push(`FZ10: ${u.path} is suggested for archive but the manifest declares no archiveDestination`);
    }
  }
  // FZ11. The totals must agree with the rows. A count that disagrees with its
  //       own evidence is how a stale registration hid for this long.
  const t = m.totals ?? {};
  const onDisk = wts.filter((w) => w.existsOnDisk !== false).length;
  const stale = wts.filter((w) => w.existsOnDisk === false).length;
  if (t.registered !== wts.length) errs.push(`FZ11: totals.registered ${t.registered} but ${wts.length} worktrees are listed`);
  if (t.onDisk !== onDisk) errs.push(`FZ11: totals.onDisk ${t.onDisk} but ${onDisk} rows report existsOnDisk`);
  if (t.staleRegistrations !== stale) errs.push(`FZ11: totals.staleRegistrations ${t.staleRegistrations} but ${stale} rows report existsOnDisk false`);
  if (t.registered != null && t.onDisk != null && t.staleRegistrations != null &&
      t.registered !== t.onDisk + t.staleRegistrations) {
    errs.push(`FZ11: registered ${t.registered} != onDisk ${t.onDisk} + stale ${t.staleRegistrations}`);
  }
  if (t.localBranchesWithoutRemote != null && t.localBranches != null && t.remoteBranches != null &&
      t.localBranchesWithoutRemote > t.localBranches) {
    errs.push('FZ11: localBranchesWithoutRemote exceeds localBranches');
  }
  // FZ12. A credential-shaped file in unregistered content. Its existence is the
  //       finding; its contents are never the evidence.
  for (const u of unreg) {
    const creds = u.credentialShapedFiles ?? [];
    if (!creds.length) continue;
    if (u.suggestedAction === 'archive') {
      errs.push(`FZ12: ${u.path} contains credential-shaped file(s) [${creds.join(', ')}] and is suggested for archive — an archive would copy a live credential into a second place`);
    } else if (u.suggestedAction !== 'needs-human-review') {
      warns.push(`FZ12 WARN: ${u.path} contains credential-shaped file(s) [${creds.join(', ')}] — rotate or exclude before any action`);
    }
    for (const c of creds) {
      if (/=|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?:\/\//i.test(c)) {
        errs.push(`FZ12: ${u.path} credentialShapedFiles contains something that is not a path — this field takes paths, never contents`);
      }
    }
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
  const dir = join(HERE, 'freeze-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const kind = f.includes('.valid.') ? 'valid' : f.includes('.warns.') ? 'warns' : 'invalid';
    const r = check(join(dir, f));
    const isValid = r.errs.length === 0;
    const ok = kind === 'valid' ? (isValid && r.warns.length === 0)
      : kind === 'warns' ? (isValid && r.warns.length > 0)
      : !isValid;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (${kind})`);
    if (ok) {
      pass++;
      if (kind === 'invalid') console.log(`          rejected: ${r.errs[0]}`);
      if (kind === 'warns') console.log(`          strict-only: ${r.warns[0]}`);
    } else {
      fail++;
      r.errs.forEach((e) => console.log(`          ERR  ${e}`));
      r.warns.forEach((w) => console.log(`          WARN ${w}`));
    }
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
  console.error('usage: node validate-freeze-manifest.mjs [--strict] [--json] <file.json>... | --self-test');
  process.exit(2);
}
let bad = 0;
const results = [];
for (const f of files) {
  const r = check(f);
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
