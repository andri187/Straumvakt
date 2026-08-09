#!/usr/bin/env node
// Generate the REAL worktree freeze manifest from live, read-only observation.
//
// Collection and judgement are separate on purpose: this script records what is
// true, and validate-freeze-manifest.mjs decides whether that is acceptable. A
// generator that also approved of its own output would always approve.
//
// SAFETY, by construction:
//   * git is spawned only through gitRO(), which checks the subcommand against a
//     read-only allowlist and refuses anything else. Adding a write verb means
//     editing one obvious line.
//   * it counts files and reads git metadata. It moves nothing, deletes nothing,
//     and contains no delete verb.
//   * it NEVER opens a .env, key or credential file. It records that such a file
//     exists, by path. The existence is the finding; the contents never are.
//   * counting EXCLUDES reparse points: following junctions double-counts shared
//     node_modules and has already produced impossible figures on this estate.
//   * it refuses to write its own output inside the root it measures.
//
// Usage:
//   node build-freeze-manifest.mjs --out <path>

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const READ_ONLY_GIT = new Set(['rev-parse', 'rev-list', 'status', 'worktree', 'for-each-ref', 'ls-remote', 'merge-base', 'cat-file']);
const FORBIDDEN_ARGS = ['-d', '-D', '--delete', '--force', '-f', 'add', 'remove', 'prune', 'move', 'repair', 'lock', 'unlock', '-u', '--set-upstream-to', '--unset-upstream'];

function gitRO(cwd, args) {
  if (!READ_ONLY_GIT.has(args[0])) throw new Error(`REFUSED: git ${args[0]} is not on the read-only allowlist`);
  for (const a of args.slice(1)) {
    if (FORBIDDEN_ARGS.includes(a)) throw new Error(`REFUSED: git ${args[0]} ${a} would mutate`);
  }
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout ?? '').trim() };
}

const ROOT = 'E:\\Claude';
const ROOT_FS = 'E:/Claude';
const CANON = 'E:/Claude/Straumvakt';
const RC = '4b69d0f';
const FORBIDDEN = ['4fe0a95', '30fa407', '5311cbd'];
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const REGENERABLE = /[\\/](node_modules|\.next|\.open-next|\.dart_tool|build|\.turbo|\.gradle)[\\/]/;
// Credential detection, deliberately narrowed twice over.
//
// It must not scan regenerable trees: an earlier version matched every
// `token.js` and `secrets.d.ts` inside node_modules and produced 160 lines of
// vendor noise around four real findings. A detector whose output nobody reads
// detects nothing.
//
// It must also cover the formats that actually matter here. `.jks` and
// `key.properties` were missing, and an Android upload keystore is the one
// credential on this estate that cannot be rotated: lose it and that Play Store
// listing can never be updated again.
const CREDENTIAL_NAME = /^\.env($|\.)|\.(pem|p12|pfx|jks|jceks|keystore|p8|asc|gpg)$|^key\.properties$|^charger-credentials\.json$|^secrets\.tf$/i;
const DOCUMENT_EXT = /\.(md|pdf|docx?|txt|csv|xlsx?|pptx?|json|ya?ml)$/i;

// Walk without ever following a reparse point, and without ever opening a file.
function scan(dir, acc, depth = 0) {
  if (depth > 40) return acc;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (e.isDirectory()) { scan(p, acc, depth + 1); continue; }
    acc.total++;
    const regenerable = REGENERABLE.test(p);
    if (!regenerable) acc.content++;
    // Vendor trees are full of files named for credentials that are not
    // credentials. Only real content is scanned.
    if (!regenerable && CREDENTIAL_NAME.test(e.name)) acc.credentials.push(p.replace(/\\/g, '/'));
  }
  return acc;
}
const emptyAcc = () => ({ total: 0, content: 0, credentials: [] });

// Grep for project markers WITHOUT opening anything credential-shaped.
function hasStraumvaktContent(dir) {
  const MARK = /straumvakt|zaptec|ocpp|hlada/i;
  let found = false;
  const walk = (d, depth) => {
    if (found || depth > 4) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
      const p = join(d, e.name);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (CREDENTIAL_NAME.test(e.name)) continue;              // never opened
      if (MARK.test(e.name)) { found = true; return; }
      if (!/\.(ts|tsx|js|mjs|json|jsonc|md|dart|toml|yaml|yml)$/i.test(e.name)) continue;
      try {
        if (statSync(p).size > 2_000_000) continue;
        // Read only to test for a marker; nothing is echoed.
        const txt = readFileSync(p, 'utf8');
        if (MARK.test(txt)) { found = true; return; }
      } catch { /* unreadable */ }
    }
  };
  walk(dir, 0);
  return found;
}

// ── worktrees ────────────────────────────────────────────────────────
const blocks = gitRO(CANON, ['worktree', 'list', '--porcelain']).out.split('\n\n').filter(Boolean);
const remoteHeads = new Set(
  gitRO(CANON, ['ls-remote', '--heads', 'origin']).out.split('\n').filter(Boolean)
    .map((l) => l.split('\t')[1].replace('refs/heads/', ''))
);

const OWNER = (p) =>
  /onboarding-web|driver-access-ui/.test(p) ? 'codex'
  : /onboarding-domain/.test(p) ? 'claude-a'
  : /beta-production|Straumvakt-n1$|release-candidate/.test(p) ? 'release-ops'
  : p === CANON ? 'shared' : 'unknown';

const worktrees = [];
for (const b of blocks) {
  const lines = b.split('\n');
  const path = (lines.find((l) => l.startsWith('worktree ')) ?? '').slice(9).trim();
  if (!path) continue;
  const headLine = lines.find((l) => l.startsWith('HEAD '));
  const branchLine = lines.find((l) => l.startsWith('branch '));
  const detached = lines.some((l) => l.trim() === 'detached');
  const exists = existsSync(path);
  const branch = branchLine ? branchLine.slice(7).replace('refs/heads/', '') : null;

  if (!exists) {
    const head = (headLine ? headLine.slice(5) : '0000000').slice(0, 7);
    worktrees.push({
      path, existsOnDisk: false, branch, detached, head,
      dirtyFiles: 0, untrackedFiles: 0, untrackedPreservationMaterial: false,
      upstream: null, upstreamExistsOnRemote: null,
      branchExistsOnRemote: branch ? remoteHeads.has(branch) : null,
      uniqueVsCandidate: 0,
      headIsForbidden: FORBIDDEN.find((f) => head.startsWith(f) || f.startsWith(head)) ?? null,
      forbiddenAncestors: [], owner: 'unknown',
      suggestedAction: 'stale-registration-cleanup',
      actionRationale: 'Registration left behind by a session whose filesystem is gone. It still holds its branch and still inflates every count derived from `git worktree list`.',
      branchPreserved: true, archiveDestination: null,
    });
    continue;
  }

  const head = gitRO(path, ['rev-parse', '--short', 'HEAD']).out;
  const st = gitRO(path, ['status', '--porcelain']).out;
  const statusLines = st ? st.split('\n') : [];
  const untracked = statusLines.filter((l) => l.startsWith('??'));
  const untrackedDocs = untracked.some((l) => DOCUMENT_EXT.test(l.slice(3)));
  const up = gitRO(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const upstream = up.code === 0 ? up.out : null;
  const uq = gitRO(path, ['rev-list', '--count', `${RC}..HEAD`]);
  const unique = uq.code === 0 ? Number(uq.out) : 0;

  const ancestors = [];
  for (const f of FORBIDDEN) {
    if (gitRO(path, ['cat-file', '-e', `${f}^{commit}`]).code !== 0) continue;
    if (gitRO(path, ['merge-base', '--is-ancestor', f, 'HEAD']).code === 0) ancestors.push(f);
  }
  const headForbidden = FORBIDDEN.find((f) => head.startsWith(f) || f.startsWith(head)) ?? null;

  // The suggestion, and never more than a suggestion.
  let action = 'keep', why = null;
  if (headForbidden) {
    action = 'needs-human-review';
    why = `HEAD is forbidden commit ${headForbidden}. Nothing may be retired or archived from here until a human decides what happens to the branch.`;
  } else if (untrackedDocs) {
    action = 'needs-human-review';
    why = `${untracked.length} untracked entries include documents, which have no remote and no reflog.`;
  } else if (path === CANON) {
    action = 'keep';
    why = 'The canonical checkout. Never a cleanup candidate.';
  } else if (unique === 0 && statusLines.length === 0) {
    action = 'retire';
    why = branch && !remoteHeads.has(branch)
      ? `Zero unique commits against ${RC} and zero dirty files. Branch "${branch}" exists on no remote, so the branch itself must be preserved even though the working copy need not be.`
      : `Zero unique commits against ${RC} and zero dirty files. The branch survives retirement.`;
  } else if (statusLines.length > 0 && OWNER(path) !== 'release-ops') {
    action = 'needs-human-review';
    why = `${statusLines.length} dirty file(s) belonging to ${OWNER(path)}. This track never decides for another agent.`;
  } else {
    action = 'keep';
    why = `${unique} unique commit(s) against ${RC}.`;
  }

  worktrees.push({
    path, existsOnDisk: true, branch, detached, head,
    dirtyFiles: statusLines.length,
    untrackedFiles: untracked.length,
    untrackedPreservationMaterial: untrackedDocs,
    upstream,
    upstreamExistsOnRemote: upstream ? remoteHeads.has(upstream.replace(/^[^/]+\//, '')) : null,
    branchExistsOnRemote: branch ? remoteHeads.has(branch) : null,
    uniqueVsCandidate: unique,
    headIsForbidden: headForbidden,
    forbiddenAncestors: ancestors,
    owner: OWNER(path),
    suggestedAction: action,
    actionRationale: why,
    branchPreserved: true,
    archiveDestination: null,
  });
}

// ── content under the root that is NOT inside a registered worktree ──
const wtPaths = new Set(worktrees.map((w) => w.path.replace(/\\/g, '/').toLowerCase()));
const PRESERVED = {
  'straumvakt-parked': 'P-01',
  'cpms': 'P-15',
};
const unregistered = [];
for (const name of readdirSync(ROOT_FS)) {
  const p = join(ROOT_FS, name).replace(/\\/g, '/');
  let st; try { st = lstatSync(p); } catch { continue; }
  if (st.isSymbolicLink() || !st.isDirectory()) continue;
  if (wtPaths.has(p.toLowerCase())) continue;

  const isRepo = existsSync(join(p, '.git'));
  const acc = scan(p, emptyAcc());
  const straumvakt = hasStraumvaktContent(p);
  const covered = PRESERVED[name.toLowerCase()] ?? null;

  let action = 'keep', why = null;
  if (acc.credentials.length) {
    action = 'needs-human-review';
    why = `Contains ${acc.credentials.length} credential-shaped file(s). Their existence is the finding; the contents were never opened. Rotate or exclude before any action.`;
  } else if (straumvakt && !covered) {
    action = 'needs-human-review';
    why = `${acc.content} content files with project material and no preservation record covering them.`;
  } else if (covered) {
    action = 'keep';
    why = `Covered by preservation record ${covered}.`;
  }

  unregistered.push({
    path: p.replace(/\//g, '\\'),
    kind: isRepo ? 'separate-git-repo' : 'non-git-directory',
    totalFiles: acc.total,
    contentFiles: acc.content,
    straumvaktContent: straumvakt,
    coveredByPreservationRecord: covered,
    credentialShapedFiles: acc.credentials.map((c) => c.replace(/\//g, '\\')),
    suggestedAction: action,
    actionRationale: why,
  });
}

const localBranches = gitRO(CANON, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).out.split('\n').filter(Boolean);
const onDisk = worktrees.filter((w) => w.existsOnDisk).length;

const manifest = {
  manifestVersion: 1,
  generatedAt: now,
  root: ROOT,
  canonicalRepo: CANON.replace(/\//g, '\\'),
  releaseCandidate: RC,
  forbiddenCommits: FORBIDDEN,
  totals: {
    registered: worktrees.length,
    onDisk,
    staleRegistrations: worktrees.length - onDisk,
    localBranches: localBranches.length,
    remoteBranches: remoteHeads.size,
    localBranchesWithoutRemote: localBranches.filter((b) => !remoteHeads.has(b)).length,
  },
  worktrees,
  unregistered,
  archiveDestination: null,
  notes: 'Generated by read-only observation. Nothing was deleted, moved or modified. suggestedAction is a SUGGESTION recorded for a human; nothing executes it. Credential-shaped files are recorded by path only and were never opened.',
};

const i = process.argv.indexOf('--out');
const out = i >= 0 ? process.argv[i + 1] : null;
if (!out) { console.log(JSON.stringify(manifest, null, 2)); process.exit(0); }
if (out.replace(/\\/g, '/').toLowerCase().startsWith(ROOT_FS.toLowerCase() + '/')) {
  console.error(`Refusing to write the freeze manifest inside ${ROOT}; choose a path outside it.`);
  process.exit(2);
}
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
const t = manifest.totals;
console.log(`freeze manifest written to ${out}`);
console.log(`  worktrees: ${t.registered} registered, ${t.onDisk} on disk, ${t.staleRegistrations} stale`);
console.log(`  branches:  ${t.localBranches} local, ${t.remoteBranches} remote, ${t.localBranchesWithoutRemote} local-only`);
console.log(`  unregistered entries: ${unregistered.length}  (${unregistered.filter((u) => u.straumvaktContent && !u.coveredByPreservationRecord).length} with project content and NO record)`);
console.log(`  suggested: ${['keep', 'retire', 'archive', 'needs-human-review', 'stale-registration-cleanup'].map((a) => `${a}=${worktrees.filter((w) => w.suggestedAction === a).length}`).join('  ')}`);
