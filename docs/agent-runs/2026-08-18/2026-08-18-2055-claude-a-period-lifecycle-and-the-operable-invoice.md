---
agent: claude-a
status: ready
round: 3
lane: period-lifecycle-and-the-operable-invoice
created_utc: 2026-08-18T20:55:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
follows: 2026-08-18\2026-08-18-1805-claude-a2c-feeder-wiring-and-first-invoice-dry-run.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-period-lifecycle-and-the-operable-invoice-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-period-lifecycle-and-the-operable-invoice-completion.json
target_wall_clock: none — deliverable-gated
very_tldr: Close preflight deltas 9.7 and 9.8, build the API surface over the port the dry run proved, and write the operator runbook — so that applying 0002 and swapping one adapter is the only thing left between here and a real invoice.
---

# Claude A Prompt — Period Lifecycle and the Operable Invoice

You are `claude-a`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A here.
Verify this header says `agent: claude-a` and `status: ready` first.

This is **round 3**, following A2a/A2b/A2c which completed 41 of 41 gates.
Nothing is superseded; this continues from `a84141e`.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing`, on
   `dev/core-billing-integration`. Other `E:\Claude\Straumvakt*` folders are
   **read-only comparison**.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; DNS or domain binding; any
   Cloudflare, Neon or GitHub mutation; **running any migration against any
   database, including dev and scratch**; live SQL against any environment;
   production or staging personal rows; charger commands; BLE/NFC; hardware.
4. **Permitted:** local commits, and local merges into
   `dev/core-billing-integration`. **No push.**
5. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
6. **Line endings:** `core.autocrlf` is `true` at system level. Keep the
   pre-commit `git diff --cached -w` check. Propose nothing, run nothing, add
   no `.gitattributes`.
7. **Write the completion artifact incrementally and commit it after every
   phase.** This is the standing rule the 2026-08-18 15:40 run's 529 taught,
   and it is not optional.
8. **No wall-clock target.** Deliverable-gated by §7, then continue into §8.
9. Record start and end UTC and actual wall clock, with no target comparison.
10. Never print, echo, log or commit a secret, token value, idTag, password,
    connection string, kennitala or personal row. **All fixture values are
    synthetic**, per the convention B's `fixtures.ts` established: no
    kennitala-shaped value appears in the repository, because a checksum-valid
    ten-digit string is indistinguishable from a real person's national id.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4.** Rules 1 (Prisma exception —
touch it, convert it), 4 (the CDR is the record; money is derived, never
destructively), 5 (tenancy in every row and every query) and 7 (Drizzle owns
the schema, raw SQL owns the hot path; never `drizzle-kit push`) all bear on
this round.

### Lane boundary — round 3

Claude B is working **onboarding** in parallel, in
`E:\Claude\Straumvakt-relops-b`. Both of you are now touching `apps/api`, so
the split is by path and it is strict:

| You own | B owns |
|---|---|
| `packages/commercial/**` | `packages/contracts/**` |
| `apps/api/src/lib/billing/**` | `gateway/**`, all `wrangler` configs |
| `apps/api/drizzle/**` | `scripts/analysis/observability/**` |
| `apps/api/src/repositories/activity-month*` | onboarding routes and repositories |
| **new:** `apps/api/src/routes/admin/billing/**` | `apps/api/src/routes/**` *except* your billing tree and `public/driver.ts` |
| `apps/api/src/routes/public/driver.ts` | |

You consume `packages/contracts/src/invoice/**` **read-only**. A2c needed no
change to it; if this round does, append **CR-2** to
`docs/notes/2026-08-18-invoice-contract-change-requests.md` — append, never
rewrite CR-1 — and say plainly in the artifact whether it blocks you. B
services that file in its Phase 0.

**Create your billing routes under a new `admin/billing/` directory** rather
than adding to an existing route file. Two agents editing one route file is
the one avoidable conflict in this round.

---

## 1. Where you left off

`dev/core-billing-integration` at **`a84141e`**. 1,630 tests passing, 1
skipped, 0 failing, 89 files. **16 of 16 checks green.** Tree clean.

A2c produced the first invoice as an offline dry run —
`SV-2026-000001`, 30 connectors, 2 drivers, **7.564,00 kr** — through
`ActivitySourcePort`, with no database and no socket opened. Two runs
byte-for-byte identical at 2,782 bytes.

**Your own closing list named five things standing between there and a real
invoice.** Two are Andri's decisions and are not yours to touch:

- the active-driver definition (packet delivered, awaiting his answer)
- authorising migration `0002` (preflight pack delivered)

**Three are engineering, and two of them are this round's primary objective:**

> **Delta 9.7 — the connector-assertion gap.** There is no table behind
> `manually_asserted`, so a connector with no session and no StatusNotification
> in a period produces no row, and the period holds. At 21 chargers that is
> unlikely; it is not impossible.
>
> **Delta 9.8 — nothing records that the activity job ran.** Nothing writes a
> `billing_periods` row today, so `activityJobHasRun` has to be passed in and
> the honest default is `false`.

The third — landing the mobile money-unit patch — is unrelated to the invoice
and remains a handover, not your work.

**The pattern that makes this round possible.** A2c's `ActivitySourcePort`
proved that a fixture-backed adapter lets the entire path be exercised offline.
Every surface you build this round follows it: a port, a fixture adapter for
tests, and a Drizzle adapter that is written but never executed. **Had the
feeder called Drizzle directly, the only way to see an invoice before `0002`
was applied would have been to apply `0002`.** Hold that line.

---

## 2. Primary objective

Make the invoice **operable** — reachable by an operator through an API,
repeatable, idempotent, and auditable — while still touching no database.

If this round succeeds, applying `0002` and swapping one adapter is the whole
remaining distance.

Ordered:

1. The period lifecycle, so 9.8 stops being a parameter someone passes in.
2. The connector assertion, so 9.7 stops being a silent hold.
3. The API surface, over ports, fully tested offline.
4. The operator runbook, which the dry run has already proven the shape of.

---

## 3. Phase 0 — Start-state verification

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` and `git diff -w --shortstat`, both.
- Baseline **before any edit**: `npx tsc --noEmit -p apps/api`,
  `npm run typecheck`, `npm test`, `npm run check`. Expect 1,630 / 16-of-16.
  Any deviation from that is a finding — record it before proceeding.
- Confirm the five 2026-08-18 notes and the three A2* completion artifacts are
  present.
- Confirm `dev/market-rails` tip, and whether B has advanced it since
  `a81860b`. If it has moved, **do not merge it mid-round** unless a phase
  needs it — record the tip and decide at Phase 4.

---

## 4. Phase 1 — The period lifecycle (delta 9.8)

`billing.billing_periods` exists in `0002` and has no writer. Until it does,
"has the activity job run for this period?" is a boolean someone hands in, and
the honest default is `false` — which means every period holds.

Required:

1. **Define the period state machine** — states, allowed transitions, terminal
   states, and what each state permits. At minimum: a period must be
   distinguishable as *not yet opened*, *open and accepting activity*,
   *activity complete*, *priced*, *invoiced*, and *closed*. Justify the set you
   choose; do not simply adopt mine.
2. **A closed period is immutable.** FOCUS rule 4: money is derived from the
   record and never rewritten. Prove by test that a closed period rejects new
   activity rows, re-pricing, and re-issue — each with its own named refusal.
3. **Pure state-machine module first**, then the repository. Transitions are a
   pure function of (current state, event); the repository only persists.
4. **`activityJobHasRun` stops being a parameter.** It becomes a derived
   property of the period's state. Delete the parameter from every call site
   you own, or — if a caller genuinely cannot know — make the absence a
   refusal, not a `false`.
5. **Idempotency:** opening an already-open period, or completing an
   already-complete one, is a no-op that returns the existing row, never a
   duplicate and never an error that hides a real one.
6. **Tenancy** per FOCUS rule 5.
7. Tests — at least ten: open; double-open; complete; double-complete;
   activity written into a closed period; re-price a closed period; re-issue a
   closed period; a period for a month that has not ended; two orgs' periods
   for the same month; transition from every state to every illegal state.
8. Fool-test: make a closed period accept new activity; prove a test fails.

---

## 5. Phase 2 — The connector assertion (delta 9.7)

A connector that saw no session and emitted no StatusNotification in a period
produces no activity row — so the period holds, and the customer is not billed
for a connector that exists and is theirs.

Required:

1. **State the problem precisely** before solving it: how a real connector ends
   up with neither signal in a month, and how often that is expected at 21
   chargers and at 4,000. If it is genuinely impossible at either scale, say so
   with evidence and downgrade the phase to a documented refusal — **that is an
   acceptable outcome and you should not manufacture a table to avoid it.**
2. If it is possible, design the assertion: what is asserted, by whom, against
   what evidence, for which period, and how it is audited. **An assertion is a
   human claiming a connector was active with no machine evidence — so it must
   carry who, when, and why, and it must be visible on the invoice's
   provenance block**, alongside the derived counts, in the same style A2c
   established.
3. Schema shape as a **generated, unapplied** migration `0003` if a table is
   needed. Follow `0002`'s discipline: `CREATE` only, no `ALTER`, no `DROP`,
   natural-key uniqueness that makes a retry collide.
4. **`source` union extended, not bypassed.** `manually_asserted` becomes a
   real member with a documented meaning, not a string that appears nowhere
   else.
5. Tests: a period saved by an assertion; an assertion for a connector that
   does not belong to the org; an assertion for a closed period; a duplicate
   assertion; an assertion contradicted by later machine evidence — decide
   which wins and justify it.
6. Fool-test: let an assertion cross an org boundary; prove a test fails.

---

## 6. Phase 3 — The API surface

Build the operator-facing surface under `apps/api/src/routes/admin/billing/`.
**Every handler goes through a port.** A fixture adapter drives the tests; a
Drizzle adapter is written and never executed.

Required endpoints — adjust the shape if the codebase's conventions differ,
but cover the capabilities:

| capability | must |
|---|---|
| open a period | idempotent; refuses a month that has not ended |
| record activity for a period | refuses if the period is not open |
| assert a connector | Phase 2; audited |
| price the period | refuses with a **named reason** when a count is unavailable — never prices a partial period |
| list statements | tenant-scoped; read-only |
| issue an invoice | allocates the number transactionally with issue; gap-free |
| fetch the rendered document | read-only; the same renderer the dry run used |

Plus:

1. **`mutation_receipts` is the idempotency mechanism** for every mutating
   endpoint. `0002` created it with `(org_id, scope, idempotency_key)` unique.
   Use it. A missing idempotency key is a **refusal**, not a generated one —
   round 1 established that `?? crypto.randomUUID()` is an idempotency
   mechanism that guarantees the thing it was added to prevent.
2. **Permissions and tenancy on every route.** `org_id` in the query, always.
   Update the `orgid-param` checker allowlist; if it shrinks, prove the checker
   fails when stale.
3. **Prisma → Drizzle** for anything you touch on the way, per FOCUS rule 1's
   exception. Repository before route.
4. **Extend `dry-run-first-invoice.mts` to drive the API surface**, not just
   the library — so the offline proof now covers the handlers an operator will
   actually call. Keep the existing six cases green and add at least two that
   exercise the period lifecycle end to end.
5. Tests: every endpoint's happy path; every endpoint's refusal path; retry
   with the same idempotency key returns the same result without repeating the
   effect; retry with a different key on the same logical operation is
   **rejected**, not silently duplicated; cross-tenant access refused on every
   read and every write.

---

## 7. Phase 4 — The operator runbook

Your own A2c artifact called this the most valuable remaining fallback item,
because the dry run has proven what it would describe.

Deliver `docs/notes/2026-08-18-first-invoice-operator-runbook.md`:

- The ordered sequence from "nothing has been applied" to "customer 1 has an
  invoice", every step a command or a named UI action.
- **A stop point at every irreversible step**, with what to verify before
  continuing and the named abort condition.
- Explicitly: applying `0002`; the first activity job run; the first pricing
  run — *after which the `0002` rollback window is closed*; the first number
  allocation, which consumes a number that cannot be reused; and delivery.
- What to do when a period holds, per named reason — this is the section an
  operator will actually reach for, because holding is the expected outcome
  until the active-driver question is answered.
- **Cross-reference B's round-2 revision of its release checklist**, not the
  15:13 version, so the two documents do not contradict each other on ordering.
- The rollback for each step, and the point past which there is none.

---

## 8. Completion gates — done when all are true

| # | Gate |
|---|---|
| 1 | Baseline recorded; any deviation from 1,630 tests / 16-of-16 checks reported as a finding |
| 2 | Period state machine defined, with the state set justified rather than adopted |
| 3 | Closed-period immutability proven by test for activity, re-pricing and re-issue, each with a named refusal |
| 4 | State machine implemented pure, repository separate |
| 5 | `activityJobHasRun` no longer a passed-in parameter anywhere you own — derived, or a refusal |
| 6 | Period open/complete idempotent; ≥ 10 lifecycle tests |
| 7 | Delta 9.7 stated precisely with expected frequency at 21 and 4,000 chargers |
| 8 | Assertion designed with who/when/why and surfaced on the provenance block — **or** proven unnecessary with evidence and documented as a refusal |
| 9 | If a table is needed: migration `0003` generated and **unapplied**, `CREATE` only, natural-key unique |
| 10 | `manually_asserted` a documented member of the `source` union |
| 11 | ≥ 5 assertion tests including the cross-org and contradicted-by-evidence cases |
| 12 | Every billing endpoint built under `apps/api/src/routes/admin/billing/`, each through a port |
| 13 | `mutation_receipts` used for every mutating endpoint; a missing key refuses |
| 14 | Tenancy on every route; `orgid-param` allowlist updated and proven to fail when stale |
| 15 | Pricing refuses with a named reason when a count is unavailable — never prices a partial period |
| 16 | Numbering allocation transactional with issue through the API path, gap-free |
| 17 | `dry-run-first-invoice.mts` extended to drive the API surface; the original six cases still green; ≥ 2 new lifecycle cases |
| 18 | ≥ 2 idempotency tests: same key returns same result; different key on the same logical operation is rejected |
| 19 | Cross-tenant refusal proven on every read and every write |
| 20 | Operator runbook delivered with a stop point at every irreversible step and the hold-reason section |
| 21 | ≥ 4 fool-tests, each proving a real test fails when the guard is removed |
| 22 | Completion `.md` and `.json` written **and committed incrementally** |

---

## 9. Fallback queue — work in order once §8 is met

This is A2c's untouched §6 queue, minus the runbook, which is now Phase 4.

1. **Point the parity harness at the new ledger** — the 1,621 legacy
   `session_ledger` rows and the 64 test-branch priced sessions, with the
   vacuity guard, per `a28e9b8`.
2. **Census row 104 (`billing-enrichment.ts`)**, deferred since round 1 and
   already classified "safe to fix now".
3. **The 22 remaining `missing-orgIdParam` gates** — each removal with a test
   that fails when the scope is removed.
4. **Prisma → Drizzle** for every remaining file in the billing tree.
5. **30 Gherkin scenarios** for the flat-fee path: month boundary; org with no
   connectors; org added mid-period; cap edge; disputed line; a period that
   holds; a re-run after correction; an asserted connector.
6. **The legacy retirement plan** per FOCUS rule 1's harvest protocol step 3 —
   what parity coverage each silently-failing surface needs before the old path
   can retire.
7. **A round-3 revision of "what stands between here and a real invoice"**,
   superseding A2c's list. It should be shorter.

---

## 10. Completion artifact

Write and commit incrementally:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-period-lifecycle-and-the-operable-invoice-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus** the §8 gate table row by row, and the revised
short list of what still stands between here and a real invoice.

JSON minimum: `agent`, `round`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `fallback_items_done`, `blockers`, `next_actions`,
`external_state`, `very_tldr`.

**External state must state:** no push, no deploy, **no migration applied to
any database — `0002` and any `0003` remain generated and unapplied**, no SQL
against any environment, no socket opened, no Cloudflare or Neon or GitHub
mutation, no charger or hardware action, no branch or tag deleted, nothing
under `packages/contracts/**` edited, and that the only branch written to is
`dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact.
