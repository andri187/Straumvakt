# Core billing market-readiness board — 2026-08-11

Twelve rows, one per capability Core needs before it can bill a real customer.
Read the **risk if shipped now** column first: three of these do not merely fail,
they charge the wrong person the wrong amount and look fine doing it.

**Merge order** is a partial order, not a queue. Everything at order 1 is
mergeable today with no database change.

---

## 1. Rate lock-in persistence

| | |
|---|---|
| **Current state** | Impossible on today's data path. `resolve-tariff-chain.ts:125-128` takes `{ siteId, chargingStationId }` with **no timestamp**, reads the *current* `Site.dsoTariffId` / `Installation.retailerTariffId` (:190-206, :225-241), and is called from `projections.ts:378-381` during the **stop** projection. `computeSessionCost` declares `startedAt`/`stoppedAt` on `SessionInput` (:69-71) and its body never reads either. `reports.session_ledger` stores one mutable `tariff_definition_id`, and the `compute_rule` JSONB behind it is edited in place. |
| **Implemented this run** | `billing.settlement_components` — `unit_price_minor`, `effective_from`, `effective_until` stored as **copies**; `rate_version_id` for provenance only. `buildSettlementRows` writes them. `snapshotIsImmutableUnder` rewritten to actually check the property (it previously returned true unconditionally). |
| **Tests added** | 9 (component copy, expired window excluded, boundary inclusive/exclusive, self-consistency refusal, zero-energy exemption, reprice divergence) + fool test 2 and 7 |
| **Blockers** | No route writes a settlement. `agreements.rate_references` has no unique on `(cost_factor_id, code, effective_from)`, so "the rate in force at T" can be ambiguous. |
| **Decision needed** | **Partial coverage.** A session whose DSO window has moved but whose retailer window has not is currently priced on the retailer alone — settled, no hold, under-billed. Hold, or price on what covers? |
| **Migration needed** | `0002` (done, unapplied) + a separate dedupe-then-unique-index migration on `rate_references` |
| **Merge order** | 1 (schema), 3 (writer) |
| **UI** | disabled |
| **Risk if shipped now** | **Editing a tariff silently restates every session ever priced against it.** A customer who disputes a July bill gets today's price, and there is no record of what they were charged. |

## 2. Settlement snapshots

| | |
|---|---|
| **Current state** | No table. Verified: no settlement-shaped model in any of the nine `prisma/schema/*.prisma`, and `packages/shared/src/db/commercial.ts` declares 18 tables, none of them settlement-shaped. |
| **Implemented this run** | `billing.session_settlements` (PK `session_id`), `billing.settlement_components`, `billing.settlement_holds`. Mapper `buildSettlementRows`. |
| **Tests added** | 58 in `settlement-rows.test.ts` |
| **Blockers** | No route. No backfill possible — see below. |
| **Decision needed** | Whether a correction edits the snapshot or lands as a next-period line. **Designed as the latter**; needs confirming. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 1 |
| **UI** | disabled |
| **Risk if shipped now** | Nothing to ship. The risk is the *opposite*: writing a route before the table exists, which is how the last three billing generations started. |

**No backfill.** `session_ledger` → `session_settlements` cannot be faithful: the
ledger stores one mutable `tariff_definition_id` and no unit price, so a
backfilled settlement would be a fabricated snapshot wearing the clothes of a
locked one.

## 3. Statement generation

| | |
|---|---|
| **Current state** | `billing.statements` was **dropped** on 2026-08-07 (`20260807120000_drop_never_used_tables/migration.sql:47`) along with invoices, invoice_lines, subscriptions and billing_period_summary. Nothing replaced them. The dead `InvoiceStatus` enum outlived its table on both sides. |
| **Implemented this run** | `billing.statements` (unique on `(period_id, recipient_kind, recipient_id)`), `billing.statement_lines` (unique on `(statement_id, line_no)`), mapper `buildStatementRows` with a total-equals-sum-of-rounded-lines refusal. |
| **Tests added** | 14 (statement edges, rounding, identity determinism) + fool tests 3 and 5 |
| **Blockers** | No route. Depends on rows 2 and 5. |
| **Decision needed** | Whether an org statement and a driver statement are one table with a `recipient_kind` (designed) or two. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 2 |
| **UI** | disabled |
| **Risk if shipped now** | A statement generated before row 5 lands would be **missing its subscription lines** — the 200 kr and 50 kr that are most of the revenue. |

## 4. Delivery attempts

| | |
|---|---|
| **Current state** | No durable provider-proof chain. Grepping the schema for `provider_message_id\|message_id\|resend\|delivered_at\|sent_at\|delivery_status` returns **zero**. `sendEmail` returns `{ ok, id }` and **all 8** call sites drop it; two of them hang a `.catch()` off a function that cannot throw, so `{ ok: false }` is unreachable by construction. |
| **Implemented this run** | `billing.statement_delivery_attempts`, modelled on `ocpp.outbound_commands` — `state`, `attempts`, `not_before`, `last_attempt_at`, `result` JSONB, `provider_message_id`, plus `outcome_kind` for `not_configured`. Unique on `(statement_id, idempotency_key)`. |
| **Tests added** | 0 beyond the enum mirror — the pure `delivery-log.ts` is already tested; the persistence half has no writer yet |
| **Blockers** | No sender. The claim must be a single atomic conditional `UPDATE`, as `dispatcher.ts:54-71` does — never claim-then-update in two statements. |
| **Decision needed** | Retry ceiling and backoff. `DEFAULT_MAX_DELIVERY_ATTEMPTS = 5` is proposed, not agreed. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 3 |
| **UI** | disabled |
| **Risk if shipped now** | **`email.ts:45-51` fails OPEN when `RESEND_API_KEY` is absent.** A statement "delivered" with no provider configured is today indistinguishable from one that reached the customer. That is the single worst thing on this board for a support conversation. |

## 5. Active connector / driver month source

| | |
|---|---|
| **Current state** | Not derivable after the fact, on either side. **Connector:** `assets.connectors` has a mutable `status` + `status_updated_at` and no history; `assets.charging_stations` has **no** status/active/removed column in its 150 lines. **Driver:** `session.user_id` is nullable, "reporting activity" has no persisted event of any kind, and `driver_group_memberships` has `added_at` only, with a unique on `(group, user)` that forbids the second row history would need — removal is a hard delete. |
| **Implemented this run** | `reports.driver_activity_month`, `reports.connector_activity_month`, both with a `source` column recording *why* the subject counted. |
| **Tests added** | 0 — nothing writes them yet, and a test over an unwritten table would assert my design back at me |
| **Blockers** | No monthly job. `computeCoreSubscription` has no persisted input. |
| **Decision needed** | **What makes a driver active?** `subscription.ts:10` says "charging or reporting activity"; reporting activity is unobservable. Either persist a reporting event or redefine the rule. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 2 |
| **UI** | disabled |
| **Risk if shipped now** | **This figure IS the revenue.** 200 kr/connector + 50 kr/driver, capped at 450. Getting it wrong is not a reporting bug, it is an invoice. A charger removed in August leaves no evidence it was billable in July. |

## 6. Plug-time input

| | |
|---|---|
| **Current state** | The inputs exist and are **deliberately destroyed**. `charging.live_sessions` holds `connected_at`, `charging_started_at`, `charging_seconds`, `non_charging_seconds` — and `zaptec-state-event.ts:141-154` increments the final delta then calls `liveSession.delete()`. The totals leave only as JSON in a response body nothing persists. `charging.sessions` has seven timestamps and not one distinguishes charging-ceased from cable-removed. |
| **Implemented this run** | Columns only: `plug_time_seconds`, `plug_time_fee_minor` on `session_settlements`. |
| **Tests added** | 0 |
| **Blockers** | Two columns and a `DELETE`. **The vendor already supplies what is needed** — the Zaptec CDR DTO declares `ConnectedDateTime` and `DisconnectedDateTime` (`zaptec.ts:372-373`), and grepping both names across the tree returns those two declaration lines and nothing else. Never read, never mapped, never stored. |
| **Decision needed** | Grace period and anchor (`charging_end` vs `plug_in`). Both are parameters of `computePlugTimeFee` with no configured value. |
| **Migration needed** | Yes — additive columns on `charging.sessions`, **not** in `0002` |
| **Merge order** | 4 |
| **UI** | hidden |
| **Risk if shipped now** | Cannot ship: no input. The good news is this is the cheapest item on the board — a column and a `INSERT` before the `DELETE`, not a telemetry negotiation. |

## 7. CDR mismatch policy

| | |
|---|---|
| **Current state** | Pure logic exists and is well tested (`cdr-provenance.ts`, `provenance-state.ts`, `DEFAULT_CDR_TOLERANCE_KWH = 0.05`) with **zero** production callers. The live path is `zaptec-session-sync.ts`, which overlays the CDR figure onto the ledger with no hold and no mismatch record. |
| **Implemented this run** | `settlement_holds` with `cdr_mismatch_beyond_tolerance`; `cdr_energy_kwh` stored alongside the meter figure so a dispute has both numbers. |
| **Tests added** | 8 (hold on mismatch, no hold within tolerance, both figures recorded, meter-backwards vs meter-unresolvable distinguished) + fool test 4 |
| **Blockers** | Nothing writes a hold. |
| **Decision needed** | Is 0.05 kWh the agreed tolerance? It is a default in a pure module, not a policy anyone has signed. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 2 |
| **UI** | read-only (a review queue) |
| **Risk if shipped now** | Today a CDR that disagrees with the meter **silently overwrites** the billed figure. The customer is charged the second number and told nothing. |

## 8. DSO / rate update authoring

| | |
|---|---|
| **Current state** | Partial. **14 write routes exist** for cost factors, rate references and tariff definitions. **Zero** exist for `Agreement`, `AgreementClause`, `BearerRule`, `DriverGroup`, `AgreementCostFactor`, `CostCenter` — the entire ADR 0019 agreements ledger, the thing that actually prices sessions, is read-only over HTTP and must be authored by seed script or direct SQL. |
| **Implemented this run** | Contract only: `rateBookUpdateRequestSchema` + `classifyRateWrite`, which **refuses a backdate with no reason** and rejects an inverted effective window. First declared caller of the `tariff.write` verb. |
| **Tests added** | 6 |
| **Blockers** | None of the 14 existing writes accepts an idempotency key. Only rate-reference create runs in a transaction — and `RateReference` has no unique on `(code, effective_from)`, so a retried POST silently stages a duplicate rate version. |
| **Decision needed** | Who may backdate a rate, and does it require dual control? |
| **Migration needed** | The `rate_references` unique index |
| **Merge order** | 3 |
| **UI** | read-only today; interactive after the unique index |
| **Risk if shipped now** | A double-clicked rate create leaves two rows valid at the same instant, and rate selection becomes non-deterministic — **for every session priced afterwards**. |

## 9. Org export formats

| | |
|---|---|
| **Current state** | **No file export anywhere.** Zero hits for `text/csv`, `Content-Disposition` and `attachment;` across `apps/api/src` and `src`. The only `csv` token in the tree is in `lib/oui/oui-table.ts`. |
| **Implemented this run** | `billing.statement_exports` with `content_hash` and `row_count`; `exportStatementRequestSchema` defaulting to CSV and refusing an unspecified format; first declared caller of `billing.export`. |
| **Tests added** | 4 |
| **Blockers** | No generator, no R2 lifecycle for the object. |
| **Decision needed** | CSV columns, and whether an export is served inline or stored. Also: **retention of the file**, which contains driver-level financial data. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 4 |
| **UI** | disabled |
| **Risk if shipped now** | An export whose numbers disagree with the screen is unfalsifiable without `content_hash`. |

## 10. Driver statement read surface

| | |
|---|---|
| **Current state** | `GET /api/driver/invoices` returns a flat array of sessions with **no period, no total, no VAT split and no subscription lines** — and renders `costIsk` as `Number(minor)`, so a 649.88 kr session displays as **64,988 kr**. `driver-sessions.ts:93-98` has the same defect independently. |
| **Implemented this run** | `myBillingMaterialRequestSchema`, which takes **no `orgId`** on purpose — letting a driver name an org would be a cross-tenant hole dressed as a filter — and caps the page at 12. `buildStatementRows` refuses a foreign session id in `excluded_session_ids` or on a line. |
| **Tests added** | 7 (driver-route-has-no-orgId, page cap, cross-tenant refusals) |
| **Blockers** | The 100× defect is live on **both** endpoints and neither imports `money.ts`, which exists to fix exactly this. |
| **Decision needed** | None. This is a bug, not a design question. |
| **Migration needed** | No |
| **Merge order** | **1 — the aurar fix needs nothing from this board** |
| **UI** | interactive (already shipped, and wrong) |
| **Risk if shipped now** | **Already shipped.** Every driver looking at their sessions sees a figure 100× too large. This is the only row on the board whose risk is present tense. |

## 11. Tenant scoping hardening

| | |
|---|---|
| **Current state** | 33 of 41 `billing.*` gates pass no `orgIdParam`, which makes them unreachable by an org member and tenant-wide for a platform grant. Support context exists in three places and enforces in none; its warnings go to `console`, not `audit.actions`, so no cross-tenant billing read is queryable. |
| **Implemented this run** | `GET /sessions/:id` and `/:id/full` now check the row's org via the `resolveOrgScope` + `orgInScope` pair the same file already uses at `GET /tariffs`. `scripts/check-orgid-param.mjs` wired into `npm run check`, failing on the 76th unscoped gate **and** on a stale allowlist entry. `buildSettlementRows` compares the tenant rather than reading it. |
| **Tests added** | 8 added to the existing `org-scope.test.ts` (17 total), 14 in `check-orgid-param.test.mjs` + fool tests 1 and 6 |
| **Blockers** | 11 sequenced items remain; two need a route shape change (`GET /sessions` trusts raw query params; `billing-tariff-mgmt.ts` takes `orgId` from the body). |
| **Decision needed** | **Build `support_contexts` and enforce it, or delete `SUPPORT_CONTEXT_REQUIRED` and the two shadow warnings.** Shipping neither is the current state, and it reads as a control that exists. |
| **Migration needed** | Only if support contexts are built |
| **Merge order** | 1 (done) then 2 |
| **Risk if shipped now** | Every platform-grant holder — `auditor`, `sales_cs`, `finance_internal` — reads every tenant's money data with no scope and no audit row. And **`zaptec-session-sync.ts:186-189` resolves a driver by token value with no org filter**, so a token collision across tenants bills a foreign driver. That one changes who is charged. |

## 12. Idempotency purge / TTL

| | |
|---|---|
| **Current state** | Narrowed, not as stated. `events.idempotency_keys` **does** write `expires_at` on every insert (two files, duplicated constant) — but **no reader ever compares it to `now()`**, so an expired row suppresses a replay permanently and `@@index([expiresAt])` supports a sweeper that was never written. Nothing deletes from the table. `scope` is the hardcoded literal `"ocpp"` in both writers. And **no route in the tree reads an `Idempotency-Key` header at all** — zero hits across `apps/api/src`, `gateway/src` and `packages`. |
| **Implemented this run** | `billing.mutation_receipts`, tenant-scoped, unique on `(org_id, scope, idempotency_key)`, with `request_hash` to catch the same key sent with a different body. Every mutating Core contract requires an idempotency key at the schema level. |
| **Tests added** | 12 (idempotency required on commit/deliver/rate-write, natural keys unique, deterministic identity) + fool test 5 |
| **Blockers** | **The purge is not written.** Shipping the table without it reproduces the exact bug the design criticises, one schema over. |
| **Decision needed** | TTL for a financial receipt. The OCPP side uses 7 days; a billing mutation may deserve longer. |
| **Migration needed** | `0002`, unapplied |
| **Merge order** | 2, **with its purge in the same change** |
| **UI** | n/a |
| **Risk if shipped now** | A retried "close period" or "send statement" double-charges or double-sends. There is no protection at runtime today — only in a schema nothing imports. |

---

## What is mergeable with no database change

- The tenant-scoping guard (`check:orgid-param`) and its wiring — **done**
- The two by-id session-read scope checks — **done**
- The `org-scope` and enum-mirror tests — **done**
- `snapshotIsImmutableUnder` now checking something — **done**
- The route contracts in `statement-zod.ts` and their tests — **done**
- The mapper `settlement-rows.ts` and its 58 assertions — **done**, it writes nothing
- The `db:generate:sql` script fix — **done**, the documented workflow could not be run as written
- **The 100× aurar defect on the two driver endpoints — NOT done, and it is the highest-value row on this board**

## What must not merge before the schema exists

- Any route that reads or writes the eleven tables
- Any statement generation, delivery, or export path
- The monthly activity job
- Anything that claims a period can be closed

Eleven tables with no handler are inert. Eleven tables with a half-written
handler are a way to persist a wrong number.
