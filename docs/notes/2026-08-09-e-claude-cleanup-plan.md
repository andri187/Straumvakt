# `E:\Claude` cleanup plan and preservation manifest

**Nothing was deleted, moved, or modified.** This is a measured inventory and a
proposed sequence. Measured 2026-08-09T12:31–12:35Z.

## Headline

| Measure | Value |
|---|---|
| Total under `E:\Claude` | **43.76 GB** |
| Regenerable build output (`node_modules`, `.next`, `.open-next`, `.dart_tool`, `build`) | **41.57 GB — 95%** |
| **Actual content** (source, git objects, docs, assets) | **2.25 GB — 5%** |
| Git worktrees | 28 |
| Non-worktree folders | 3 (`CPMS`, `zaptec-test`, `Straumvakt-parked`) |

**The disk problem is almost entirely `node_modules`.** Reclaiming 41.6 GB
requires **no git decision, no evidence judgement, and no risk** — every byte is
reproducible by `npm install` / `flutter pub get`.

> **Measurement correction, recorded for honesty.** The first pass reported
> impossible values (negative "real content", 35 GB reclaimable from a 26 GB
> tree) because `Get-ChildItem -Recurse` **follows directory junctions on
> Windows**, double-counting shared `node_modules`. The figures above exclude
> reparse points. The first numbers were wrong and are superseded.

## Junctions — an ordering constraint nobody would guess

49 junctions exist. Most are npm workspace links inside a worktree, but **five
cross worktree boundaries**:

| Worktree | Junction | Target |
|---|---|---|
| `Straumvakt-catchup-runbook` | `node_modules` | `E:\Claude\Straumvakt\node_modules` |
| `Straumvakt-employee-landing` | `node_modules` | `E:\Claude\Straumvakt\node_modules` |
| `Straumvakt-migrations-config` | `node_modules` | `E:\Claude\Straumvakt\node_modules` |
| `Straumvakt-n1` | `node_modules`, `.next\standalone\node_modules` | `E:\Claude\Straumvakt\node_modules` |
| `Straumvakt-onboarding-web` | `node_modules`, `.next\standalone\node_modules`, `apps\api\src\generated` | `E:\Claude\Straumvakt-release-candidate\…` |

**Consequence:** deleting `E:\Claude\Straumvakt\node_modules` leaves **four**
worktrees with dangling junctions, and deleting the release candidate's leaves
`Straumvakt-onboarding-web` broken. Junction removal must precede target
deletion, or the failures appear later and elsewhere.

*(Some of these junctions are mine, created in earlier sessions to run typechecks
without a second `npm install`. Recording that rather than leaving it as a
mystery for whoever cleans up.)*

## Preservation manifest — DO NOT DELETE

**Material that exists nowhere in git.** This is the part cleanup can actually
destroy.

### P1 · `E:\Claude\Straumvakt-parked` — 38 files, ~10 MB, **not a git worktree**

`openadr-2026-08-07/` — an OpenADR / Dynamic Grid Iceland technical report in
`.docx`, `.md` and `.pdf` (two versions, plus an external variant), six figures
in PNG and SVG, a verification log, and OpenADR 3 certification PDFs.

**Untracked by any repository. Irreplaceable research output.**
→ **Action: preserve first, then migrate under the canonical repo.**

### P2 · The shared checkout's 18 untracked entries

`E:\Claude\Straumvakt` (branch `dev/straumvakt-org-relaunch`, 22 dirty):

| Item | Assessment |
|---|---|
| `docs/OCPP/` | **The official OCPP 1.6 / 2.0.1 / 2.1 specification archives.** Named as a source in this track's own brief, and **uncommitted** |
| `archive/mobile-driver-vehicle-concept-2026-08-04/` | A deliberate archive folder — untracked |
| 6 × vehicle PNGs (`*_configurable`, `*_transparent`) | Mobile assets not in any branch |
| `apps/mobile/lib/my_vehicle_preview.dart` | **No committed counterpart on any branch** |
| `apps/mobile/lib/screens/{charge_history,my_vehicle,profile}.dart` | Codex committed *its own* versions; **these are the shared-checkout originals and may differ** |
| `apps/mobile/test/my_vehicle_screen_test.dart` | as above |
| `docs/notes/2026-08-08-{auth-enforcement-period-discovery,mobile-product-to-market-phase-0,session-report}.md` | Session evidence, uncommitted |
| `docs/notes/2026-08-08-work-status.html` | Generated status page |
| 4 × modified tracked files (`client.dart`, `types.dart`, `menu_drawer.dart`, ADR 0049) | Uncommitted edits |
| **`_to_delete/`** | Named for deletion — **still inspect before acting**; a folder named `_to_delete` is exactly where something important gets lost |

**None of this is recoverable from git.** It is the single largest preservation
risk in the estate.

### P3 · `E:\Claude\CPMS` — 16.38 GB, 62.5 MB real content

The provenance record for the `hlada` name, the OCPP design, and five months of
work. **Keep.** Its 16.32 GB of `node_modules` is separately reclaimable.

### P4 · `E:\Claude\zaptec-test` — 0.51 GB, 0.7 MB content

Last written 2026-04-28. Almost entirely build output. **Keep the 0.7 MB;
inspect before any decision.**

## Cleanup matrix

Actions: **KEEP** · **PRUNE** (delete build output only) · **MIGRATE** (move
evidence under canonical) · **RETIRE** (remove worktree; branch survives) ·
**WAIT** (peer active) · **INSPECT**

| Folder | Tip | Dirty | Unique vs RC | Owner | Action | Proof required first |
|---|---|---|---|---|---|---|
| `Straumvakt` | `10c292b` | **22** | 0 | shared | **PRUNE + MIGRATE** | P2 preserved; junctions removed first |
| `Straumvakt-parked` | — | — | — | research | **MIGRATE** | copied under canonical, hashes match |
| `CPMS` | — | — | — | legacy | **KEEP + PRUNE** | — |
| `zaptec-test` | — | — | — | unknown | **INSPECT** | contents reviewed |
| `Straumvakt-release-candidate` | `4b69d0f` | 0 | 0 | Claude A | **KEEP** | — |
| `Straumvakt-beta-production` | `31c0900` | 0 | 14 | **me** | **KEEP** | — |
| `Straumvakt-onboarding-domain` | `54c7155` | **1** | 19 | peer | **WAIT** | peer confirms done |
| `Straumvakt-driver-access-ui` | `75beb3c` | 0 | 12 | Codex | **WAIT** | peer confirms done |
| `Straumvakt-mobile-hardening` | `4757f5c` | 0 | 10 | Codex | **WAIT** | peer confirms done |
| `Straumvakt-onboarding-web` | `d228f53` | 0 | 3 | Codex | **WAIT** | peer confirms done |
| `Straumvakt-mobile-product` | `ae5db26` | 0 | 3 | Codex | **RETIRE later** | superseded by hardening branch |
| `Straumvakt-remediation-architecture` | `fabc56f` | 0 | 11 | me | **RETIRE later** | branch retained |
| `Straumvakt-overnight-readiness` | `ed6dc4e` | 0 | 4 | me | **RETIRE later** | branch retained |
| `Straumvakt-infra-verify` | `856ebe2` | 0 | 4 | me | **RETIRE later** | branch retained |
| `Straumvakt-catchup-runbook` | `30fa407` | 0 | 2 | me | **RETIRE later** | branch retained |
| `Straumvakt-trunk-proposal` | `5324241` | 0 | 1 | me | **RETIRE later** | branch retained |
| `Straumvakt-docs-ci` | `d4e2e07` | 0 | 1 | me | **RETIRE later** | branch retained |
| `Straumvakt-diag-drizzle` | `0a2943c` | 0 | 1 | diag | **PRUNE + RETIRE** | branch retained |
| `Straumvakt-housekeeping` | `185e6da` | 0 | 1 | dev | **PRUNE + RETIRE** | branch retained |
| `Straumvakt-parity-fix` | `185e6da` | 0 | 1 | dev | **RETIRE** | same tip as housekeeping |
| `Straumvakt-migrations-config` | `6b9246e` | 0 | 1 | dev | **RETIRE** | junction removed first |
| `Straumvakt-secret-hygiene` | `776552f` | 0 | 1 | dev | **PRUNE + RETIRE** | branch retained |
| `Straumvakt-secret-hygiene-v2` | `174475f` | 0 | 1 | dev | **PRUNE + RETIRE** | ⚠️ **unset upstream first** |
| `Straumvakt-rename-worker` | `4fe0a95` | 0 | 1 | dev | **KEEP, quarantine** | ⚠️ **unset upstream first** |
| `Straumvakt-w1-checkaudit` | `b2250e5` | 0 | 1 | Claude A | **WAIT** | — |
| **`Straumvakt-n1`** | `52e3b32` | 0 | **0** | me | **RETIRE** | already in RC; junction first |
| **`Straumvakt-employee-landing`** | `9a6c6f5` | 0 | **0** | peer | **RETIRE** | already in RC; junction first |
| **`Straumvakt-relaunch-integration`** | `14c1ce2` | 0 | **0** | peer | **PRUNE + RETIRE** | already in RC |
| **`Straumvakt-driver-parity`** | `2b7ebf6` | 0 | **0** | — | **RETIRE** | frontier, already in RC |
| **`Straumvakt-audit-checks`** | `2b7ebf6` det. | 0 | **0** | — | **PRUNE + RETIRE** | detached, nothing unique |
| **`Straumvakt-diag-p4c`** | `09b1333` det. | **1** | **0** | diag | **INSPECT** | the 1 dirty file reviewed |

**Six worktrees have zero unique commits** — their content is already in the
release candidate. Those are the safest retirements in the estate.

## Proposed final layout under `E:\Claude\Straumvakt`

```
E:\Claude\
├── Straumvakt\                    ← canonical repo, the only Straumvakt root
│   ├── docs\
│   │   ├── adr\  notes\  operator\  architecture\
│   │   ├── OCPP\                  ← MIGRATED from untracked (P2), committed
│   │   └── research\
│   │       └── openadr-2026-08-07\  ← MIGRATED from Straumvakt-parked (P1)
│   ├── archive\                   ← includes the mobile vehicle concept (P2)
│   ├── apps\  packages\  src\  gateway\  prisma\  scripts\
│   └── .git\                      ← worktrees live here, not as siblings
├── Straumvakt-wt\                 ← ALL worktrees under one parent
│   ├── release-candidate\
│   ├── beta-production\
│   └── <active peer worktrees>
├── CPMS\                          ← legacy, untouched
└── zaptec-test\                   ← pending inspection
```

**Two structural changes:** research and specification material moves *into* the
repo where it is versioned, and worktrees move under one parent so `E:\Claude`
stops being 28 sibling directories that look like separate projects.

**Not proposed:** moving `CPMS`. It is a different project with its own history.

## Execution sequence

**No step deletes anything until the step before it has been verified.**

| # | Step | Reclaims | Risk |
|---|---|---|---|
| 1 | **Copy** `Straumvakt-parked` and the shared checkout's untracked material to a preservation folder outside `E:\Claude`; record SHA-256 per file | — | none |
| 2 | Verify the copy — count and hashes match | — | none |
| 3 | Inspect `_to_delete/` and `zaptec-test`; decide each explicitly | — | none |
| 4 | Commit `docs/OCPP/`, the research report and the archive folder onto a branch | — | none |
| 5 | Peer owners confirm the four **WAIT** worktrees are finished | — | none |
| 6 | **Remove cross-worktree junctions** | — | low |
| 7 | **PRUNE build output estate-wide** | **~41.6 GB** | **none — regenerable** |
| 8 | `git worktree remove` the zero-unique worktrees | small | low — branches survive |
| 9 | `git worktree remove` the completed docs worktrees | small | low |
| 10 | Restructure to the layout above | — | medium — do last |
| 11 | `git worktree prune` and re-verify every remaining tip | — | none |

**Step 7 alone solves the disk problem.** Steps 8–10 are tidiness and can wait
indefinitely; step 1 cannot.

## Proof required before any deletion

1. The item has **zero unique commits** relative to the RC, **or** its content is
   committed somewhere.
2. Untracked files are **preserved and hash-verified** outside the folder.
3. No junction targets it.
4. Its owner has confirmed completion (peer worktrees).
5. It is not the last copy of anything — verified by search, not by memory.

## Branch retirement plan

**42 local branches, 16 remote.** Branches are cheap; worktrees are not. Retiring
a *worktree* frees disk and clutter while the branch remains fully intact.

| Class | Branches | Action |
|---|---|---|
| Already in the RC (0 unique) | `dev/n1-org-landing`, `dev/employee-landing`, `dev/relaunch-integration`, `dev/drizzle-…-harvest` | **retire the worktree, keep the branch** |
| Completed docs work (mine) | `docs/infra-release-safety-packet`, `docs/overnight-readiness-audit`, `docs/remediation-architecture-packet`, `docs/repo-trunk-proposal`, `docs/staging-catchup-runbook`, `docs/ci-and-custom-domain` | retire worktrees after the packets are consolidated |
| **Quarantine** | **`dev/rename-prod-worker`** | **keep, unset upstream, never merge** — carries `4fe0a95` |
| Merged remote branches | the 12 identified previously | delete from origin **only after tagging** |
| Active peer work | Codex + Claude A branches | leave entirely alone |

**The upstream fix is the one urgent item here** and it is two commands that
touch no remote:

```
git branch --unset-upstream dev/rename-prod-worker
git branch --unset-upstream dev/secret-hygiene-v2
```

Both currently track `origin/staging` — the branch that serves the brand domain.
