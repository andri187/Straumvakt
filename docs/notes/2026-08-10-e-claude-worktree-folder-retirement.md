# E:\Claude worktree folder retirement (Tier B)

Follows [Tier A execution](2026-08-10-e-claude-cleanup-execution.md).
**Start** `2026-08-10T01:41:18Z`.

| | Before | After | Δ |
|---|---:|---:|---:|
| `E:\Claude` | 18.47 GB | **17.26 GB** | **−1.21 GB** |
| `E:` free | 245.8 GB | 247.1 GB | +1.3 GB |
| Registered worktrees | 32 | **13** | −19 |

**19 worktree folders retired. All 46 branches intact. Every retired branch
still resolves at its exact SHA. Zero commits, source, docs, evidence or keys
lost.**

The space saved is small — that was expected, and it is not the point. **The
point is going from 32 checkouts to 13.** Tier A had already removed the mass;
what remained was clutter that made the workspace hard to reason about.

---

## Gates

**Object-store backup verified before anything was touched:**
`…\20260810-011726-e-claude-preserve` — 20,579 manifest rows, **0 non-OK**, git
copy present. Retirement manifest written to
`C:\Users\Andri\Documents\Straumvakt-preservation-backups\20260810-014351-e-claude-worktree-retirement`
(`worktree-retirement-manifest.csv` / `.json`) recording path, branch, HEAD,
`git status --short`, last commit, upstream, size and reason-safe for each
candidate.

**Method:** `git worktree remove --force`, which retires the directory *and* the
registration while leaving the branch untouched. No `git worktree prune`, no
`git branch -D`, no `git reset`, no `git clean` — as instructed.

## Retired — 19 folders

Every one verified immediately before removal: registered worktree, branch-based
(not detached), clean tree, zero untracked, no must-preserve filenames, branch
ref present in the shared store.

| Folder | Branch | HEAD | Unique commits | MB |
|---|---|---|---:|---:|
| `Straumvakt-w1-checkaudit` | `fix/wire-work-view-check` | `b2250e5` | 1 | 64.4 |
| `Straumvakt-trunk-proposal` | `docs/repo-trunk-proposal` | `5324241` | 1 | 64.5 |
| `Straumvakt-parity-fix` | `dev/verify-invite-parity-tests` | `185e6da` | 1 | 64.5 |
| `Straumvakt-docs-ci` | `docs/ci-and-custom-domain` | `d4e2e07` | 1 | 64.4 |
| `Straumvakt-driver-parity` | `dev/drizzle-ownership-and-market-harvest` | `2b7ebf6` | 0 | 64.4 |
| `Straumvakt-catchup-runbook` | `docs/staging-catchup-runbook` | `30fa407` | 2 | 64.5 |
| `Straumvakt-migrations-config` | `fix/prisma-migrations-path` | `6b9246e` | 1 | 64.7 |
| `Straumvakt-rename-worker` | `dev/rename-prod-worker` | `4fe0a95` | 1 | 21.8 |
| `Straumvakt-infra-verify` | `docs/infra-release-safety-packet` | `856ebe2` | 4 | 64.5 |
| `Straumvakt-overnight-readiness` | `docs/overnight-readiness-audit` | `ed6dc4e` | 4 | 64.7 |
| `Straumvakt-remediation-architecture` | `docs/remediation-architecture-packet` | `fabc56f` | 11 | 64.8 |
| `Straumvakt-mobile-product` | `dev/mobile-product-to-market` | `ae5db26` | 3 | 67.2 |
| `Straumvakt-mobile-hardening` | `dev/mobile-product-hardening` | `4757f5c` | 10 | 67.3 |
| `Straumvakt-n1` | `dev/n1-org-landing` | `52e3b32` | 0 | 64.8 |
| `Straumvakt-employee-landing` | `dev/employee-landing` | `9a6c6f5` | 0 | 64.8 |
| `Straumvakt-housekeeping` | `dev/housekeeping` | `185e6da` | 1 | 85.5 |
| `Straumvakt-secret-hygiene` | `dev/secret-hygiene` | `776552f` | 1 | 77.5 |
| `Straumvakt-secret-hygiene-v2` | `dev/secret-hygiene-v2` | `174475f` | 1 | 50.3 |
| `Straumvakt-diag-drizzle` | `diag/fix-api-endpoints-drift` | `0a2943c` | 1 | 86.0 |

**All 19 branches verified still resolvable at these exact SHAs after removal.**
To resume work on any of them:

```powershell
git -C E:\Claude\Straumvakt worktree add E:\Claude\<folder> <branch>
```

## The junction discovery — and a consequence of Tier A

Four removals initially failed with `Directory not empty` while reporting **zero
files**. The cause: each contained a **junction** named `node_modules` pointing
at `E:\Claude\Straumvakt\node_modules`.

An earlier agent had set up junction-based sharing so several worktrees used one
dependency tree instead of their own. That is a good idea. Two consequences:

**1. It corrects a claim in the dry run.** I wrote that "each Node worktree
costs ~1.3 GB". Not universally true — these four cost **~64 MB each** because
they shared. The junction-safe measurement was right (it never followed them);
the generalisation drawn from it was too broad.

**2. Tier A left those junctions dangling**, because it deleted the canonical
`node_modules` they pointed at. Harmless here — the four folders were being
retired anyway — and each junction was unlinked with
`[IO.Directory]::Delete(path, false)`, which removes the reparse point **without
following it**. The (already absent) target was never traversed.

### ⚠ One live lane is affected — needs a one-line fix

`Straumvakt-onboarding-web` — an **active Codex lane** — junctions its
`node_modules` to `Straumvakt-release-candidate\node_modules`. Tier A partially
deleted that tree (it stopped at a locked `next-swc` binary, leaving 860 MB of
~1.04 GB).

So **Tier A damaged a dependency tree shared by two worktrees**, not one. Impact
check run just now: 566 top-level packages remain and `next`, `react`,
`typescript`, `vitest`, `hono`, `drizzle-orm`, `@prisma` and `zod` are all
present — the deletion aborted early, in the `@`-scoped range. Both lanes
probably still build. But the tree is **inconsistent**, and that is not a state
to leave a Codex lane in.

```powershell
# repairs BOTH Straumvakt-release-candidate and Straumvakt-onboarding-web
npm --prefix E:\Claude\Straumvakt-release-candidate install
```

This is worth stating plainly: the shared-junction layout was invisible to a
per-folder size scan, so Tier A's candidate list treated `Straumvakt-release-candidate\node_modules`
as belonging to one idle worktree when it was actually shared with a live one.
**A junction scan belongs in the pre-flight of any future cleanup**, not just in
the size measurement.

## Skipped, and why

| Folder | Class | Reason |
|---|---|---|
| `Straumvakt-relaunch-integration` | **B — keep** | contains `.env.local` (must-preserve #9). Caught by the filename scan; `git status` never shows it because it is gitignored |
| `Straumvakt` | B | canonical, dirty (4 modified / 20 untracked) |
| `Straumvakt-onboarding-domain` | B | active lane — this session; holds these reports |
| `Straumvakt-core-billing` | B | active lane, branch dated 2026-08-10 |
| `Straumvakt-core-security` | B | active lane, dated 2026-08-10 |
| `Straumvakt-relops-b` | B | active lane (Claude B), dated 2026-08-10 |
| `Straumvakt-driver-access-ui` | B | active Codex lane, 14 unique commits |
| `Straumvakt-onboarding-web` | B | active Codex lane, 13 unique commits |
| `Straumvakt-beta-production` | B | branch moved during today's sessions — treated as active |
| `Straumvakt-audit-checks` | B | **detached HEAD** — excluded by rule |
| `Straumvakt-diag-p4c` | B | **detached HEAD and dirty (1)** — must-preserve #6 |
| `Straumvakt-release-candidate` | **C — human review** | clean and technically retirable, but its `node_modules` is the shared tree for a live Codex lane and holds a locked file |
| `zaptec-test`, `Straumvakt-parked` | B | non-git, unversioned |
| `CPMS` | B | separate project |

### Human review

| Item | Note |
|---|---|
| `Straumvakt-docs-log` | Registered but **missing on disk** — path is a remote session mount (`/sessions/rcw-…/mnt/…`), marked `prunable`. Branch `docs/relaunch-session-log-2026-08-08` @ `5311cbd` holds 7 unique commits and is safe in the object store. Clearing the registration needs `git worktree prune`, which this run was told not to run |
| `Straumvakt-parked` | Only first-level `Straumvakt*` folder that is not a registered worktree. Unversioned. Untouched |
| `Straumvakt-release-candidate` | See above — retire only after `npm install` repairs the shared tree, or after the Codex lane gets its own |

## Verification

| Check | Expected | Actual |
|---|---|---|
| Branches | 46 | **46** |
| Retired branches resolvable | 19/19 | **19/19** |
| Retired folders on disk | 0 | **0** |
| Retired folders still registered | 0 | **0** |
| Canonical changed files | 24 | **24** |
| `Straumvakt\.git` | present | **present** |
| `docs\OCPP`, `zaptec-test`, `Straumvakt-parked`, `diag-p4c`, `.jks`, `relaunch-integration\.env.local` | present | **all present** |

Registered worktrees now: 13 (12 on disk + the stale `docs-log` registration),
down from 32.

## External state

No push, deploy, SQL, migration, Cloudflare, Neon, GitHub, DNS, OCPP, charger,
BLE/NFC or hardware action. No process killed. **No branch, tag, stash or commit
created, modified or deleted.** The only git writes were `worktree remove`, which
touches registrations, not history. No junction was followed. Nothing outside the
19 vetted folders was deleted or modified.

## Next

1. **`npm --prefix E:\Claude\Straumvakt-release-candidate install`** — repairs the
   shared tree for the release candidate and the live Codex lane. Do this first.
2. **Fix the two `origin/staging` upstreams.** `dev/rename-prod-worker` and
   `dev/secret-hygiene-v2` still track a production deploy pointer, and
   `4fe0a95` is on the do-not-release list. Their worktrees are gone; the
   branches and their upstreams remain. Still a live release-safety issue, still
   independent of disk space.
3. `git worktree prune` for the stale `docs-log` registration — a separate,
   explicit approval.
4. Add a **junction scan** to the pre-flight of any future cleanup.
