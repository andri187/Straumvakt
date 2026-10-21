---
agent: claude-b
lane: production-definition-and-environment-path
status: complete
prompt: docs/agent-prompts/2026-08-18/2026-08-18-1540-claude-b-production-definition-and-environment-path.md
follows: 2026-08-18/2026-08-18-1415-claude-b-market-rails-invoice-delivery-and-collection.md
start_utc: 2026-08-18T15:42:59Z
end_utc: 2026-08-18T16:15:44Z
wall_clock: 32m45s
target_wall_clock: none — deliverable-gated
target_met: null
worktree: E:\Claude\Straumvakt-relops-b
external_mutation: none
---

# Claude B — completion: production definition and the environment path

## TL;DR

1. **Production already exists. It is called staging.** All three public
   hostnames serve traffic and all three are bound to `-staging` Workers.
2. **S0 is `ws.straumvakt.org` → `straumvakt-ocpp-staging`, proven**, not
   inferred. Top-level `straumvakt-ocpp` is unreachable and served zero
   requests in 25 s.
3. **Take option (a).** It is the only option whose first step does not touch
   21 live WebSockets. Option (c) should be struck entirely.
4. **The "one-way door" premise is wrong** — Cloudflare has been recording
   every version all along; rollback works today.
5. **26 of 26 gates met, all 7 fallback items worked, A's CR-1 serviced.**
   `npm run check` all 13 green, 888 + 176 tests.

---

## Timing

| | |
|---|---|
| Start | `2026-08-18T15:42:59Z` |
| End | `2026-08-18T16:15:44Z` |
| Wall clock | **32 m 45 s** |
| Target | none — deliverable-gated |
| Target met | `null` |

---

## State

| | Start | End |
|---|---|---|
| Branch | `scratch/claude-b-release-ops-2026-08-10` | unchanged |
| Tip | `608749f` | **`a81860b`** |
| Dirty | 0 | **0** |
| `git diff --shortstat` | empty | empty |
| `git diff -w --shortstat` | empty | empty |
| `dev/market-rails` | `608749f` | **`a81860b`** (local only, never pushed) |

**Diff across the run:** 21 files changed, +2881 / −7.

**Phase 0 baseline, before any edit:** `npm run check` **all 12 passed**;
vitest root **846 passed / 1 skipped**; gateway **157 passed**;
`node_modules` still present; `wrangler` still authenticated.

**Contract-change requests at Phase 0:** the file was **absent from my
worktree** and recorded as such — **but A had filed it on their own branch**,
`dev/core-billing-integration`. Found later in the run and **serviced in
full** (below). The dispatch's instruction pointed at my worktree; the file
only ever existed in A's. Worth fixing in the protocol: a cross-lane request
needs a location both lanes can see before a merge.

---

## Commits — 3 slices

| SHA | Slice |
|---|---|
| `5a65fee` | S0 closed, live hostnames declared, binding-existence + version-id gates |
| `28cdbf8` | Track B tasks 9/10/11 plans, 6 fool-tests for the new gates |
| `a81860b` | kennitala capture, A's CR-1 serviced, round-2 release-ops queue |

---

## The finding that reframed the round

The dispatch's §2 states: *"`straumvakt-ocpp` at top level is the gateway the
21 chargers are connected to right now."* **It is not.**

| Hostname | Serves | Worker | In any config before this run? |
|---|---|---|---|
| `straumvakt.org` / `www` | console | `hlada-staging` | yes |
| `api.straumvakt.org` | API | **`hlada-api-staging`** | **no** |
| **`ws.straumvakt.org`** | gateway, **S0** | **`straumvakt-ocpp-staging`** | **no** |
| `straumvakt-ocpp.straumvakt.workers.dev` | — | top-level | 404 / error 1042 |
| `hlada.straumvakt.workers.dev` | — | top-level | 404 / error 1042 |

**How it was proven, not inferred.** `wrangler tail straumvakt-ocpp-staging`
was left connected while `https://ws.straumvakt.org/health?probe=claudeb1` was
requested; the probe appeared in that Worker's tail with the exact query
string. Same method for `api.straumvakt.org` → `hlada-api-staging`. The
negative case used the identical invocation: top-level `straumvakt-ocpp`
connected and produced **zero events in 25 s** while the staging gateway
produced live `/dispatch` traffic within seconds.

**Three consequences:**

1. S0 attaches to a Worker whose name ends in `-staging`.
2. **There is no safe place to test.** `wrangler deploy --env staging` on the
   gateway *is* the production deploy.
3. Two of three production hostnames were in no committed config at all.

My own 14:15 artifact recorded this as **not closed** and said an empty
30-second tail proves nothing. That was right; it is now closed by a positive
observation. ADR 0035:390 had it correct all along and was overtaken by
assumption.

---

## Gates — 26 of 26

| # | Gate | Result |
|---|---|---|
| 1 | A's change request serviced or absence recorded | ✅ **absence recorded at Phase 0, then found on A's branch and serviced** |
| 2 | Production packet, seven sections | ✅ `2026-08-18-what-production-means.md` |
| 3 | S0 / 21-charger row first in each option | ✅ first row of all three tables |
| 4 | Account mutations named, ordered, irreversibility marked | ✅ |
| 5 | Cost per option with assumptions | ✅ |
| 6 | Rollback per option per step | ✅ |
| 7 | Reversibility split | ✅ naming is in the permanent column, stated |
| 8 | "True regardless" identified **and built** | ✅ 8 items, 5 finished this run |
| 9 | Ordered blocking questions | ✅ 4, only Q1 blocks anything |
| 10 | <200-word answer page | ✅ 191 words |
| 11 | Every claim basis-labelled | ✅ |
| 12 | Version-id contents, source, runtime read | ✅ `gateway/src/version.ts` |
| 13 | Deploy needed? answered; smallest safe deploy | ✅ yes; **the console, not the gateway** |
| 14 | Proven not to disturb chargers, or a stop point with a named abort | ✅ both — console deploy touches no WebSocket; the gateway step carries a numeric abort condition |
| 15 | Local half implemented with tests, nothing deployed | ✅ 19 tests |
| 16 | Gate that fails when a deployed env reports no version id | ✅ `check:version-id`, **fails against live today** |
| 17 | Runbook as a numbered checklist with stop points | ✅ 7 steps, 4 stop points |
| 18 | `MAIN_APP` decided per option; gated where it differs | ✅ **gated, not guessed** |
| 19 | `OCPP_WEBHOOK_SECRET` traced, unreachable, ordered deletion plan | ✅ **zero source references; consuming paths already deleted** |
| 20 | Binding-existence gate, offline, ≥4 fixtures | ✅ **15 fixtures** |
| 21 | Task 9 with cost precise enough to decide | ✅ ≈$3–10/mo vs ≈$40–45/mo |
| 22 | Task 10 as a written diff with S0 proven | ✅ four independent guarantees |
| 23 | Task 11 cross-referenced vs A's `0002`, no contradiction | ✅ four claims compared |
| 24 | Each plan states its option assumption | ✅ |
| 25 | ≥4 fool-tests | ✅ **7 this round** (6 gate + 1 kennitala), 16 in the lane total |
| 26 | Completion `.md` + `.json` | ✅ |

---

## Fallback queue — 7 of 7

1. ✅ **Host kennitala capture built** — `kennitala.ts`, 26 tests, storage
   contract and refusal list as asserted data. Handover target named.
2. ✅ **Local-green checklist executed** — items 1–3 green; **item 4 honestly
   blocked**: A's branch carries no generated invoice, so the validator still
   has not run against one.
3. ✅ **Observability red-gate decision record** — six of nine errors are about
   an environment serving no traffic; one (OB18) has customer impact.
4. ✅ **Neon production plan** — do nothing until the decision; the one useful
   action now is answering the point-in-time-restore question.
5. ✅ **`ADMIN_PASSWORD` runbook** — API-first, names only, not performed.
6. ✅ **`Straumvakt-core-security`** — 0 dirty, 0 ahead, 0 unmerged; retirable
   with no loss; **not retired**.
7. ✅ **Round-2 release checklist** superseding §7 of the round-1 note.

---

## A's CR-1 — serviced

A found a **latent defect** in my golden-file tests and the diagnosis was
correct in every particular, including the part that is easy to get wrong:
`core.autocrlf` converts **on checkout, not on write**. The tests passed here
only because this worktree *wrote* the goldens and never checked them out;
A's merge was their first checkout. **It would fail on any fresh Windows
clone and is not observable on the branch that created it.**

Reproduced before fixing: on-disk `CR:0 LF:15`, blob `CR:0 LF:15`, renderer LF.

**Fixed as A's option (1) but not option (2).** Normalising *both* sides would
have discarded a real guard — a renderer emitting CRLF is a content change and
must still fail. So the file side is normalised and two tests were added: one
asserting `renderHeaderText` emits no `\r` on any platform, and one proving
the comparison is newline-convention-independent. `header.test.ts` 21 → 23.

**Verified against the actual failure condition**, not reasoned about: the
goldens were rewritten on disk as CRLF, the suite re-run (23 passed), restored.

No `.gitattributes`. Response in
`docs/notes/2026-08-18-invoice-contract-change-responses.md` — a **separate
file** so it cannot conflict with A's on merge.

---

## Checks run

| Check | Result |
|---|---|
| `npm run check` | **all 13 passed** (was 12 — `bindings` added) |
| `npx vitest run` (root) | **888 passed, 1 skipped, 60/60 files** (baseline 846) |
| gateway vitest | **176 passed, 8/8** (baseline 157) |
| `tsc --noEmit` + workspaces + gateway | **0 errors** |
| `check:bindings --self-test` | **15 passed, 0 failed** |
| `check:version-id --self-test` | **12 passed, 0 failed** |
| `check:version-id --probe https://ws.straumvakt.org` | **FAIL, exit 1 — correct**, `/version` is undeployed |
| observability self-test | **83 passed, 0 failed** |
| observability vs tree | **9 errors, 3 warnings** — **down from 11**, the two resolved being the S0-adjacent OB19s |

---

## Important corrections to earlier assumptions

1. **The dispatch's §2 premise is wrong** — top-level `straumvakt-ocpp` is not
   the live charger gateway. It is unreachable and serves nobody.
2. **The "one-way door" claim is wrong.** Carried since 2026-08-11: *"no
   version id exists, so there is no rollback target."* The premise about the
   **binding** is right; the conclusion is not. `wrangler versions list`
   returns a full history for `straumvakt-ocpp-staging`, and the live
   deployment is `aaf5f724-…` with a prior at `a9c1438d-…`. **Rollback works
   today.** What is missing is runtime self-identification and a Sentry
   release id.
3. **Option (c), rename, is a trap and should be struck.** Changing `name` in
   a wrangler config deploys a *new* Worker and leaves the old one running —
   secrets do not follow, Durable Object namespaces do not follow. This is
   already why commit `4fe0a95` is on the RC exclusion list.
4. **The `-staging` suffix is a Worker name and no customer ever sees it.**
   Every public hostname is already `straumvakt.org`. That reframes the
   naming question from urgent to deferrable.
5. **The dead-code comment in `gateway/wrangler.jsonc` was stale.** It said
   the UI-side OCPP paths "get deleted in a follow-up commit". They already
   were — all three are absent and `OCPP_WEBHOOK_SECRET` appears in **no
   source file**. Only the secret survives, on the unreachable top-level
   `hlada`: a dead secret on a dead Worker.
6. **My own golden-file tests carried a latent cross-platform defect** — see
   CR-1. It passed here for a reason that guaranteed it would fail elsewhere.

---

## Findings

1. **There is no safe place to test.** The command that reads as "deploy to
   staging" is the production deploy. This makes Track B task 9 a correctness
   requirement, not developer convenience.
2. **Two of three production hostnames existed only in the dashboard.**
   Nothing in version control recorded they exist or would restore them.
   Both are now declared — **with `workers_dev: true` explicit**, because
   declaring `routes` without it infers `false` and would remove the
   workers.dev host on the next deploy, with chargers behind it.
3. **The fleet may be split across two hostnames.** Both `ws.straumvakt.org`
   and `straumvakt-ocpp-staging.straumvakt.workers.dev` serve the live
   gateway, and ADR 0035 records chargers configured against the latter.
   Until device configs are audited, **both must be preserved**.
4. **A different Worker script means a different Durable Object namespace** —
   so any cutover loses every charger's liveness, frame-cap and pending-command
   state. The `script_name` mitigation may exist and is blocking question Q2.
5. **`hlada-api` is claimed but absent** — a config file references a Worker
   name that has never been deployed. `check:bindings` exists so this class
   cannot recur silently.

---

## Files created and changed

**Created (docs):** `2026-08-18-what-production-means.md` ·
`2026-08-18-dead-paths-and-deploy-runbook.md` · `2026-08-18-track-b-plans.md` ·
`2026-08-18-release-ops-queue-round2.md` ·
`2026-08-18-invoice-contract-change-responses.md` ·
`docs/reference/cloudflare-account-snapshot.json`

**Created (code):** `gateway/src/version.ts` + test ·
`packages/contracts/src/invoice/kennitala.ts` + test ·
`scripts/analysis/bindings/check-bindings.mjs` ·
`scripts/analysis/release/check-version-id.mjs` ·
`scripts/analysis/release/gates.test.mjs`

**Changed:** `gateway/wrangler.jsonc` (routes + `workers_dev`, corrected
comments) · `apps/api/wrangler.jsonc` (routes + `workers_dev`) ·
`gateway/src/index.ts` (`/version`) · `scripts/check-all.mjs` · `package.json`
· `packages/contracts/package.json` · `packages/contracts/src/invoice/{index,header.test}.ts`

**Lane boundary respected.** Nothing under `packages/commercial/**`,
`apps/api/src/lib/billing/**`, `apps/api/drizzle/**` or
`apps/api/src/routes/public/driver.ts` was touched. A's worktree was read
only.

---

## External state confirmation

**No push. No deploy.** No DNS or domain binding. **No Cloudflare mutation —
every `wrangler` call was read-only**, by verb: `whoami`, `queues list`,
`r2 bucket list`, `deployments list`, `versions list`, `secret list`, `tail`.
No `deploy`, `publish`, `put`, `create`, `delete`, `rollback` or
`versions upload`. **No Neon mutation. No migration. No SQL against any
environment.** No GitHub remote mutation. No charger, OCPP, BLE, NFC or
hardware action. **No account registered, no form submitted, no application
filed, no third party contacted.** No branch or tag deleted; no worktree
retired; no file deleted or moved outside my own new files. No new top-level
folder under `E:\Claude`.

**Branches written to:** `scratch/claude-b-release-ops-2026-08-10` (lane) and
`dev/market-rails` (local integration, moved to `a81860b`). **Neither pushed.**

**Network:** unauthenticated HTTPS GETs to public hostnames
(`straumvakt.org`, `ws.straumvakt.org`, `api.straumvakt.org`, three
`workers.dev` hosts) for `/health` and `/version`. Read-only, no side effects.
Two probe requests carried a `?probe=` query string purely so they could be
identified in a tail.

**Secrets:** no token, key, DSN, password, connection string, kennitala or
bank account number was printed, logged, exported or committed. `secret list`
returns names only and only names appear in artifacts. **No real-looking
kennitala exists anywhere in the repository** — fixtures use impossible dates.

**No dependencies installed this round** (`node_modules` carried over). No
`prisma generate` needed.

---

## Cleanup candidates

- `E:\Claude\Straumvakt-core-security` — **0 dirty, 0 commits ahead, 0
  unmerged. Holds no unique work; retirable with no loss. NOT retired.**
- `node_modules` and `src/generated/prisma` in this worktree — gitignored,
  carried from round 1.

---

## Exact next human actions

1. **Answer Q1: does anything outside engineering inspect infrastructure
   resource names?** One question. If no → take option (a) and the production
   question is closed.
2. **Do not rename anything** until Q2 is proven in a lower environment —
   a cutover currently loses every charger's Durable Object state.
3. **Audit the 21 chargers' device configs** to learn which hostname each
   uses. Until then both must be preserved, which constrains every deploy.
4. **Write down the three current version ids.** Sixty seconds, and it is the
   whole safety net — the rollback capability already exists.
5. **Create the dev tier (task 9).** There is currently nowhere to test.
6. **Answer the Neon point-in-time-restore question** — it is what makes A's
   `0002` rollback window real.
