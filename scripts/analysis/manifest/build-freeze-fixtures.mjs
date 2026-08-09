#!/usr/bin/env node
// Fixture generator for the freeze-manifest validator.
//
// The "clean" fixture is the estate as it SHOULD be after remediation, not as it
// is. The estate as it is fails six ways, and that is captured separately in
// current-estate.invalid.json — an honest baseline is more useful than a
// flattering one.
//
// Every negative fixture differs from clean in exactly one way.
//
//   node build-freeze-fixtures.mjs

import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'freeze-fixtures');
mkdirSync(DIR, { recursive: true });
const clone = (o) => JSON.parse(JSON.stringify(o));
const write = (n, o) => writeFileSync(join(DIR, `${n}.json`), JSON.stringify(o, null, 2) + '\n');

const T = '2026-08-09T22:30:00Z';

const wt = (o) => Object.assign({
  path: 'E:\\Claude\\Straumvakt-example',
  existsOnDisk: true, branch: 'dev/example', detached: false, head: 'abc1234',
  dirtyFiles: 0, untrackedFiles: 0, untrackedPreservationMaterial: false,
  upstream: null, upstreamExistsOnRemote: null, branchExistsOnRemote: true,
  uniqueVsCandidate: 0, headIsForbidden: null, forbiddenAncestors: [],
  owner: 'release-ops', suggestedAction: 'keep', actionRationale: null,
  branchPreserved: true, archiveDestination: null,
}, o);

const un = (o) => Object.assign({
  path: 'E:\\Claude\\example', kind: 'non-git-directory',
  totalFiles: 10, contentFiles: 10, straumvaktContent: false,
  coveredByPreservationRecord: null, credentialShapedFiles: [],
  suggestedAction: 'keep', actionRationale: null,
}, o);

const totalsFor = (wts) => ({
  registered: wts.length,
  onDisk: wts.filter((w) => w.existsOnDisk !== false).length,
  staleRegistrations: wts.filter((w) => w.existsOnDisk === false).length,
  localBranches: 43, remoteBranches: 16, localBranchesWithoutRemote: 29,
});

const cleanWts = [
  wt({ path: 'E:\\Claude\\Straumvakt', branch: 'dev/straumvakt-org-relaunch', head: '10c292b',
       owner: 'shared', dirtyFiles: 24, untrackedFiles: 3, suggestedAction: 'keep',
       actionRationale: 'The canonical checkout. Never a cleanup candidate.' }),
  wt({ path: 'E:\\Claude\\Straumvakt-beta-production', branch: 'docs/beta-production-release-architecture',
       head: '606ceae', uniqueVsCandidate: 25, branchExistsOnRemote: false,
       suggestedAction: 'keep', actionRationale: '25 unique commits against the release candidate.' }),
  wt({ path: 'E:\\Claude\\Straumvakt-n1', branch: 'dev/n1-org-landing', head: '52e3b32',
       branchExistsOnRemote: false, suggestedAction: 'retire',
       actionRationale: 'Zero unique commits and zero dirty files. The branch exists on no remote, so the branch itself must be preserved even though the working copy need not be.' }),
];

const base = {
  manifestVersion: 1,
  generatedAt: T,
  root: 'E:\\Claude',
  canonicalRepo: 'E:\\Claude\\Straumvakt',
  releaseCandidate: '4b69d0f',
  forbiddenCommits: ['4fe0a95', '30fa407', '5311cbd'],
  totals: totalsFor(cleanWts),
  worktrees: cleanWts,
  unregistered: [
    un({ path: 'E:\\Claude\\Straumvakt-parked', totalFiles: 38, contentFiles: 38,
         straumvaktContent: true, coveredByPreservationRecord: 'P-01',
         actionRationale: 'Covered by preservation record P-01.' }),
    un({ path: 'E:\\Claude\\CPMS', kind: 'separate-git-repo', totalFiles: 221, contentFiles: 221,
         straumvaktContent: true, coveredByPreservationRecord: 'P-15',
         actionRationale: 'Covered by preservation record P-15 as provenance for the shared Worker names.' }),
  ],
  archiveDestination: 'C:\\Users\\Andri\\Archive\\straumvakt-2026-08-09',
  notes: 'The estate as it should be after remediation: no forbidden commit at HEAD, no branch tracking a deploy pointer, no stale registration, every piece of project content covered by a record.',
};

const F = {};
F['remediated.valid'] = base;

// ── the estate as it actually is, which fails ──
{
  const wts = [
    ...clone(cleanWts),
    wt({ path: 'E:\\Claude\\Straumvakt-rename-worker', branch: 'dev/rename-prod-worker', head: '4fe0a95',
         headIsForbidden: '4fe0a95', upstream: 'origin/staging', upstreamExistsOnRemote: true,
         branchExistsOnRemote: false, uniqueVsCandidate: 1, owner: 'unknown',
         suggestedAction: 'needs-human-review',
         actionRationale: 'HEAD is forbidden commit 4fe0a95. Nothing may be retired or archived from here until a human decides what happens to the branch.' }),
    wt({ path: 'E:\\Claude\\Straumvakt-catchup-runbook', branch: 'docs/staging-catchup-runbook', head: '30fa407',
         headIsForbidden: '30fa407', uniqueVsCandidate: 2, owner: 'unknown',
         branchExistsOnRemote: false, suggestedAction: 'needs-human-review',
         actionRationale: 'HEAD is forbidden commit 30fa407.' }),
    wt({ path: '/sessions/rcw-01fyf9w4byh1mrs6p2npr9my/mnt/Straumvakt-docs-log',
         branch: 'docs/relaunch-session-log-2026-08-08', head: '5311cbd', existsOnDisk: false,
         headIsForbidden: '5311cbd', branchExistsOnRemote: false, owner: 'unknown',
         suggestedAction: 'stale-registration-cleanup',
         actionRationale: 'Registration left behind by a session whose filesystem is gone.' }),
    wt({ path: 'E:\\Claude\\Straumvakt-secret-hygiene-v2', branch: 'dev/secret-hygiene-v2', head: '174475f',
         upstream: 'origin/staging', upstreamExistsOnRemote: true, branchExistsOnRemote: false,
         uniqueVsCandidate: 1, owner: 'unknown', suggestedAction: 'keep',
         actionRationale: '1 unique commit against the release candidate.' }),
  ];
  const m = clone(base);
  m.worktrees = wts;
  m.totals = totalsFor(wts);
  m.unregistered = [
    ...clone(base.unregistered),
    un({ path: 'E:\\Claude\\zaptec-test', totalFiles: 15444, contentFiles: 62,
         straumvaktContent: true, coveredByPreservationRecord: null,
         credentialShapedFiles: ['E:\\Claude\\zaptec-test\\.env'],
         suggestedAction: 'needs-human-review',
         actionRationale: 'Zaptec API integration source and an openapi.json, in no preservation record, alongside a credential-shaped file whose contents were never opened.' }),
  ];
  m.notes = 'The estate as observed on 2026-08-09. It fails, and that is the point of recording it.';
  F['current-estate.invalid'] = m;
}

// ── one rule per fixture ──
{
  const m = clone(base);
  m.worktrees.push(wt({ path: 'E:\\Claude\\Straumvakt-rename-worker', branch: 'dev/rename-prod-worker',
    head: '4fe0a95', headIsForbidden: '4fe0a95', branchExistsOnRemote: false,
    suggestedAction: 'needs-human-review', actionRationale: 'HEAD is a forbidden commit.' }));
  m.totals = totalsFor(m.worktrees);
  m.notes = 'FZ1. A working copy sitting on a forbidden commit — HEAD, not merely reachable.';
  F['forbidden-at-head.invalid'] = m;
}
{
  const m = clone(base);
  // head matches a forbidden sha but the field was not filled from the same source
  m.worktrees.push(wt({ path: 'E:\\Claude\\Straumvakt-drift', branch: 'dev/drift', head: '30fa407',
    headIsForbidden: null, branchExistsOnRemote: false }));
  m.totals = totalsFor(m.worktrees);
  m.notes = 'FZ1. HEAD is a forbidden sha while headIsForbidden says null — the two fields did not come from the same source.';
  F['forbidden-head-unflagged.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[2].upstream = 'origin/staging';
  m.worktrees[2].upstreamExistsOnRemote = true;
  m.worktrees[2].suggestedAction = 'keep';
  m.worktrees[2].actionRationale = null;
  m.notes = 'FZ2. A branch tracking the deploy pointer: a bare push publishes to the branch that may trigger a deploy.';
  F['tracks-deploy-pointer.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees.push(wt({ path: 'E:\\Claude\\Straumvakt-gone', branch: 'docs/gone', head: 'dead123',
    existsOnDisk: false, branchExistsOnRemote: false, suggestedAction: 'keep',
    actionRationale: 'wrongly marked keep' }));
  m.totals = totalsFor(m.worktrees);
  m.notes = 'FZ3. A registration whose directory is gone, recorded as keep rather than as needing a prune.';
  F['stale-registration-mislabelled.invalid'] = m;
}
{
  const m = clone(base);
  m.unregistered.push(un({ path: 'E:\\Claude\\zaptec-test', totalFiles: 15444, contentFiles: 62,
    straumvaktContent: true, coveredByPreservationRecord: null, suggestedAction: 'needs-human-review' }));
  m.notes = 'FZ4. Project content under the estate root that no preservation record covers — the class that gets deleted because nobody wrote it down.';
  F['unregistered-content-uncovered.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[2].uniqueVsCandidate = 4;
  m.notes = 'FZ5. Suggested for retire with four unique commits.';
  F['retire-with-unique-commits.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[2].dirtyFiles = 9;
  m.notes = 'FZ5. Suggested for retire with nine dirty files — somebody\u2019s uncommitted work.';
  F['retire-with-dirty-files.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[2].branchPreserved = false;
  m.notes = 'FZ5. Retiring the working copy AND the branch. The branch is the cheap part.';
  F['retire-without-branch-preserved.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[2].actionRationale = null;
  m.notes = 'FZ6. Retire suggested for a branch that exists on no remote, with no rationale recorded.';
  F['retire-remoteless-no-rationale.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[1].upstream = 'origin/docs/beta-production-release-architecture';
  m.worktrees[1].upstreamExistsOnRemote = false;
  m.notes = 'FZ7 warning. An upstream that does not exist on origin: a push would create it.';
  F['upstream-missing-on-remote.warns'] = m;
}
{
  const m = clone(base);
  m.worktrees.push(wt({ path: 'E:\\Claude\\Straumvakt-duplicate', branch: 'dev/n1-org-landing',
    head: '52e3b32', branchExistsOnRemote: false, suggestedAction: 'keep',
    actionRationale: 'duplicate branch' }));
  m.totals = totalsFor(m.worktrees);
  m.notes = 'FZ8. One branch recorded in two worktrees — a state git normally refuses, so the inventory or the repository is wrong.';
  F['branch-in-two-worktrees.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[2].untrackedPreservationMaterial = true;
  m.worktrees[2].untrackedFiles = 6;
  m.notes = 'FZ9. Untracked documents in a worktree suggested for retire. Untracked documents have no remote and no reflog.';
  F['retire-with-untracked-docs.invalid'] = m;
}
{
  const m = clone(base);
  m.archiveDestination = null;
  m.worktrees[2].suggestedAction = 'archive';
  m.worktrees[2].archiveDestination = null;
  m.notes = 'FZ10. Archive suggested with no destination anywhere — an intention, not a plan.';
  F['archive-without-destination.invalid'] = m;
}
{
  const m = clone(base);
  m.totals.registered = 99;
  m.notes = 'FZ11. The totals disagree with the rows. A count that disagrees with its own evidence is how a stale registration hid for this long.';
  F['totals-disagree.invalid'] = m;
}
{
  const m = clone(base);
  m.unregistered.push(un({ path: 'E:\\Claude\\zaptec-test', totalFiles: 15444, contentFiles: 62,
    straumvaktContent: true, coveredByPreservationRecord: 'P-21',
    credentialShapedFiles: ['E:\\Claude\\zaptec-test\\.env'],
    suggestedAction: 'archive',
    actionRationale: 'archiving without dealing with the credential' }));
  m.notes = 'FZ12. Archiving a directory that contains a credential-shaped file would copy a live credential into a second place.';
  F['archive-with-credential.invalid'] = m;
}
{
  const m = clone(base);
  m.unregistered.push(un({ path: 'E:\\Claude\\spike', totalFiles: 20, contentFiles: 20,
    straumvaktContent: true, coveredByPreservationRecord: 'P-22',
    credentialShapedFiles: ['E:\\Claude\\spike\\.env'],
    suggestedAction: 'keep' }));
  m.notes = 'FZ12 warning. A credential-shaped file recorded, not archived, and not yet triaged.';
  F['credential-not-triaged.warns'] = m;
}
{
  const m = clone(base);
  m.unregistered.push(un({ path: 'E:\\Claude\\spike', totalFiles: 20, contentFiles: 20,
    straumvaktContent: true, coveredByPreservationRecord: 'P-23',
    credentialShapedFiles: ['AUTH_SECRET=hunter2'],
    suggestedAction: 'needs-human-review' }));
  m.notes = 'FZ12. Someone pasted a value into the field that takes paths. That is the mistake this field exists to make impossible to hide.';
  F['credential-value-in-path-field.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[0].head = 'ZZZZZZZ';
  m.notes = 'Schema pattern. A HEAD that is not a sha.';
  F['bad-head-sha.invalid'] = m;
}
{
  const m = clone(base);
  m.forbiddenCommits = [];
  m.notes = 'Schema minItems. A freeze manifest that does not say which commits are forbidden cannot check for them.';
  F['no-forbidden-list.invalid'] = m;
}
{
  const m = clone(base);
  m.worktreez = m.worktrees;
  m.notes = 'Schema additionalProperties. A typo that would silently empty the inventory.';
  F['typo-worktrees-key.invalid'] = m;
}
{
  const m = clone(base);
  m.generatedAt = '2026-08-09 22:30';
  m.notes = 'Schema pattern. A timestamp with no timezone is not an instant.';
  F['non-utc-timestamp.invalid'] = m;
}

for (const [name, doc] of Object.entries(F)) write(name, doc);
const total = readdirSync(DIR).filter((f) => f.endsWith('.json')).length;
console.log(`wrote ${Object.keys(F).length} freeze fixtures; ${total} total in freeze-fixtures/`);
