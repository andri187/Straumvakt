# Core billing ledger — schema/API follow-up

Direct follow-up to the implementation slice committed in this lane. What is
now implemented is **pure**: it computes and refuses correctly, and it writes
nothing. This is the exact remaining work to make it durable.

Companion to `2026-08-10-core-schema-api-package.md`, which this narrows to
"what the code now in the tree actually needs".

---

## 1. What the pure slice already decides

| Module | Decides | Persists |
| --- | --- | --- |
| `money.ts` | aurar↔ISK rounding, statement totals, VAT, apportionment | nothing |
| `settlement.ts` | what a session cost, at the rate locked to its **start** | nothing |
| `statement.ts` | driver lines, org material, deterministic identity | nothing |
| `period-close.ts` | whether a month may close | nothing |
| `delivery-log.ts` | what an attempt meant, what happens next | nothing |

Every one is deterministic: no clock, no I/O, no ORM. Timestamps are passed in,
so the same inputs always give the same answer — which is what makes a
statement reproducible in a dispute.

## 2. Tables still needed

Unchanged from the schema package, now with the exact fields the code emits.

**`reports.session_settlements`** — one row per `SettlementSnapshot`. The
snapshot type is the column list: `org_id`, `session_id`, `connector_id`,
`driver_id`, `started_at`, `stopped_at`, `energy_wh`, `meter_start_wh`,
`meter_stop_wh`, `amount_ex_vat_minor`, `vat_rate_pct`, `vat_minor`,
`total_inc_vat_minor`, `total_isk`, `currency`, `status`, `review_reasons[]`,
`provenance`, `provenance_state`, `rate_selection_policy`, `priced_at`.

Plus a child **`reports.session_settlement_components`** — `settlement_id`,
`kind`, `rate_version_id`, `price_per_kwh_minor`, `effective_from`,
`effective_until`, `amount_ex_vat_minor`. This is the table that makes B1 real:
the rate id **and its window** travel with the money, so a later rate edit is
visibly a different row rather than a silent restatement.

**`commercial.billing_periods`**, **`commercial.statements`** (+ `content`
JSONB), **`commercial.statement_lines`**, **`commercial.delivery_attempts`**,
**`commercial.idempotency_keys`**, **`commercial.connector_status_history`**,
**`commercial.driver_activity_month`** — all as specified in the schema package.

### Migration order

M1 `connector_status_history` → M2 `driver_activity_month` → M3
`session_settlements` + components → M4 `billing_periods` → M5 `statements` +
`statement_lines` → M6 `delivery_attempts` → M7 `idempotency_keys` → M8
`rate_references` exclusion constraint → **M9 (destructive, alone, last)** drop
the five orphan enums and the four dead Site tariff anchors.

M1–M8 are additive and independently revertible.

## 3. Routes still needed

As specified in the schema package. The pure functions map one-to-one:

| Route | Calls |
| --- | --- |
| `GET …/periods/:y/:m/preflight` | `checkPeriodClose` |
| `POST …/periods/:y/:m/close` | `checkPeriodClose` then persist state |
| `POST …/statements/generate` | `canGenerateStatement` → `buildDriverStatement` / `buildOrgStatement` |
| `GET …/statements/:id` | read `content` JSONB |
| `GET …/statements/:id/export.csv` | render stored `content` |
| `POST …/statements/:id/deliver` | `canDeliverStatement` → `classifyEmailResult` → `applyDeliveryAttempt` |
| `POST …/corrections` | `buildCorrectionLine` |
| `PUT …/rates/{dso,retailer}` | write an effective-dated version |

Every one gated **with `orgIdParam`** and re-checked in the repository — the
`bill-objects` two-layer pattern, not the gate alone.

## 4. Repository functions still needed

`upsertSettlementSnapshot` (idempotent on `session_id`) · `listSettlements(orgId,
period)` · `openPeriod` / `closePeriod` / `getPeriod` · `countActiveConnectors`
and `countActiveDrivers` (range-overlap over the history tables) ·
`insertStatement` / `getStatement` · `claimDeliveryAttempt` (the atomic
single-statement claim from `dispatcher.ts:54-71`) · `markDelivered` /
`markFailed`.

Every one takes `orgId` as a required first argument. Omitting it must be a
typecheck failure, not a runtime default.

## 5. Permissions and audit

First real call sites for three declared-but-dead verbs: `billing.export`
(`permissions.ts:66`) on the CSV route, and `tariff.read` / `tariff.write`
(`:68-69`) on the rate routes.

Audit events: `billing.period.closed`, `billing.statement.generated`,
`billing.statement.delivered`, `billing.statement.delivery_failed`,
`billing.correction.issued`, `rate.dso.updated`, `rate.retailer.updated`,
`connector.enablement.changed`. Written in the same transaction as the
mutation; a missing audit row should fail the suite, not review.

## 6. UI unlock dependencies

| UI | Needs first |
| --- | --- |
| Session detail showing the snapshot | `session_settlements` (M3) |
| Period close / statement preview | M4, M5, close route |
| Send / resend | M6, delivery route, stored `content` |
| Rate editing as versioning | M8, rate write routes |
| Driver billing figures | the 100× fix at `driver-sessions.ts:95` **and** `driver-invoices.ts:69` |

Nothing above should be unlocked before its row exists — an interactive control
over a table that is not there is worse than a disabled one.

## 7. Remaining launch blockers

| | Status after this slice |
| --- | --- |
| **B1** rate lock-in | **logic done, unpersisted.** `buildSettlementSnapshot` locks to session start and holds when no rate covers it. Needs M3. |
| **B2** settlement snapshot | **shape done, unpersisted.** Needs M3 + the components child table. |
| **B3** period/statement/delivery | **logic done, unpersisted.** Needs M4–M6. |
| **B4** cross-tenant reads | **untouched.** Pure functions filter by `orgId`, but the 33 unscoped gates and 7 unscoped repositories are unchanged. |
| **B5** active connector/driver | **untouched and still the hard blocker.** No enablement history exists, so `countActive*` has nothing to read. |
| **B6** plug-time input | **untouched.** `settlement.ts` accepts a plug-time fee but nothing can compute one: no unplug or charging-cease timestamp exists. |
| **B7** computeRule vocabulary | **untouched.** Still a CI-guard job. |

**B5 remains the one that stops invoicing.** Everything in this slice computes
correctly against inputs that no table can yet supply.
