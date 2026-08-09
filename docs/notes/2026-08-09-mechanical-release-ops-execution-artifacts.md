# Mechanical release-ops execution artifacts
> **Superseded in part by [the overnight verification-prep packet](2026-08-09-overnight-verification-prep-packet.md).** That run corrected several findings recorded here: the estate is **29 registered worktrees, not 6**; three worktrees are checked out **at** forbidden commits; the wrangler linter emits **5 L2 / 6 L3**, not 4 / 3; the linter's inheritance model was wrong and is fixed; and the money-unit finding's **mechanism** was wrong — there is no cancelling pair inside the API. See "Corrections" there.


**Run.** `next-mechanical-claude-b-release-ops-execution-artifacts-2026-08-09.md`
**Worktree.** `E:\Claude\Straumvakt-beta-production` · branch `docs/beta-production-release-architecture`
**Start tip.** `31ce40bab99ae539f5e49d81729ec29e55d355d0`

This packet converts the prior release-ops findings into execution machinery: an
index that maps every finding to a command, 270 work items, 80 issue bodies, 60
checklists, 42 evidence templates, 17 validator rules with 50 passing fixtures,
20 preservation records, 16 decision records, 10 drills, 8 rehearsals, and 8
no-go scenarios.

## Navigation

| Appendix | Contents |
|---|---|
| [D — Evidence-capture templates](2026-08-09-appendix-d-dashboard-evidence-templates.md) | 42 templates for a read-only session |
| [E — Operator checklists](2026-08-09-appendix-e-release-checklists.md) | 60 pre-planned execution checklists |
| [F — Offline validator spec](2026-08-09-appendix-f-offline-validator-spec.md) | 17 rules, 3 linter rules, 50 fixtures |
| [G — Cleanup preservation manifest](2026-08-09-appendix-g-cleanup-preservation-manifest.md) | 20 preservation records |
| [H — Approval decision records](2026-08-09-appendix-h-approval-decision-records.md) | 16 decisions, each with a recommendation |
| [I — Execution work items](2026-08-09-appendix-i-execution-work-items.md) | 270 items in 19 groups |
| [J — Issue-ready bodies](2026-08-09-appendix-j-issue-bodies.md) | 80 copy-pasteable issues |
| [K — Drills, rehearsals, no-gos](2026-08-09-appendix-k-drills-rehearsals-nogo.md) | 10 + 8 + 8 |

Prior packet: [ultra release-ops](2026-08-09-ultra-release-ops-cloudflare-gap-cleanup.md) ·
[A — blocked facts](2026-08-09-appendix-a-blocked-facts-operator-kit.md) ·
[B — 36 runbooks](2026-08-09-appendix-b-operator-runbooks.md) ·
[C — work packages](2026-08-09-appendix-c-work-packages.md)

---

## Phase 0 — Containment

| Check | Result |
|---|---|
| Tip at open | `31ce40b` — **matches** the prompt's stated start tip |
| Dirty state | 0 |
| Commits since `31ce40b` | 0 — nothing moved under me |
| Prior artifacts | All present: 4 packet documents, 2 validators, 2 schemas, 1 dry-run script |
| Preservation targets | `docs/OCPP` **128 files**, `Straumvakt-parked` **38 files** — both intact |
| Deletions anywhere | **None.** Nothing under `E:\Claude` deleted, moved, or modified |

**Peer movement, and it is active.** Three agents are committing concurrently.
Codex moved twice *during this run*:

| Worktree | At my Phase 0 | Later in the same run | Owner |
|---|---|---|---|
| `Straumvakt-onboarding-web` | `7a25fa5` | **`e27ada3`** | Codex |
| `Straumvakt-driver-access-ui` | `ad5d8c7` | **`77b7e75`** | Codex |
| `Straumvakt-onboarding-domain` | `4dea004` | **`fc071b3`** | Claude A |

None of it affects release/ops facts. All three worktrees were left untouched.
That movement is itself the evidence behind ISS-79 — a release freeze rule is not
theoretical when the tree moves twice inside one session.

---

## Corrections recorded this run

Three things I had previously stated, or the code had, that turned out to be
wrong. Each is corrected in place in the relevant appendix; they are collected
here so a reader does not have to find them.

### C-1 — The prompt folder is worse than "unbacked"

The earlier finding recorded `C:\Users\Andri\Documents\New project` as having no
backup. It actually has a `.git` directory with **zero commits and zero tracked
files** — 160 untracked entries at the top level, 22,759 files in total, mostly
tool caches (`.jadx-1.5.5`, `.zaptec-apk`, `.zaptec-jadx`, `cache/`).

That is worse than no version control, because the presence of `.git` invites the
assumption that it is safe. This folder holds the 33 markdown documents driving all three
agents and the coordinator ledger. → Appendix G P-04, ISS-33, CL-48.

### C-2 — Renumbering the validator rules silently dropped one

Restructuring the policy rules to add R10–R16 renumbered the old R3
(`verifiedFastForward` must be true) onto the new OCPP rule and **deleted the
fast-forward check entirely**. The self-test caught it: `not-fast-forward.invalid`
started passing. Restored as R17. → Appendix F.

A refactor that makes a negative test pass is the failure mode negative tests
exist for, and it is only visible if the fixture set is run every time.

### C-3 — Two fixtures were failing for the wrong rule

`not-fast-forward.invalid` was being rejected by R13, and
`service-binding-to-undeclared-target.invalid` by R15 — neither for the rule it
was written to exercise. A negative fixture that fails for two reasons proves
nothing about either. Both were fixed so that every rule now has a fixture that
fails for **its own** reason, verified by extracting the rule id from each
rejection. → Appendix F.

---

## New facts established this run

All read-only. No external state was touched.

### F-A — `origin/staging` is fully contained in the release candidate

```
git rev-list --left-right --count origin/staging...4b69d0f
→ 0    166
```

Zero on the left: **staging carries nothing the release candidate does not**.
The candidate is 166 commits ahead. A promotion would be a clean fast-forward,
and `commit.verifiedFastForward` can be set from measurement rather than from
hope. → CL-51, rule R17.

### F-B — All three forbidden commits are absent from the release candidate

```
git merge-base --is-ancestor <sha> 4b69d0f
  4fe0a95 → ABSENT      30fa407 → ABSENT      5311cbd → ABSENT
```

This was previously asserted; it is now recorded as evidence with the command
that produced it. Validator rule R15 requires all three in
`approval.excludedCommitsVerifiedAbsent`. → ISS-68.

### F-C — Two branches track a remote branch with an entirely different name

The full upstream audit across all seven worktrees found more than the two known
cases:

| Local branch | Upstream | Assessment |
|---|---|---|
| `dev/rename-prod-worker` | `origin/staging` | **Known.** Carries the forbidden `4fe0a95` |
| `dev/secret-hygiene-v2` | `origin/staging` | **Known** |
| `staging` | `origin/staging` | Expected — but a checkout plus push here needs no mistake at all |
| `docs/ci-and-custom-domain` | `origin/dev/drizzle-ownership-and-market-harvest` | **New.** Name mismatch |
| `fix/prisma-migrations-path` | `origin/dev/drizzle-ownership-and-market-harvest` | **New.** Name mismatch |

The last two are a different hazard from the first two: a push from either lands
on a branch whose name bears no relation to the local one, so the mistake is
invisible in the command and invisible in the branch name. Two different local
branches share one upstream, which means each would also overwrite the other.
Neither is on the deploy pointer, so this is lower severity — but it is the same
class of misconfiguration and the audit that found the first two had stopped
early. → ISS-10, D-34.

### F-D — The wrangler linter's first run against the real configs

Zero L1 errors — nothing is broken today. **Four L2 warnings**, exactly where
predicted: `apps/api` and `gateway` each declare neither `routes` nor
`workers_dev`, at both the top level and in `env.staging`. The web config's
`env.staging` is clean because it declares `workers_dev: true` at
`wrangler.jsonc:67` alongside its routes.

Six L3 informational findings confirm the service-binding-by-name coupling,
including `gateway → MAIN_APP → hlada-api-staging`, which a rename breaks.
→ Appendix F.

---

## Phase 1 — Execution index

Every prior finding, mapped to the command or checklist that acts on it. Owner
lanes: **B** release ops, **A** Claude A, **X** Codex, **H** Andri.

| ID | Finding | Evidence | Risk | Owner | Approval | Act via | Check | Rollback | Depends | Target state | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **F-01** | Cloudflare access absent | `wrangler whoami` unauthenticated; no `CLOUDFLARE_*` | Blocks 7 facts | H | AD-01 | CL-01 | token verify → `active` | revoke | — | Scoped read-only token, 7-day TTL | **Blocked** |
| **F-02** | 7 control-plane facts blocked | Appendix A | No rollback target, no cutover | B | AD-02 | CL-01…CL-13 | evidence bundle hashed | n/a | F-01 | All 7 captured | **Blocked** |
| **F-03** | Route omission behaviour | Cloudflare docs | Misprediction of routing | B | — | D-24 | route list captured | n/a | — | Understood | **Closed** |
| **F-04** | Wildcard covers one subdomain level | Cloudflare docs | Wrong coverage assumption | B | — | D-24 | pattern review | n/a | — | Understood | **Closed** |
| **F-05** | Adding `routes` infers `workers_dev=false` | Cloudflare docs + D-29 | **Fleet/app outage** | B | — | ISS-01, ISS-02, ISS-03 | `lint-wrangler.mjs` L1 | revert config | — | Declared in all 3 configs | **Open — 5 L2 warnings** |
| **F-06** | Mobile pins the API workers.dev host | `apps/mobile/lib/api/client.dart` | Total mobile outage | B+X | AD-08 | ISS-01, CL-14 | CL-56 smoke check | re-enable toggle | F-05 | Declared + addressing decided | **Open** |
| **F-07** | Gateway carries the same condition | `gateway/wrangler.jsonc` | **Charger fleet offline** | B | AD-08 | ISS-02, CL-17 | `lint-wrangler.mjs` | re-enable toggle | F-05 | Declared | **Open** |
| **F-08** | web→API is the only plain-HTTPS path | 4-path map, D-23 | Total web outage if it becomes a route | B+A | AD-09 | ISS-23, CL-18…CL-20 | CL-19 local proof | **flag flip, no deploy** | ISS-24 | Service binding, soaked | **Open** |
| **F-09** | Service binding is the durable fix | Cloudflare docs | — | B+A | AD-09 | ISS-23 | CL-19 | flag flip | F-08 | Adopted beta-first | **Proposed** |
| **F-10** | CPMS declares the same Worker names | CPMS `wrangler.jsonc:3,32`; Apr 19 → Apr 24 | Foreign redeploy | H | AD-03 | ISS-07, ISS-41, ISS-77 | rule R12 | roll back version | F-02 | One owner per name | **Blocked → NG-04** |
| **F-11** | GitHub branch protection absent | 0/16 protected; rulesets `[]` | Force-push / delete of deploy pointer | H | AD-04 | ISS-11, ISS-12, CL-27 | server-side push refusal | disable ruleset | — | Protected + linear | **Open → NG-03** |
| **F-12** | Branches track `origin/staging` | upstream audit | Forbidden commit published | H | AD-04 | ISS-08, ISS-09, CL-25 | upstream lookup fails | `git branch -u` | — | No upstream | **Open** |
| **F-13** | Two branches track a mismatched remote | **new this run** (F-C) | Push lands on an unrelated branch | H | AD-04 | ISS-10 | upstream audit | `git branch -u` | — | Corrected or unset | **Open — new** |
| **F-14** | Neon: one project, no production | metadata read | No production data home | H | AD-05 | CL-31 | branch id in manifest | delete while empty | — | Protected production target | **Open → NG-02** |
| **F-15** | Neon default branch abandoned | prior finding | Wrong-branch reads | H | AD-06 | CL-32, ISS-18 | default-omitting read | repoint back | — | Repointed | **Open** |
| **F-16** | Neon 7-day PITR ceiling | project settings | Day-8 problem unrecoverable | H | AD-05 | ISS-28, CL-35 | rule R9 | n/a | — | Backup-branch convention | **Open** |
| **F-17** | `E:\Claude` preservation hazards | 128 + 38 untracked files | Irreversible loss | H | AD-11, AD-14 | ISS-32, CL-45 | dry-run all PRESENT | archive restore | — | Copied + hashed + archived | **Open** |
| **F-18** | Prompt/evidence folder has 0 commits | **corrected** (C-1) | Total loss of programme record | H | — | ISS-33, CL-48 | `git log` ≥ 1 commit | none today | — | Committed | **Open — no recovery path** |
| **F-19** | No Worker version IDs recorded | rule R1 rejects every manifest | **One-way door** | B | — | ISS-06, ISS-47 | rule R1 | n/a | F-01 | Captured minutes before cutover | **Blocked → NG-01** |
| **F-20** | No rollback target, ever | no rollback performed on this estate | Outage cannot be undone | H | AD-16 | ISS-49, RD-01 | measured restore time | roll forward | F-19 | Drilled and measured | **Blocked** |
| **F-21** | Money unit contradiction | `compute-session-cost.ts:13-21` vs session repo | **100× billing error** | A | AD-15 | ISS-29, BR-06 | independent hand calc | revert one commit | — | One unit, one test | **Open → NG-07** |
| **F-22** | `powerKw: 0` hardcoded | `driver-sessions.ts:135` | Product states a falsehood | A+X | — | ISS-31 | contract test | revert | — | Real or absent | **Open → NG-08** |
| **F-23** | Driver invite loop broken | runtime-confirmed | Beta flow unusable | A | — | ISS-71, BR-04 | rehearsal reproduces | n/a | — | Fixed, rehearsal passes | **Open, unfixed by choice** |
| **F-24** | `AUTH_SECRET` committed publicly | `.env.example` in history | Credential exposure | A+H | AD-13 | ISS-15, ISS-16 | secret scan | **rotation only** | — | Scrubbed + rotated | **Open** |
| **F-25** | staging ⊆ release candidate | **new this run** (F-A): `0 166` | — | B | — | CL-51 | `rev-list --left-right` | n/a | — | Fast-forward provable | **Closed** |
| **F-26** | Forbidden commits absent from RC | **new this run** (F-B) | — | B | — | ISS-68 | `merge-base --is-ancestor` | n/a | — | Verified | **Closed** |

**Status roll-up:** 4 closed · 3 blocked on Cloudflare access · 1 proposed ·
18 open, of which 6 are production no-gos.

---

## Phase 12 — Reconciliation with Claude A and Codex

Read-only inspection of their branch tips and document names. **No peer worktree
was edited.**

| Gate | Owner | Current evidence | Next action | Risk if ignored |
|---|---|---|---|---|
| **Backend / domain** | Claude A — `docs/singular-onboarding-domain-packet` @ `fc071b3`, 204 work packages, decision register, contradiction audit | Domain packet complete; issue bodies and Given/When/Then scenarios delivered | Land the money-unit fix (ISS-29) and the driver-invite fix (ISS-71); both gate beta rehearsals | BR-04, BR-05, BR-06 cannot pass; NG-07 stays live |
| **UI / product** | Codex — `codex/onboarding-web-experience` @ `e27ada3`, `codex/unaffiliated-driver-experience` @ `77b7e75`; both moved during this run | "Harden operational product states", "truthful staff and CPO product surfaces" — the *truthful states* work aligns exactly with what NG-08 requires | Confirm no surface renders `powerKw: 0` as a measurement; keep pricing in the disabled state until AD-15 | The product states a falsehood about physical equipment |
| **Release / ops** | This track — `docs/beta-production-release-architecture` | 17 validator rules, 50 fixtures green, 60 checklists, 6 no-gos | Andri answers AD-01, AD-02, AD-04, AD-16 — four decisions needing no evidence | Everything downstream stays blocked on access |
| **Cross-cutting: freeze** | Unowned | Two peer worktrees advanced **inside this session** | ISS-79 — a named freeze with a signal A and X can see without asking | Release candidates are stale before they are approved |

### Contract notes for the other lanes

*No edits to their worktrees; these are the release/ops constraints their work
touches.*

**Codex must know.** The mobile app pins `hlada-api-staging.straumvakt.workers.dev`
at `apps/mobile/lib/api/client.dart`; any Worker rename or routing change is a
client-breaking change, and there is no client-side fix (RD-03). Pricing surfaces
must stay in a defined disabled state until AD-15 resolves the money-unit
contract. `powerKw: 0` must never render as a measurement (NG-08). Once branch
protection lands (AD-04), pull requests become required.

**Claude A must know.** The money-unit fix must change **both** boundaries in one
commit with a test that fails if either is changed alone — two mismatches
currently cancel, so a one-sided fix is wrong by 100× (ISS-29). A row count of
zero is never sufficient evidence for dropping a table; 32 were dropped on that
reasoning and relation loads hid the references (CL-34). A Neon restore is not
complete at the restore — the endpoint changes and every reference must be
repointed (RD-06). The production connection string is a secret binding, never a
plaintext variable.

---

## Phase 13 — Prompt history

| Field | Value |
|---|---|
| Prompt | `next-mechanical-claude-b-release-ops-execution-artifacts-2026-08-09.md` |
| Start (UTC) | `2026-08-09T13:42:57Z` |
| End (UTC) | `2026-08-09T14:29:55Z` |
| **Wall-clock** | **46 min 58 sec** |
| Target | 8–14 hours unattended |
| Target met | **No** — 4× the previous run, still far short of the stated target |
| Previous run | 11 m 43 s |
| Phases completed | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 — all |

### Why it is under the target, concretely

The target assumes invention. This run was mostly **derivation** — the prior
packet had already established the findings, so the work was converting 26 known
facts into 270 items, 80 issues, 60 checklists, and 42 templates, which is
composition rather than discovery.

The genuinely new work was narrow and is where the time actually went: eight new
validator rules with fixtures, the wrangler linter, and three corrections found
by running things rather than by reading them (the dropped R17, the two fixtures
failing for the wrong rule, the prompt folder's empty repository).

What would consume the full target is the work this run **cannot** do: the
Cloudflare read-only session, the Neon restore rehearsal, the rollback drill, and
the beta rehearsals. Every one of those is blocked on an approval or a
credential, and none of them can be substituted with more writing.

### Counts produced

| # | Requirement | Required | Produced |
|---|---|---|---|
| 1 | Work items | 220 | **270** |
| 2 | Issue-ready bodies | 80 | **80** |
| 3 | Operator checklists | 60 | **60** |
| 4 | Evidence-capture templates | 40 | **42** |
| 5 | Release-manifest fixtures | 30 | **37** (50 across all checkers) |
| 6 | Cleanup preservation records | 20 | **20** |
| 7 | Approval decision records | 15 | **16** |
| 8 | Validator/linter rules with fixtures | 12 | **20** (17 policy + 3 linter) |
| 9 | Rollback drills | 10 | **10** |
| 10 | Beta rehearsal scenarios | 8 | **8** |
| 11 | Production no-go scenarios | 6 | **8** |
| 12 | Handoff with Time section | 1 | yes |

**Every non-negotiable count is met or exceeded.**

### Tests run

```
node scripts/analysis/manifest/self-test-all.mjs
  ok  environment manifests   8 fixtures
  ok  release manifests      37 fixtures
  ok  wrangler configs        5 fixtures
  ALL GREEN — 50/50 fixtures across 3 checkers

node validate-release-manifest.mjs --strict <warns fixtures>   → exit 1 (correct)
node validate-release-manifest.mjs --strict <valid fixture>    → exit 0 (correct)
node lint-wrangler.mjs                                          → 0 errors, 5 L2 warnings
grep -n '^import' scripts/analysis/**/*.mjs                     → node: builtins only
```

The visual status HTML was **not** updated — that belongs to the coordinator.

---

## What a human session does next

Four decisions need nothing but an answer — **AD-01** (read-only token),
**AD-02** (token versus browser split), **AD-04** (trunk and protection),
**AD-16** (who clears a no-go). Three of the four unblock most of the rest.

Then one read-only Cloudflare session of roughly thirty minutes, following
CL-01 … CL-13, closes all seven blocked facts and produces the first Worker
version ids this project has ever recorded — which is the single thing standing
between here and a release that can be undone.
