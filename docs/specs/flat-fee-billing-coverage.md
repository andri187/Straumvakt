# Flat-fee scenarios → tests

The map for `docs/specs/flat-fee-billing.feature`. **A scenario with no test is
a finding, not a decoration**, so every row below is either a test that exists
today or a gap named as one.

34 scenarios. **24 covered, 10 gaps** — and the gaps are the point of writing
this down.

## Covered

| scenario | test |
|---|---|
| session at 23:59 on the last day | `activity-month.test.ts` — period bounds |
| session at 00:00 on the first day | `activity-month.test.ts` — period bounds |
| org with no connectors HOLDS | `activity-source.test.ts` — *"zero rows is unavailable, never measured zero"* |
| activity not sealed HOLDS regardless of count | `activity-source.test.ts` — *"a period whose activity is not sealed…"* |
| org onboarded on the 15th | `placement-evidence.test.ts` — *"bills a device placed on the 2nd…"* |
| org offboarded on the 20th | same |
| device MOVED mid-period, one row per host | `placement-evidence.test.ts` — *"…produces ONE ROW PER HOST"* |
| default policy bills a whole month per host | `placement-evidence.test.ts` — *"whole_month_per_host — the DEFAULT"* |
| prorated shares sum to one connector-month | `dry-run-first-invoice.test.mts` — *"prorated shares SUM to exactly…"* |
| device that moves twice | `placement-evidence.test.ts` — *"…three hosts three rows"* |
| placed and removed inside one day | `placement-evidence.test.ts` — *"…CLOSES INSIDE ONE DAY"* |
| cap does not bind at 5 drivers/connector | `flat-fee.test.ts` |
| cap binds above that | `flat-fee.test.ts` |
| deactivated charger not billed | `sink-port.test.ts` — *"a deactivated charger is NOT billable"* |
| charger reactivated before period end | `sink-port.test.ts` — *"read at period END"* |
| charger never polled HOLDS | `sink-port.test.ts` — *"NO observation is `unavailable`"* |
| observation only after the period | `sink-port.test.ts` — *"…only AFTER the period"* |
| placement with no connectors HOLDS | `placement-evidence.test.ts` — *"holds the period rather than…"* |
| period that HOLDS produces no number | `number-store.test.ts` — *"a failed transaction consumes NOTHING"* |
| re-run reuses the same number | `number-store.test.ts` — *"a retry with the SAME key…"* |
| different key for the same statement refused | `number-store.test.ts` — *"…is REFUSED"* |
| voided number is not a gap | `number-store.test.ts` — *"a VOID is not a gap"* |
| two orgs each get 000001 | `number-store.test.ts` — *"two orgs issuing in the same instant"* |

## Gaps — 11, each a real one

| # | scenario | why it is not covered |
|---|---|---|
| 2 | **org with connectors but no drivers** | A **measured** zero driver count producing no line is untested. The engine's behaviour for `measured(0)` versus `unavailable` is the distinction the whole flat fee rests on, and only the `unavailable` half is pinned. |
| 3 | **cap applies to the prorated total** | **Not implemented.** The cap is expressed in whole connector-months and would have to move if proration is chosen. This is the consequence that gets missed when the switch is flipped. |
| 4 | **five portal chargers with no row here** | Not testable by construction, and that is the finding: a row that does not exist cannot be filtered in. It needs a **reconciliation against the vendor**, which is a different piece of work from anything in the billing tree. |
| 5 | **connector seen only by a StatusNotification** | The tier exists and `deriveConnectorActivity` is tested, but not through the whole path from `events.event_log` to an invoice line. The dry run's 26 `status_available` rows are fixture-supplied. |
| 6 | **asserted connector on a vendor-native installation** | Same shape: `connector_assertions` is written and read, and the end-to-end "an assertion is why this host was billed" is fixture-supplied rather than derived. |
| 7 | **assertion counted once when made twice** | The unique index is the mechanism and it is **in migration 0003, unapplied**. The `onConflictDoNothing` path has never executed. |
| 8 | **assertion for another org's connector refused** | Covered in `periods.test.ts` at the route, **not** at the repository. The repository check exists in `drizzle-operations-port.ts`, which has never run. |
| 9 | **a disputed line answered from the sealed session** | `session-seal.test.ts` proves the *shape* survives, on a model of the row. Nothing yet reads `tariff_snapshot_json` back out of a database, because migration 0008 is unapplied. |
| 10 | **a correction is a credit note with its own number** | `number-store.test.ts` proves a credit note takes its own ordinal. What is missing is the **document**: there is no credit-note renderer, and `issueDocument` still refuses the render half by name. |
| 11 | **a host with no kennitala cannot be invoiced** | Covered in the dry run (`refuses-host-without-kennitala`) but **not** in the billing repository, which never sees the recipient. The refusal lives in B's document model. |

## What the gaps have in common

**Eight of the ten are the same gap wearing different clothes: no database
has any of these migrations applied.** Gaps 5–9 are all "the fixture proves the
decision, the SQL has never run", which is this lane's deliberate shape and not
an oversight — but it means the acceptance language above is, for those rows,
a promise rather than a fact.

The two that are not, plus the one this map closed:

- **Gap 3** is unbuilt work with a decision attached (Andri's).
- **Gap 4** is not a software gap at all. It needs a reconciliation against the
  vendor, and no amount of testing reaches it.
- **Gap 1 was closed while writing this map**, which is the argument for writing
  it. Three tests in `activity-month.test.ts` now assert that the session and
  driver windows read `started_at` and contain no `stopped_at` term, and that
  the placement window uses `&&` — a *different* rule, on purpose. Fool test:
  the window keyed on `stopped_at` → 1 failed.

## Why this is not executable

There is no Cucumber runner here and adding one would be a build change nobody
asked for. These scenarios are the **acceptance language** — the sentences an
operator, an accountant and a host would each recognise — written down before a
UI exists to argue about them in. If a runner is ever added, this file is the
input; until then the coverage map is what keeps it honest.
