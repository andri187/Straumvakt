# Appendix P — Approval packets AP-1 … AP-8

Eight decisions, each expanded to the exact command or dashboard path. Every
packet carries the same seven fields, and the last one is the honest answer to
"does this change anything outside this machine".

**Nothing in this appendix has been executed.** Everything marked `EXT` or
`DESTRUCT` is written down so a human with credentials can run it, not so that
anything here can.

| | Purpose | Mutates external state | Reversible |
|---|---|---|---|
| **AP-1** | Cloudflare read-only token | **yes** — creates a credential | yes, instantly |
| **AP-2** | Neon metadata-only session | no | n/a |
| **AP-3** | Branch protection, after capture | **yes** | yes |
| **AP-4** | Unset four mis-tracked upstreams | **no** — local only | yes, exactly |
| **AP-5** | Prompt-folder preservation | no | yes |
| **AP-6** | workers.dev fix before any route change | **yes** at deploy | yes, with a caveat |
| **AP-7** | Production Neon project | **yes** | while empty only |
| **AP-8** | Archive destination | no | yes |

---

## AP-1 · Scoped read-only Cloudflare token

**Purpose.** Close the seven blocked control-plane facts, and record — for the
first time on this estate — a Worker version id, which is the only thing that
makes a deploy undoable.

**Risk if skipped.** Release-manifest rule R1 rejects every release, correctly:
*"no workerVersionsBefore — this release has no rollback target."* Nothing in the
programme can proceed to production. That is not a formality; it means a bad
deploy is undone by rebuilding and redeploying, during which the product is down.

**Exact path.** `dash.cloudflare.com` → My Profile → API Tokens → **Create Token**
→ *Create Custom Token*.

Permissions — **ten, all Read**:

| Scope | Permission |
|---|---|
| Account | Workers Scripts : Read |
| Account | Workers KV Storage : Read |
| Account | Workers Tail : Read |
| Account | Workers R2 Storage : Read |
| Account | Account Settings : Read |
| Account | D1 : Read |
| Account | Hyperdrive : Read |
| Zone | Zone : Read |
| Zone | DNS : Read |
| Zone | SSL and Certificates : Read |

*Account Resources* → **Include → the Straumvakt account only.**
*TTL* → **start today, end +7 days.**

Store it in the OS credential store or a password manager. **Never in a file
inside any worktree** — a real `AUTH_SECRET` from this project is already public
in git history, so the habit exists.

**Expected output.**

```bash
export CF="<token>"
curl -s -H "Authorization: Bearer $CF" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
# → {"result":{"id":"…","status":"active","expires_on":"2026-08-16T…"},"success":true}
```

Then prove it cannot write:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PUT \
  -H "Authorization: Bearer $CF" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/hlada-staging"
# → 403
```

**Stop condition.** Anything other than **403** on the write test. A **400** means
the request was accepted for processing and rejected on shape — that is not proof
of read-only. **Revoke and reissue with narrower permissions.**

**Rollback.** Delete the token from the same page; re-run verify and expect 401.
Instant, no side effects.

**Mutates external state.** **Yes** — it creates a credential on the Cloudflare
account. Nothing else.

---

## AP-2 · Neon metadata-only session

**Purpose.** Confirm which branch each environment actually uses, whether the
project default really is the abandoned branch, the true PITR window, and the
organisation's MFA setting.

**Risk if skipped.** The default-branch trap stays unconfirmed and has already
caused wrong-branch reads here. The PITR ceiling stays a recollection rather than
a screenshot, and the whole long-horizon recovery plan rests on that number.

**Exact path.** Neon console, or the read-only MCP tools:
`list_organizations`, `list_projects`, `describe_project`, `describe_branch`,
`list_branch_computes`.

**Never call:** `run_sql`, `run_sql_transaction`, `create_branch`, `delete_branch`,
`reset_from_parent`, `prepare_database_migration`, `complete_database_migration`,
`get_connection_string`, `provision_*`.

**Expected output.** Organisation `org-young-math-18391044` ("Andri", plan
`launch`); project `spring-leaf-73019190` ("Straumvakt"); 13 branches, **none
protected**; staging on `br-tiny-river-abgpqq37`; retention believed **7 days**;
**no production project**.

**Stop condition.** A project nobody recognises. Or the Hyperdrive origin from
AP-1's session not matching the staging compute endpoint — that is correct code,
correct queries, wrong database, and it is the most invisible data bug available.
**Do not deploy** until it is resolved.

**Rollback.** None needed. Nothing changes.

**Mutates external state.** **No.** Metadata reads only, no SQL, no connection
string, no live database connection.

> Record `require_mfa` explicitly. It is currently **false** on the organisation
> that owns the only database this product has. That is a finding, not a checkbox.

---

## AP-3 · Branch protection — **after** capture, never before

**Purpose.** Stop the branch that may trigger production deploys from being
force-pushed or deleted by anyone with write access.

**Risk if skipped.** Zero of sixteen branches protected, rulesets empty. Two local
branches track the deploy pointer, and one of them is **checked out at the
forbidden commit `4fe0a95`**.

**Exact path — capture first.**

```bash
gh api repos/andri187/Straumvakt/branches --paginate \
  --jq '.[]|{name,protected}'            > gh-branches-before.json
gh api repos/andri187/Straumvakt/rulesets > gh-rulesets-before.json
sha256sum gh-*.json                      > gh-baseline.sha256
```

> `gh` is **not installed on this host**. Either install and authenticate it, or
> read the same values from Settings → Branches and Settings → Rules → Rulesets.

**Then enable.** Settings → Rules → **Rulesets** → New branch ruleset targeting
`staging`, and a second targeting the trunk:

- Require a pull request before merging
- Block force pushes
- Restrict deletions
- Require linear history

**Expected output.**

```bash
git push --dry-run --force origin HEAD:staging
# → ! [remote rejected] … (protected branch hook declined)
```

**Stop condition.** The bypass actor list is broad. A ruleset with a broad bypass
list is documentation, not protection. **Do not remove the owner's own bypass** —
that can lock the account out of its own repository.

**Rollback.** Disable the ruleset. Instant.

**Mutates external state.** **Yes.** And it changes how Claude A and Codex work —
they must open pull requests afterwards. **Tell them; do not let them discover it.**

---

## AP-4 · Unset four mis-tracked local upstreams

**Purpose.** Remove the tracking relationships that turn a reflexive `git push`
into either a production change or a push onto an unrelated branch.

**Risk if skipped.** Four one-keystroke failure modes:

| Branch | Upstream | Why it matters |
|---|---|---|
| `dev/rename-prod-worker` | `origin/staging` | **Checked out at `4fe0a95`**, the forbidden commit |
| `dev/secret-hygiene-v2` | `origin/staging` | Same tracking, same deploy pointer |
| `docs/ci-and-custom-domain` | `origin/dev/drizzle-ownership-and-market-harvest` | Lands on a branch whose name bears no relation to its own |
| `fix/prisma-migrations-path` | `origin/dev/drizzle-ownership-and-market-harvest` | Shares that upstream with the branch above — each would overwrite the other |

The last two are the quieter hazard: the mistake is invisible in the command
**and** invisible in the branch name.

**Exact commands.**

```bash
cd E:/Claude/Straumvakt
git branch --unset-upstream dev/rename-prod-worker
git branch --unset-upstream dev/secret-hygiene-v2
git branch --unset-upstream docs/ci-and-custom-domain
git branch --unset-upstream fix/prisma-migrations-path
git config push.default simple
```

**Expected output.**

```bash
git rev-parse --abbrev-ref dev/rename-prod-worker@{u}
# → fatal: no upstream configured for branch 'dev/rename-prod-worker'

git ls-remote --heads origin | wc -l      # → 16   (unchanged)
git ls-remote origin refs/heads/staging   # → f53fb55e1229…   (unchanged)
node scripts/analysis/git/check-branch-safety.mjs --repo E:/Claude/Straumvakt
# → G1 and G3 errors gone; G10 remains until AP-4b
```

**Stop condition.** The remote branch count or the `staging` sha differs from the
baseline (16 / `f53fb55e1229`). That means **something was pushed** — establish
what, and whether it triggered a deploy, before doing anything else.

**Rollback.** Exact, per branch:

```bash
git branch -u origin/staging dev/rename-prod-worker
git branch -u origin/dev/drizzle-ownership-and-market-harvest docs/ci-and-custom-domain
```

**Mutates external state.** **No.** This is entirely local. The branches, their
commits, and every remote ref are untouched — only `.git/config` changes.

### AP-4b · The three worktrees sitting on forbidden commits

Separate, and **not** bundled with AP-4, because it needs a decision rather than a
command:

| Worktree | HEAD | Branch |
|---|---|---|
| `E:\Claude\Straumvakt-rename-worker` | `4fe0a95` | `dev/rename-prod-worker` |
| `E:\Claude\Straumvakt-catchup-runbook` | `30fa407` | `docs/staging-catchup-runbook` |
| stale registration | `5311cbd` | `docs/relaunch-session-log-2026-08-08` |

All three are **absent** from the release candidate, so nothing is contaminated.
But a working copy sitting on a forbidden commit is one mistaken `push -u` from
publishing it. The decision is whether those branches are still wanted at all —
and that is Andri's, not this track's.

The stale registration alone has a clean command:

```bash
git -C E:/Claude/Straumvakt worktree prune --dry-run -v   # read-only preview
git -C E:/Claude/Straumvakt worktree prune                # LOCAL mutation, needs approval
```

**Reversible?** Pruning removes only the registration; the branch survives and the
worktree can be re-added. But `git worktree list` counts change, so re-record the
freeze manifest baseline afterwards.

---

## AP-5 · Prompt-folder preservation

**Purpose.** Give real version control to the folder holding the instructions
that drive all three agents.

**Risk if skipped.** `C:\Users\Andri\Documents\New project` has a `.git` directory
with **zero commits and zero tracked files** — 22,888 files, no remote, no reflog.
Losing it has **no recovery path at all**, and the presence of `.git` invites the
assumption that it is safe.

**Exact sequence.**

```bash
cd "C:/Users/Andri/Documents/New project"

# 1. Filename scan FIRST. Any hit stops everything.
find . -maxdepth 2 \( -name '.env' -o -name '.env.*' -o -name '*.pem' \
  -o -name '*.p12' -o -name '*.keystore' -o -iname '*secret*' \
  -o -iname '*credential*' -o -iname '*token*' \) -not -path './.git/*'

# 2. Write .gitignore (full text in Appendix N) — caches, third-party
#    decompilation, and the DaVinci Resolve material.

# 3. Stage ONLY the documents.
git add .gitignore *.md

# 4. Content scan of the staged set, not the whole tree.
git diff --cached | grep -nE 'postgres(ql)?://|npg_|gh[pousr]_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}'

# 5. Commit.
git commit -m "chore: first commit of prompts, ledger and handoffs"
```

**Expected output.**

```bash
git log --oneline | wc -l          # → ≥ 1
git ls-files '*.md' | wc -l        # → ≥ 33
git status --porcelain | wc -l     # → tens, not tens of thousands
```

**Stop condition.** **Any** hit in step 1 or step 4. Do not commit until it is
resolved — this project has already put one real secret in a public repository.

**Rollback.** `git reset --soft HEAD~1` discards the commit; the files are
untouched throughout. **Nothing is deleted at any point in this packet.**

**Mutates external state.** **No.** Local repository only, no remote.

---

## AP-6 · Declare `workers_dev` **before** any route or domain change

**Purpose.** Remove the foot-gun before anyone has a legitimate reason to trip it.

**Risk if skipped.** `apps/api/wrangler.jsonc` and `gateway/wrangler.jsonc` declare
neither `routes` nor `workers_dev`, so the live hostname state is **inferred, not
declared** — five L2 warnings across the three configs. Adding a custom domain
would infer `workers_dev = false` and remove the hostname the shipped mobile app
pins, with **no client-side fix**: it is a compile-time constant with no remote
override and no fallback.

The corrected model matters here. `workers_dev` and `routes` **are inheritable**
into named environments; only bindings are not. So the danger is not only "add
routes to `env.staging`" — it is also **"add routes at the top level"**, because
every environment that declares neither key then inherits them and the inference
fires for all of them at once.

**Exact change.** In `apps/api/wrangler.jsonc` and `gateway/wrangler.jsonc`, in
**every** block that names a deployable Worker — top level *and* each `env.*`:

```jsonc
"workers_dev": true
```

**Expected output.**

```bash
node scripts/analysis/lint/lint-wrangler.mjs
# → before: 0 errors, 5 × L2, 6 × L3
# → after:  0 errors, 0 × L2

npx wrangler deploy --dry-run --config apps/api/wrangler.jsonc
# → the *.workers.dev host still listed
```

**Stop condition.** The linter reports **any L1 error** — that means a routing
change has already disabled a pinned hostname, and drill TT-02 applies now.

**Rollback.** Revert the commit. The deployed state is unchanged until someone
deploys.

**Mutates external state.** **Not until deployed.** The config edit is local; the
deploy is `EXT` and needs its own approval. Order matters: **declare first, then
attach the domain, then verify both hosts answer.** Removing a domain afterwards
does *not* automatically restore what attaching it may have disabled — verify the
workers.dev host again after any rollback.

---

## AP-7 · Production Neon project

**Purpose.** Give production a data home that is isolated from beta's compute,
limits and blast radius.

**Risk if skipped.** Production has nowhere to put data. Release-manifest rule R6
rejects a production manifest pointing at the beta branch, so the release cannot
validate either way.

**Exact path.** Neon console → **New Project** → region matching the Workers
estate → then immediately:

1. **Protect** the primary branch before anything is written to it.
2. Record the `br-` id and enter it into the production release manifest.
3. Record compute size, autoscaling bounds and max connections.
4. Confirm the connection string will be bound as a **secret**, never a plaintext
   variable — a DSN contains a credential.

**Expected output.** A protected, **empty** branch with its id recorded, and
`validate-release-manifest.mjs` accepting a production manifest that names it.

**Stop condition.** Any proposal to copy beta rows across. **Beta holds real
users' personal data gathered in a testing context; it does not move.** Production
starts empty, or seeded with reference data only.

**Rollback.** Delete the project **while it is still empty**. Once it holds
customer data, this decision is not reversible in any meaningful sense.

**Mutates external state.** **Yes.** Creates a project, and incurs cost.

> Settle retention here too. Seven days is shorter than the interval at which some
> corruption is noticed. Either extend it, or accept that deliberately created
> backup branches are the only long-horizon recovery — and then actually create
> them, because there are **none** today.

---

## AP-8 · Archive destination

**Purpose.** Give the preservation material a recovery path that survives the
failure it is meant to survive.

**Risk if skipped.** **2.28 GB of irreplaceable content** has no recovery path.
`docs/OCPP` is 128 untracked files. `Straumvakt-parked` is 38 files in a directory
that is not a git worktree at all — no remote, no branch, no reflog.

**Exact decision.** Two destinations, and say which protects against what:

| Destination | Protects against | Does **not** protect against |
|---|---|---|
| Second physical disk on this machine | a wrong `Remove-Item`, a `git clean -fdx` | loss or failure of the machine |
| Off-machine (external drive or cloud) | machine loss | nothing, at the cost of an upload |

Both risks are real here and **only the first is currently mitigated at all**.

**Expected output.** After the archive is created:

```bash
node scripts/analysis/cleanup/verify-archive.mjs \
  --manifest docs/notes/evidence/preservation-manifest-2026-08-09.json \
  --archive  <extracted archive root> \
  --report   C:/Users/Andri/Documents/archive-verification-2026-08-09.txt
# → All N record(s) verified by extract-and-compare.
```

**Stop condition.** Any record FAILs. The tool says it plainly: *deletion must not
be proposed* — not "proceed with care", **not proposed**. It also fails if the
archive contains a credential-shaped file, because an archive is then a second
copy of a live secret.

**Rollback.** Move the archive. Nothing is deleted by creating one.

**Mutates external state.** **No** — unless the destination is cloud storage, in
which case the material leaves the machine and the personal-data question in
preservation record P-19 applies before anything is uploaded.

---

## Order

```
AP-1 ─┬─→ control-plane session ─→ AP-3 (capture, then protect)
      └─→ version ids recorded  ─→ release manifests can validate
AP-2 ────→ AP-7 (production Neon)
AP-4 ────→ AP-4b (worktrees on forbidden commits)
AP-5 ────→ AP-8 ────→ archive verified ────→ deletion may be PROPOSED
AP-6 ────→ any route or domain change
```

**AP-2, AP-4 and AP-5 mutate nothing outside this machine** and can be done at any
time. AP-4 in particular costs four commands and removes four one-keystroke
failure modes; it is the cheapest risk reduction on the list.

**Deletion appears nowhere in this appendix.** It comes after AP-8's verification
passes, in its own session, with its own approval.
