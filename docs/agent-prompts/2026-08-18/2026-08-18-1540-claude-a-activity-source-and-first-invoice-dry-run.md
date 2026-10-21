---
agent: claude-a
status: ready
lane: activity-source-and-first-invoice-dry-run
created_utc: 2026-08-18T15:40:00Z
worktree: E:\Claude\Straumvakt-core-billing
branch: dev/core-billing-integration
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-activity-source-and-first-invoice-dry-run-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-activity-source-and-first-invoice-dry-run-completion.json
target_wall_clock: none — deliverable-gated
follows: 2026-08-18\2026-08-18-1415-claude-a-core-billing-integration-and-blocker-burn-down.md
very_tldr: Close preflight gap 9.6 — build the writers for the two activity tables that currently have none — then prove the whole path end to end by producing customer 1's first invoice as a dry run on fixtures, with no database anywhere.
---

# Claude A Prompt — Activity Source and the First-Invoice Dry Run

You are `claude-a`. Execute this prompt only after Andri says `go`, and only if
`E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A to this
file. Verify this header says `agent: claude-a` and `status: ready` before
doing anything.

This prompt **follows** the 2026-08-18 14:15 dispatch, which completed with all
20 gates met. Nothing in it is superseded; this continues from `686f5af`.

---

## 0. Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing`, on
   `dev/core-billing-integration`. Every other `E:\Claude\Straumvakt*` folder is
   **read-only comparison** unless a phase names it explicitly.
2. Do not create new top-level folders under `E:\Claude`.
3. **Forbidden without exception:** push; deploy; bind domains; DNS; any
   Cloudflare mutation; any Neon mutation; **running any migration against any
   database, including dev and scratch**; live SQL against any environment;
   querying production or staging personal rows; charger commands; BLE/NFC;
   hardware.
4. **Permitted, unchanged from last round:** local commits, and local merges
   into `dev/core-billing-integration`. **No push.** Phase 1 uses this.
5. No cleanup, deletion, `git clean`, prune, reset, branch deletion, stash drop
   or worktree retirement.
6. **Line endings — corrected premise, read this.** The 2026-08-18 14:15
   dispatch told you the canonical checkout carried 580 whitespace-only modified
   files. **That was wrong.** It was measured through a Linux bridge with no
   `/etc/gitconfig`, which cannot see Windows' system-level
   `core.autocrlf=true`. Native Windows git normalises on read and reports **4
   modified files**, with `git diff --shortstat` identical to
   `git diff -w --shortstat`. Keep the pre-commit `-w` check as cheap
   insurance — it cost nothing last round and confirmed 185/185 clean — but do
   **not** propose, write or run any normalisation, and do not add
   `.gitattributes`.
7. Local code edits, local tests, locally generated (unapplied) migrations and
   local commits are allowed.
8. Commit coherent slices, each with its checks recorded. No amend, no rebase,
   no force.
9. Preserve peer changes. If a file you intend to edit is dirty and not yours,
   stop and report.
10. **No wall-clock target.** Deliverable-gated: complete when §9's counts are
    met, then continue into §10. Last round both agents met their full gate
    tables and B cleared its entire fallback queue — that is the bar.
11. Record start and end UTC and actual wall clock for the ledger, with no
    target comparison.
12. Never print, echo, log, export or commit a secret, token value, idTag,
    password, connection string, kennitala or personal row.

---

## 1. Context you must not re-derive

**Read `FOCUS.md` and `CLAUDE.md` rules 1–4 first.** Rules 3, 4, 5 and 7 are
all load-bearing here.

**Where you left off.** `dev/core-billing-integration` at `686f5af`: merged from
canonical `82c63ac` with zero conflicts, 0 behind / 86 ahead. Tests 1,303
passing. Three launch blockers closed — money leaves the API in aurar under a
name that says aurar; a CDR is attributed only to a driver the host actually
has; generation decides what to write by natural key rather than by counting
rows. The flat-fee feeder exists and refuses rather than inventing a count.

**Your own preflight pack named the real blocker, and this prompt is that
blocker.** From `docs/notes/2026-08-18-migration-0002-preflight.md` §9.6:

> Both tables are created by `0002` and have zero writers. The flat fee has no
> connector or driver count source, so every period holds. **This is the single
> blocker between an applied `0002` and customer 1's first invoice.**
>
> Applying `0002` does not by itself make an invoice possible. It makes the
> tables exist. The count source is what is missing.

**The two tables, as `0002` declares them.**

`reports.connector_activity_month` — `id`, `org_id`, `period_year`,
`period_month`, `connector_id`, `charging_station_id` (nullable), `source`
(text), `session_count` (default 0), `active_days` (nullable),
`first_seen_at`, `last_seen_at`, `cap_applied_isk` (nullable, bigint),
`created_at`. Unique on `(org_id, period_year, period_month, connector_id)`.

`reports.driver_activity_month` — `id`, `org_id`, `period_year`,
`period_month`, `driver_user_id`, `source` (text), `session_count`
(default 0), `first_seen_at`, `last_seen_at`, `created_at`. Unique on
`(org_id, period_year, period_month, driver_user_id)`.

Both carry a `source` column whose permitted values are **not** yet defined
anywhere. Defining them is part of Phase 2.

**Locked commercial model:** `200 kr / active connector / month` +
`50 kr / active driver / month`, capped at `450 kr / connector / month`.

**The open commercial question you must not silently resolve.** The locked
definition of an active driver is "charging **or reporting** activity", and
reporting activity has **no persisted event of any kind**. Your last run made
`deriveActiveDrivers` refuse rather than return the charging-only count,
because at 50 kr per driver per month the shortfall would be invisible on the
invoice that omits it. **That refusal is correct and stays.** Phase 3 makes the
decision cheap for Andri; it does not make it for him.

**What Claude B built in parallel, which you now consume.** On
`dev/market-rails` at `608749f`: `packages/contracts/src/invoice/` — document
model (mixed posture rejected at construction), gap-free numbering, delivery
contract, dunning, reconciliation, header contract, 65 fixtures, and a runnable
offline validator wired in as `npm run check:invoice`. Gap-free numbering is
**settled by Icelandic law, not preference** — *"fyrirfram tölusett með
áprentuð númer í samfelldri töluröð"* — which forces no release operation,
void-in-place, and allocation transactional with issue. Do not design around
that; conform to it.

**Lane boundary.** You may **read and consume** everything under
`packages/contracts/src/invoice/**`. You may **not edit it.** If the contract
needs a change, write the request into
`docs/notes/2026-08-18-invoice-contract-change-requests.md` naming the exact
symbol, the required change, and why — that is B's to apply. Reciprocally, B
does not touch `packages/commercial/**`, `apps/api/src/lib/billing/**`,
`apps/api/drizzle/**` or `apps/api/src/routes/public/driver.ts`.

---

## 2. Primary objective

Produce customer 1's first invoice — as a **dry run, on fixtures, with no
database anywhere** — and in doing so close the one gap that stands between an
applied migration and a real one.

If this run succeeds, the remaining distance to a real invoice is: apply
`0002`, point the writers at a real database, and press go. Every correctness
question will already have been answered offline, where being wrong is free.

Ordered:

1. Merge `dev/market-rails` so both halves live on one branch.
2. Build the connector activity writer.
3. Build the driver activity writer, with the "what is an active driver"
   decision framed rather than taken.
4. Wire the flat-fee feeder to the activity source.
5. Run the whole path end to end on fixtures: period open → activity →
   settlement → statement → invoice document → validator → delivery record.
6. Make the parity harness point at the new ledger.

---

## 3. Phase 0 — Start-state verification

Record every item in the completion artifact.

- Branch, start tip, dirty state, `git status --porcelain` counts.
- `git diff --shortstat` **and** `git diff -w --shortstat`, both, so the
  corrected line-ending premise is on the record from your side.
- `git rev-list --left-right --count dev/straumvakt-org-relaunch...HEAD`.
- Baseline **before any edit**: `npx tsc --noEmit -p apps/api`,
  `npm run typecheck`, `npm test`, `npm run check`. Record each result. Any red
  that predates this run must be proven to predate it and then left alone.
- Confirm `docs/notes/2026-08-18-migration-0002-preflight.md` and the other
  four 2026-08-18 notes are present on this branch.
- Confirm `dev/market-rails` exists at `608749f` and is readable from this
  worktree's object store.

---

## 4. Phase 1 — Merge the market-rails branch

Merge `dev/market-rails` into `dev/core-billing-integration`. **Local only. No
push.**

B deliberately did not do this — merging a peer's in-flight branch was not its
lane's call. It is yours, because you own the integration lane.

Required:

- Run `git merge-tree` as a dry run first, so a conflicted merge is planned
  rather than fought. Both branches touch `package.json` (B added
  `check:invoice`) and `scripts/check-all.mjs`; expect conflict there and
  resolve so **both** gates run.
- Resolve every conflict by hand, recording path, choice and reason in a table.
- After the merge, re-run the full Phase 0 baseline and diff against it. Any new
  red is yours.
- Confirm `npm run check` runs **both** the billing gates and `check:invoice`.
- Confirm zero CRLF-only changes entered the merge.
- Note in the artifact that B's run committed the generated
  `src/app/(app)/admin/work/page.tsx`, which turned `check:work-view` green
  from a clean clone — your last run recorded that gate as failing and
  not-yours. Confirm whether it is now green on the merged branch.

If the merge cannot be completed cleanly, do not force it. Commit a
conflict-by-conflict resolution plan and continue — Phases 2–4 do not depend on
it, and only Phase 5 does.

---

## 5. Phase 2 — The connector activity writer

**Objective:** `reports.connector_activity_month` has a writer that is
deterministic, idempotent, tenant-scoped, and refuses rather than guessing.

Required:

1. **Enumerate every candidate source** of connector activity in the schema —
   sessions, CDRs, connector status history, the asset chain, OCPP event log —
   and produce a table: source, what it proves, what it misses, whether it is
   reliable, and whether it exists for the pre-Authorize historical period.
   Cite `file:symbol` or table name for each.
2. **Define what "active" means for a connector**, in one sentence, in source,
   once. State explicitly whether a connector with zero sessions in a period is
   active (it plausibly is — the fee is per connector, not per session) and
   justify against the locked commercial model. **Getting this wrong bills the
   customer wrong, so write the reasoning down where the next reader finds it.**
3. **Define the permitted values of the `source` column** as a typed union, not
   free text, and state what each means. A `text` column with undocumented
   values is how the next census finds another lying header.
4. **Implement the derivation as a pure function first**, taking rows in and
   producing activity rows out, with no I/O. Then the thin repository writer
   around it. Repository before route, always.
5. **Idempotency.** Re-running the writer for the same period must be a no-op,
   not a duplicate and not a silent overwrite of a corrected value. The unique
   index `(org_id, period_year, period_month, connector_id)` is the mechanism —
   use it, and state the upsert semantics explicitly: what is overwritten on
   conflict and what is preserved.
6. **`active_days` and `cap_applied_isk` are nullable.** Decide, per column,
   whether this writer populates it or leaves it null, and say why. A null that
   means "not computed" and a null that means "zero" must not be the same null.
7. **Tenancy.** `org_id` on the row and in the query, per FOCUS rule 5.
   `restrictToOrgIds` required-field style, as established last round.
8. **Hot path.** FOCUS rule 7: Drizzle for the control plane, raw SQL for the
   hot path. A month-wide aggregation over sessions is not the ingest path, but
   it is not a single-row read either. State which side you put it on and why,
   with a reasoned estimate of row volume at 21 chargers today and at 4,000.
9. Tests: empty period; one connector one session; one connector zero sessions;
   connector activated mid-period; deactivated mid-period; connector moved
   between sites; two orgs whose data must not mix; re-run idempotency; re-run
   after a correction; a period containing pre-Authorize sessions.
10. Fool-test: remove the org term, prove a test fails, restore.

---

## 6. Phase 3 — The driver activity writer and the active-driver decision

**Objective:** the same for `reports.driver_activity_month`, plus a decision
packet that makes the commercial question a five-minute call.

Required:

1. Same source enumeration, same typed `source` union, same pure-function-then-
   repository shape, same idempotency and tenancy discipline as Phase 2.
2. **Implement the charging-activity derivation fully.** It is unambiguous and
   testable.
3. **Do not implement a silent narrowing.** `deriveActiveDrivers` continues to
   refuse when asked for the locked definition. The refusal carries a named
   reason that says *reporting activity has no persisted source*, not a generic
   error.
4. **Deliver `docs/notes/2026-08-18-active-driver-definition.md`** — the
   decision packet:
   - The locked definition, quoted, and where it comes from.
   - What "reporting activity" would have to mean to be persistable, and the
     three cheapest ways to persist it, with what each costs to build.
   - **What the charging-only count would actually be**, computed against
     existing data if you can do it from fixtures or from the census, and
     stated as unknown if you cannot. Andri needs the size of the gap, not the
     existence of it.
   - The commercial consequence in kr per month at customer 1's scale, and at
     ten such customers.
   - The one-line change that narrows the definition, named by file and symbol,
     so choosing costs minutes.
   - The reversibility: if the definition narrows now and widens later, what
     happens to periods already invoiced? Invoices are not re-priceable —
     FOCUS rule 4 — so say plainly whether this is a one-way door.
5. Tests: driver with sessions across two orgs; driver with zero sessions; a
   driver active in one period and not the next; a driver whose token was
   disabled mid-period; the refusal path, asserting the named reason.
6. Fool-test: make the refusal return the charging-only count instead, prove a
   test fails, restore.

---

## 7. Phase 4 — Wire the feeder to the source

Required:

- Connect the flat-fee feeder to the activity tables through a repository
  interface, so the feeder depends on a contract rather than on Drizzle.
- Prove by test that a period with no activity rows **holds** with a named
  reason rather than producing a 0 kr invoice. A zero and an unknown look
  identical on an invoice, and only one of them is honest.
- Prove the cap arithmetic end to end from activity rows rather than from
  hand-passed counts: below cap, at cap, above cap, zero drivers, many drivers
  one connector.
- Prove rate lock-in survives the path: unit price and effective window stored
  as copies, so editing a rate row later cannot restate a settled period.

---

## 8. Phase 5 — The first-invoice dry run

**This is the deliverable that matters most. Everything else is in service of
it.**

Build `scripts/dry-run-first-invoice.mts` — runnable offline, no database, no
network, exit-code driven — that takes a synthetic org through the entire path
and prints the resulting invoice:

```
org + asset chain + agreement fixture
  → connector activity + driver activity rows (Phase 2/3 derivations)
    → flat-fee settlement components / statement lines
      → statement (grouped by claim holder, counterparty, period)
        → invoice document (B's model, principal posture)
          → npm run check:invoice validator
            → rendered header + document
              → delivery record in state `unknown`, not `delivered`
```

Required:

- **The rendered invoice must be printed in full** and included verbatim in the
  completion artifact. A human has to read it. That is the point.
- It must exercise B's real contracts — document model, numbering, header,
  validator — not a parallel implementation. If a contract blocks you, write
  the change request per §1's lane boundary; do not fork it.
- **The principal line only.** Straumvakt → host, Straumvakt's own money. Assert
  by test that an agent-posture line cannot join this document.
- Numbering: prove allocation is transactional with issue, gap-free, and that a
  crash between allocate and issue does not consume a number.
- The delivery record ends in `unknown`, never `delivered` — nothing was
  actually delivered, and the dry run must not lie about it.
- A second run must produce an identical document, byte for byte, except where
  a field is legitimately time-dependent — and those fields must be named.
- Add at least three deliberately broken fixtures — a period with a hold, an org
  with no kennitala, a mixed-posture attempt — and prove the script exits
  non-zero with a readable reason for each.

---

## 9. Completion gates — done when all of these are true

| # | Gate |
|---|---|
| 1 | `dev/market-rails` merged into `dev/core-billing-integration`, **or** a conflict-by-conflict plan committed |
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
| 23 | Completion `.md` and `.json` written at the header paths |

---

## 10. Fallback queue — work these in order once §9 is met

1. **Point the parity harness at the new ledger.** The 1,621 legacy
   `session_ledger` rows and the 64 test-branch priced sessions, with the
   vacuity guard, per the harness from `a28e9b8`.
2. **Census row 104 (`billing-enrichment.ts`)** — deferred last round as a
   fourth surface in a three-surface commit. Land it now.
3. **The 22 remaining `missing-orgIdParam` gates.** Work them down; every one
   removed from the allowlist needs a test that fails when the scope is
   removed.
4. **Prisma → Drizzle** for every file this run touched, per FOCUS rule 1's
   exception. Repository before route.
5. **30 Gherkin scenarios** for the flat-fee path: month boundary, org with no
   connectors, org added mid-period, cap edge, disputed line, a period that
   holds, a re-run after correction.
6. **The legacy retirement plan** per FOCUS rule 1's harvest protocol step 3 —
   what parity coverage each silently-failing surface needs before the old path
   can go.
7. **The operator runbook** for generating and reviewing customer 1's real
   invoice once `0002` is applied: numbered, with a stop point at each
   irreversible step, and cross-referenced to B's release checklist §7 steps
   5–11 so the two documents do not drift.

---

## 11. Completion artifact — mandatory

Write:

```
E:\Claude\Straumvakt\docs\agent-runs\2026-08-18\claude-a-activity-source-and-first-invoice-dry-run-completion.md
```

plus the JSON sidecar at the header path, per
`docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Include everything
that rule requires, **plus the rendered dry-run invoice in full**, and the §9
gate table row by row.

JSON minimum: `agent`, `status`, `start_utc`, `end_utc`,
`wall_clock_seconds`, `target_met` (`null` — no target), `worktree`, `branch`,
`start_tip`, `end_tip`, `dirty`, `commits`, `files_changed`, `tests`,
`gates_met`, `blockers`, `next_actions`, `external_state`, `very_tldr`.

**External state confirmation must explicitly state:** no push, no deploy, **no
migration applied to any database**, no SQL against any environment, no
Cloudflare or Neon or GitHub mutation, no charger or hardware action, no branch
or tag deleted, and that the only branch written to is
`dev/core-billing-integration`.

Report in chat only a concise TL;DR pointing at the artifact.
