# Core billing ledger — acceptance update

What the implementation slice moved, against
`2026-08-10-core-launch-acceptance-matrix.md`.

## Test totals

| | Before | After |
| --- | ---: | ---: |
| core-billing test files | 8 | 11 |
| core-billing assertions | 241 | **330** |
| New this slice | — | **89** |

`tsc --noEmit -p packages/commercial` exit 0. No dependency installed.

New files: `money.ts`, `settlement.ts`, `statement.ts` and their tests.
Modified: `delivery-log.ts` (defect fix + 3 regression tests), `index.ts`
(barrel exports).

## Acceptance criteria newly satisfied

**Billing math.** ISK line rounding now exists and is half-up, symmetric about
zero so a credit and the line it corrects agree. The statement total is the sum
of **rounded lines** — with `roundingDriftIsk` exposed so a fixture where both
methods happen to agree cannot pass by coincidence. On the canonical
649.88 + 216.63 + 21.66 kr statement the correct answer is 889 kr and the
forbidden one is 888 kr, and both are asserted.

**Rate effective dates (B1 logic).** A component whose window does not contain
`startedAt` is not used, `effectiveUntil` is exclusive, a session with no rate
in force at its start goes to review rather than being priced with today's
rate, and a snapshot's total is unchanged when the rate book is edited
afterwards. That last test is the direct proof of B1.

**DSO/retailer/CPO layering.** All three components are carried on the snapshot
with their rate version ids and windows — including the retailer component the
live path computes and discards.

**Meter semantics.** Unresolvable, backwards and implausible readings all
produce review, never a silent zero, and a held session bills nothing.

**CDR mismatch.** Agreement within 0.05 kWh settles; beyond it holds. The
default now matches the live tolerance rather than the 0.001 in
`cdr-provenance.ts`.

**Statement invariants.** Total equals the sum of printed lines; a session held
for review is excluded **and named**; splitting a session into energy and
plug-time lines neither creates nor destroys VAT.

**Delivery log idempotency.** The duplicate-statement defect is fixed and
regression-tested: an acknowledgement the provider could not identify is now
terminal for every 2xx, not retried five times.

**Cross-tenant.** Snapshots from another org are dropped from a driver
statement, not billed — and not even listed as excluded, since naming another
tenant's session id on a customer document is itself a leak.

**No mutation of a closed period.** Corrections are additive; the corrected
statement re-totals while the original document is untouched; generation is
refused for a period that is not closed and replays idempotently for one that
is.

## Still blocked by schema/API

| Criterion | Blocked on |
| --- | --- |
| Subscription lines persisted per period | `billing_periods` (M4) |
| Snapshot survives a restart | `session_settlements` (M3) |
| Statement retrievable and resendable | `statements.content` (M5) |
| Delivery attempts counted across restarts | `delivery_attempts` (M6) |
| Duplicate close/generate rejected across processes | `idempotency_keys` (M7) |
| **Active connector / driver counts** | `connector_status_history`, `driver_activity_month` (M1, M2) |
| Plug-time fee computed at all | no unplug or charging-cease timestamp exists (**B6**) |
| Cross-tenant enforced at the route | 33 unscoped gates, 7 unscoped repositories (**B4**) |
| Published tariff cannot break pricing | CI vocabulary guard (**B7**) |

The pure layer decides all of these correctly. None of them survives a process
restart.

## Still human-decision-gated

1. **VAT on the Core subscription.** `computeCoreSubscription` returns ex-VAT
   while session amounts are VAT-inclusive. `buildOrgStatement` therefore mixes
   an ex-VAT subscription line with VAT-inclusive session material. **This is
   the one place the current code is knowingly incomplete**, and it is stated
   here rather than papered over with an assumed rate.
2. Who is billed for what — driver-paid vs org-paid vs split.
3. Which resolver Core launches on.
4. Retention and correction window for closed periods.
5. Whether `/apply` conversion is in Core scope.

## Fool tests

Each sabotage was applied, the suite run, and the file restored:

| Sabotage | Caught |
| --- | --- |
| Round the sum instead of summing rounded lines | 1 failure |
| Ignore the rate window (price with today's rate) | 2 failures |
| Stop holding a CDR mismatch | 2 failures |
| Let another org bleed onto a driver statement | 3 failures |
| Re-introduce the duplicate-statement retry | 3 failures |

## Corrections to my own prior work

Three, found by writing the code against the real modules rather than my notes:

1. `resolveMeterEnergy` takes `{ reading: {...}, durationSeconds }` — nested,
   not flat — and **detects** the register mode rather than being told it. My
   first draft passed a `declaredMode` that does not exist.
2. `CoreSubscriptionBreakdown` exposes `lineItems`, not `lines`, and its line
   kinds are `connector_subscription` / `driver_subscription` /
   `connector_cap_relief` with `displayName` / `qty` / `qtyUnit`.
3. An org with **0 connectors and 30 drivers** emits two lines that cancel to
   zero, not zero lines. I had asserted the latter. The module's behaviour is
   better than my assumption — a customer can see *why* they owe nothing — so
   the test was corrected, not the code.
