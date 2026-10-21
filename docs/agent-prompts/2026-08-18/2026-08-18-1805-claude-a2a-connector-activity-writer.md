---
agent: claude-a
status: ready
chunk: A2a of 3
lane: connector-activity-writer
created_utc: 2026-08-18T18:05:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
resumes: 2026-08-18\2026-08-18-1540-claude-a-activity-source-and-first-invoice-dry-run.md
next_chunk: 2026-08-18\2026-08-18-1805-claude-a2b-driver-activity-and-active-driver-decision.md
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2a-connector-activity-writer-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2a-connector-activity-writer-completion.json
target_wall_clock: none — deliverable-gated, deliberately small
very_tldr: Chunk 1 of 3. Re-merge market-rails for B's CR-1 fix, then build the connector activity writer — the first half of the count source that `reports.connector_activity_month` has never had.
---

# Claude A2a — The Connector Activity Writer

You are `claude-a`. Execute only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A here.

**This is chunk 1 of 3.** The round-2 work was split because an Anthropic
platform incident (opened 2026-08-18 16:20 UTC, Opus 5 named specifically) has
been killing long runs with `API Error: 529 Overloaded`. Each chunk is small
on purpose: finish it, commit its artifact, stop. **Do not start chunk 2's
work — it has its own prompt.**

---

## 1. State, measured from git

The 15:40 dispatch was interrupted by a 529. Two commits survived:

| | |
|---|---|
| Branch | `dev/core-billing-integration` |
| Tip | **`e7247b6`** (2026-08-18 15:48:17Z) |
| `cafbee4` | Merge `dev/market-rails` (at `608749f`) |
| `e7247b6` | Regenerate dependency graph; file **CR-1** |
| Completion artifact | none — the run died before writing one |

**Claude B has since finished its own round 2 and serviced CR-1.**
`dev/market-rails` has moved `608749f` → **`a81860b`**.

CR-1, for context: B's golden-file tests compare a `readFileSync` result
against `renderHeaderText`, which emits LF, while git checks the committed
blobs out as CRLF under system-level `core.autocrlf=true`. Two of 21 tests in
`header.test.ts` therefore fail on **any** fresh Windows checkout and are
invisible on the branch that created them. You found it, filed it, correctly
did not treat yourself as blocked, and B has fixed it. Phase 1 picks it up.

---

## 2. Operating rules

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
5. **Line endings:** `core.autocrlf` is `true` at system level here. Keep a
   pre-commit `git diff --cached -w` sanity check. **Propose nothing, run
   nothing, add no `.gitattributes`.** CR-1 is B's and is already fixed.
6. **Write the completion artifact incrementally and commit it** — after
   Phase 1, and again after Phase 2. This is the rule the 529 taught us: two
   commits survived the last interruption because they were commits, and the
   entire run record was lost because it was not.
7. Lane boundary: you may **read and consume** `packages/contracts/src/invoice/**`
   but **not edit it**. Further requests append to
   `docs/notes/2026-08-18-invoice-contract-change-requests.md` as CR-2, CR-3…
   Do not rewrite CR-1. B is idle, so a new CR will not be serviced today —
   file it anyway and say plainly whether it blocks you.
8. No wall-clock target. Deliverable-gated by §6.
9. Never print, echo, log or commit a secret, token value, idTag, password,
   connection string, kennitala or personal row.

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4 before starting.** Rules 5
(tenancy in every row and every query) and 7 (Drizzle owns the schema, raw SQL
owns the hot path — never `drizzle-kit push`) both bear on this chunk.

---

## 3. Phase 0 — Salvage and baseline

- `git status --porcelain` in full. Classify every entry: yours from the
  interrupted run, a peer's, or generated output.
- **If uncommitted work from the interrupted run exists**, finish and commit it
  as its own slice, or `git stash push -m "salvage from interrupted run e7247b6"`.
  **Stash, never discard.** Record which and why.
- `git log --oneline 686f5af..HEAD` — expect exactly `cafbee4` and `e7247b6`.
- Baseline before any edit: `npx tsc --noEmit -p apps/api`, `npm run typecheck`,
  `npm test`, `npm run check`. Expect the 2 `header.test.ts` golden failures
  still present — Phase 1 fixes them.

---

## 4. Phase 1 — Re-merge market-rails at `a81860b`

Merge `dev/market-rails` into `dev/core-billing-integration`. Local only.

- `git merge-tree` dry run first; resolve any conflict by hand, recording path,
  choice and reason.
- Re-run the baseline. **The two golden-file failures must now be green.** If
  they are not, that is a finding: record it, append the measurement to CR-1,
  and continue. Do not fix it — it is B's lane.
- Confirm `npm run check` runs both the billing gates and `check:invoice`.
- Confirm zero CRLF-only changes entered the merge.
- **Commit the artifact so far.**

---

## 5. Phase 2 — The connector activity writer

`reports.connector_activity_month` is created by migration `0002` and has
**zero writers**. Your own preflight §9.6 named this as *"the single blocker
between an applied `0002` and customer 1's first invoice."* This chunk builds
half of it.

The table, as `0002` declares it: `id`, `org_id`, `period_year`,
`period_month`, `connector_id`, `charging_station_id` (nullable), `source`
(text), `session_count` (default 0), `active_days` (nullable), `first_seen_at`,
`last_seen_at`, `cap_applied_isk` (nullable bigint), `created_at`. Unique on
`(org_id, period_year, period_month, connector_id)`.

Required:

1. **Enumerate every candidate source** of connector activity — sessions, CDRs,
   connector status history, the asset chain, the OCPP event log. Table:
   source, what it proves, what it misses, whether it is reliable, whether it
   covers the pre-Authorize historical period. Cite `file:symbol` or table name
   for each.
2. **Define "active connector" in one sentence, in source, once.** State
   explicitly whether a connector with zero sessions in a period is active — it
   plausibly **is**, because the fee is per connector, not per session — and
   justify against the locked model (`200 kr / active connector / month`,
   capped at `450 kr / connector / month`). Getting this wrong bills the
   customer wrong; write the reasoning where the next reader finds it.
3. **Make `source` a typed union, not free text**, with each value documented.
   An undocumented `text` column is how the next census finds another lying
   header.
4. **Pure function first**, rows in → activity rows out, no I/O. Then the thin
   repository writer around it. Repository before route.
5. **Idempotency** on the unique index. State the upsert semantics explicitly:
   what is overwritten on conflict, what is preserved. A re-run must be a
   no-op, not a duplicate and not a silent overwrite of a corrected value.
6. **`active_days` and `cap_applied_isk` are nullable.** Decide per column
   whether this writer populates it, and say why. A null meaning "not computed"
   and a null meaning "zero" must not be the same null.
7. **Tenancy**: `org_id` on the row and in the query, `restrictToOrgIds`
   required-field style as established in round 1.
8. **Hot-path side.** State which side of the FOCUS rule 7 boundary this lands
   on, with a reasoned row-volume estimate at 21 chargers today and at 4,000.
9. **Tests** — at least ten: empty period; one connector one session; one
   connector zero sessions; activated mid-period; deactivated mid-period;
   connector moved between sites; two orgs whose data must not mix; re-run
   idempotency; re-run after a correction; a period containing pre-Authorize
   sessions.
10. **Fool-test**: remove the org term, prove a test fails, restore.

---

## 6. Completion gates — done when all are true

| # | Gate |
|---|---|
| 0 | Salvage decision recorded: interrupted-run work finished, stashed, or proven absent |
| 1 | `dev/market-rails` at `a81860b` merged; the 2 golden tests green, or the failure appended to CR-1 as a finding |
| 2 | `npm run check` runs both the billing gates and `check:invoice`; zero CRLF-only changes in the merge |
| 3 | Candidate-source table complete, every row cited, historical coverage stated |
| 4 | "Active connector" defined in one sentence in source, zero-session case explicitly decided and justified |
| 5 | `source` a typed union with every value documented |
| 6 | Derivation implemented pure, with a repository writer around it |
| 7 | Upsert semantics stated: what is overwritten, what is preserved |
| 8 | `active_days` and `cap_applied_isk` decided per column with null-meaning stated |
| 9 | Hot-path side chosen with a volume estimate at 21 and at 4,000 chargers |
| 10 | ≥ 10 connector activity tests including both mid-period cases and re-run idempotency |
| 11 | ≥ 1 fool-test proving a real test fails when the org term is removed |
| 12 | Completion `.md` and `.json` written **and committed** |

---

## 7. If you finish early

Stay inside this chunk. Deepen it rather than starting chunk 2:

1. More edge-case tests — leap year, period boundary at month end, a connector
   whose org changed mid-period, a period with no sessions anywhere.
2. Property-based tests over the pure derivation if a generator is available.
3. A short `docs/notes/2026-08-18-connector-activity-source.md` recording the
   candidate-source table and the definition, so chunk 2 and chunk 3 can cite
   it rather than re-deriving it.
4. Audit the file headers you touched against what the files actually do.

**Do not begin the driver activity writer, the active-driver decision packet,
the feeder wiring or the dry run.** Each has its own prompt.

---

## 8. Completion artifact

Write and commit:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a2a-connector-activity-writer-completion.md
```

plus the JSON sidecar. Per `docs/notes/2026-08-10-agent-completion-artifact-rule.md`,
include everything that rule requires, **plus**: that this is chunk 1 of 3
resuming an interrupted run; the salvage decision; the §6 gate table row by
row; and **the exact state chunk 2 should expect to find** — branch, tip,
what exists, what does not.

JSON minimum: `agent`, `chunk`, `status`, `resumed_from`, `start_utc`,
`end_utc`, `wall_clock_seconds`, `target_met` (`null`), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `blockers`, `next_actions`, `external_state`, `very_tldr`.

**External state must state:** no push, no deploy, **no migration applied to
any database**, no SQL against any environment, no Cloudflare or Neon or GitHub
mutation, no charger or hardware action, nothing discarded during salvage, and
that the only branch written to is `dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact, and say plainly
that chunk 2 is ready to dispatch.
