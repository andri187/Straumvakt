# Reference note — how Driivz models drivers, contracts, tariffs & billing

**Date:** 2026-06-04
**Source:** Driivz "EV Charging Management Platform — API Guide" (30 Aug 2022) + their
api-gateway OpenAPI spec.
**Status:** Reference only. Not canon, not a decision. Captured so the going-public
billing work (esp. the open **P0.7 driver-access-fee** decision) can borrow vocabulary
and avoid re-inventing patterns. Driivz is a generic **principal** CPO/eMSP platform;
Straumvakt is a narrower **agent** model (ADR 0031) — so we copy *structure*, not *breadth*.

> Anything acted on from here touches billing math / tariff resolution / access
> precedence → **CLAUDE.md Rule 5** (stop-and-summarise-then-approve). This note does
> not authorise code.

---

## 1. Their object hierarchy

```
Service Provider
└─ Host (charger host)            type ∈ {STANDARD, FLEET, MDU, WORKPLACE}
   ├─ contract (charger service plan = host↔SP terms)
   ├─ Property                    physical location
   │  └─ Site                     sub-location (floor, lot)
   │     └─ Charger               based on a Charger Model
   └─ Driver accounts
      ├─ Profile / Status / Balance / Payment method
      ├─ Members                  extra drivers under a payingAccountNumber
      ├─ Cards (RFID/virtual)
      └─ Contracts → Driver Plan
```

Host → Property → Site → Charger ≈ our **Org → Site → Installation → Charger**.

## 2. Plan vs Contract vs Tariff (the clean separation)

- **Driver Plan** = *template* for the SP↔driver contract. Holds products + tariffs +
  terms (balance type, category, cost factor, commitment, termination behaviour,
  financial code, display code, default tariff code).
- **Contract** = *instance* of a plan applied to one account. Carries `startDate`,
  `endDate`, `status`, `etf` (early-termination fee), discount, `privateEntityPolicy`
  (PROPERTY|SITE|CHARGER scoping), VIN, etc.
- **Customer Tariff** = its own entity, referenced by `tariffCode`. One tariff can back
  many plans.

**Takeaway:** template (plan) ≠ instance (contract) ≠ pricing (tariff). Three entities,
not one. Maps to our `CustomerPlan` (template) / driver↔billing-home assignment
(instance) / `billing.tariff_definitions` (pricing).

### Plan attributes worth knowing
- **balanceType**: `PRE_PAID | POST_PAID | NON_PAYING | PAYMENT_IMMEDIATELY |
  POST_PAID_IMMEDIATELY` (last = monthly bill but payment settled outside Driivz).
- **category**: `SINGLE_TARIFF_FOR_ALL_DRIVERS | MEMBERSHIP | ROAMING | OTP`
  (OTP = one-time-payment guest driver).
- **costFactor**: lower = cheaper; when multiple plans apply the system can auto-pick the
  lowest cost. (Implicit precedence — a thing we'd want *explicit* instead.)
- **terminationBehavior**: `TERMINATE | EVERGREEN | ROLLOVER`.

## 3. Tariff resolution (multi-dimensional, time-banded)

A plan's tariffs resolve on:
`(chargerGroup) × (connectorType OR chargerSpeed) × dayOfWeek × [startTime → endTime]`

- `chargerSpeed ∈ {SLOW, SEMI_FAST, FAST, ULTRA_FAST}`.
- Tariff sets are validated to **cover the whole week** (7–50 time ranges;
  `DayOfWeekTariffValidationResponse` rejects gaps/overlaps).
- Per-connector tariff override also exists (`/chargers/{id}/connectors/{cid}/tariffs`).

**Customer Tariff internals:** up to three **level periods** (`firstLevelPeriod` …),
each with `durationInHours`, `kwhRate`, `minuteRate`, `hourlyRate`, plug-in rates — i.e.
tiered pricing by elapsed time. Plus `maxChargeTimeInMinutes`, `fixedParkingFee`,
`hourlyParkingRate`, `overtimePenalty`, and:
- **overtimeChargeBehaviour**: `STOP_CHARGE | APPLY_PENALTY | NO_BEHAVIOUR`.

**Takeaway:** our flat "55 kr/kWh · 15 kr/klst after free time" is their APPLY_PENALTY +
single level period. If we ever band by day/night or weekday/weekend, this is the shape —
and "must cover the week" validation is the non-obvious part.

## 4. Products (plan line-items, separate from tariff)

`productType ∈ {RFID_CARD_PURCHASE, SETUP_FEE, SUBSCRIPTION_FEE, MONTHLY_USAGE_CREDIT}`
with `price`, `creditRecurrence` (ONE_TIME|MONTHLY|ANNUALLY|EVERY_USAGE|ROLLOVER),
`freeUnits`, `monthlyUsageCredit`.

**Takeaway — most relevant to P0.7:** this is a ready-made menu for "how does the driver
access fee work" — recurring **subscription** vs **per-use** vs **monthly-credit-then-
overage** vs free-vend — without inventing terms.

## 5. Billing & money

- **Account / wallet** per driver: `anniversaryDay` (billing close day), `paymentTerms`
  (days), `billingCycleTerm` (NONE|WEEKLY|BI_WEEKLY|MONTHLY), `autoPay`, **dunning** state
  machine (delinquency), block settings.
- **Members vs paying account:** `memberAccountNumber` (who charged) is distinct from
  `payingAccountNumber` (who's billed). **Sponsored contract** lets a *sponsor account*
  assume another account's contract, with its own status.
- **Transaction lifecycle (push API):** `STARTED → UPDATED → STOPPED → BILLED`.
  - STOPPED cost is **estimated, no tax**.
  - **BILLED** (the CDR) is the **only** message with final cost; *not sent for corrupted
    transactions*.
- Billing transaction product types are exhaustive (energy fee, time fee, reservation fee,
  overtime penalty, subscription, setup, refunds, penalties, credits…).

**Takeaways:**
1. **BILLED-is-canonical** maps onto our `ImportedCdrRef` and directly diagnoses the
   [Fix A duplicate-session] over-count: the OCPP stop is a *provisional estimate* event,
   the imported CDR is the *only* writer that posts money. Different lifecycle states, not
   two writers of one fact.
2. **Member≠payer + sponsor contract** is structurally identical to our BillObject /
   owner-of-record (ADR 0029) **and** the workplace-pays flow — and validates that the
   sponsor relationship should carry its *own* status so a workplace can revoke without
   touching the driver's home contract.
3. **Members under a paying account** validates the dependents-via-group carve-out
   (ADR 0031).

## 6. What NOT to copy

Driivz is principal-model and broad. Straumvakt deliberately omits, and should keep
omitting:
- Prepaid **wallets** + top-up.
- **Dunning** / delinquency machinery.
- **OTP / guest** drivers (we are admin-created only — no self-signup).
- **Roaming** clearing-house plumbing.
- Balance types beyond post-paid (we're post-paid only per ADR 0031).
- Silent **lowest-cost plan auto-selection** (`costFactor`) — for us, access/tariff
  precedence must be *explicit*, not implicit.

## 7. Four patterns worth lifting (summary)

1. **Plan(template) / Contract(instance) / Tariff(entity)** three-way split.
2. **BILLED-is-canonical**: separate provisional (OCPP stop) from final (CDR) lifecycle.
3. **Payer indirection + sponsor contract** for billing-home & workplace-pays.
4. **Products vocabulary** (subscription / setup / monthly-credit / per-use) as the menu
   for the open **P0.7** driver-access-fee decision.

Next step if we act: an ADR (or 0031 amendment) that (a) picks a Products shape for P0.7
and (b) formalises the STOPPED-vs-BILLED lifecycle — written up for approval before any
schema/repo work (Rule 5).

[Fix A duplicate-session]: the reverted raw-handler over-count — see
`docs/notes/2026-05-12-fix-a-reverted-batching-deployed.md`.
