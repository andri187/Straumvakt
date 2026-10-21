#!/usr/bin/env node
// Fixture generator for the branch-safety checker.
//
// These are SNAPSHOTS, not repositories. That is the point of splitting
// collection from evaluation: you cannot conveniently manufacture "two branches
// sharing an upstream" in a real repo just to test a rule, but you can write it
// down in ten lines and test the rule properly.
//
// The clean fixture is the local state as it SHOULD be, not as it currently is.
// The current state is captured in current-estate.error.json, which fails — that
// is the honest baseline.
//
//   node build-branch-safety-fixtures.mjs

import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'branch-safety-fixtures');
mkdirSync(DIR, { recursive: true });
const clone = (o) => JSON.parse(JSON.stringify(o));
const write = (n, o) => writeFileSync(join(DIR, `${n}.json`), JSON.stringify(o, null, 2) + '\n');

const clean = {
  snapshotVersion: 1,
  repo: 'E:\\Claude\\Straumvakt',
  collectedFrom: ['E:\\Claude\\Straumvakt'],
  worktrees: [
    { path: 'E:\\Claude\\Straumvakt', branch: 'dev/straumvakt-org-relaunch', tip: '10c292b', dirtyFiles: 24 },
    { path: 'E:\\Claude\\Straumvakt-beta-production', branch: 'docs/beta-production-release-architecture', tip: '56af65d', dirtyFiles: 0 },
  ],
  branches: [
    { name: 'staging', upstream: 'origin/staging', sha: 'f53fb55', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'dev/rename-prod-worker', upstream: null, sha: 'aaa1111', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'dev/secret-hygiene-v2', upstream: null, sha: 'bbb2222', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'docs/beta-production-release-architecture', upstream: null, sha: '56af65d', worktree: 'E:\\Claude\\Straumvakt-beta-production' },
  ],
  remoteRefs: Array.from({ length: 16 }, (_, i) => ({ ref: i === 0 ? 'staging' : `dev/branch-${i}`, sha: i === 0 ? 'f53fb55e1229' : `${i}`.padStart(12, '0') })),
  forbiddenCommits: [
    { sha: '4fe0a95', ref: '4b69d0f', resolved: true, present: false },
    { sha: '4fe0a95', ref: 'origin/staging', resolved: true, present: false },
    { sha: '30fa407', ref: '4b69d0f', resolved: true, present: false },
    { sha: '30fa407', ref: 'origin/staging', resolved: true, present: false },
    { sha: '5311cbd', ref: '4b69d0f', resolved: true, present: false },
    { sha: '5311cbd', ref: 'origin/staging', resolved: true, present: false },
  ],
  fastForward: { from: 'origin/staging', to: '4b69d0f', leftOnly: 0, rightOnly: 166 },
  config: { 'push.default': 'simple', 'core.hooksPath': '.githooks', 'receive.denyNonFastForwards': null },
  hooks: { prePush: true },
};

const F = {};
F['remediated.clean'] = clean;

// ── The estate as it actually is right now. This fails, and should. ──
{
  const m = clone(clean);
  m.branches = [
    { name: 'staging', upstream: 'origin/staging', sha: 'f53fb55', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'dev/rename-prod-worker', upstream: 'origin/staging', sha: 'aaa1111', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'dev/secret-hygiene-v2', upstream: 'origin/staging', sha: 'bbb2222', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'docs/ci-and-custom-domain', upstream: 'origin/dev/drizzle-ownership-and-market-harvest', sha: 'ccc3333', worktree: 'E:\\Claude\\Straumvakt' },
    { name: 'fix/prisma-migrations-path', upstream: 'origin/dev/drizzle-ownership-and-market-harvest', sha: 'ddd4444', worktree: 'E:\\Claude\\Straumvakt' },
  ];
  m.config = { 'push.default': null, 'core.hooksPath': null, 'receive.denyNonFastForwards': null };
  m.hooks = { prePush: false };
  m.notes = 'The local state as observed on 2026-08-09. Two branches track the deploy pointer, two more share a mismatched upstream, push.default is unset and no hook exists.';
  F['current-estate.error'] = m;
}

// ── one rule per fixture ──
{
  const m = clone(clean);
  m.branches[1].upstream = 'origin/staging';
  m.notes = 'G1. dev/rename-prod-worker tracks the deploy pointer. It also carries the forbidden commit, which is why this one matters most.';
  F['tracks-deploy-pointer.error'] = m;
}
{
  const m = clone(clean);
  m.branches[1].upstream = 'origin/dev/some-other-branch';
  m.notes = 'G2. The upstream name does not match the branch name, so a push lands somewhere the command does not mention.';
  F['upstream-name-mismatch.warns'] = m;
}
{
  const m = clone(clean);
  m.branches[1].upstream = 'origin/shared-target';
  m.branches[2].upstream = 'origin/shared-target';
  m.notes = 'G3. Two branches share one upstream, so each silently overwrites the other.';
  F['shared-upstream.error'] = m;
}
{
  const m = clone(clean);
  m.forbiddenCommits[0].present = true;
  m.notes = 'G4. The forbidden commit is in the release candidate.';
  F['forbidden-commit-present.error'] = m;
}
{
  const m = clone(clean);
  m.forbiddenCommits[0].resolved = false;
  m.forbiddenCommits[0].present = null;
  m.notes = 'G4. The short sha did not resolve. Unresolved is not absent, and treating it as absent is the failure this rule prevents.';
  F['forbidden-commit-unresolved.error'] = m;
}
{
  const m = clone(clean);
  m.fastForward = { from: 'origin/staging', to: '4b69d0f', leftOnly: 3, rightOnly: 166 };
  m.notes = 'G5. Staging carries three commits the candidate does not, so a promotion would not be a fast-forward.';
  F['not-fast-forward.error'] = m;
}
{
  const m = clone(clean);
  m.fastForward = { from: 'origin/staging', to: '4b69d0f', leftOnly: null, rightOnly: null, resolved: false };
  m.notes = 'G5. One of the refs did not resolve, so the fast-forward claim is unverifiable rather than false.';
  F['fast-forward-unresolvable.warns'] = m;
}
{
  const m = clone(clean);
  m.config['push.default'] = 'matching';
  m.notes = 'G6. A bare git push can update branches nobody named.';
  F['push-default-matching.error'] = m;
}
{
  const m = clone(clean);
  m.config['push.default'] = null;
  m.notes = 'G6. push.default unset: what a bare push does depends on the git version, and is therefore not written down anywhere.';
  F['push-default-unset.warns'] = m;
}
{
  const m = clone(clean);
  m.hooks.prePush = false;
  m.config['core.hooksPath'] = null;
  m.notes = 'G7. Nothing locally refuses a push to the deploy pointer.';
  F['no-pre-push-hook.warns'] = m;
}
{
  const m = clone(clean);
  m.worktrees.push({ path: 'E:\\Claude\\Straumvakt-hotfix', branch: 'staging', tip: 'f53fb55', dirtyFiles: 7 });
  m.notes = 'G8. Uncommitted work sitting on the deploy pointer itself.';
  F['dirty-on-deploy-pointer.error'] = m;
}
{
  const m = clone(clean);
  m.remoteRefs = m.remoteRefs.slice(0, 15);
  m.notes = 'G9. Fifteen remote branches against a baseline of sixteen. Something was deleted, and finding out what comes before anything else.';
  F['remote-ref-count-changed.error'] = m;
}
{
  const m = clone(clean);
  m.remoteRefs[0].sha = '9999abcd1234';
  m.notes = 'G9. The deploy pointer moved. The first question is whether that triggered a deploy, not how to undo it.';
  F['deploy-pointer-moved.error'] = m;
}

for (const [name, doc] of Object.entries(F)) write(name, doc);
const total = readdirSync(DIR).filter((f) => f.endsWith('.json')).length;
console.log(`wrote ${Object.keys(F).length} branch-safety fixtures; ${total} total in branch-safety-fixtures/`);
