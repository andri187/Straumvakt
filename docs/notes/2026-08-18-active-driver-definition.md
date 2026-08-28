# What makes a driver "active" — a decision packet

**2026-08-18 · Claude A (chunk A2b) · for Andri**

**This document asks you for one decision.** Everything needed to make it is
here; you should not have to open the codebase. It should take about five
minutes.

> **The short version.** The locked model bills `50 kr / active driver / month`
> and defines active as *"charging **or reporting** activity"*. **Reporting
> activity has no persisted event of any kind** — no table, no column, no log
> line. So the defined quantity cannot be computed, and the code refuses to
> guess rather than under-billing invisibly.
>
> **At customer 1's scale the gap is about 50 kr/month, under 1% of the bill.
> In the MDU shape the product is built for it is structurally up to ~15%.**
>
> The cheapest fix is to **narrow the definition to charging activity** — one
> line, named in §5. **It is not a one-way door**, but widening later cannot
> retroactively re-bill closed periods, and §6 says exactly what that costs.

---

## 1. The locked definition, quoted, and where it comes from

The Core commercial model, locked and repeated verbatim in every dispatch since
2026-08-10:

> `200 kr / active connector / month`
> `+ 50 kr / active driver / month`
> capped at `450 kr / connector / month`

And in source, `packages/commercial/src/core-billing/subscription.ts:9-10`,
written when the pricing module was built:

> ```
> //   Active connector = connector enabled on Straumvakt during the billing month.
> //   Active driver    = driver with charging or reporting activity in the month.
> ```

**Provenance.** The frame descends from ADR 0031 Q2.1 (Straumvakt's revenue is
the Straumvakt → host service fee) and its 2026-06-14 amendment. The two-word
phrase *"or reporting"* is the entire subject of this document: it is the only
part of the locked model that no query in the codebase can satisfy.

The 2026-08-10 census recorded the same thing independently, as
`GAP-ACCESS-INVITE-05`:

> *"Active-driver count per org per month for the 50 kr per driver line —
> `listOrgDrivers` counts group MEMBERSHIP, not charging or reporting activity
> … Billing needs an activity window; membership rows carry no start, end or
> status to intersect a billing month with."*

---

## 2. What "reporting activity" would have to mean, and three ways to persist it

### What it would have to mean

To be countable it needs to be an **event with a driver, an org and a
timestamp**, durable for at least the retention of a billing dispute. Today the
candidate behaviours — opening the driver app, viewing charge history,
downloading an invoice, checking a charger's status — all happen, and **none of
them leaves a row anywhere**. They are authenticated HTTP requests that return
data and are forgotten.

Note the org dimension is not incidental. A driver may charge at several hosts,
and the derivation already keys on `(orgId, driverUserId)` for exactly that
reason — one person is a separate billable driver for each org. A reporting
event that records only "user X did something" is **not sufficient**; it has to
say which org's material they looked at, or it cannot be billed to anyone.

### The three cheapest ways to persist it

| # | approach | what it costs to build | what it changes about ingest |
|---|---|---|---|
| **A** | **Write to the existing `events.event_log`** — a new `event_type` such as `driver.reporting_access`, `aggregate_type: "user"`, emitted by the driver-facing read routes | **Smallest.** The table, its partitioning, its retention class and its indexes all exist. One helper plus ~6 call sites in `routes/public/driver.ts`. The activity derivation already reads this table for connector status, so the aggregation query is a near-copy. | **Nothing on the OCPP ingest path.** It adds one insert to driver *read* endpoints, which are low-volume and not latency-critical. |
| **B** | **A dedicated `reports.driver_reporting_access` table**, one row per (driver, org, day), upserted | Medium. New table, new migration, new writer. Buys a clean grain and a small table, at the cost of a second thing to keep in step with `driver_activity_month`. | None on ingest; same insert-on-read shape as A. |
| **C** | **Derive it from an access log** — Cloudflare Workers request logs or an analytics dataset | Superficially free, actually the most expensive. It is outside Postgres, so it cannot be joined to a billing period transactionally, has its own retention, and would make an invoice line depend on an observability product. **An invoice figure whose evidence expires is not defensible in a dispute.** | None, but it puts a money input outside the database. |

**Recommendation: A.** It reuses the table the connector half already reads, it
adds nothing to the hot path, and its evidence lives in the same database as
the invoice that cites it. Rough size: one afternoon, plus a migration only if
you want a dedicated `retention_class`.

**A caveat worth stating.** Whichever you build, it starts counting *from the
day it ships*. It cannot reconstruct reporting activity for any past month.
That interacts with §6.

---

## 3. The size of the gap

**This is measured from recorded evidence, not from a live query.** Querying
any environment is forbidden to this agent, so every figure below is cited to
the note that recorded it and is stated as of that date.

### What the roster says (2026-05-31 integrity audit, staging)

```
driver_groups                                    2 groups
driver_group_memberships                         2 memberships
identity.id_tokens                               2 active tokens
Active driver Users without IdToken              1  <- kronan@kronan.is
```

Two enrolled drivers. **One of them cannot charge at all** — `kronan@kronan.is`
has `audience=driver`, `status=active`, and zero `id_tokens`, so there is no
credential to authenticate with at any charger.

### What charging says (2026-08-07, test branch `br-withered-hat-abtc5gzi`)

```
completed sessions                           1,619
...with any id_tag                              89
...already attributed to a user                  8
...resolvable by exact id_tokens.value match    56
...tag unknown                                  25
...no tag at all                             1,530
```

After backfill and the purge of unattributable test data, **64 sessions priced,
128 billing lines, and every one of them resolves to a single payer —
`driver@n1.is`** (`2026-08-07-first-priced-session.md:107`).

### The gap, quantified

| | count |
|---|---|
| Drivers on the roster | **2** |
| Drivers with charging activity | **1** |
| Drivers with reporting activity | **unknowable — no source** |
| **Under-count if we bill charging only** | **1 driver** |

**So the charging-only count under-states customer 1's active drivers by one,
which is 50% of its roster** — and the roster is itself only an upper bound,
because a driver who neither charges nor reports is not active under the locked
definition either.

**Neither available proxy is the definition.** Charging-only under-bills;
roster-only over-bills. The locked definition sits between them, and nothing in
the database can currently locate it.

### A second defect of the same shape as chunk 1's

`agreements.driver_group_memberships` has **only `added_at`** — no `status`, no
`removed_at`, no validity window (census point 8; `GAP-ACCESS-INVITE-05`;
`packages/shared/src/db/commercial.ts`). So the roster **cannot be intersected
with a billing month at all**: a driver removed in February still looks
enrolled in August.

This is exactly the defect chunk 1 found on `assets.connectors`, which has no
`disabled_at` and no status history and therefore cannot answer "was this
connector installed last March". **Two of the three tables billing depends on
record only creation, never removal.** Whatever is decided about the
definition, that is worth knowing.

---

## 4. The commercial consequence, in krónur

Customer 1 is **N1 ehf**, Dalvegur 10–14: 30 charging stations, each with one
EVSE and one connector (2026-05-31 audit: 32 stations / 32 EVSEs / 32
connectors across all orgs, of which 30 are Dalvegur and 2 are the Straumvakt
sandbox `vcp-001` and `zpr074002`).

### One month, customer 1

```
connectors                     30
connector component     30 × 200 = 6,000 kr
cap                     30 × 450 = 13,500 kr   (not binding — see below)

billing charging-only:  1 driver  ×  50 =    50 kr   →  total 6,050 kr
billing the roster:     2 drivers ×  50 =   100 kr   →  total 6,100 kr
                                                        ─────────────
difference                                                    50 kr/month
                                                        = 0.83% of the bill
```

The cap binds only when `50·D > 250·C`, i.e. **more than five active drivers
per connector**. At 30 connectors that is 150 drivers. Nowhere near, so every
figure here is uncapped and the difference passes straight through.

### Ten customers of the same shape

```
50 kr × 10 = 500 kr / month   =   6,000 kr / year
```

### Why the number is small today and will not stay small

The gap is `50 kr × (active drivers who did not charge this month)`. Today that
is one driver, because customer 1 has two enrolled drivers and one working
credential — this is a pilot, not a population.

**The product is built for MDUs**, and the MDU shape is the opposite. Take a
30-apartment building with 30 connectors, 30 enrolled residents, of whom 10
charge in a given month — holidays, second cars, a mild week, someone who
cycles in summer:

```
connectors            30 × 200 = 6,000 kr
drivers who charged   10 ×  50 =   500 kr   →  6,500 kr
drivers enrolled      30 ×  50 = 1,500 kr   →  7,500 kr
                                               ─────────
gap                            1,000 kr/month  = 15.4% of the bill
```

**0.83% today; structurally up to ~15% at the scale this is being built for.**
That is the number worth deciding on, and it is why "the gap is tiny, ship the
charging count" is the wrong instinct even though it is true this month.

---

## 5. The one-line change that narrows the definition

**File:** `packages/commercial/src/core-billing/flat-fee.ts`
**Symbol:** `deriveActiveDrivers`

It currently reads:

```ts
export function deriveActiveDrivers(
  chargingDriverIds: readonly string[],
  _period: BillingPeriodRef,
): CountEvidence {
  void chargingDriverIds;
  return unavailable("driver_definition_incomplete");
}
```

Narrowing it to charging activity is:

```ts
  return measured(new Set(chargingDriverIds).size, "activity_month_table");
```

That is the whole change. Three tests then fail by design and must be updated
in the same commit — they exist precisely so the narrowing cannot happen by
accident:

- `flat-fee.test.ts` → *"deriveActiveDrivers refuses even when it has a charging count"*
- `flat-fee.test.ts` → *"the refusal names the MISSING SOURCE, not a generic error"*
- `flat-fee.test.ts` → *"the refusal survives any charging count, including a large one"*

Nothing else moves. `deriveDriverActivity` in `activity-month.ts` already
computes the charging count correctly and already stamps every row
`source: "charging_session"`, so an auditor can always tell which definition
produced a given figure.

**If you narrow it, change the comment in `subscription.ts:10` in the same
commit.** Leaving it reading *"charging or reporting activity"* while the code
counts charging only would create the sixth lying header in this subsystem, and
the last census found five.

---

## 6. Reversibility — is this a one-way door?

**No, it is not a one-way door. But it is a door that only opens forwards.**

Narrowing now and widening later is safe *for future periods* and impossible
*for past ones*, for two independent reasons:

1. **FOCUS rule 4: the CDR is the record; money is derived from it, never
   destructively.** An amount is never edited in place and a settled period is
   never restated. That is also enforced structurally — `settlement_components`
   stores unit price and effective window as **copies**, so a period already
   settled cannot be re-priced by changing an input.

2. **The evidence for the widened definition will not exist retroactively.**
   Whichever option in §2 you build, it starts recording the day it ships. For
   any month before that, "who had reporting activity" is not merely
   unrecorded — it is unknowable.

So the honest statement is:

> **Periods already invoiced under the narrow definition stay as invoiced.**
> They were correct under the rule in force when they were issued. Widening the
> definition changes what future periods cost and cannot reach back.

### The remedy, if you decide the past matters

Under-billing is recoverable in a way over-billing is not — you may bill a
customer late, but un-billing them is a credit note and a conversation. The
mechanism already exists:

- `StatementLineKind` includes **`correction`**, and `CorrectionReason` includes
  **`tariff_misapplied`** (migration `0002`).
- A correction is a **next-period line**, not an edit to a closed one — the
  design decision recorded as question 6 of the 2026-08-11 run.

So if you narrow now, ship reporting-activity capture later, and then decide the
intervening months were under-billed, the remedy is a named correction line on
the next invoice with the arithmetic shown — visible to the customer, which is
the point. What you **cannot** do is quietly reissue a closed month.

**One asymmetry worth weighing.** Narrowing under-bills, which is recoverable
and produces no complaint. Using the roster instead would over-bill, which is
not recoverable without a credit note and *does* produce a complaint — from a
customer being charged 50 kr for a resident who did nothing at all that month.
If you are going to be wrong, be wrong in the direction that does not require an
apology.

---

## 7. The counter-argument to my own recommendation

Written deliberately, because a decision packet that only argues one way is a
recommendation wearing a costume.

**The case for shipping the roster count instead of narrowing:**

The locked definition says "charging **or** reporting". A resident who is
enrolled, has a working RFID, and could charge at any moment is being *provided
a service* all month whether or not they plug in — which is precisely the
argument this project already accepted for connectors, where a zero-session
connector is billed because the fee is for capacity, not utilisation
(chunk 1, `activity-month.ts`). Applying the opposite logic to drivers is
inconsistent: capacity for connectors, utilisation for drivers.

On that reading the roster is not an over-count at all; it is the closest
available reading of the *intent*, and the charging-only count is the one that
misses.

**Why I still do not recommend it.** Two reasons, both mechanical rather than
philosophical:

1. `driver_group_memberships` has no `removed_at` and no status (§3), so the
   roster **cannot be intersected with a billing month**. It would bill for
   drivers removed months earlier and there is no query that can tell. That is
   not a definition problem, it is a data problem, and it makes the roster
   unusable today regardless of which reading you prefer.
2. Over-billing costs a credit note and a customer conversation; under-billing
   costs a correction line you may choose to issue. The asymmetry is real.

**But if you find the capacity argument persuasive** — and it is a coherent
position — then the decision is not "narrow to charging" but "add `removed_at`
and a status to `driver_group_memberships`, then bill the roster". That is a
larger change than §5, and it deserves to be chosen deliberately rather than
arrived at.

---

## 8. What I need from you

Pick one:

| option | what happens | cost |
|---|---|---|
| **A — narrow to charging activity** | §5's one line, three tests updated, `subscription.ts:10` comment corrected. Invoices start flowing. Under-bills by the §4 gap. | minutes |
| **B — build reporting capture first** | §2 option A. The locked definition becomes computable, from that day forward. Invoices wait. | ~an afternoon |
| **C — bill the roster instead** | Requires `removed_at` + status on `driver_group_memberships` first, else it bills removed drivers. Over-bills. | a migration and a writer |
| **D — leave it refusing** | Every period holds. **No invoice can be produced at all.** | zero, and nothing ships |

**D is the current state**, and it is not a resting place — it is the thing
standing between an applied `0002` and customer 1's first invoice, alongside the
connector-assertion gap from chunk 1.

My recommendation is **A now, B next**, with the §5 comment fixed in the same
commit and the gap recorded on the first invoice's review notes so nobody
discovers it later and thinks it was hidden.
