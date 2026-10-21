# Repo trunk proposal — establishing a real default branch

**Status: proposal. Nothing in this document has been executed.** No branch was
deleted, renamed or repointed; nothing was pushed or merged; no protection rule
was created or changed. Every command below is written for later execution
after Thor approves.

Written 2026-08-08 from `docs/repo-trunk-proposal`, a worktree off
`dev/drizzle-ownership-and-market-harvest` @ `2b7ebf6`. Every fact was measured
read-only against the real GitHub remote and the local object store on that
date. Several will decay — re-verify before acting.

---

## 0. The problem, measured

| | value | how measured |
|---|---|---|
| GitHub `default_branch` | **`dev/sprint-00-foundation`** (2026-04-24, `4ddc1d0`) | `GET /repos/andri187/Straumvakt` |
| Local `origin/HEAD` | `refs/remotes/origin/dev/sprint-00-foundation` | `git symbolic-ref` |
| `main` / `master` | **neither exists**, locally or on origin | `git for-each-ref` |
| Frontier | `origin/dev/drizzle-ownership-and-market-harvest` @ `2b7ebf6` | `git for-each-ref --sort=-committerdate` |
| Deploy pointer | `origin/staging` @ `f53fb55` (2026-06-14) | `wrangler.jsonc:33` |
| Gap, staging → frontier | **140 commits**, staging a strict ancestor (0 ahead) | `git rev-list --count` |
| Remote branches | 16 | `git ls-remote --heads` |
| …fully contained in frontier | **15** | see §1 |
| Branch protection | **none, on any branch** | `GET /branches` → `protected: false` ×16 |
| Repository rulesets | **none** (`[]`) | `GET /repos/…/rulesets` |
| Repo visibility | **public** | `GET /repos/…` |
| Open PRs | 0 | `GET /pulls?state=open` |

The default branch is a 656-commit-stale placeholder. That is what anyone
landing on the repo sees first, what a fresh `git clone` checks out, and what a
new PR would target by default. There is no protection anywhere, on a public
repo, including on the branch Cloudflare deploys from.

---

## 1. Which branches are actually dead

Re-verified independently rather than taking the earlier count on trust. For
every remote branch, three separate checks against the frontier:

- `git rev-list --count <frontier>..<branch>` — commits unique to the branch
- `git merge-base --is-ancestor <branch> <frontier>` — is the tip literally on
  the frontier's history
- `git cherry <frontier> <branch>` — counts commits whose *patch* has no
  equivalent upstream, which is what catches a rebased or cherry-picked branch
  that merely looks merged by ahead/behind count

**Result: all 15 non-frontier remote branches are strict ancestors of the
frontier.** Unique commits: 0. Cherry-pick divergence: 0. There are no partial
merges and no rebase lookalikes — every one of these tips is a commit you can
still `git log` to from trunk today.

Containment is not the same as safe-to-delete, so they split three ways.

### 1a. Safe to delete — 12 branches

| branch | tip | behind frontier | already tagged |
|---|---|---|---|
| `dev/monorepo-foundation` | `6bbb0ee` | 584 | — |
| `dev/prisma-cf-externalize` | `1790e41` | 605 | — |
| `dev/prisma-client-generator` | `75cfeb3` | 607 | — |
| `dev/sprint-01-ocpp-foundation` | `21247f9` | 650 | `pre-detour-2026-04-25` |
| `dev/sprint-01-ui-detour` | `bc99514` | 596 | — |
| `dev/sprint-05-queue-and-invite` | `50bb0ec` | 436 | — |
| `dev/sprint-06-data-platform-adr` | `8926710` | 434 | — |
| `dev/sprint-07-hot-ingest` | `7d64ba5` | 426 | — |
| `dev/sprint-08-tariff-and-billing` | `7917654` | 362 | — |
| `dev/zaptec-consumer-fly` | `0c20a90` | 404 | — |
| `feat/agreement-architecture` | `9a9e724` | 139 | — |
| `fix/installation-ocpp-password` | `aa75020` | 448 | — |

This independently reproduces the earlier count of 12.

### 1b. Contained, but must not be deleted — 3 branches

| branch | why it stays |
|---|---|
| `dev/sprint-00-foundation` | It is the GitHub **default branch**. GitHub refuses to delete the default branch, so this is blocked on §2 regardless of intent. Becomes deletable the moment the default is repointed. |
| `staging` | The deploy pointer (`wrangler.jsonc:33`). Kept by design — see §3. |
| `dev/p4-c-ingest-integrity` | Contained, but **warm**: newest non-frontier branch (2026-08-07), only 22 behind, holds the repo's most recent *green* CI run, and has a live detached worktree at `E:\Claude\Straumvakt-diag-p4c`. Technically safe; confirm with Thor rather than sweeping it up with the cold ones. |

### 1c. Flags — branches whose local and remote copies disagree

These do not change the delete decision, but whoever runs the cleanup should
know about them.

| branch | local | origin | note |
|---|---|---|---|
| `feat/agreement-architecture` | `82e0a60` | `9a9e724` | local is **13 commits ahead of its own remote** |
| `dev/p4-c-ingest-integrity` | `32a93b4` | `e9cdbfd` | local is **13 commits ahead of its own remote** |
| `staging` | `2bb6b3f` | `f53fb55` | local is **behind** origin — a stale local checkout |

The important part: **both sets of 13 "unpushed" commits are already in the
frontier** (`is-ancestor` = YES, unique = 0). These branches were advanced
locally and the work reached trunk by another route, leaving each local ref
ahead of a stale remote ref while both sit on trunk's history. Nothing is
stranded. The same holds for the two detached worktree HEADs (`09b1333`,
`2b7ebf6`) — both contained, zero unique commits.

**Verified: no branch, local or remote, holds a single commit that is not
already in the frontier.** That is what makes this cleanup low-risk.

The stale local `staging` is worth a separate note for the catch-up runbook: a
`git push` from a local `staging` checkout would push the wrong commit. The
runbook already avoids this by pushing the `origin/…` refspec directly.

---

## 2. Establishing a trunk

### The options

**Option A — rename the frontier to `main`.**
`git branch -m`, push `main`, delete the old name, repoint the default.
One name, no ambiguity, done in a single sitting.

The cost is timing. There are **15 live worktrees** right now, several branched
off the frontier this evening. A rename deletes the old remote ref, so every
local ref tracking it loses its upstream at the same instant, mid-session, in
windows that have no idea it happened. Maximum disruption at the worst moment.

**Option B — create `main` at the same commit, additively.**
`git push origin origin/dev/drizzle-ownership-and-market-harvest:refs/heads/main`
creates a new ref pointing at `2b7ebf6`. Nothing is deleted, nothing loses its
upstream, no in-flight work notices. Repoint the default to `main` immediately;
retire the old branch name later, at a checkpoint when the in-flight branches
have landed.

The cost is a temporary window where one commit has two names, and someone
could push to the old name and diverge from `main`. That is a real risk but a
bounded and visible one — and it is closed by deleting the old name at a chosen
moment rather than an arbitrary one.

**Option C — make `staging` the trunk.**
Collapses the two-branch problem by deleting one of the branches. Rejected:
see §3.

### Recommendation: Option B

Additive, then retire. Three reasons:

1. **It is reversible and non-disruptive.** Creating a ref breaks nothing. If
   the name turns out wrong, delete it and pick another; no one downstream has
   felt anything.
2. **It decouples this work from the staging catch-up entirely.** Because the
   old branch name survives, the catch-up runbook's step-5 refspec
   (`origin/dev/drizzle-ownership-and-market-harvest:staging`) keeps working
   verbatim. A rename would silently invalidate a document that has already
   been written and reviewed. See §5.
3. **CI is currently red on the frontier** (§4). Option B lets the name `main`
   be created now and *protected later*, once `check` is green, rather than
   forcing a choice between an unprotected trunk and a blocked one.

Why `main` and not keeping the topic name: `dev/drizzle-ownership-and-market-harvest`
describes a piece of work that finished. A trunk outlives every topic, and the
name should not have to be re-read as history to know what it is.

### The steps

```
# 1. Create main on origin at the current frontier commit. Additive — nothing
#    is deleted, no local ref changes upstream.
git fetch origin
git rev-parse origin/dev/drizzle-ownership-and-market-harvest     # expect 2b7ebf6…
git push origin origin/dev/drizzle-ownership-and-market-harvest:refs/heads/main

# 2. Repoint the GitHub default branch. Must be done via the API or the UI
#    (Settings → General → Default branch); there is no git command for it.
#    Needs a token with repo admin. `gh` is NOT installed on this machine.
curl -X PATCH https://api.github.com/repos/andri187/Straumvakt \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"default_branch":"main"}'

# 3. Repoint the local origin/HEAD so `git log origin/HEAD` stops lying.
#    Local-only, no network effect.
git remote set-head origin main
git symbolic-ref refs/remotes/origin/HEAD                          # expect …/origin/main

# 4. Create a local main tracking it, in whichever worktree you want it.
git branch main origin/main
```

**Verify**

```
git ls-remote --symref origin HEAD          # expect: ref: refs/heads/main HEAD
git rev-parse origin/main                   # expect 2b7ebf6…
curl -s https://api.github.com/repos/andri187/Straumvakt | grep default_branch
```

**Rollback** — repoint `default_branch` back, `git push origin --delete main`.
Nothing else has changed, so this is complete.

### The retirement step, later

Once the in-flight branches (`dev/n1-org-landing`, `dev/employee-landing`,
`dev/relaunch-integration`, `dev/secret-hygiene*`, `fix/prisma-migrations-path`,
`dev/verify-invite-parity-tests`, `diag/fix-api-endpoints-drift`,
`dev/housekeeping`, `dev/rename-prod-worker`, the two `docs/*` branches) have
landed on `main`:

```
# Confirm nothing new landed on the old name that is not on main
git rev-list --count origin/main..origin/dev/drizzle-ownership-and-market-harvest   # expect 0
git push origin --delete dev/drizzle-ownership-and-market-harvest
```

Do not skip that check. It is the only thing standing between the additive
approach and a silently-forked trunk.

---

## 3. Should `staging` stay a separate branch?

**Recommendation: keep it separate, and change what it means.**

The argument for collapsing it is real: two refs is one more than one, and the
140-commit gap is exactly what a pointer nobody advances looks like. There is
also no evidence from the GitHub side that anything currently consumes it — the
deployments API returns an empty list and staging's tip carries zero check-runs
from a Cloudflare app, which is consistent with the 2026-04-24 deploy-pause note
recording that the Git integration was disconnected. (Not conclusive: the
Cloudflare dashboard is authoritative, and the deploy may simply be a manual
`wrangler deploy --env staging`.)

The argument against collapsing is stronger:

- **A deploy pointer answers a question trunk cannot.** "What is running in
  staging right now?" is a different question from "what is the newest code",
  and it deserves its own ref. Collapse them and the answer becomes "whatever
  the last push was", which nobody can inspect after the fact.
- **Trunk moves continuously; deploys should be deliberate.** Especially with
  `check` currently red — auto-deploying every trunk commit would be strictly
  worse than a stale pointer.
- **If the Git integration is ever reconnected, it keys on a branch name.**
  Pointing it at trunk converts every commit into a deploy.

The 140-commit gap was not caused by having two branches. It was caused by
nobody advancing the pointer and nothing measuring the distance. So fix *that*:

1. `staging` is only ever **fast-forwarded from `main`** — never committed to
   directly, never force-pushed. Enforced by protection (§4).
2. Tag each deploy. The convention already exists in this repo:
   `staging-deploy-2026-06-04-pre-goingpublic`.
3. Make the gap visible. A one-line check —
   `git rev-list --count origin/staging..origin/main` — belongs in `check.yml`
   as a warning (not a failure), or in `scripts/gen-work-view.mjs`. A number
   nobody prints is a number nobody acts on, which is the actual root cause here.

Revisit the collapse question after the catch-up, when the gap is 0 and the
deploy mechanism has been confirmed against the Cloudflare dashboard.

---

## 4. Branch protection

### Findings

**There is no protection of any kind on this repository.** All 16 branches
report `protected: false`; `GET /repos/andri187/Straumvakt/rulesets` returns
`[]` (HTTP 200 — a real empty answer, not an auth failure). The repo is
**public**. Anyone with push access can today force-push or delete `staging`,
the branch that triggers the Cloudflare deploy, with nothing to stop them and
no record afterwards.

### CI, which constrains what can be required

`.github/workflows/check.yml` exists on the frontier and runs `npm run check`
on push to `**` and on every PR — so a required status check is mechanically
available. But:

| | |
|---|---|
| Latest run on the frontier | `check` @ `2b7ebf6` — **failure** (run 31264561209, 2026-08-08T15:28:55Z) |
| Failing step | step 6, `npm run check` |
| Last green run anywhere | `check` @ `a350c2c` on `dev/p4-c-ingest-integrity`, 2026-08-06T23:23Z |
| Last 64 runs (back to 2026-05-05) | 49 failure / 13 success / 2 in-flight |

`check` is a real workflow that has been green within the last 48 hours, so
this is a fixable red, not a broken workflow. But **it is red on the commit
that would become `main` today**, and that dictates the sequencing below.

### Recommendation, in two phases

**Phase 1 — immediately after `main` exists.** Two rules, zero workflow cost,
nothing to fix first:

- `main`: block force-push, block deletion
- `staging`: block force-push, block deletion

Neither blocks a fast-forward, so the catch-up runbook's push still works.

A ruleset covering both is one object and is the modern mechanism:

```
curl -X POST https://api.github.com/repos/andri187/Straumvakt/rulesets \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{
        "name": "trunk-and-deploy",
        "target": "branch",
        "enforcement": "active",
        "conditions": { "ref_name": {
          "include": ["refs/heads/main", "refs/heads/staging"], "exclude": [] } },
        "rules": [ { "type": "non_fast_forward" }, { "type": "deletion" } ]
      }'
```

**Phase 2 — once `check` is green on `main`.** Add `required_status_checks`
for the `check` job, on `main` only:

```
  "rules": [ { "type": "non_fast_forward" },
             { "type": "deletion" },
             { "type": "required_status_checks",
               "parameters": { "strict_required_status_checks_policy": false,
                 "required_status_checks": [ { "context": "check" } ] } } ]
```

Do **not** put a required status check on `staging` — it would block the
catch-up fast-forward while `check` is red, turning a bookkeeping rule into a
deploy blocker.

Two caveats worth stating plainly:

- **Requiring PRs is not recommended yet.** With 15 concurrent worktrees and a
  single operator, a PR requirement converts every branch into ceremony for no
  review benefit. Add it when there is a second reviewer, not before.
- **Repo admins bypass rulesets by default.** If the point is to stop an
  accidental force-push rather than a malicious one, that default is fine and
  arguably correct. If the point is a hard guarantee, `bypass_actors` must be
  set empty — and then the runbook's own pushes are subject to it too.

---

## 5. Ordering against the staging catch-up runbook

The other open document is `docs/notes/2026-08-08-staging-catchup-runbook.md`
(on `docs/staging-catchup-runbook`): back up Neon, land the migrations-path
config fix, reconcile two migrations, reset test, fast-forward `staging`, deploy.

**They are independent, in this direction, and only because of Option B.**

The single point of contact is the runbook's step 5:

```
git push origin origin/dev/drizzle-ownership-and-market-harvest:staging
```

That refspec names the frontier by its current name. Under **Option A** (rename)
this command breaks the moment trunk work lands, and a reviewed document would
have to be re-verified mid-flight. Under **Option B** the old name survives, so
the runbook keeps working verbatim whether trunk work happens before, after, or
in between.

**Recommended order: run the catch-up first, then the trunk work.**

- The catch-up is time-sensitive — the deployed console is 140 commits stale and
  the brand-domain attach is waiting behind it. Trunk cleanup is pure
  bookkeeping with no deadline.
- After the catch-up, `staging` and `main` hold the same commit, which is the
  cleanest possible state in which to evaluate the §3 collapse question with
  real data rather than in the abstract.
- Phase-1 protection is compatible with the catch-up either way (it does not
  block fast-forwards), so it can land before or after without interference.

If trunk work does go first, only one edit is needed: update the runbook's step
5 to `git push origin origin/main:staging`, and re-run its stated pre-check
(`rev-list --left-right --count` must show `0<TAB>N`) before pushing.

---

## 6. Cleaning up the 12 dead branches

**Recommendation: tag first, then delete.**

The commits themselves survive deletion regardless — all 12 tips are ancestors
of trunk, so they stay reachable and are never garbage-collected. What deletion
actually destroys is the **label**: the answer to "where did sprint-07 end?"
becomes an archaeology exercise against a 656-commit log.

A tag costs nothing and preserves exactly that. The repo already has the habit
(`pre-detour-2026-04-25`, `pre-host-drop-2026-04-26`,
`staging-deploy-2026-06-04-pre-goingpublic`), and the Neon side uses the same
shape (`backup-YYYY-MM-DD-pre-<thing>`). One of the 12 —
`dev/sprint-01-ocpp-foundation` — is already covered by `pre-detour-2026-04-25`
and needs no new tag.

Proposed name shape, grouping them under one prefix so they sort together and
stay out of the way of the existing flat tags:
`archive/2026-08-08-<branch-with-slashes-flattened>`.

```
# 1. Tag every tip (annotated, so the reason is recorded in the object).
#    Skips dev/sprint-01-ocpp-foundation — already tagged pre-detour-2026-04-25.
for b in dev/monorepo-foundation dev/prisma-cf-externalize \
         dev/prisma-client-generator dev/sprint-01-ui-detour \
         dev/sprint-05-queue-and-invite dev/sprint-06-data-platform-adr \
         dev/sprint-07-hot-ingest dev/sprint-08-tariff-and-billing \
         dev/zaptec-consumer-fly feat/agreement-architecture \
         fix/installation-ocpp-password; do
  git tag -a "archive/2026-08-08-$(echo "$b" | tr '/' '-')" "origin/$b" \
    -m "Archived branch tip: $b — fully merged into main, branch deleted 2026-08-08"
done

# 2. Push the tags BEFORE deleting anything.
git push origin --tags

# 3. Verify every tag landed and points where it should, then delete.
for b in …same list…; do
  t="archive/2026-08-08-$(echo "$b" | tr '/' '-')"
  [ "$(git rev-parse "$t^{}")" = "$(git rev-parse "origin/$b")" ] \
    && echo "OK   $t" || echo "MISMATCH $t"
done

# 4. Delete the remote branches, one at a time, not in a loop you can't stop.
git push origin --delete dev/monorepo-foundation
git push origin --delete dev/prisma-cf-externalize
# … etc
```

`dev/sprint-00-foundation` is deleted **last**, after §2 repoints the default —
GitHub will refuse until then.

**Verify**

```
git ls-remote --heads origin | wc -l      # expect 16 - 12 - 1 (sprint-00) + 1 (main)
git fetch origin --prune
```

**Rollback** — the tags are the rollback. `git push origin <tag>^{}:refs/heads/<name>`
recreates any branch exactly where it was.

### The coordination cost — flagged as such

Deleting a remote branch **does not touch anyone's local copy**. Nobody loses
work, and every commit remains in trunk's history. This is not a data risk.

It is a **coordination cost**, and it lands on people, not on the repo:

- Anyone with that branch checked out keeps their files, but their upstream
  tracking is now dangling. `git pull` fails, `git push` fails, and `git status`
  stops reporting ahead/behind.
- `git fetch --prune` — which many people have on by default — silently deletes
  the remote-tracking ref, so the failure arrives with no explanation attached.
- Two of the 12 are the sharp cases: **`feat/agreement-architecture` and
  `dev/p4-c-ingest-integrity` each have a local ref 13 commits ahead of their
  remote.** Both sets of commits are already in trunk (verified, §1c), so
  nothing is lost — but the person holding them will see "13 commits ahead of a
  branch that no longer exists", which reads exactly like data loss even though
  it is not. That one is worth a sentence of warning in advance rather than an
  explanation afterwards.
- There are 15 active worktrees on this machine right now. None has one of the
  12 checked out (checked), but that is a snapshot, and other machines are not
  visible from here.

Mitigation is entirely social: announce the list before deleting, delete in one
batch rather than trickling, and keep this document as the record of what the
tags map to.

---

## 7. What this proposal deliberately does not do

- **Does not rewrite history.** No rebase, no filter, no force-push anywhere.
- **Does not touch the Cloudflare configuration**, or answer whether the Git
  integration is connected. The dashboard is authoritative and was not consulted.
- **Does not fix the red `check` run.** That is prerequisite work for Phase 2
  protection and belongs to whoever owns the branches already circling it
  (`diag/fix-api-endpoints-drift`, `fix/prisma-migrations-path`,
  `dev/verify-invite-parity-tests`).
- **Does not address the repo being public with a committed `AUTH_SECRET`.**
  Out of scope here, but adjacent and worth stating: archiving branch tips as
  tags keeps those objects permanently reachable, so tagging is not a step
  toward removing anything from history. That is a separate piece of work.

## 8. Summary of the recommendation

1. Run the staging catch-up runbook first.
2. Create `main` at the frontier commit, additively. Repoint the GitHub default
   and local `origin/HEAD`.
3. Apply Phase-1 protection (no force-push, no deletion) to `main` and `staging`.
4. Tag the 12 dead tips under `archive/2026-08-08-*`, push the tags, verify,
   then delete the branches. `dev/sprint-00-foundation` goes last, after the
   default has moved. Confirm `dev/p4-c-ingest-integrity` separately — it is
   contained but warm.
5. Keep `staging` as a fast-forward-only deploy pointer, and print the
   trunk→staging gap somewhere it will be read.
6. Once `check` is green on `main`, add it as a required status check on `main`
   only.
7. At a later checkpoint, once in-flight branches have landed, delete
   `dev/drizzle-ownership-and-market-harvest` — after confirming
   `git rev-list --count origin/main..origin/dev/drizzle-ownership-and-market-harvest`
   is 0.
