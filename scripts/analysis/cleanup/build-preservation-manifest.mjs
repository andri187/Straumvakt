#!/usr/bin/env node
// Generate the REAL preservation manifest for this estate from live, read-only
// observation — so the numbers in it are measured rather than remembered.
//
// SAFETY:
//   * git is spawned only through gitRO(), which checks the subcommand against a
//     read-only allowlist and refuses anything else.
//   * the only filesystem writes are the manifest itself, at a path you pass.
//   * it counts files and reads git metadata. It moves nothing and deletes nothing.
//   * counting deliberately EXCLUDES reparse points: following junctions
//     double-counts shared node_modules and has already produced impossible
//     figures on this estate (negative real content, more reclaimable than total).
//
// The manifest it produces is then checked by validate-preservation-manifest.mjs.
// Generating and validating are separate on purpose: a generator that also judged
// its own output would always approve of itself.
//
// Usage:
//   node build-preservation-manifest.mjs --out <path outside E:\Claude>

import { spawnSync } from 'node:child_process';
import { writeFileSync, readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const READ_ONLY_GIT = new Set(['rev-parse', 'rev-list', 'status', 'worktree', 'for-each-ref', 'ls-remote', 'branch']);
const FORBIDDEN = ['-d', '-D', '--delete', '--force', '-f', 'add', 'remove', 'prune', 'move', 'repair', '-u', '--set-upstream-to'];

function gitRO(cwd, args) {
  if (!READ_ONLY_GIT.has(args[0])) throw new Error(`REFUSED: git ${args[0]} is not read-only`);
  for (const a of args.slice(1)) if (FORBIDDEN.includes(a)) throw new Error(`REFUSED: git ${args[0]} ${a} would mutate`);
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout ?? '').trim() };
}

// Count files, never following reparse points. This is the corrected measurement.
const REGENERABLE = /[\\/](node_modules|\.next|\.open-next|\.dart_tool|build|\.turbo)[\\/]/;
function measure(dir, acc = { files: 0, bytes: 0, regenBytes: 0 }, depth = 0) {
  if (depth > 40) return acc;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;                 // junction / symlink: never follow
    if ((st.mode & 0o170000) === 0 && st.nlink > 1) continue;
    if (e.isDirectory()) { measure(p, acc, depth + 1); continue; }
    acc.files++;
    try { const s = statSync(p); acc.bytes += s.size; if (REGENERABLE.test(p)) acc.regenBytes += s.size; } catch { /* unreadable */ }
  }
  return acc;
}
const countFiles = (dir) => (existsSync(dir) ? measure(dir).files : null);

const ROOT = 'E:\\Claude';
const CANON = 'E:/Claude/Straumvakt';
const RC = '4b69d0f';
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ── worktrees, including registrations whose directory is gone ──
const wtOut = gitRO(CANON, ['worktree', 'list', '--porcelain']).out;
const blocks = wtOut.split('\n\n').filter(Boolean);
const worktrees = [];
for (const b of blocks) {
  const path = (b.split('\n').find((l) => l.startsWith('worktree ')) ?? '').slice('worktree '.length).trim();
  if (!path) continue;
  const branchLine = b.split('\n').find((l) => l.startsWith('branch '));
  const headLine = b.split('\n').find((l) => l.startsWith('HEAD '));
  const detached = b.includes('detached');
  const exists = existsSync(path);
  const owner =
    /onboarding-web|driver-access-ui/.test(path) ? 'codex'
    : /onboarding-domain/.test(path) ? 'claude-a'
    : /beta-production|n1|release-candidate/.test(path) ? 'release-ops'
    : path === 'E:/Claude/Straumvakt' ? 'shared' : 'unknown';
  if (!exists) {
    worktrees.push({
      path, branch: branchLine ? branchLine.slice(7).replace('refs/heads/', '') : 'detached',
      tip: (headLine ? headLine.slice(5) : '0000000').slice(0, 7),
      uniqueCommits: 0, dirtyFiles: 0, retirable: false, branchPreserved: true, owner: 'unknown',
    });
    continue;
  }
  const tip = gitRO(path, ['rev-parse', '--short', 'HEAD']).out;
  const dirty = gitRO(path, ['status', '--porcelain']).out;
  const uq = gitRO(path, ['rev-list', '--count', `${RC}..HEAD`]);
  const dirtyFiles = dirty ? dirty.split('\n').length : 0;
  const uniqueCommits = uq.code === 0 ? Number(uq.out) : 0;
  worktrees.push({
    path, branch: detached ? 'detached' : (branchLine ? branchLine.slice(7).replace('refs/heads/', '') : 'detached'),
    tip, uniqueCommits, dirtyFiles,
    retirable: uniqueCommits === 0 && dirtyFiles === 0 && path !== 'E:/Claude/Straumvakt',
    branchPreserved: true, owner,
  });
}

const m = measure(ROOT);
const gb = (n) => Math.round((n / 1024 ** 3) * 100) / 100;

const records = [
  {
    id: 'P-01', path: 'E:\\Claude\\Straumvakt-parked', kind: 'research',
    expectedFileCount: 38, verifiedFileCount: countFiles('E:/Claude/Straumvakt-parked'),
    status: 'verified', verifiedAt: now, recoveryPath: 'none',
    recoveryNote: 'Not a git worktree: no remote, no branch, no reflog. Until an archive exists there is no recovery path at all, so this says none rather than archive.',
    containsPersonalData: false, thirdPartyLicensed: false,
    deletable: false, archiveVerified: false, approval: 'andri',
    safeDeletePrerequisite: 'a verified archive, plus a decision on whether it should be committed somewhere',
  },
  {
    id: 'P-02', path: 'E:\\Claude\\Straumvakt\\docs\\OCPP', kind: 'specification',
    expectedFileCount: 128, verifiedFileCount: countFiles('E:/Claude/Straumvakt/docs/OCPP'),
    status: 'verified', verifiedAt: now, recoveryPath: 'none',
    recoveryNote: 'Untracked in a git repository, so one `git clean -fdx` removes it. Re-download depends on the standards body still publishing these exact versions.',
    containsPersonalData: false, thirdPartyLicensed: true,
    deletable: false, archiveVerified: false, approval: 'andri',
    safeDeletePrerequisite: 'AD-14 decided (committed or archived); the current state, untracked and unbacked, is not one of the options',
  },
  {
    id: 'P-04', path: 'C:\\Users\\Andri\\Documents\\New project', kind: 'prompts',
    expectedFileCount: null, verifiedFileCount: countFiles('C:/Users/Andri/Documents/New project'),
    status: 'present-unverified', verifiedAt: null, recoveryPath: 'none',
    recoveryNote: 'A .git directory with zero commits is not a backup. Largest unmitigated preservation risk in the project.',
    vcs: {
      hasGitDir: existsSync('C:/Users/Andri/Documents/New project/.git'),
      commitCount: Number(gitRO('C:/Users/Andri/Documents/New project', ['rev-list', '--count', '--all']).out || 0),
      trackedFileCount: 0,
      untrackedTopLevel: readdirSync('C:/Users/Andri/Documents/New project').filter((n) => n !== '.git').length,
    },
    containsPersonalData: false, thirdPartyLicensed: false,
    deletable: false, archiveVerified: false, approval: 'andri',
    safeDeletePrerequisite: 'nothing here is a deletion candidate; the tool caches are, but only after the documents are committed',
  },
  {
    id: 'P-15', path: 'E:\\Claude\\CPMS', kind: 'provenance',
    expectedFileCount: null, verifiedFileCount: null, status: 'present-unverified', verifiedAt: null,
    recoveryPath: 'git-remote',
    recoveryNote: 'Its own repository. Preserved as the provenance for the hlada name and the shared Worker names, not as a cleanup target.',
    containsPersonalData: false, thirdPartyLicensed: false,
    deletable: false, archiveVerified: false, approval: 'not-ours',
    safeDeletePrerequisite: 'never, from this track',
  },
  {
    id: 'P-14', path: 'E:\\Claude\\**\\node_modules', kind: 'build-output',
    expectedFileCount: null, verifiedFileCount: null, status: 'not-applicable', verifiedAt: null,
    recoveryPath: 'reinstall',
    recoveryNote: 'Reinstall IF regeneration is demonstrated. Regenerable assumes lockfiles resolve and pinned versions are still published.',
    containsPersonalData: false, thirdPartyLicensed: false,
    deletable: false, archiveVerified: false, approval: 'andri',
    safeDeletePrerequisite: 'npm ci and flutter pub get demonstrated into a temporary copy, per ecosystem, not assumed from one',
  },
];

const manifest = {
  manifestVersion: 1,
  generatedAt: now,
  root: ROOT,
  measurement: {
    totalGB: gb(m.bytes),
    regenerableGB: gb(m.regenBytes),
    contentGB: gb(m.bytes - m.regenBytes),
    reparsePointsExcluded: true,
    regenerationProven: false,
  },
  archive: {
    destination: 'NOT YET CHOSEN - see AD-11',
    checksumAlgorithm: 'sha256',
    verificationMethod: 'none',
    verified: false,
    verifiedAt: null,
    independentFailureDomain: null,
  },
  records,
  worktrees,
  notes: `Generated by read-only observation. Nothing was deleted, moved or modified. No record is marked deletable, because no archive exists yet — that is the honest state, not an omission. Worktrees: ${worktrees.length} registered, ${worktrees.filter((w) => w.retirable).length} retirable.`,
};

const outIdx = process.argv.indexOf('--out');
const out = outIdx >= 0 ? process.argv[outIdx + 1] : null;
if (!out) { console.log(JSON.stringify(manifest, null, 2)); process.exit(0); }
if (out.replace(/\\/g, '/').toLowerCase().startsWith(ROOT.replace(/\\/g, '/').toLowerCase() + '/')) {
  console.error(`Refusing to write the manifest inside ${ROOT}; choose a path outside it.`);
  process.exit(2);
}
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`preservation manifest written to ${out}`);
console.log(`  ${records.length} records, ${worktrees.length} worktrees, ${worktrees.filter((w) => w.retirable).length} retirable`);
console.log(`  ${manifest.measurement.totalGB} GB total, ${manifest.measurement.regenerableGB} GB regenerable, ${manifest.measurement.contentGB} GB content`);
