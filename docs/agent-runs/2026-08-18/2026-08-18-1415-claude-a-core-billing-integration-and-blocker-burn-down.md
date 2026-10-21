---
agent: claude-a
status: ready
lane: core-billing-integration-and-blocker-burn-down
created_utc: 2026-08-18T14:15:00Z
worktree: E:\Claude\Straumvakt-core-billing
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-core-billing-integration-and-blocker-burn-down-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-core-billing-integration-and-blocker-burn-down-completion.json
target_wall_clock: none — deliverable-gated
supersedes: 2026-08-11\2026-08-11-0955-claude-a-core-billing-merge-blocker-burn-down.md
very_tldr: Get Core billing off the scratch branch and onto a dev integration branch, with the four money-correctness blockers fixed, the flat-fee generator built, and a migration preflight pack ready for the DB apply Andri has not yet authorised.
---

# Claude A Prompt — Core Billing Integration and Blocker Burn-Down

You are `claude-a`. Execute this prompt only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A to this
file. Verify this header says `agent: claude-a` and `status: ready` before
doing anything.

This prompt **supersedes**
`2026-08-11\2026-08-11-0955-claude-a-core-billing-merge-blocker-burn-down.md`,
which was dispatched on 2026-08-11 and never fired — no commit exists on any
branch after `2026-08-11T09:33:29Z`. Its objectives are absorbed below and
extended. Do not execute the superseded file.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing`. Every other
   `E:\Claude\Straumvakt*` folder is **read-only comparison** unless a phase
   below names it explicitly.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; bind domains; DNS; any
   Cloudflare mutation; any Neon mutation; running any migration against any
   database including dev, scratch, staging and production; live SQL against
   any environment; querying production or staging personal rows; charger
   commands; BLE/NFC; hardware.
4. **Newly permitted this round, and only this:** you may create the local
   integration branch named in Phase 1 and merge into it locally. **No push.**
   This is the only expansion of authority over the 2026-08-11 dispatch.
5. No cleanup, deletion, `git clean`, prune, reset, branch deletion, stash drop,
   or worktree retirement. The canonical checkout carries ~2,857 lines of
   untracked mobile work and 115 MB of untracked `docs/OCPP`; a clean would
   destroy it.
6. **Line endings.** The canonical working tree currently shows 584 modified
   files of which **580 are pure CRLF churn** — `git diff --shortstat` reads
   134,006/133,871 while `git diff -w --shortstat` reads 4 files, 146/11.
   Do not let CRLF churn enter any commit or merge you make. Before every
   commit, run `git diff --cached -w --shortstat` and confirm the whitespace-
   ignoring stat is non-empty and proportionate. If a file appears changed but
   `-w` shows nothing, unstage it. Do not "fix" line endings globally — a
   `.gitattributes` proposal belongs to Claude B this round, not to you.
7. Local code edits, local tests, locally generated (unapplied) migrations, and
   local commits are allowed.
8. Commit only coherent slices, each with its checks recorded. Do not amend or
   rebase prior commits. Do not force anything.
9. Preserve peer changes. If a file you intend to edit is dirty and not yours,
   stop and report it rather than absorbing it.
10. **There is no wall-clock target this round.** Do not pad, and do not stop
    early either. This prompt is **deliverable-gated**: it is complete when the
    counts in §9 are met. "The findings changed the shape of the work" is not a
    stop reason — record the finding and continue down the queue. If you reach
    the end of §9 and the fallback queue in §10, then and only then stop.
11. Record start and end UTC and actual wall clock anyway, for the ledger.
    Report the number honestly with no target comparison.
12. Never print, echo, log, export or commit a secret, token value, idTag,
    password, connection string or personal row. Refer to them by name and
    hash only.

---

## 1. Context you must not re-derive

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4 first.** They are canon. In
particular rule 1's Prisma exception (touch it, convert it), rule 3 (one money
engine, two money lines), rule 4 (the CDR is the record; money is derived, never
destructive), rule 5 (tenancy in every row and every query), and rule 7 (Drizzle
owns the schema, raw SQL owns the hot path, **never** `drizzle-kit push`).

**Locked Core scope:** Iceland-only AC charging for MDUs and workplaces.
Connectors, drivers, access, DSO/network rates, retailer rates, CPO add-on,
plug-time fee with grace, driver billing material, org statements and exports,
delivery log, reporting, standard telemetry.

**Locked commercial model — do not re-litigate the numbers:**

- `200 kr / active connector / month`
- `50 kr / active driver / month`
- capped at `450 kr / connector / month`

**The two money lines (FOCUS rule 3), because half this prompt depends on the
distinction:**

| line | whose money | posture | market phase |
|---|---|---|---|
| host ↔ driver | the host's | agent — Straumvakt presents the claim on the host's behalf, kröfuhafi is the host, rendered "Straumvakt f.h. \<host\>" | deferred, needs attribution |
| Straumvakt ↔ host | Straumvakt's | principal, own invoice | **this is the market line** |

Lines of different posture must never share an invoice. The invoice header is
the legal artefact.

**Where the work currently sits.** Measured 2026-08-18:

- Canonical `dev/straumvakt-org-relaunch` tip: `82c63ac`.
- Your lane branch `scratch/claude-a-core-billing-2026-08-10` tip: `a615a52`.
- Divergence: scratch is **77 commits ahead, 1 behind**. It does **not** contain
  `82c63ac`. That one canonical commit is the OpenADR/zaptec-test consolidation.
- On canonical, `packages/commercial` contains only `agreement/resolve.ts`,
  `agreement/types.ts` and their tests. `apps/api/drizzle/` stops at
  `0001_regular_talos.sql`.
- On your scratch branch, `apps/api/drizzle/0002_powerful_warbird.sql` exists
  (11 `CREATE TYPE`, 11 `CREATE TABLE`, 26 `CREATE INDEX`, no `ALTER`, no
  `DROP`) and is **generated but unapplied**, alongside
  `apps/api/src/lib/billing/*` and `packages/commercial/src/core-billing/*`.

**What the last completed A run (2026-08-11, `a615a52`) established.** Read
`E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-persistence-api-survival-completion.md`
in full before Phase 1. Its load-bearing findings:

- Core billing was a complete, tested, **unreachable** calculation library —
  eleven pure modules, 360 passing tests, ten of eleven with zero production
  callers. There was no table to write to.
- A 310-row source census refuted six written claims, five of them file headers
  advertising capabilities never built, including two files that each name the
  other as the tenant-scoping enforcement point while neither enforces.
- **Launch blocker 1 — double-billing.** The billing-line writer counts-then-
  inserts outside a transaction against a table with no unique constraint.
  Overlapping cron ticks double-bill.
- **Launch blocker 2 — cross-tenant CDR.** The Zaptec CDR import resolves a
  driver by token value with **no org filter**. A token collision across
  tenants bills a foreign driver.
- **Launch blocker 3 — money display.** Both driver money endpoints render
  aurar as krónur. A 649.88 kr session displays as 64,988 kr, live, and the
  defect is pinned by a *passing* test.
- Missing inputs: active connector/driver source, and plug-time.
- `rate_books` was deliberately not added — `agreements.rate_references`
  already is the rate book; what it lacks is a unique on
  `(cost_factor_id, code, effective_from)`, whose creation can fail on existing
  duplicates and therefore needs its own dedupe-then-index migration.

**A hazard discovered on 2026-08-18 that no prior run saw. Read this twice.**

The canonical working tree contains **uncommitted** mobile work:
`apps/mobile/lib/api/client.dart` (+56), `apps/mobile/lib/api/types.dart` (+64),
`apps/mobile/lib/screens/menu_drawer.dart` (+17/−11), plus untracked
`screens/my_vehicle.dart` (2,150 lines), `screens/charge_history.dart`,
`screens/profile.dart`, a preview harness and one widget test. It adds
`getSessionHistory`, `getInvoices` and `updateDisplayName`, and a
`DriverHistorySession` model containing:

```dart
final kr = (c / 100).round();
```

**The client divides `costIsk` by 100.** That display is correct *today* only
because the server is wrong in exactly the compensating direction. If you fix
the server to emit krónur without the client changing, every cost in the driver
app becomes 100× too small — a silent regression that looks like working
software. Phase 3 must treat the server fix and the client contract as **one
atomic change**, and the completion artifact must state explicitly which side
of the boundary now owns the conversion.

---

## 2. Primary objective

Move Core billing from "77 commits on a scratch branch that nobody can merge"
to "an integration branch that is correct, tenant-safe, idempotent, and one
authorised migration away from producing customer 1's first invoice."

Ordered by leverage:

1. Land the merge onto a dev integration branch, reconciling the canonical tip.
2. Fix the money display defect on both sides of the client boundary at once.
3. Close the cross-tenant CDR resolution hole, or prove and gate it.
4. Make double-billing structurally impossible, not merely unlikely.
5. Build the flat-fee principal line generator (TASKS.md task 7) — the market
   line, which needs no CDR and no driver attribution.
6. Produce the migration preflight pack Andri needs in order to authorise
   applying `0002` in a later, separately-approved step.

---

## 3. Phase 0 — Start-state verification

Do this before touching anything. Record every item in the completion artifact.

- Branch, start tip, dirty state, and `git status --porcelain` counts split into
  modified / untracked / staged.
- `git diff --shortstat` **and** `git diff -w --shortstat`, both, so the CRLF
  ratio is on the record for your worktree too.
- Last 10 commits with dates.
- `git rev-list --left-right --count dev/straumvakt-org-relaunch...HEAD`.
- Which of `apps/api/drizzle/*.sql` exist and their `meta/_journal.json` state.
- Whether `node_modules` resolves; whether `npx tsc --noEmit -p apps/api`,
  `npm run check`, and the vitest suites run at all. Record baseline results
  **before** any edit, so every later red can be attributed.
- Confirm the prior A completion artifacts exist at the paths in §1.
- Confirm no peer has dirtied `packages/commercial`, `apps/api/src/lib/billing`,
  `apps/api/src/routes/public/driver.ts`, or `apps/api/drizzle`.

**Gate:** if the baseline is red for a reason that predates this branch, prove
it with `git cat-file` or `git stash` + re-run, record the proof, and continue.
Do not fix unrelated pre-existing red.

---

## 4. Phase 1 — The integration branch

Create `dev/core-billing-integration` from the current canonical tip `82c63ac`,
then merge `scratch/claude-a-core-billing-2026-08-10` into it. **Local only. No
push.**

Required:

- Branch from `82c63ac` explicitly, not from `HEAD` of your scratch branch, so
  the one missing canonical commit is present by construction.
- Resolve every conflict by hand. Record each conflicted path, the choice made,
  and why, in a table in the completion artifact. Do not take `--ours`/`--theirs`
  wholesale.
- After the merge, re-run the full baseline from Phase 0 and diff the results
  against it. Any new red is yours and must be fixed or explicitly recorded as
  blocked with the reason.
- Confirm `apps/api/drizzle/_journal.json` is coherent — `0002` present exactly
  once, no duplicate index, no renumbering.
- Confirm the merge introduced **zero** CRLF-only file changes (§0 rule 6).
- Produce `docs/notes/2026-08-18-core-billing-integration-merge.md` recording:
  branch topology before and after, conflict table, check results before and
  after, and the exact command sequence used, so the merge is reproducible.

**If the merge cannot be completed cleanly**, do not force it and do not
abandon the phase. Produce instead a conflict-by-conflict resolution plan with
the proposed patch for each, commit that plan, and continue to Phase 2 — every
later phase can still be done on the scratch branch.

---

## 5. Phase 2 — Money display, both sides, atomically

**Objective:** exactly one layer in the system converts aurar to krónur, it is
named, it is tested, and both the API and the Flutter client agree on which
layer that is.

Required:

1. Enumerate **every** site where money crosses a boundary: repositories,
   mappers, route handlers, serialisers, formatters, the Flutter
   `DriverHistorySession`, and any web console equivalent. Produce a table:
   file, symbol, unit in, unit out, who converts.
2. Choose the boundary and state the rule in one sentence in source, once.
   Recommendation, which you may override with reasons: **the API emits minor
   units (aurar) with an explicit field name that says so, and the client
   formats.** A field named `costIsk` that carries aurar is the root cause;
   renaming it is cheaper than defending it.
3. Implement the fix on the API side.
4. Implement the matching change to the Flutter client. This is in the
   **canonical** worktree, which is peer-dirty. **Do not edit it.** Instead
   produce `docs/notes/2026-08-18-money-unit-boundary.md` containing the exact
   patch for `apps/mobile/lib/api/types.dart` and `client.dart` as a diff, the
   contract shape both sides must satisfy, and a one-paragraph handover marked
   for whoever owns the mobile lane. Record in the completion artifact that the
   server fix is **not safe to deploy** until that patch lands.
5. Regression tests using at minimum: `0`, `1` aur, `50` aur, `100` aur,
   `64988` aur, a negative adjustment, the `45000` aur cap boundary, a value
   above the cap, and a large amount that exercises thousands separators.
6. Delete or correct the **passing test that pins the defect**. Name it in the
   artifact. A test that asserts the bug is worse than no test.
7. Fool-test: revert the conversion, prove a test fails, restore.

---

## 6. Phase 3 — Cross-tenant CDR resolution

Required:

- Trace the Zaptec CDR import from input to driver assignment to ledger write.
  Produce the call path as a list of file:symbol steps.
- Identify the exact point where token value, charger/site/org ownership, and
  `orgId` are all in scope simultaneously.
- Implement org-scoped lookup if the local schema and repository shape support
  it. If they do not, implement a guard that **refuses** ambiguous unscoped
  resolution — fail closed, never guess — and prove the refusal with a test.
- Tests: same token value in two orgs; unknown token; token belonging to another
  org; disabled token; historical token from the pre-Authorize period (see the
  0049 amendment — those sessions are structurally unattributable, not broken,
  and must not be treated as errors); missing org context; CDR whose charger and
  token disagree about org.
- Never print or export a real token value in test fixtures, logs or the
  artifact. Use synthetic values.
- Fool-test: remove the org filter or guard, prove a test fails, restore.

---

## 7. Phase 4 — Double-billing made structurally impossible

Required:

- Enumerate every writer that counts-then-inserts, derives a line number, or
  relies on handler code for uniqueness.
- Confirm the `0002` schema already carries the keys that make retry collide:
  `session_settlements` on `session_id`; `statements` on
  `(period_id, recipient_kind, recipient_id)`; `settlement_components` on
  `(session_id, kind)`; `statement_lines` on `(statement_id, line_no)`. If any
  is missing or weaker than described, that is a finding — record it and add it.
- Implement the pure idempotency/identity functions and their tests.
- Add tests for: two overlapping generation runs; a retried commit; a partial
  failure mid-batch; a re-run after a crash; out-of-order arrival.
- Ensure the service contract **refuses to proceed without an idempotency key**
  rather than generating one silently.
- Write the SQL preflight duplicate-detection queries that must be run before
  `0002` is applied — read-only `SELECT`s only, to be executed by Andri, not by
  you. Put them in the preflight pack (Phase 7).
- Add a static check or test asserting statement identity is deterministic.
- Fool-test: permit duplicate generation, prove a test fails, restore.

---

## 8. Phase 5 — Tenant scoping burn-down

Required:

- Using the 310-row census plus current source, classify **every** remaining
  billing gate into: safe to fix now; blocked by route shape; global by design;
  needs platform support context; needs product decision. Every row accounted
  for — no residual "unclassified" bucket.
- Implement at least **three** safe scoping fixes, each with a cross-tenant test
  that fails when the scope is removed.
- Resolve the two files that each name the other as the enforcement point.
  Exactly one of them must enforce, and the other's header must be corrected to
  match reality. Correcting a lying file header counts as a deliverable.
- Update the `orgId`-param checker allowlist. If the allowlist shrinks, prove
  the checker fails when stale.
- Do not break bootstrap or operator workflows without documenting and testing
  the alternative path.

---

## 9. Phase 6 — The flat-fee principal line (TASKS.md task 7)

This is **the market line**: Straumvakt → host, per connector, billed to the
org, monthly. No CDR, no driver attribution — which is precisely why it ships
first. It is implemented as a **degenerate agreement**: one cost factor, one
rate reference. Not a shortcut around the engine (FOCUS rule 3).

Required:

- Confirm `per_connector` exists as a rate basis in both TS and Postgres
  (commit `19bb4ef`). If the Postgres enum and the TS union have drifted, that
  is a finding.
- Implement the generator: given an org, a billing period, and the connector
  and driver counts, produce settlement components and statement lines that
  price `200 kr/connector` + `50 kr/driver` capped at `450 kr/connector`,
  through the existing agreements resolver — not beside it.
- **Active connector / active driver source.** Determine whether the source is
  existing-and-reliable, existing-and-unreliable, missing, or derivable from
  connector and settlement history. Implement the pure derivation if it is
  derivable. If it is missing, define the exact table/DTO/repository contract
  and make the absence **impossible to fake** in API or UI — an endpoint that
  cannot compute the count must refuse, not return zero. A zero and an unknown
  look identical on an invoice.
- Cap arithmetic tests: below cap; exactly at cap; above cap; zero drivers;
  zero connectors; one connector many drivers; mid-period connector activation;
  mid-period deactivation; an org with two sites.
- Rate lock-in: prove by test that unit price and effective window are stored
  as **copies** on `settlement_components`, so editing a rate row later cannot
  restate a settled period.
- No silent zero: an unsettleable period must produce a `settlement_holds` row
  naming a `ReviewReason` and appear in `excluded_session_ids`. Test it.
- **Plug-time boundary.** Define the input contract and the rejection behaviour
  until unplug / charging-cease timestamps exist. Rejection, not a default.

---

## 10. Phase 7 — Migration preflight pack

Andri has **not** authorised applying `0002`. This phase produces what he needs
in order to decide, in one place, so the decision costs him minutes not hours.

Deliver `docs/notes/2026-08-18-migration-0002-preflight.md` containing:

- Every object `0002` creates, grouped, with a one-line purpose each.
- Proof it contains no `ALTER` and no `DROP` and touches no existing object.
- The read-only duplicate-detection `SELECT`s from Phase 4, ready to paste.
- The separate dedupe-then-index migration for
  `agreements.rate_references (cost_factor_id, code, effective_from)`, written
  but not applied, with its duplicate-finding query.
- Expected runtime and lock profile per statement, stated as a reasoned estimate
  with the reasoning shown.
- The rollback: exactly what to run if it must be undone, and what becomes
  unrecoverable once rows land.
- A named ordered checklist for the apply, with a stop point after each step.
- What must be true **before** the apply, and what must be verified **after**.

---

## 11. Completion gates — this prompt is done when all of these are true

Not time. Counts.

| # | Gate |
|---|---|
| 1 | `dev/core-billing-integration` exists locally with the merge landed, **or** a conflict-by-conflict resolution plan is committed |
| 2 | Money-unit boundary table covers every crossing site; the boundary rule is stated once in source |
| 3 | The passing test that pinned the aurar defect is named and corrected |
| 4 | The mobile-side patch is written as a diff in `2026-08-18-money-unit-boundary.md` and the deploy hazard is recorded |
| 5 | ≥ 8 money-value regression tests, including 0, 1, 50, 100, 64988, negative, at-cap, above-cap |
| 6 | CDR call path traced as file:symbol steps; org-scoped lookup implemented **or** fail-closed guard implemented |
| 7 | ≥ 7 CDR tenancy tests including the pre-Authorize historical case |
| 8 | Every count-then-insert writer enumerated; idempotency functions implemented and tested |
| 9 | ≥ 5 double-billing tests including overlapping runs and retried commit |
| 10 | Every census row classified into one of the five buckets, none unclassified |
| 11 | ≥ 3 tenant-scoping fixes implemented, each with a failing-when-removed test |
| 12 | The two mutually-deferring files resolved; the lying header corrected |
| 13 | Flat-fee generator implemented against the agreements resolver |
| 14 | ≥ 9 cap-arithmetic tests |
| 15 | Rate lock-in proven by test; no-silent-zero proven by test |
| 16 | Active connector/driver source decided and either derived or contracted with a refusing endpoint |
| 17 | Plug-time input contract and rejection behaviour defined |
| 18 | Migration preflight pack complete with all eight sections |
| 19 | ≥ 5 fool-tests run, each proving a real test fails when the fix is reverted |
| 20 | Completion `.md` and `.json` written at the header paths |

---

## 12. Fallback queue — work these in order if §11 completes

Do not stop at the end of §11. Continue here.

1. Convert every Prisma call you touched to Drizzle in the same change
   (FOCUS rule 1 exception). Repository before route, always.
2. Write the invoice-ledger route contracts — request/response shapes, error
   taxonomy, permission requirements — without implementing handlers that need
   the unapplied tables.
3. Produce 30 Gherkin scenarios for the flat-fee billing path, covering the
   month boundary, org with no connectors, org added mid-period, cap edge, and
   a disputed line.
4. Write the parity plan connecting the 1,621 legacy `session_ledger` rows and
   the 64 test-branch priced sessions to the new ledger, including the vacuity
   guard, so the harness from `a28e9b8` can be pointed at the new tables.
5. Audit every remaining file header in `apps/api/src/lib/billing` and
   `packages/commercial` against what the file actually does. The census found
   five lying headers; find the rest.
6. Produce the retirement plan for the legacy billing path per FOCUS rule 1's
   harvest protocol step 3 — what parity coverage each silently-failing surface
   needs before the old path can go.
7. Write the operator runbook for generating and reviewing customer 1's first
   invoice, assuming the migration has been applied, as a numbered checklist
   with a stop point at each irreversible step.

---

## 13. Completion artifact — mandatory

At the end of the run, do not rely on chat as the only handoff. Write:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-core-billing-integration-and-blocker-burn-down-completion.md
```

plus the JSON sidecar at the header path. Per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`, include: agent;
prompt file; target worktree; branch names; start UTC; end UTC; actual wall
clock; the fact that no time target was set this round; start tips; end tips;
dirty state at close; TL;DR of five lines or fewer; human-readable conclusion;
files created and changed; commits created; tests and checks run with results;
deliverables completed against the §11 table row by row; deliverables skipped
or blocked with the reason; **important corrections to earlier assumptions**;
external-state confirmation; cleanup candidates created; next recommended
action.

JSON minimum fields: `agent`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (use `null` — no target this round),
`worktree`, `branch`, `start_tip`, `end_tip`, `dirty`, `commits`,
`files_changed`, `tests`, `gates_met`, `blockers`, `next_actions`,
`external_state`, `very_tldr`.

**External state confirmation must explicitly state:** no push, no deploy, no
migration applied to any database, no SQL executed against any environment, no
Cloudflare or Neon or GitHub mutation, no charger or hardware action, no branch
or tag deleted, and that the only branch created is the local integration
branch named in Phase 1.

Report in chat only a concise TL;DR pointing at the artifact.
