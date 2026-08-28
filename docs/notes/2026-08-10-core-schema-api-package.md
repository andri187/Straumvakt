# Core V1 schema and API package

Companion to `2026-08-10-market-core-backend-readiness.md`. Design only — no migration was written,
generated or run.

Baseline: 9 Prisma schema files under `prisma/schema/`, 47 migrations, latest
`20260807120000_drop_never_used_tables`. New migrations sequence after that.

Conventions this package obeys, because the existing code already does:
money is **BigInt aurar** (1/100 ISK) with half-up rounding `(n + d/2) / d`; timestamps are UTC;
Iceland has no DST so month bounds are half-open UTC (`period-close.ts:73`); Drizzle is authoritative
per ADR 0051 and Prisma mirrors it.

---

## 1. Tables

### 1.1 `commercial.connector_status_history` — clears B5

The 200 kr charge is defined on "connector enabled during the billing month". A current-state flag
cannot answer that for a month that has ended.

```
id                uuid pk
connector_id      uuid not null  -> assets.connectors(id)
org_id            uuid not null              -- denormalised for tenant scoping
status            text not null              -- enabled | disabled | removed
effective_from    timestamptz not null
effective_until   timestamptz                -- null = still in force
changed_by        uuid                       -- actor, null for system
reason            text
created_at        timestamptz not null default now()

index (connector_id, effective_from desc)
index (org_id, effective_from desc)
exclusion constraint: no overlapping [effective_from, effective_until) per connector_id
```

Billable-connector count for a period is then a range-overlap query, reproducible for any past month.

### 1.2 `commercial.driver_activity_month` — clears B5, driver half

"Active driver = charging or reporting activity in the month." Deriving this by scanning sessions at
statement time makes the answer drift as sessions are corrected. Materialise it.

```
org_id            uuid not null
user_id           uuid not null
year              int not null
month             int not null
first_activity_at timestamptz not null
last_activity_at  timestamptz not null
session_count     int not null default 0
source            text not null            -- session | report
primary key (org_id, user_id, year, month)
```

Written idempotently by the same path that writes the ledger row. Upsert, never recount.

### 1.3 Settlement snapshot columns on `reports.session_ledger` — clears B1 + B2

Additive only. No existing column is altered or dropped.

```
-- what was actually charged, frozen
price_dso_per_kwh_minor        bigint
price_retailer_per_kwh_minor   bigint      -- resolved today, then DISCARDED
price_cpo_addon_minor          bigint
amount_ex_vat_minor            bigint
vat_rate_pct                   numeric(5,2)
vat_minor                      bigint
currency                       text default 'ISK'   -- asserted today, never recorded

-- which rate, and when it was valid
rate_source                    text        -- tariff_definition | rate_reference
rate_ref_id                    uuid
rate_effective_from            timestamptz
rate_effective_until           timestamptz
rate_selection_policy          text default 'start_rate'
crossed_rate_boundary          boolean default false

-- meter truth, immutable
meter_start_wh                 bigint
meter_stop_wh                  bigint

-- occupancy
plug_in_at                     timestamptz
charging_ceased_at             timestamptz          -- clears B6
plug_time_seconds              int
plug_time_fee_minor            bigint

-- lineage
provenance_state               text                 -- the 7-state machine, one column
billing_period_id              uuid
statement_line_id              uuid
priced_at                      timestamptz
repriced_count                 int default 0
corrects_session_id            uuid
```

Two of these deserve emphasis. `price_retailer_per_kwh_minor` records a component the system already
computes and throws away (`resolve-tariff-chain.ts:286` → discarded at `projections.ts:444`).
`provenance_state` replaces the two unconstrained TEXT columns whose independence produced 492
unlabelled rows and 5 rows asserting CDR provenance over an OCPP figure.

### 1.4 `commercial.billing_periods` — clears B3

```
id            uuid pk
org_id        uuid not null
year          int not null
month         int not null
state         text not null default 'open'   -- open | closing | closed
opened_at     timestamptz not null default now()
closed_at     timestamptz
closed_by     uuid
totals_minor  bigint
line_count    int
unique (org_id, year, month)
```

`state` is the thing `reports.billing_period_summary` never had, and why restoring that table would
have restored a cache rather than a ledger.

### 1.5 `commercial.statements` and `commercial.statement_lines`

```
statements
  id, org_id, billing_period_id -> billing_periods(id)
  recipient_kind text     -- driver | organisation
  recipient_id   uuid
  issued_at, total_minor, currency default 'ISK'
  content        jsonb not null     -- the RENDERED document
  content_hash   text not null
  unique (billing_period_id, recipient_kind, recipient_id)

statement_lines
  id, statement_id -> statements(id) on delete cascade
  line_type text   -- session | subscription_connector | subscription_driver
                   -- | plug_time | cap_relief | correction
  description text
  quantity numeric(12,3), unit text
  unit_price_minor bigint
  amount_minor bigint not null       -- ROUNDED to ISK at line level
  session_id uuid, corrects_line_id uuid, reason text
  index (statement_id)
```

`content jsonb` is deliberate: it restores the one dropped column
(`20260424090905_v3_foundation/migration.sql:608`) that `statementAction`'s resend branch
(`period-close.ts:236-238`) depends on. Resend must return the document the customer already holds,
not re-render it.

`cap_relief` is a **line**, not an adjustment to another line, so the 450 kr cap is visible on the
statement rather than implicit — `computeCoreSubscription` already returns it that way.

### 1.6 `commercial.delivery_attempts`

Modelled on `ocpp.outbound_commands` (`protocol.prisma:96-131`) because `lib/dispatcher.ts` is a
delivery ledger that already works in this codebase.

```
id, statement_id -> statements(id)
channel text          -- email | download | webhook
state   text          -- pending | sending | sent | retrying | failed | abandoned
attempts int default 0
last_attempt_at, not_before timestamptz
provider_id text                 -- the Resend id; without it "sent" is unprovable
result jsonb
created_at
index (state, not_before)
```

Claim atomically, exactly as `dispatcher.ts:54-71` does:

```sql
UPDATE commercial.delivery_attempts
   SET attempts = attempts + 1, last_attempt_at = NOW(),
       not_before = NOW() + make_interval(secs => $2)
 WHERE id = $1 AND state = 'pending'
RETURNING ...
```

### 1.7 Rate effective dating — clears B1

Do **not** invent a third rate generation. `agreements.rate_references` already versions correctly
(`billing-rate-references.ts:209-283`). Two fixes:

- add a DB exclusion constraint so two rows for one `code` cannot both be current — today only
  application logic prevents it, and it does so wrongly (`:229-238`)
- reject `PATCH` on `status === "expired"` as well as `"current"` (`:312`)

Then make the live path read it, and snapshot the result onto the ledger.

---

## 2. DTOs

```ts
interface SettlementSnapshot {
  sessionId: string;
  energyWh: { start: bigint; stop: bigint; net: bigint };
  components: { dsoPerKwhMinor: bigint; retailerPerKwhMinor: bigint; cpoAddonMinor: bigint };
  amountExVatMinor: bigint; vatRatePct: number; vatMinor: bigint; totalIncVatMinor: bigint;
  currency: "ISK";
  rate: { source: "tariff_definition" | "rate_reference"; refId: string;
          effectiveFrom: string; effectiveUntil: string | null;
          policy: "start_rate"; crossedBoundary: boolean };
  occupancy: { plugInAt: string | null; chargingCeasedAt: string | null;
               plugTimeSeconds: number | null; feeMinor: bigint };
  provenanceState: ProvenanceState;      // the existing 7-state union
  pricedAt: string;
}

interface StatementDraft {
  period: { orgId: string; year: number; month: number };
  recipient: { kind: "driver" | "organisation"; id: string };
  lines: StatementLine[];
  totalMinor: bigint;                     // sum of ROUNDED lines
  billingApplicability: "requires-admin-confirmation";
}
```

`totalMinor` is a sum of already-rounded lines. Rounding the sum instead lets the total disagree with
the lines a customer can add up.

---

## 3. Routes

New, all under `/api/admin`, all gated **with `orgIdParam`** and re-checked in the repository —
the `bill-objects` two-layer pattern (`repositories/bill-objects.ts:127`), not the gate alone.

| Method | Path | Permission | Idempotency |
| --- | --- | --- | --- |
| `GET` | `/orgs/:orgId/billing/periods` | `billing.read` | — |
| `POST` | `/orgs/:orgId/billing/periods/:year/:month/close` | `billing.write` | `Idempotency-Key` |
| `GET` | `/orgs/:orgId/billing/periods/:year/:month/preflight` | `billing.read` | — |
| `POST` | `/orgs/:orgId/billing/statements/generate` | `billing.write` | `Idempotency-Key` |
| `GET` | `/orgs/:orgId/billing/statements/:id` | `billing.read` | — |
| `GET` | `/orgs/:orgId/billing/statements/:id/export.csv` | **`billing.export`** | — |
| `POST` | `/orgs/:orgId/billing/statements/:id/deliver` | `billing.write` | `Idempotency-Key` |
| `POST` | `/orgs/:orgId/billing/corrections` | `billing.write` | `Idempotency-Key` |
| `PUT` | `/orgs/:orgId/rates/dso` | `tariff.write` | — |
| `PUT` | `/orgs/:orgId/rates/retailer` | `tariff.write` | — |

The export route is the first-ever call site for `billing.export`, and the rate routes the first for
`tariff.write` — three declared-but-dead verbs (`permissions.ts:66`, `:68-69`) finally used for the
thing they were declared for.

**Preflight before close is deliberate.** `checkPeriodClose` already reports *every* blocker at once
rather than the first; a preflight endpoint surfaces that to an operator before they commit.

### Idempotency

`Idempotency-Key` header → `commercial.idempotency_keys(key, org_id, route, request_hash,
response_json, created_at)`, unique on `(org_id, route, key)`. Replay returns the stored response.
Without this, a retried close or deliver double-charges or double-sends.

---

## 4. Audit events

Every write above emits `recordAuditAction` — the existing shape at `repositories/chargers.ts:591`
(`action`, snake_case `targetType`, decision inputs in `metadata`).

`billing.period.closed` · `billing.period.reopened` · `billing.statement.generated` ·
`billing.statement.delivered` · `billing.statement.delivery_failed` · `billing.correction.issued` ·
`rate.dso.updated` · `rate.retailer.updated` · `connector.enablement.changed`

`billing.period.reopened` must record **who** and **why**, because it is the one action that can
change a number a customer has already seen.

---

## 5. Validation rules

1. Reject a close when any session in the period is `estimated`, `cdr_pending` or
   `held_manual_review` — `checkPeriodClose` already computes this; it needs the counts to exist.
2. Reject statement generation for a period not in `closed`.
3. Reject a correction whose value is zero (`buildCorrectionLine` already throws).
4. Require a note for discretionary correction reasons (already enforced).
5. Reject a rate write whose `effectiveFrom` is in the past **unless** an explicit
   `backdate_reason` is supplied and audited.
6. Reject a `computeRule` kind not accepted by the resolver — enforced by the CI guard, so it fails
   at publish time rather than inside a transaction that rolls back a session.
7. Reject any statement whose `totalMinor` ≠ sum of its rounded line amounts.

---

## 6. Migration order and rollback

| Step | Migration | Reversible |
| --- | --- | --- |
| M1 | `connector_status_history` + backfill current status as one open row | yes — drop table |
| M2 | `driver_activity_month` + backfill from existing sessions | yes — drop table |
| M3 | settlement columns on `session_ledger`, all nullable | yes — drop columns |
| M4 | `billing_periods` | yes |
| M5 | `statements`, `statement_lines` | yes |
| M6 | `delivery_attempts` | yes |
| M7 | `idempotency_keys` | yes |
| M8 | exclusion constraint on `rate_references` (after cleaning existing overlaps) | yes — drop constraint |
| M9 | drop the five orphan enums and the four dead Site tariff anchors | **no** — separate, last, after M1–M8 have been live |

M1–M8 are additive and independently revertible. **M9 is the only destructive step and must ship
alone**, after the rest has proven itself.

Backfill honesty: M1's backfill records *current* status as an open interval starting at
`status_updated_at`. It cannot reconstruct history that was never recorded — so any month before
M1 ships has no reproducible connector count, and the first invoiceable month is the first **whole**
month after M1. That is a product constraint, not a technical one, and it should be stated to
whoever sets the launch date.
