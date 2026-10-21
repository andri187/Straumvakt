# Appendix F — Offline validator and linter specification
> **Superseded in part by [the overnight verification-prep packet](2026-08-09-overnight-verification-prep-packet.md).** That run corrected several findings recorded here: the estate is **29 registered worktrees, not 6**; three worktrees are checked out **at** forbidden commits; the wrangler linter emits **5 L2 / 6 L3**, not 4 / 3; the linter's inheritance model was wrong and is fixed; and the money-unit finding's **mechanism** was wrong — there is no cancelling pair inside the API. See "Corrections" there.


**Implemented and passing, not proposed.** Everything below exists as code in
`scripts/analysis/`, self-tests, and was run in this session.

```
$ node scripts/analysis/manifest/self-test-all.mjs
ok    environment manifests   8 fixtures
ok    release manifests      37 fixtures
ok    wrangler configs        5 fixtures

ALL GREEN — 50/50 fixtures across 3 checkers
```

**17 release-manifest policy rules · 3 wrangler linter rules · 50 fixtures.**
The requirement was 12 rules and 30 fixtures.

---

## Safety properties, and how each is verified

| Property | How it is guaranteed | How to re-verify |
|---|---|---|
| Cannot reach a network | `validate-release-manifest.mjs`, `validate-manifest.mjs`, and `lint-wrangler.mjs` import only `node:fs`, `node:path`, `node:url` | `grep -n '^import' scripts/analysis/**/*.mjs` |
| Cannot mutate anything | The three checkers open files read-only and write only to stdout | Same grep — no `writeFileSync`, no `child_process` |
| Runs with zero install | The JSON Schema subset is hand-rolled | `node <script> --self-test` on a clean checkout |
| A manifest is inert | Stated in the schema `description`, the validator header, and checklist CL-51 | Nothing in the repository reads a manifest except the validator |

**Two deliberate exceptions, stated rather than hidden.**
`build-fixtures.mjs` writes — it generates fixtures, and it writes only into
`release-fixtures/`. `self-test-all.mjs` uses `child_process` — it spawns the
three checkers so each stays independently runnable and a crash in one does not
take the others down. Neither is on the validation path.

---

## Release-manifest policy rules (17)

Each rule has at least one fixture that fails **for that rule's reason**. That
requirement is not cosmetic: a negative fixture that fails for two reasons proves
nothing about either, and this appendix caught two such fixtures during the run.

| Rule | What it enforces | Why it exists | Fixture |
|---|---|---|---|
| **R1** | Every Worker has a recorded prior version | A release with no rollback target is a one-way door. No version id has ever been recorded on this estate. | `no-rollback-target.invalid` |
| **R2** | Production records `betaTestedSince` and is promoted from `staging` | Production must be the thing that ran in beta, not a rebuild of the same source | `production-without-beta-proof.invalid`, `production-rebuilt-from-main.invalid` |
| **R3** | A gateway release must state `ocpp.endpointUnchanged: true` | **Promoted from warning to error this session.** The highest-consequence omission in the manifest was the one that merely printed a line. The clients are physical equipment. | `gateway-missing-ocpp-statement.invalid` |
| **R4** | A pinned workers.dev host requires `workers_dev` in config | Adding `routes` infers `workers_dev=false`. The shipped mobile app pins the API host; the gateway's clients are chargers. | `pinned-host-undeclared.invalid`, `gateway-pinned-host-undeclared.invalid` |
| **R5** | `secretNames` holds names, never values | Names are all a manifest ever needs | `aws-key-shaped-secret-name.invalid` |
| **R6** | Production must not use a beta Neon branch | Generalised from a hard-coded id to a list in `known-workers.json` | `production-beta-neon-branch.invalid` |
| **R7** | *(warn)* Non-gateway releases should still state OCPP impact | Tolerated for beta; fatal under `--strict` | `no-ocpp-statement.warns` |
| **R8** | *(warn)* Service-binding targets should be declared Workers | A release cannot say what version it will be talking to otherwise | `service-binding-undeclared-target.warns` |
| **R9** | *(warn)* Production should record a `backupBranchId` | PITR is capped at seven days; beyond that only deliberate branches exist | `production-no-backup-branch.warns` |
| **R10** | No value-shaped string **anywhere** in the document | R5 guards the field a secret is *least* likely to be pasted into. `notes` is where it would actually happen. | `dsn-in-notes.invalid`, `token-in-approver.invalid` |
| **R11** | Worker names must be known, or carry a justification | A typo validates perfectly and describes nothing that exists | `unknown-worker-name.invalid` |
| **R12** | Production requires `cpmsSeparationVerified` | CPMS declares the same Worker names; a release while another project can redeploy them is not controlled | `production-missing-cpms-verification.invalid` |
| **R13** | Gateway alongside web/api requires explicit acknowledgement | One rollback decision would cover three blast radii | `mixed-release-unacknowledged.invalid` |
| **R14** | Production requires a **measured** `restoreTimeMeasuredSec` | A rollback plan with an unmeasured duration is an estimate wearing a plan's clothes | `production-missing-restore-time.invalid` |
| **R15** | Forbidden commits must be listed as verified absent | The standing rules forbid `4fe0a95`; the field existed and nothing required its use | `production-missing-excluded-commits.invalid` |
| **R16** | `betaTestedSince` must precede `releasedAt`; production requires `releasedAt` | The field could previously hold any string, including a future instant | `beta-tested-after-release.invalid`, `production-missing-released-at.invalid` |
| **R17** | `verifiedFastForward` must be true | **Restored this session.** Renumbering the rules dropped this check entirely; the self-test caught it because `not-fast-forward.invalid` started passing. | `not-fast-forward.invalid` |

### Why R13 is an acknowledgement rather than a prohibition

The obvious design was to forbid a gateway Worker from appearing alongside web
and api. That would have invalidated both hand-written valid fixtures, which
describe a legitimate whole-estate promotion. Forbidding a real workflow to
express a safety concern gets the rule removed. Requiring
`ocpp.mixedReleaseAcknowledged` keeps the workflow and forces the person writing
the manifest to state, in the manifest, that they understand what they are
coupling.

### Why R10's detection is narrow

The tempting implementation is "reject anything long and random-looking". That
fires on git shas, Cloudflare resource ids, and ordinary prose — and **a rule that
fires on prose gets disabled, and a disabled rule protects nothing.** So R10
matches five named credential shapes (Postgres DSN, Neon `npg_`, bearer token,
AWS key id, GitHub token) plus one high-entropy heuristic that explicitly
excludes pure hex, since a 40-character hex string is a git sha and a
32-character one is a Cloudflare id.

The fixture `prose-placeholder-dsn.valid` exists to hold that line: it contains
`user:pw@host` and **must pass**.

---

## `--strict` mode

Three rules are warnings by design so that beta is not blocked. Production
should not be able to proceed on a warning.

```
$ node validate-release-manifest.mjs --strict release-fixtures/no-ocpp-statement.warns.json
INVALID no-ocpp-statement.warns.json
  ERROR R7 STRICT: ocpp.endpointUnchanged is not true — confirm no field device is affected
exit=1
```

The `.warns` fixture class exists specifically to prove strict mode does
something. A valid/invalid split alone cannot show that: a warning that no
fixture produces is a warning nobody has ever seen.

---

## `--json` output

```json
{ "strict": false,
  "results": [ { "file": "…", "valid": true, "errors": [], "warnings": [] } ] }
```

Checklists attach this as release evidence. A screenshot of a terminal is not
evidence.

---

## Wrangler linter rules (3)

`scripts/analysis/lint/lint-wrangler.mjs` — 5 fixtures, all passing.

| Rule | Severity | What it catches |
|---|---|---|
| **L1** | error | An environment declaring `routes` with no explicit `workers_dev`. This is the foot-gun exactly. |
| **L2** | warn | An environment declaring **neither** — the live hostname state is inferred rather than declared, so the *next* routing change is the one that breaks it. |
| **L3** | info | A service binding that targets another Worker **by name**, which a rename silently breaks. |

### What it reports against the real configs today

```
wrangler.jsonc              WARN L2 [top-level hlada]
                            INFO L3 [env.staging] OCPP_GATEWAY -> straumvakt-ocpp-staging
apps/api/wrangler.jsonc     WARN L2 [top-level hlada-api]
                            WARN L2 [env.staging hlada-api-staging]        ← the mobile app pins this
                            INFO L3 [env.staging] OCPP_GATEWAY -> straumvakt-ocpp-staging
gateway/wrangler.jsonc      WARN L2 [top-level straumvakt-ocpp]
                            WARN L2 [env.staging straumvakt-ocpp-staging]  ← the charger fleet
                            INFO L3 [env.staging] MAIN_APP -> hlada-api-staging
```

Zero L1 errors — nothing is broken today. **Five L2 warnings** — the API and
gateway are both latent in exactly the way described, at both the top level and
in `env.staging`. The web config's `env.staging` is clean because it declares
`workers_dev: true` at `wrangler.jsonc:67` alongside its routes.

### The fixture that encodes a trap worth knowing

`toplevel-only-covers-toplevel.error.jsonc` declares `workers_dev: true` at the
top level and adds `routes` in `env.staging`. It **fails**, because Wrangler
resolves each environment independently: a top-level `workers_dev` does not cover
a named environment. Anyone fixing this by adding the key in one place would
believe they were done.

---

## Specified but not implemented

Stated plainly so it is not mistaken for coverage.

**`lint-secrets.mjs`** — a repository-wide secret scanner using the same shape
detection as R10, with the known committed `AUTH_SECRET` as its self-test. Not
implemented here because the scan target is the whole repository including
history, which is a decision (AD-13) rather than a script. The R10 rule already
covers manifests, which is where this programme's own artifacts could leak.
Issue body ISS-16 specifies it completely.

**`cleanup-dryrun.ps1` exit code (ISS-35)** — the script currently prints
`*** MISSING ***` inside a long report. It should exit non-zero. Not changed in
this session because the script's safety property is that it is audited before
every run, and changing it invalidates the last audit; the change belongs in a
session where it can be re-audited and re-run.

---

## Running everything

```bash
node scripts/analysis/manifest/self-test-all.mjs            # all three checkers
node scripts/analysis/manifest/build-fixtures.mjs           # regenerate fixtures
node scripts/analysis/manifest/validate-release-manifest.mjs --strict --json <file>
node scripts/analysis/lint/lint-wrangler.mjs                # against the real configs
pwsh -File scripts/analysis/cleanup/cleanup-dryrun.ps1 -OutFile <path outside E:\Claude>
```

Before every `cleanup-dryrun.ps1` run, re-audit it:

```bash
grep -nE 'Remove-Item|rmdir|\bdel\b|\brd\b|Clear-|Move-Item|worktree remove|branch -d' \
  scripts/analysis/cleanup/cleanup-dryrun.ps1
```

Every match must be inside a comment or a string that instructs the operator.
**Safety by construction only holds if the construction is re-checked.**
