#!/usr/bin/env node
// Fixture generator for the release-manifest validator.
//
// Fixtures are derived from two hand-written bases so that a schema change does
// not require editing thirty files by hand — and so that each negative fixture
// differs from a valid one in EXACTLY ONE way. A negative fixture that fails for
// two reasons proves nothing about either.
//
// Offline: reads and writes only the fixtures directory. No network.
//   node build-fixtures.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'release-fixtures');
const read = (n) => JSON.parse(readFileSync(join(DIR, n), 'utf8'));
const write = (n, o) => writeFileSync(join(DIR, n), JSON.stringify(o, null, 2) + '\n');
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── Bring the two hand-written bases up to the expanded rule set ─────
const base = read('production-release.valid.json');
base.releasedAt = '2026-08-15T10:00:00Z';
base.cpmsSeparationVerified = true;
base.ocpp.mixedReleaseAcknowledged = true;
base.notes = 'Whole-estate production promotion. The gateway ships alongside web and api, acknowledged explicitly under R13.';
write('production-release.valid.json', base);

const beta = read('beta-release.valid.json');
beta.releasedAt = '2026-08-15T10:00:00Z';
beta.ocpp.mixedReleaseAcknowledged = true;
beta.notes = 'Beta promotion. betaTestedSince is null because this IS the first beta run of this sha.';
write('beta-release.valid.json', beta);

const P = (o) => Object.assign(clone(base), o);
const B = (o) => Object.assign(clone(beta), o);
const w = (role, name, o = {}) =>
  Object.assign({ role, name, workersDevRequired: false, workersDevDeclaredInConfig: true }, o);
const rb = (names, o = {}) =>
  Object.assign({
    unit: 'worker-version',
    workerVersionsBefore: Object.fromEntries(names.map((n, i) => [n, `v-${i}`])),
    minimumSafeVersion: null,
    restoreTimeMeasuredSec: 420,
  }, o);
const OK = { endpointUnchanged: true };

const F = {};

// ───────────────────────────── valid ─────────────────────────────
F['gateway-only-release.valid'] = B({
  workers: [w('ocpp', 'straumvakt-ocpp-staging', { workersDevRequired: true, durableObjects: ['IDENTITY_DO'] })],
  rollback: rb(['straumvakt-ocpp-staging']),
  ocpp: { endpointUnchanged: true, gatewayWorker: 'straumvakt-ocpp-staging' },
  notes: 'Gateway alone: one blast radius, one rollback decision. R13 needs no acknowledgement because nothing else ships.',
});
F['web-only-release.valid'] = B({
  workers: [w('web', 'hlada-staging', { customDomains: ['beta.straumvakt.org'], secretNames: ['AUTH_SECRET'] })],
  rollback: rb(['hlada-staging']), ocpp: OK,
  notes: 'Web only. Chargers untouched — stated explicitly rather than assumed.',
});
F['api-only-beta.valid'] = B({
  workers: [w('api', 'hlada-api-staging', {
    workersDevRequired: true, customDomains: ['beta.api.straumvakt.org'],
    secretNames: ['AUTH_SECRET', 'OCPP_INGEST_SECRET'],
  })],
  rollback: rb(['hlada-api-staging']), ocpp: OK,
  notes: 'API only. workersDevRequired is true because the shipped mobile app pins the workers.dev host.',
});
F['new-worker-with-justification.valid'] = B({
  workers: [w('web', 'straumvakt-web-preview', {
    newWorkerJustification: 'Preview environment created 2026-08-09; naming pending AD-03.',
  })],
  rollback: rb(['straumvakt-web-preview']), ocpp: OK,
  notes: 'An unknown Worker name is allowed, but only with a written justification.',
});
F['prose-placeholder-dsn.valid'] = B({
  workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']), ocpp: OK,
  notes: 'Documentation placeholders such as user:pw@host must not trip the secret scanner. A rule that fires on ordinary prose gets disabled, and a disabled rule protects nothing.',
});
F['production-strict-clean.valid'] = P({
  workers: [w('api', 'hlada-api-staging', { workersDevRequired: true, secretNames: ['AUTH_SECRET'] })],
  rollback: rb(['hlada-api-staging']), ocpp: OK,
  notes: 'Production API promotion with no warnings, so it passes --strict as well as the default mode.',
});

// ──────────────────────────── invalid ────────────────────────────
F['gateway-pinned-host-undeclared.invalid'] = B({
  workers: [w('ocpp', 'straumvakt-ocpp-staging', { workersDevRequired: true, workersDevDeclaredInConfig: false })],
  rollback: rb(['straumvakt-ocpp-staging']), ocpp: OK,
  notes: 'R4. The same latent condition as the API, but the blast radius is the charger fleet.',
});
F['gateway-missing-ocpp-statement.invalid'] = B({
  workers: [w('ocpp', 'straumvakt-ocpp-staging')],
  rollback: rb(['straumvakt-ocpp-staging']),
  ocpp: { gatewayWorker: 'straumvakt-ocpp-staging' },
  notes: 'R3. Gateway in the release, no continuity statement.',
});
{
  const m = clone(beta); delete m.ocpp.mixedReleaseAcknowledged;
  m.notes = 'R13. Gateway ships alongside web and api with no acknowledgement.';
  F['mixed-release-unacknowledged.invalid'] = m;
}
F['production-beta-neon-branch.invalid'] = P({
  data: Object.assign(clone(base.data), { neonBranchId: 'br-tiny-river-abgpqq37' }),
  notes: 'R6. Production pointed at the beta branch.',
});
{
  const m = clone(base); delete m.cpmsSeparationVerified;
  m.notes = 'R12. CPMS declares the same Worker names and separation is unverified.';
  F['production-missing-cpms-verification.invalid'] = m;
}
F['production-missing-restore-time.invalid'] = P({
  rollback: Object.assign(clone(base.rollback), { restoreTimeMeasuredSec: null }),
  notes: 'R14. The rollback duration is an estimate, not a measurement.',
});
F['production-missing-excluded-commits.invalid'] = P({
  approval: { approver: 'Andri', checksPassed: ['fast-forward'], excludedCommitsVerifiedAbsent: ['4fe0a95'] },
  notes: 'R15. Two forbidden commits were never verified absent.',
});
F['beta-tested-after-release.invalid'] = P({
  commit: Object.assign(clone(base.commit), { betaTestedSince: '2026-08-20T09:00:00Z' }),
  notes: 'R16. Beta testing recorded as starting after the release it supposedly justifies.',
});
{
  const m = clone(base); delete m.releasedAt;
  m.notes = 'R16. No releasedAt, so no ordering can be checked at all.';
  F['production-missing-released-at.invalid'] = m;
}
F['secret-value-in-secret-names.invalid'] = B({
  workers: [w('api', 'hlada-api-staging', {
    secretNames: ['AUTH_SECRET', 'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db'],
  })],
  rollback: rb(['hlada-api-staging']), ocpp: OK,
  notes: 'Schema pattern. A DSN pasted into the field that exists to hold names — caught before policy even runs.',
});
// The schema pattern catches an obvious DSN. This one is the harder case: a
// string that is a perfectly well-formed secret NAME by pattern and is still a
// value. Without it, R5's shape detection is never actually exercised.
F['aws-key-shaped-secret-name.invalid'] = B({
  workers: [w('api', 'hlada-api-staging', { secretNames: ['AUTH_SECRET', 'AKIAIOSFODNN7EXAMPLE'] })],
  rollback: rb(['hlada-api-staging']), ocpp: OK,
  notes: 'R5. Matches ^[A-Z][A-Z0-9_]*$ exactly, so the schema is happy. It is still an access key id.',
});
F['dsn-in-notes.invalid'] = B({
  workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']), ocpp: OK,
  notes: 'R10. Verified against postgresql://neondb_owner:npg_9fKq2WxLmT4vQ@ep-quiet-bird.eu-central-1.aws.neon.tech/neondb during the release. This is exactly where a secret actually gets pasted.',
});
F['token-in-approver.invalid'] = B({
  workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']), ocpp: OK,
  approval: {
    approver: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    checksPassed: [], excludedCommitsVerifiedAbsent: ['4fe0a95', '30fa407', '5311cbd'],
  },
  notes: 'R10. A token pasted where a person’s name belongs.',
});
F['unknown-worker-name.invalid'] = B({
  workers: [w('web', 'hlada-stagng')], rollback: rb(['hlada-stagng']), ocpp: OK,
  notes: 'R11. One transposed character. The manifest is internally consistent and describes nothing that exists.',
});
F['production-rebuilt-from-main.invalid'] = P({
  sourceBranch: 'main',
  notes: 'R2. Production rebuilt from the trunk instead of promoted from staging.',
});
F['zero-workers.invalid'] = B({
  workers: [], rollback: rb([]), ocpp: OK,
  notes: 'Schema minItems. A release that releases nothing.',
});
{
  // environment is KEPT, so this fixture fails on additionalProperties alone
  // rather than also on a missing required field.
  const m = B({ workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']), ocpp: OK,
    notes: 'Schema additionalProperties. A plausible typo that would otherwise silently do nothing.' });
  m.enviroment = 'beta';
  F['unexpected-property.invalid'] = m;
}
F['bad-neon-branch-pattern.invalid'] = B({
  workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']), ocpp: OK,
  data: Object.assign(clone(beta.data), { neonBranchId: 'tiny-river-abgpqq37' }),
  notes: 'Schema pattern. Missing the br- prefix, which is how a branch id is distinguished from a branch name.',
});
F['lowercase-secret-name.invalid'] = B({
  workers: [w('api', 'hlada-api-staging', { secretNames: ['auth_secret'] })],
  rollback: rb(['hlada-api-staging']), ocpp: OK,
  notes: 'Schema pattern. A lowercase secret name is usually a value or a mistake.',
});
F['bad-release-id.invalid'] = B({
  releaseId: 'august-release', workers: [w('web', 'hlada-staging')],
  rollback: rb(['hlada-staging']), ocpp: OK,
  notes: 'Schema pattern. Release ids must sort chronologically or the ledger is unreadable.',
});
F['no-neon-branch.invalid'] = B({
  workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']), ocpp: OK,
  data: (() => { const d = clone(beta.data); delete d.neonBranchId; return d; })(),
  notes: 'Schema required. Omitting the branch id is how the abandoned project default gets used.',
});
// ─────────── valid-but-warning, used to prove --strict works ───────────
// R8 and R7 are deliberately NOT fatal in the default mode: beta must not be
// blocked by them. These two fixtures are valid by default and must fail under
// --strict, which is the whole point of having a strict mode.
F['service-binding-undeclared-target.warns'] = B({
  workers: [w('web', 'hlada-staging', { serviceBindings: [{ binding: 'API', target: 'hlada-api-staging' }] })],
  rollback: rb(['hlada-staging']), ocpp: OK,
  notes: 'R8 warning: the binding target is real but is not declared in this manifest, so this release cannot say what version it will be talking to.',
});
{
  const m = B({ workers: [w('web', 'hlada-staging')], rollback: rb(['hlada-staging']),
    notes: 'R7 warning: no OCPP statement at all. Tolerated for a web-only beta release; never for production.' });
  delete m.ocpp;
  F['no-ocpp-statement.warns'] = m;
}
{
  const m = P({
    workers: [w('api', 'hlada-api-staging', { workersDevRequired: true, secretNames: ['AUTH_SECRET'] })],
    rollback: rb(['hlada-api-staging']), ocpp: OK,
    notes: 'R9 warning: a production release with no backup branch. Point-in-time restore is capped at seven days, so beyond that window this release has no recovery at all.',
  });
  delete m.data.backupBranchId;
  F['production-no-backup-branch.warns'] = m;
}

for (const [name, doc] of Object.entries(F)) write(`${name}.json`, doc);
const total = readdirSync(DIR).filter((f) => f.endsWith('.json')).length;
console.log(`wrote ${Object.keys(F).length} generated fixtures; ${total} total in release-fixtures/`);
