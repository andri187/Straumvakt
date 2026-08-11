# Core backend work packages

Companion to `2026-08-10-market-core-backend-readiness.md`.

**61 issue-ready packages**, sequenced into the seven merge slices. Each is small enough
to review in one sitting; the acceptance field is the done-definition.

| Lane | Packages |
| --- | ---: |
| commercial-lib | 14 |
| ci-guards | 8 |
| schema | 9 |
| api-writes | 10 |
| authz-audit | 8 |
| period-close | 7 |
| ui-unlock | 5 |
| **total** | **61** |

Dependencies reference other WP ids. Nothing here proposes pushing, deploying or mutating a live
system.


---

## commercial-lib (14)

### WP-01 — Money module: aurar as the only internal unit, ISK only at the line boundary

**Why.** Locked decision says internal aurar, final line rounded to ISK, statement total = sum of rounded lines. Today there is no shared money type, which is the root of the 100x driver-facing bug (driver-sessions.ts:93-98 minorToIsk returns Number(minor) unchanged with the false comment 'ISK has no minor unit'; driver-invoices.ts:69 same value, comment at :21 correctly says aurar). Foundation for B2 (snapshot needs ex-VAT/VAT in aurar) and for the statement total rule.

**Touches.** `NEW packages/commercial/src/core-billing/money.ts, NEW packages/commercial/src/core-billing/money.test.ts, packages/commercial/src/index.ts (barrel export only)`

**Acceptance.** money.ts exports branded Aurar and Isk types, aurarToIsk (half-up at the line boundary), iskToAurar, sumRoundedLines, and formatIsk. No function in the module accepts an unbranded number for a monetary value. Barrel exports the module (packages/commercial/package.json exports map has no './core-billing/*' subpath, so root barrel is the only import path). Zero production imports in this WP.

**Tests.** Vitest unit tests: 1 aurar != 1 ISK (regression for the 100x bug), 100 aurar = 1 ISK, half-up rounding at .5, negative amounts (credits), sum-of-rounded-lines != rounded-sum on a crafted case proving the locked decision is implemented, and a property test that aurarToIsk(iskToAurar(x)) === x.

**Depends on.** NONE · **Risk.** Low. Pure module, no callers. Risk is picking a rounding mode that later conflicts with the statement builder — pin half-up here and reference it from WP-13.

### WP-02 — computeRule vocabulary as a single typed union with an explicit priceability map

**Why.** Clears the library half of B7. lib/billing/tariff-zod.ts:22 publishes computeRule kinds flat_per_kwh and flat_per_session; resolve-tariff-chain.ts:90 accepts only kind==='flat' and throws compute_rule_unsupported at :119-122. A published tariff is therefore unpriceable. The vocabulary must exist in one place before either side can be corrected.

**Touches.** `NEW packages/commercial/src/core-billing/compute-rule.ts, NEW packages/commercial/src/core-billing/compute-rule.test.ts, packages/commercial/src/index.ts`

**Acceptance.** compute-rule.ts exports ComputeRuleKind covering exactly flat, flat_per_kwh, flat_per_session; parseComputeRule(unknown) returning a discriminated result; priceComputeRule(rule, {energyWh, sessionCount}) returning aurar; and an exhaustive switch with a never-check so adding a kind fails typecheck. Unknown kinds return {ok:false, reason:'compute_rule_unsupported'} - never throw.

**Tests.** One test per kind including flat, flat_per_kwh with the exact aurar arithmetic, flat_per_session, an unknown kind returning ok:false rather than throwing, and a test asserting the exported kind list equals the tariff-zod.ts:22 publish list (imported as data, not duplicated).

**Depends on.** WP-01 · **Risk.** Low. If tariff-zod.ts:22 already carries kinds not listed here the test fails loudly - that is the intended failure.

### WP-03 — selectRateAtInstant: generic effective-dated rate selection extracted from pickActiveRate

**Why.** Clears the library half of B1. The correct mechanism already exists but is disconnected: packages/commercial/src/agreement/resolve.ts:123-137 pickActiveRate does genuine effective-dated selection at ctx.startedAt and has priced 0 sessions. resolve-tariff-chain.ts has ZERO references to validFrom/validUntil/effectiveFrom. Extract the working logic so the tariff chain can adopt it in WP-33.

**Touches.** `packages/commercial/src/core-billing/rate-window.ts, packages/commercial/src/core-billing/rate-window.test.ts, packages/commercial/src/agreement/resolve.ts:123-137 (refactor pickActiveRate to delegate), packages/commercial/src/index.ts`

**Acceptance.** rate-window.ts exports selectRateAtInstant(rows, instant) where rows carry validFrom/validUntil, returning {ok:true,row} or a typed failure of kind no_rate_at_instant or overlapping_rates. resolve.ts:123-137 pickActiveRate is a thin wrapper over it with identical observable behaviour. Overlaps are reported, never silently resolved by newest-wins.

**Tests.** Instant before first window, exactly on validFrom (inclusive) and exactly on validUntil (exclusive), open-ended validUntil null, two overlapping rows returning overlapping_rates (the two-current RateReference case from billing-rate-references.ts:229-238), and a regression test that pickActiveRate's existing suite still passes unchanged.

**Depends on.** NONE · **Risk.** Medium. resolve.ts:123-137 is the only place doing this correctly today; a behaviour change here is invisible in production (0 sessions priced) but must not break its own tests.

### WP-04 — SessionSettlement snapshot type and pure builder

**Why.** Clears the library half of B2. reports.session_ledger (commercial.prisma:297-336) stores one mutable tariff_definition_id and none of: per-component ex-VAT price, the retailer component (resolved at resolve-tariff-chain.ts:286, discarded at projections.ts:444), vat_rate_pct or the ex-VAT/VAT split (computed compute-session-cost.ts:178-195, discarded), currency, the rate's effective window, meter start/stop as separate readings, plug-time seconds, period/statement linkage, closed marker, or correction linkage. The shape must be settled before the migration in WP-23.

**Touches.** `NEW packages/commercial/src/core-billing/settlement.ts, NEW packages/commercial/src/core-billing/settlement.test.ts, packages/commercial/src/index.ts`

**Acceptance.** settlement.ts exports SessionSettlement with every field B2 lists as missing, all monetary fields in Aurar, currency fixed to ISK, timestamps UTC. buildSettlementSnapshot(input) is total: any missing input yields a typed incomplete result naming the missing field, never a partial snapshot. The type is frozen at build time - no field is optional except plug-time seconds and correction linkage.

**Tests.** A golden snapshot for a full session; one test per missing-field case asserting the named failure; a test that the same input twice produces byte-identical output (determinism); and a test asserting the retailer component survives into the snapshot.

**Depends on.** WP-01 · **Risk.** Medium. Getting the field set wrong forces a second migration. Review this WP against B2's list item by item before merging.

### WP-05 — VAT split module: ex-VAT, VAT and gross per component

**Why.** Supports B2. compute-session-cost.ts:178-195 computes the ex-VAT/VAT split and then discards it; nothing persists vat_rate_pct. Iceland/ISK means one VAT rate at launch but the rate itself must be snapshotted per session, not looked up at read time.

**Touches.** `NEW packages/commercial/src/core-billing/vat.ts, NEW packages/commercial/src/core-billing/vat.test.ts, packages/commercial/src/index.ts`

**Acceptance.** vat.ts exports splitVat({exVatAurar, vatRatePct}) returning {exVatAurar, vatAurar, grossAurar} with all arithmetic in aurar and no intermediate ISK rounding, plus applyPerComponent(components, rate) returning a per-component breakdown whose gross sum equals the whole-session gross. vatRatePct is a required input - there is no default constant in this module.

**Tests.** Standard rate case, zero-rate case, a case where per-component rounding would drift and the test asserts it does not, and a test asserting the module refuses a negative or >100 rate.

**Depends on.** WP-01 · **Risk.** Low.

### WP-06 — Immutable meter reading pair (start/stop) alongside existing sessionEnergyWh

**Why.** Supports B2. energy_wh is one scalar overwritten twice - projections.ts:961 then zaptec-session-sync.ts:313 - so the original OCPP reading is unrecoverable after a CDR overlay. meter-energy.ts sessionEnergyWh is the only core-billing module production already imports (projections.ts:31/:939), so extending it is the lowest-friction path.

**Touches.** `packages/commercial/src/core-billing/meter-energy.ts, packages/commercial/src/core-billing/meter-energy.test.ts, packages/commercial/src/index.ts`

**Acceptance.** meter-energy.ts exports MeterReadingPair {startWh, stopWh, source} and energyFromPair(pair) returning a typed failure for stopWh<startWh (regression) or a rollover beyond a configured ceiling. sessionEnergyWh keeps its current signature and behaviour so projections.ts:31/:939 needs no change in this WP.

**Tests.** Normal pair, equal readings (0 Wh), regression pair rejected, rollover case, and a test proving that an OCPP pair and a CDR pair can coexist and disagree without either being mutated.

**Depends on.** NONE · **Risk.** Low. Must not change sessionEnergyWh's exported behaviour - it has a live caller.

### WP-07 — Plug-time input contract: explicit anchors and an insufficient_input result

**Why.** Clears the library half of B6. plug-time.ts is pure, unimported and uncomputable today because there is no unplug timestamp and no charging-cease timestamp anywhere; ocpp_stopped_at and cdr_stopped_at are two feeds' values for the SAME session-end instant. The library must refuse to guess rather than silently anchoring on endedAt.

**Touches.** `packages/commercial/src/core-billing/plug-time.ts, packages/commercial/src/core-billing/plug-time.test.ts, packages/commercial/src/index.ts`

**Acceptance.** plug-time.ts takes {chargingEndAt, unpluggedAt, graceSeconds} as distinct required inputs, applies grace AFTER charging stops (locked decision), floors partial minutes, and returns {ok:false, reason:'insufficient_input', missing:[...]} when either anchor is absent. No code path substitutes endedAt, ocpp_stopped_at or cdr_stopped_at for either anchor.

**Tests.** Billable minutes exactly at the grace boundary, one second past grace, unplug before charging end (rejected), missing unpluggedAt returning insufficient_input, partial-minute floor at 59s and 61s, and a test asserting endedAt is not an accepted input name.

**Depends on.** NONE · **Risk.** Low as a library. The honest insufficient_input result means plug-time bills nothing until WP-26 and WP-37 land - that is intended, not a regression.

### WP-08 — Active-connector and active-driver counting from enablement intervals

**Why.** Clears the library half of B5. assets.connectors carries status + status_updated_at but NO enablement history, so 'connector enabled during the billing month' (subscription.ts:9) has no reproducible source; same hole on the driver side. The 200/50 kr charges cannot be computed from current-state flags. Define the interval algebra now so WP-25 knows what to store.

**Touches.** `packages/commercial/src/core-billing/subscription.ts, packages/commercial/src/core-billing/subscription.test.ts, packages/commercial/src/index.ts`

**Acceptance.** subscription.ts exports countActive(intervals, periodStartUtc, periodEndUtc) taking append-only {subjectId, enabledAt, disabledAt|null} rows and returning the distinct subject count with any overlap in the period. Period boundaries are UTC+0 half-open [start, end). A subject enabled and disabled inside the period counts once. The function never reads a current-state status field.

**Tests.** Enabled before and still enabled, enabled mid-period, disabled mid-period, enabled and disabled within the period, an interval entirely outside, two intervals for the same subject counted once, and a UTC month-boundary test at 00:00:00Z.

**Depends on.** NONE · **Risk.** Medium. The commercial rule 'active during the month' is a billing decision; confirm counting-any-overlap (not proration) matches the 200/50 kr contract before merging.

### WP-09 — Subscription line assembly with the 450 kr/connector/month cap

**Why.** Turns WP-08's counts into billable lines under the stated commercial model: 200 kr/active connector/month + 50 kr/active driver/month, capped 450 kr/connector/month. Without this the period run in WP-49 has nothing to assemble.

**Touches.** `packages/commercial/src/core-billing/subscription.ts, packages/commercial/src/core-billing/subscription.test.ts`

**Acceptance.** buildSubscriptionLines({connectorCount, driverCount, prices}) returns ordered line objects in Aurar with the cap applied as capAurar = 450kr * connectorCount evaluated against the connector+driver subtotal, plus an explicit capApplied flag and the pre-cap subtotal retained for the statement. Prices are inputs, not constants.

**Tests.** Under cap, exactly at cap, over cap (driver-heavy org), zero connectors with non-zero drivers, and a test asserting capApplied is surfaced so the statement can show it.

**Depends on.** WP-01, WP-08 · **Risk.** Medium. Cap semantics (per connector, applied to the combined subtotal) must be confirmed against the commercial model; the flag makes it auditable either way.

### WP-10 — Locked tariff chain result type covering DSO, retailer, CPO add-on and plug-time

**Why.** Supports B1 and B2. The retailer component is resolved at resolve-tariff-chain.ts:286 and DISCARDED at projections.ts:444. A chain result type that carries every component plus each component's effective window is the contract WP-33 and WP-34 write against.

**Touches.** `NEW packages/commercial/src/core-billing/tariff-chain.ts, NEW packages/commercial/src/core-billing/tariff-chain.test.ts, packages/commercial/src/index.ts`

**Acceptance.** tariff-chain.ts exports LockedTariffChain with named slots for dso, retailer, cpoAddOn and plugTime, each carrying rateId, computeRule, validFrom, validUntil and the instant the lock was taken. A chain missing a required component is a typed failure naming the slot. No slot may be silently dropped.

**Tests.** Full chain round-trip, missing retailer producing a named failure (the exact projections.ts:444 loss), a chain whose components have different effective windows, and a serialisation test proving the whole chain survives JSON round-trip for snapshot storage.

**Depends on.** WP-02, WP-03 · **Risk.** Low.

### WP-11 — CDR mismatch tolerance and the billing_review_required decision

**Why.** Locked decision: CDR mismatch beyond tolerance -> billing_review_required. cdr-provenance.ts and provenance-state.ts exist and are unimported. Needed before the CDR overlay in WP-38 stops silently re-pricing.

**Touches.** `packages/commercial/src/core-billing/cdr-provenance.ts, packages/commercial/src/core-billing/provenance-state.ts, their .test.ts siblings, packages/commercial/src/index.ts`

**Acceptance.** A single exported decide({ocppPair, cdrPair, tolerance}) returns accept_cdr, keep_ocpp or billing_review_required with a machine-readable reason. Tolerance is an input. The function is total and never mutates either reading. provenance-state transitions are exhaustive and a state diagram comment lists every legal transition.

**Tests.** Exact match, within tolerance, beyond tolerance, CDR missing, OCPP missing, both missing, and a test asserting no transition path can move a session out of billing_review_required without an explicit resolve input.

**Depends on.** WP-06 · **Risk.** Low.

### WP-12 — Fix the delivery-log ack defect so provider_ack_without_id is reachable

**Why.** Named defect: classifyEmailResult's provider_ack_without_id branch (delivery-log.ts:112-119) can never fire because email.ts:91-99 turns ack-without-id into {ok:false, reason:'send_failed', status:2xx}, which falls through to retriable at :136 - so an unidentifiable ack is retried 5x, sending duplicate statements. Exactly what its own comment says must not happen. Cheap, high value, and must land before any statement is ever delivered.

**Touches.** `packages/commercial/src/core-billing/delivery-log.ts:112-119, delivery-log.ts:136, packages/commercial/src/core-billing/delivery-log.test.ts, NEW EmailSendOutcome type exported from delivery-log.ts`

**Acceptance.** delivery-log.ts exports an EmailSendOutcome union that can express 'provider acknowledged, no message id' as a first-class case; classifyEmailResult routes it to provider_ack_without_id (terminal, non-retriable, flagged for human check) and never to the retriable branch at :136. A 2xx status can no longer be carried on an ok:false send_failed result.

**Tests.** A test that reproduces the exact email.ts:91-99 shape ({ok:false, reason:'send_failed', status:202}) and asserts the classification is provider_ack_without_id and retriable===false - this test must fail against current delivery-log.ts before the fix. Plus 4xx, 5xx, network error, and ack-with-id cases.

**Depends on.** NONE · **Risk.** Low in the library; the real duplicate-send risk persists until WP-40 maps email.ts onto EmailSendOutcome.

### WP-13 — period-close hardening: closed marker, no silent mutation, correction path

**Why.** Clears the library half of B3. period-close.ts is pure with ZERO callers, and statementAction's resend branch (period-close.ts:236-238) requires a stored document that no longer exists - billing.statements.content JSONB (20260424090905_v3_foundation/migration.sql:608) was the only column that ever held one and the table was dropped in prisma/migrations/20260807120000_drop_never_used_tables.

**Touches.** `packages/commercial/src/core-billing/period-close.ts, period-close.ts:236-238, packages/commercial/src/core-billing/period-close.test.ts`

**Acceptance.** period-close.ts models an explicit period state machine (open -> closing -> closed) with closedAt; every mutating action against a closed period returns period_closed rather than succeeding; corrections are expressed as new lines in the next open period carrying correctionOfId; and the resend branch takes the stored document as a required input instead of assuming one can be regenerated.

**Tests.** Close an open period, re-close (idempotent), write to a closed period (rejected), correction against a closed period lands in the next open period, resend without a stored document returns a named failure, and an exhaustive transition table test.

**Depends on.** WP-04 · **Risk.** Medium. This fixes the semantics; the storage that makes them real is WP-22 and WP-27.

### WP-14 — Statement document builder: CSV plus human-readable, from snapshots only

**Why.** Launch scope is CSV + human-readable statement first, bank/e-invoice adapters later, and the locked total rule is statement total = sum of rounded lines. The builder must read settlement snapshots (WP-04), never live tariff rows, or B1 re-enters through the statement.

**Touches.** `NEW packages/commercial/src/core-billing/statement-document.ts, NEW packages/commercial/src/core-billing/statement-document.test.ts, NEW packages/commercial/src/core-billing/__fixtures__/, packages/commercial/src/index.ts`

**Acceptance.** buildStatementDocument({orgId, period, settlements, subscriptionLines}) returns {csv, text, totalIsk, lines} where totalIsk === sum of per-line rounded ISK, output is deterministic and byte-stable for identical input, and the function's type signature makes a tariff-definition lookup impossible (it accepts snapshots only). CSV columns are documented in the module header.

**Tests.** Golden-file tests for csv and text; a total test proving sum-of-rounded != rounded-sum on a crafted case and that the builder uses the former; determinism test (build twice, compare bytes); an ISK formatting/locale test; and a test with a correction line present.

**Depends on.** WP-01, WP-04, WP-09 · **Risk.** Medium. Golden files must be regenerated deliberately - guard against a careless snapshot update masking a total-calculation change.

---

## ci-guards (8)

### WP-15 — scripts/check-money-units.mjs - no local aurar/ISK converters outside the money module

**Why.** Locks the 100x bug shut permanently. Two independent local converters exist (driver-sessions.ts:93-98 and driver-invoices.ts:69) and disagreed for months. Modelled on the existing offline source checks scripts/check-pricing-ssot.mjs and scripts/check-invite-guard.mjs, which are already wired into scripts/check-all.mjs.

**Touches.** `NEW scripts/check-money-units.mjs, NEW scripts/check-money-units.test.mjs, scripts/check-all.mjs`

**Acceptance.** The check greps the source tree for local minor->major conversion (identifiers matching minorToIsk/toIsk/fromAurar/aurarTo* and literal /100 or *100 applied to a name containing aurar|minor|amount) and fails on any hit outside packages/commercial/src/core-billing/money.ts. It ships with an explicit ALLOWLIST containing exactly driver-sessions.ts:93-98 and driver-invoices.ts:69, each with a comment naming WP-32 as the WP that deletes the entry. Wired into scripts/check-all.mjs. Runs offline, no DB.

**Tests.** scripts/check-money-units.test.mjs with fixture sources: a violating file fails, an allowlisted file passes, money.ts itself passes, and a test asserting the allowlist is non-empty today (so emptying it in WP-32 is a visible diff).

**Depends on.** WP-01 · **Risk.** Low. Regex-based checks over-match; keep the pattern narrow and the test fixtures explicit.

### WP-16 — scripts/check-compute-rule-vocabulary.mjs - publishable kinds must be priceable

**Why.** Guards B7 permanently. lib/billing/tariff-zod.ts:22 publishes flat_per_kwh and flat_per_session while resolve-tariff-chain.ts:90 accepts only 'flat' and throws compute_rule_unsupported at :119-122. Nothing today makes those two lists diverge loudly.

**Touches.** `NEW scripts/check-compute-rule-vocabulary.mjs, NEW scripts/check-compute-rule-vocabulary.test.mjs, scripts/check-all.mjs, reads lib/billing/tariff-zod.ts:22 and resolve-tariff-chain.ts:90`

**Acceptance.** The check statically extracts the publishable kind list from lib/billing/tariff-zod.ts:22 and the accepted-kind set from resolve-tariff-chain.ts:90 and fails if publishable is not a subset of accepted, printing the offending kinds. Allowlist contains flat_per_kwh and flat_per_session today, annotated with WP-33 as the remover. Wired into scripts/check-all.mjs.

**Tests.** Fixture pair where publish superset fails, matched sets pass, and a test asserting the extractor finds the real kinds in the actual two files (so a refactor that moves the list breaks the guard loudly rather than silently passing).

**Depends on.** WP-02 · **Risk.** Medium. Static extraction is brittle if the zod schema is refactored; the extractor must fail closed (no kinds found = error, not pass).

### WP-17 — scripts/check-orgid-param.mjs - every billing.* gate must pass orgIdParam

**Why.** Guards B4. 41 executable billing.* gates, only 8 pass orgIdParam. A gate without orgIdParam sets orgId=null (require-permission.ts:70-72) and effective-permissions.ts:204 then SKIPS the membership lookup, making those gates unreachable for org members AND tenant-wide for platform grants. Modelled on scripts/check-pricing-ssot.mjs as instructed.

**Touches.** `NEW scripts/check-orgid-param.mjs, NEW scripts/check-orgid-param.test.mjs, scripts/check-all.mjs`

**Acceptance.** The check enumerates every requirePermission call site whose verb starts with 'billing.' and fails when orgIdParam is absent. It prints file:line for each violation. It ships with an allowlist of exactly the 33 currently-failing gates, each annotated with WP-42, and asserts the total billing.* gate count is 41 so a newly added ungated route cannot hide inside a stale allowlist. Wired into scripts/check-all.mjs.

**Tests.** scripts/check-orgid-param.test.mjs: fixture route with orgIdParam passes, without fails, non-billing verb ignored, allowlisted site passes, and a count-drift test that fails when the real gate total changes.

**Depends on.** NONE · **Risk.** Medium. If the check cannot parse a call form it must report unparseable-as-failure; a silent skip here would recreate exactly the hole it guards.

### WP-18 — scripts/check-dead-verbs.mjs - every permission verb needs at least one gate

**Why.** Cheap cleanup with real authz value. billing.export (permissions.ts:66) and tariff.read/tariff.write (permissions.ts:68-69) have zero call sites yet are bundled into MANAGER/ADMIN/FINANCE, so those roles carry authority that no code enforces and no reviewer can reason about.

**Touches.** `NEW scripts/check-dead-verbs.mjs, NEW scripts/check-dead-verbs.test.mjs, scripts/check-all.mjs, reads permissions.ts:66, permissions.ts:68-69`

**Acceptance.** The check cross-references every verb declared in permissions.ts against requirePermission call sites and fails on any verb with zero sites, printing verb and declaration line. Allowlist contains exactly billing.export, tariff.read, tariff.write annotated with WP-46. Wired into scripts/check-all.mjs.

**Tests.** Fixture with a used verb (passes), an unused verb (fails), an allowlisted unused verb (passes), and a test asserting the three real dead verbs are detected against the actual permissions.ts.

**Depends on.** NONE · **Risk.** Low.

### WP-19 — scripts/check-orphan-enums.mjs - no Prisma enum without a referencing field

**Why.** Cheap cleanup. InvoiceStatus, BalanceType, PlanCategory, TerminationBehavior and BillingTxType survived the table drops in prisma/migrations/20260807120000_drop_never_used_tables. They mislead every reader into thinking an invoice subsystem exists.

**Touches.** `NEW scripts/check-orphan-enums.mjs, NEW scripts/check-orphan-enums.test.mjs, scripts/check-all.mjs, reads prisma/*.prisma`

**Acceptance.** The check parses the Prisma schema files, fails on any enum with zero referencing model fields, and prints enum name and file. Allowlist contains exactly the five named enums annotated with WP-30. Wired into scripts/check-all.mjs. Composes with the existing scripts/check-schema-consistency.mjs rather than duplicating its parser if one is exported.

**Tests.** Fixture schema with a referenced enum (passes) and an orphan (fails); a test asserting all five real orphans are found in the live schema.

**Depends on.** NONE · **Risk.** Low.

### WP-20 — scripts/check-domain-events.mjs - every subscribed event must have a producer

**Why.** Catches the silent hole that empties billing data: projections.ts:424 onSessionStopped is registered on domain event 'session.stopped' which no producer emits, because gateway/src/identity-do.ts:602 mints only ocpp.raw.<action>. Same root cause empties charging.meter_values. Only three of four session_ledger writers are reachable and nothing said so.

**Touches.** `NEW scripts/check-domain-events.mjs, NEW scripts/check-domain-events.test.mjs, scripts/check-all.mjs, reads projections.ts:424 and gateway/src/identity-do.ts:602`

**Acceptance.** The check builds the set of emitted event names and the set of subscribed event names across apps/api and gateway and fails on any subscription with no emitter (and warns on any emitter with no subscriber). 'session.stopped' is the one allowlisted failure today, annotated with WP-35. Wired into scripts/check-all.mjs.

**Tests.** Fixture emitter/subscriber pairs, an orphan subscription failing, wildcard/templated event names (ocpp.raw.<action>) handled explicitly rather than matched loosely, and a test asserting session.stopped is detected as orphaned in the real tree.

**Depends on.** NONE · **Risk.** Medium. Dynamic event names can defeat static matching; the check must treat an unresolvable name as a failure, not a pass.

### WP-21 — scripts/check-commercial-exports.mjs - imported subpaths must exist in the exports map

**Why.** Prevents the whole api-writes lane from tripping on packaging. packages/commercial/package.json exports map has no './core-billing/*' subpath, so every wiring WP must import from the root barrel (projections.ts:31 already does for sessionEnergyWh). Nothing enforces that today.

**Touches.** `NEW scripts/check-commercial-exports.mjs, NEW scripts/check-commercial-exports.test.mjs, scripts/check-all.mjs, reads packages/commercial/package.json and all @straumvakt commercial import sites`

**Acceptance.** The check collects every import specifier resolving into packages/commercial and fails on any that is not satisfied by the package's exports map, printing importer file:line and the missing subpath. Wired into scripts/check-all.mjs. No allowlist needed - the tree passes today.

**Tests.** Fixture package.json plus importers: root-barrel import passes, deep ./core-billing/* import fails, and a test asserting the real tree currently passes.

**Depends on.** NONE · **Risk.** Low. Decide explicitly whether to add the './core-billing/*' subpath instead; this WP encodes the barrel-only decision.

### WP-22 — Make the parity suite runnable and non-skippable in CI

**Why.** Parity tests need PARITY_DATABASE_URL, are describe.skipIf(!hasDb) and are NOT in npm run check - so today they report green while running nothing. Every schema and pricing WP that follows depends on parity actually executing.

**Touches.** `scripts/check-all.mjs, package.json scripts, the parity spec files' describe.skipIf sites, NEW scripts/parity-preflight.mjs, CI workflow config`

**Acceptance.** A new npm script runs the parity suite against a disposable local/ephemeral database; parity-preflight.mjs fails with a clear message when PARITY_DATABASE_URL is unset AND CI is set, so a skip in CI is an error while a local skip stays allowed. npm run check invokes the preflight. No live/staging database is targeted and no connection string is committed.

**Tests.** Preflight unit test for the four combinations of CI set/unset and PARITY_DATABASE_URL set/unset; one parity spec asserted to actually execute (non-zero assertion count) in a CI-simulated run.

**Depends on.** NONE · **Risk.** Medium. Requires a throwaway database in CI. Do not point this at any live branch - the Neon default-branch trap makes a wrong branchId silently destructive.

---

## schema (9)

### WP-23 — Migration: billing_periods table (additive, with rollback)

**Why.** Clears the storage half of B3. There is NO billing period table: billing.invoices, billing.invoice_lines, billing.statements and reports.billing_period_summary were dropped in prisma/migrations/20260807120000_drop_never_used_tables, and reports.billing_period_summary would not have helped - its DDL was a recomputable rollup with computed_at, no state, no closed_at, no immutability.

**Touches.** `NEW prisma/migrations/<ts>_add_billing_periods/migration.sql, NEW prisma/migrations/<ts>_add_billing_periods/rollback.sql, prisma/commercial.prisma`

**Acceptance.** billing.billing_periods exists with org_id, period_start (UTC), period_end (UTC, half-open), state enum (open|closing|closed), closed_at, closed_by, created_at, and a unique constraint on (org_id, period_start). Migration is additive only - it drops nothing and backfills nothing. A rollback.sql that drops the table cleanly is committed beside it and has been executed against a scratch database. Prisma model matches the DDL and scripts/check-schema-consistency.mjs passes.

**Tests.** Migrate-up then migrate-down on a scratch database leaves the schema byte-identical; unique constraint rejects a duplicate period; state enum rejects an unknown value; parity suite (WP-22) green.

**Depends on.** WP-13, WP-22 · **Risk.** Medium. Period boundary convention (half-open, UTC+0) must match WP-08 exactly or subscription counts will disagree with period membership.

### WP-24 — Migration: reports.session_settlements snapshot table (additive, with rollback)

**Why.** Clears the storage half of B2. session_ledger (commercial.prisma:297-336) stores only a mutable tariff_definition_id. The snapshot must be a separate append-only table so that no existing writer can overwrite settled figures.

**Touches.** `NEW prisma/migrations/<ts>_add_session_settlements/migration.sql + rollback.sql, prisma/commercial.prisma`

**Acceptance.** reports.session_settlements exists with one row per session (unique session_id FK to reports.session_ledger) carrying every field in the WP-04 SessionSettlement type: per-component ex-VAT aurar including the retailer component, vat_rate_pct, ex-VAT/VAT/gross split, currency, rate id + validFrom/validUntil per component, locked_at, meter_start_wh, meter_stop_wh, plug_time_seconds (nullable), billing_period_id FK, statement_id (nullable), closed boolean, correction_of_id (nullable self-FK). Additive; no writer wired in this WP. rollback.sql committed and exercised.

**Tests.** Up/down round-trip on a scratch DB; unique session_id enforced; FK to billing_periods enforced; a column-by-column test asserting the table covers the WP-04 type with no missing field; parity green.

**Depends on.** WP-04, WP-23 · **Risk.** High. Getting the column set wrong means a second migration over a table that is meant to be immutable. Review against B2's list explicitly.

### WP-25 — Migration: connector and driver enablement event tables (additive, with rollback)

**Why.** Clears the storage half of B5. assets.connectors carries status + status_updated_at but no enablement history, and the driver side has the same hole, so the 200/50 kr charges have no reproducible source. Append-only intervals are the only shape WP-08's countActive can consume.

**Touches.** `NEW prisma/migrations/<ts>_add_enablement_events/migration.sql + rollback.sql, prisma/assets.prisma, prisma/commercial.prisma`

**Acceptance.** Two append-only tables exist (connector enablement events and driver enablement events) with subject id, org_id, enabled_at, disabled_at nullable, source, created_at, and an index on (org_id, enabled_at). No UPDATE path is intended - document that closure is an UPDATE of disabled_at only, guarded in WP-36. Additive; assets.connectors.status is untouched. rollback.sql committed and exercised.

**Tests.** Up/down round-trip; index present; a query test proving WP-08's countActive input shape can be produced by a single indexed query for one org-month; parity green.

**Depends on.** WP-08, WP-23 · **Risk.** Medium. History before this migration does not exist and cannot be reconstructed - WP-31 must mark pre-migration months as unbillable rather than guessing.

### WP-26 — Migration: distinct charging-cease and unplug timestamps (additive, with rollback)

**Why.** Clears the storage half of B6. There is no unplug timestamp and no charging-cease timestamp anywhere; ocpp_stopped_at and cdr_stopped_at are two feeds' values for the SAME session-end instant, both written alongside canonical endedAt. Plug-time has no input until these columns exist.

**Touches.** `NEW prisma/migrations/<ts>_add_plug_time_anchors/migration.sql + rollback.sql, prisma/commercial.prisma (session), prisma/charging schema for the session table carrying ocpp_stopped_at/cdr_stopped_at`

**Acceptance.** Two new nullable timestamptz columns exist - charging_ceased_at and unplugged_at - documented in the schema as semantically distinct from endedAt, ocpp_stopped_at and cdr_stopped_at, with a comment stating that neither may be backfilled from any of those three. No backfill in this migration. rollback.sql committed and exercised.

**Tests.** Up/down round-trip; a check that no migration in this WP writes a value into either column; parity green.

**Depends on.** WP-07, WP-23 · **Risk.** Low as schema. The columns stay null until WP-37 wires capture, and plug-time bills nothing until then - state this in the launch plan rather than papering over it.

### WP-27 — Migration: statements table with content JSONB, plus delivery_log (additive, with rollback)

**Why.** Clears the remaining storage half of B3. billing.statements.content JSONB (20260424090905_v3_foundation/migration.sql:608) was the only column that ever held a stored document, and statementAction's resend branch (period-close.ts:236-238) requires one. The table was dropped in 20260807120000_drop_never_used_tables and must come back with an immutability contract this time.

**Touches.** `NEW prisma/migrations/<ts>_add_statements_and_delivery_log/migration.sql + rollback.sql, prisma/commercial.prisma`

**Acceptance.** billing.statements exists with org_id, billing_period_id FK, content JSONB (the rendered document), total_isk, generated_at, and a document_hash; a delivery log table exists with statement_id, attempt number, outcome enum matching WP-12's EmailSendOutcome classifications, provider_message_id nullable, classified_reason, created_at, and a unique idempotency key per (statement_id, attempt). Additive; no writers wired here. rollback.sql committed and exercised.

**Tests.** Up/down round-trip; the outcome enum values are asserted equal to the WP-12 classification list; idempotency unique constraint rejects a duplicate attempt key; parity green.

**Depends on.** WP-12, WP-14, WP-23 · **Risk.** Medium. The outcome enum must stay in lockstep with the library union - the enum-equality test is the mechanism.

### WP-28 — Migration: period column on agreements.billing_lines (additive, with backfill script)

**Why.** agreements.billing_lines cannot be rolled up by period: no period column, only createdAt (commercial.prisma:783), and the tick runs off cron so a late CDR lands in the wrong month. Any statement built from these lines is wrong for late data.

**Touches.** `NEW prisma/migrations/<ts>_billing_lines_period/migration.sql + rollback.sql, prisma/commercial.prisma:783, NEW scripts/backfill-billing-line-periods.mjs`

**Acceptance.** agreements.billing_lines gains nullable billing_period_id FK and effective_at timestamptz (the business instant, not the write instant), plus an index on (billing_period_id). A separate idempotent, dry-run-first backfill script sets effective_at from createdAt for existing rows and records that those rows are createdAt-derived. rollback.sql committed and exercised.

**Tests.** Up/down round-trip; backfill script dry-run produces a diff report and writes nothing; second run after a real run is a no-op; a test proving a row with effective_at in month N and createdAt in month N+1 rolls up to N.

**Depends on.** WP-23 · **Risk.** Medium. Backfilled effective_at is a best guess for history; it must be labelled as such so nobody treats old months as authoritative.

### WP-29 — Migration: one-current-per-code constraint and expired-row immutability for RateReference

**Why.** Two RateReference rows for one code can both be 'current' (createRateReference auto-closes only the row active at now(), billing-rate-references.ts:229-238); listRateReferences labels the OLDEST as current (:141-143) while the resolver prices with the NEWEST (resolve.ts:135-136). Separately, expired rows are resurrectable because the repository rejects only status==='current' (billing-rate-references.ts:312). The database must make both states impossible, not just the code.

**Touches.** `NEW prisma/migrations/<ts>_rate_reference_integrity/migration.sql + rollback.sql, prisma/commercial.prisma`

**Acceptance.** A partial unique index enforces at most one status='current' row per rate code; a check constraint or trigger prevents transitioning a row out of 'expired'; a pre-migration report script lists any existing duplicate-current rows and the migration refuses to apply while duplicates exist. rollback.sql committed and exercised.

**Tests.** Insert two current rows for one code (rejected); update an expired row to current (rejected); migration against a scratch DB seeded with a duplicate pair fails with the intended message; parity green.

**Depends on.** WP-03, WP-23 · **Risk.** High. If staging or test data already contains duplicate-current rows the migration blocks - that is deliberate, but the data must be reconciled by a human first. Do not auto-pick a winner.

### WP-30 — Cleanup migration: drop orphan enums and dead DSO Site anchors (with rollback)

**Why.** Two named cheap cleanups. Orphan enums InvoiceStatus, BalanceType, PlanCategory, TerminationBehavior, BillingTxType survive dropped tables. Four DSO-family Site anchors are dead schema - usrfTariffId, usrfPremTariffId, xtrrfTariffId, spvivfTariffId (assets.prisma:60-63) - while resolve-tariff-chain.ts:192 selects only dsoTariffId. Both mislead anyone implementing B1/B2.

**Touches.** `NEW prisma/migrations/<ts>_drop_orphan_billing_types/migration.sql + rollback.sql, prisma/assets.prisma:60-63, prisma/commercial.prisma`

**Acceptance.** The five enums and the four Site columns are dropped. A pre-drop verification query proving all four columns are 100% NULL (or the drop is deferred and the WP is split) is recorded in the migration header. rollback.sql recreates the enums and the four nullable columns. WP-19's allowlist is emptied in this WP and the guard passes with no exemptions.

**Tests.** Up/down round-trip; check-orphan-enums.mjs passes with an empty allowlist; a grep test asserting zero code references to the four dropped column names; parity green.

**Depends on.** WP-19, WP-23 · **Risk.** Medium. This is the only destructive migration in the lane - it must run after the additive ones and the NULL-verification must be real, not assumed.

### WP-31 — Backfill: settlement snapshots for historical sessions, honestly labelled unlocked

**Why.** Sessions priced before B1 was fixed have no recoverable rate lock (the rate was read at pricing time from a mutable computeRule and the retailer component was discarded at projections.ts:444). They must not silently appear as settled with a fabricated snapshot.

**Touches.** `NEW scripts/backfill-session-settlements.mjs, reports.session_settlements, reports.session_ledger (commercial.prisma:297-336)`

**Acceptance.** An idempotent, dry-run-first script writes a settlement row for each historical session with provenance='backfilled_unlocked', the retailer component explicitly null, rate effective windows null, and meter_start_wh/meter_stop_wh populated only where both readings genuinely exist. The script never invents a rate window or a retailer price. A summary report states how many months are unbillable as a result. No live system is targeted; the script takes an explicit connection string argument and refuses to run without --confirm.

**Tests.** Dry-run writes nothing and reports counts; second real run is a no-op; a session with a single overwritten energy_wh (projections.ts:961 then zaptec-session-sync.ts:313) yields null meter pair rather than a guessed one; a test asserting no backfilled row has provenance='locked'.

**Depends on.** WP-24, WP-25 · **Risk.** High politically, low technically: the output is a public admission that history cannot be restated. That is correct and must not be softened.

---

## api-writes (10)

### WP-32 — Fix the 100x driver-facing unit bug at both call sites

**Why.** Named cheap high-value fix. driver-sessions.ts:93-98 minorToIsk returns Number(minor) unchanged with the comment 'ISK has no minor unit' which is wrong; driver-invoices.ts:69 uses the same value while its comment at :21 correctly says aurar. Routes driver.ts:713 and driver.ts:739 serve both to drivers. Every driver-facing price is 100x too high (or the two screens disagree).

**Touches.** `driver-sessions.ts:93-98, driver-invoices.ts:69, driver-invoices.ts:21 (comment), driver.ts:713, driver.ts:739, scripts/check-money-units.mjs (empty allowlist)`

**Acceptance.** Both local converters are deleted and both routes format through the WP-01 money module (imported from the packages/commercial root barrel). The wrong comment at driver-sessions.ts:93-98 is gone. scripts/check-money-units.mjs ALLOWLIST is emptied and the guard passes. A written note records that driver-facing figures change by 100x and what the correct figure is.

**Tests.** Route-level tests for driver.ts:713 and driver.ts:739 asserting the exact ISK value for a known aurar input; a regression test pinning that the two routes return the same figure for the same session; check-money-units.mjs green with empty allowlist.

**Depends on.** WP-01, WP-15 · **Risk.** High user-visible impact by design - amounts drivers see change by two orders of magnitude. Coordinate the messaging; do not ship it quietly.

### WP-33 — Make published computeRule kinds priceable and stop rolling back session.stopped

**Why.** Clears B7. resolve-tariff-chain.ts:90 accepts only kind==='flat' and throws compute_rule_unsupported at :119-122; the throw is inside the projection transaction (projections.ts:4-8) so a bad computeRule rolls back the session.stopped row too - a pricing vocabulary mismatch destroys operational data.

**Touches.** `resolve-tariff-chain.ts:90, resolve-tariff-chain.ts:119-122, projections.ts:4-8, lib/billing/tariff-zod.ts:22, scripts/check-compute-rule-vocabulary.mjs (empty allowlist)`

**Acceptance.** The resolver delegates to WP-02's priceComputeRule and handles flat, flat_per_kwh and flat_per_session. The unsupported case returns a typed failure that marks the session billing_review_required OUTSIDE the projection transaction; the session.stopped row always persists. scripts/check-compute-rule-vocabulary.mjs passes with an empty allowlist.

**Tests.** One pricing test per kind; a test asserting an unknown kind persists the session row and sets billing_review_required (must fail against current code); a transaction test proving no rollback of session.stopped on pricing failure; guard green.

**Depends on.** WP-02, WP-11, WP-16 · **Risk.** Medium. Moving the failure out of the transaction changes projection control flow at projections.ts:4-8 - review the transaction boundary carefully.

### WP-34 — Wire rate lock-in at session start into the tariff chain

**Why.** Clears B1. compute-session-cost.ts:69-70 declares startedAt/stoppedAt in SessionInput and never reads them; resolve-tariff-chain.ts has zero references to validFrom/validUntil/effectiveFrom and selects by FK pointer, reading whatever computeRule is current at pricing time - so editing a rate silently restates history. billing.tariff_definitions already has validFrom/validUntil columns that no resolver reads.

**Touches.** `compute-session-cost.ts:69-70, resolve-tariff-chain.ts (selection path), resolve-tariff-chain.ts:192, resolve-tariff-chain.ts:286, packages/commercial/src/core-billing/rate-window.ts (consumed via root barrel)`

**Acceptance.** resolve-tariff-chain resolves every component - DSO, retailer, CPO add-on, plug-time - via selectRateAtInstant(rows, session.startedAt) using billing.tariff_definitions.validFrom/validUntil, and returns a LockedTariffChain (WP-10) including the retailer component. compute-session-cost reads startedAt. Editing a tariff no longer changes any already-priced session's result.

**Tests.** The decisive regression test: price a session, edit the tariff's computeRule, re-price, assert the figure is unchanged - must fail against current code. Plus a session started before a rate change priced at the old rate, a session started after priced at the new one, and no_rate_at_instant surfacing as billing_review_required rather than a default price.

**Depends on.** WP-03, WP-10, WP-33 · **Risk.** High. This changes prices for any session whose tariff was edited after pricing. Run WP-22 parity before and after and diff the outputs deliberately.

### WP-35 — Emit session.stopped so the fourth ledger writer and meter_values come alive

**Why.** Only three of four session_ledger writers are reachable: projections.ts:424 onSessionStopped is registered on domain event 'session.stopped' which no producer emits, because gateway/src/identity-do.ts:602 mints only ocpp.raw.<action>. The same root cause empties charging.meter_values. Any period close built on incomplete ledger data is wrong.

**Touches.** `gateway/src/identity-do.ts:602, projections.ts:424, scripts/check-domain-events.mjs (empty allowlist)`

**Acceptance.** A producer emits the domain event 'session.stopped' on the OCPP stop path (either by translating ocpp.raw.StopTransaction or by emitting alongside it), onSessionStopped at projections.ts:424 executes, and charging.meter_values receives rows. scripts/check-domain-events.mjs passes with an empty allowlist. The change is idempotent - a replayed ocpp.raw.StopTransaction must not double-write the ledger.

**Tests.** An integration test driving an OCPP StopTransaction through the gateway and asserting a session_ledger row and meter_values rows appear; a replay test asserting idempotency; guard green.

**Depends on.** WP-20 · **Risk.** High. Turning on a writer that has never run will surface every latent assumption in onSessionStopped. Expect the first run to fail loudly; that is the point. Do not deploy - land behind the existing test harness only.

### WP-36 — Write connector and driver enablement events on every status change

**Why.** Clears B5 together with WP-08 and WP-25. Without a writer the interval tables stay empty and 'active connector/driver during the month' remains uncomputable, so the 200 kr and 50 kr charges cannot be billed at all.

**Touches.** `the assets.connectors status update path (status + status_updated_at), the driver enable/disable path, NEW repository module for enablement events, the tables from WP-25`

**Acceptance.** Every transition that makes a connector or driver enabled or disabled appends an event row inside the same transaction as the status write; closing an interval sets disabled_at on the open row and never deletes or rewrites history; a re-enable opens a new row rather than reopening the closed one. Concurrent updates cannot produce two open intervals for one subject (enforced by a partial unique index or SELECT FOR UPDATE - state which).

**Tests.** Enable, disable, re-enable producing three correctly bounded intervals; a concurrency test asserting no two open intervals; a test asserting countActive (WP-08) over the written rows matches a hand-computed month; and a test proving status_updated_at alone is never used as a billing input.

**Depends on.** WP-08, WP-25 · **Risk.** Medium. History starts at deployment; every month before that is unbillable by this mechanism and must be flagged, not estimated.

### WP-37 — Capture charging_ceased_at and unplugged_at from the OCPP and CDR feeds

**Why.** Clears B6 together with WP-07 and WP-26. Today ocpp_stopped_at and cdr_stopped_at are two feeds' values for the same session-end instant; neither is an unplug event. Plug-time with grace after charging stops cannot be billed until these two distinct instants are captured.

**Touches.** `the OCPP stop/status-notification handling path, zaptec-session-sync.ts (CDR ingest), the columns from WP-26`

**Acceptance.** charging_ceased_at is written from the charging-cease signal and unplugged_at from the connector-unplugged signal, each only when the feed genuinely provides it; neither is ever derived from endedAt, ocpp_stopped_at or cdr_stopped_at. Where a feed does not provide the signal the column stays NULL and plug-time returns insufficient_input (WP-07) rather than billing zero or guessing.

**Tests.** A feed carrying both signals populates both columns; a feed carrying only stop populates charging_ceased_at and leaves unplugged_at NULL; a test asserting no code path copies endedAt/ocpp_stopped_at/cdr_stopped_at into either column; end-to-end plug-time computation over a populated session.

**Depends on.** WP-07, WP-26 · **Risk.** High. Whether the hardware/vendor feeds actually expose an unplug event is unproven - if they do not, this WP's honest outcome is 'plug-time is not billable at launch', which must be reported, not worked around.

### WP-38 — CDR overlay prices at the locked rate, not the sync-day rate

**Why.** CDR overlay re-price is once-per-CDR (ImportedCdrRef guard, zaptec-session-sync.ts:140-146) and is priced at whatever rate is configured the day the sync runs - a direct re-entry of B1 through the back door, and it also overwrites energy_wh (zaptec-session-sync.ts:313) after projections.ts:961 already wrote it.

**Touches.** `zaptec-session-sync.ts:140-146, zaptec-session-sync.ts:313, reports.session_settlements (WP-24), the WP-11 reconciliation decision`

**Acceptance.** The overlay re-prices using the LockedTariffChain stored in the session settlement, not a fresh resolve; energy_wh is no longer overwritten - the CDR reading is stored as a second MeterReadingPair and the WP-11 decision picks the billing source or raises billing_review_required; a CDR arriving after its period is closed produces a correction line in the next open period instead of mutating the closed one.

**Tests.** Overlay after a rate change asserts the original locked price is used (must fail against current code); overlay preserves the OCPP meter pair; beyond-tolerance mismatch sets billing_review_required; late CDR against a closed period creates a correction, not a mutation; ImportedCdrRef idempotency retained.

**Depends on.** WP-11, WP-13, WP-24, WP-34 · **Risk.** High. This is the second place B1 lives; missing it means the fix only half-holds.

### WP-39 — CDR sync window: require an explicit bounded range and audit the trigger

**Why.** The cron uses a 26h window (zaptec-sync-cron.ts:35) but the repository default when 'from' is omitted is 30 DAYS (zaptec-session-sync.ts:78-79), and routes/admin/vendor-credentials.ts:159 passes ?from through unmodified, gated only on platform.tenant.write with no audit row. A single manual call can re-ingest a month of CDRs at today's rates with no trace of who did it.

**Touches.** `zaptec-session-sync.ts:78-79, zaptec-sync-cron.ts:35, routes/admin/vendor-credentials.ts:159`

**Acceptance.** The repository no longer has a 30-day fallback - 'from' is required and an out-of-range or unparseable value is rejected at the route with a 400. The manual trigger clamps the window to a documented maximum, requires an explicit reason string, and writes an audit row naming actor, org, window and reason. The cron passes its 26h window explicitly.

**Tests.** Repository call without 'from' fails to typecheck/at runtime; route rejects a 90-day window; route with a valid window writes exactly one audit row containing actor and window; cron path unchanged in behaviour.

**Depends on.** WP-38 · **Risk.** Medium. Any existing caller relying on the 30-day default breaks - enumerate callers before removing the default.

### WP-40 — Map email.ts send results onto EmailSendOutcome at all 8 call sites

**Why.** Completes the delivery-log defect fix. email.ts:91-99 turns a provider ack without a message id into {ok:false, reason:'send_failed', status:2xx}, which delivery-log.ts:136 treats as retriable and retries 5x - duplicate statements, exactly what the module's own comment forbids. There are 8 production sendEmail call sites and none records the outcome.

**Touches.** `email.ts:91-99, all 8 sendEmail call sites, packages/commercial/src/core-billing/delivery-log.ts (EmailSendOutcome, consumed via root barrel)`

**Acceptance.** email.ts returns an EmailSendOutcome that can represent 'acknowledged without id' as its own case rather than a 2xx-carrying send_failed; all 8 call sites pass their outcome to the delivery-log classifier and persist the classification. No call site discards a send result.

**Tests.** A test reproducing the ack-without-id provider response end to end and asserting exactly one send attempt (no retry) plus a provider_ack_without_id record - must fail against current code; a 5xx case asserting retry still happens; a grep-style test asserting zero unhandled sendEmail return values.

**Depends on.** WP-12, WP-27 · **Risk.** Medium. Changing email.ts's return shape touches all 8 sites; do them in one WP so no site is left on the old shape.

### WP-41 — RateReference repository: correct current-labelling, auto-close, and block resurrection

**Why.** Two rows for one code can both be 'current' (createRateReference auto-closes only the row active at now(), billing-rate-references.ts:229-238); listRateReferences labels the OLDEST as current (:141-143) while the resolver prices with the NEWEST (resolve.ts:135-136) - so the UI and the invoice disagree. And PATCH can reopen an expired supplier rate because the repository rejects only status==='current' (billing-rate-references.ts:312).

**Touches.** `billing-rate-references.ts:141-143, billing-rate-references.ts:229-238, billing-rate-references.ts:312, packages/commercial/src/agreement/resolve.ts:135-136`

**Acceptance.** createRateReference closes every open row for the code, not just the one active at now(); listRateReferences derives 'current' with the same selectRateAtInstant call the resolver uses so the two can never disagree; PATCH rejects any edit to a row with status 'expired' with a named error. The DB constraints from WP-29 are the backstop, not the only defence.

**Tests.** Create a future-dated rate then another - assert one current row; list and resolver agree on 'current' for the same instant (must fail against current code); PATCH an expired row rejected; PATCH a current row still allowed.

**Depends on.** WP-03, WP-29 · **Risk.** Medium. Existing duplicate-current data must be reconciled by a human before WP-29's constraint applies - that reconciliation is a prerequisite, not part of this WP.

---

## authz-audit (8)

### WP-42 — Add orgIdParam to all 33 billing.* gates that lack it

**Why.** Clears the gate half of B4. 41 executable billing.* gates, only 8 pass orgIdParam. Without it orgId=null (require-permission.ts:70-72) and effective-permissions.ts:204 SKIPS the membership lookup - the gate is simultaneously unreachable for legitimate org members and tenant-wide for platform grants. billing-summary.ts:5-6 documents orgId scoping that was never built.

**Touches.** `the 33 billing.* requirePermission call sites enumerated by scripts/check-orgid-param.mjs, billing-summary.ts:5-6, scripts/check-orgid-param.mjs (empty allowlist)`

**Acceptance.** Every billing.* gate passes orgIdParam naming the route parameter that carries the org. scripts/check-orgid-param.mjs passes with an empty allowlist and its count assertion still reads 41. billing-summary.ts:5-6's comment either describes implemented behaviour or is deleted.

**Tests.** Per-route authz tests: an org member of org A gets 200 on org A and 403 on org B for each of the 33 routes (table-driven); a platform-grant holder is still allowed where intended; guard green with empty allowlist.

**Depends on.** WP-17 · **Risk.** High. 33 routes change access semantics at once; some are currently reachable only by platform grants and will start returning 403 to org members until the membership path works. Land with WP-43 and WP-45 reviewed together.

### WP-43 — Repository-level org re-check for the seven unscoped billing repositories

**Why.** Clears the repository half of B4. Seven repositories take no orgId at all - listCostCenters, getProjectedOrgRevenue, listRateReferences, getTariffDetail, listEnrichmentSessions, getSessionDetail, getSessionFullDetail - so a correct gate is still the only thing between a caller and another tenant's data. The correct two-layer pattern already exists at bill-objects (gate orgIdParam plus repository re-check at repositories/bill-objects.ts:127).

**Touches.** `the seven named repository functions, modelled on repositories/bill-objects.ts:127`

**Acceptance.** Each of the seven takes orgId as a required first-class argument and filters or re-checks on it exactly as repositories/bill-objects.ts:127 does; a caller cannot omit it (typecheck failure, not a runtime default). Single-row getters return not-found rather than forbidden when the row belongs to another org.

**Tests.** For each of the seven: a row belonging to org B is invisible/not-found to an org A caller; omitting orgId fails typecheck (compile-time test or ts-expect-error fixture); the bill-objects behaviour is unchanged as the reference.

**Depends on.** WP-42 · **Risk.** Medium. Some callers currently pass nothing and rely on the unscoped read - each must be given a real org from resolveOrgScope in WP-44.

### WP-44 — Adopt resolveOrgScope across the billing routes

**Why.** Supports B4. resolveOrgScope (lib/auth/org-scope.ts:38) is used by 13 handlers but only ONE billing route (billing.ts:180). Every billing route needs one consistent way to derive the caller's org so WP-43's required orgId argument has a trustworthy source.

**Touches.** `lib/auth/org-scope.ts:38, billing.ts:180 (reference implementation), all remaining billing route handlers`

**Acceptance.** Every billing route derives its org through resolveOrgScope; no billing handler reads an org id directly from a query parameter or body without passing it through the resolver; platform-scope callers are handled by an explicit branch, never by an implicit null.

**Tests.** Table-driven route tests covering org-member, platform-grant and no-scope callers; a static test asserting zero billing handlers reference a raw org query param outside resolveOrgScope.

**Depends on.** WP-42, WP-43 · **Risk.** Medium.

### WP-45 — Fail closed when orgId is null in permission evaluation

**Why.** The root of B4's dangerous half. require-permission.ts:70-72 sets orgId=null when no orgIdParam is given and effective-permissions.ts:204 then SKIPS the membership lookup entirely - a missing parameter silently converts an org-scoped check into a tenant-wide one. This must be structurally impossible, not merely avoided by convention.

**Touches.** `require-permission.ts:70-72, effective-permissions.ts:204`

**Acceptance.** A null orgId on an org-scoped verb denies by default; granting tenant-wide access requires an explicit, named platform-scope opt-in at the call site rather than the absence of a parameter. The skip branch at effective-permissions.ts:204 is either removed or reachable only behind that explicit opt-in.

**Tests.** An org-scoped verb with null orgId denies (must fail against current code); an explicitly platform-scoped call still allows; every existing authz test suite re-run to enumerate which routes relied on the old skip.

**Depends on.** WP-42, WP-43, WP-44 · **Risk.** High. This will deny requests that currently succeed. It must land after WP-42/43/44 so the legitimate paths already pass orgId, and the full route test matrix must be green first.

### WP-46 — Dead-verb cleanup: billing.export, tariff.read, tariff.write

**Why.** Named cheap fix. These verbs (permissions.ts:66, permissions.ts:68-69) have zero call sites yet are bundled into MANAGER/ADMIN/FINANCE, so role definitions promise authority nothing enforces - and a future route author may assume the gate already exists.

**Touches.** `permissions.ts:66, permissions.ts:68-69, the MANAGER/ADMIN/FINANCE bundles, scripts/check-dead-verbs.mjs (empty allowlist)`

**Acceptance.** Each of the three verbs is either removed from the schema and all role bundles, or attached to a real gate in the same WP - and the WP states which choice was made per verb and why. scripts/check-dead-verbs.mjs passes with an empty allowlist.

**Tests.** Role-bundle snapshot tests updated deliberately; guard green with empty allowlist; a test asserting no role grants a verb that has no gate.

**Depends on.** WP-18, WP-42 · **Risk.** Low. If tariff.write is intended for the tariff editor unlocked in WP-54, attach it rather than delete it - decide before merging.

### WP-47 — Audit rows for every billing-sensitive write

**Why.** Billing actions are currently untraceable: the CDR sync trigger at routes/admin/vendor-credentials.ts:159 writes no audit row, rate reference edits write none, and period close and statement send do not exist yet but must be audited from day one. An org disputing a statement has nothing to inspect.

**Touches.** `routes/admin/vendor-credentials.ts:159, billing-rate-references.ts (create/patch paths), the audit repository, plus the period-close and statement-send entry points introduced in WP-48 and WP-51`

**Acceptance.** A single audit helper records actor, org, action, target id, before/after summary and reason for: manual CDR sync, rate reference create/patch/expire, period close and reopen attempt, statement generate, statement send and resend. Audit writes happen in the same transaction as the mutation. A missing audit row fails the test suite, not just review.

**Tests.** One test per action asserting exactly one audit row with the expected fields; a rollback test proving no audit row survives a failed mutation; a static test asserting each listed entry point calls the helper.

**Depends on.** WP-39, WP-41, WP-45 · **Risk.** Low technically. The discipline risk is later writers forgetting - the static test is the mechanism.

### WP-48 — Create org, membership and audit atomically; close the /apply dead end

**Why.** createOrg writes NO Membership and NO audit row, so a new org is unreachable by any non-platform session - which means an onboarded customer cannot log in to see the statements this whole programme produces. HostApplication.convertedOrgId is read but written by nothing, so the /apply funnel dead-ends.

**Touches.** `createOrg, the Membership repository, the audit repository, the HostApplication conversion path writing convertedOrgId`

**Acceptance.** createOrg creates the org, at least one owner Membership and an audit row in one transaction, and refuses to commit if any part fails. The /apply conversion writes convertedOrgId so a converted application resolves to its org. A newly created org is reachable by its owner in an integration test with no platform grant.

**Tests.** createOrg integration test asserting org + membership + audit in one transaction and full rollback on failure; a login-as-owner test on a freshly created org (must fail against current code); an /apply conversion test asserting convertedOrgId is set and readable.

**Depends on.** WP-44 · **Risk.** Medium. Existing orgs created without memberships need a one-off reconciliation report - include the report, not an automatic fix.

### WP-49 — Charger-onboarding write-path test harness

**Why.** Every charger-onboarding WRITE path is untested: createCharger, importZaptecInstallation, applyCredentialSelection, createOnboardingChain, attachVendorToOcppIdentity. These paths create the connectors whose enablement events (WP-36) drive the 200 kr charge; an untested onboarding means untested billing inputs.

**Touches.** `createCharger, importZaptecInstallation, applyCredentialSelection, createOnboardingChain, attachVendorToOcppIdentity, NEW test files beside each`

**Acceptance.** Each of the five write paths has a happy-path test and at least one failure/rollback test, plus an org-scoping test asserting it cannot write into another org. Each test asserts the enablement event from WP-36 is written where a connector becomes enabled. The suite runs in npm run check without a live vendor - vendor calls are stubbed.

**Tests.** Five happy paths, five rollback paths, five cross-org rejections, and one end-to-end onboarding producing a billable connector interval.

**Depends on.** WP-36, WP-44 · **Risk.** Medium. Stubbing the Zaptec import faithfully is the bulk of the work; a too-loose stub gives false confidence.

---

## period-close (7)

### WP-50 — Period service: open, close and reopen-refusal wired to billing_periods

**Why.** Clears B3's runtime half. period-close.ts has ZERO callers; without a service nothing ever transitions a period and no statement can be anchored. The locked decision 'no silent mutation of closed periods' needs an enforcement point.

**Touches.** `NEW period service module in apps/api/src, packages/commercial/src/core-billing/period-close.ts (via root barrel), billing.billing_periods (WP-23), the audit helper (WP-47)`

**Acceptance.** The service can open a period for an org, list open periods, and close one - transitioning open -> closing -> closed with closed_at and closed_by set and an audit row written. Closing is idempotent and refuses when any session in the period is billing_review_required, listing the offenders. Reopening is not implemented; an attempt returns period_closed and writes an audit row.

**Tests.** Open/close/idempotent close; close blocked by a billing_review_required session; reopen refused and audited; concurrent close attempts produce one closed period; every write path org-scoped.

**Depends on.** WP-13, WP-23, WP-45, WP-47 · **Risk.** Medium. 'Blocked by review-required sessions' can make close impossible if the review queue (WP-53) is not usable - sequence them together.

### WP-51 — Subscription charge run for a closing period

**Why.** Clears B5 end to end. The 200 kr/connector and 50 kr/driver charges with the 450 kr/connector cap only become real when a period run reads the enablement intervals (WP-36) through countActive (WP-08) and emits lines.

**Touches.** `the period service (WP-50), packages/commercial/src/core-billing/subscription.ts via root barrel, agreements.billing_lines with billing_period_id (WP-28)`

**Acceptance.** Running a period produces subscription lines for that org-month computed only from enablement intervals, with the cap applied and capApplied recorded; a re-run of the same period is idempotent (no duplicate lines); a period whose enablement history predates WP-25 is marked unbillable-for-subscription with an explicit reason rather than producing a zero or guessed line.

**Tests.** Known interval fixture producing hand-checked counts and lines; cap case; re-run idempotency; pre-history period marked unbillable; org isolation.

**Depends on.** WP-09, WP-28, WP-36, WP-50 · **Risk.** Medium. The unbillable-for-history outcome is a commercial conversation, not a bug - surface it in the run report.

### WP-52 — Statement generation from settlement snapshots into stored content JSONB

**Why.** Clears the last of B3. billing.statements.content JSONB is the only thing that ever held a stored document and period-close.ts:236-238's resend branch requires one. The document must be built from snapshots (WP-24) so a later tariff edit cannot restate an issued statement.

**Touches.** `the period service (WP-50), packages/commercial/src/core-billing/statement-document.ts via root barrel, billing.statements (WP-27), reports.session_settlements (WP-24)`

**Acceptance.** Generating a statement for a closed period writes one billing.statements row with content JSONB, total_isk equal to the sum of rounded ISK lines, a document_hash, and statement_id stamped back onto every included settlement row. Regenerating produces a byte-identical document from the same snapshots or fails; it never silently supersedes. Sessions in the period with no settlement snapshot block generation and are listed.

**Tests.** Golden statement over a fixture period; total = sum of rounded lines; regeneration byte-identical; a tariff edited after close does not change the stored document (the B1 end-to-end proof); missing-snapshot session blocks generation; org isolation.

**Depends on.** WP-14, WP-24, WP-27, WP-34, WP-50 · **Risk.** Medium. document_hash must cover exactly the bytes delivered, or resend cannot prove it sent the same thing.

### WP-53 — Statement delivery with a real delivery log and safe resend

**Why.** delivery-log.ts has zero callers, and until WP-12/WP-40 an unidentifiable provider ack was retried 5x - duplicate statements to paying customers. Delivery must be logged per attempt and resend must replay the stored document, not regenerate one.

**Touches.** `the period service (WP-50), packages/commercial/src/core-billing/delivery-log.ts via root barrel, period-close.ts:236-238 resend branch, the delivery log table (WP-27), email.ts outcome mapping (WP-40), the audit helper (WP-47)`

**Acceptance.** Sending a statement writes one delivery-log row per attempt with the classified outcome; provider_ack_without_id is terminal and surfaces for human check instead of retrying; retries are bounded and idempotent per (statement_id, attempt); resend re-sends the stored content JSONB verified against document_hash and writes its own audit row. No path can send a statement that was never stored.

**Tests.** Successful send logs one row; 5xx retries and stops at the bound; ack-without-id sends exactly once and is flagged; resend with a tampered content vs hash refuses; resend of a never-stored statement refuses; audit row per send and resend.

**Depends on.** WP-12, WP-27, WP-40, WP-47, WP-52 · **Risk.** High customer impact - duplicate or missing statements. Do not enable real sending until the delivery log is proven in tests; keep the transport stubbed in this WP.

### WP-54 — Corrections land in the next open period, never in a closed one

**Why.** Locked decision: no silent mutation of closed periods. Late CDRs (WP-38) and manual adjustments need a destination. AgreementBillingLine.billableEventType defaults 'session', is indexed, and its comment already reserves 'manual_adjustment' with zero readers/writers - the cheapest correct path to storing corrections.

**Touches.** `agreements.billing_lines billableEventType, correction_of_id on reports.session_settlements (WP-24), the period service (WP-50), the audit helper`

**Acceptance.** A correction for a closed period creates a billing line with billableEventType='manual_adjustment' in the next open period, linked to the original via correction_of_id, with a required reason and an audit row. No code path updates a settlement or line belonging to a closed period. The statement for the receiving period shows corrections as their own labelled section.

**Tests.** Correction against a closed period lands in the next open period; correction against an open period adjusts in place; attempt to mutate a closed-period line rejected; the statement renders the correction section; audit row written; the late-CDR case from WP-38 flows through this path end to end.

**Depends on.** WP-38, WP-50, WP-52 · **Risk.** Medium. Reason text becomes part of a customer-visible document - review the wording surface.

### WP-55 — billing_review_required queue and resolution workflow

**Why.** Three mechanisms now route to billing_review_required - unsupported computeRule (WP-33), no rate at instant (WP-34) and CDR mismatch beyond tolerance (WP-38) - and WP-50 blocks period close while any exist. Without a way to see and resolve them, close is unreachable.

**Touches.** `a read repository over sessions in billing_review_required (org-scoped per WP-43), a resolve action using the WP-11 provenance state machine, the audit helper`

**Acceptance.** An org-scoped list endpoint returns review-required sessions with the machine-readable reason and the competing OCPP/CDR figures; a resolve action records the chosen source, an actor, a reason and an audit row, and moves the session to a settled state via the WP-11 transitions. Resolution never edits the settlement snapshot - it writes a new one with correction linkage.

**Tests.** Each of the three reason kinds appears in the list; resolve transitions correctly and is audited; resolve on an already-settled session rejected; cross-org read rejected; after resolving all, WP-50 close succeeds.

**Depends on.** WP-11, WP-33, WP-34, WP-38, WP-50 · **Risk.** Medium. Resolution is a human money decision - the audit trail and the immutability of the original snapshot are the controls.

### WP-56 — Org statement and CSV export read surface, org-scoped and read-only

**Why.** Launch scope includes org statement/export as CSV plus human-readable. These are the customer-facing artifacts of everything above, and they must read the stored document (WP-52) so what the org downloads is exactly what was issued.

**Touches.** `NEW org-scoped statement read/export routes, billing.statements content JSONB, resolveOrgScope (lib/auth/org-scope.ts:38), the gates covered by scripts/check-orgid-param.mjs`

**Acceptance.** An org member can list their org's issued statements and download the CSV and human-readable forms rendered from the stored content JSONB (never regenerated from live tariffs); every route passes orgIdParam and resolves org via resolveOrgScope; cross-org access returns not-found; no write verbs are exposed. Bank/e-invoice adapters are explicitly out of scope and no stub is added.

**Tests.** Download matches the stored document byte for byte and its document_hash; cross-org download rejected; a draft/unissued period is not downloadable; check-orgid-param.mjs green.

**Depends on.** WP-44, WP-52 · **Risk.** Low. Keep it strictly read-only - a write here would bypass the whole close machinery.

---

## ui-unlock (5)

### WP-57 — UI unlock: tariff editing becomes version-creating, not value-editing

**Why.** Tariff editing must stay locked until B1 is closed. Before WP-34, editing a rate silently restates every already-priced session; after it, an edit must be expressed as a new effective-dated version so the lock-in has something to select against.

**Touches.** `the tariff editor UI, lib/billing/tariff-zod.ts:22 (kind vocabulary from WP-02), the tariff write routes, tariff.write verb per WP-46`

**Acceptance.** The editor never mutates an existing tariff's computeRule; it creates a new version with a required validFrom, shows the resulting effective timeline, and warns that sessions started before validFrom keep their locked price. Only computeRule kinds accepted by the resolver are offerable (guard WP-16 green). The screen stays hidden behind a flag until WP-34, WP-41 and WP-46 are merged.

**Tests.** UI test: editing produces a new version and leaves the prior one intact; a kind not accepted by the resolver cannot be selected; the timeline renders overlapping windows as an error; an end-to-end test asserting a priced session's figure is unchanged after an edit.

**Depends on.** WP-34, WP-41, WP-46 · **Risk.** Medium. This is where a user could still restate history if the UI offers an in-place edit - review every write path the screen can reach.

### WP-58 — UI unlock: rate reference admin with a single truthful 'current'

**Why.** The rate reference screen currently cannot be trusted: listRateReferences labels the OLDEST row as current (billing-rate-references.ts:141-143) while the resolver prices with the NEWEST (resolve.ts:135-136), and expired rows are resurrectable (billing-rate-references.ts:312). Unlocking it before WP-41 would let an operator confidently set the wrong supplier rate.

**Touches.** `the rate reference admin UI, billing-rate-references.ts list/create/patch routes`

**Acceptance.** The screen shows exactly one row marked current per code, derived from the same selectRateAtInstant call the resolver uses; expired rows are visibly read-only with no edit affordance; creating a new rate shows which existing rows will be closed before the operator confirms. Unlocked only after WP-41 and WP-29 are merged.

**Tests.** UI test asserting the current badge matches the resolver's pick for the same instant; expired row has no edit control and the API also rejects it; create-confirm dialog lists the rows to be closed and matches what the repository actually closes.

**Depends on.** WP-41 · **Risk.** Low once WP-41 lands; high if unlocked earlier.

### WP-59 — UI unlock: session detail shows the settlement snapshot and its provenance

**Why.** Operators and drivers need to see what was actually billed and why. The snapshot (WP-24) carries the locked rate, the retailer component that projections.ts:444 used to discard, the ex-VAT/VAT split, the meter pair and plug-time. Backfilled history (WP-31) must be visibly labelled unlocked so nobody cites it as authoritative.

**Touches.** `the session detail UI, getSessionDetail and getSessionFullDetail (org-scoped per WP-43), reports.session_settlements`

**Acceptance.** Session detail renders every snapshot component with its rate id and effective window, the ex-VAT/VAT split, meter start and stop as two readings, plug-time seconds or an explicit 'not measurable' when the anchors are absent, and a provenance badge that reads backfilled_unlocked for pre-fix sessions. Sessions with no snapshot show 'not settled', never a recomputed figure.

**Tests.** Rendering test per provenance state; a test asserting the screen makes zero live tariff lookups; cross-org access rejected; plug-time absent renders 'not measurable' rather than 0 kr.

**Depends on.** WP-31, WP-37, WP-43, WP-52 · **Risk.** Low. The main risk is a well-meaning fallback that recomputes a missing figure - forbid it explicitly in review.

### WP-60 — UI unlock: period close, statement preview, send and delivery status

**Why.** The operator-facing end of B3. Close, generate, send and resend are irreversible money actions and must be exposed only once the period service, statement store and delivery log all exist and are audited.

**Touches.** `NEW period/statement admin UI, the period service (WP-50), statement generation (WP-52), delivery (WP-53), the review queue (WP-55)`

**Acceptance.** The screen lists periods with state and closed_at; close is blocked with a link to the review queue while any session is billing_review_required; statement preview renders the stored document; send and resend require a typed confirmation and show the delivery log per attempt including a distinct provider_ack_without_id state. There is no reopen control - closed is terminal, corrections go to the next period.

**Tests.** Close blocked by review-required and unblocked after resolution; preview matches the stored document hash; resend replays the stored document; delivery log states all render including ack-without-id; no UI path can mutate a closed period.

**Depends on.** WP-50, WP-52, WP-53, WP-54, WP-55 · **Risk.** High. Every control here writes money-relevant state - the typed confirmation plus WP-47 audit rows are the controls.

### WP-61 — UI unlock: driver billing material, and the explicit locked list for launch

**Why.** Driver-facing amounts were 100x wrong at driver.ts:713 and driver.ts:739 and must only be unlocked after WP-32 plus snapshots. Equally important, the excluded scope - DC productization, OCPI/roaming, Plug&Charge, OpenADR, contractor Service UI - must be visibly and testably off, not merely unbuilt, so nothing half-wired reaches a customer.

**Touches.** `driver.ts:713, driver.ts:739, the driver sessions and invoices screens, the feature-flag configuration, NEW test asserting the excluded surfaces are unreachable`

**Acceptance.** Driver session and invoice screens render ISK from the WP-01 money module and agree with each other and with the org statement for the same session. DC productization, OCPI/roaming, Plug&Charge, OpenADR and the contractor Service UI are behind flags that default off, and a test asserts each of their entry points returns not-found when the flag is off. A launch checklist in the repo lists what is unlocked and what is not, with the WP that would unlock each.

**Tests.** Driver figure equals the settlement snapshot figure equals the statement line for the same session (three-way agreement test); each excluded surface unreachable with the flag off; a snapshot test of the unlocked-feature list so any accidental unlock shows up in review.

**Depends on.** WP-32, WP-56, WP-59 · **Risk.** Medium. The three-way agreement test is the single best regression net for the whole programme - do not let it be weakened to make a build pass.
