# `.tmp` evidence promotion and ignore rule

Date: 2026-11-01 (UTC), run between roughly 23:40Z and 2026-11-02 00:00Z — it straddles
midnight, so the folder date is the date the work was performed. Agent: Opus (Claude
Desktop), acting on Andri's explicit instruction in session. Repository: `E:\Claude\Straumvakt`, remote
`andri187/Straumvakt`. Branch `codex/core-checkpoint-2026-10-31`, HEAD
`51a6ea76d0eab0c26c89d225d15aa21626892a79` unchanged — **nothing committed, nothing
pushed**. No database, Neon, Cloudflare, secret, deploy or charger action.

Legend: **VERIFIED** = run/read this session. **INFERRED** = reasoned. **UNKNOWN** =
needs a named external check.

## Objective

`.tmp/` held artifacts that records under `docs/agent-runs/` and `docs/agent-prompts/`
cite as live proof, review artifacts and runtime verification. It was untracked **and**
absent from `.gitignore`, so that evidence existed in exactly one place with no backup,
while 4.2 GB of regenerable build output sat in the same tree and one careless
`git add -A` would have committed all of it.

This run copies the cited, non-regenerable artifacts into the matching
`docs/agent-runs/<date>/` folder and adds an ignore rule for the rest.

## Implementation

Cited paths were collected by scanning `docs/`, root `*.md` and `.claude/` for
`.tmp/...` references: **56 unique paths**, of which 28 are small non-regenerable
artifacts, 23 are build output or whole dry-run directories, 2 were regex artifacts
rather than real citations, and 3 were already gone. Each promoted file was placed in
the date folder of the earliest record citing it, following the existing
`docs/agent-runs/<date>/<date>-<name>.<ext>` convention, with the original subpath
flattened into the filename so round2/round3 pairs stay distinguishable.

Copied with `cp -p` (timestamps preserved). **VERIFIED**: all 28 confirmed
byte-identical to source with `cmp`; no destination collided with an existing file and
no two sources mapped to one destination.

## Promoted artifacts (28 files, 706 KB)

| Original | Promoted to |
| --- | --- |
| `.tmp/installation-save-live-proof.png` | `docs/agent-runs/2026-10-30/2026-10-30-installation-save-live-proof.png` |
| `.tmp/grouped-chargers-live-release.png` | `docs/agent-runs/2026-10-30/2026-10-30-grouped-chargers-live-release.png` |
| `.tmp/incoming-real-chargers-proof.png` | `docs/agent-runs/2026-10-30/2026-10-30-incoming-real-chargers-proof.png` |
| `.tmp/incoming-table-live.png` | `docs/agent-runs/2026-10-30/2026-10-30-incoming-table-live.png` |
| `.tmp/installations-fully-collapsed-live.png` | `docs/agent-runs/2026-10-30/2026-10-30-installations-fully-collapsed-live.png` |
| `.tmp/installations-tree-live.png` | `docs/agent-runs/2026-10-30/2026-10-30-installations-tree-live.png` |
| `.tmp/legacy-charger-views/current-installations-refined.png` | `docs/agent-runs/2026-10-30/2026-10-30-legacy-charger-views-current-installations-refined.png` |
| `.tmp/legacy-charger-views/grouped-proof.png` | `docs/agent-runs/2026-10-30/2026-10-30-legacy-charger-views-grouped-proof.png` |
| `.tmp/legacy-charger-views/installation-tree-proof.png` | `docs/agent-runs/2026-10-30/2026-10-30-legacy-charger-views-installation-tree-proof.png` |
| `.tmp/legacy-charger-views/current-installations-preview.html` | `docs/agent-runs/2026-10-30/2026-10-30-legacy-charger-views-current-installations-preview.html` |
| `.tmp/first-charger-migration-plan.mjs` | `docs/agent-runs/2026-10-30/2026-10-30-first-charger-migration-plan.mjs` |
| `.tmp/installation-visual-preview.mjs` | `docs/agent-runs/2026-10-30/2026-10-30-installation-visual-preview.mjs` |
| `.tmp/pending-review-round2/gate.test.ts` | `docs/agent-runs/2026-10-31/2026-10-31-pending-review-round2-gate.test.ts` |
| `.tmp/pending-review-round2/ownership.test.ts` | `docs/agent-runs/2026-10-31/2026-10-31-pending-review-round2-ownership.test.ts` |
| `.tmp/pending-review-round3/ownership.test.ts` | `docs/agent-runs/2026-10-31/2026-10-31-pending-review-round3-ownership.test.ts` |
| `.tmp/codex-recovery-tests/review-probes.mts` | `docs/agent-runs/2026-10-31/2026-10-31-codex-recovery-tests-review-probes.mts` |
| `.tmp/codex-recovery-tests/activation-runtime-run.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-codex-recovery-tests-activation-runtime-run.mjs` |
| `.tmp/codex-recovery-tests/activation-runtime-wrapper.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-codex-recovery-tests-activation-runtime-wrapper.mjs` |
| `.tmp/codex-recovery-tests/build-activation-hotfix.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-codex-recovery-tests-build-activation-hotfix.mjs` |
| `.tmp/codex-recovery-tests/activation-hotfix-source.txt` | `docs/agent-runs/2026-10-31/2026-10-31-codex-recovery-tests-activation-hotfix-source.txt` |
| `.tmp/codex-recovery-tests/wrangler.log` | `docs/agent-runs/2026-10-31/2026-10-31-codex-recovery-tests-wrangler.log.txt` |
| `.tmp/codex-stop-runtime/run.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-codex-stop-runtime-run.mjs` |
| `.tmp/codex-live-runtime/worker.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-codex-live-runtime-worker.mjs` |
| `.tmp/bulk-assignment-review.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-bulk-assignment-review.mjs` |
| `.tmp/vendor-review-race.mjs` | `docs/agent-runs/2026-10-31/2026-10-31-vendor-review-race.mjs` |
| `.tmp/pending-review/vitest.config.ts` | `docs/agent-runs/2026-10-26/2026-10-26-pending-review-vitest.config.ts` |
| `.tmp/perf/baseline.json` | `docs/agent-runs/2026-11-01/2026-11-01-perf-baseline.json` |
| `.tmp/perf/after.json` | `docs/agent-runs/2026-11-01/2026-11-01-perf-after.json` |

Originals were **copied, not moved**, so existing records' `.tmp/...` references still
resolve for as long as the scratch tree survives. Resolve any such reference against
this table once it does not.

One filename differs from its source: the promoted wrangler log carries a `.log.txt`
suffix because the pre-existing `*.log` rule at `.gitignore:62` silently swallowed it,
which would have left that one artifact as unbacked as before. **VERIFIED** byte-identical
to `.tmp/codex-recovery-tests/wrangler.log` after the rename, and **VERIFIED** to contain
no token, secret, password, key, bearer, connection-string, account-id or 32-hex match
before being placed under a tracked path. The global `*.log` rule was left intact.

## Deliberately not promoted

Build output, regenerable from source at the SHA its citing record names. Tracking it
would add tens of megabytes of bundles to the repository for no evidentiary gain.

| Path | Size | Reason |
| --- | --- | --- |
| `.tmp/samsung-source-preview` | 102 MB | throwaway preview project; `lib/` is `apps/mobile/lib` plus a 13-line `visual_preview.dart` and a 22-line `home.dart` diff |
| `.tmp/codex-recovery-tests` (whole dir) | 90 MB | `bundle/` 21 MB and `cursor-bundle/` 21 MB are built bundles; the small probes inside it are promoted above |
| `.tmp/codex-recovery-tests/bundle/cpo-shell.js` | 8.2 MB | built bundle |
| `.tmp/perf` (whole dir) | 21 MB | only the two JSON measurements are evidence; both promoted above |
| `.tmp/web-band-aid-release` | 21 MB | release bundle |
| `.tmp/cpo-shell-dry-run` | 20 MB | dry-run output |
| `.tmp/pending-release/shell` | 20 MB | release bundle |
| `.tmp/pending-release/gateway/index.js` | 624 KB | built worker bundle |
| `.tmp/registered-boot-release/index.mjs` | 628 KB | built worker bundle |
| `.tmp/gateway-first-charger-dry-run` | 1.7 MB | dry-run output |
| `.tmp/tree-preview` | 1.2 MB | preview output |
| `.tmp/codex-stop-runtime` (whole dir) | 548 KB | runtime scratch; `run.mjs` promoted above |
| `.tmp/codex-lifecycle-tests` | 4 KB | directory, no cited file inside it |
| `.tmp/codex-gateway-tests` | 0 | empty |

## Cited but already gone — evidence-chain gaps

**VERIFIED** absent at 2026-11-01:

- `.tmp/vendor-cooldown.json`
- `.tmp/zaptec-cooldown.json`
- `.tmp/zaptec-connection-check`

**INFERRED** that these predate this session: none sits under any path deleted during
the 2026-10-31 build-output cleanup, whose six targets were `.next`, `.open-next`,
`.tmp/mobile-visual-preview/build`, `.tmp/samsung-source-preview/assets`,
`.tmp/samsung-source-preview/build` and `apps/mobile/build`. **UNKNOWN** when and how
they were lost. They are cited by records that can no longer be checked against them.

Two further scanner hits, `.tmp/.../upgrade.test.ts` and
`.tmp/codex-recovery-tests/handoff-runtime-`, are an ellipsis in prose and a truncated
prefix respectively, not real citations.

## Ignore rule

`.gitignore:122` now carries `/.tmp/` with a comment stating that evidence must be
promoted into `docs/agent-runs/<date>/` because anything left in the scratch tree is
untracked and unbacked. **VERIFIED** with `git check-ignore -v .tmp`.

The rule was appended; pre-existing uncommitted changes elsewhere in `.gitignore` were
not touched. `.tmp/` had 0 tracked files, so the rule changes no tracked path.

## Changed files

- `.gitignore` — appended a 5-line comment block and `/.tmp/` (file already had
  uncommitted changes from other work before this run).
- `docs/agent-runs/{2026-10-26,2026-10-30,2026-10-31,2026-11-01}/` — 28 new untracked
  files, listed above.
- `docs/agent-runs/2026-11-01/2026-11-01-tmp-evidence-promotion.md` — this record.

## Tests

None run, and none applicable: this run copies files and adds an ignore rule. It touches
no product code, schema, route or configuration that a test covers. The promoted
`*.test.ts` files are retained artifacts of earlier runs, not part of any suite — they
sit under `docs/` and are not collected by the test configuration. **UNKNOWN** whether
they still pass against current source; their citing records state the result at their
own dates.

## Risks and unresolved issues

- **`archive/local-documents-2026-10-30/preservation-backups` (791 MB) still has no
  off-device copy** and contains private configuration and signing material. Its source
  folder `C:\Users\Andri\Documents\Straumvakt-preservation-backups` is **VERIFIED**
  absent, so this checkout is the only copy. This is the most significant retention risk
  in the repository and is an operator action.
- The 28 promoted files are untracked. Until they are committed they have no more
  durability than the originals did.
- **`gateway/.tmp/` (6.2 MB) is a second scratch tree that the new rule does not cover.**
  The rule is deliberately root-anchored (`/.tmp/`), matching the scope Andri approved.
  **VERIFIED** 0 tracked files and no citation from any record, so nothing is at risk
  there now, but it stays visible in `git status` and will drift the same way. Changing
  `/.tmp/` to `.tmp/` would cover both; that is a scope decision, not done here.
- Promoting evidence into `docs/` grows the tracked tree. 706 KB is immaterial against
  the 125 MB `docs/` already carries, but the convention should stay restricted to small
  non-regenerable artifacts.

## Recommended next step

Commit the 28 promoted files plus the `.gitignore` rule as one focused commit, separate
from the unrelated uncommitted work already present on this branch. Then decide the
off-device destination for `preservation-backups`.
