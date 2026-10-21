# Appendix C · 142 release, ops and cleanup work packages

**Nothing executed.** ⚙️ = mutates external state · 🔒 = human approval ·
**Own:** AN Andri · RO release owner · ENG engineering · OPS operations ·
MOB Codex/mobile · A Claude A.

Effort: **S** < 1h · **M** hours · **L** days.

---

## A · Cloudflare access (14)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| A-01 | Create a read-only scoped API token | AN | 🔒 | — | `wrangler whoami` names the account; no `Edit` scope |
| A-02 | Set token session-scoped only; never persist | AN | — | A-01 | absent from profile, `.env`, shell history |
| A-03 | Run V1–V7 read-only wrangler probes | AN | — | A-01 | outputs captured into the evidence form |
| A-04 | Complete the dashboard session (F2, F6, domains) | AN | 🔒 | — | evidence form fully populated |
| A-05 | Record account identity (F1) | AN | — | A-03 | name + id last6; CPMS co-tenancy answered |
| A-06 | **Determine the Git-integration owner (F2)** | AN | 🔒 | A-04 | repo + branch recorded verbatim |
| A-07 | Capture version ids for all three Workers (F3) | AN | — | A-03 | 3 ids + retained counts |
| A-08 | Verify Hyperdrive target (F4), two sources | AN | — | A-03 | matches Neon `staging` compute |
| A-09 | Inventory secret **names** (F5) | AN | — | A-03 | names only; no value transcribed |
| A-10 | Record DO namespace ids (F6) | AN | 🔒 | A-04 | id last6 + class |
| A-11 | Record queue depths and DLQ counts (F7) | AN | — | A-03 | DLQs confirmed empty or flagged |
| A-12 | Enumerate CPMS Workers + their integrations | AN | 🔒 | A-04 | per-Worker integration state |
| A-13 | Test route-omission behaviour on throwaway resources | ENG | ⚙️🔒 | A-01 | answer recorded; brand domain untouched |
| A-14 | Revoke the verification token when finished | AN | ⚙️🔒 | A-03 | token no longer listed |

## B · workers.dev hardening (11)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| B-01 | **Tier-0 lint: `routes` without `workers_dev`** | ENG | — | — | fails a fixture with routes and no `workers_dev`; passes the current web config |
| B-02 | Wire B-01 into `check` | ENG | — | B-01 | runs on every PR incl. forks; no credential |
| B-03 | Add `"workers_dev": true` to the **API** env | ENG | 🔒 | B-01 | present in the same commit as any `routes` addition |
| B-04 | Add `"workers_dev": true` to the **gateway** env | ENG | 🔒 | B-01 | as above |
| B-05 | Release-checklist item for config diffs | RO | — | — | in the release runbook |
| B-06 | Post-deploy workers.dev liveness probe | OPS | — | — | both hosts return their own 404, not 1042 |
| B-07 | Monitor: alert if a workers.dev host returns 1042 | OPS | ⚙️🔒 | — | alert fires on a test hostname |
| B-08 | Document the pinned host as a shipped-app dependency | MOB | — | — | recorded in the mobile README |
| B-09 | Move the mobile base URL to configuration | MOB | — | — | app reads it from config, not a literal |
| B-10 | Confirm zero traffic before retiring the pinned host | MOB+OPS | 🔒 | B-09 | telemetry over a defined window |
| B-11 | Charger-endpoint liveness probe (gateway host) | OPS | — | — | independent of the API probe |

## C · Same-zone fetch and bindings (9)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| C-01 | Confirm `api.straumvakt.org` is a **Custom Domain**, not a route | AN | — | A-04 | recorded |
| C-02 | Document the four Worker-to-Worker paths | ENG | — | — | in the topology doc |
| C-03 | **Add a `web → API` service binding** | ENG | 🔒 | C-01 | removes the Custom-Domain dependency |
| C-04 | Never convert the API to a route — record the rule | ENG | — | C-02 | in the config comment |
| C-05 | Verify no route pattern shadows `api.straumvakt.org` | AN | — | A-04 | none found |
| C-06 | Probe web → API after any routing change | OPS | — | — | 200 through the web app |
| C-07 | Correct `api-client.ts`'s map of the non-existent prod host | ENG | 🔒 | — | comment or removal |
| C-08 | Mirror the binding shape in the production config | ENG | 🔒 | C-03 | parity |
| C-09 | Contract test: web reaches API without public egress | ENG | — | C-03 | passes offline |

## D · GitHub and branch safety (13)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| **D-01** | **`--unset-upstream` on `dev/rename-prod-worker`** | ENG | — | — | no branch except `staging` tracks `origin/staging` |
| **D-02** | **`--unset-upstream` on `dev/secret-hygiene-v2`** | ENG | — | — | as above |
| D-03 | Audit all 42 local branches for upstreams | ENG | — | — | table recorded |
| D-04 | Create `main` additively at the RC commit | ENG | ⚙️🔒 | — | exists; nothing else changed |
| D-05 | Repoint the GitHub default branch | AN | ⚙️🔒 | D-04 | fresh clone checks out `main` |
| D-06 | Ruleset: `non_fast_forward` + `deletion` | AN | ⚙️🔒 | D-04 | force-push rejected; ff still works |
| D-07 | Required status check on `main` only | AN | ⚙️🔒 | check green | pointers not gated |
| D-08 | Create the `production` branch | ENG | ⚙️🔒 | D-06 | protected, ff-only |
| D-09 | Advance `staging` to the RC | RO | ⚙️🔒 | A-06 | `0 N` left side |
| D-10 | Adopt annotated release tags | RO | ⚙️ | D-08 | tag per advance |
| D-11 | Retire the stale default branch | AN | ⚙️🔒 | D-05 | deleted from origin |
| D-12 | Publish the trunk→pointer gap | OPS | — | — | number visible |
| D-13 | Quarantine `dev/rename-prod-worker` (never merge) | ENG | — | D-01 | documented |

## E · Neon runway (14)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| E-01 | Record current project/branch/compute inventory | AN | — | — | 13 branches recorded |
| E-02 | Decide CPMS-era data retention | AN | 🔒 | — | written decision |
| E-03 | Repoint the project default branch | AN | ⚙️🔒 | E-02 | default is no longer abandoned |
| E-04 | Protect `staging` | AN | ⚙️🔒 | — | accidental write fails loudly |
| E-05 | Protect the old default | AN | ⚙️🔒 | E-02 | as above |
| E-06 | Document the **7-day PITR ceiling** | OPS | — | — | in every rollback plan |
| E-07 | Backup-before-change policy | OPS | — | E-06 | written and adopted |
| E-08 | Create the production project | AN | ⚙️🔒 | — | separate project |
| E-09 | Its default branch is the real one | AN | ⚙️🔒 | E-08 | verified at creation |
| E-10 | Protect the production primary from day one | AN | ⚙️🔒 | E-08 | — |
| E-11 | Consider `allowed_ips` for production | AN | ⚙️🔒 | E-08 | decision recorded |
| E-12 | Create production Hyperdrive | AN | ⚙️🔒 | E-08 | targets E-08 only |
| E-13 | Review retention against the RTO | AN | 🔒 | E-06 | 7 days accepted or extended |
| E-14 | Decide the fate of `scratch-n1-onboarding-2026-08-08` | AN | 🔒 | — | keep or delete, recorded |

## F · Migrations (12)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| F-01 | Tier-0 migration lint (`IF EXISTS`, `CASCADE` comment) | ENG | — | — | no credential; runs on forks |
| F-02 | Backup branch before any change | AN | ⚙️🔒 | — | LSN recorded |
| F-03 | Rehearse `migrate deploy` on a **fresh** clone | ENG | ⚙️🔒 | F-02 | Q1–Q6 transitions observed |
| F-04 | Read-only preflight Q1–Q6 on staging | ENG | — | A-08 | Q2 returns 0 rows |
| F-05 | Reconcile the two migrations (`deploy`, not `resolve`) | ENG | ⚙️🔒 | F-03, F-04 | 47 recorded |
| F-06 | Reset `test` from `staging` **after** F-05 | AN | ⚙️🔒 | F-05 | divergence closed |
| F-07 | Replay all 47 into empty production | ENG | ⚙️🔒 | E-08, F-05 | clean from scratch |
| F-08 | Document explicit-branch-id discipline | OPS | — | — | for humans **and** agents |
| F-09 | Measure and record restore time (RTO) | AN | ⚙️🔒 | F-02 | a number exists |
| F-10 | Never edit a recorded migration — record the rule | ENG | — | — | in the migrations README |
| F-11 | Tier-1 `migrate status` on a disposable branch | ENG | ⚙️🔒 | F-01 | least-privilege role |
| F-12 | Negative test: the CI role cannot read business tables | ENG | ⚙️🔒 | F-11 | `SELECT` fails |

## G · Beta environment (12)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| G-01 | Add `beta.straumvakt.org` | AN | ⚙️🔒 | A-06, I-02 | 200 + TLS; brand hash unchanged |
| G-02 | Add `beta.api.straumvakt.org` **with** `workers_dev: true` | AN | ⚙️🔒 | B-03 | pinned host still serves |
| G-03 | Decide the beta cookie/CORS boundary | AN | 🔒 | — | isolation consequence recorded |
| G-04 | Add the beta origin to the driver-API CORS list | ENG | 🔒 | G-03 | preflight passes |
| G-05 | Flag beta orgs as test tenants | ENG | ⚙️🔒 | — | a query distinguishes them |
| G-06 | Beta test-data purge procedure | OPS | — | G-05 | no schema change needed |
| G-07 | Rename beta web → `straumvakt-web-beta` | ENG | ⚙️🔒 | G-01 | no inbound binding breaks |
| G-08 | Rename beta API → `straumvakt-api-beta` | ENG | ⚙️🔒 | B-10 | after zero pinned traffic |
| G-09 | **Do not rename the gateway** — record the decision | OPS | — | — | written |
| G-10 | Beta dashboards, alerts → engineering (not paging) | OPS | ⚙️🔒 | — | test alert received |
| G-11 | Beta smoke-test script (read-only) | ENG | — | — | runs offline against beta |
| G-12 | Beta status page or channel | OPS | — | — | exists |

## H · Production environment (13)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| H-01 | Add `HYPERDRIVE_DB` + bindings to the **root** config | ENG | — | — | config only, not deployed |
| H-02 | Deploy `straumvakt-web` — workers.dev only | ENG | ⚙️🔒 | H-01 | no custom domain |
| H-03 | Deploy `straumvakt-api` — workers.dev only | ENG | ⚙️🔒 | H-01 | — |
| H-04 | Create `straumvakt-ocpp` for production chargers | ENG | ⚙️🔒 | — | name is free |
| H-05 | Production secrets **by name**, distinct values | AN | ⚙️🔒 | H-02, H-03 | no value reused |
| H-06 | Distinct `OCPP_CRED_KEK` | AN | ⚙️🔒 | H-05 | rotating beta's leaves prod working |
| H-07 | Production queues + DLQs | ENG | ⚙️🔒 | — | distinct names |
| H-08 | Production R2 + lifecycle | ENG | ⚙️🔒 | — | retention configured |
| H-09 | Disable `workers_dev` on production Workers | ENG | ⚙️🔒 | H-02, H-03 | workers.dev does not serve |
| H-10 | Full production smoke on workers.dev | ENG | — | H-05 | auth + DB read |
| H-11 | **Verify production reads the production database** | ENG | — | H-10 | beta marker absent |
| H-12 | Verify bindings resolve to production Workers | ENG | — | H-10 | no beta target |
| H-13 | Validate the production manifest offline | ENG | — | — | schema + policy pass |

## I · CPMS separation (8)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| I-01 | Inventory CPMS Workers, bindings, secret names, domains | AN | 🔒 | A-04 | recorded |
| **I-02** | **Disconnect any CPMS integration to `hlada*`** | AN | ⚙️🔒 | A-12, I-04 | no second repo can deploy |
| I-03 | Verify from outside that the Worker still serves | OPS | — | I-02 | hash unchanged |
| I-04 | Decide CPMS's fate | AN | 🔒 | I-01 | retire or repoint |
| I-05 | Export CPMS config + `CLAUDE.md` to evidence | ENG | — | — | preserved |
| I-06 | Archive (not delete) the CPMS repository | AN | ⚙️🔒 | I-02 | read-only, recoverable |
| I-07 | Do not delete shared-name Workers while CPMS claims them | OPS | — | — | recorded |
| I-08 | Resolve CPMS-era Neon data retention | AN | 🔒 | — | see E-02 |

## J · Cutover (11)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| J-01 | Pre-cutover evidence capture | RO | — | A-07 | versions, domains, hashes |
| J-02 | Attach `straumvakt.org` to production | AN | ⚙️🔒 | J-01, H-11 | hash **differs** from beta |
| J-03 | Attach `www` (separate certificate) | AN | ⚙️🔒 | J-02 | verified independently |
| J-04 | Attach `api.straumvakt.org` | AN | ⚙️🔒 | J-02 | as Custom Domain |
| J-05 | Post-cutover body-hash comparison | OPS | — | J-02–J-04 | all three differ from beta |
| J-06 | Independent TLS verification per hostname | OPS | — | J-05 | valid, correct SAN |
| J-07 | Confirm `beta.straumvakt.org` still serves beta | OPS | — | J-02 | unchanged |
| J-08 | Confirm the charger fleet is unaffected | OPS | — | J-02 | connection count flat |
| J-09 | 24-hour observation window, staffed | RO | 🔒 | J-05 | no elevated 5xx |
| J-10 | Keep beta Workers warm through the bake | OPS | — | J-09 | nothing deleted |
| J-11 | **Defer all deletion** | OPS | — | — | no cleanup scheduled |

## K · Cleanup (18)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| **K-01** | **Copy P1–P4 to a preservation folder; hash each** | ENG | — | — | counts + SHA-256 match |
| K-02 | Verify the copy independently | ENG | — | K-01 | second pass agrees |
| K-03 | Commit `docs/OCPP` (128 files) to a branch | ENG | 🔒 | K-01 | tracked |
| K-04 | Commit the OpenADR report under `docs/research` | ENG | 🔒 | K-01 | tracked |
| K-05 | Commit the mobile vehicle-concept archive | ENG | 🔒 | K-01 | tracked |
| K-06 | Inspect `_to_delete/` and decide explicitly | ENG | 🔒 | K-01 | written decision |
| K-07 | Inspect `zaptec-test` and decide | ENG | 🔒 | — | written decision |
| K-08 | Back up `Documents\New project` prompts | AN | — | — | copied into the repo or a backup |
| K-09 | Run the cleanup **dry-run** script | ENG | — | K-01 | manifest produced; nothing deleted |
| K-10 | Remove cross-worktree junctions (`cmd /c rmdir`) | ENG | 🔒 | K-09 | five removed, targets intact |
| K-11 | **Prune build output estate-wide (~41.6 GB)** | ENG | 🔒 | K-10 | reclaimed; builds still work |
| K-12 | Retire the six zero-unique worktrees | ENG | 🔒 | K-11 | branches survive |
| K-13 | Retire completed docs worktrees | ENG | 🔒 | K-12 | branches survive |
| K-14 | Peer owners confirm the WAIT worktrees are finished | AN | 🔒 | — | written confirmation |
| K-15 | Restructure to the proposed layout | ENG | 🔒 | K-13 | worktrees under one parent |
| K-16 | `git worktree prune`; re-verify every tip | ENG | — | K-15 | all tips unchanged |
| K-17 | Preservation manifest kept current | OPS | — | K-01 | reviewed per session |
| K-18 | Never `Remove-Item -Recurse` a junction — record the rule | OPS | — | — | in the cleanup doc |

## L · Observability (12)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| L-01 | `env` label mandatory on every metric | OPS | ⚙️🔒 | — | no unlabelled metric |
| L-02 | Queue depth + consumer lag + DLQ alerts | OPS | ⚙️🔒 | A-11 | fires on a test |
| L-03 | Cost-projection freshness alert | OPS | ⚙️🔒 | — | p95 < 10 min |
| L-04 | Scheduled brand-domain hash + TLS check | OPS | ⚙️🔒 | — | daily |
| L-05 | Alert on a version change with **no manifest** | OPS | ⚙️🔒 | M-01 | out-of-band deploy detected |
| L-06 | Alert on activity against the abandoned Neon branch | OPS | ⚙️🔒 | E-03 | fires |
| L-07 | Alert on a workers.dev host returning 1042 | OPS | ⚙️🔒 | B-07 | fires |
| L-08 | Charger connection-count dashboard | OPS | ⚙️🔒 | — | visible |
| L-09 | Fire a test alert; confirm a human receives it | OPS | — | L-02 | received |
| L-10 | Log-redaction rules + sampled review | ENG | — | — | no personal data |
| L-11 | Record a version id on every deploy | RO | — | A-07 | rollback target always exists |
| L-12 | SLO dashboard live **before** traffic | OPS | ⚙️🔒 | — | — |

## M · Release governance (10)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| M-01 | Adopt the release-manifest schema | RO | — | — | validator passes |
| M-02 | Emit a manifest on every promotion | RO | — | M-01 | artefact stored |
| M-03 | Name a release owner | AN | 🔒 | — | recorded |
| M-04 | Record that rollback is ungated | OPS | — | — | in the runbook |
| M-05 | Beta gate checklist adopted | RO | — | — | — |
| M-06 | Production gate checklist adopted | RO | — | — | — |
| M-07 | Remove `check:work-view` from the pipeline | ENG | 🔒 | — | `check` passes |
| M-08 | Minimum-safe-version per Worker | RO | — | A-07 | recorded |
| M-09 | Change-freeze policy for launch | AN | 🔒 | — | written |
| M-10 | Release evidence bundle template | RO | — | M-01 | in use |

## N · Beta acceptance and testing (8)

| # | Package | Own | ⚙️🔒 | Deps | Acceptance |
|---|---|---|---|---|---|
| N-01 | Execute the beta acceptance programme | OPS | ⚙️🔒 | G-01 | all gates recorded |
| N-02 | **First real charge with independent cost check** | OPS | ⚙️🔒 | F-05, J-01 | displayed = calculated |
| N-03 | Concurrent-session test | OPS | ⚙️🔒 | N-02 | correct one stops |
| N-04 | Cross-tenant negative suite | ENG | — | — | all pass |
| N-05 | Invite identity binding on all three paths | ENG | — | — | negative test per path |
| N-06 | Mobile N−1 compatibility matrix | MOB | — | — | recorded |
| N-07 | Accessibility and text-scaling pass | MOB | — | — | offline |
| N-08 | Backup/restore rehearsal, timed | AN | ⚙️🔒 | F-02 | RTO measured |

**Total: 142.**

---

# Issue-ready bodies — top 45

Ordered by leverage. Format: **Evidence · Scope · Non-goals · Deps · Commands ·
Mutation · Approval · Rollback · Observability · Acceptance.**

### 1 · D-01 / D-02 — unset the two `origin/staging` upstreams
**Evidence:** `dev/rename-prod-worker` and `dev/secret-hygiene-v2` both track
`origin/staging`; 0 of 16 branches protected. **Scope:** two local commands.
**Non-goals:** deleting branches; touching remotes. **Deps:** none.
**Commands:** `git branch --unset-upstream <branch>` ×2, then re-audit.
**Mutation:** none — local config only. **Approval:** none needed.
**Rollback:** `git branch -u origin/staging <branch>`. **Observability:** the
audit table. **Acceptance:** only `staging` itself tracks `origin/staging`.
**Why first:** with no branch protection, this is the only thing between a
habitual `git push` and a production deploy. Two commands.

### 2 · K-01 — preserve P1–P4 with hashes
**Evidence:** 38 parked files, 128 untracked OCPP files, 17 other untracked
entries, plus unversioned prompts. **Non-goals:** deleting or moving originals.
**Commands:** copy → `Get-FileHash -Algorithm SHA256` → compare counts.
**Mutation:** none (copy only). **Rollback:** delete the copy.
**Acceptance:** file counts and every hash match. **Why:** the only irreversible
risk in the estate, and it is a copy operation.

### 3 · A-04 / A-06 — dashboard session and integration owner
**Evidence:** seven blocked facts; two repositories declare the same Worker names.
**Non-goals:** any change; any secret value. **Commands:** Appendix A Part 2.
**Mutation:** none. **Approval:** dashboard access.
**Acceptance:** evidence form complete; F2 recorded verbatim.
**Stop condition:** repository is CPMS → **incident**, halt the release.
**Why:** ~30 minutes, unblocks eleven packages.

### 4 · B-01 — Tier-0 workers.dev lint
**Evidence:** API and gateway configs both declare `routes`-less/`workers_dev`-less
blocks; adding routes infers `workers_dev=false`; the gateway's host is the
charger endpoint. **Scope:** config parsing only. **Non-goals:** editing configs.
**Mutation:** none. **Acceptance:** fails a fixture with `routes` and no
`workers_dev`; passes the current web config; runs with no credential.
**Why:** prevents a fleet-wide outage caused by a diff that mentions nothing
about workers.dev.

### 5 · I-02 — disconnect the CPMS integration
**Evidence:** CPMS declares `hlada`/`hlada-staging` and documents auto-deploy;
it is private, so no public cross-check exists. **Deps:** A-12, I-04.
**Mutation:** ⚙️ **Approval:** 🔒 **Rollback:** reconnect.
**Stop condition:** if it is the **only** deploy path to `hlada-staging`, stop —
a Straumvakt path must exist first. **Acceptance:** no second repository can
deploy; I-03 confirms the Worker still serves.

### 6 · A-07 / L-11 — capture version ids
**Evidence:** no version id is recorded for any Worker anywhere.
**Acceptance:** three ids, each confirmed present in the retained list.
**Why:** without one, a release is a one-way door.

### 7 · D-06 — branch protection ruleset
**Evidence:** 0/16 protected, rulesets `[]`, public repo, `staging` serves the
brand domain. **Non-goals:** required checks on the pointers — they would block a
fast-forward. **Rollback:** delete the ruleset. **Acceptance:** force-push
rejected, fast-forward still works. **Effort:** S — cheapest high-value control.

### 8 · B-03 / B-04 — declare `workers_dev: true`
**Evidence:** neither the API nor gateway config declares it.
**Scope:** one line per environment block, in the same commit as any `routes`
addition. **Acceptance:** B-06/B-11 probes pass after deploy.

### 9 · A-08 — verify the Hyperdrive target
**Acceptance:** Hyperdrive host prefix matches Neon `staging`'s compute — **two
sources**. **Stop condition:** mismatch → do not deploy.

### 10 · F-02 / F-03 — backup, then rehearse on a fresh clone
**Non-goals:** using `test` (others reset it). **Acceptance:** Q1 3→0, Q4 0→2,
Q5 45→47 on the clone. **Why:** converts "the file says idempotent" into
"we ran it".

### 11 · F-05 — reconcile via `deploy`, not `resolve`
**Gate:** Q2 must return 0 dependent columns. **Non-goals:** `resolve --applied`
— it records a falsehood and strands three enum types.

### 12 · C-03 — `web → API` service binding
**Evidence:** the only Worker-to-Worker path without one; depends on
Custom-Domain status. **Acceptance:** web reaches API with no public egress.

### 13 · K-11 — prune build output
**Evidence:** 41.57 GB of 43.76 GB is regenerable. **Deps:** K-10 (junctions
first). **Rollback:** `npm install` / `flutter pub get`.
**Acceptance:** reclaimed; a build still succeeds.

### 14 · K-10 — remove junctions correctly
**Commands:** `cmd /c rmdir <junction>` — **never** `Remove-Item -Recurse`.
**Acceptance:** five removed, every target intact.

### 15 · E-03 / E-04 — Neon default repoint and protection
**Evidence:** the abandoned branch is default and unprotected; it was reached by
a call omitting a branch id. **Deps:** E-02. **Acceptance:** an accidental
unqualified connection fails loudly.

### 16 · E-06 — document the 7-day PITR ceiling
**Acceptance:** every rollback plan states it; backups treated as the only
long-horizon mechanism.

### 17 · K-03 — commit the OCPP specifications
**Evidence:** 128 untracked files; re-download requires an OCA account.
**Acceptance:** tracked and pushed to a branch.

### 18 · K-08 — back up the prompt/evidence folder
**Evidence:** `Documents\New project` drives the programme and is unversioned.
**Acceptance:** copied into the repo or a backup location.

### 19 · G-01 / G-02 — beta domains, additive
**Deps:** I-02 (do not add domains while a second repo can deploy), B-03.
**Acceptance:** beta serves on its own name; brand hash unchanged; pinned host
still serves.

### 20 · H-11 — verify production reads the production database
**Method:** write a uniquely named marker in beta; confirm it is **absent** in
production. **Why:** the failure is silent and looks entirely healthy.

### 21 · J-05 — post-cutover body-hash comparison
**Why:** the site loading proves nothing; only a hash comparison distinguishes
production from beta.

### 22 · L-05 — alert on a version change with no manifest
**Why:** the cleanest detective control for a rogue or CPMS deploy — a legitimate
deploy always has a manifest.

### 23 · F-01 — Tier-0 migration lint
**Why:** a lint rejecting `DROP` without `IF EXISTS` would have made the whole
reconciliation unnecessary, and needs no credential.

### 24 · B-09 — configurable mobile base URL
**Why:** the only durable fix for the pinned-host constraint.

### 25 · N-02 — first real charge with an independent cost check
**Why:** most informative test available; needs no new code; the only test that
catches a unit error.

### 26 · A-13 — test route omission on throwaway resources
**Non-goals:** testing on the brand domain. **Acceptance:** the empty-route-set
behaviour is recorded.

### 27 · A-14 — revoke the verification token
**Why:** a verification credential should not outlive the verification.

### 28 · H-06 — distinct `OCPP_CRED_KEK`
**Why:** a shared KEK makes a beta compromise a **production charger** compromise.

### 29 · D-04 / D-05 — create `main`, repoint the default
**Non-goals:** renaming anything — a rename breaks tracking for ~28 worktrees at
once.

### 30 · M-07 — remove `check:work-view`
**Scope:** one line plus its now-misleading comment. **Non-goals:** deleting the
generator.

### 31 · I-06 — archive, do not delete, CPMS
**Deps:** I-02 first — archiving does not disable a Cloudflare-side integration.

### 32 · K-12 — retire the six zero-unique worktrees
**Evidence:** zero unique commits vs the RC. **Acceptance:** branches survive.

### 33 · G-05 — flag beta orgs as test tenants
**Why:** makes beta data purgeable and keeps real customers out by construction.

### 34 · N-05 — invite binding on all three paths
**Why:** enforced on two of three is not enforced.

### 35 · L-02 — queue and DLQ alerts
**Evidence:** a degraded consumer accumulates ~118k messages in an hour silently.

### 36 · E-08 — create the production Neon project
**Why:** a wrong `branchId` already reached the abandoned branch once.

### 37 · H-09 — disable `workers_dev` on production
**Why:** production should not be reachable by an incidental hostname.

### 38 · F-09 / N-08 — measure restore time
**Why:** until measured, every RTO in every runbook is a guess.

### 39 · C-01 — confirm the API is a Custom Domain
**Why:** the web→API path silently depends on it.

### 40 · K-06 — inspect `_to_delete/`
**Why:** a folder named for deletion is exactly where something important is lost.

### 41 · D-09 — advance `staging`
**Deps:** A-06. **Note:** if an integration is connected, this **is** a deploy.

### 42 · B-07 / L-07 — alert on a workers.dev 1042
**Why:** turns the foot-gun into a detected event rather than a support ticket.

### 43 · M-08 — minimum-safe-version per Worker
**Why:** prevents an incident rollback restoring a fixed vulnerability.

### 44 · J-08 — confirm the fleet is unaffected by a web cutover
**Why:** chargers connect to neither web nor API; verifying it makes the claim
evidence rather than reasoning.

### 45 · K-14 — peer confirmation before retiring their worktrees
**Why:** two Codex trees are dirty right now; retiring one would destroy
uncommitted work.

---

## Critical path

```
K-01 (preserve) ─┐
D-01/D-02 ───────┼─► A-04 → A-06 → I-02 → G-01/G-02 → N-02
A-08 ────────────┘        └─► F-02 → F-03 → F-05 → F-07
```

**K-01 and D-01/D-02 gate nothing and can start immediately** — which is exactly
why they should. Everything else waits on one 30-minute dashboard session.
