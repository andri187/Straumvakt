---
agent: claude-a
status: ready
lane: activity-source-and-first-invoice-dry-run-resume
created_utc: 2026-08-18T17:25:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
resumes: 2026-08-18\2026-08-18-1540-claude-a-activity-source-and-first-invoice-dry-run.md
interrupted_at: e7247b6 — run ended on an API 529 Overloaded, no completion artifact written
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-activity-source-and-first-invoice-dry-run-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-activity-source-and-first-invoice-dry-run-completion.json
target_wall_clock: none — deliverable-gated
very_tldr: Resume the interrupted round-2 run. Phase 1 landed; re-merge market-rails to pick up B's CR-1 fix, then build the two activity writers, frame the active-driver decision, and produce the first-invoice dry run.
---

# Claude A Prompt — RESUME: Activity Source and the First-Invoice Dry Run

You are `claude-a`. Execute this prompt only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A to this
file. Verify this header says `agent: claude-a` and `status: ready` before
doing anything.

**This is a resume, not a restart.** The 2026-08-18 15:40 dispatch was
interrupted by an `API Error: 529 Overloaded` partway through. Two commits
landed and no completion artifact was written. Assume you remember nothing;
everything you need is below.

---

## 0. What actually happened, measured from the repository

Read this before Phase 0. It is measured, not reported — the interrupted run
never got to write an artifact, so this reconstruction comes from git.

| | |
|---|---|
| Branch | `dev/core-billing-integration` |
| Tip when interrupted | **`e7247b6`** (2026-08-18 15:48:17Z) |
| Started the round at | `686f5af` |
| Commits landed | **2** |
| Completion artifact | **none written** |
| Cause of stop | API 529 Overloaded — an infrastructure failure, not a decision |

The two commits:

- `cafbee4` — *Merge dev/market-rails into dev/core-billing-integration*
- `e7247b6` — *Regenerate the dependency graph after the market-rails merge, and file CR-1*

**So §4 (Phase 1) of the 1540 prompt is complete**, including the merge, the
dependency-graph regeneration, and CR-1 filed against B's invoice contracts.
**Phases 2, 3, 4 and 5 were not reached.**

### What changed underneath you while you were down

Claude B completed its own round 2 at **16:15:44Z** and **serviced your
CR-1**. `dev/market-rails` has moved:

| | |
|---|---|
| You merged | `608749f` |
| It is now at | **`a81860b`** — *feat(contracts): kennitala capture; service A's CR-1; round-2 release-ops queue* |

CR-1 was the golden-file line-ending defect you found: `renderHeaderText`
emits LF, git checks the committed golden blobs out as CRLF under system-level
`core.autocrlf=true`, and `readFileSync` compares them byte for byte — so 2 of
21 tests in `header.test.ts` fail on **any** Windows checkout, including a
fresh clone and Windows CI. You correctly filed it as B's to fix and correctly
did not treat yourself as blocked. **B has now fixed it.** Phase 0.5 below picks
that up, which should take those two tests from red to green.

B also reported three findings that change the environment picture but do not
change your lane: production already exists and is called staging; S0 is
`ws.straumvakt.org → straumvakt-ocpp-staging`, proven rather than inferred; and
Cloudflare has been recording every version all along, so the "one-way door"
premise was wrong and rollback works today. **None of this affects your work.
Do not act on it.**

---

## 1. Operating rules

Unchanged from the 1540 dispatch. Restated in full because you are starting
cold.

1. Work only in `E:\Claude\Straumvakt-core-billing`, on
   `dev/core-billing-integration`. Every other `E:\Claude\Straumvakt*` folder is
   **read-only comparison** unless a phase names it explicitly.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; bind domains; DNS; any
   Cloudflare mutation; any Neon mutation; **running any migration against any
   database, including dev and scratch**; live SQL against any environment;
   querying production or staging personal rows; charger commands; BLE/NFC;
   hardware.
4. **Permitted:** local commits, and local merges into
   `dev/core-billing-integration`. **No push.**
5. No cleanup, deletion, `git clean`, prune, reset, branch deletion, stash drop
   or worktree retirement. **This matters more than usual today** — see Phase 0.
6. **Line endings.** `core.autocrlf` is `true` at system level on this machine.
   Native Windows git reports 4 modified files in canonical, with
   `--shortstat` identical to `-w --shortstat`. The round-1 claim of 580
   whitespace-only files was a coordinator measurement error made through a
   Linux bridge with no `/etc/gitconfig`. Keep the pre-commit `-w` check as
   cheap insurance. **Propose nothing, run nothing, add no `.gitattributes`.**
   CR-1 is the one place line endings matter and it is B's fix, already made.
7. Commit coherent slices, each with its checks recorded. No amend, no rebase,
   no force.
8. Preserve peer changes. If a file you intend to edit is dirty and not yours,
   stop and report.
9. **No wall-clock target.** Deliverable-gated: complete when §7's counts are
   met, then continue into §8.
10. Record start and end UTC and actual wall clock for the ledger, with no
    target comparison. **Also record that this was a resumed run and what the
    interruption cost**, so the ledger reflects two dispatches and one body of
    work.
11. **Write the completion artifact incrementally, not only at the end.** The
    interruption cost this run its entire record. After each phase completes,
    append to the completion `.md` and commit it. If you are interrupted again,
    what you had at that point survives. This supersedes the usual
    write-it-at-the-end pattern and is the one procedural change this resume
    introduces.
12. Never print, echo, log, export or commit a secret, token value, idTag,
    password, connection string, kennitala or personal row.

---

## 2. Phase 0 — Salvage and start-state verification

**A run that died mid-flight may have left uncommitted work. Establish that
before anything else, and do not destroy it.**

Required:

- `git status --porcelain` in full. Classify every entry: (a) yours from the
  interrupted run, (b) a peer's, (c) generated output.
- **If uncommitted work from the interrupted run exists**, read it, judge it,
  and either finish and commit it as its own slice or set it aside with
  `git stash push -m "salvage from interrupted run e7247b6"` — **stash, never
  discard.** Record which you chose and why. Do not `git checkout --` or
  `git clean` anything.
- `git log --oneline 686f5af..HEAD` to confirm the two commits above and
  nothing else.
- `git diff --shortstat` and `git diff -w --shortstat`, both.
- Baseline **before any edit**: `npx tsc --noEmit -p apps/api`,
  `npm run typecheck`, `npm test`, `npm run check`. Record each result. Expect
  the 2 golden-file failures in `header.test.ts` to still be present at this
  point — they are CR-1 and Phase 0.5 fixes them.
- Confirm `docs/notes/2026-08-18-invoice-contract-change-requests.md` exists on
  this branch with CR-1 in it.
- Confirm no completion artifact for this lane exists yet at the header path.

---

## 3. Phase 0.5 — Re-merge market-rails for the CR-1 fix

Merge `dev/market-rails` (now `a81860b`) into `dev/core-billing-integration`.
**Local only. No push.**

Required:

- `git merge-tree` dry run first.
- Resolve any conflict by hand, recording path, choice and reason.
- After the merge, re-run the Phase 0 baseline. **The two `header.test.ts`
  golden failures must now be green.** If they are not, that is a finding —
  record it, update CR-1 with the measurement, and continue. Do not fix it
  yourself; it is B's lane.
- B's round-2 work also added kennitala capture to `packages/contracts`. You do
  not own it and must not edit it, but note whether it affects the invoice
  document model you are about to consume in Phase 5 — specifically whether the
  host identity field the header needs is now populated from it.
- Confirm `npm run check` runs both the billing gates and `check:invoice`. B
  reports 13 gates green on its side; record what you see.
- Confirm zero CRLF-only changes entered the merge.

---

## 4. The work: Phases 2–5 of the 1540 prompt

**These are unchanged.** The full text is in
`docs/agent-prompts/2026-08-18/2026-08-18-1540-claude-a-activity-source-and-first-invoice-dry-run.md`,
§5 through §8. **Read that file — it is the specification and this resume does
not restate it.** What follows is the summary you need to know it matters, not
a replacement for it.

**Why this lane exists.** Your own preflight pack, §9.6:

> Both tables are created by `0002` and have zero writers. The flat fee has no
> connector or driver count source, so every period holds. **This is the single
> blocker between an applied `0002` and customer 1's first invoice.**

**Phase 2 — the connector activity writer.** `reports.connector_activity_month`.
Enumerate every candidate source with citations. Define "active connector" in
one sentence in source, including the zero-session case, which plausibly *is*
active because the fee is per connector not per session. Make `source` a typed
union, not free text. Pure function first, repository around it. Idempotent on
the `(org_id, period_year, period_month, connector_id)` unique index with
explicit upsert semantics. Decide `active_days` and `cap_applied_isk` per
column and state what each null means. Tenancy per FOCUS rule 5. State which
side of the FOCUS rule 7 hybrid boundary this lands on, with a volume estimate
at 21 and at 4,000 chargers.

**Phase 3 — the driver activity writer and the active-driver decision.** Same
shape. Implement charging activity fully. **Keep the refusal** — the locked
definition is "charging *or reporting* activity" and reporting activity has no
persisted event, so `deriveActiveDrivers` refuses rather than silently
undercounting at 50 kr a head. Deliver
`docs/notes/2026-08-18-active-driver-definition.md` with all six parts,
including **the size of the gap in kr** and the one-way-door answer about
already-invoiced periods.

**Phase 4 — wire the feeder to the source.** Through a repository interface, not
Drizzle directly. Prove a period with no activity rows **holds with a named
reason** rather than producing a 0 kr invoice.

**Phase 5 — the first-invoice dry run.** `scripts/dry-run-first-invoice.mts`,
offline, no database, no network. Asset chain → activity → settlement →
statement → invoice document → validator → rendered header → delivery record in
state `unknown`. **Print the rendered invoice in full in the completion
artifact.** Principal posture only. Determinism proven across two runs. Three
deliberately broken fixtures each exiting non-zero with a readable reason.

**Lane boundary, unchanged.** You may read and consume
`packages/contracts/src/invoice/**`. You may not edit it. Further requests go
into `docs/notes/2026-08-18-invoice-contract-change-requests.md` as CR-2, CR-3
and so on — **append, do not rewrite CR-1**, which is now closed and is the
record of a real defect found and fixed across a lane boundary. B has finished
its round, so a new CR will not be serviced today; file it anyway and say
plainly in the artifact whether it blocks you.

---

## 5. If you are interrupted again

- Everything committed survives. Everything in the completion artifact survives
  **only if you committed it** — hence rule 11.
- Do not attempt to "catch up" by skipping the gate table. A partial run that
  honestly reports six of twenty-three gates is worth more than a complete-
  looking one that skipped the tests.
- The stash from Phase 0, if you made one, is still there. Say so in the
  artifact so the next dispatch knows to look.

---

## 6. Checks

Run and record, at baseline and at close:

`npx tsc --noEmit -p apps/api` · `npm run typecheck` · `npm test` ·
`npm run check` · `check:invoice` · `check:orgid-param` · `check:work-view`

Any red that predates this branch must be proven to predate it — with
`git cat-file`, an empty `git log -- <paths>`, or an equivalent — and then left
alone.

---

## 7. Completion gates — done when all of these are true

Gates 1–2 of the 1540 prompt are already met by `cafbee4`/`e7247b6`; they are
restated here as verification rather than work.

| # | Gate |
|---|---|
| 0 | Salvage decision recorded: uncommitted work from the interrupted run finished, stashed, or proven absent |
| 1 | `dev/market-rails` at `a81860b` merged; CR-1 fix confirmed to turn the 2 golden tests green, or the failure recorded as a finding |
| 2 | `npm run check` runs both the billing gates and `check:invoice` |
| 3 | Connector source table: every candidate enumerated with citation, reliability and historical coverage |
| 4 | "Active connector" defined in one sentence in source, with the zero-session case explicitly decided |
| 5 | `source` column values a typed union for both tables, each value documented |
| 6 | Connector derivation implemented pure, with a repository writer around it |
| 7 | Upsert semantics stated explicitly: what is overwritten on conflict, what is preserved |
| 8 | `active_days` and `cap_applied_isk` decided per column, with the null-meaning stated |
| 9 | Hot-path side chosen with a reasoned volume estimate at 21 and at 4,000 chargers |
| 10 | ≥ 10 connector activity tests including both mid-period cases and re-run idempotency |
| 11 | Driver derivation implemented for charging activity; the refusal preserved with a named reason |
| 12 | Active-driver decision packet delivered, all six required parts, including the size of the gap |
| 13 | The one-way-door question answered plainly: what happens to already-invoiced periods if the definition later widens |
| 14 | ≥ 5 driver activity tests including the refusal path |
| 15 | Feeder consumes activity through a repository interface, not Drizzle directly |
| 16 | A period with no activity rows **holds** with a named reason — proven by test |
| 17 | Cap arithmetic proven end to end from activity rows, ≥ 5 cases |
| 18 | `dry-run-first-invoice.mts` runs offline and produces a validated invoice document |
| 19 | The rendered invoice printed in full in the completion artifact |
| 20 | Determinism proven: two runs identical except for named time-dependent fields |
| 21 | ≥ 3 broken fixtures each exiting non-zero with a readable reason |
| 22 | ≥ 5 fool-tests, each proving a real test fails when the guard is removed |
| 23 | Completion `.md` and `.json` written at the header paths, **and committed incrementally per rule 11** |

---

## 8. Fallback queue — work these in order once §7 is met

Unchanged from the 1540 prompt §10.

1. Point the parity harness at the new ledger — 1,621 legacy `session_ledger`
   rows and the 64 test-branch priced sessions, with the vacuity guard.
2. Census row 104 (`billing-enrichment.ts`), deferred from round 1.
3. The 22 remaining `missing-orgIdParam` gates, each removal with a
   failing-when-removed test.
4. Prisma → Drizzle for every file this run touched, per FOCUS rule 1's
   exception. Repository before route.
5. 30 Gherkin scenarios for the flat-fee path.
6. The legacy retirement plan per FOCUS rule 1's harvest protocol step 3.
7. The operator runbook for customer 1's real invoice once `0002` is applied,
   cross-referenced to B's release checklist so the two do not drift. **Note
   that B's round 2 revised that checklist** — use the round-2 revision in
   `docs/notes/` on `dev/market-rails`, not the 2026-08-18 15:13 version.

---

## 9. Completion artifact — mandatory, and written incrementally

Write, and commit after each phase:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-activity-source-and-first-invoice-dry-run-completion.md
```

plus the JSON sidecar at the header path, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus**:

- That this was a **resumed** run, the interrupting error, the tip it resumed
  from, and what the interruption cost in redone work.
- The salvage decision from Phase 0.
- The rendered dry-run invoice in full.
- The §7 gate table row by row.

JSON minimum: `agent`, `status`, `resumed_from`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`, `start_tip`,
`end_tip`, `dirty`, `commits`, `files_changed`, `tests`, `gates_met`,
`blockers`, `next_actions`, `external_state`, `very_tldr`.

**External state confirmation must explicitly state:** no push, no deploy, **no
migration applied to any database**, no SQL against any environment, no
Cloudflare or Neon or GitHub mutation, no charger or hardware action, no branch
or tag deleted, nothing discarded during salvage, and that the only branch
written to is `dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact.
