# Appendix M — Neon and GitHub read-only evidence sessions (fillable)

**24 Neon fields · 22 GitHub / branch-safety fields.**

Two facts established during this run change how these sessions must be run:

> **`gh` is not installed on this host.** `command -v gh` → rc 1;
> `gh --version` → `command not found`. Every GitHub API field below is therefore
> **operator-run**, not agent-run, and needs either `gh` installed and
> authenticated or the equivalent dashboard page. The **local git** fields are
> already collected — see `evidence/branch-safety-snapshot-2026-08-09.json`.

> **Neon organisation `require_mfa` is FALSE.** Organisation
> `org-young-math-18391044` ("Andri", handle `andri-org-young-math-18391044`,
> plan `launch`, created 2026-04-22, managed by console). Multi-factor
> authentication is not required for the organisation that owns the only database
> this product has. That is field M-04 and it is a finding, not a checkbox.

---

# Part A — Neon (24 fields)

**Absolute constraint: metadata only. No SQL, no `psql`, no connection string, no
live database connection.** Nothing in this section requires reading a single
row, and nothing in it may be used to justify doing so.

Target: **20 minutes**.

## A1 — Identity and organisation (M-01 … M-05)

| # | Fact | Where | Read-only API / MCP | Expected | Dangerous | **Captured** |
|---|---|---|---|---|---|---|
| **M-01** | Project id and name | Console → project card → Settings → General | `GET /api/v2/projects` · MCP `list_projects` · `neonctl projects list` | Exactly one owned project: **`spring-leaf-73019190`**, name **Straumvakt** | A second project nobody recognises | ☐ |
| **M-02** | Region | Settings → General | `describe_project` | One region, matching the Workers estate's latency assumptions | A region far from the edge the Workers run at | ☐ |
| **M-03** | Organisation | Console → org selector | `list_organizations` | **`org-young-math-18391044`** "Andri", plan `launch` | More than one org, or an org nobody recognises | ☐ |
| **M-04** | **Organisation MFA requirement** | Org → Settings → Security | `list_organizations` → `require_mfa` | **Currently `false`** — record it and decide | Leaving it false. This org owns the only database the product has. | ☐ |
| **M-05** | Org member roster | Org → Members | `list_organizations` / org members | A short, expected list | Anyone unexpected with write access | ☐ |

## A2 — Branches (M-06 … M-12)

| # | Fact | Where | Read-only API / MCP | Expected | Dangerous | **Captured** |
|---|---|---|---|---|---|---|
| **M-06** | Full branch list with ids | Console → Branches | `describe_project` · `neonctl branches list` | **13 branches** | A count that disagrees — something was created or deleted | ☐ |
| **M-07** | Parent of each branch | Branches → each branch | `describe_branch` | A coherent tree | A branch whose parent is the abandoned default | ☐ |
| **M-08** | **Which branch is the project DEFAULT** | Branches → the branch marked *Default* | `describe_project` → `branch_logical_size_limit` / `default_branch_id`; the API **can** confirm this | The default is believed to be an **abandoned** branch | Confirmed abandoned → anything that omits a branch id reaches the wrong data, which has already happened here | ☐ |
| **M-09** | Branch used by **beta/staging** | Cross-reference Hyperdrive origin (Cloudflare L-28) against branch endpoints | `describe_branch` per branch | **`br-tiny-river-abgpqq37`** | Hyperdrive pointing anywhere else | ☐ |
| **M-10** | Protected status, per branch | Branches → each branch → Protect | `describe_branch` → `protected` | **None protected today** | The branch holding real beta users' data is unprotected and two clicks from deletion | ☐ |
| **M-11** | Branch creation timestamps | Branches list | `describe_branch` → `created_at` | Consistent with known work | A branch created outside any known change window | ☐ |
| **M-12** | Per-branch logical size | Branches list | `describe_branch` → `logical_size` | Bounded; copy-on-write keeps branches cheap until the parent diverges | Storage growing in a way nobody has budgeted | ☐ |

## A3 — Compute and connectivity (M-13 … M-18)

| # | Fact | Where | Read-only API / MCP | Expected | Dangerous | **Captured** |
|---|---|---|---|---|---|---|
| **M-13** | Compute endpoints per branch | Branch → Computes | `list_branch_computes` | Endpoint id `ep-quiet-bird-abxartp8` for staging | An endpoint that does not match Hyperdrive's origin | ☐ |
| **M-14** | Compute size / autoscaling bounds | Compute detail | `list_branch_computes` | Bounds recorded | Min = max (no headroom) | ☐ |
| **M-15** | Suspend / scale-to-zero timeout | Compute detail | `list_branch_computes` | Recorded — cold starts matter for charger-facing paths | Aggressive suspend on a branch serving OCPP | ☐ |
| **M-16** | **Max connections** | Compute detail | `list_branch_computes` | A number, compared against Worker concurrency **and** the worst-case charger reconnect storm | Worst-case concurrency exceeds the ceiling. Worker concurrency and Postgres connection limits meet at exactly one place, usually under load. | ☐ |
| **M-17** | Connection pooling state | Branch → Connection details → Pooled | Console | Pooling status recorded per environment | Application connecting direct where pooling was assumed | ☐ |
| **M-18** | IP allow list | Settings → IP Allow | `describe_project` | Recorded | Open to the world where it need not be | ☐ |

## A4 — Roles, retention, production runway (M-19 … M-24)

| # | Fact | Where | Read-only API / MCP | Expected | Dangerous | **Captured** |
|---|---|---|---|---|---|---|
| **M-19** | Database role **names** | Branch → Roles | `describe_branch` → roles | Names only. **Never a password, never a reset.** | An application role with owner privileges — code that can drop tables it should not see | ☐ |
| **M-20** | Databases per branch | Branch → Databases | `describe_branch` | As expected | An unexpected database | ☐ |
| **M-21** | **History retention / PITR window** | Settings → Storage → History retention | `describe_project` → `history_retention_seconds` | Believed **7 days** — confirm with a screenshot rather than recollection | Shorter than the interval at which corruption gets noticed. **A problem found on day eight is unrecoverable by PITR.** | ☐ |
| **M-22** | **Production project exists?** | Console → project list | `list_projects` | **Absent today** | Still absent at cutover → production has nowhere to put data | ☐ |
| **M-23** | Deliberate backup branches | Branches → names matching `backup-*` | `describe_project` | **None today.** Beyond the PITR ceiling these are the only recovery that exists. | None, plus a schema change planned | ☐ |
| **M-24** | Disposable-branch rehearsal prerequisites | — | — | Before any restore rehearsal: (a) the branch is created **for** the rehearsal and named `rehearsal-*`; (b) it is **not** a parent of anything; (c) it holds **no** beta data; (d) the endpoint-repoint list is written **first**, because a restored branch has a *different endpoint* and the Workers still point at the old one; (e) elapsed seconds are recorded to populate `rollback.restoreTimeMeasuredSec` | Rehearsing against beta or production data | ☐ |

> **Before any restore, say the data-loss window out loud.** A restore to before a
> bad change also discards everything written since. That sentence belongs before
> the command, not in the post-mortem.

---

# Part B — GitHub and branch safety (22 fields)

## B1 — Already collected, locally, read-only

`node scripts/analysis/git/check-branch-safety.mjs --repo E:/Claude/Straumvakt`
produced `evidence/branch-safety-snapshot-2026-08-09.json`. Rules G1–G11 are in
`scripts/analysis/git/`. Findings below marked **[live]** are measured, not asked.

| # | Fact | Source | Result | **Verify** |
|---|---|---|---|---|
| **M-25** | Registered worktrees | `git worktree list` | **[live] 29 registered, 28 on disk** | ☐ |
| **M-26** | Stale worktree registration | G11 | **[live] 1** — `/sessions/rcw-.../mnt/Straumvakt-docs-log`, a Linux path from a cloud session, HEAD `5311cbd` | ☐ |
| **M-27** | Local branches | `for-each-ref refs/heads` | **[live] 43** | ☐ |
| **M-28** | Remote branches | `ls-remote --heads origin` | **[live] 16** — so **27 local branches have no remote counterpart at all** | ☐ |
| **M-29** | Branches tracking the deploy pointer | G1 | **[live] 2 errors** — `dev/rename-prod-worker`, `dev/secret-hygiene-v2` (plus `staging` itself, legitimate) | ☐ |
| **M-30** | Branches with a mismatched upstream | G2 | **[live] 2 warnings** — `docs/ci-and-custom-domain` and `fix/prisma-migrations-path`, both → `origin/dev/drizzle-ownership-and-market-harvest` | ☐ |
| **M-31** | Branches sharing one upstream | G3 | **[live] 2 errors** — each pair would overwrite the other | ☐ |
| **M-32** | **Worktrees checked out AT a forbidden commit** | G10 | **[live] 3 errors** — `Straumvakt-rename-worker`@`4fe0a95`, `Straumvakt-catchup-runbook`@`30fa407`, the stale registration@`5311cbd`. Not merely reachable: **HEAD**. | ☐ |
| **M-33** | Forbidden commits vs release candidate | G4 | **[live] all three ABSENT** from `4b69d0f` and from `origin/staging`, each resolved | ☐ |
| **M-34** | Fast-forward proof | G5 | **[live] `origin/staging...4b69d0f` = 0 left, 166 right** — staging carries nothing the candidate lacks; promotion is provably a fast-forward | ☐ |
| **M-35** | `push.default` | G6 | **[live] unset** — what a bare `git push` does depends on the git version and is written down nowhere | ☐ |
| **M-36** | pre-push hook | G7 | **[live] `core.hooksPath` is set to `E:\Claude\Straumvakt\.git\hooks` but no pre-push hook exists there** — a configured hooks directory with no hook, which reads as protected and is not | ☐ |
| **M-37** | Retirable worktrees | snapshot | **[live] 6** — zero unique commits *and* zero dirty files | ☐ |

## B2 — Operator-run: needs `gh` installed and authenticated, or the dashboard

| # | Fact | Where | Read-only command | Expected | Dangerous | **Captured** |
|---|---|---|---|---|---|---|
| **M-38** | Repository default branch | Settings → General → Default branch | `gh api repos/andri187/Straumvakt --jq .default_branch` | A branch someone actually uses | A stale default — every clone and every PR base goes to the wrong place | ☐ |
| **M-39** | Protected branches | Settings → Branches | `gh api repos/{o}/{r}/branches --paginate --jq '.[]|{name,protected}'` | **Believed 0 of 16 protected** | Confirmed zero on the deploy pointer | ☐ |
| **M-40** | Rulesets | Settings → Rules → Rulesets | `gh api repos/{o}/{r}/rulesets` | **Believed `[]`** | Empty, or a ruleset with a broad bypass list — documentation rather than protection | ☐ |
| **M-41** | Repository visibility | Settings → General | `gh api repos/{o}/{r} --jq .visibility` | Public — and a real `AUTH_SECRET` is in this repository's history | Public **and** unrotated. Making it private does not un-leak it; **rotation is the only remedy**. | ☐ |
| **M-42** | Actions secret **names** | Settings → Secrets and variables → Actions | `gh secret list --repo {o}/{r}` | Names only, never values | A Cloudflare-shaped secret name → merging a PR can deploy with nobody present, which changes what branch protection is for | ☐ |
| **M-43** | Workflows with deploy capability | `.github/workflows/` | `gh workflow list` + read each file mentioning Cloudflare or Wrangler | A definitive yes/no on automated deploy | A workflow triggered on push to the deploy pointer holding a deploy token | ☐ |
| **M-44** | Open PR base branches | Pull requests | `gh pr list --json number,baseRefName` | Every base intentional | A PR retargeted by a default-branch change without its author noticing | ☐ |
| **M-45** | Branch tips and ages on the remote | Branches page | `gh api repos/{o}/{r}/branches --paginate --jq '.[]|{name,sha:.commit.sha}'` | 16, matching the local baseline | A count or sha differing from `branch-safety-config.json` → G9 fires; **something was pushed** | ☐ |
| **M-46** | Repository-level Actions permissions | Settings → Actions → General | `gh api repos/{o}/{r}/actions/permissions` | Least privilege | Write-all default token with a deploy path present | ☐ |

## B3 — Commands that WOULD mutate — listed, not run

**None of these were executed. Each needs explicit approval.**

| Category | Command | Effect |
|---|---|---|
| `LOCAL` + approval | `git branch --unset-upstream dev/rename-prod-worker` | Removes tracking. Reversible with `git branch -u origin/staging <b>`. **Nothing on the remote changes.** |
| `LOCAL` + approval | `git branch --unset-upstream dev/secret-hygiene-v2` | As above |
| `LOCAL` + approval | `git config push.default simple` | Makes bare-push behaviour explicit |
| `LOCAL` + approval | write `.githooks/pre-push` refusing `staging`/`main` | Local backstop |
| `LOCAL` + approval | `git worktree prune` | Removes the **1** stale registration. Reversible only by re-adding the worktree. |
| `EXT` + approval | `gh api -X PUT repos/{o}/{r}/branches/staging/protection …` | Server-side protection |
| `EXT` + approval | Settings → General → Default branch | Retargets clones and some PRs |
| `EXT` + approval | `gh api -X POST repos/{o}/{r}/rulesets …` | Ruleset creation |
| **`DESTRUCT`** + approval | `git push --force`, `git branch -D`, `git worktree remove` | Never as part of evidence capture |

### Stop conditions

- The remote branch count or `origin/staging` sha differs from
  `branch-safety-config.json` (16 / `f53fb55e1229`) → **G9 fires. Determine
  whether it triggered a deploy before doing anything else.**
- A Worker's Git integration names a repository nobody recognises (Cloudflare L-33).
- An Actions secret whose name suggests Cloudflare deploy capability.

---

## Machine-readable twins

| File | Purpose |
|---|---|
| `evidence/branch-safety-snapshot-2026-08-09.json` | **Live**, already collected |
| `evidence/cloudflare-evidence-capture.json` | Fillable, empty |
| `evidence/neon-evidence-capture.json` | Fillable, empty |
| `evidence/github-evidence-capture.json` | Fillable, empty |
| `evidence/preservation-manifest-2026-08-09.json` | **Live**, validates |
