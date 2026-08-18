# Core billing — integration merge onto `dev/core-billing-integration`

**2026-08-18 · Claude A · worktree `E:\Claude\Straumvakt-core-billing`**

Phase 1 of
`docs/agent-prompts/2026-08-18/2026-08-18-1415-claude-a-core-billing-integration-and-blocker-burn-down.md`.

Local only. Nothing pushed. No migration applied.

---

## TL;DR

The merge was **clean — zero conflicts**. The 77 scratch commits and the one
canonical commit they were missing touch disjoint paths, so there was nothing to
resolve by hand.

The merge did surface one red that the branch did not cause: **canonical
`dev/straumvakt-org-relaunch` at `82c63ac` fails its own `npm run typecheck`**,
118 errors, all of them in the `tools/zaptec-test` tree that commit added. Fixed
here in one line; see §5.

---

## 1. Topology

### Before

| | |
|---|---|
| Canonical `dev/straumvakt-org-relaunch` | `82c63ac` |
| Lane `scratch/claude-a-core-billing-2026-08-10` | `a615a52` |
| Merge base | `10c292b` |
| `git rev-list --left-right --count dev/straumvakt-org-relaunch...HEAD` | `1  77` (1 behind, 77 ahead) |

The one commit the scratch branch was behind by is `82c63ac`
*"chore: consolidate OpenADR research and zaptec-test source into canonical"* —
100 added files, all new paths: `docs/OpenADR/**`, `tools/zaptec-test/**`,
`secrets-preservation-manifest/README.md`. It modifies and deletes nothing.

That is why there was no conflict: the canonical side of this merge is
**additions only**, and none of them collide with a path the billing work
touches.

### After

| | |
|---|---|
| `dev/core-billing-integration` | `d7161a2` |
| — merge commit | `b81430d` |
| — typecheck fix | `d7161a2` |
| `git rev-list --left-right --count dev/straumvakt-org-relaunch...HEAD` | `0  78` (0 behind, 78 ahead) |

Both branches still exist untouched: `scratch/claude-a-core-billing-2026-08-10`
still points at `a615a52`, `dev/straumvakt-org-relaunch` still at `82c63ac`.
Nothing was deleted, reset, rebased or force-updated.

---

## 2. Conflict table

| path | conflict | resolution |
|---|---|---|
| — | **none** | `git merge-tree --write-tree 82c63ac a615a52` exited 0 and produced tree `6ac238c` before the merge was run for real; the real merge then reported no conflicted paths. |

The dry run was done first precisely so that a conflicted merge could be planned
rather than fought in the working tree. It was not needed.

**Merge diffstat vs canonical:** 185 files changed, +52,967 / −397.

---

## 3. CRLF discipline (operating rule 6)

The canonical checkout carries 580 files of pure CRLF churn. This worktree does
not, and the merge did not introduce any.

```
git diff --numstat 82c63ac..HEAD   → 185 files
git diff -w --numstat 82c63ac..HEAD → 185 files
```

Every file present in the full diff is also present in the whitespace-ignoring
diff, so **zero files changed by whitespace alone**. Shortstats agree to within
the six real whitespace-bearing lines:

```
     185 files changed, 52967 insertions(+), 397 deletions(-)
-w:  185 files changed, 52961 insertions(+), 391 deletions(-)
```

The single commit made after the merge was checked the same way before it was
made: `git diff --cached -w --shortstat` read `1 file changed, 10 insertions(+),
1 deletion(-)`, identical to the non-`-w` stat.

---

## 4. Migration journal coherence

`apps/api/drizzle/meta/_journal.json` after the merge:

| idx | tag | state |
|---|---|---|
| 0 | `0000_baseline` | present once |
| 1 | `0001_regular_talos` | present once |
| 2 | `0002_powerful_warbird` | **present exactly once** |

No duplicate index, no renumbering, no gap. Three `.sql` files, three snapshots,
three journal entries. `0002` remains **generated and unapplied** — see
`2026-08-18-migration-0002-preflight.md`.

---

## 5. Check results, before and after

| check | before merge (`a615a52`) | after merge (`b81430d`) | after fix (`d7161a2`) |
|---|---|---|---|
| `npx tsc --noEmit -p apps/api` | pass | pass | pass |
| `npm test` (vitest) | 68 files, 1185 pass, 1 skip | 68 files, 1185 pass, 1 skip | 68 files, 1185 pass, 1 skip |
| `npm run typecheck` (all 6 workspaces) | pass | **FAIL — 118 errors** | pass |
| `npm run check` | 11 / 12 | 10 / 12 | 11 / 12 |
| `check:work-view` | FAIL (pre-existing) | FAIL (pre-existing) | FAIL (pre-existing) |

### The typecheck red, and why it is not merge damage

`tools/zaptec-test` is a standalone Next app: its own `package.json`, its own
`tsconfig.json` whose `paths` maps `@/*` → `tools/zaptec-test/src/*`. It is
**not an npm workspace** — the root `workspaces` field is `["apps/*",
"packages/*"]` — so `npm run typecheck --workspaces --if-present` never checks
it with its own config.

The root `tsconfig.json` includes `**/*.ts` and `**/*.tsx` and excluded
`node_modules`, `prisma/**`, `gateway/**`, `apps/**`, `packages/**`, `docs/**`,
`archive/**` — every other standalone tree in the repo, and not `tools/**`. So
the root `tsc` swallowed the tool and resolved each of its `@/...` imports
against the repo-root `src/` instead. Result: 118 errors, **118 of 118 under
`tools/`, zero outside**.

Attribution, proven rather than assumed:

- `git diff --name-only 82c63ac..HEAD -- tsconfig.json` → empty.
- `git diff --name-only 82c63ac..HEAD -- tools` → empty.

Both inputs are byte-identical to canonical on this branch, so the same command
produces the same 118 errors on `dev/straumvakt-org-relaunch` today. **Canonical
is red on its own gate.** The branch merely ran the gate.

Fixed in `d7161a2` by adding `"tools/**"` to the root exclude list — the one
entry that list was always missing. `npm run typecheck` then exits 0 across all
six workspaces.

**This is worth carrying to whoever owns canonical**: the fix belongs there too,
and until it lands, `npm run check` is red on the mainline for a reason nothing
in the billing lane caused.

### `check:work-view` — pre-existing, not fixed, deliberately

`check:work-view` byte-compares the generated `src/app/(app)/admin/work/page.tsx`
against a regeneration from `WORKSPACE.md` + `TASKS.md`. It was red before this
branch existed:

- `git log --oneline dev/straumvakt-org-relaunch..HEAD -- TASKS.md WORKSPACE.md "src/app/(app)/admin/work/page.tsx" scripts/gen-work-view.mjs` → **empty**. None of the 77 scratch commits touches any of its four inputs.
- `git diff --stat 10c292b dev/straumvakt-org-relaunch -- <same paths>` → **empty**. Canonical has not touched them since the merge base either.

All four inputs are byte-identical to the merge base on both sides, so the check
fails identically at `10c292b`, at `82c63ac` and here. Per the Phase 0 gate, it
is recorded and left alone rather than fixed — regenerating it would put an
unrelated generated page into a billing merge.

---

## 6. Reproducing this merge

Exact sequence, from a clean worktree on `scratch/claude-a-core-billing-2026-08-10`:

```sh
cd E:/Claude/Straumvakt-core-billing

# 0. confirm start state
git rev-parse HEAD                                            # a615a52
git status --porcelain                                        # empty
git rev-list --left-right --count dev/straumvakt-org-relaunch...HEAD   # 1  77

# 1. dry run the merge without touching the working tree
git merge-tree --write-tree --name-only 82c63ac a615a52       # exit 0 -> 6ac238c

# 2. branch from the canonical tip explicitly, not from HEAD
git checkout -b dev/core-billing-integration 82c63ac

# 3. merge the lane branch, no fast-forward
git merge --no-ff scratch/claude-a-core-billing-2026-08-10    # -> b81430d

# 4. verify
git diff --numstat 82c63ac..HEAD | wc -l                      # 185
git diff -w --numstat 82c63ac..HEAD | wc -l                   # 185  (no CRLF-only)
cat apps/api/drizzle/meta/_journal.json                       # 0002 once
npx tsc --noEmit -p apps/api                                  # 0
npm test                                                      # 68 files, 1185 pass
npm run check                                                 # typecheck red -> step 5

# 5. the canonical-inherited fix
#    add "tools/**" to the root tsconfig exclude              # -> d7161a2
npm run typecheck                                             # 0
```

No `--ours`, no `--theirs`, no `-X` strategy option, no force, no rebase, no
amend.

---

## 7. External state

Nothing left this machine. No push, no remote branch, no deploy, no migration
applied to any database, no SQL executed anywhere, no Cloudflare, Neon or GitHub
mutation, no branch or tag deleted. The only branch created is the local
`dev/core-billing-integration` named in the prompt's Phase 1.
