---
agent: claude-a
status: ready
chunk: A2b of 3
lane: driver-activity-and-active-driver-decision
created_utc: 2026-08-18T18:05:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
previous_chunk: 2026-08-18\2026-08-18-1805-claude-a2a-connector-activity-writer.md
next_chunk: 2026-08-18\2026-08-18-1805-claude-a2c-feeder-wiring-and-first-invoice-dry-run.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2b-driver-activity-and-active-driver-decision-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2b-driver-activity-and-active-driver-decision-completion.json
target_wall_clock: none — deliverable-gated, deliberately small
very_tldr: Chunk 2 of 3. Build the driver activity writer, keep the refusal, and turn "what makes a driver active" into a decision Andri can make in five minutes.
---

# Claude A2b — Driver Activity and the Active-Driver Decision

You are `claude-a`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A here.

**This is chunk 2 of 3.** Round 2 was split because an Anthropic platform
incident has been killing long runs with `API Error: 529 Overloaded`. Finish
this chunk, commit its artifact, stop. **Do not start chunk 3's work.**

**Chunk 1 must have completed first.** Read
`docs/agent-runs/2026-08-18/claude-a2a-connector-activity-writer-completion.md`
before Phase 0 — its closing section states the exact state you should find. If
that file does not exist, **stop and report**; do not attempt chunk 1's work
from here.

---

## 1. Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing`, on
   `dev/core-billing-integration`. Other `E:\Claude\Straumvakt*` folders are
   **read-only comparison**.
2. **Forbidden without exception:** push; deploy; DNS or domain binding; any
   Cloudflare or Neon or GitHub mutation; **running any migration against any
   database, including dev and scratch**; live SQL against any environment;
   production or staging personal rows; charger commands; BLE/NFC; hardware.
3. **Permitted:** local commits, and local merges into
   `dev/core-billing-integration`. **No push.**
4. No `git clean`, delete, prune, reset, rebase, amend, force, branch deletion,
   stash drop or worktree retirement.
5. **Line endings:** `core.autocrlf` is `true` at system level. Keep a
   pre-commit `git diff --cached -w` check. Propose nothing, run nothing, add
   no `.gitattributes`.
6. **Write the completion artifact incrementally and commit it** — after the
   writer lands, and again after the decision packet.
7. Lane boundary: read and consume `packages/contracts/src/invoice/**`, never
   edit it. Further requests append to
   `docs/notes/2026-08-18-invoice-contract-change-requests.md` as CR-2, CR-3…
8. No wall-clock target. Deliverable-gated by §5.
9. Never print, echo, log or commit a secret, token value, idTag, password,
   connection string, kennitala or personal row.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4.** Rule 4 matters unusually much
here: the CDR is the record, money is derived from it and **never
destructively** — which is why §4's one-way-door question has the answer it
has.

---

## 2. Context

`reports.driver_activity_month` is created by `0002` and has **zero writers**:
`id`, `org_id`, `period_year`, `period_month`, `driver_user_id`, `source`
(text), `session_count` (default 0), `first_seen_at`, `last_seen_at`,
`created_at`. Unique on `(org_id, period_year, period_month, driver_user_id)`.

**The locked commercial model:** `200 kr / active connector / month` +
`50 kr / active driver / month`, capped at `450 kr / connector / month`.

**The open question you must not silently resolve.** The locked definition of
an active driver is *"charging **or reporting** activity"*, and **reporting
activity has no persisted event of any kind**. Round 1 made
`deriveActiveDrivers` **refuse** rather than return the charging-only count,
because at 50 kr per driver per month the shortfall would be invisible on the
invoice that omits it. **That refusal is correct and stays.** This chunk makes
the decision cheap for Andri; it does not make it for him.

---

## 3. Phase 1 — The driver activity writer

Same shape as chunk 1's connector writer. Cite chunk 1's
`docs/notes/2026-08-18-connector-activity-source.md` where the reasoning is
shared rather than re-deriving it.

Required:

1. **Candidate-source enumeration** for driver activity, cited, with historical
   coverage stated — including the pre-Authorize period, where sessions are
   **structurally unattributable rather than broken** (see the 2026-08-08
   amendment to ADR 0049). Those must not be counted as errors.
2. **`source` as a typed union**, each value documented, consistent with the
   union chunk 1 defined.
3. **Pure function first**, then the repository writer. Repository before route.
4. **Implement the charging-activity derivation fully.** It is unambiguous and
   testable.
5. **Do not implement a silent narrowing.** `deriveActiveDrivers` continues to
   refuse when asked for the locked definition, and the refusal carries a named
   reason that says *reporting activity has no persisted source* — not a
   generic error.
6. **Idempotency** on the unique index, with upsert semantics stated.
7. **Tenancy** per FOCUS rule 5.
8. **Tests** — at least five: a driver with sessions across two orgs; a driver
   with zero sessions; a driver active in one period and not the next; a driver
   whose token was disabled mid-period; and the refusal path, asserting the
   named reason.
9. **Fool-test:** make the refusal return the charging-only count instead,
   prove a test fails, restore.
10. **Commit the artifact so far.**

---

## 4. Phase 2 — The active-driver decision packet

Deliver `docs/notes/2026-08-18-active-driver-definition.md`. Six parts, all
required:

1. **The locked definition, quoted, with its provenance.** Where it comes from
   and when it was set.
2. **What "reporting activity" would have to mean to be persistable**, and the
   three cheapest ways to persist it, with what each costs to build and what it
   would change about the ingest path.
3. **The size of the gap.** What the charging-only count would actually be,
   computed against existing data if you can reach it from fixtures or the
   census — and stated plainly as unknown if you cannot. **Andri needs the size
   of the gap, not the existence of it.** An unquantified gap is not a decision
   aid.
4. **The commercial consequence in kr per month** at customer 1's scale, and at
   ten such customers. Show the arithmetic.
5. **The one-line change that narrows the definition**, named by file and
   symbol, so choosing costs minutes rather than a session.
6. **Reversibility, answered plainly.** If the definition narrows now and
   widens later, what happens to periods already invoiced? Invoices are not
   re-priceable — FOCUS rule 4 — so say whether this is a one-way door, in
   those words, and what the remedy would be if it is.

Write it so someone who has not read this codebase can decide from it alone.

---

## 5. Completion gates — done when all are true

| # | Gate |
|---|---|
| 0 | Chunk 1's completion artifact read; the state it describes confirmed present |
| 1 | Driver candidate-source table complete, cited, with pre-Authorize coverage stated as structurally-unattributable rather than error |
| 2 | `source` a typed union consistent with chunk 1's |
| 3 | Charging-activity derivation implemented pure, with a repository writer around it |
| 4 | The refusal preserved, carrying a named reason naming the missing source |
| 5 | Upsert semantics stated; idempotency proven by test |
| 6 | ≥ 5 driver activity tests including the refusal path |
| 7 | ≥ 1 fool-test proving a test fails if the refusal returns the charging-only count |
| 8 | Decision packet delivered with all six required parts |
| 9 | The size of the gap quantified, or explicitly stated as unquantifiable with the reason |
| 10 | Commercial consequence in kr shown with arithmetic, at one and at ten customers |
| 11 | The narrowing change named by file and symbol |
| 12 | The one-way-door question answered in those words, with the remedy if it is one |
| 13 | Completion `.md` and `.json` written **and committed** |

---

## 6. If you finish early

Stay inside this chunk:

1. More refusal-path tests — a period where some drivers are attributable and
   others are not; an org with no drivers at all.
2. Cross-check the driver and connector unions for drift, and add a test that
   fails if they diverge.
3. Sanity-check the decision packet by writing the counter-argument to your own
   recommendation, and include it.

**Do not begin the feeder wiring or the first-invoice dry run.** Chunk 3 has
its own prompt.

---

## 7. Completion artifact

Write and commit:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2b-driver-activity-and-active-driver-decision-completion.md
```

plus the JSON sidecar, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus**: that this is chunk 2 of 3; the §5 gate table row
by row; the decision packet's headline answer restated in three lines; and
**the exact state chunk 3 should expect to find**.

JSON minimum: `agent`, `chunk`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `blockers`, `next_actions`, `external_state`, `very_tldr`.

**External state must state:** no push, no deploy, **no migration applied to
any database**, no SQL against any environment, no Cloudflare or Neon or GitHub
mutation, no charger or hardware action, and that the only branch written to is
`dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact, and say plainly
that chunk 3 is ready to dispatch.
