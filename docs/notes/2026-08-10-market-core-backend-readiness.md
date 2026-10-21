# Market Core backend readiness

Agent: `claude-a` · lane `market-core-backend-readiness`
Worktree: `E:\Claude\Straumvakt-core-billing`, branch `scratch/claude-a-core-billing-2026-08-10`
Start tip: `56a789e`, clean.
Nothing pushed, deployed, migrated or mutated. No SQL. No cloud/DNS/remote change.

Evidence: a five-lane read-only source census (24 workflow rows) plus direct verification of every
load-bearing claim. Claims marked **[verified]** I re-checked myself; the rest carry a `file:line`
from the census and should be re-read before anyone acts on them.

---

## 0. The one-paragraph answer

The Core *arithmetic* is done and tested. Eight pure modules in
`packages/commercial/src/core-billing` — subscription, plug-time, rate-window, meter-energy,
cdr-provenance, provenance-state, period-close, delivery-log — carry ~241 tests and are correct.
**Exactly one function of the eight is used in production** (`sessionEnergyWh`, via the root barrel
at `projections.ts:31`). Everything else is a library with no caller.

What is missing is not maths. It is the *record*: there is no billing period, no statement, no
settlement snapshot, no rate lock-in, and no enablement history. Core cannot invoice a customer
today — not because the price is wrong, but because nothing durable records what was charged, for
which month, at which rate, to whom.

---

## 1. Seven launch blockers

Ordered by how much else they block.

### B1 — There is no rate lock-in at session start **[verified]**

The prompt locks *"rate lock-in at session start"*. It does not exist.

`compute-session-cost.ts:69-70` declares `startedAt` and `stoppedAt` on `SessionInput`. I grepped
the file: **those two names appear nowhere else in it.** The engine never reads them.
`resolve-tariff-chain.ts` contains **zero** references to `validFrom`, `validUntil` or
`effectiveFrom`. Pricing selects a tariff by FK pointer and reads whatever `computeRule` is current
*at pricing time*.

So editing a rate silently restates history, and `billing.tariff_definitions` has `validFrom` /
`validUntil` columns that **no resolver reads**.

The correct mechanism already exists, one directory away and disconnected:
`packages/commercial/src/agreement/resolve.ts:123-137` `pickActiveRate` does genuine effective-dated
selection at `ctx.startedAt`. It has priced **zero** sessions — `lib/agreement/billing-tick.ts:8-15`
records that its `userId != null` predicate matches nothing, and warns at `:26-28` that *"Green logs
mean scanned 0, not works."*

### B2 — There is no session settlement snapshot

`reports.session_ledger` (`commercial.prisma:297-336`) stores one `tariff_definition_id` whose
`compute_rule` is mutable in place. The id does not reconstruct the price. Not stored: the
per-component ex-VAT price; **the retailer component at all** (resolved at
`resolve-tariff-chain.ts:286`, discarded at `projections.ts:444`); `vat_rate_pct` and the ex-VAT/VAT
split (computed at `compute-session-cost.ts:178-195`, discarded); currency; the rate's effective
window; `meter_start_wh` and `meter_stop_wh` as separate immutable readings — `energy_wh` is a single
scalar overwritten twice (`projections.ts:961`, then `zaptec-session-sync.ts:313`); plug-time
seconds; period/statement linkage; a closed marker; correction linkage.

### B3 — There is no billing period, statement or delivery record

`period-close.ts` and `delivery-log.ts` are pure and have **zero callers**.
`billing.invoices`, `billing.invoice_lines`, `billing.statements` and
`reports.billing_period_summary` were dropped in
`prisma/migrations/20260807120000_drop_never_used_tables`.

Two consequences worth stating precisely:

- `billing.statements.content` JSONB (`20260424090905_v3_foundation/migration.sql:608`) was the only
  column in this repo's history that ever held a *stored document*. `statementAction`'s resend branch
  (`period-close.ts:236-238`) promises to re-deliver the stored statement. That promise needs it back.
- Restoring `reports.billing_period_summary` would **not** have solved close. Its DDL was
  `org_id, year, month, session_count, total_kwh, total_isk_minor, computed_at` — a recomputable
  rollup with no state, no `closed_at`, no immutability. It was a cache, not a ledger.

### B4 — Billing reads are cross-tenant

41 executable `billing.*` gates; **8** pass `orgIdParam`. A gate without it sets `orgId = null`
(`require-permission.ts:70-72`) and `effective-permissions.ts:204` then **skips the membership lookup
entirely**. Those gates are therefore simultaneously unreachable for org members and tenant-wide for
platform grants — one bug with two faces.

Seven repositories take no `orgId` at all: `listCostCenters`, `getProjectedOrgRevenue`,
`listRateReferences`, `getTariffDetail`, `listEnrichmentSessions`, `getSessionDetail`,
`getSessionFullDetail`. `billing-summary.ts:5-6` documents `orgId` scoping that was never built —
which is how it survived review.

The correct two-layer pattern already exists at `bill-objects`: gate passes `orgIdParam` **and** the
repository re-checks (`repositories/bill-objects.ts:127`). `resolveOrgScope`
(`lib/auth/org-scope.ts:38`) is used by 13 handlers and by exactly **one** billing route
(`billing.ts:180`).

### B5 — The commercial model is not computable

`assets.connectors` carries `status` and `status_updated_at` but **no enablement history**. The same
hole exists on the driver side. "Active connector during the billing month" and "active driver with
activity during the month" — the two things the 200 kr and 50 kr charges are defined on
(`subscription.ts:9`) — cannot be reproduced from current-state flags.

This is the blocker that most directly stops invoicing, and it is the one most likely to be
overlooked, because the pricing function itself is finished and green.

### B6 — Plug-time has no input

There is no unplug timestamp and no charging-cease timestamp anywhere in the schema.
`ocpp_stopped_at` and `cdr_stopped_at` are **two feeds' values for the same session-end instant**,
both written alongside canonical `endedAt` — not two clocks. `plug-time.ts:33-39` asks the caller to
choose between them, which is a distinction without a difference. The plug-time fee is uncomputable
until a session records when charging ceased *and* when the cable came out.

### B7 — Published tariffs are unpriceable

`lib/billing/tariff-zod.ts:22` publishes `computeRule` kinds `flat_per_kwh` and `flat_per_session`.
`resolve-tariff-chain.ts:90` accepts only `kind === "flat"` and throws `compute_rule_unsupported` at
`:119-122`. The throw happens inside the projection transaction (`projections.ts:4-8`), so a bad
`computeRule` **rolls back the `session.stopped` row too** — the failure is a lost event, not a null
price.

---

## 2. Census table

`ready` = usable at launch. `needs-work` = exists, gaps named. `not-started` = no code.
`broken` = present and wrong.

| # | Workflow | State | Production caller | Tests | Verdict | Exact blocker |
|---|---|---|---|---|---|---|
| 1 | Organisation onboarding | 3 disconnected entry points; no readiness concept | `index.ts:128/138/148/200/210` | parity only, `skipIf(!hasDb)` | needs-work | `HostApplication.convertedOrgId` is read, written by nothing — `/apply` dead-ends; `createOrg` writes no Membership, so the org is unreachable |
| 2 | Charger onboarding | 4 complete provisioning paths | `index.ts:135/140/142/143/255` | error-mapping only | needs-work | every write path untested: `createCharger`, `importZaptecInstallation`, `applyCredentialSelection`, `createOnboardingChain`, `attachVendorToOcppIdentity` |
| 3 | Connector "active" | `status` + `status_updated_at`, no history | — | none | **broken** | **B5** — 200 kr/connector/month not reproducible |
| 4 | Driver onboarding | complete and live | `register.ts:72`, `email-verification.ts:72` | `registration.test.ts`, `invites.test.ts` | ready | — |
| 5 | Driver groups / grants | grant works; **revocation has no route** | `driver-group-memberships.ts:48` | `driver-access-requests.test.ts` | needs-work | `removeMembership` (`repositories/driver-group-memberships.ts:118`) has zero callers |
| 6 | Driver "active" | no activity-per-period record | — | none | **broken** | **B5** — 50 kr/driver/month not reproducible |
| 7 | Cross-tenant gates | 8 of 41 scoped | all billing routes | none at route level | **broken** | **B4** |
| 8 | Session lifecycle | live via `ocpp.raw.*` | `projections.ts:836/888` | unit | needs-work | `onSessionStopped` (`:424`) registered on an event no producer emits; same cause empties `charging.meter_values` |
| 9 | session_ledger writes | 3 reachable writers, not 4 | `projections.ts:999`, `zaptec-session-sync.ts`, `webhooks/zaptec.ts` | partial | needs-work | **B2** |
| 10 | Audit / provenance | 2 unconstrained TEXT columns | `zaptec-session-sync.ts:296` | `cdr-provenance` (pure) | needs-work | 3 of 4 close blockers uncomputable; `provenance-state.ts` unimported |
| 11 | DSO rates | read-only, unscoped | `billing-dso.ts:36` | none | needs-work | `getDsoCostFactors(db)` takes no `orgId` |
| 12 | Retailer rates | correct versioning, 0 sessions priced | `billing-rate-references.ts:97` | some | needs-work | **B1** — the right mechanism, disconnected |
| 13 | CPO add-on | markup math correct | agreements tick | unit | needs-work | tick has priced 0 rows |
| 14 | Plug-time rules | pure module, no input | — | 27 tests | **broken** | **B6** |
| 15 | Period close | pure module, zero callers | — | 29 tests | not-started | **B3** |
| 16 | Driver statement | none | — | none | not-started | **B3** |
| 17 | Org statement / export | none; no CSV or PDF anywhere | — | none | not-started | **B3** |
| 18 | Delivery log | pure module, zero callers | — | 32 tests | not-started | **B3**, plus the ack defect below |

---

## 3. Defects worth fixing regardless of sequencing

These are small, independent, and each is a real user-visible or money-visible fault.

**The 100× driver-facing unit bug, in two places.** `driver-sessions.ts:93-98` returns
`Number(minor)` unchanged, on a comment asserting *"ISK has no minor unit"*. The writer stores aurar
and `formatIskMinor` divides by 100. `driver-invoices.ts:69` returns the **same undivided value** —
and its own comment at `:21` correctly says *aurar*. Two driver endpoints (`driver.ts:713` and
`driver.ts:739`) emit a field called `costIsk` with contradictory unit contracts. Fixing one leaves
the invoice surface wrong.

**The delivery-log ack defect — in a module I wrote.** `classifyEmailResult`'s
`provider_ack_without_id` branch (`delivery-log.ts:112-119`) **can never fire**. `email.ts:91-99`
converts an ack-without-id into `{ok:false, reason:"send_failed", status: <2xx>}`, which passes the
429 check and the 4xx check and lands on `retriable` at `:136`. An unidentifiable provider
acknowledgement is therefore retried five times — sending the customer duplicate statements, which
is precisely what the comment at `:113-116` says must be prevented.

**Two RateReference rows can both be "current".** `createRateReference` auto-closes only the row
active at `now()` (`billing-rate-references.ts:229-238`), never a sibling staged row. When both
mature, `listRateReferences` labels the **oldest** as current (`:141-143`) while the resolver prices
with the **newest** (`resolve.ts:135-136`). No DB constraint prevents the overlap.

**Expired rate rows are resurrectable.** The repository rejects only `status === "current"`
(`billing-rate-references.ts:312`), so a `PATCH` can reopen an expired supplier rate — contradicting
the route's own documented contract at `billing-rate-references.ts:144-146`.

**Dead permission verbs.** `billing.export` (`permissions.ts:66`) and `tariff.read` / `tariff.write`
(`:68-69`) are bundled into MANAGER/ADMIN/FINANCE and have **zero** `requirePermission` call sites.
The permission model cannot express its own rate-authoring role.

**Dead schema.** Four DSO-family Site anchors — `usrfTariffId`, `usrfPremTariffId`, `xtrrfTariffId`,
`spvivfTariffId` (`assets.prisma:60-63`) — can never affect a price, because
`resolve-tariff-chain.ts:192` selects only `dsoTariffId`. Yet `retireTariff` warns about them as if
they could. Five orphan enums also survive their dropped tables.

**A reconciliation, not a correction.** The CDR window is *both* 26 h and 30 days: the cron passes
`ROLLING_WINDOW_MS` explicitly (`zaptec-sync-cron.ts:35`), while the repository defaults to 30 days
when `from` is omitted (`zaptec-session-sync.ts:78-79`) — which is the manual admin path
(`vendor-credentials.ts:159`), gated only on `platform.tenant.write` with no audit row. Routine
exposure is one day; a hand-fired backfill is a month, or any window on request.

---

## 4. Decisions — locked or escalated

### Locked (source evidence supports the recommendation)

| Decision | Lock | Why |
| --- | --- | --- |
| Rate lock-in | **At session start**, snapshotted onto the ledger row | `pickActiveRate` (`resolve.ts:123-137`) already implements it correctly |
| Money internals | aurar (1/100 ISK) throughout; final **line** rounded to ISK | matches `compute-session-cost.ts:12-16`; half-up via `(n + d/2) / d` |
| Statement total | sum of **rounded lines**, never rounded sum | avoids the total disagreeing with its own lines |
| CDR mismatch | beyond tolerance → `billing_review_required`, never silent restatement | 5 rows already assert CDR provenance while carrying an OCPP figure |
| Reconciliation tolerance | **0.05 kWh** | already live at `zaptec-session-sync.ts:295`; `cdr-provenance.ts:64` uses 0.001 — align on the live value |
| Plug-time anchor | `charging_end`, grace after charging stops, partial minutes **down** | matches `plug-time.ts` defaults |
| Closed periods | no silent mutation; corrections are **additive lines** | `buildCorrectionLine` already refuses zero-value corrections |
| Rate selection policy | `start_rate` | `rate-window.ts:47-50`; `split_by_time` is uncomputable while `charging.meter_values` is empty |
| Export format | CSV + human-readable first | bank/e-invoice adapters need formats nobody has specified |
| Near-boundary review | keep provenance holds; do not auto-accept `cdr_mismatch` | — |

### Escalated — human decision required

1. **VAT on the Core subscription.** `subscription.ts:118` returns `subtotalExVatMinor` with no VAT
   figure, while `session_ledger.cost_isk_minor` and `AgreementBillingLine.amountIncVatMinor` are
   VAT-inclusive. The 200/50/450 frame **cannot share a statement line with session costs** until
   this is decided. This blocks the first real statement and is not an engineering call.
2. **Who is billed for what.** Driver-paid vs organisation-paid vs split is not represented anywhere
   except `CostCenter`, whose reader sums a table (`billing.billing_lines`) that has **no writer**.
3. **Whether Core launches with the agreements resolver or the legacy tariff chain.** Both run
   concurrently and ungated; ADR 0025's per-installation flag does not exist in code
   (`billing-tick.ts:19-25`). Running both is the current state and is not a launch posture.
4. **Retention and correction window.** How long may a closed period be corrected, and by whom.
5. **Whether `/apply` conversion is in Core scope**, or organisations are created by hand at launch.

---

## 5. Merge plan

Strict order. Each slice is reviewable alone and leaves the tree green.

| # | Slice | Contents | Migration | Flag | Rollback |
| --- | --- | --- | --- | --- | --- |
| 1 | **Pure library** | fix the delivery-log ack defect; add settlement-snapshot and period types; keep everything unimported | no | no | revert commit |
| 2 | **CI guards** | `orgIdParam` guard (modelled on `check-pricing-ssot.mjs`); computeRule vocabulary guard tying `tariff-zod` to `resolve-tariff-chain`; unit-contract guard for `costIsk` | no | no | remove from `check-all.mjs` |
| 3 | **Schema, additive only** | `billing_periods`, `statements` + `statement_lines`, `delivery_attempts`, settlement columns on `session_ledger`, `connector_status_history`, `driver_activity` | **yes** | n/a | drop new tables; no existing column altered |
| 4 | **Write surfaces** | rate write APIs with effective dating; settlement snapshot written at pricing time; enablement-history writers | no | `CORE_SETTLEMENT_SNAPSHOT` | flag off |
| 5 | **Authz + audit** | `orgIdParam` on all 41 gates; `orgId` into the seven repositories; audit rows on org/charger/rate writes | no | no | revert per route |
| 6 | **Period close + statements** | wire `period-close` and `delivery-log`; CSV + human-readable export | no | `CORE_PERIOD_CLOSE` | flag off |
| 7 | **UI unlock** | turn read-only screens interactive **only** where a write API and an audit row now exist | no | per-feature | flag off |

**Do not reorder 3 before 2.** The guards are what stop the migration shipping alongside a new
unscoped gate.

**Do not reorder 5 after 6.** Closing a period while billing reads are cross-tenant means the first
statement can be read by the wrong tenant.

---

## 6. What I would do first

1. **B5** — connector and driver enablement history. Nothing can be invoiced without it, and it is a
   pure additive migration plus two writers. Everything else is refinement of a bill that cannot yet
   be produced.
2. **The 100× unit bug**, both call sites. Small, and it is the number a driver sees.
3. **B7** — the computeRule vocabulary guard. Offline, testable, and today a published tariff loses
   the `session.stopped` event.
4. **B4 step one** — invert the two default-widening `?orgId` params, then add `orgId` to
   `getSessionFullDetail`, the one with a proven cross-tenant route.
5. **The delivery-log ack defect**, before anything sends a statement to a customer.

## 7. Companion documents

- `2026-08-10-core-schema-api-package.md` — tables, DTOs, routes, permissions, migration order
- `2026-08-10-core-launch-acceptance-matrix.md` — acceptance matrix
- `2026-08-10-core-backend-work-packages.md` — issue-ready packages
