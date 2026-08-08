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

## What has NOT happened, anywhere, at any point in this process

No branch pushed to `origin`. No PR opened, merged, or closed. No `wrangler deploy` run for
any environment. No secret rotated on a live Worker beyond the original incident response.
No Neon branch created, deleted, reset, or archived. No migration-mutating command
(`migrate deploy`, `migrate resolve`, `db push`, raw DDL) run against any Neon branch during
any of this investigation. No file in the actual repo modified outside a session's own
isolated worktree.
