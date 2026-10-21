# Straumvakt canonical consolidation

Third step after [Tier A cleanup](../../../Straumvakt-onboarding-domain/docs/notes/2026-08-10-e-claude-cleanup-execution.md)
and worktree retirement. **Start** `2026-08-10T01:54:36Z`.

| | Before | After |
|---|---:|---:|
| `E:\Claude` | 17.39 GB | **17.62 GB** |
| First-level folders | 15 | **15** |
| Registered worktrees | 13 | 13 |
| Branches | 46 | **46** |

**Size went up by 0.23 GB, and that is the correct outcome for this step.** The
npm repair restored 150 packages (+0.22 GB) and 98 unique files were copied into
canonical (+0.01 GB). Nothing was deleted, because nothing had earned it yet —
see "Why nothing was deleted".

---

## 1. Dependency repair — the gate

```
npm --prefix E:\Claude\Straumvakt-release-candidate install
→ added 150 packages, changed 44 packages in 36s   (exit 0)
```

| Check | Result |
|---|---|
| RC top-level packages | 566 → **593** |
| `@next/swc-win32-x64-msvc` binary (the file that blocked Tier A) | **restored** |
| `Straumvakt-onboarding-web` junction resolves | **yes** — `next`, `react`, `typescript`, `vitest`, `@next` all reachable |
| `npx tsc --noEmit -p apps/api` in the RC worktree | **exit 0** |

**Tier A's damage is fully undone, and proven by a compiler run rather than a
file count.** Both the release candidate and the live Codex `onboarding-web`
lane share this tree; both are healthy.

## 2. What was migrated

98 files, every one SHA-256 verified against its source. **0 mismatches.**

| Source | Destination | Files | Size |
|---|---|---:|---:|
| `Straumvakt-parked\openadr-2026-08-07` | `Straumvakt\docs\OpenADR\` | 38 | 10.0 MB |
| `zaptec-test` (source only) | `Straumvakt\tools\zaptec-test\` | 60 | 0.6 MB |

Manifest:
`C:\Users\Andri\Documents\Straumvakt-preservation-backups\20260810-015710-canonical-consolidation\consolidation-manifest.csv`

### What was deliberately NOT copied, and why

`zaptec-test` is 518 MB, but **its unique content is 0.6 MB**:

| Part | Size | Copied? |
|---|---:|---|
| `node_modules` | 378.6 MB | no — regenerable |
| `.next` | 138.8 MB | no — regenerable |
| `src/` + configs + `openapi.json` + `zaptec-constants.json` + `_easee-const.py` | 0.6 MB | **yes** |
| `.env` | 67 B | **no — a secret must not enter a git-tracked path** |
| `tsconfig.tsbuildinfo` | 87 KB | no — build cache |

Verified after copying: `tools\zaptec-test\.env` is **absent** and
`tools\zaptec-test\node_modules` is **absent**.

The `.env` is recorded by path and SHA-256 — never by value — in
`secrets-preservation-manifest.csv` alongside the verified byte backup, and the
file itself remains untouched at its original location.
`Straumvakt\secrets-preservation-manifest\README.md` is a pointer only and
contains no secrets and no inventory of them.

## 3. Why nothing was deleted

The brief allows deleting a migrated folder once "the copied manifest is perfect
and the folder is clearly duplicated". One of the two qualifies on paper —
`Straumvakt-parked` is byte-for-byte duplicated, 38/38 files verified. It was
still not deleted, for a reason that applies to both:

**The migrated content is untracked.**

```
?? docs/OpenADR/
?? tools/
?? secrets-preservation-manifest/
```

Canonical is a dirty checkout (24 pre-existing entries, someone else's
work-in-progress on `dev/straumvakt-org-relaunch`). Until these paths are
committed, a single `git clean -fd` in canonical deletes all 98 files. Removing
the originals now would move the only working copy from a stable folder into a
*deletable* one. That is a worse position than before the migration, not a
better one.

**These commits were not made here on purpose.** Committing 98 files onto
`dev/straumvakt-org-relaunch` would mix this consolidation into another
person's uncommitted branch state.

### The one action that unlocks deletion

Commit the migrated paths — ideally on a dedicated branch, not on top of the
dirty canonical work:

```powershell
git -C E:\Claude\Straumvakt add docs/OpenADR tools/zaptec-test secrets-preservation-manifest
git -C E:\Claude\Straumvakt commit -m "chore: consolidate OpenADR research and zaptec-test source into canonical"
```

After that commit, both originals are safe to delete and reclaim **528 MB**:

```powershell
# ONLY AFTER the commit above
Remove-Item -LiteralPath "E:\Claude\Straumvakt-parked" -Recurse -Force   # 10 MB
Remove-Item -LiteralPath "E:\Claude\zaptec-test" -Recurse -Force         # 518 MB
```

Note the second one also discards `zaptec-test\.env`. It is preserved in the
verified backup, but confirm you can reproduce it before running that line.

## 4. Upstream tracking — fixed

Both branches were verified to track exactly `origin/staging` before any change.

| Branch | Before | After | Tip |
|---|---|---|---|
| `dev/rename-prod-worker` | `origin/staging` | **(none)** | `4fe0a95` unchanged |
| `dev/secret-hygiene-v2` | `origin/staging` | **(none)** | `174475f` unchanged |

`origin/staging` is treated as a production deploy pointer, and `4fe0a95` is on
the do-not-release list. A bare `git push` from either branch targeted it. That
path is now closed.

`git branch --unset-upstream` edits local config only — **no network, no remote
state**. Both branch tips are unchanged and all 46 branches remain.

One branch still tracks `origin/staging`: the local `staging` branch. **That is
correct** — a branch named `staging` tracking its own remote is the expected
configuration, not a hazard.

## 5. Remaining folders and why

| Folder | GB | Classification |
|---|---:|---|
| `Straumvakt` | 3.93 | **canonical** |
| `CPMS` | 8.99 | **separate project** — standing isolation rule. Holds the upload key, release `.aab`/APKs, charger credentials. Not consolidated by this run |
| `Straumvakt-onboarding-domain` | 1.36 | active lane (this session; holds the report series) |
| `Straumvakt-core-billing` | 1.33 | active lane, 2026-08-10 |
| `Straumvakt-release-candidate` | 1.30 | RC; its `node_modules` is the shared tree for a live Codex lane |
| `zaptec-test` | 0.51 | **migrated — ready for deletion after the commit above** |
| `Straumvakt-diag-p4c` | 0.09 | detached HEAD **and dirty** — must-preserve |
| `Straumvakt-audit-checks` | 0.09 | detached HEAD |
| `Straumvakt-relaunch-integration` | 0.09 | holds a gitignored `.env.local` |
| `Straumvakt-driver-access-ui` | 0.07 | active Codex lane |
| `Straumvakt-beta-production` | 0.07 | active lane |
| `Straumvakt-onboarding-web` | 0.07 | active Codex lane |
| `Straumvakt-core-security` | 0.06 | active lane, 2026-08-10 |
| `Straumvakt-relops-b` | 0.06 | active lane (Claude B) |
| `Straumvakt-parked` | 0.01 | **migrated — ready for deletion after the commit above** |

**Only two folders are consolidation candidates.** Every other `Straumvakt-*`
entry is a live git worktree whose content already lives in the shared object
store — those are retired by `git worktree remove` when their lane concludes,
not by copying.

## 6. Verification

| Check | Result |
|---|---|
| Branches | **46** (unchanged) |
| Registered worktrees | 13 (unchanged) |
| Branch tips of the two unset branches | unchanged |
| `Straumvakt\.git` | present |
| `docs\OCPP` · `docs\OpenADR` · `tools\zaptec-test` | present |
| `zaptec-test` + its `.env` · `Straumvakt-parked` | **present, untouched** |
| Android `.jks` · release `.aab` | present |
| `Straumvakt-relaunch-integration\.env.local` | present |
| Prompt history ledger | present |
| All 8 active lanes | present |
| Copy verification | **98/98 files, 0 hash mismatches** |

## 7. Human review

1. **Commit the migrated paths** (§3). Everything else waits on this.
2. **Back up the Android upload key off this machine.** It is on one disk plus
   one local backup, both on this computer. Unrecoverable if the machine fails.
3. **`CPMS`** — 8.99 GB and the largest remaining item. Whether any of it is
   Straumvakt-specific is a decision this run deliberately did not take.
4. **`Straumvakt-diag-p4c`** — still detached *and* dirty. Commit or discard.
5. **`Straumvakt-docs-log`** — stale registration on a remote session mount;
   clearing it needs `git worktree prune`, excluded from these runs.

## External state

No push, deploy, SQL, migration, Cloudflare, Neon, GitHub remote, DNS, OCPP,
charger, BLE/NFC or hardware action. No process killed. **No branch, tag, stash
or commit created, modified or deleted.** The only git write was
`branch --unset-upstream` ×2, which edits local config. `npm install` fetched
packages from the public registry — the sole network access. No secret file
contents were opened; secrets are recorded by path and hash only.
