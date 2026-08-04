# ADR 0025 — resolved to a factual state; decisions parked for the operator

**Written:** 2026-08-04, overnight session.
**Mandate:** park anything needing a decision, keep moving on cleanup and
labelling. Nothing in this note has been acted on. No table, column, model or
file has been deleted.

---

## Why this was the blocking item

Two of the largest deletions on the cleanup list hang off ADR 0025, and a
wrong deletion in the billing layer is not recoverable the way a rename is.
So the first job was not to delete anything — it was to find out whether
ADR 0025 still describes the system. **It does not.**

Everything below is measured, not inferred. Read-only SQL against the live
database. The CO-3 shadow harness was **not** run (Rule 5 — operator runs it).

---

## The four findings that change the plan

### 1. The ADR protects the wrong table

ADR 0025 §Step 6 says `billing.billing_lines` must **not** be dropped — "the
source of truth for already-closed sessions."

It has **0 rows**, and **zero writers in the entire codebase**. The only
billing-line write anywhere is `agreementBillingLine.createMany`
([persist.ts:401](../../apps/api/src/lib/agreement/persist.ts#L401)). It is
dead, not merely empty.

The record that genuinely is irreplaceable — **`reports.session_ledger`,
1555 rows, all priced** — is not mentioned anywhere in ADR 0025 and therefore
carries no stated protection. The carve-out is exactly inverted.

### 2. The cutover was never implemented; something else runs instead

`useAgreementsResolver` and `resolver_kind` occur **only inside ADR 0025** —
zero hits in code. No flag, no per-installation rollout, no `resolver-flags.ts`.

What runs instead, undocumented: **both resolvers, concurrently, ungated.**
Legacy prices every session at stop into `reports.session_ledger`; the
agreements resolver runs as a per-minute cron
([index.ts:435](../../apps/api/src/index.ts#L435)). That is shadow mode
*without* the comparison that §Step 2 made a hard go-gate.

### 3. The agreements path has never emitted a row

`agreements.billing_lines` = **0 rows** after ~2 months of firing every minute.
The tick's eligibility predicate matches **0 sessions** — it requires
`userId != null` and there is **1** driver-group membership in the system.

It is a silent no-op. Green logs mean "scanned 0", not "works". This path has
never been exercised against real data.

### 4. Two traps that would bite whoever ran the deletions

- **Wrong schema names.** §Step 6 says `assets.sites` and
  `assets.installations`. They are **`properties.sites`** and
  **`properties.installations`**. Only `assets.charging_stations` is right.
- **Wrong Neon branch.** The *default* branch is `production`
  (`br-fragrant-bonus-abrc01g6`, 37 MB) and is **abandoned** — older PascalCase
  `public` schema, **no `agreements` schema at all**. The live DB is `staging`
  (`br-tiny-river-abgpqq37`, 518 MB). Any script or MCP query without an
  explicit branch reads a system that no longer exists. My own first two
  queries hit it.

**A fourth generation exists that ADR 0025 never mentions:** `billing.tariffs`,
`invoices`, `invoice_lines`, `billing_transactions`, `statements`,
`subscriptions`, `customer_plans`, `bill_objects`, `bill_object_members` — all
**0 rows**. Scoping a retirement from §Step 6 alone leaves all of these behind.

---

## Measured state (staging, 2026-08-04)

| Object | Rows | |
|---|---|---|
| `reports.session_ledger` | **1555** (all priced; 451 in trailing 30d) | the real record of truth |
| `billing.billing_lines` | 0 | dead — no writers |
| `agreements.billing_lines` | 0 | never emitted |
| `billing.tariff_definitions` | 4 | live — legacy resolver reads these |
| `billing.cost_factors` | 8 | legacy catalogue |
| `agreements.cost_factors` | 17 | new catalogue |
| `agreements.agreements` / `clauses` / `rate_references` | 4 / 4 / 2 | partial A.10 seeding, unrecorded |
| `agreements.driver_groups` / `memberships` | 1 / 1 | why the tick matches nothing |
| `agreements.bearer_rules` | 0 | |
| `billing.contracts` | 1 | children all 0 — never populated, as ADR said |
| `billing.{tariffs,invoices,invoice_lines,billing_transactions,statements,subscriptions,customer_plans,bill_objects,bill_object_members}` | 0 | generation ADR 0025 omits |

---

## Decisions parked for you — each is a yes/no

**D1. Does ADR 0025 get superseded rather than amended?**
Its premises are wrong in enough places that patching it reads as history
rewriting. Recommend: mark it `Superseded`, write a successor from the measured
state above — **next free number is 0047** (0046 was taken tonight by the BLE
renumbering below). *Blocks: everything else here.*

**D2. Is `billing.billing_lines` droppable?**
Evidence says yes — 0 rows, 0 writers. But ADR 0025 explicitly says never, so I
will not act on a contradiction without you. *Recommend: drop, with
`reports.session_ledger` named as the protected record in its place.*

**D3. Does the fourth generation (`tariffs`/`invoices`/`statements`/…) go in the
same sweep?** All 0 rows. They are either abandoned or a scaffold someone still
intends to use for invoicing (ADR 0005 tag E owns invoice rollup). I can't tell
intent from the data. *Needs your answer — this is the one I'd get wrong.*

**D4. What happens to the agreements billing tick meanwhile?**
It has run for two months doing nothing. Options: leave it (harmless, but it
accrues false confidence), disable it until there are drivers, or make it log
loudly when it scans 0 so the silence stops reading as success.
*Recommend the third.*

**D5. Should the resolver arrangement be written down as-is?**
Regardless of the cutover decision, "both resolvers run, nothing compares them"
should be a documented state rather than an accident. *Recommend: yes, in D1's
new ADR.*

---

## Done tonight (safe, reversible, no behaviour change)

- ADR 0025: status flagged as *premises superseded*; added
  [§Verification (2026-08-04)](../adr/0025-billing-cutover-from-legacy-to-agreements.md)
  correcting every wrong claim, with the branch trap called out at the top.
- [`billing-tick.ts`](../../apps/api/src/lib/agreement/billing-tick.ts) — header
  now states it is a measured no-op and that green logs are not validation.
- [`driver-pricing.ts`](../../apps/api/src/repositories/driver-pricing.ts) —
  corrected a comment claiming `agreement/resolve.ts` is "the canonical billing
  path"; it has priced 0 sessions.
- **ADR 0044 collision resolved** (handoff §7). `git mv` of the BLE ADR to
  [`0046-local-charger-control-over-ble.md`](../adr/0046-local-charger-control-over-ble.md),
  with a renumber banner in its header and both code references updated
  ([`driver-charger-pin.ts`](../../apps/api/src/routes/public/driver-charger-pin.ts),
  [`index.ts:235`](../../apps/api/src/index.ts#L235)).
  *Driver-side capabilities keeps 0044* — three sites cite its D-numbers
  (`sidebar.tsx` D4, handoff §7 D6, driivz note D3), so leaving it put kept
  those citations valid. Tracked by git as a rename, so it reverts as one.

All of the above are comments, docs, and one rename. No code path changed.

## Deliberately not touched

- **`prisma/schema.prisma` and `apps/api/prisma/schema.prisma`.** Labelling the
  dead `BillingLine` model belongs there, but both files are the **uncommitted
  +206/−8 blocking item** from handoff §1 (the `ProtocolLogEntry` work, deadline
  2026-08-09). Adding unrelated comments would entangle a commit that needs to
  land clean. Queued behind that commit.
- Every deletion. All of D2/D3 remain untouched.
