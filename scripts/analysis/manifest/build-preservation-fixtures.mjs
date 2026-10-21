#!/usr/bin/env node
// Fixture generator for the preservation-manifest validator.
//
// Every negative fixture is the base manifest with EXACTLY ONE thing changed. A
// negative fixture that fails for two reasons proves nothing about either — that
// mistake was made once already on the release-manifest fixtures and is not worth
// repeating.
//
// Offline: reads nothing, writes only into preservation-fixtures/.
//   node build-preservation-fixtures.mjs

import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'preservation-fixtures');
mkdirSync(DIR, { recursive: true });
const clone = (o) => JSON.parse(JSON.stringify(o));
const write = (n, o) => writeFileSync(join(DIR, `${n}.json`), JSON.stringify(o, null, 2) + '\n');

const T = '2026-08-09T15:00:00Z';

// The base is the estate as read-only inspection actually found it on 2026-08-09.
const base = {
  manifestVersion: 1,
  generatedAt: T,
  root: 'E:\\Claude',
  measurement: {
    totalGB: 43.76,
    regenerableGB: 41.57,
    contentGB: 2.25,
    reparsePointsExcluded: true,
    regenerationProven: true,
  },
  archive: {
    destination: 'C:\\Users\\Andri\\Archive\\straumvakt-preservation-2026-08-09',
    checksumAlgorithm: 'sha256',
    verificationMethod: 'extract-and-compare',
    verified: true,
    verifiedAt: T,
    independentFailureDomain: true,
  },
  records: [
    {
      id: 'P-01', path: 'E:\\Claude\\Straumvakt-parked', kind: 'research',
      expectedFileCount: 38, verifiedFileCount: 38, status: 'verified', verifiedAt: T,
      recoveryPath: 'archive',
      recoveryNote: 'Not a git worktree. No remote, no branch, no reflog. It exists in exactly one place.',
      containsPersonalData: false, thirdPartyLicensed: false,
      deletable: false, archiveVerified: true, approval: 'andri',
      safeDeletePrerequisite: 'verified archive extraction, plus a decision on whether it should be committed somewhere',
    },
    {
      id: 'P-02', path: 'E:\\Claude\\Straumvakt\\docs\\OCPP', kind: 'specification',
      expectedFileCount: 128, verifiedFileCount: 128, status: 'verified', verifiedAt: T,
      recoveryPath: 'archive',
      recoveryNote: 'Untracked in a git repository. Re-download depends on the standards body still publishing these versions.',
      containsPersonalData: false, thirdPartyLicensed: true,
      deletable: false, archiveVerified: true, approval: 'andri',
      safeDeletePrerequisite: 'AD-14 decided: committed or archived. The current state, untracked and unbacked, is not one of the options.',
    },
    {
      id: 'P-04', path: 'C:\\Users\\Andri\\Documents\\New project', kind: 'prompts',
      expectedFileCount: null, verifiedFileCount: 22887, status: 'present-unverified', verifiedAt: null,
      recoveryPath: 'none',
      recoveryNote: 'A .git directory with zero commits is not a backup. This is the single largest unmitigated preservation risk in the project.',
      vcs: { hasGitDir: true, commitCount: 0, trackedFileCount: 0, untrackedTopLevel: 160 },
      containsPersonalData: false, thirdPartyLicensed: false,
      deletable: false, archiveVerified: false, approval: 'andri',
      safeDeletePrerequisite: 'nothing here is a deletion candidate; the tool caches are, but only after the documents are committed',
    },
    {
      id: 'P-14', path: 'E:\\Claude\\**\\node_modules', kind: 'build-output',
      expectedFileCount: null, verifiedFileCount: null, status: 'not-applicable', verifiedAt: null,
      recoveryPath: 'reinstall',
      recoveryNote: 'Reinstall, IF the demonstration in P-20 held. Regenerable assumes lockfiles resolve and pinned versions are still published.',
      containsPersonalData: false, thirdPartyLicensed: false,
      deletable: true, archiveVerified: false, approval: 'andri',
      safeDeletePrerequisite: 'npm ci and flutter pub get demonstrated to succeed into a temporary copy, per ecosystem, not assumed from one',
    },
  ],
  junctions: [
    {
      junction: 'E:\\Claude\\Straumvakt-n1\\node_modules',
      target: 'E:\\Claude\\Straumvakt\\node_modules',
      crossWorktree: true,
      unlinkCommand: 'cmd /c rmdir "E:\\Claude\\Straumvakt-n1\\node_modules"',
      targetFileCountBefore: 41207, targetFileCountAfter: 41207,
    },
  ],
  worktrees: [
    {
      path: 'E:\\Claude\\Straumvakt-n1', branch: 'dev/n1-org-landing', tip: '52e3b32',
      uniqueCommits: 0, dirtyFiles: 0, retirable: true, branchPreserved: true, owner: 'release-ops',
    },
    {
      path: 'E:\\Claude\\Straumvakt-onboarding-web', branch: 'codex/onboarding-web-experience', tip: '0f4dbc8',
      uniqueCommits: 12, dirtyFiles: 0, retirable: false, branchPreserved: true, owner: 'codex',
    },
  ],
  notes: 'Preservation register. Nothing has been deleted, moved or modified. Deletion is a separate, separately approved session.',
};

const F = {};
const rec = (m, id) => m.records.find((r) => r.id === id);

// ───────────────────────────── valid ─────────────────────────────
F['estate-full.valid'] = base;

// The smallest manifest that can be valid FOR THIS ESTATE. It is not one record:
// P5 requires all three irreplaceable targets, because a register that omits one
// is exactly how an untracked directory disappears. No measurement, no junctions,
// no worktrees — those sections are optional; the three targets are not.
F['minimal.valid'] = {
  manifestVersion: 1, generatedAt: T, root: 'E:\\Claude',
  archive: {
    destination: 'C:\\Users\\Andri\\Archive\\min', checksumAlgorithm: 'sha512',
    verificationMethod: 'extract-and-compare', verified: true, verifiedAt: T,
    independentFailureDomain: true,
  },
  records: [clone(rec(base, 'P-01')), clone(rec(base, 'P-02')), clone(rec(base, 'P-04'))],
  notes: 'Smallest manifest that satisfies every rule for this estate: the three targets with no recovery path other than a copy, a verified archive, nothing deletable.',
};

{
  // Deletion is representable, but only with the full chain of prerequisites.
  const m = clone(base);
  const r = rec(m, 'P-01');
  r.deletable = true; r.archiveVerified = true;
  m.notes = 'A deletion that is actually safe: verified archive, extract-and-compare, independent failure domain, prerequisite stated.';
  F['deletion-fully-earned.valid'] = m;
}

// ──────────────────────────── invalid ────────────────────────────
{
  const m = clone(base);
  const r = rec(m, 'P-01'); r.deletable = true; r.archiveVerified = false;
  m.notes = 'P1. Marked deletable and relying on the archive, but this record was never confirmed present in it.';
  F['deletable-without-archive-proof.invalid'] = m;
}
{
  const m = clone(base);
  m.archive.verificationMethod = 'listing-only';
  m.notes = 'P2. The archive was verified by reading its own table of contents, which proves the table of contents exists.';
  F['archive-verified-by-listing.invalid'] = m;
}
{
  const m = clone(base);
  m.archive.destination = 'E:\\Claude\\_archive\\preservation-2026-08-09';
  m.notes = 'P3. The archive lives inside the tree being cleaned, so it would be destroyed by the operation it exists to survive.';
  F['archive-inside-root.invalid'] = m;
}
{
  const m = clone(base);
  const r = rec(m, 'P-01'); r.deletable = true; r.archiveVerified = true; r.safeDeletePrerequisite = null;
  m.notes = 'P4. Deletable with no stated prerequisite: nothing has to be true before someone deletes it.';
  F['deletable-no-prerequisite.invalid'] = m;
}
{
  const m = clone(base);
  m.records = m.records.filter((r) => r.id !== 'P-02');
  m.notes = 'P5. The OCPP specifications are simply absent from the register, which is how untracked things disappear.';
  F['missing-ocpp-record.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-02').verifiedFileCount = 127;
  m.notes = 'P5. One specification file short. A count that nearly matches is the most dangerous kind.';
  F['ocpp-count-mismatch.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-01').status = 'missing';
  m.notes = 'P5. A preservation target reported missing. Everything stops here.';
  F['parked-missing.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-04').recoveryPath = 'git-remote';
  m.notes = 'P6. Zero commits, but recorded as recoverable from a remote. This is the exact mistake the .git directory invites.';
  F['empty-repo-claims-remote-recovery.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-04').vcs.trackedFileCount = 40;
  m.notes = 'P6. Zero commits with tracked files is impossible; one of the two numbers was not actually measured.';
  F['zero-commits-with-tracked-files.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-01').verifiedAt = null;
  m.notes = 'P7. Status verified, no timestamp. That is an assertion, not a verification.';
  F['verified-without-timestamp.invalid'] = m;
}
{
  const m = clone(base);
  m.archive.checksumAlgorithm = 'md5';
  m.notes = 'P8. Integrity established with an algorithm that no longer establishes integrity.';
  F['weak-checksum.invalid'] = m;
}
{
  const m = clone(base);
  const r = clone(rec(base, 'P-01'));
  r.id = 'P-19'; r.path = 'E:\\Claude\\exports\\beta-users'; r.kind = 'personal-data';
  r.containsPersonalData = true; r.dataProtectionApproved = false;
  r.expectedFileCount = null; r.verifiedFileCount = null;
  m.records.push(r);
  m.notes = 'P9. Real users\u2019 data copied into an archive because it was convenient for safety.';
  F['personal-data-unapproved.invalid'] = m;
}
{
  const m = clone(base);
  m.junctions[0].unlinkCommand = 'Remove-Item -Recurse -Force "E:\\Claude\\Straumvakt-n1\\node_modules"';
  m.notes = 'P10. The one command that follows the junction and deletes the target instead of the link.';
  F['junction-recursive-delete.invalid'] = m;
}
{
  const m = clone(base);
  m.junctions[0].targetFileCountAfter = 0;
  m.notes = 'P10. The target emptied during an unlink, which means the delete followed the link. Detected after the fact, which is still better than not at all.';
  F['junction-target-lost-files.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[1].retirable = true;
  m.notes = 'P11. A worktree with 12 unique commits marked retirable.';
  F['retirable-with-unique-commits.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[0].dirtyFiles = 9;
  m.notes = 'P11. Zero unique commits, but nine uncommitted files. That is another agent\u2019s work in progress.';
  F['retirable-with-dirty-files.invalid'] = m;
}
{
  const m = clone(base);
  m.worktrees[0].branchPreserved = false;
  m.notes = 'P11. Retiring the working copy AND the branch. The branch is the cheap part.';
  F['retirable-without-branch-preserved.invalid'] = m;
}
{
  const m = clone(base);
  m.measurement.reparsePointsExcluded = false;
  m.notes = 'P12. Measured with junctions followed, which is how the first attempt at this produced impossible figures.';
  F['measurement-follows-junctions.invalid'] = m;
}
{
  const m = clone(base);
  m.measurement.regenerableGB = 51.2;
  m.notes = 'P12. More reclaimable space than the tree contains. This is the signature, not the cause.';
  F['regenerable-exceeds-total.invalid'] = m;
}
{
  const m = clone(base);
  m.records.push(clone(rec(base, 'P-02')));
  m.notes = 'P14. Two records share an id, so a citation to it is ambiguous.';
  F['duplicate-record-id.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-01').id = 'P1';
  m.notes = 'Schema pattern. An id that does not sort or cite cleanly.';
  F['bad-record-id-pattern.invalid'] = m;
}
{
  const m = clone(base);
  m.records = [];
  m.notes = 'Schema minItems. A preservation manifest that preserves nothing.';
  F['no-records.invalid'] = m;
}
{
  const m = clone(base);
  m.archve = m.archive; delete m.archive;
  m.notes = 'Schema. A typo that silently removes the entire archive section.';
  F['typo-archive-key.invalid'] = m;
}
{
  const m = clone(base);
  m.generatedAt = '2026-08-09 15:00';
  m.notes = 'Schema pattern. A timestamp with no timezone is not an instant.';
  F['non-utc-timestamp.invalid'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-02').status = 'verified';
  rec(m, 'P-02').verifiedFileCount = null;
  m.notes = 'P5. Claims verification of a target whose whole point is its file count, without counting it.';
  F['verified-without-count.invalid'] = m;
}

// ─────────── valid-but-warning: proves --strict does something ───────────
{
  const m = clone(base);
  m.junctions[0].unlinkCommand = 'Delete the junction (see runbook)';
  m.notes = 'P10 warning. Not a recursive delete, but not a recognised non-following form either. An operator would have to interpret it.';
  F['junction-unrecognised-unlink.warns'] = m;
}
{
  const m = clone(base);
  m.measurement.regenerationProven = false;
  m.notes = 'P12 warning. Build output marked deletable on the assumption that npm and pub will still resolve the pinned versions.';
  F['regeneration-unproven.warns'] = m;
}
{
  const m = clone(base);
  rec(m, 'P-02').recoveryPath = 'git-remote';
  m.notes = 'P13 warning. Third-party specifications recorded as recoverable from a git remote, which means committing them, which is a redistribution decision.';
  F['third-party-via-git.warns'] = m;
}
{
  const m = clone(base);
  m.archive.independentFailureDomain = false;
  m.notes = 'P15 warning. An archive on the same disk. Protects against a wrong delete, not against losing the disk.';
  F['archive-same-failure-domain.warns'] = m;
}

for (const [name, doc] of Object.entries(F)) write(name, doc);
const total = readdirSync(DIR).filter((f) => f.endsWith('.json')).length;
console.log(`wrote ${Object.keys(F).length} preservation fixtures; ${total} total in preservation-fixtures/`);
