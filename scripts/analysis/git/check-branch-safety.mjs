#!/usr/bin/env node
// Branch-safety checker. Collection and evaluation are deliberately separate:
//
//   collect()  runs read-only git and emits a snapshot JSON
//   evaluate() applies rules G1..G9 to a snapshot — a pure function, no git
//
// That split exists so the RULES can be tested against fixtures without needing a
// repository in a particular broken state. You cannot easily manufacture "two
// branches sharing an upstream" on demand; you can trivially write it down.
//
// SAFETY, by construction:
//   * git is spawned only through run(), which checks the subcommand against a
//     hard allowlist of read-only verbs and REFUSES anything else. Adding a write
//     verb requires editing the allowlist, which is one obvious line in a review.
//   * no network beyond `git ls-remote`, which reads refs and changes nothing.
//     Pass --no-remote to skip even that.
//   * writes only to stdout, or to a snapshot path given explicitly with --out.
//   * contains no push, no checkout, no reset, no clean, no branch -d.
//
// Usage:
//   node check-branch-safety.mjs                       # collect + evaluate here
//   node check-branch-safety.mjs --repo <path> --out snapshot.json
//   node check-branch-safety.mjs --snapshot <file>     # evaluate a saved snapshot
//   node check-branch-safety.mjs --json
//   node check-branch-safety.mjs --self-test

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(HERE, 'branch-safety-config.json'), 'utf8'));

// ── The allowlist. Everything else is refused, including by mistake. ──
const READ_ONLY_GIT = new Set([
  'rev-parse', 'rev-list', 'for-each-ref', 'status', 'log', 'ls-remote',
  'merge-base', 'config', 'branch', 'worktree', 'cat-file', 'symbolic-ref',
]);
// `git branch` and `git config` and `git worktree` are read-only ONLY with
// certain flags, so those are constrained further rather than trusted.
const FORBIDDEN_FLAGS = [
  '-d', '-D', '--delete', '--force', '-f', '--set-upstream-to', '-u',
  '--unset-upstream', '-m', '-M', '--move', '--edit-description',
  'add', 'remove', 'prune', 'move', 'lock', 'unlock', 'repair',
  '--replace-all', '--add', '--unset', '--unset-all', '--rename-section', '--remove-section',
];

function run(repo, args) {
  const sub = args[0];
  if (!READ_ONLY_GIT.has(sub)) {
    throw new Error(`REFUSED: "git ${sub}" is not on the read-only allowlist`);
  }
  if (sub === 'branch' || sub === 'worktree' || sub === 'config') {
    for (const a of args.slice(1)) {
      if (FORBIDDEN_FLAGS.includes(a)) {
        throw new Error(`REFUSED: "git ${sub} ${a}" would mutate`);
      }
    }
    if (sub === 'config' && !args.includes('--get') && !args.includes('--list') && !args.includes('--get-all')) {
      throw new Error('REFUSED: git config without --get/--get-all/--list would write');
    }
  }
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function collect(repo, { remote = true } = {}) {
  const snap = {
    snapshotVersion: 1,
    repo,
    collectedFrom: [],
    worktrees: [],
    branches: [],
    remoteRefs: null,
    forbiddenCommits: [],
    fastForward: null,
    config: {},
    hooks: {},
  };

  // Every worktree attached to this repository, including the main one.
  const wt = run(repo, ['worktree', 'list', '--porcelain']);
  const paths = [];
  for (const line of wt.out.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(line.slice('worktree '.length).trim());
  }
  if (!paths.length) paths.push(repo);

  // Registrations are recorded even when the directory is gone. A stale
  // registration still holds its branch and still appears in every enumeration,
  // so silently skipping it makes every derived count quietly wrong.
  const listed = wt.out.split('\n\n').filter(Boolean);
  for (const p of paths) {
    if (!existsSync(p)) {
      const block = listed.find((b) => b.includes(`worktree ${p}`)) ?? '';
      const headLine = block.split('\n').find((l) => l.startsWith('HEAD '));
      const branchLine = block.split('\n').find((l) => l.startsWith('branch '));
      snap.worktrees.push({
        path: p,
        branch: branchLine ? branchLine.slice('branch '.length).replace('refs/heads/', '') : null,
        tip: headLine ? headLine.slice('HEAD '.length).slice(0, 7) : null,
        dirtyFiles: 0,
        exists: false,
      });
      continue;
    }
    snap.collectedFrom.push(p);
    const head = run(p, ['rev-parse', '--short', 'HEAD']).out;
    const branch = run(p, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
    const dirty = run(p, ['status', '--porcelain']).out;
    const unique = run(p, ['rev-list', '--count', `${CONFIG.releaseCandidate}..HEAD`]);
    snap.worktrees.push({
      path: p,
      branch,
      tip: head,
      dirtyFiles: dirty ? dirty.split('\n').length : 0,
      uniqueVsCandidate: unique.code === 0 ? Number(unique.out) : null,
      exists: true,
    });
    const refs = run(p, ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(objectname:short)', 'refs/heads']);
    for (const line of refs.out.split('\n').filter(Boolean)) {
      const [name, upstream, sha] = line.split('\t');
      if (snap.branches.some((b) => b.name === name)) continue;
      snap.branches.push({ name, upstream: upstream || null, sha, worktree: p });
    }
  }

  if (remote) {
    const ls = run(repo, ['ls-remote', '--heads', 'origin']);
    if (ls.code === 0) {
      snap.remoteRefs = ls.out.split('\n').filter(Boolean).map((l) => {
        const [sha, ref] = l.split('\t');
        return { ref: ref.replace('refs/heads/', ''), sha: sha.slice(0, 12) };
      });
    }
  }

  for (const sha of CONFIG.forbiddenCommits) {
    for (const ref of CONFIG.refsToCheck) {
      const exists = run(repo, ['cat-file', '-e', `${sha}^{commit}`]).code === 0;
      const refExists = run(repo, ['rev-parse', '--verify', '--quiet', ref]).code === 0;
      if (!exists || !refExists) {
        snap.forbiddenCommits.push({ sha, ref, resolved: exists && refExists, present: null });
        continue;
      }
      const anc = run(repo, ['merge-base', '--is-ancestor', sha, ref]);
      snap.forbiddenCommits.push({ sha, ref, resolved: true, present: anc.code === 0 });
    }
  }

  const [a, b] = CONFIG.fastForwardPair;
  const aOk = run(repo, ['rev-parse', '--verify', '--quiet', a]).code === 0;
  const bOk = run(repo, ['rev-parse', '--verify', '--quiet', b]).code === 0;
  if (aOk && bOk) {
    const counts = run(repo, ['rev-list', '--left-right', '--count', `${a}...${b}`]).out.split(/\s+/);
    snap.fastForward = { from: a, to: b, leftOnly: Number(counts[0]), rightOnly: Number(counts[1]) };
  } else {
    snap.fastForward = { from: a, to: b, leftOnly: null, rightOnly: null, resolved: false };
  }

  for (const key of ['push.default', 'core.hooksPath', 'receive.denyNonFastForwards']) {
    const r = run(repo, ['config', '--get', key]);
    snap.config[key] = r.code === 0 ? r.out : null;
  }
  snap.hooks.prePush = existsSync(join(repo, '.git', 'hooks', 'pre-push'));

  return snap;
}

// ── Rules. Pure: snapshot in, findings out. No git, no filesystem. ──
function evaluate(s) {
  const F = [];
  const add = (id, severity, message) => F.push({ id, severity, message });
  const deploy = new Set(CONFIG.deployPointerBranches);

  // G1. A local branch tracking a deploy pointer turns a reflexive `git push`
  //     into a production change.
  for (const b of s.branches ?? []) {
    if (!b.upstream) continue;
    const short = b.upstream.replace(/^origin\//, '');
    if (deploy.has(short) && !deploy.has(b.name)) {
      add('G1', 'error', `branch "${b.name}" tracks deploy pointer "${b.upstream}" — a bare git push from it publishes to the branch that may trigger a deploy`);
    }
  }
  // G2. An upstream whose name differs from the local branch means the mistake is
  //     invisible in the command AND invisible in the branch name.
  for (const b of s.branches ?? []) {
    if (!b.upstream) continue;
    const short = b.upstream.replace(/^origin\//, '');
    if (short !== b.name && !deploy.has(short)) {
      add('G2', 'warn', `branch "${b.name}" tracks "${b.upstream}" — the upstream name does not match the branch name`);
    }
  }
  // G3. Two branches sharing an upstream will overwrite each other.
  const byUpstream = new Map();
  for (const b of s.branches ?? []) {
    if (!b.upstream) continue;
    if (!byUpstream.has(b.upstream)) byUpstream.set(b.upstream, []);
    byUpstream.get(b.upstream).push(b.name);
  }
  for (const [up, names] of byUpstream) {
    const short = up.replace(/^origin\//, '');
    // A branch tracking its own namesake is normal and is not part of the
    // conflict; it is listed for context but does not make the finding.
    const conflicting = names.filter((n) => n !== short);
    if (conflicting.length > 1) {
      const selfNote = names.includes(short) ? ` (plus "${short}" itself, which is legitimate)` : '';
      add('G3', 'error', `branches [${conflicting.join(', ')}] all track "${up}"${selfNote} — each would overwrite the others`);
    }
  }
  // G4. Forbidden commits must be provably absent, and "unresolved" is not absent.
  for (const c of s.forbiddenCommits ?? []) {
    if (c.resolved !== true) {
      add('G4', 'error', `forbidden commit ${c.sha} could not be resolved against ${c.ref} — unresolved is NOT the same as absent`);
    } else if (c.present === true) {
      add('G4', 'error', `forbidden commit ${c.sha} IS PRESENT in ${c.ref}`);
    }
  }
  // G5. A promotion that is not a fast-forward silently drops or duplicates work.
  const ff = s.fastForward;
  if (ff) {
    if (ff.leftOnly == null) {
      add('G5', 'warn', `fast-forward between ${ff.from} and ${ff.to} could not be computed — one of the refs did not resolve`);
    } else if (ff.leftOnly > 0) {
      add('G5', 'error', `${ff.from} has ${ff.leftOnly} commit(s) that ${ff.to} does not — promotion would NOT be a fast-forward`);
    }
  }
  // G6. push.default decides what a bare `git push` does.
  const pd = s.config?.['push.default'];
  if (pd == null) add('G6', 'warn', 'push.default is unset — the default varies by git version, so what a bare push does is not written down anywhere');
  else if (['matching', 'current', 'upstream'].includes(pd)) {
    add('G6', 'error', `push.default is "${pd}" — a bare git push can update a branch you did not name`);
  }
  // G7. Configuration protects against one mistake; a hook protects against the
  //      class. A hooksPath being SET is not the same as a hook EXISTING there —
  //      the live estate has the former and not the latter, which is exactly the
  //      shape that reads as protected and is not.
  if (!s.hooks?.prePush) {
    const where = s.config?.['core.hooksPath'];
    add('G7', 'warn', where
      ? `core.hooksPath is set to "${where}" but no pre-push hook exists there — a configured hooks directory with no hook offers no protection`
      : 'no pre-push hook and no core.hooksPath — nothing locally refuses a push to a deploy pointer');
  }
  // G8. Uncommitted work on a branch that tracks a deploy pointer is the setup for
  //     an accidental publish under time pressure.
  const trackingDeploy = new Set((s.branches ?? [])
    .filter((b) => b.upstream && deploy.has(b.upstream.replace(/^origin\//, '')))
    .map((b) => b.name));
  for (const w of s.worktrees ?? []) {
    if (trackingDeploy.has(w.branch) && w.dirtyFiles > 0) {
      add('G8', 'error', `worktree ${w.path} is on "${w.branch}" (tracks a deploy pointer) with ${w.dirtyFiles} uncommitted files`);
    }
  }
  // G10. A worktree whose HEAD *is* a forbidden commit. Knowing the branch
  //      carries it is one thing; a checked-out working copy sitting on it is a
  //      `git push` and a wrong `-u` away from publishing it. Found by running
  //      this against the real estate, not by reading a config.
  const forbidden = new Set(CONFIG.forbiddenCommits);
  for (const w of s.worktrees ?? []) {
    const short = (w.tip ?? '').slice(0, 7);
    if (forbidden.has(short)) {
      add('G10', 'error', `worktree ${w.path} is checked out AT forbidden commit ${short} (branch "${w.branch}") — it is not merely reachable from there, it is HEAD`);
    }
  }
  // G11. A registration whose directory is gone still occupies the branch and
  //      still appears in every enumeration, so every count derived from
  //      `worktree list` is wrong until it is pruned.
  for (const w of s.worktrees ?? []) {
    if (w.exists === false) {
      add('G11', 'warn', `worktree registration ${w.path} points at a directory that does not exist (tip ${w.tip ?? 'unknown'}) — prune it before trusting any worktree count`);
    }
  }
  // G9. A remote ref count that changed since the recorded baseline means
  //     something was pushed.
  if (s.remoteRefs && CONFIG.expectedRemoteRefCount != null) {
    if (s.remoteRefs.length !== CONFIG.expectedRemoteRefCount) {
      add('G9', 'error', `origin has ${s.remoteRefs.length} branches, baseline is ${CONFIG.expectedRemoteRefCount} — something was pushed or deleted; establish what before doing anything else`);
    }
    const pointer = s.remoteRefs.find((r) => r.ref === CONFIG.deployPointerBranches[0]);
    if (pointer && CONFIG.expectedDeployPointerSha && !CONFIG.expectedDeployPointerSha.startsWith(pointer.sha.slice(0, 8)) && !pointer.sha.startsWith(CONFIG.expectedDeployPointerSha.slice(0, 8))) {
      add('G9', 'error', `origin/${pointer.ref} is ${pointer.sha}, baseline is ${CONFIG.expectedDeployPointerSha} — the deploy pointer moved`);
    }
  }
  return F;
}

function report(findings, label) {
  const errors = findings.filter((f) => f.severity === 'error');
  if (!findings.length) { console.log(`OK      ${label} — no branch-safety findings`); return 0; }
  console.log(`        ${label}`);
  for (const f of findings) {
    console.log(`  ${f.severity === 'error' ? 'ERROR ' : 'WARN  '}${f.id} ${f.message}`);
  }
  return errors.length;
}

function selfTest() {
  const dir = join(HERE, 'branch-safety-fixtures');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let pass = 0, fail = 0;
  for (const f of files) {
    const kind = f.includes('.clean.') ? 'clean' : f.includes('.warns.') ? 'warns' : 'error';
    const snap = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const found = evaluate(snap);
    const hasErr = found.some((x) => x.severity === 'error');
    const hasWarn = found.some((x) => x.severity === 'warn');
    const ok = kind === 'error' ? hasErr : kind === 'warns' ? (!hasErr && hasWarn) : (!hasErr && !hasWarn);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${basename(f)}  (${kind})`);
    if (ok) {
      pass++;
      const first = found.find((x) => x.severity === 'error') ?? found.find((x) => x.severity === 'warn');
      if (first) console.log(`          ${first.id}: ${first.message.slice(0, 100)}`);
    } else { fail++; found.forEach((x) => console.log(`          ${x.severity} ${x.id} ${x.message}`)); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed  (${files.length} fixtures)`);
  return fail ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());

const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const asJson = args.includes('--json');
const snapPath = argVal('--snapshot');

let snapshot, label;
if (snapPath) {
  snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
  label = basename(snapPath);
} else {
  const repo = resolve(argVal('--repo') ?? process.cwd());
  try {
    snapshot = collect(repo, { remote: !args.includes('--no-remote') });
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }
  label = repo;
  const out = argVal('--out');
  if (out) { writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n'); console.log(`snapshot written to ${out}`); }
}

const findings = evaluate(snapshot);
if (asJson) console.log(JSON.stringify({ label, findings, snapshot }, null, 2));
else process.exitCode = report(findings, label) ? 1 : 0;
