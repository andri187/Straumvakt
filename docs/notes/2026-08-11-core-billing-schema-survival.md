# Core billing schema survival slice — 2026-08-11

**Status: implemented, not applied.** Eleven tables are declared in Drizzle
(authoritative), mirrored into Prisma (downstream), and the migration SQL is
generated and committed at `apps/api/drizzle/0002_powerful_warbird.sql`. Nothing
has been applied to any database. `check:schema-consistency` reports 77 tables /
938 columns and agrees; both Prisma clients regenerate; typecheck is green across
all six workspaces.

## Why implement rather than propose

The prompt allowed a docs-only draft. Three facts made implementation the safer
option:

1. **`drizzle-kit generate` needs no database.** It diffs the declarations
   against the committed snapshot, not against a live server. Verified: the run
   that produced `0002` and the confirming re-run ("No schema changes") both
   worked with no `DATABASE_URL`.
2. **A design doc cannot be checked.** `check:schema-consistency` compares
   Drizzle to Prisma and fails on any divergence; a Markdown table is compared to
   nothing. The census found five source headers describing capabilities that
   were never built, all of which would have passed any doc review.
3. **The SQL is the design.** Generating it exposed two things prose would have
   hidden: a bigint column default that drizzle-kit cannot serialise, and an
   enum member (`DeliveryState.retrying`) I had dropped in the first draft.

Both were caught before commit. See *Wrong on first attempt* below.

## What the pure modules already decided

Nothing in this slice invents a concept. Every enum is copied from a union that
already exists in `packages/commercial/src/core-billing` and is already tested
there:

| Postgres enum | Source union | Members |
|---|---|---|
| `billing.PeriodState` | `period-close.ts:34` | 3 |
| `billing.SettlementStatus` | `settlement.ts:52` | 2 |
| `billing.SettlementProvenance` | `settlement.ts:39` | 4 |
| `billing.ProvenanceState` | `provenance-state.ts:34` | 7 |
| `billing.ReviewReason` | `settlement.ts:43` | 7 |
| `billing.RateComponentKind` | `settlement.ts:57` | 3 |
| `billing.StatementRecipientKind` | `statement.ts:45` | 2 |
| `billing.StatementLineKind` | `statement.ts:47` | 6 |
| `billing.DeliveryChannel` | `delivery-log.ts:31` | 3 |
| `billing.DeliveryState` | `delivery-log.ts:59` | 6 |
| `billing.CorrectionReason` | `period-close.ts:125` | 6 |

`packages/shared/src/db/tests/core-billing-enums.test.ts` asserts each one
member-for-member and in order (Postgres `ALTER TYPE ... ADD VALUE` appends, so a
reordered enum is a different migration than an extended one). The unions are
restated in the test rather than imported: importing them would make the check
tautological in one direction, since a value deleted from both sides at once
would still pass.

## Deviation from the requested table list

The prompt asked for `rate_books` / rate windows / DSO-rate composition **"if
absent"**. They are not absent, and adding a fourth rate table would make the
problem worse. `agreements.rate_references` already is the effective-dated rate
book, with `code`, `basis`, `price_minor`, `effective_from`, `effective_until`
and a `supplier_org_id`.

What is missing is two different things:

1. **Uniqueness.** `RateReference` carries only `@@index([code, effectiveFrom desc])`
   — no `@@unique`. Two rows with the same `code` and the same `effective_from`
   are storable, so "the rate in force at session start" can be genuinely
   ambiguous, which is exactly the input `rate-window.ts` assumes the caller can
   select deterministically. A retried `POST` to the create route silently stages
   a duplicate rate version.
2. **A copy at settlement time**, so a later edit to the rate row cannot restate
   a session already priced against it.

This slice delivers (2) as `billing.settlement_components` — `unit_price_minor`,
`effective_from` and `effective_until` are **copies**, and `rate_version_id`
records provenance without being the path the price is read back through. That
is the property `resolve-tariff-chain.ts` structurally cannot have: its
`ResolveInput` is `{ siteId, chargingStationId }` with no timestamp at all, and
it is called at **stop**, not at start.

**(1) is deliberately not in this migration.** `CREATE UNIQUE INDEX` on a table
with existing rows fails if duplicates are already there, and this migration is
otherwise purely additive and cannot fail. The dedupe-then-index sequence belongs
in its own migration, gated on a count query, and it must be run against a
database — which this prompt does not authorise. Written up under *Follow-up
migration* below.

## The three properties enforced by keys, not by handler code

Handler code is what was missing every previous time, so none of these depends
on it.

**Rate lock-in** — `settlement_components` stores price and window as copies.
Today `reports.session_ledger` stores one mutable `tariff_definition_id`, and the
`compute_rule` JSONB behind it is edited in place, so editing a tariff silently
restates every session ever priced against it.

**No double-billing** — `session_settlements` is keyed on `session_id` alone;
`statements` on `(period_id, recipient_kind, recipient_id)`;
`settlement_components` on `(session_id, kind)`; `statement_lines` on
`(statement_id, line_no)`. A retried commit collides. Contrast
`lib/agreement/persist.ts:359-401`, which counts then inserts, outside a
transaction, against a table with no unique constraint — two concurrent billing
ticks both observe zero and both insert a full set of lines.

**No silent zero** — an unsettleable session gets a row in `settlement_holds`
naming a `ReviewReason`, and is listed by id in `statements.excluded_session_ids`.
Excluding a session from a bill and pricing it at zero look identical to a
customer; they must not look identical in storage.

## Per-table specification

Columns are in the migration; this covers the nine properties the prompt asked
for per table. "Test that fails if omitted" names a test that exists today or one
this design obliges.

### 1. `billing.billing_periods`

- **Tenant scope** — `org_id NOT NULL`. Every read is `WHERE org_id = $1`.
- **Natural key** — `(org_id, period_year, period_month)`, unique. Core bills
  whole calendar months, so there is no free date range for two callers to
  disagree about. `billingPeriodSchema` in `statement-zod.ts` rejects a
  `from`/`to` pair for the same reason.
- **Idempotency** — the natural key. A second "open July" is a collision, not a
  second row.
- **Rollback** — `DROP TABLE`. Nothing references it until settlements exist.
- **Migration order** — 1. Everything else references `period_id`.
- **Read path** — period preview/close screens; `GET .../periods/:year/:month`.
- **Write path** — created on first preview of a month; `state` advances
  `open → closing → closed`; `reopened_at` records the exception.
- **PII** — none. `closed_by_user_id` is an internal actor id.
- **Test that fails if omitted** — `canClosePeriod` has nowhere to record
  `blockersAtClose`, so a period closed over three held sessions becomes
  indistinguishable from one closed clean.

### 2. `billing.session_settlements`

- **Tenant scope** — `org_id NOT NULL`, plus indexes leading with `org_id` so a
  scoped read cannot accidentally seq-scan the tenant boundary away.
- **Natural key** — `session_id`, and it *is* the primary key.
- **Idempotency** — total, by construction. `reports.session_ledger` already
  proves the pattern: `session_id @id`, three separate writers, all upsert safe.
- **Rollback** — `DROP TABLE`. Read by nothing yet.
- **Migration order** — 2.
- **Read path** — period preview counts; statement generation; driver history.
- **Write path** — one upsert per session from `buildSettlementSnapshot`.
  `committed_at` is set when the period closes and the row becomes immutable.
- **PII** — `driver_user_id` links a person to money and location-adjacent times.
  Never expose in a cross-tenant read; see the driver read surface note in
  Phase 4.
- **Test that fails if omitted** — `snapshotIsImmutableUnder` has nothing to
  assert against; rate lock-in becomes untestable end to end.

**Corrections do not edit this row.** A settled session in a closed period is
immutable; a correction lands as a `correction` statement line in a *later*
period, which is what `CorrectionReason` exists for. That is the accounting
answer and the only one that survives an auditor asking what the customer was
told in July.

### 3. `billing.settlement_components`

- **Tenant scope** — `org_id NOT NULL` (denormalised from the settlement so a
  component query needs no join to be safe).
- **Natural key** — `(session_id, kind)`. One DSO, one retailer, one CPO add-on
  per session.
- **Idempotency** — the unique index. A retried commit collides.
- **Rollback** — `DROP TABLE`.
- **Migration order** — 3.
- **Read path** — "why was I charged this" on a driver statement; dispute
  investigation.
- **Write path** — written with the settlement, in the same transaction.
- **PII** — none directly; joins to a driver through `session_id`.
- **Test that fails if omitted** — `coversSessionStart` cannot be checked against
  anything durable, and the `no_rate_at_session_start` hold reason becomes
  unreachable in practice.

### 4. `billing.settlement_holds`

- **Tenant scope** — `org_id NOT NULL`.
- **Natural key** — `(session_id, reason)`. A session can be held for several
  reasons at once and each needs clearing separately.
- **Idempotency** — the unique index; re-raising the same hold is a no-op.
- **Rollback** — `DROP TABLE`.
- **Migration order** — 4.
- **Read path** — the review queue; the blocker list on period preview.
- **Write path** — raised by settlement; resolved by an operator with a
  `resolution` and a **`resolution_note`**.
- **PII** — `resolution_note` is free text an operator writes about a customer
  dispute. Treat as customer-visible-in-discovery; do not log it.
- **Test that fails if omitted** — `resolveHoldRequestSchema`'s
  `note`-is-required rule (already tested in `statement-zod.test.ts`) has no
  storage, so "resolved" becomes indistinguishable from a mis-click.

### 5. `billing.statements`

- **Tenant scope** — `org_id NOT NULL`.
- **Natural key** — `(period_id, recipient_kind, recipient_id)`. A driver has
  exactly one statement for July.
- **Idempotency** — the natural key, plus `statement_key` carrying
  `statementIdentity()`'s deterministic FNV-1a. Same content on retry → same key
  → recognisably the same document. Different content under the same natural key
  is the `already_generated_with_different_content` refusal the pure module
  already returns and nothing could previously act on.
- **Rollback** — `DROP TABLE`, after `statement_lines` and
  `statement_delivery_attempts`.
- **Migration order** — 5.
- **Read path** — org statement list; driver's own billing material.
- **Write path** — generated after period close; superseded (never edited) via
  `superseded_by_statement_id`.
- **PII** — `recipient_id` plus a total is a financial record about a named
  person. `excluded_session_ids` must contain only this org's sessions —
  `buildDriverStatement` already drops foreign snapshots rather than billing
  them, and a cross-tenant id leaking into this column would put another
  tenant's session id on a customer-facing document.
- **Test that fails if omitted** — `statementTotalIsConsistent` and
  `statementExcludesReviewSessions` have nothing durable to check.

### 6. `billing.statement_lines`

- **Tenant scope** — `org_id NOT NULL`, denormalised.
- **Natural key** — `(statement_id, line_no)`.
- **Idempotency** — the unique index; a regenerate cannot interleave old and new
  lines, and the document has a stable printed order.
- **Rollback** — `DROP TABLE` before `statements`.
- **Migration order** — 6.
- **Read path** — the statement itself, and its export.
- **Write path** — written with the statement, same transaction.
- **PII** — `description` is customer-facing prose.
- **Test that fails if omitted** — the whole rounding contract. `amount_minor`
  is the unrounded aurar figure kept for audit; `amount_isk` is the billed
  whole-króna figure; the header total is the **sum of these**, not the rounding
  of the aurar sum. On the canonical three-line fixture the two differ (889 vs
  888) and the customer-facing answer is 889. Store only one of them and the
  distinction is unrecoverable.

### 7. `billing.statement_delivery_attempts`

- **Tenant scope** — `org_id NOT NULL`.
- **Natural key** — `(statement_id, idempotency_key)`.
- **Idempotency** — client-supplied key, unique per statement. A retried send is
  recognisably the same request; `resend: true` is an explicit, separate key.
- **Rollback** — `DROP TABLE`.
- **Migration order** — 7.
- **Read path** — delivery status on the statement; a retry sweeper claiming
  `(state, not_before)`.
- **Write path** — modelled on `ocpp.outbound_commands`, which already does this
  correctly in this codebase: claim with a single atomic
  `UPDATE ... WHERE id = $1 AND state = 'pending' RETURNING`, then record the
  outcome. Never claim-then-update in two statements.
- **PII** — `destination` is an email address, captured at send time on purpose:
  recipients change and the record must not.
- **Test that fails if omitted** — every delivery test in `delivery-log.test.ts`
  is currently about a type. The specific failure this table exists to prevent:
  `email.ts:45-51` **fails open** when `RESEND_API_KEY` is absent, so a statement
  "delivered" with no provider configured is today indistinguishable from one
  that reached the customer. `outcome_kind` (`not_configured`) and
  `provider_message_id` are what separate them.

### 8. `billing.statement_exports`

- **Tenant scope** — `org_id NOT NULL`.
- **Natural key** — `(org_id, idempotency_key)`.
- **Idempotency** — that key. A double-click produces one export.
- **Rollback** — `DROP TABLE`.
- **Migration order** — 8.
- **Read path** — download history; support answering "which file did they get".
- **Write path** — one row per generated file; `storage_key` null while the
  export is served inline.
- **PII** — the *file* contains driver-level financial data. This table holds
  only a pointer and a hash; retention of the object itself is an R2 lifecycle
  decision, listed as open in Phase 7.
- **Test that fails if omitted** — `content_hash` is what makes "the export
  disagrees with the screen" a checkable claim instead of an argument. There is
  no file export anywhere in the tree today — zero hits for `text/csv`,
  `Content-Disposition` and `attachment;` across `apps/api/src` and `src` — so
  there is no legacy to reconcile with.

### 9. `billing.mutation_receipts`

- **Tenant scope** — `org_id NOT NULL`. This is the whole reason it is not
  `events.idempotency_keys`.
- **Natural key** — `(org_id, scope, idempotency_key)`.
- **Idempotency** — it *is* the idempotency. `request_hash` catches what the key
  alone cannot: the same `Idempotency-Key` sent with a **different body**, which
  must 409 rather than replay the first response.
- **Rollback** — `DROP TABLE`. Losing it costs replay protection, not data.
- **Migration order** — 9 (independent; can go first).
- **Read path** — every mutating Core billing route, **with an
  `expires_at > now()` predicate**.
- **Write path** — insert on success with the response body and status.
- **PII** — `response_body` may contain a statement total. Purge is therefore not
  optional; see below.
- **Test that fails if omitted** — every idempotency assertion in
  `statement-zod.test.ts` is currently about a schema. Nothing enforces it at
  runtime, and no route in the tree reads an `Idempotency-Key` header at all
  (zero hits across `apps/api/src`, `gateway/src` and `packages`).

**Why not `events.idempotency_keys`,** which already exists: it has no `org_id`,
so neither a purge nor an audit can be tenant-scoped; its `scope` is the
hardcoded literal `"ocpp"` in *both* writers, so adopting it means editing the
OCPP ingest hot path; and its `expires_at` is written on every insert and read by
nobody — neither reader compares it to `now()`, so an expired row suppresses a
replay permanently and the `@@index([expiresAt])` supports a sweeper that was
never written. Financial receipts need a different retention story from protocol
dedupe, and sharing the table would inherit that bug. **This table must ship with
its purge, or it reproduces the same defect one schema over.**

### 10. `reports.driver_activity_month`

- **Tenant scope** — `org_id NOT NULL`.
- **Natural key** — `(org_id, period_year, period_month, driver_user_id)`.
- **Idempotency** — the natural key; the monthly job can re-run.
- **Rollback** — `DROP TABLE`.
- **Migration order** — 10.
- **Read path** — `computeCoreSubscription`'s driver count; the 50 kr line.
- **Write path** — written once per month, **never recomputed**. That is the only
  way the number stays defensible.
- **PII** — links a person to an org and a month.
- **Test that fails if omitted** — this figure *is* revenue and it cannot be
  derived after the fact. `subscription.ts:10` counts a driver active on
  "charging or reporting activity"; `charging.sessions.user_id` is **nullable**;
  "reporting activity" has no persisted event of any kind; and
  `agreements.driver_group_memberships` has `added_at` **only**, with a
  `@@unique([driverGroupId, userId])` that forbids the second row history would
  need — removal is a hard delete leaving nothing behind. `source` records *why*
  the driver counted, so a disputed 50 kr has an answer.

### 11. `reports.connector_activity_month`

- **Tenant scope** — `org_id NOT NULL`.
- **Natural key** — `(org_id, period_year, period_month, connector_id)`.
- **Idempotency** — the natural key.
- **Rollback** — `DROP TABLE`.
- **Migration order** — 11.
- **Read path** — the 200 kr line and the 450 kr cap.
- **Write path** — once per month.
- **PII** — none.
- **Test that fails if omitted** — same shape as the driver side, other cause:
  `assets.connectors` carries a **mutable** `status` plus `status_updated_at` and
  no history, and `assets.charging_stations` has no status, active or removed
  column anywhere in its 150 lines. A charger removed in August leaves no
  evidence it was billable in July. `cap_applied_isk` is stored rather than
  recomputed because the cap depends on the same month's driver count, and
  recomputing later would use whatever roster is current then.

## Migration order and blast radius

`0002_powerful_warbird.sql` is **purely additive**: 11 `CREATE TYPE`, 11
`CREATE TABLE`, 26 `CREATE INDEX`. It contains no `ALTER`, no `DROP`, and touches
no existing object. Applied to an empty-of-these-tables database it cannot fail
on data, only on a name collision — and the three names that were previously
used (`billing.statements`, `billing.invoices`, `billing.invoice_lines`) were
dropped on 2026-08-07 by `20260807120000_drop_never_used_tables`. Only
`statements` is reused, with a different shape.

No foreign keys are declared, matching the file's existing convention: Drizzle
needs them only for `db.query` relational reads, every ported repository uses
explicit joins, and a wrong FK declaration would be a silent lie about cascade
behaviour. The consequence is that `period_id`, `statement_id` and `session_id`
integrity is the application's job — which is worth stating plainly rather than
assuming, because the *existing* `audit.actions.org_id` FK does carry
`onDelete: Cascade`, so deleting an org deletes its whole audit trail.

**Rollback for the whole slice** is one transaction: drop the 11 tables in
reverse dependency order, then the 11 types. Nothing outside this slice
references any of it. That is true today and stops being true the moment a route
lands, which is the sequencing argument in Phase 7.

## Follow-up migration, not in this one

`agreements.rate_references` needs `UNIQUE (cost_factor_id, code, effective_from)`.
It is not here because `CREATE UNIQUE INDEX` fails on existing duplicates and
this migration is otherwise unfailable. The sequence:

1. `SELECT cost_factor_id, code, effective_from, count(*) FROM agreements.rate_references GROUP BY 1,2,3 HAVING count(*) > 1;`
2. If non-empty: a human decides which row was in force. This is not automatable
   — the whole point is that the system cannot currently tell.
3. `CREATE UNIQUE INDEX CONCURRENTLY` (outside a transaction).
4. Only then can `selectRateVersions` promise a deterministic answer.

Step 1 requires a database connection this prompt does not authorise. Recorded
as a decision needed, with the query written, rather than performed.

## Wrong on first attempt

Two, both caught by generating the SQL rather than describing it.

1. **`deliveryStateEnum` had five members; `DeliveryState` has six.** I dropped
   `retrying`. Nothing would have caught it — drizzle-kit would have produced a
   valid `CREATE TYPE`, the migration would have applied, and the first delivery
   needing a retry would have failed on an `INSERT` months later with a
   constraint error nobody could trace back here. This is why
   `core-billing-enums.test.ts` exists and why it restates the unions instead of
   importing them.
2. **`plug_time_fee_minor` had `.default(0n)`.** drizzle-kit dies on it —
   `TypeError: Do not know how to serialize a BigInt` — from inside
   `diffSchemasOrTables`, with no column named in the message. Removed, which is
   also the better design: no other money column in the file has a default, and a
   session with no plug-time fee should record `0n` because the caller decided
   so, not because the database filled it in.

Two build-tooling defects were fixed as a side effect, both pre-existing:

- **`npm run db:generate:sql` never worked.** It was
  `npm --prefix apps/api exec -- drizzle-kit generate`; `npm exec` does not
  change the working directory, so drizzle-kit looked for `drizzle.config.json`
  in the repo root and exited. The documented schema-change workflow — the one in
  the banner at the top of `drizzle.config.ts` and in `FOCUS.md:161-171` — could
  not be run as written. Now delegates to a script inside `apps/api`, where
  `npm run --prefix` does set cwd. Verified end to end.
- **A `*.test.ts` beside a schema file kills `generate`.** The `schema` glob is
  single-level with no exclusion, and drizzle-kit `require()`s every match as
  CommonJS; vitest refuses to be `require()`d, so the failure is a CJS stack
  trace mentioning no schema at all. A leading `!` pattern is silently ignored —
  I tried it and it did not work. Schema tests therefore live in
  `packages/shared/src/db/tests/`, and the config now says so.

## What this slice deliberately does not do

- **No route reads or writes any of these tables.** Eleven tables with no
  handler are inert. Eleven tables with a half-written handler are a way to
  persist a wrong number.
- **No FK constraints**, per file convention.
- **No `rate_references` unique index**, per the argument above.
- **No purge job** for `mutation_receipts`. The table is declared with
  `expires_at` and an index; the sweeper is Phase 7 work, and shipping the table
  without it reproduces the exact bug the design section criticises.
- **No data migration** of `reports.session_ledger` into `session_settlements`.
  It could not be faithful: the ledger stores one mutable
  `tariff_definition_id` and no unit price, so a backfilled settlement would be
  a fabricated snapshot wearing the clothes of a locked one.
