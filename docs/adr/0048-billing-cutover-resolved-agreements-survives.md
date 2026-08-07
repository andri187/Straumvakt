# ADR 0048 — Agreements survives; legacy pricing retires

**Status:** Accepted · 2026-08-07 · **operator decision**
**Supersedes** [ADR 0025](./0025-billing-cutover-from-legacy-to-agreements.md),
whose premises were measured wrong on 2026-08-04.
**Answers** D1 in
[the parked-decisions note](../notes/2026-08-04-adr-0025-resolution-and-parked-decisions.md).

---

## Decision

**Option B. The agreements generation survives. Legacy pricing retires.**

## What was chosen between

Measured on staging, 2026-08-07:

| generation | state |
|---|---|
| **LEGACY** | `reports.session_ledger` **1,621 priced rows** · `billing.tariff_definitions` 4 · `billing.cost_factors` 8 — **the only one that has ever priced a session** |
| **AGREEMENTS** ✅ | `agreements` 4 · `cost_factors` 17 · clauses and rate references seeded — and `agreements.billing_lines` **0 rows after ~2 months firing every minute** |
| legacy contracts | `billing.contracts` 1 row, every child table 0 |
| fourth scaffold | `tariffs`, `invoices`, `invoice_lines`, `billing_transactions`, `statements`, `subscriptions`, `customer_plans`, `bill_objects`, `bill_object_members` — all **0** |

The choice is deliberate and uncomfortable: **the generation that works is being
retired in favour of the one that has never emitted a row.** That is correct
anyway — agreements models what the business actually is (parties, clauses,
per-factor markup, ADR 0031's agent posture), and legacy hard-codes an
org-only counterparty that the 2026-08-04 "any party can be Straumvakt's
customer" decision already invalidates.

## What this does not license

**Nothing is deleted yet.** `reports.session_ledger` holds the only priced
record of 1,621 sessions and stays until the agreements path has produced
equivalent rows for the same sessions and they have been compared.

The comparison is **CO-3**, `apps/api/scripts/shadow-compare-resolvers.ts` —
which was broken on every clean checkout until 2026-08-07 (it imported a
Prisma client that no generator produced). Fixed; not yet run.

## Order

1. **Find out why the agreements tick prices nothing.** Its eligibility
   predicate requires `userId != null` and there is **one** driver-group
   membership in the system. Green logs mean "scanned 0", not "works".
2. **Run CO-3** over the 1,621 ledger rows. Operator runs it — Rule 5.
3. **Only then** retire legacy: `tariff_definitions`, `billing.cost_factors`,
   the legacy resolver.
4. **Separately decide the fourth scaffold** (D3). All 0 rows, and no evidence
   anyone intends to use it. Not covered by this ADR.

## Consequences

- **Unblocks ADR 0047.** `agreements.installation_id` can now be repointed,
  because the generation that owns it is settled.
- **Unblocks the commercial half of the Drizzle port** — 8,695 lines that were
  frozen pending exactly this.
- `billing.billing_lines` — 0 rows, 0 writers — is confirmed droppable (D2),
  with `reports.session_ledger` named as the protected record in its place.
