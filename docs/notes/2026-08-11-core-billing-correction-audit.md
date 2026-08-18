# Second-pass correction audit — Core billing persistence run, 2026-08-11

Written after re-reading everything this run produced. Corrections are listed,
not buried in prose.

---

## Q1. Which prior Claude A finding did this run refute or narrow?

**Six, plus one of my own comments.** Five of the six are file headers describing
capabilities that were never built — the kind of line a reader trusts without
checking.

1. **`repositories/billing-summary.ts:5-6`** — "All functions take `orgId = undefined`
   for platform-admin (no filter) or a specific `orgId` for tenant-scoped reads."
   **REFUTED.** None of the five exported functions has an `orgId` parameter
   (:25, :53, :110, :147, :208). It is not a cross-tenant leak — the gate is
   platform-only — but there is no per-org billing summary read anywhere, and
   the header says there is.

2. **`repositories/session-ledger.ts:16-18`** — "Scope authorisation is the
   CALLER's job… This repo trusts the scope it receives." **REFUTED at the other
   end.** `routes/admin/billing.ts:57-67` builds `LedgerScope` purely from query
   params and falls through to `{ kind: "admin" }` (no filter) when none are
   supplied. Each side documents the other as the enforcement point; **neither
   enforces**.

3. **`prisma/schema/commercial.prisma:338`** — "site_energy_daily and
   charger_uptime_daily are declared in assets.prisma; command_history in
   protocol.prisma." **REFUTED.** All three were dropped on 2026-08-07. The
   comment would mislead anyone sizing the reporting surface.

4. **`19A-source-inventory.md:201` / `19C:516`** — "`recordAuditAction` has no
   test at all." **NARROWED.** No `audit.test.ts` exists, correct — but
   `installation-ocpp.test.ts` and `driver-access-requests.test.ts` both assert
   audit rows through in-memory fakes, including three refusal cases asserting
   `audits.length === 0`. What is genuinely untested is the **shim**: nothing
   drives both branches of `isDrizzle`.

5. **`19-source-linked-implementation-readiness.md:101`** — "`recordAuditAction`
   appears zero times." **REFUTED.** 15 source files, 24 call sites.

6. **Finding 8 as posed to this run** ("idempotency keys exist but may lack
   TTL/purge or route-specific scope") — **NARROWED, and one half is FALSE.**
   TTL *is* written, on every insert, in two files with a duplicated constant.
   What is true is worse: **no reader ever compares `expires_at` to `now()`**, so
   an expired row suppresses a replay permanently and the index supports a
   sweeper that was never written. No purge exists. Scope is the hardcoded
   literal `"ocpp"` in both writers.

7. **My own comment, from this lane's previous run** —
   `delivery-log.ts:5` says "Straumvakt sends email from 11 call sites and
   records the outcome at none of them." The second clause is exactly right; the
   count is **8**. Immaterial to the argument, corrected because the module's own
   header is the kind of number a reader will trust.

**And one correction to this run's own census:** it reported the aurar defect in
`routes/public/driver-sessions.ts`. The file is `repositories/driver-sessions.ts`.
The finding is unchanged; the path was wrong. Fixed in the census and in the
source comment that quoted it.

---

## Q2. Which new code assumption was wrong on first attempt?

**Six. Four caught by a machine, two by reading a diffstat.**

1. **`deliveryStateEnum` had five members; `DeliveryState` has six.** I dropped
   `retrying`. Nothing would have caught it: drizzle-kit produces a valid
   `CREATE TYPE`, the migration applies, and the first delivery needing a retry
   fails on an `INSERT` months later with a constraint error nobody can trace
   back. This is why `core-billing-enums.test.ts` exists and why it **restates**
   the unions rather than importing them — importing makes the check tautological
   in one direction.

2. **`plug_time_fee_minor` had `.default(0n)`.** drizzle-kit dies on it —
   `TypeError: Do not know how to serialize a BigInt` from inside
   `diffSchemasOrTables`, naming no column. Removing it is also the better
   design: no other money column in the file has a default.

3. **I assumed partial rate coverage would hold the session. It does not.**
   `buildSettlementSnapshot` raises `no_rate_at_session_start` only when
   `usable.length === 0` (settlement.ts:236), so a session whose DSO window has
   moved but whose retailer window has not is priced on the retailer alone —
   settled, no hold, materially under-billed. **Pinned, not fixed**: changing the
   rule is a pricing decision. It is on the readiness board.

4. **I assumed `sumRoundedLinesIsk` takes aurar. It takes already-rounded ISK** —
   deliberately, so it is structurally impossible to call it with unrounded
   values and get the forbidden answer. `roundingDriftIsk` is the one that takes
   aurar. My test asserted `10n` and got `999n`. I corrected the test.

5. **I assumed a backwards meter yields `meter_unresolvable`. It yields
   `negative_or_impossible_energy`** — and that distinction is right:
   "we could not read it" and "we read it and the answer is impossible" are
   different facts an operator needs to tell apart. Test corrected.

6. **I overwrote `apps/api/src/lib/auth/org-scope.test.ts` believing I was
   creating it.** It existed, and covered the *harder* half — `resolveOrgScope`
   itself, through mocks, including the bootstrap bypass and the case that
   matters most on the next role-bundle change ("a platform grant lacking
   `tenant.read` must NOT fall through to `all`"). Caught by reading the commit's
   diffstat: 180 lines changed on a file I thought was new. Restored from
   `HEAD~1` and my eight assertions appended instead; verified `git diff HEAD~2 HEAD`
   on that file shows **+62 insertions, 0 deletions**. The tenant-scoping note
   carried the same error — it claimed the async half "needs a database and
   belongs in test/parity", which is false since the existing file mocks it —
   and is corrected there too.

**Also fixed, both pre-existing, neither mine:**

- **`npm run db:generate:sql` never worked.** It was
  `npm --prefix apps/api exec -- drizzle-kit generate`; `npm exec` does not
  change the working directory, so drizzle-kit looked for `drizzle.config.json`
  in the repo root and exited. **The documented schema-change workflow — the
  banner at the top of `drizzle.config.ts` and `FOCUS.md:161-171` — could not be
  run as written.**
- **A `*.test.ts` beside a schema file kills `generate`.** drizzle-kit `require()`s
  every glob match as CommonJS and vitest refuses to be `require()`d. A leading
  `!` exclusion pattern is **silently ignored** — I tried it and it did not work.
  Schema tests now live in `packages/shared/src/db/tests/`, and the config says so.

---

## Q3. Which TODO is a real blocker vs polish?

**Real blockers — these change who is charged what:**

| | Why it blocks |
|---|---|
| **Aurar rendered as krónur on both driver endpoints** | Live now. Every driver sees a figure **100× too large**. And it is pinned by a passing test — `driver-sessions.test.ts:246` asserts `costIsk: 64988` — so the fix turns a green test red, and whoever makes it must change the expectation rather than assume they broke something. |
| **`persist.ts:359-401` counts then inserts** | Outside a transaction, against a table with no unique constraint. Two concurrent billing ticks both observe zero and both insert. `dispatcher.ts:54-71` solves the identical problem correctly in one statement in the same codebase. |
| **`zaptec-session-sync.ts:186-189` resolves a driver by token value with no org filter** | A token collision across tenants attributes a billable session — and its ledger `driverUserId` — to a foreign driver. |
| **`email.ts:45-51` fails OPEN when `RESEND_API_KEY` is absent** | A statement "delivered" with no provider configured is indistinguishable from one that reached the customer. |
| **`rate_references` has no unique on `(cost_factor_id, code, effective_from)`** | A retried POST stages a duplicate rate version, and "the rate in force at T" becomes ambiguous for every session priced afterwards. |
| **No active-connector / active-driver source** | This figure *is* the subscription revenue, and it is not reconstructible after the month ends. |

**Polish — real, but nothing bills wrongly because of it:**

- `check:work-view` red on every branch (compares a file deleted in `5f810a9`)
- The stale CI comment claiming "50 files, 686 tests" (the globs match 68)
- `vitest.config.ts:21`'s `src/**/*.test.ts` glob matching zero files
- Gateway's five test files running under no root or CI command
- The duplicated `IDEMPOTENCY_TTL_MS` constant in two files
- Two parallel cost-factor tables with confusable names
- `listAgreements` existing twice with different tenancy

**Neither, and worth naming separately:** support context. It exists in three
places, enforces in none, and its warnings go to `console` rather than
`audit.actions`. That is not a TODO — it is a control that reads as present and
is absent. Either build it or delete it.

---

## Q4. Which part of this can be merged without a DB migration?

Everything below writes nothing and reads nothing new. All of it is committed and
green.

- `scripts/check-orgid-param.mjs` + its test + the `check-all` wiring
- The two by-id session-read scope checks in `routes/admin/billing.ts`, plus the
  eight assertions added to `org-scope.test.ts`
- `apps/api/src/lib/billing/statement-zod.ts` + its 51 assertions — contracts for
  routes that do not exist, exported as data so the tests check the properties
  rather than restating them
- `apps/api/src/lib/billing/settlement-rows.ts` + its 58 assertions — a pure
  mapper that performs no I/O
- `snapshotIsImmutableUnder` now checking something, and `repriceExVat`
- `packages/shared/src/db/tests/core-billing-enums.test.ts`
- The `db:generate:sql` fix and the `drizzle.config.ts` note
- All five documents

The Drizzle and Prisma **declarations** can merge too — they are inert until
something queries them, and `check:schema-consistency` needs both sides to move
together. But see Q5.

---

## Q5. Which part must not be merged before the schema exists?

- **Any route that reads or writes the eleven tables.** None is written, on
  purpose. `CORE_BILLING_ROUTE_CONTRACTS` declares eight and implements zero —
  `statement-zod.ts:11-15` says outright that "a route that pretends to store
  something is worse than no route".
- **Statement generation, delivery, or export paths.**
- **The monthly activity job.**
- **Anything claiming a period can be closed.**
- **`billing.mutation_receipts` without its purge.** The design section
  criticises `events.idempotency_keys` for writing a TTL that nothing enforces
  and having no sweeper. Shipping this table without one reproduces that bug one
  schema over. **The purge belongs in the same change as the first writer.**
- **The `rate_references` unique index.** It is deliberately *not* in `0002`:
  `CREATE UNIQUE INDEX` fails on existing duplicates, and `0002` is otherwise
  additive and unfailable. The dedupe-then-index sequence needs a database, a
  duplicate check, and a human deciding which row was in force — which is
  precisely the thing the system cannot currently tell.

**And the sequencing point behind all of it:** eleven tables with no handler are
inert; eleven tables with a half-written handler are a way to persist a wrong
number. The rollback for this whole slice is one transaction — drop eleven
tables and eleven types, referenced by nothing. That stays true exactly until the
first route lands.

---

## Claims in this run's documents that I verified rather than carried forward

Spot-checked at source after writing, because a census that cites itself is the
failure this run exists to stop.

| Claim | Verified how | Result |
|---|---|---|
| No route reads an `Idempotency-Key` header | grep across `apps/api/src`, `gateway/src`, `packages`, `src` | **holds** — 4 hits, all comments or my own new schema |
| A 649.88 kr session is pinned at `64988n` | `projections.test.ts:397`, `compute-session-cost.test.ts:68` | **holds** |
| "minor = 1/100 króna" is the stated convention | `compute-session-cost.ts:10-24` | **holds**, and states aurar explicitly |
| The aurar defect is on two endpoints | `driver-sessions.ts:95/137/270`, `driver-invoices.ts:66-68` | **holds** — and `driver-sessions.ts` has *two* call sites, not one |
| `work-view` was red before this run | `git cat-file -e 47a99f6:src/app/(app)/admin/work/page.tsx` | **holds** — absent at the start tip; deleted in `5f810a9` |
| Nothing lost when I restored `org-scope.test.ts` | `git diff --stat HEAD~2 HEAD` on that path | **holds** — +62, −0 |
| The census's file path for the aurar defect | `find` | **WRONG** — `repositories/`, not `routes/public/`. Corrected. |
