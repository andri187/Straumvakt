# Claude A completion: Core billing ledger implementation

## TL;DR

Core billing now has durable *records* in pure form: a settlement snapshot that
locks the rate to session start, statements whose totals equal their printed
lines, and a money contract nothing in the tree implemented. 89 new assertions,
330 in core-billing, 1051 in the suite. It persists nothing — every blocker that
remains is a table, not a calculation. B5 (no enablement history) is still what
stops invoicing.

## Run

- Agent: `claude-a` · lane `core-billing-ledger-implementation`
- Start UTC: **2026-08-11T03:16:23Z**
- End UTC: **2026-08-11T03:28:07Z**
- Wall-clock: **~12 minutes**
- Target: 4 h — **not met**. The lane already held the eight pure modules and
  the readiness package, so this was a compose-and-verify slice rather than a
  cold start. No phase was skipped: all six ran, the 60-assertion minimum was
  exceeded by 29, and the "if you finish early" list was worked through
  (edge cases, cross-tenant and idempotency tests, follow-up detail, and a
  self-correction section).
- Start tip: `55cdfe8` · End tip: `47a99f6d9e2d67679bcf7f63e69acae701448600`
- Dirty state: clean at start, **clean at end**
- Branch `scratch/claude-a-core-billing-2026-08-10`, no upstream, never pushed

## Files changed

New — `packages/commercial/src/core-billing/`:
`money.ts`, `money.test.ts`, `settlement.ts`, `settlement.test.ts`,
`statement.ts`, `statement.test.ts`

Modified: `core-billing/delivery-log.ts` (defect fix), `delivery-log.test.ts`
(3 regression tests), `packages/commercial/src/index.ts` (barrel exports)

New docs: `docs/notes/2026-08-11-core-billing-ledger-schema-api-followup.md`,
`docs/notes/2026-08-11-core-billing-ledger-acceptance-update.md`

One commit: `47a99f6 feat(commercial): settlement snapshot, statements and the money contract`

## Checks run

- `npx vitest run packages/commercial/src/core-billing/` — **330 passed**
  (241 before; **89 new**)
- `npx vitest run` — **64 files, 1051 passed, 1 skipped**
- `npx tsc --noEmit -p packages/commercial` — exit 0
- Encoding sweep of all 11 touched files — no BOM, no mojibake
- No dependency installed

**Fool tests** — each sabotage applied, suite run, file restored: rounding the
sum instead of summing rounded lines (1 failure), ignoring the rate window
(2), dropping the CDR hold (2), cross-org bleed onto a driver statement (3),
re-introducing the duplicate-statement retry (3).

## What is now implemented

**`money.ts`** — the locked contract. Aurar internally; a **line** rounds to
whole ISK half-up, symmetric about zero; a **total** is the sum of rounded
lines. On 649.88 + 216.63 + 21.66 kr the correct total is 889 and the forbidden
one is 888, and both are asserted. `roundingDriftIsk` exists so a fixture where
the two methods coincide cannot pass by accident.

**`settlement.ts`** — B1 in code. Locks the rate to session start, treats
`effectiveUntil` as exclusive, and sends a session with no rate in force at its
start to review rather than pricing it with today's rate. Keeps the retailer
component the live path discards and the VAT split it also discards. A test
proves a snapshot is unchanged when the rate book is edited afterwards. Nothing
impossible is priced: bad meters, CDR disagreement beyond 0.05 kWh, missing
times and operator holds all yield `billing_review_required` with **every**
reason, not just the first.

**`statement.ts`** — driver lines, organisation material with the 450 kr cap as
a **visible** line, deterministic identity so a retried generate is a replay
rather than a second document, and invariant checks. Held sessions are excluded
and named. Another org's snapshot is dropped, not billed, and not even listed
as excluded — naming another tenant's session id on a customer document is
itself a leak.

**`delivery-log.ts` fix.** The `provider_ack_without_id` branch could never
fire: `email.ts:91-99` reports an unidentifiable acknowledgement as a **2xx**
`send_failed`, which fell past the 429 and 4xx checks onto `retriable` — so a
send the provider *accepted* was retried five times, mailing one customer five
statements. Every 2xx is now terminal.

## What remains schema/API-only

The whole slice **persists nothing**. Needed: `session_settlements` (+ its
components child), `billing_periods`, `statements` with `content` JSONB,
`statement_lines`, `delivery_attempts`, `idempotency_keys`,
`connector_status_history`, `driver_activity_month`. Migration order and the
exact routes, repository signatures, permissions and audit events are in
`2026-08-11-core-billing-ledger-schema-api-followup.md`.

## Launch blockers

| | After this slice |
| --- | --- |
| **B1** rate lock-in | logic done, unpersisted |
| **B2** settlement snapshot | shape done, unpersisted |
| **B3** period/statement/delivery | logic done, unpersisted |
| **B4** cross-tenant reads | **untouched** — 33 unscoped gates, 7 unscoped repositories |
| **B5** active connector/driver | **untouched, and still the blocker that stops invoicing** |
| **B6** plug-time input | **untouched** — no unplug or charging-cease timestamp exists |
| **B7** computeRule vocabulary | **untouched** — CI-guard job |

Everything here computes correctly against inputs no table can yet supply.

## Corrections to my own prior work

Three, found by writing code against the real modules rather than my notes:
`resolveMeterEnergy` takes a nested `{ reading }` and **detects** the register
mode rather than being told it; `CoreSubscriptionBreakdown` exposes `lineItems`
with `connector_subscription`/`driver_subscription`/`connector_cap_relief`
kinds; and an org with 0 connectors emits two cancelling lines rather than none
— better than my assumption, since the customer can see why they owe nothing,
so the **test** was corrected, not the code.

## External-state confirmation

No push, no PR, no deploy, no migration written or run, no SQL, no database
connection, no Cloudflare/Neon/DNS/GitHub-remote mutation, no OCPP/charger/
BLE/NFC action, no secret opened, no dependency installed, no new top-level
`E:\Claude` folder, no build output or cache produced. Canonical
`E:\Claude\Straumvakt` was read only; this file and its JSON sidecar are the
only writes there.

## Cleanup candidates

- `docs/notes/2026-08-10-core-backend-billing-security-census.md` carries a
  UTF-8 BOM (mine, from an earlier run in this lane).
- `packages/commercial/package.json` has no `./core-billing/*` subpath in its
  exports map; the new modules reach production only through the root barrel,
  as `projections.ts:31` already does for `sessionEnergyWh`.
- `cdr-provenance.ts:64` still defaults to a 0.001 kWh tolerance while the live
  path and the new settlement module use 0.05. Aligning it is a one-line change
  but changes behaviour, so it was left for a deliberate decision.

## Next recommended action

**Answer the VAT question.** `buildOrgStatement` currently mixes an ex-VAT
subscription line with VAT-inclusive session material — the one place this code
is knowingly incomplete, stated rather than papered over with an assumed rate.

Then ship **M1/M2**, the enablement-history migrations. They are purely
additive, and until they exist `countActiveConnectors` and
`countActiveDrivers` have nothing to read, so no month can be invoiced however
correct the pricing is. Note the constraint: history cannot be reconstructed
backwards, so the first invoiceable month is the first **whole** month after
M1 ships — a date to set deliberately, not to discover.
