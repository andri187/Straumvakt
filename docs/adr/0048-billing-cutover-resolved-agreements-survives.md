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
| **AGREEMENTS** ✅ | `agreements` 4 · `cost_factors` 17 · clauses and rate references seeded — and `agreements.billing_lines` **0 rows after ~2 months firing every minute** (no longer true on test — see below) |
| legacy contracts | `billing.contracts` 1 row, every child table 0 |
| fourth scaffold | `tariffs`, `invoices`, `invoice_lines`, `billing_transactions`, `statements`, `subscriptions`, `customer_plans`, `bill_objects`, `bill_object_members` — all **0** |

The choice is deliberate and uncomfortable: **the generation that works is being
retired in favour of the one that has never emitted a row.** That is correct
anyway — agreements models what the business actually is (parties, clauses,
per-factor markup, ADR 0031's agent posture), and legacy hard-codes an
org-only counterparty that the 2026-08-04 "any party can be Straumvakt's
customer" decision already invalidates.

> **Update 2026-08-07 — it has now emitted rows.** 128 lines over 64 sessions
> on the test branch, 19,264.97 ISK, priced to Veitur (DSO) and N1 Rafmagn
> (retailer). Three stacked bugs were in the way — attribution, a case
> mismatch that made the resolver reject every clause in the database, and two
> mis-pointed suppliers. See
> [the write-up](../notes/2026-08-07-first-priced-session.md). Test branch
> only; staging unchanged.

## What this does not license

**Nothing is deleted yet.** `reports.session_ledger` holds the only priced
record of 1,621 sessions and stays until the agreements path has produced
equivalent rows for the same sessions and they have been compared.

The comparison is **CO-3**, `apps/api/scripts/shadow-compare-resolvers.ts` —
which was broken on every clean checkout until 2026-08-07 (it imported a
Prisma client that no generator produced). Fixed; not yet run.

## Order

1. ~~Find out why the agreements tick prices nothing.~~ **DONE 2026-08-07 —
   it is the recency window, not the predicate.**

   ```
   completed sessions                  1,619
   ...with a user_id                       8   <- Zaptec enrichment
   ...with energy and an end time          8
   ...ended within RECENT_WINDOW_DAYS      0   <- newest is 2026-05-13, 86 days ago
   ```

   Everything else was verified against staging and is intact: that one user
   is in a driver group, the group's agreement is `active`, its
   `installation_id` matches the sessions', and both clauses carry active
   cost factors with rate references effective 2026-05-04 — before the
   sessions ended.

   The eight sessions this generation could have priced aged out of its
   30-day window before anyone attributed them. ADR 0025's note blamed the
   `userId != null` predicate and reported 0 candidates; it matches eight.

   Two consequences worth separating:

   - **The window cannot drain a backlog.** The query is ordered oldest-first
     "so backlog drains predictably", but a fixed 30-day cutoff means
     anything older never drains. `runAgreementsBillingTick` now takes
     `sinceDays` so a backfill is possible; the default is unchanged, so the
     cron behaves exactly as before.
   - **The real blocker is attribution, not billing.** 8 of 1,619 completed
     sessions carry a user — 0.5%. No pricing generation can bill what it
     cannot attribute, so this is upstream of the whole cutover and is the
     same gap SCOPE calls out as `createDriver` being unwired.
   **Superseded 2026-08-07.** The window was the *first* blocker, not the
   only one. Two more sat behind it, and each was invisible until the one
   ahead of it was removed:

   - **Every clause failed validation.** `allocation_json` says
     `"bearer_type": "USR"`; the enum and `BEARER_CODES` are lowercase. ADR
     0019 documents the JSON uppercase and the seeder followed it. JSONB is
     unconstrained, so nothing caught the disagreement — the resolver
     rejected every clause it was ever handed.
   - **Both suppliers were wrong.** `VEITUR-AD1` had a NULL
     `supplier_org_id` on the premise that Veitur was not a seeded org (it
     is), and the retailer rate pointed at N1 ehf, the site host, rather
     than N1 Rafmagn, the retailer.

   With all three cleared, the tick emits. Full account:
   [2026-08-07-first-priced-session.md](../notes/2026-08-07-first-priced-session.md).
2. **Run CO-3** over the 1,621 ledger rows. Operator runs it — Rule 5.

   It was unrunnable until 2026-08-07 for a second reason beyond the import
   fix: no script in `apps/api/scripts/` could load the generated Prisma
   client under Node 24. `npm run script -- shadow-compare-resolvers.ts`
   now works.
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
