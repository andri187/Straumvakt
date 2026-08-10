# E:\Claude cleanup â€” dry run

**Nothing was deleted, moved, archived, compressed or renamed.** Every command
was a read: directory enumeration, `git` read-only subcommands, and filename
pattern matching. No file contents were opened for any key or secret file. No
push, deploy, SQL, Cloudflare, Neon, GitHub, DNS, hardware, OCPP or BLE/NFC
action.

**Report location note.** The brief asked for
`E:\Claude\Straumvakt\docs\notes\`. That is the canonical shared checkout, which
is currently **dirty (4 modified, 20 untracked)** and which the standing agent
rules say not to write into. Writing a report there would mix this output into
someone else's uncommitted tree â€” exactly the class of mess this exercise is
meant to end. It is filed instead at the same relative path inside a dedicated
worktree, where it is version-controlled:
`E:\Claude\Straumvakt-onboarding-domain\docs\notes\2026-08-10-e-claude-cleanup-dry-run.md`.

---

## TL;DR

| | |
|---|---:|
| Total `E:\Claude` | **46.66 GB** |
| Regenerable build output and dependencies | **44.23 GB (94.8 %)** |
| Everything else â€” all source, docs, evidence, keys, git history | **~2.4 GB** |
| Complete git history, all 47 branches, all 30 worktrees | **82.4 MB** |

**The workspace is not full of duplicated work. It is full of `build/` and
`node_modules/`.** Six `build` directories hold 21.87 GB and 28 `node_modules`
hold 15.29 GB. Deleting every one of them costs a rebuild and `npm install`, and
loses nothing.

**The single most important object here is 2.7 KB.**
`CPMS\mobile-app-driver\android\app\straumvakt-upload.jks` is the Android upload
signing key. It is not in git. If it is lost, no future build can be published
to the same Play Store listing â€” that is unrecoverable by any amount of
rebuilding, and no cleanup command should come within reach of it.

---

## Phase 1 â€” Workspace census

34 first-level children. **No junctions or reparse points at the first level**
(5 were found nested inside repos; all were skipped, never followed).

| Path | Type | GB | Git | Purpose | Class |
|---|---|---:|---|---|---|
| `CPMS` | non-git | **16.38** | no | separate CPMS project + two Flutter apps | **C** â€” separate project |
| `Straumvakt` | git repo | **6.75** | canonical, **dirty 4 / untracked 20** | canonical checkout + shared object store | **preserve** |
| `Straumvakt-driver-access-ui` | worktree | 2.90 | `codex/unaffiliated-driver-experience` | Codex mobile lane | A (build only) |
| `Straumvakt-mobile-product` | worktree | 2.77 | `dev/mobile-product-to-market` | Flutter | A |
| `Straumvakt-mobile-hardening` | worktree | 2.75 | `dev/mobile-product-hardening` | Flutter | A |
| `Straumvakt-relaunch-integration` | worktree | 1.41 | `dev/relaunch-integration` | + unique `.env.local` | A + C |
| `Straumvakt-release-candidate` | worktree | 1.40 | `dev/relaunch-release-candidate` | RC | A |
| `Straumvakt-onboarding-domain` | worktree | 1.33 | `scratch/claude-a-backend-verification-2026-08-09` | **this run** | A |
| `Straumvakt-diag-p4c` | worktree | 1.33 | detached, **dirty 1** | diagnosis | **C** â€” dirty + detached |
| `Straumvakt-audit-checks` | worktree | 1.32 | detached `2b7ebf6` | audit | A |
| `Straumvakt-diag-drizzle` | worktree | 1.32 | `diag/fix-api-endpoints-drift` | diagnosis | A |
| `Straumvakt-core-billing` | worktree | 1.30 | `scratch/claude-a-core-billing-2026-08-10` | **active today** | **hold** |
| `Straumvakt-secret-hygiene` | worktree | 1.30 | `dev/secret-hygiene` | | A |
| `Straumvakt-housekeeping` | worktree | 1.27 | `dev/housekeeping` | | A |
| `Straumvakt-secret-hygiene-v2` | worktree | 1.25 | `dev/secret-hygiene-v2` | tracks `origin/staging` âš  | A + C |
| `zaptec-test` | non-git | **0.51** | no | unversioned technician/charger code | **C** â€” must preserve |
| `Straumvakt-onboarding-web` | worktree | 0.29 | `codex/onboarding-web-experience` | Codex web lane | A |
| `Straumvakt-n1` | worktree | 0.12 | `dev/n1-org-landing` | | A |
| `Straumvakt-employee-landing` | worktree | 0.11 | `dev/employee-landing` | | A |
| 13 docs-only worktreesÂ¹ | worktree | 0.06 each | various | docs packets | **B** â€” retire worktree, keep branch |
| `Straumvakt-rename-worker` | worktree | 0.02 | `dev/rename-prod-worker`, tracks `origin/staging` âš  | | **C** |
| `Straumvakt-parked` | non-git | 0.01 | no | untracked OpenADR material | **C** â€” must preserve |

Â¹ `beta-production`, `catchup-runbook`, `core-security`, `docs-ci`,
`driver-parity`, `infra-verify`, `migrations-config`, `overnight-readiness`,
`parity-fix`, `relops-b`, `remediation-architecture`, `trunk-proposal`,
`w1-checkaudit`.

## Phase 2 â€” Size breakdown

### By artifact class â€” top-most occurrences only, junctions not followed

| Class | Dirs | GB |
|---|---:|---:|
| `build` | 6 | **21.87** |
| `node_modules` | 28 | **15.29** |
| `.next` | 9 | 5.00 |
| `.dart_tool` | 6 | 1.81 |
| `.open-next` | 2 | 0.20 |
| `.gradle` | 6 | 0.05 |
| `.wrangler` | 5 | 0.01 |
| **Total regenerable** | **62** | **44.23** |

### Top 12 individual regenerable directories

| GB | Class | Path |
|---:|---|---|
| 8.72 | build | `CPMS\mobile-app-driver\build` |
| 3.73 | .next | `CPMS\CPMS\.next` |
| 3.45 | build | `Straumvakt\apps\mobile\build` |
| 2.58 | build | `Straumvakt-mobile-hardening\apps\mobile\build` |
| 2.54 | build | `Straumvakt-driver-access-ui\apps\mobile\build` |
| 2.54 | build | `Straumvakt-mobile-product\apps\mobile\build` |
| 2.05 | build | `CPMS\mobile-app\build` |
| 1.23 | node_modules | `Straumvakt\node_modules` |
| 1.19 | node_modules | `Straumvakt-onboarding-domain\node_modules` |
| 1.19 | node_modules | `Straumvakt-diag-drizzle\node_modules` |
| 1.19 | node_modules | `Straumvakt-audit-checks\node_modules` |
| 1.19 | node_modules | `Straumvakt-core-billing\node_modules` |

`apps/mobile` is the shape to notice: **3,536 MB of `build` + 722 MB of
`.dart_tool` against ~75 MB of actual source** (`lib`, `test`, `android`, `ios`,
`web`, `assets`). Every Flutter checkout costs ~2.5 GB and carries ~75 MB of
work. There are four of them.

### Non-regenerable content

~2.4 GB total, and most of it is not what you would guess:

| What | GB | Note |
|---|---:|---|
| `CPMS` source, services, assets | ~0.25 | after removing 16.1 GB of build output |
| `zaptec-test` | 0.51 | 15,444 files, unversioned |
| Straumvakt source + docs + public across all checkouts | ~1.5 | mostly duplicated 30Ã— |
| **`.git` â€” all history, all branches** | **0.08** | |
| `Straumvakt-parked` | 0.01 | |

## Phase 3 â€” Git worktree safety audit

**The finding that makes cleanup safe:** every worktree's `.git` is a pointer
file (`gitdir: E:/Claude/Straumvakt/.git/worktrees/<name>`). All objects and all
branch refs live in one **82.4 MB** store inside the canonical checkout.
**Removing a worktree directory does not delete its branch and cannot lose a
commit.** A worktree is a disposable checkout; the history is elsewhere.

That is why ~44 GB can go and ~82 MB has to stay.

### Registered worktrees needing attention

| Worktree | Issue |
|---|---|
| `Straumvakt-docs-log` | **registered but missing on disk** â€” path is a remote session mount (`/sessions/rcw-â€¦/mnt/â€¦`), branch `docs/relaunch-session-log-2026-08-08` @ `5311cbd`, which holds **7 unique commits**. The branch is safe in the object store; only the registration is stale |
| `Straumvakt` (canonical) | **dirty: 4 modified, 20 untracked** â€” must be reviewed by a human before anything else happens |
| `Straumvakt-diag-p4c` | **dirty (1) and detached HEAD** â€” uncommitted work on no branch. Highest risk of silent loss in this list |
| `Straumvakt-docs-ci` | branch `docs/ci-and-custom-domain` tracks `origin/dev/drizzle-ownership-and-market-harvest` â€” **wrong upstream** |
| `Straumvakt-migrations-config` | branch `fix/prisma-migrations-path` tracks the same wrong upstream |
| `Straumvakt-rename-worker` | `dev/rename-prod-worker` tracks **`origin/staging`** âš  |
| `Straumvakt-secret-hygiene-v2` | `dev/secret-hygiene-v2` tracks **`origin/staging`** âš  |

The last two matter beyond tidiness. `origin/staging` is treated as a production
deploy pointer. A bare `git push` from either worktree targets it. `4fe0a95`
(`dev/rename-prod-worker`) is on the do-not-release list, and it is one command
away from staging. **That is a release-safety issue, not a disk-space one, and it
should be fixed whether or not any cleanup happens.**

### Branch reachability

`origin/main` **does not exist**; the only remote reference is `origin/staging`.
Measured against `origin/staging`, `dev/relaunch-release-candidate` and
`dev/straumvakt-org-relaunch`: **23 of 47 branches hold unique commits**,
including `docs/singular-onboarding-domain-packet` (30),
`scratch/claude-a-backend-verification-2026-08-09` (46),
`scratch/claude-a-core-billing-2026-08-10` (45) and
`docs/beta-production-release-architecture` (27).

**None of that is at risk from deleting directories** â€” but it does mean no
branch should be deleted, and it means the 82.4 MB object store is the single
point of failure for roughly 200 commits that exist nowhere else. **It has no
backup.** See Phase 6.

### Commands that would be needed later â€” **NOT RUN**

```
# NOT RUN â€” clears the stale registration for the missing worktree.
# Safe: prune only removes registrations whose directory is gone. It
# does not touch branches.
git -C E:\Claude\Straumvakt worktree prune --dry-run
git -C E:\Claude\Straumvakt worktree prune

# NOT RUN â€” retire a docs-only worktree, keeping its branch.
git -C E:\Claude\Straumvakt worktree remove Straumvakt-<name>

# NOT RUN â€” correct a wrong upstream.
git -C E:\Claude\Straumvakt-rename-worker branch --unset-upstream
```

## Phase 4 â€” Key and secret material (paths only)

43 files matched outside build output. **No contents were read.**

| Preserve action | Path | KB |
|---|---|---:|
| **CRITICAL â€” irreplaceable** | `CPMS\mobile-app-driver\android\app\straumvakt-upload.jks` | 2.7 |
| **CRITICAL â€” pairs with the key** | `CPMS\mobile-app-driver\android\key.properties` | 0.6 |
| Preserve â€” unversioned runtime creds | `CPMS\CPMS\.data\charger-credentials.json` | 0.1 |
| Preserve â€” local secrets | `CPMS\CPMS\.dev.vars`, `CPMS\CPMS\services\ocpp-server\.dev.vars` | 0.6 |
| Preserve â€” local secrets | `CPMS\CPMS\.env.development.local`, `.env.local` | 1.5 |
| Preserve â€” gitignored | `Straumvakt\.env.local`, `Straumvakt-relaunch-integration\.env.local` | 3.4 |
| Preserve â€” unversioned | `zaptec-test\.env` | 0.1 |
| Regenerable from git | `.env.example` Ã— 30 (one per checkout) | ~38 |

Two notes:

1. **The `.jks` is the whole ballgame.** Everything else on this list can be
   re-created from a dashboard, a teammate, or git. The upload key cannot. It
   should be backed up off this disk **before** any cleanup is approved, not as
   part of it.
2. `.env.example` is committed to git, so the 30 copies are regenerable â€” but a
   previously-recorded issue stands: that file has carried a real `AUTH_SECRET`
   value in history. That is a secret-hygiene item, separate from cleanup, and
   deleting checkouts does not address it.

## Phase 5 â€” Cleanup candidates

### Tier A â€” regenerable, safe once preconditions are met Â· ~42â€“44 GB

| Group | GB | Precondition |
|---|---:|---|
| A1 â€” Flutter `build` + `.dart_tool`, 6 + 6 dirs | **23.68** | confirm no signed APK/AAB inside `build` is the only copy of a release artifact |
| A2 â€” `.next` + `.open-next` + `.wrangler`, 16 dirs | **5.21** | none â€” pure Next.js output |
| A3 â€” `node_modules` in idle checkouts, 24 of 28 dirs | **~13.0** | **no agent is running in that checkout** |
| A4 â€” `.gradle`, 6 dirs | 0.05 | none |

**Exclude from A3 while they are live:** `Straumvakt-core-billing`,
`Straumvakt-core-security`, `Straumvakt-relops-b` (all created 2026-08-10, other
agents' lanes) and `Straumvakt-onboarding-domain` if this session continues.

```
# ============ DO NOT RUN IN THIS DRY RUN ============
# A1 â€” Flutter build output
Remove-Item -Recurse -Force "E:\Claude\CPMS\mobile-app-driver\build"
Remove-Item -Recurse -Force "E:\Claude\CPMS\mobile-app\build"
Remove-Item -Recurse -Force "E:\Claude\Straumvakt\apps\mobile\build"
Remove-Item -Recurse -Force "E:\Claude\Straumvakt-mobile-hardening\apps\mobile\build"
Remove-Item -Recurse -Force "E:\Claude\Straumvakt-mobile-product\apps\mobile\build"
Remove-Item -Recurse -Force "E:\Claude\Straumvakt-driver-access-ui\apps\mobile\build"
# â€¦and the six matching .dart_tool directories

# A2 â€” Next.js output
Remove-Item -Recurse -Force "E:\Claude\CPMS\CPMS\.next"
Remove-Item -Recurse -Force "E:\Claude\CPMS\CPMS\.open-next"
Remove-Item -Recurse -Force "E:\Claude\Straumvakt\.next"
# â€¦and the remaining .next dirs in idle worktrees

# A3 â€” node_modules in IDLE checkouts only
Remove-Item -Recurse -Force "E:\Claude\Straumvakt-<idle-name>\node_modules"
# ====================================================
```

Recovery: `npm install` (~90 s each) and `flutter build` / `npm run build`.
Nothing here is unique.

### Tier B â€” probably safe after verification Â· ~1.0 GB

Retiring the 13 docs-only worktrees. Each is ~64 MB of checked-out files whose
content is fully represented by a branch in the object store.

```
# DO NOT RUN IN THIS DRY RUN
git -C E:\Claude\Straumvakt worktree remove Straumvakt-trunk-proposal
# â€¦ repeat per docs-only worktree
```

Precondition: each is clean (**all 13 verified clean: 0 modified, 0 untracked**)
and its branch is not needed as a live working directory. `worktree remove`
refuses on a dirty tree, which is a useful safety net â€” do not add `--force`.

### Tier C â€” human decision required

| Path | GB | Why it is a decision |
|---|---:|---|
| `CPMS` (non-build content) | ~0.25 | Separate project under a standing isolation rule. Contains the signing key. **Do not touch without Andri** |
| `zaptec-test` | 0.51 | Not a git repo. 15,444 unversioned files of technician/charger-command code. **No backup exists** |
| `Straumvakt-parked` | 0.01 | Not a git repo. Untracked OpenADR material |
| `Straumvakt` (canonical) | â€” | 4 modified + 20 untracked. Review before anything |
| `Straumvakt-diag-p4c` | â€” | Dirty **and** detached. Commit or discard deliberately |
| `Straumvakt-relaunch-integration\.env.local` | â€” | Only copy outside the canonical checkout |
| Anything in the 3 worktrees dated 2026-08-10 | ~1.4 | Other agents' live lanes |

## Phase 6 â€” Archive and preservation plan

The backup priority is **inverted from the size ranking**. Ordered by
irreplaceability, not by GB:

| Rank | What | Size | Why |
|---|---|---:|---|
| 1 | `straumvakt-upload.jks` + `key.properties` | 3.3 KB | unrecoverable; blocks all future Play Store updates |
| 2 | `E:\Claude\Straumvakt\.git` | 82.4 MB | ~200 commits on 23 branches exist nowhere else; **no remote for most** |
| 3 | `zaptec-test` | 0.51 GB | unversioned, no backup |
| 4 | `Straumvakt-parked` | 0.01 GB | unversioned |
| 5 | `.env.local`, `.dev.vars`, `charger-credentials.json` | ~7 KB | re-obtainable but slow |
| 6 | Canonical checkout's 20 untracked files | unknown | must be reviewed first |

Proposed method:

- **Destination:** external or cloud storage **off `E:`** â€” a copy on the same
  disk protects against a bad `rm`, not against a disk failure, and this disk
  currently holds the only copy of every one of the above.
- **Manifest:** `path,size_bytes,sha256,captured_at_utc` as CSV; generate with
  `Get-FileHash -Algorithm SHA256`.
- **Verification:** re-hash from the archive and diff against the manifest;
  require zero mismatches.
- **Restore test:** restore to a scratch directory and confirm
  `git -C <restored> fsck` is clean and `git log --all --oneline | wc -l`
  matches the source. For the `.jks`, confirm the byte hash only â€” **do not**
  test it by signing.
- **Deletion boundary:** no Tier A/B command runs until the manifest verifies
  and the restore test passes. Tier C never runs on this plan.

## Phase 7 â€” Agent Artifact Hygiene Rules

The growth pattern is now measurable: **each new agent worktree costs 1.3 GB
(Node) or 2.8 GB (Flutter) and contributes ~64 MB of actual work.** Thirty
worktrees produced ~24 GB, of which ~1 GB is content. The rules below target
that ratio.

### Full appendix â€” paste into any agent prompt

```text
## Agent Artifact Hygiene Rules

Before you start:
1. State the exact folders you will write to. Do not create new top-level
   folders under E:\Claude without saying so first.
2. Reuse an existing worktree when one already tracks the branch you need.
   Create a new worktree only when you must hold two branches at once, and
   name it for the task.
3. Never copy a repository. Use `git worktree add` â€” it shares the object
   store; a copy duplicates it.

While you work:
4. Do not run `npm install`, a full build, or a Flutter build unless a
   command you actually need requires it. Typecheck and unit tests usually
   do; reading and writing docs never does.
5. Put generated evidence under ONE named folder: `docs/evidence/<task>/`.
   Never scatter screenshots, dumps or reports across the tree.
6. Screenshots: keep the smallest set that proves the claim. Three
   representative images beat forty near-identical ones.

Before you finish:
7. Report every file and folder you created, with its size.
8. Report the total artifact footprint of the run in MB.
9. Report every regenerable output you created â€” `node_modules`, `.next`,
   `build`, `.dart_tool`, `.gradle`, `dist`, `coverage`, `.turbo` â€” with its
   path and size. Never leave one unreported.
10. Either delete the regenerable outputs you created, or list them as
    cleanup candidates. Say which you did.
11. Leave the worktree clean: commit or explicitly report anything dirty.
    Never leave a detached HEAD with uncommitted changes.
12. Update the prompt/history ledger with wall-clock time and artifact
    footprint.

Never:
13. Never delete unique source, evidence, keys, or unversioned folders.
14. Never delete a git branch. Retiring a worktree directory is safe;
    deleting a branch is not.
15. Never run `git stash pop` in a shared worktree â€” a stash on a clean
    tree creates nothing, so the pop takes someone else's.
```

### Short variant â€” Claude Code prompts

```text
Artifact hygiene: state your output folders up front. Reuse an existing
worktree if one tracks your branch; never copy a repo. Skip npm install and
builds unless a command you need requires them. Evidence goes in
docs/evidence/<task>/ only. At the end, report every file created with sizes,
every regenerable output (node_modules/.next/build/.dart_tool) with paths and
sizes, and leave the worktree clean. Never delete unique source, keys, or any
git branch.
```

### Short variant â€” Codex prompts

```text
Artifact hygiene: work inside your assigned worktree only. Do not create
worktrees or top-level folders. Do not run builds unless asked. Keep
screenshots to a representative few, under docs/evidence/<task>/. List every
file you created and its size at the end, and name any node_modules/.next/
build/.dart_tool you generated. Commit or report anything left dirty.
```

### Short variant â€” coordinator prompts

```text
Before dispatching: name the worktree each agent will use and say whether a
new one is justified â€” each Node worktree costs ~1.3 GB and each Flutter one
~2.8 GB, against ~64 MB of actual output. Require every agent to report its
artifact footprint and regenerable outputs on return. After a batch, run the
cleanup dry run and retire worktrees whose branches are merged or idle â€”
retire the directory, never the branch.
```

## Phase 8 â€” Final cleanup proposal

| | |
|---|---:|
| Total measured | **46.66 GB** |
| Tier A â€” regenerable, safe with preconditions | **~42â€“44 GB** |
| Tier B â€” worktree retirement | ~1.0 GB |
| Tier C â€” human decision | ~0.8 GB |
| Needs archive before anything | **0.60 GB** (`.git` + `zaptec-test` + `parked` + keys) |

### Recommended order

1. **Back up the 0.6 GB** in Phase 6 rank order, off this disk. Verify.
2. **Fix the two `origin/staging` upstreams.** Costs nothing, removes a
   one-command path to a production pointer, and is independent of cleanup.
3. **Tier A1 + A2** (~29 GB) â€” build output only, no git involvement, no
   preconditions beyond the APK check.
4. **Tier A3** (~13 GB) â€” `node_modules` in idle checkouts, after confirming no
   agent is running.
5. **Tier B** â€” retire the 13 clean docs-only worktrees and prune the stale
   `Straumvakt-docs-log` registration.
6. **Tier C** â€” one conversation per item, nothing bundled.

Steps 1â€“4 recover **~29â€“42 GB without touching a single line of source, any git
branch, or any key.**

### Risks and unknowns

- **The `build` directories may contain the only copy of a signed APK/AAB.** Not
  verified â€” checking would mean enumerating build outputs in detail. Confirm
  before A1.
- **The canonical checkout's 20 untracked files are unexamined.** They could be
  anything from scratch notes to unique evidence.
- **`zaptec-test` (15,444 files) was not content-classified.** It is treated as
  must-preserve on the strength of prior evidence alone.
- **The 82.4 MB object store has no off-disk copy** and holds ~200 commits with
  no remote. This is the largest real risk in the whole picture, and it is not a
  cleanup risk â€” it exists right now, today, before anything is deleted.
- Three worktrees were created on 2026-08-10 by other lanes and may have changed
  during this measurement.

### Confirmation

**Zero deletions, zero moves, zero archives, zero renames, zero external
mutations.** The only write performed by this run is this file. No secret or key
file was opened; only names and sizes were recorded. No junction or reparse
point was followed â€” 5 were detected inside repositories and skipped, and the
first level contains none.
