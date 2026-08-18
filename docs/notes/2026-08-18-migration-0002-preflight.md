# Migration `0002_powerful_warbird` — preflight pack

**2026-08-18 · Claude A · branch `dev/core-billing-integration`**

**Nothing in this document has been executed.** No migration was applied, no
SQL was run against any environment, and no database was connected to while
writing it. Every statement below is derived from
`apps/api/drizzle/0002_powerful_warbird.sql` as committed.

This exists so the decision to apply costs minutes rather than hours.

---

## 1. Every object `0002` creates

**11 types · 11 tables · 26 indexes (10 unique, 16 plain). 48 statements, all
`CREATE`.**

### Types — `billing.*` (11)

| type | values | purpose |
|---|---|---|
| `CorrectionReason` | `cdr_mismatch_resolved`, `meter_fault`, `tariff_misapplied`, `duplicate_session`, `customer_dispute`, `operator_goodwill` | why a later line corrects an earlier one |
| `DeliveryChannel` | `email`, `download`, `webhook` | how a statement reached its recipient |
| `DeliveryState` | `pending`, `sending`, `sent`, `retrying`, `failed`, `abandoned` | delivery lifecycle, including the retry state |
| `PeriodState` | `open`, `closing`, `closed` | whether a billing month may still accept rows |
| `ProvenanceState` | `estimated`, `ocpp_derived`, `cdr_pending`, `cdr_confirmed`, `cdr_mismatch`, `corrected`, `held_manual_review` | what a settled figure is actually evidenced by |
| `RateComponentKind` | `dso`, `retailer`, `cpo_addon` | which supplier a price component came from |
| `ReviewReason` | `no_rate_at_session_start`, `meter_unresolvable`, `cdr_mismatch_beyond_tolerance`, `negative_or_impossible_energy`, `missing_session_times`, `unsupported_compute_rule`, `manual_hold` | why a session is held instead of settled |
| `SettlementProvenance` | `ocpp`, `cdr`, `manual`, `unknown` | which feeder produced the settlement |
| `SettlementStatus` | `settled`, `billing_review_required` | the two terminal states of a session settlement |
| `StatementLineKind` | `session_energy`, `plug_time`, `subscription_connector`, `subscription_driver`, `cap_relief`, `correction` | what a statement line represents |
| `StatementRecipientKind` | `driver`, `organisation` | which of the two money lines a statement belongs to |

### Tables — `billing.*` (9)

| table | purpose |
|---|---|
| `billing_periods` | one row per org per month; carries the open/closing/closed state |
| `session_settlements` | the frozen price of one session — **PK on `session_id`** |
| `settlement_components` | the per-supplier price components behind a settlement, with rate provenance copied |
| `settlement_holds` | why a session was not settled, and whether a human has resolved it |
| `statements` | one document per (period, recipient) |
| `statement_lines` | the numbered lines of a statement |
| `statement_delivery_attempts` | every send attempt, keyed by idempotency key |
| `statement_exports` | generated export artefacts, keyed by idempotency key |
| `mutation_receipts` | request-level idempotency receipts for billing mutations |

### Tables — `reports.*` (2)

| table | purpose |
|---|---|
| `connector_activity_month` | per-connector monthly activity, the source for the flat fee's connector count |
| `driver_activity_month` | per-driver monthly activity, the source for the driver count |

> **Both have zero writers today.** They are the intended source for the
> flat-fee counts and nothing populates them. This is the reason
> `deriveActiveDrivers` refuses — see
> `2026-08-18-tenant-scoping-burn-down.md` and the flat-fee module.

### Indexes (26)

The ten unique indexes are the load-bearing half — they are what makes a
retried generation collide instead of duplicating:

| unique index | what it prevents |
|---|---|
| `billing_periods (org_id, period_year, period_month)` | two open periods for one org-month |
| `connector_activity_month (org_id, period_year, period_month, connector_id)` | double-counting a connector |
| `driver_activity_month (org_id, period_year, period_month, driver_user_id)` | double-counting a driver |
| `mutation_receipts (org_id, scope, idempotency_key)` | replaying a mutation |
| `settlement_components (session_id, kind)` | two DSO components on one session |
| `settlement_holds (session_id, reason)` | the same hold raised twice |
| `statement_delivery_attempts (statement_id, idempotency_key)` | sending the same statement twice |
| `statement_exports (org_id, idempotency_key)` | generating the same export twice |
| `statement_lines (statement_id, line_no)` | two line 3s on one document |
| `statements (period_id, recipient_kind, recipient_id)` | two invoices for one recipient for one month |

Plus `session_settlements.session_id` as **PRIMARY KEY** — stronger than a
unique index, and the eleventh guarantee.

The 16 plain indexes are all read-path: `(org_id, …)` prefixes for tenant
scans, `(state, not_before)` for the delivery sweeper, `(expires_at)` for
receipt expiry.

---

## 2. Proof that it touches no existing object

Counted mechanically over the committed file:

| verb | occurrences |
|---|---:|
| `CREATE TYPE` | 11 |
| `CREATE TABLE` | 11 |
| `CREATE UNIQUE INDEX` | 10 |
| `CREATE INDEX` | 16 |
| `ALTER` | **0** |
| `DROP` | **0** |
| `TRUNCATE` | **0** |
| `INSERT` / `UPDATE` / `DELETE` | **0** |
| `GRANT` / `REVOKE` | **0** |

Reproduce:

```sh
grep -c 'ALTER\|DROP\|TRUNCATE\|INSERT\|UPDATE\|DELETE' apps/api/drizzle/0002_powerful_warbird.sql
```

There are **no foreign keys** to existing tables, so no lock is taken on
`charging.sessions`, `reports.session_ledger` or anything else in the
tree. Every table name is new in its schema, so no `CREATE TABLE` can collide
with an existing relation. The two target schemas, `billing` and `reports`,
already exist.

**Consequence for risk:** this migration cannot corrupt or lock existing data.
The realistic failure modes are (a) a name collision if some object was created
out-of-band, and (b) the transaction failing partway, which rolls back
completely. Neither leaves the database in a state that needs repair.

---

## 3. Read-only duplicate detection — run BEFORE applying

`0002` itself creates unique indexes only on **new, empty** tables, so none of
them can fail on existing data. These queries are therefore not about `0002` —
they establish whether the *existing* tables that `0002`'s guarantees will sit
alongside already contain the duplicates those guarantees assume are impossible.

**All are `SELECT`. None modifies anything. Andri runs these, not an agent.**

```sql
-- 3.1 Does any session already have more than one legacy billing line for the
--     same (factor, kind)? This is the double-billing blocker's fingerprint.
--     Expected: 0 rows. Any row here is a session billed twice, already.
SELECT session_id, factor_code, kind, COUNT(*) AS n
FROM agreements.billing_lines
WHERE session_id IS NOT NULL
GROUP BY session_id, factor_code, kind
HAVING COUNT(*) > 1
ORDER BY n DESC
LIMIT 100;

-- 3.2 How bad, in one number. Run alongside 3.1 so the scale is on the record.
SELECT COUNT(*) AS duplicate_groups,
       COALESCE(SUM(n - 1), 0) AS surplus_rows
FROM (
  SELECT COUNT(*) AS n
  FROM agreements.billing_lines
  WHERE session_id IS NOT NULL
  GROUP BY session_id, factor_code, kind
  HAVING COUNT(*) > 1
) d;

-- 3.3 More than one ledger row per session? reports.session_ledger is what
--     the driver history and the invoices read.
SELECT session_id, COUNT(*) AS n
FROM reports.session_ledger
GROUP BY session_id
HAVING COUNT(*) > 1
LIMIT 100;

-- 3.4 The rate_references duplicate that blocks the index in §4.
SELECT cost_factor_id, code, effective_from, COUNT(*) AS n
FROM agreements.rate_references
GROUP BY cost_factor_id, code, effective_from
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- 3.5 Name collisions: does anything 0002 creates already exist?
--     Expected: 0 rows. Any row means 0002 will fail at that statement.
SELECT n.nspname AS schema, c.relname AS name, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname, c.relname) IN (
  ('billing','billing_periods'), ('billing','session_settlements'),
  ('billing','settlement_components'), ('billing','settlement_holds'),
  ('billing','statements'), ('billing','statement_lines'),
  ('billing','statement_delivery_attempts'), ('billing','statement_exports'),
  ('billing','mutation_receipts'),
  ('reports','connector_activity_month'), ('reports','driver_activity_month')
);

-- 3.6 Type collisions, same question for the 11 enums.
SELECT n.nspname AS schema, t.typname AS name
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'billing'
  AND t.typname IN (
    'CorrectionReason','DeliveryChannel','DeliveryState','PeriodState',
    'ProvenanceState','RateComponentKind','ReviewReason',
    'SettlementProvenance','SettlementStatus','StatementLineKind',
    'StatementRecipientKind'
  );

-- 3.7 Is migration 0001 actually applied? per_connector must exist before the
--     flat-fee feeder can store a rate reference.
SELECT e.enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'agreements' AND t.typname = 'RateBasis'
ORDER BY e.enumsortorder;
-- Expect: per_kwh, per_minute, per_day, per_session, per_connector
```

**How to read 3.1/3.2:** a non-zero result does not block `0002` — it is
evidence that the double-billing defect has already fired in this environment,
and it changes what §4 and the legacy-table index in §9 cost.

---

## 4. The dedupe-then-index migration, written and NOT applied

`agreements.rate_references` already *is* the rate book. What it lacks is a
unique on `(cost_factor_id, code, effective_from)`. Without it, two rate rows
can claim the same window for the same factor, and `pickActiveRate` sorts by
`effective_from` descending and takes `matches[0]` — so which of the two prices
a customer gets depends on row order.

Today the table has only `index().on(code, effective_from)` and
`index().on(cost_factor_id, effective_from)`. Neither is unique.

This is deliberately **not** folded into `0002`. `0002` is currently unfailable
— every statement creates a new object. `CREATE UNIQUE INDEX` on a populated
table can fail, and mixing an unfailable migration with a failable one means a
rollback that did not need to happen.

**Find the duplicates first** (this is §3.4). Then, only if it returns zero
rows:

```sql
-- 0003a — the index, when 3.4 is empty.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  rate_references_cost_factor_code_effective_from_uq
  ON agreements.rate_references (cost_factor_id, code, effective_from);
```

`CONCURRENTLY` because this table is read on the pricing path; it takes no
write lock, cannot run inside a transaction block, and leaves an INVALID index
behind if it fails — which is recoverable with `DROP INDEX CONCURRENTLY`.

**If 3.4 returns rows**, the dedupe is a product decision and not a script.
Two rows with the same `(cost_factor_id, code, effective_from)` and *different*
`price_minor` mean somebody was charged one of two prices and nobody knows
which. Inspect before deleting:

```sql
-- 0003b — inspect, do not delete yet.
SELECT r.*
FROM agreements.rate_references r
JOIN (
  SELECT cost_factor_id, code, effective_from
  FROM agreements.rate_references
  GROUP BY cost_factor_id, code, effective_from
  HAVING COUNT(*) > 1
) d USING (cost_factor_id, code, effective_from)
ORDER BY r.cost_factor_id, r.code, r.effective_from, r.created_at;
```

Only when a human has decided which row survives in each group should anything
be deleted, and that deletion should name the surviving ids explicitly rather
than relying on `ctid` or `created_at` ordering. **A rate row is evidence of
what somebody was charged.**

---

## 5. Runtime and lock profile, per statement

Stated as a reasoned estimate with the reasoning shown, because no timing was
measured — measuring would require running it.

| statement group | n | lock taken | expected runtime | reasoning |
|---|---:|---|---|---|
| `CREATE TYPE` | 11 | none on existing objects | < 1 ms each | an enum is a catalogue row plus its labels; no data is touched |
| `CREATE TABLE` | 11 | `AccessExclusive` on a table that does not exist yet | < 5 ms each | allocates a relfilenode and writes catalogue rows; no FKs to existing tables means no lock on any populated relation |
| `CREATE INDEX` / `CREATE UNIQUE INDEX` | 26 | `Share` on the table just created, which is empty | < 5 ms each | index build cost is a function of row count, and every target has zero rows |
| **whole migration** | 48 | — | **well under one second** | dominated by catalogue writes and one fsync at commit |

**The load-bearing point is not the duration, it is the lock surface.** Because
`0002` creates no foreign key to any existing table, it never takes a lock on
`charging.sessions`, `reports.session_ledger`, `agreements.*` or any other
populated relation. **A concurrent charging session, CDR import or OCPP write
cannot be blocked by this migration.** That is why it is safe to apply during
the day, and it is a property of the migration's content rather than of its
speed.

Drizzle wraps the migration in a transaction, so the honest worst case is: it
fails at some statement, everything rolls back, nothing was created, and no
existing object was ever locked.

The one statement that is **not** in this profile is §4's
`CREATE UNIQUE INDEX CONCURRENTLY` — it runs outside a transaction, scans
`rate_references` twice, and its runtime scales with that table's size. On a
table of the size a pilot implies (hundreds of rows) it is still sub-second.

---

## 6. Rollback, and what stops being reversible

### Immediately after applying, with no rows written

Fully reversible. In dependency order:

```sql
BEGIN;
DROP TABLE IF EXISTS billing.statement_delivery_attempts;
DROP TABLE IF EXISTS billing.statement_exports;
DROP TABLE IF EXISTS billing.statement_lines;
DROP TABLE IF EXISTS billing.statements;
DROP TABLE IF EXISTS billing.settlement_holds;
DROP TABLE IF EXISTS billing.settlement_components;
DROP TABLE IF EXISTS billing.session_settlements;
DROP TABLE IF EXISTS billing.mutation_receipts;
DROP TABLE IF EXISTS billing.billing_periods;
DROP TABLE IF EXISTS reports.driver_activity_month;
DROP TABLE IF EXISTS reports.connector_activity_month;

DROP TYPE IF EXISTS billing."CorrectionReason";
DROP TYPE IF EXISTS billing."DeliveryChannel";
DROP TYPE IF EXISTS billing."DeliveryState";
DROP TYPE IF EXISTS billing."PeriodState";
DROP TYPE IF EXISTS billing."ProvenanceState";
DROP TYPE IF EXISTS billing."RateComponentKind";
DROP TYPE IF EXISTS billing."ReviewReason";
DROP TYPE IF EXISTS billing."SettlementProvenance";
DROP TYPE IF EXISTS billing."SettlementStatus";
DROP TYPE IF EXISTS billing."StatementLineKind";
DROP TYPE IF EXISTS billing."StatementRecipientKind";
COMMIT;
```

Then remove the `0002` row from Drizzle's migrations table so the journal and
the database agree again — **check the actual table name first**, it is
configured in `apps/api/drizzle.config.ts` and is `drizzle.__drizzle_migrations`
by default:

```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;
-- then delete only the 0002 row, by its id, having read it.
```

Indexes and the eleven types go with their tables; no separate step.

### What becomes unrecoverable

**The moment the first settlement row lands, the rollback above destroys
money records rather than empty tables.** Specifically:

1. **`session_settlements` is a frozen price.** It exists precisely so that a
   later rate edit cannot restate it. Dropping it deletes the only record of
   what a session cost at the time it was settled — the source figure in
   `session_ledger` is *not* the same fact, because it carries no rate
   provenance and no VAT split.
2. **`settlement_components` carries copies of unit price and effective
   window.** Those copies are the audit trail. `rate_version_id` points at a
   row that may since have been edited, so the copy is not reconstructible.
3. **`statements` and `statement_lines` are what a customer was sent.** They
   are the legal artefact (FOCUS rule 3 — the invoice header). Regenerating is
   not the same as recovering: regeneration produces what the current rules
   say, not what the customer received.
4. **`statement_delivery_attempts` is the record that a claim was presented.**
   In a dispute, the absence of this row is indistinguishable from never having
   sent the invoice.
5. **`mutation_receipts`** — dropping it makes every previously-completed
   mutation replayable, which is the double-billing hazard re-armed.

So the rollback window is: **from the apply until the first generation run.**
After that, the correct recovery from a bad state is a *forward* migration plus
correction lines (FOCUS rule 4 — money is derived, never destructively), not a
drop. That is the whole reason to apply this migration on its own, verify it,
and only then let a generator near it.

---

## 7. The apply checklist

Ordered. **Stop after every step and confirm before continuing.** Steps 1–5 are
read-only.

| # | step | command / query | stop and check |
|---|---|---|---|
| 1 | Confirm the target environment | — | The connection string names the branch you intend. Per `project_straumvakt_neon_default_branch_trap`, the Neon **default branch is abandoned** — staging is `br-tiny-river-abgpqq37`. Applying to the default branch achieves nothing and looks like success. |
| 2 | Confirm `0001` is applied | §3.7 | `per_connector` is present in `agreements."RateBasis"`. If not, `0002` still applies cleanly, but the flat-fee feeder cannot store a rate. |
| 3 | Check for name collisions | §3.5 and §3.6 | Both return **0 rows**. A row here means `0002` will fail; stop and find out why the object exists. |
| 4 | Check existing duplicates | §3.1, §3.2, §3.3, §3.4 | Record the numbers whatever they are. Non-zero does not block `0002`; it changes what §4 and §9 cost. |
| 5 | Take a backup / branch snapshot | provider-side | You have a restore point that predates the apply. |
| 6 | **Apply `0002`** | the project's migrate command against the chosen branch | Exit status 0, and the migrations table has exactly one new row. |
| 7 | Verify structure | §8 queries | 11 tables, 11 types, 26 indexes, all empty. |
| 8 | Verify the journal agrees | `npm run db:migrate:status` | Drizzle reports no pending migration and no drift. |
| 9 | Leave it alone | — | Do **not** run a generator in the same sitting. The rollback window closes on the first row, and §6 explains what closes with it. |
| 10 | Only later: §4's index | after §3.4 is confirmed empty | `CONCURRENTLY`, outside a transaction, and check for an INVALID index afterwards. |

---

## 8. Before and after

### Must be true BEFORE

- The connection targets the intended Neon branch, and it is **not** the
  abandoned default branch.
- `0000` and `0001` are applied; `0001` is verified by §3.7 rather than assumed.
- §3.5 and §3.6 both return zero rows.
- A restore point exists.
- No generator, cron or worker is configured to write to these tables yet —
  `agreements/billing-tick.ts` writes only to `agreements.billing_lines` and is
  unaffected, but confirm nothing else has been pointed at the new tables.
- The peer lane has not also generated a migration numbered `0002`. On this
  branch the journal is coherent: three entries, `0002` present exactly once,
  no renumbering.

### Must be verified AFTER

```sql
-- 8.1 All eleven tables exist and are empty.
SELECT n.nspname AS schema, c.relname AS table, c.reltuples::bigint AS est_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND (
  (n.nspname = 'billing' AND c.relname IN (
     'billing_periods','session_settlements','settlement_components',
     'settlement_holds','statements','statement_lines',
     'statement_delivery_attempts','statement_exports','mutation_receipts'))
  OR (n.nspname = 'reports' AND c.relname IN (
     'connector_activity_month','driver_activity_month'))
)
ORDER BY 1, 2;
-- Expect 11 rows.

-- 8.2 The ten unique indexes plus the primary key exist. These are the
--     guarantees; a table without them is a table that can double-bill.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE (schemaname = 'billing' OR schemaname = 'reports')
  AND indexdef ILIKE '%UNIQUE%'
ORDER BY schemaname, tablename, indexname;
-- Expect the ten from §1, plus session_settlements_pkey.

-- 8.3 session_settlements is keyed on session_id, and by PRIMARY KEY.
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'billing.session_settlements'::regclass;
-- Expect a PRIMARY KEY on (session_id).

-- 8.4 All eleven types exist with the expected label counts.
SELECT t.typname, COUNT(e.enumlabel) AS labels
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname = 'billing'
GROUP BY t.typname ORDER BY t.typname;
-- Expect 11 rows: CorrectionReason 6, DeliveryChannel 3, DeliveryState 6,
-- PeriodState 3, ProvenanceState 7, RateComponentKind 3, ReviewReason 7,
-- SettlementProvenance 4, SettlementStatus 2, StatementLineKind 6,
-- StatementRecipientKind 2.

-- 8.5 Nothing else moved. No existing table gained or lost a constraint.
SELECT COUNT(*) FROM agreements.billing_lines;
SELECT COUNT(*) FROM reports.session_ledger;
-- Both unchanged from the numbers recorded in step 4.
```

Then, in the repo: `npm run db:migrate:status` reports no pending migration,
and `npm run check:schema-consistency` still passes.

---

## 9. Deltas this pack recommends but does NOT include

Found while building the flat-fee feeder. Each is a schema change `0002` does
not make, recorded so the decision is taken deliberately rather than discovered
during a generation run.

| # | delta | why | cost of deferring |
|---|---|---|---|
| 9.1 | `agreements.billing_lines` needs `UNIQUE (session_id, factor_code, kind)` | The legacy writer has no unique constraint; application code closed the read-decide gap as far as it can, and only the constraint makes a concurrent double-write impossible. | The double-billing blocker remains *unlikely* rather than impossible. Needs the same dedupe-then-index treatment as §4 — run §3.1 first. |
| 9.2 | `billing.RateComponentKind` needs subscription values, and `settlement_components.session_id` needs to be nullable | The flat fee has no session, so its components cannot be stored at all today. | The flat-fee feeder can produce statement lines but not settlement components. `StatementLineKind` already carries `subscription_connector`, `subscription_driver` and `cap_relief`, so statements are fine. |
| 9.3 | `settlement_holds.session_id` needs to be nullable, plus a `period_id` | A period-level hold — "this org's connector count is unknowable" — has no session to attach to. | A flat-fee hold cannot be persisted. It exists only in the generator's return value. |
| 9.4 | `billing.ReviewReason` needs the flat-fee reasons | Of the seven existing values, only `manual_hold` could receive a machine refusal, and writing "manual_hold" for one is a lie of the kind this codebase has been paying for. | Hold reasons stay in TS and cannot be queried. |
| 9.5 | `charging.sessions` needs charging-ceased and unplugged timestamps | Plug time cannot be computed without them. | The plug-time fee cannot be billed at all; the generator rejects rather than defaulting, which is correct but is not a product. |
| 9.6 | Something must write `reports.*_activity_month` | Both tables are created by `0002` and have zero writers. | The flat fee has no connector or driver count source, so every period holds. **This is the single blocker between an applied `0002` and customer 1's first invoice.** |

**9.6 is the one to read twice.** Applying `0002` does not by itself make an
invoice possible. It makes the tables exist. The count source is what is
missing, and the flat-fee generator is written so that this shows up as a
refusal with a named reason rather than as a 0 kr invoice.
