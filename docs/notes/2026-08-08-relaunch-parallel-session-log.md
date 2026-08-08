# 2026-08-08 — Relaunch + security hygiene: parallel-session log

Status: living document. Updated as each round of parallel Claude Code windows reports
back. Nothing described here has been pushed, merged, deployed, or applied to a live
database unless a line explicitly says so.

## Why this exists

One evening's work grew from a single invite-redemption security fix (ADR 0053) into a
full straumvakt.org relaunch, a secret-hygiene pass, and — once the relaunch surfaced a
dead middleware file — a live infrastructure audit that found a real cross-product
Cloudflare Worker collision and a false-green database migration check. All of it ran as
short, well-scoped prompts handed to separate Claude Code sessions in parallel, each on an
isolated git worktree. This document is the thread connecting those rounds so the shape of
the whole effort survives past any one conversation.

**Standing rules across every round:** read-only or local-commit-only unless a step says
otherwise; never push; never open/merge a PR; never deploy; never run a mutating database
command; always isolate to a fresh `git worktree add`, never the shared main checkout.

---

## Round 1 — ADR 0053 fix, verified, plus the straumvakt.org relaunch (4 windows)

**Starting point:** `apps/api/src/routes/public/driver.ts` already had the ADR 0053 fix
(identity-bound invite redemption) committed as `3403fa8`, plus the ADR doc (`701b4f0`) and
a first draft of the real-DB test suite (`d56ef0e`) — all on `dev/housekeeping`. Separately,
a live weak-credential incident (`admin`/`admin01`) had been found and the secrets rotated
on both `hlada-staging` and `hlada-api-staging`.

**The four assignments:**

| Window | Task | Branch |
|---|---|---|
| 1 | Blank the committed `AUTH_SECRET` in `.env.example` | `dev/secret-hygiene` → `dev/secret-hygiene-v2` |
| 2 | Fix + merge the ADR 0053 parity test suite; later, reconcile the relaunch branches | `dev/housekeeping`, `dev/relaunch-integration` |
| 3 | Build the Straumvakt-employee landing page (`/staff`) | `dev/employee-landing` |
| 4 | Build the reusable per-org landing template, N1 as first tenant (`/org`) | `dev/n1-org-landing` |

**What went wrong and got caught:**
- Windows 2 and 3 ended up sharing the main working tree instead of isolated worktrees
  (self-reported by both, confirmed via `git worktree list`) — resolved by moving everyone
  to dedicated `git worktree add` checkouts.
- Window 1's first branch was accidentally forked from `f0eecb2` (Window 3's unrelated
  `/staff` commit) instead of a real trunk. Corrected twice: first re-based onto
  `origin/staging`, then a cherry-pick conflict revealed `origin/staging`'s `.env.example`
  *also* had the literal incident credentials (`ADMIN_EMAIL=admin` /
  `ADMIN_PASSWORD=admin01`) still committed — blanked all three values, not just
  `AUTH_SECRET`. Final: `dev/secret-hygiene-v2` @ `174475f`.
- The relaunch surfaced that `middleware.ts` lives at the repo root, but Next.js 16 only
  executes it from `src/middleware.ts` when a `src/` directory exists (it does) — meaning
  none of the relaunch's auth gating had ever actually run. Root-caused precisely (Next's
  build computes `rootDir` from `appDir`'s parent), fixed via `git mv`, and proven live for
  6 distinct routing cases after relocation.
- Window 4 found and fixed a real bug during its own verification: `/org` couldn't tell "no
  session" from "wrong persona" and sent unauthenticated visitors to `/home` instead of the
  login page — fixed before merge, not after.

**Outcome:** all four branches independently verified (commit hashes and diffs checked
directly against the repo, not taken only on report). `dev/employee-landing` and
`dev/n1-org-landing` merged cleanly (zero textual conflicts — the two never touch the same
file) into `dev/relaunch-integration` @ `14c1ce2`, which includes the `middleware.ts` →
`src/middleware.ts` relocation as its own standalone commit. `dev/housekeeping` @ `185e6da`
carries the fixed, fully green (107/107) ADR 0053 parity suite.

---

## Round 2 — Live infrastructure status (GitHub, Cloudflare, Neon)

Both this session's cloud sandbox and the Windows device bridge turned out to have
restricted network egress (proxy 403s to github.com, api.cloudflare.com, npmjs.org,
neon.tech, and even a LAN address) — a separate local Claude Code session with real network
access ran the actual check. Findings:

- **GitHub:** all 8 working branches confirmed absent from origin, as expected. 0 open PRs.
  The `check` workflow's latest run is failing, and had 11 straight failures on
  `dev/p4-c-ingest-integrity` earlier in the week. `staging`'s tip is ~8 weeks old.
- **Cloudflare:** both staging Workers deployed the same day (secret rotation). Production
  console `hlada` hasn't deployed in 3.5 months; production API `hlada-api` doesn't exist.
  Credential rotation verified live (`admin`/`admin01` → `401`).
- **Neon:** project healthy; the branch named `production` is a 37 MB near-idle stub while
  all real data lives on the branch named `staging`.

---

## Round 3 — Two parallel diagnoses: CI failure, and the staging deploy gap

**PROMPT A (CI):** the `check` failure and the 11-run `dev/p4-c-ingest-integrity` streak
share one root cause — `docs/reference/api-endpoints.md` was stale from the moment it was
introduced (commit `09b1333`), not flaky, not caused by the commit that surfaced it. Fix
verified locally (8/8 checks green), sitting unpushed on `diag/fix-api-endpoints-drift` @
`0a2943c`. Side finding: the regenerated doc shows the mobile app no longer calls two driver
endpoints (invoices, session history) — a product question, left alone on purpose.

**PROMPT B (deploy gap):** no real git trunk exists — `origin/HEAD` points at a stale
placeholder branch. The actual frontier, `dev/drizzle-ownership-and-market-harvest`, is 140
commits ahead of `staging` (the branch Cloudflare deploys from), and is a strict descendant
(clean fast-forward, no conflicts possible). That gap carries real weight: 16 migrations (2
destructive, 32 `DROP TABLE`s), a Prisma schema restructuring, Drizzle added as a second ORM,
a workspace split, 5 deleted API routes, and a `wrangler.jsonc` change binding
`straumvakt.org`/`www` as custom domains that hasn't reached the deploy branch. All 8 of
tonight's relaunch/hygiene branches queue on top of this frontier, unpushed.

On Neon: `staging` is literally a fork of `production`, taken right after production's first
migration. Production is frozen at migration 2 of 51 (the abandoned CPMS-era schema, ~0 real
rows) — already documented as abandoned in ADR 0025 and two dated notes, so this confirmed
existing history rather than surfacing something new. Also found, unprompted: `staging`'s
actual database has drifted from its own recorded migration history (two destructive drops
applied but unrecorded), and 6 rolled-back May migration entries (later confirmed inert).

---

## Round 4 — Two parallel resolutions: the hlada collision, and the migration drift

**PROMPT C (hlada):** **CONFIRMED**, not just possible. Cloudflare Worker names are unique
per account; account `1b2fc4c1…` has exactly one `hlada`, targeted both by CPMS's live git
integration (a different repo, `andri187/CPMS`) and by Straumvakt's own `wrangler.jsonc`.
Currently latent only because Straumvakt has never actually deployed to production (every
real deploy has hit `hlada-staging`; `hlada` itself hasn't moved since the CPMS era, 2026-04-23).
**Proposed, not applied:** rename Straumvakt's production `name` to `straumvakt-console`
(verified unregistered) — zero migration cost since nothing has ever deployed under the old
name. `hlada-staging` is untouched by this; it's live today and stays as-is.

**PROMPT D (migration drift):** the drift has a root cause underneath the root cause.
`prisma.config.ts` never sets `migrations.path`, so under Prisma 7.8 the CLI sees **zero**
migrations on disk — `migrate status` reports "up to date" (exit 0) regardless of reality.
That's why the drift went unnoticed, and it means `migrate deploy` currently no-ops
silently for *any* future migration, not just these two. Corrected understanding of the two
migrations: `drop_never_used_tables` is fully and correctly applied; `drop_issues_scaffold`'s
table drops were moot (another migration got there first) but its 3 `DROP TYPE` statements
genuinely never ran — its "not applied" header is technically still accurate, just easy to
misread now. How it happened: ruled out `migrate deploy`, CI, and repo scripts directly;
someone ran the SQL by hand (exact channel not determinable after the fact). The 6
rolled-back May entries are confirmed inert. **Proposed, not run:** fix the config (pure
code, zero DB risk), fix the misleading header before anything is marked applied, then a
plain `migrate deploy` safely finishes the job since both files are fully idempotent
(`IF EXISTS` throughout).

---

## Round 5 — In flight: preparing both fixes (no live/consequential step)

**PROMPT E:** prepare the `hlada` → `straumvakt-console` rename as a local, unpushed commit.
No `wrangler deploy`, no live Cloudflare change of any kind.

**PROMPT F:** prepare the `prisma.config.ts` `migrations.path` fix and the corrected
migration header as a local, unpushed commit, verified via a **read-only** `migrate status`
re-run (should report 47 migrations found, the two known ones pending). No `migrate deploy`,
no `migrate resolve`, no DDL against any Neon branch.

**PROMPT E — done.** One-line fix, committed and verified: root `wrangler.jsonc`'s
production `name` changed from `hlada` to `straumvakt-console` on `dev/rename-prod-worker`
@ `4fe0a95` (worktree `Straumvakt-rename-worker`), not pushed. Re-verified the new name is
still unregistered right before committing. Repo-wide grep confirmed nothing else needs to
change for this to be safe — no service binding, CI reference, or route targets the old
name. Deliberately left unfixed, to keep the commit minimal and not pre-announce an
unaccepted rename: 3 hardcoded `hlada.straumvakt.workers.dev` URLs in code (2 CORS
allowlist entries, 1 email footer) and 2 docs (`CLAUDE.md`, `README.md`) describing the old
`master → hlada` mapping. Follow-up once the rename is accepted.

**PROMPT F — done.** Correction worth recording: the prompt specified basing off
`origin/staging`, but the bug doesn't exist there — `prisma.config.ts` on `staging` still
points at a single `schema.prisma` file, so migrations resolve fine. The defect arrived
with the schema-folder restructure inside the 140-commit gap, so the fix is correctly based
on the frontier (`dev/drizzle-ownership-and-market-harvest`) instead. Committed as
`fix/prisma-migrations-path` @ `6b9246e` (worktree `Straumvakt-migrations-config`), not
pushed. Diff: `prisma.config.ts` gains `migrations.path` (field/shape confirmed against the
installed `@prisma/config` 7.8.0 types, not guessed); the `drop_issues_scaffold` header is
rewritten to state the true split (its 3 `DROP TABLE`s are moot — already done by the other
migration — but its 3 `DROP TYPE`s are genuinely still outstanding, staging-only); SQL
bodies verified byte-identical. Proof: `migrate status` flips from a false "up to date"
(exit 0) to correctly reporting both migrations pending (exit 1) — matches the earlier
probe exactly, and the real `check:migrations` guard command confirms the same. CI wiring
was deliberately left undone: no `DATABASE_URL` secret exists today, and `check.yml` runs on
every branch/PR push, so adding one is a real decision, not a default — documented as a
ready-to-apply snippet with the order (reconcile the two drops → decide the secret → wire it
in). Confirmed after the fact that staging's actual database is unchanged (51 rows, 0 drop
migrations recorded, same newest migration, all 3 issues enum types still present).

---

**PROMPT H — done.** Checked `test` (br-withered-hat-abtc5gzi) with the config fix applied:
same false-status symptom as staging, different real cause. On `test`, both migrations are
fully applied with neither recorded in history — a pure history gap. On `staging`, one is
fully applied and the other only half (its `DROP TYPE`s never ran) — a history gap *and* a
schema gap. Recommendation: don't reconcile `test` directly (it resets periodically anyway);
fix `staging` first, then reset `test` from it — order matters, since resetting first would
have `test` inherit the orphaned enum types. Wrote a full 364-line runbook,
`docs/notes/2026-08-08-staging-catchup-runbook.md`, committed as `docs/staging-catchup-runbook`
@ `30fa407` (based on `fix/prisma-migrations-path`) — six steps (Neon backup, config fix,
migration reconciliation, test reset, git fast-forward, deploy), each with its own
verification and rollback. Notable findings inside it: the currently-deployed June code
references none of the 32 dropped tables (so the DB-ahead-of-deploy gap is bookkeeping, not
live breakage); whether Cloudflare's git integration treats the `staging` push itself as the
deploy trigger isn't determinable from the repo, so the runbook says check the dashboard
first rather than assume; and `docs/operator/STRAUMVAKT_ORG_CUSTOM_DOMAIN_TODO.md` is now
stale against the actual `custom_domain: true` implementation. Nothing mutated, nothing
pushed.

**Note on session continuity:** a VSCode crash interrupted the Claude Code session doing
Cloudflare/CI-flavored work partway through Prompt G. On restart it re-verified state but
checked the OLDEST worktree (`Straumvakt-secret-hygiene`, branch `dev/secret-hygiene` @
`776552f`) rather than the current one — that branch is superseded by
`dev/secret-hygiene-v2` @ `174475f` and was already accounted for. Prompt G (the
check-pipeline integrity audit) itself was never confirmed complete before or after the
crash and is being reissued in full below rather than assumed resumable.

## Current branch inventory

| Branch | Base | Tip | Status |
|---|---|---|---|
| `dev/secret-hygiene-v2` | `origin/staging` @ f53fb55 | `174475f` | Ready — awaiting push decision |
| `dev/housekeeping` | trunk lineage | `185e6da` | Ready — ADR 0053 parity suite, 107/107 |
| `dev/employee-landing` | `dev/straumvakt-org-relaunch` @ 10c292b | `9a6c6f5` | Merged into integration |
| `dev/n1-org-landing` | `dev/straumvakt-org-relaunch` @ 10c292b | `52e3b32` | Merged into integration |
| `dev/relaunch-integration` | `dev/straumvakt-org-relaunch` @ 10c292b | `14c1ce2` | Ready — middleware live, 6/6 runtime cases proven |
| `diag/fix-api-endpoints-drift` | `dev/drizzle-ownership-and-market-harvest` @ 2b7ebf6 | `0a2943c` | Ready — verified, unpushed |
| `dev/rename-prod-worker` | `origin/staging` @ f53fb55 | `4fe0a95` | Ready — hlada rename, verified, unpushed |
| `docs/relaunch-session-log-2026-08-08` | `origin/staging` @ f53fb55 | `131e800` | This document, unpushed |
| `fix/prisma-migrations-path` | `dev/drizzle-ownership-and-market-harvest` | `6b9246e` | Ready — migrate-status fix, verified, unpushed |
| `docs/staging-catchup-runbook` | `fix/prisma-migrations-path` | `30fa407` | Planning doc, unpushed |

None of the above exist on `origin`.

## Product surfaces (what the relaunch actually built)

- **Staff UI** (`/staff`, `/staff/overview`) — built, self-reviewed, tsc/build clean.
- **Org UI** (`/org`, `/org/[slug]`, `/org/[slug]/profile`) — built as a reusable template,
  N1 ehf as first tenant with real data verified, tenant isolation proven session-derived.
- **Driver UI** — intentionally not web. Moves to the existing mobile app by design; the old
  web portal is parked (not deleted) at `archive/straumvakt-org-console-2026-08-08/app/driver/`.
- No screenshots captured yet — everything verified via routing behavior and real data, not
  visually.

## Decisions waiting on Thor

1. **Push / PR authorization** for any of the branches above.
2. **`hlada` rename** — apply the prepared config change, and separately decide whether/when
   to actually stand up a real Straumvakt production deploy.
3. **Neon migration reconciliation** — apply the prepared config fix, then decide whether to
   run the proposed `migrate deploy` against live `staging` (idempotent, but touches the
   database holding all real data — a Neon branch backup first is recommended).
4. **Live `AUTH_SECRET` rotation** — the committed value is confirmed not live; rotating
   anyway is optional belt-and-braces, not required, and invalidates active sessions.
5. **`middleware.ts` → `proxy.ts`** — Next 16.2 has deprecated the "middleware" file
   convention; works today, non-urgent.
6. **Bringing git `staging` current** — mechanically a clean fast-forward from
   `dev/drizzle-ownership-and-market-harvest`, but carries the migrations/ORM/route changes
   described in Round 3; recommended sequencing is in that round's notes.
7. **Neon naming** — `production` (abandoned CPMS stub) is still Neon's default/primary
   branch; `staging` (all real data) is unprotected. Renaming/re-flagging is Thor's call.
8. **CI failure fix** (`diag/fix-api-endpoints-drift`) and the underlying product question
   (should mobile still call the two dropped driver endpoints?).

## Direction set / decisions made (2026-08-08, responding to the queue above)

- **Prisma → Drizzle, confirmed direction.** Consistent with ADR 0051 ("Drizzle owns the
  schema") and FOCUS.md's "touch it, convert it" rule — not a new departure. `fix/prisma-
  migrations-path` still ships regardless: Prisma is what's live until the migration
  completes, and the false-green bug it fixes would otherwise keep hiding drift for however
  long that takes.
- **Live AUTH_SECRET rotation — recommended.** Standard posture: any secret ever committed
  to source control is treated as permanently compromised regardless of what current testing
  shows. Cost is low (forces re-login, no data risk) — bundle it into the same release window
  as the other fixes rather than as a surprise on its own.
- **Push/PR plan — suggested, not yet actioned.** Ship now against `origin/staging`:
  `dev/secret-hygiene-v2`, `docs/relaunch-session-log-2026-08-08`. Target the frontier
  (`dev/drizzle-ownership-and-market-harvest`) instead of `staging` for everything based near
  it — `diag/fix-api-endpoints-drift`, `fix/prisma-migrations-path`, `dev/housekeeping`, and
  eventually `dev/relaunch-integration` — since a PR against stale `staging` would show the
  entire 140-commit gap as part of the diff. Hold `dev/rename-prod-worker` pending the hlada
  delete-vs-rename question below. No need to push `dev/employee-landing`/`dev/n1-org-landing`
  individually — `dev/relaunch-integration` supersedes both.
- **`hlada`: investigate delete vs. rename — queued, not yet dispatched.** Open question:
  is CPMS's `hlada` Worker genuinely abandoned (safe to delete) or just stable-and-quiet
  (still live, don't touch)? Deploy history alone can't distinguish those. Needs real traffic/
  request-volume data, current route/custom-domain bindings, and ideally a signal on whether
  the CPMS repo itself is still active. Next task for Window 1 once its current work (Prompt G)
  is done.
- **`middleware.ts` → `proxy.ts`** and **multi-org membership path** — both informational
  only, no decision pending. First is a low-priority rename-and-verify once convenient
  (nothing broken today). Second has no action until a real account actually has more than
  one host_admin org membership — that's the trigger for testing it live.

## Round 4 — four longer, deeper prompts: CI integrity, doc corrections, mobile gap, trunk proposal

**Window 1, Part 1 (hlada delete-vs-rename):** re-verified `dev/secret-hygiene-v2` and
`dev/rename-prod-worker` untouched, then settled the question with real Cloudflare evidence
instead of inference — last deploy 2026-04-23, `workers.dev` disabled, zero custom domains, zero
routes, 1 request in 30 days, and CPMS's own docs say "do not modify without intent."
**Recommendation: rename now, don't delete.** An idle Worker with no routes costs nothing;
deletion would be irreversible and destroy `hlada`'s secrets and its Cloudflare↔`andri187/CPMS`
Git integration. The one thing still unresolved: whether the CPMS codebase itself is genuinely
retired — that needs a look at that repo directly, out of scope for this round.

**Window 1, Part 2 (check-pipeline integrity, reissued after the crash):** enumerated all 8
`check:*` gates and fool-tested each with injected drift in an isolated worktree (introduced,
confirmed caught, reverted). Three caught real drift live (`api-schema`, `schema-consistency`,
`unused-exports`); `api-endpoints` is mechanically sound but currently red on the already-known
bug. Three new blind spots found: **(A)** `check:work-view` was written to gate CI but never
wired into `check-all.mjs` — nothing ever ran it. Fixed, verified currently green, ready to merge
(`fix/wire-work-view-check` @ `b2250e5`). **(B)** `typecheck` silently skips
`@straumvakt/shared`/`commercial`/`contracts` — no per-package `typecheck` script means
`--if-present` swallows the gap; demonstrated live. Flagged as real work (needs a tsconfig + script
per package, may surface a backlog of errors), not fixed. **(C)** `check:schema-consistency` has a
latent vacuous-pass if both parsers ever match zero tables at once — low likelihood, not fixed.

**Window 2, Part 1 (custom-domain doc):** found the doc's premise was wrong, not just stale —
`straumvakt.org` and `www` are **already live** on Cloudflare Custom Domains with valid certs
(issued 07-31/08-04), predating the commit that says "does NOT yet resolve." Rewrote with a
corrections table (old advice — `routes`+`zone_name` — would actively break the live site) and a
rollback section. Flagged, not fixed: the staging-catchup runbook's own Step 6 inherits the same
wrong premise.

**Window 2, Part 2 (`check:migrations` credential):** recommended a two-tier plan after actively
ruling out two tempting shortcuts — a Neon-console-created role (grants `neon_superuser`
automatically, worse than the status quo) and `pull_request_target` (exposes secrets to fork PRs
per GitHub's own warning). Also ruled out pointing the check at Neon's `test` branch — migrations
land there first, so it would have gone falsely green on 08-07. Tier 0: an offline
path-exists guard, no credential, runs today. Tier 1: a SQL-created `ci_migrate_status` role,
`CONNECT` + read-only on migration history, via a GitHub Environment secret.

**Window 2, Part 3 (re-verification):** caught its own earlier mistake — the first pass guessed
camelCase model names and got 7 wrong. Redone with three real search methods against the schema
that actually shipped; conclusion unchanged (35 of 38 drop statements are no-ops, 3 `DROP TYPE`s
are the only real DDL) but now soundly evidenced.

**Window 3 (driver UI / mobile investigation — the big one):** two verdicts, both definitive.
*First:* the doc-generation tool is a plain regex substring match with real, demonstrated failure
modes (false positives — `sessions/:id` matched purely because mobile calls `sessions/current`,
a different endpoint the pattern also swallows; false negatives on any non-literal URL). *Second,*
using that understanding: `git log -S` across mobile's entire history for `api/driver/invoices`
and `api/driver/sessions/history` returns **zero hits, ever** — the doc was wrong every time it
was generated, not regressed. Both features are explicit "Soon" stubs in the mobile menu (Phase 2 /
Phase 4). Nothing to fix. The real finding: mobile's invite-acceptance flow calls the *org*-invite
endpoint (ADR 0026 `consume`), never `redeem-invite`/`claim-invite` (ADR 0028/0053) — the
driver-group invite flow ADR 0053 secured has **no caller anywhere now that web is parked**. Full
driver-UI capability inventory produced (works today: sign-in, chargers, sessions, tap-intent, BLE
settings, language; stubbed: 9 of 11 menu items). One loose end flagged, not acted on: untracked
`charge_history.dart`/`my_vehicle.dart`/`profile.dart` files spotted in the shared checkout,
uncommitted anywhere — possible in-progress work worth checking on rather than duplicating.

**Window 4 (trunk & branch protection proposal):** triple-verified (ahead-count, ancestor check,
`git cherry`) that all 15 non-frontier branches are strict ancestors of the frontier — 12 safe to
delete outright, 3 must stay (`dev/sprint-00-foundation` is GitHub's default branch, `staging` is
the deploy pointer, `dev/p4-c-ingest-integrity` is warm). Recommends creating `main` **additively**
at the frontier rather than renaming — a rename would break 15 live worktrees and the runbook's own
refspec instantly. Confirmed **zero branch protection exists anywhere** on this public repo — no
force-push or delete guard on `staging` today. Proposed two-phase protection (no-cost guard now,
required status check on `main` once CI is green).

**tl;dr for this round:** hlada question closed (rename, not delete); one more safe CI fix ready
(`fix/wire-work-view-check`); two doc corrections landed (custom-domain, migrations-credential
plan); the mobile driver-UI question is now fully resolved with hard evidence — no regression
anywhere, but a real, confirmed gap (driver-group invites have no client) that needs a product
call; and the repo has no branch protection at all, which costs nothing to start fixing. A
standalone handoff document for the mobile-UI gap was written and delivered separately
(`docs/notes/2026-08-08-mobile-driver-ui-handoff.md`), then revised once Window 3's findings
resolved its two original open questions.

## What has NOT happened, anywhere, at any point in this process

No branch pushed to `origin`. No PR opened, merged, or closed. No `wrangler deploy` run for
any environment. No secret rotated on a live Worker beyond the original incident response.
No Neon branch created, deleted, reset, or archived. No migration-mutating command
(`migrate deploy`, `migrate resolve`, `db push`, raw DDL) run against any Neon branch during
any of this investigation. No file in the actual repo modified outside a session's own
isolated worktree.
