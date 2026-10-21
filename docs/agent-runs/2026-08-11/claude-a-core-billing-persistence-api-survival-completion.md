# Claude A — Core billing persistence/API survival run

**Completion artifact.** Prompt:
`docs/agent-prompts/2026-08-11/2026-08-11-0410-claude-a-core-billing-persistence-api-survival.md`

---

## TL;DR

Core billing was a complete, tested, **unreachable** calculation library. Eleven
pure modules, 360 passing tests, and **ten of the eleven had zero production
callers**. There was no table to write to, so nothing wrote.

This run built the persistence layer underneath it and the guards around it:
**11 tables** declared in Drizzle, mirrored into Prisma, with the migration
generated offline and committed (unapplied); a **pure mapper** from snapshot to
row that refuses seven named contradictions rather than guessing; a
**tenant-scoping guard** wired into `npm run check`; and a **310-row census**
taken from source by five parallel readers forbidden to cite prior docs.

The census refuted **six written claims**, five of them file headers advertising
capabilities that were never built — including two files that each name the
other as the enforcement point for tenant scoping while neither enforces.

**Three launch blockers were found that nobody was looking for.** The billing-line
writer counts-then-inserts outside a transaction against a table with no unique
constraint, so overlapping cron ticks double-bill. The Zaptec CDR import resolves
a driver by token value with **no org filter**, so a token collision across
tenants bills a foreign driver. And both driver money endpoints render aurar as
krónur, so **a 649.88 kr session displays as 64,988 kr — live, today** — and the
defect is pinned by a *passing* test.

One hardening shipped: the two by-id session reads now check the row's tenant,
using the same helper pair the same file already used 120 lines below. The
`/full` variant serves raw signed OCMF meter evidence on `?include=raw`, so that
read was handing over another tenant's proof, not just a total.

Seven fool tests run, **seven caught**. 11 of 12 checks pass; the twelfth was red
before this branch existed and I proved it with `git cat-file`.

---

## Run facts

| | |
|---|---|
| Agent | `claude-a` |
| Status | complete |
| Start (UTC) | 2026-08-11T08:39:11Z |
| End (UTC) | 2026-08-11T09:33:38Z |
| Wall clock | 54 minutes |
| Target (4–8 h) | **not met** — see below |
| Worktree | `E:\Claude\Straumvakt-core-billing` |
| Branch | `scratch/claude-a-core-billing-2026-08-10` (scratch — safe to edit) |
| Start tip | `47a99f6` |
| End tip | `a615a52` |
| Dirty at end | **0** |
| Commits | 7 |
| Files changed | 29 (+17,484 / −6) |

### Why the run is under target

Stated plainly rather than padded. Three things bounded it:

1. **The census was parallelised.** Five readers over disjoint areas produced 310
   rows and 63 findings in twelve minutes of wall clock and 761k tokens of
   reading. Sequentially that is most of a day. The output is the same; the
   clock is not.
2. **Every route this prompt asks for is blocked on a table that cannot be
   applied.** The prompt forbids database access, and correctly so. The
   implementable surface was: schema declarations, generated SQL, pure mappers,
   contracts, guards and tests — all of which landed. A route written against an
   unapplied table would be the fifth billing generation started before the
   fourth had storage.
3. **The fallback queue was worked: 10 of 12 items**, not 8. Skipped: the
   30-Gherkin item was delivered as 30 scenarios (done) and the "final source
   diff review" is below rather than as a separate doc.

I did not stop early for lack of work. I stopped because the next thing to do
requires either a database or a decision, and both are Andri's.

---

## What landed

### Schema — `apps/api/drizzle/0002_powerful_warbird.sql`, generated, **unapplied**

11 `CREATE TYPE`, 11 `CREATE TABLE`, 26 `CREATE INDEX`. No `ALTER`, no `DROP`,
touches no existing object.

`billing.billing_periods` · `session_settlements` · `settlement_components` ·
`settlement_holds` · `statements` · `statement_lines` ·
`statement_delivery_attempts` · `statement_exports` · `mutation_receipts` ·
`reports.driver_activity_month` · `connector_activity_month`.

Three properties are enforced by **keys**, not by handler code, because handler
code is what was missing every previous time:

- **Rate lock-in.** `settlement_components` stores unit price and effective
  window as **copies**. `rate_version_id` records provenance but is not the path
  the price is read back through, so editing a rate row later cannot restate a
  settled session. `resolve-tariff-chain.ts` structurally cannot do this: its
  input is `{ siteId, chargingStationId }` with no timestamp, and it runs at
  **stop**.
- **No double-billing.** `session_settlements` keyed on `session_id` alone;
  `statements` on `(period_id, recipient_kind, recipient_id)`;
  `settlement_components` on `(session_id, kind)`; `statement_lines` on
  `(statement_id, line_no)`. A retried commit collides.
- **No silent zero.** An unsettleable session gets a `settlement_holds` row
  naming a `ReviewReason` and is listed by id in `excluded_session_ids`.
  Excluding a session and pricing it at zero look identical to a customer.

`mutation_receipts` is deliberately **not** `events.idempotency_keys`: that table
has no `org_id` so no purge or audit can be tenant-scoped, its `scope` is the
literal `"ocpp"` in both writers, and its `expires_at` is written by both writers
and read by neither — an expired row suppresses a replay permanently.

**`rate_books` was requested and deliberately not added.**
`agreements.rate_references` already *is* the rate book; what it lacks is a
unique on `(cost_factor_id, code, effective_from)`. `CREATE UNIQUE INDEX` can
fail on existing duplicates and this migration is otherwise unfailable, so the
dedupe-then-index sequence is written up as its own migration with the duplicate
query supplied.

### Code

- **`apps/api/src/lib/billing/settlement-rows.ts`** — pure mapper, typed against
  the real tables via `$inferInsert` so a column rename breaks the build rather
  than a handler. Seven named refusals. `orgId` is passed separately and
  **compared** to the payload's own rather than read from it.
- **`apps/api/src/lib/billing/statement-zod.ts`** — contracts for 8 routes that
  do not exist. Exported as data so tests assert the properties.
- **`scripts/check-orgid-param.mjs`** — 75 gate occurrences / 36 file:verb pairs,
  each with a reason. Fails on the 76th **and** when one is fixed and left in the
  list. Wired into `check-all`.
- **`routes/admin/billing.ts`** — the two by-id session reads now scope-check.
- **`packages/commercial/.../settlement.ts`** — `snapshotIsImmutableUnder`
  rewritten; `repriceExVat` split out.
- **Two pre-existing build defects fixed:** `npm run db:generate:sql` never
  worked (`npm exec` does not change cwd, so drizzle-kit looked for
  `drizzle.config.json` in the repo root and exited — the documented schema-change
  workflow could not be run as written); and a `*.test.ts` beside a schema file
  kills `generate`, with a `!` exclusion pattern silently ignored.

### Documents — nine, all in the worktree's `docs/notes/`

census (310 rows) · schema survival · tenant scoping · market readiness ·
correction audit · verb census · 30 work packages · 30 scenarios + 20 API
examples · operations pack.

---

## Checks run

| Check | Result |
|---|---|
| `npm test` | **68 files, 1185 passed, 1 skipped** (134 tests added this run, 191 assertion sites) |
| `npm run typecheck` | pass, all six workspaces |
| `npm run check` | **11 of 12 pass** |
| `check:schema-consistency` | pass — 77 tables / 938 columns |
| `check:api-schema` | in sync (9 files) |
| `check:orgid-param` | pass — 75 allowlisted |
| `drizzle-kit generate` (re-run) | "No schema changes" — migration captured everything |
| Both Prisma clients | regenerate clean |
| `check:work-view` | **FAIL — not mine** |

**Proof the failure is unrelated:** it byte-compares
`src/app/(app)/admin/work/page.tsx`.
`git cat-file -e 47a99f6:src/app/(app)/admin/work/page.tsx` → *does not exist*.
`git log --diff-filter=D` → deleted in `5f810a9` ("park the operator console"),
before this branch started. None of its three inputs (`WORKSPACE.md`, `TASKS.md`,
the page) is touched by any commit here.

### Fool tests — 7 sabotages, 7 caught, all restored

| # | Sabotage | Caught by |
|---|---|---|
| 1 | remove org scoping on the mapper | 3 cross-tenant tests |
| 2 | move rate lock from session start to pricing date | 4, incl. two in `settlement.test.ts` |
| 3 | compare total against unrounded aurar | 5 |
| 4 | let a CDR mismatch through as billable | 3 |
| 5 | make statement identity non-deterministic | 1 |
| 6 | leak a foreign session id into the excluded list | 1 |
| 7 | accept an expired rate window | 3 |

**Sabotage 5 was caught by the package's own test, not by mine.** My
determinism test calls the same function twice with the same inputs, so a
deterministic-but-wrong identity still passes it. Worth saying rather than
claiming credit.

---

## Corrected findings

Full list in `docs/notes/2026-08-11-core-billing-correction-audit.md`. The
headline six:

1. `billing-summary.ts:5-6` claims an `orgId` parameter **none** of its five
   functions has.
2. `session-ledger.ts:16-18` names the route as enforcer; the route
   (`billing.ts:57-67`) falls through to no filter. **Neither enforces.**
3. `commercial.prisma:338` names three tables dropped on 2026-08-07.
4. "`recordAuditAction` has no test at all" — narrowed; two files assert audit
   rows through fakes. What is untested is the `isDrizzle` shim.
5. "`recordAuditAction` appears zero times" — refuted; 15 files, 24 call sites.
6. **Finding 8 is half false.** TTL *is* written on every insert. What is true is
   worse: no reader compares `expires_at` to `now()`.

**My own errors, six.** Four caught by a machine (`DeliveryState` missing
`retrying`; a bigint column default drizzle-kit cannot serialise; assuming
`sumRoundedLinesIsk` takes aurar; assuming a backwards meter yields
`meter_unresolvable`). Two caught by reading:

- **I expected partial rate coverage to hold a session. It does not.** A session
  whose DSO window has moved but whose retailer window has not is priced on the
  retailer alone — settled, no hold, under-billed. **Pinned, not fixed**:
  changing that rule is a pricing decision.
- **I overwrote `org-scope.test.ts` believing I was creating it.** It existed and
  covered the harder half. Caught from the commit's diffstat, restored from
  `HEAD~1`, additions appended instead. Verified `git diff HEAD~2 HEAD` on that
  path: **+62, −0**.

And one correction to this run's own census: it placed the aurar defect in
`routes/public/driver-sessions.ts`; it is `repositories/`.

---

## Ten review questions for Andri

Fallback item 12. These are decisions, not tasks.

1. **The 100× defect is live now.** Every driver sees a figure 100× too large.
   Fixing it turns a passing test red (`driver-sessions.test.ts:246` asserts
   `costIsk: 64988`). Should that ship on its own, ahead of everything here?
2. **Partial rate coverage** — hold the session, or price it on whatever windows
   cover its start? Today it silently under-bills and nobody is told.
3. **Is 0.05 kWh the agreed CDR tolerance?** It is a default in a pure module,
   not a policy anyone has signed, and it decides which sessions a human sees.
4. **What makes a driver "active"?** `subscription.ts` says "charging or
   reporting activity". Reporting activity has no persisted event of any kind.
   This is 50 kr per driver per month of real revenue.
5. **Support context: build it or delete it?** Three shadow implementations, zero
   enforcement, and `platform.impersonate` / `platform.support.action` gate
   nothing. Shipping neither is the current state and it reads as a control that
   exists.
6. **Do corrections edit a settlement, or land as a next-period line?** I designed
   the latter. It is the accounting answer and it is not reversible cheaply.
7. **Seven verbs are used under both scoping conventions.** The same permission
   means "your org" at one call site and "every org" at another. Which convention
   wins per verb?
8. **`audit.actions.org_id` cascades on org delete.** Deleting an org destroys
   its entire audit trail, including any record of who read what. Intended?
9. **Retention.** Icelandic accounting retention and a driver's erasure request
   point in opposite directions, and export files contain driver-level financial
   data with no R2 lifecycle rule. Nobody has decided.
10. **Merge order.** Do the Drizzle + Prisma declarations merge now, ahead of any
    handler? They are inert, `check:schema-consistency` needs both sides moving
    together, and the rollback is one transaction — but only until the first
    route lands.

---

## External state

**None changed.** No push, no deploy, no merge, no branch deletion, no migration
run, no Cloudflare mutation, no Neon mutation, no GitHub remote mutation, no DDL
against any database, no secrets or `.env` opened, no charger commanded, no
BLE/NFC, no hardware. No new top-level folder under `E:\Claude`. Nothing written
into the canonical checkout except these two completion artifacts.

Everything is local commits on the scratch branch. The worktree is clean.
