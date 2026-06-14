# ADR 0031 — Cost model + money flow (Straumvakt as agent, host as principal)

**Status:** Accepted — Q1/Q2/Q3 locked 2026-06-04 (see Decisions section);
driver-access-fee mechanics remain open (gate P1, not P0).
**Date:** 2026-06-04
**Sprint:** Sprint 9 model-lock follow-up
**Supersedes (in scope):**
None directly. Locks the cost/billing flow that prior ADRs deliberately
left open.
**Relates to:**
[ADR 0017 — Pre-pilot rescope](./0017-prepilot-rescope-for-4k-charger-target.md)
(ISK-only, deferred real billing tag E),
[ADR 0019 — Agreements architecture](./0019-agreement-and-bearer-architecture.md),
[ADR 0021 — Rate-reference propagation](./0021-reference-catalogue-and-tariff-propagation.md),
[ADR 0025 — Billing cutover from legacy to agreements](./0025-billing-cutover-from-legacy-to-agreements.md),
[ADR 0026 — Host-managed driver enrollment + invoice recipient model](./0026-host-managed-driver-enrollment-and-billing-model.md)

## Context

ADR 0026 pinned **who receives the invoice** (child-object owner for
multi-dwelling, single billable entity for company hosts) but
deliberately left open the **money flow + revenue capture** —
specifically:

- Straumvakt's role for VAT (principal vs. agent)
- Where the money actually moves between driver, host, and Straumvakt
- Tariff structure depth (flat-only vs. ToU vs. fees)
- Free-vend semantics
- Reimbursement / company-pays surface
- Bad-debt handling

The 2026-06-03 night conversation answered most of these in 22 numbered
items. This ADR locks them and flags the three sub-models that still
need explicit option-selection (tariff structure, Straumvakt revenue,
subscription).

## Decision

### 1. Straumvakt is an agent, never a principal

Straumvakt does **not** sell electricity. Straumvakt only:

- **Logs** OCPP/AMQP session events and MeterValues
- **Calculates** session cost from the host's tariff structure
- **Invoices** the end payer (driver / driver's group owner / company)
  on behalf of the host

The host is the principal — they sell electricity, they bear product
liability for the equipment, they own the VAT-relevant supply.
Straumvakt's only VAT-relevant supply is its **service fee to the host**
(item 6/7 below).

This determines:
- Invoice header reads "Straumvakt fyrir hönd <Host>" (Straumvakt on
  behalf of Host).
- The host's tax ID appears as the VAT-registered seller on the
  electricity invoice.
- Straumvakt's tax ID appears on the separate Straumvakt → Host
  service invoice.
- Disputes about session metering or charger faults route to the host
  (item 15).

### 2. Per-kWh = DSO + ELE always; additional fees are layered

Every charged kWh always accumulates **DSO + ELE** charges to *someone*
(driver, host, or company). This is non-negotiable — the electricity
supplier and distribution operator must be paid.

On top of that base, hosts may layer additional fee components defined
in `agreements.cost_factors` (e.g. `MTR` metering fee, `TRF_CHG` charging
service fee, `TRF_IDLE` idle penalty, plus future codes). The set of
additional codes that apply is configured per agreement / per host /
per tariff. **No reservation fee in pilot scope (item 10).**

> **Open — flexible tariff structure (item 2 / 9 / 11):**
> The schema supports the layered model, but the *catalogue* of
> additional fee codes and the *config surface* hosts use to compose a
> tariff out of those codes still needs design. Options sketched in
> "Open questions" below.

### 3. Currency

ISK only. Pilot constraint per ADR 0017 — locked.

### 4. Money flow: driver → host → Straumvakt

```
              kWh × (DSO + ELE + extras)
   Driver  ─────────────────────────────────►  Host
   (private bank, monthly e-bill, post-paid)

              Per-driver / per-charger / per-session fee
   Host    ─────────────────────────────────►  Straumvakt
   (monthly Straumvakt invoice to the host)
```

Straumvakt **never holds driver money**. The driver pays the host
directly (regular Icelandic e-bill flow to the driver's private bank).
The host then pays Straumvakt separately for the platform service.

Implications:
- Straumvakt does not need a payment-processor relationship for driver
  collections.
- Straumvakt's accounts-receivable is on hosts only.
- No client-money / safeguarding regulation risk for Straumvakt (no
  PSD2-equivalent posture needed).
- Host bears bad-debt risk on driver invoices (Straumvakt sends the
  invoice as agent, but the receivable is the host's).

### 5. Settlement to host

**Monthly.** Settlement = the host receives the full electricity revenue
the system collected on their behalf, billed to their drivers / drivers'
group owners / sponsoring companies. Mechanism is the host's own bank
inflow — Straumvakt doesn't move money on the host's behalf, just
issues the invoices.

### 6. No internal credit / wallet

Straumvakt does not hold driver balances or credits. All session costs
hit the next monthly invoice cycle. Post-paid only (item 21).

### 7. Host receives full electricity revenue; Straumvakt invoices host separately

The full driver-paid amount goes to the host. Straumvakt issues a
**separate monthly invoice to the host** for the agreed Straumvakt fee
(see Open question #2 — Straumvakt revenue model).

### 8. Non-payment → driver access disabled

If a driver's prior-month invoice goes unpaid past the host's grace
period (TBD per host configuration; default proposed: 14 days
post-due-date), their **access is disabled** for all chargers tied to
that host. Access auto-restores when the debt is settled.

Implementation:
- Driver `DriverGroupMembership.status` flips from `active` to
  `suspended_unpaid`.
- The Authorize gate (per ADR 0019 §A.11) and the mobile app's charger
  list both honor the suspended status.
- Suspension is per-host — a delinquent Alice at Dalvegur retains her
  N1 access if her N1 charges are paid current.

> Note: this is the host's revenue protection mechanism. Straumvakt's
> own fee non-payment from the host triggers a different lever
> (Straumvakt could disable the host's installation entirely, but the
> threshold and process are out of scope here).

### 9. Tariff is driver-bound, not just charger-bound

Same driver may face **different tariffs at different chargers on the
same installation**. A multi-dwelling host might charge residents
differently from visiting fleet drivers; a company might differentiate
employees from contractors using the same chargers.

The resolution chain is therefore:

```
ChargeSession → (driver, charger) → applicable tariff agreement → factors
```

NOT:

```
ChargeSession → charger → applicable tariff agreement → factors
```

The `agreements.*` schema already supports this (an agreement can be
scoped to a DriverGroup; per-driver-group rate references resolve at
session-stop). What needs to be made explicit is that the
**(installation, DriverGroup)** pair is the resolution key, not just
the installation. Captured in upcoming session-stop resolver hardening
(separate task).

Each session is concluded independently against its applicable tariff
at start time (with the mid-session-change handling per item 14
below).

### 10. Family / group: group owner's contract rules the conclusion

When a driver is a member of a group (HOA group, family group, fleet
group), the **group's contract determines which tariff applies** to
that driver's sessions. Individual drivers inherit the group's billing
rules; the bill goes to the group owner.

This generalizes item 10B of ADR 0026 — child-object owners are
group owners.

### 11. Free-vend hosts: still compute cost, no driver-facing fees

A free-vend host is one where the **host absorbs the DSO + ELE cost
itself** (no additional fees, no per-kWh billing to drivers).

- DSO + ELE is **still computed per session** for host reporting
  (the host needs to know what they spent and on whom).
- Driver-facing invoice line items: zero.
- The mobile app shows the computed cost to the driver but **clearly
  marked as covered** ("Innifalið" / "Free for you" badge).
- Host receives a session overview report showing per-driver totals.

Implementation:
- A tariff with `billing_target_is_host=true` flag (or equivalent —
  pending agreement-architecture wiring).
- Session cost computed normally; invoice line item suppressed for the
  driver; aggregated line item appears on the host's monthly
  Straumvakt-issued operational report.

### 12. Company-pays mode: driver does not see the charge

When a session at a given charger is sponsored by a company (the
company pays instead of the driver / driver's group owner):

- Session cost is still calculated.
- Driver invoice line: zero (covered by company).
- Driver's session history in the app **clearly labels the session as
  "<Company> greiðir"** ("paid by Company") so the driver sees what
  would have cost them.
- The company receives an invoice for the aggregated company-paid
  charges from Straumvakt, on behalf of the host.

The sponsoring company **does not have to be the host**. Two examples:

- N1 employee charges at their building's HOA-operated chargers (host)
  while on company business → N1 pays, HOA hosts.
- Visiting consultant charges at a client's company chargers while on
  the consultant's own employer's business → consultant's employer
  pays, client company hosts.

**Required:** sponsoring companies are **registered and known by
Straumvakt** before they can be designated as payers. Schema implication:
new `billing.sponsor_companies` (or similar) registry, separate from
`tenancy.organizations` since a sponsor doesn't necessarily host
chargers.

### 13. Mobile app surface for company-pays (item 14)

The mobile app must surface to the driver, before and during a session,
that this charger / this session is company-paid. The driver charger
card and live charging view show a "Greitt af <Company>" badge in
place of the price.

Per ADR 0026 item 5, this surface is also part of the empty-state /
onboarding — a new driver invited by an employer-host sees "N1
greiðir" from the first session.

### 14. Mid-session tariff change → split by timestamp

If a tariff (especially DSO time-of-use brackets) changes mid-session,
the **session cost is split at the change timestamp** and each portion
priced against the rate effective at that interval.

A 90-minute session that crosses a DSO peak→off-peak boundary at
21:00:00 produces two computed segments:

```
[start, 21:00) → kWh_a × DSO_peak_rate
[21:00, stop)  → kWh_b × DSO_offpeak_rate
```

Implementation:
- Session-cost resolver iterates rate-change boundaries within the
  session's [start, stop] window.
- MeterValues sampled inside each segment determine the kWh allocated
  to that segment.
- For sessions without sub-segment MeterValues (rare; older chargers),
  fall back to linear interpolation against total kWh and total
  duration. Flag this in the audit log for the host's awareness.

### 15. Metering disputes → host's call

If a driver disputes the metered kWh, the dispute is **routed to the
host**. Straumvakt does not arbitrate or refund metering claims —
Straumvakt's logs are evidence the host uses to decide.

Implementation:
- A "Tilkynna mæli-ágreining" (Report metering dispute) action on the
  driver's session-detail screen submits a structured complaint
  attached to the session id.
- The host's operator view shows pending disputes per session.
- The host's decision (refund / partial / decline) writes a credit-note
  line back to the driver's next invoice, and a counterpart line on
  the Straumvakt-to-host invoice if a service-fee credit applies.

### 16. Faulted sessions still bill; clearly flagged

If a session faults mid-way (charger error, network drop), the
**driver still pays for the kWh actually delivered**. Straumvakt does
not waive partial sessions because the equipment is the host's
responsibility (item 1).

But: every faulted session is **flagged in the driver's monthly
report** with the fault reason recorded. This gives the driver
transparency and ammunition for an item-15 dispute if they believe the
fault was equipment-side.

### 17. Post-paid only

All invoicing is post-paid. The Icelandic e-bill (rafrænn reikningur)
system used for the driver invoices is inherently post-paid. No
prepayment / wallet model anywhere in V3 / pilot scope. (Item 21.)

### 18. HOA can add a child driver without kennitala, billed to group owner

**Refines ADR 0026 item 10A.** A user without their own kennitala is
permitted to exist as a User row **if and only if** they are bound to
a group whose owner has a kennitala. The group owner receives the
**full invoice** for the group's drivers — including the kennitala-less
member.

Use case: HOA gives an apartment access; the apartment owner has a
kennitala; their teenage child does not yet have a personal billing
identity. The HOA adds the child as a driver under the apartment's
group; charges aggregate to the apartment owner's bill.

Implementation:
- `users.kennitala` becomes `NULLABLE` but constrained: a row with
  null kennitala must have `group_owner_user_id` set, and that owner
  row must have non-null kennitala.
- Group owner's invoice line items aggregate by driver (so the owner
  sees "Alice: 124 kWh, Child A: 47 kWh, Child B: 12 kWh — total 1830
  kr").
- Suspension on non-payment (item 8) applies to the group as a whole
  if the group owner is delinquent — all kennitala-less dependents
  lose access along with the owner.

### 19. Free-vend cost visible to driver, marked covered

Restates item 11 from the driver-app perspective. The driver sees:
- The kWh delivered
- The cost that would have applied
- An "Innifalið" / "Free for you" badge replacing the line item
- The covering party clearly named ("HOA Dalvegur covers this charge")

Reinforces transparency and discourages drivers from feeling the host
is hiding the actual subsidy value.

## Decisions (locked 2026-06-04)

The three open sub-models below are **RESOLVED**. Operator picks override
the "recommended starting point" notes that follow.

- **Q1 → Option B (open code namespace).** Hosts / Straumvakt staff can
  register new factor codes per agreement. Maximum flexibility; the
  agreements schema stores codes as data, not a fixed enum.
- **Q3 → Option B (per-host negotiated).** Every host has individually
  negotiated terms. No published price list / tier table at launch.
- **Q2 → per-host negotiated service fee + a new driver access fee.**
  Two revenue streams:
  1. **Straumvakt → Host: a negotiated fixed monthly service fee**
     (set per host, consistent with Q3), **optionally plus a fixed
     per-OCPP-identity / per-charger fee.** Not per-driver, not per-kWh.
  2. **Driver → (collector TBD): an access fee to use a charger** — a
     new consumer-side stream not in the original options. The driver
     pays this *to access the charger*, distinct from the energy cost
     they already bear.

### New — driver access fee (mechanics) — **RESOLVED 2026-06-14**

The driver access fee is decided in principle (above) and its mechanics
are now pinned:

- **Who collects it → Host is principal; Straumvakt is agent.** The fee
  is **host revenue**. Straumvakt invoices the driver *on the host's
  behalf* (presents the bank claim / greiðsluseðill) and remits to the
  host. Straumvakt's own revenue stays the separate Straumvakt → Host
  service fee (Q2.1). Invoice posture: kröfuhafi is the host (rendered
  "Straumvakt f.h. <host>"), **not** Straumvakt as principal.
- **Cadence / shape → agreement-dependent.** There is no single fixed
  shape. The access fee — whether per-session, per-kWh, monthly, or
  flat-per-grant, and its rate — is defined by the **driver's
  agreement/contract** (ADR 0019 factor codes), negotiated per host.
  It is resolved per driver from the agreement model, not hard-coded.
- **Relationship to energy cost → additive line on the same invoice.**
  One driver invoice; the access fee shows as its own line (e.g.
  "Aðgangsgjald" / host service line) alongside the DSO + retailer
  electricity lines, with VAT. Mobile app renders it as an extra line.
- **Free-vend interaction → still applies.** The access fee is charged
  even when the host covers electricity ("Innifalið" covers *energy*,
  not *access*). A host that wants access free too omits the fee from
  the agreement.

**Implementation consequence (Rule 5):** because the fee is
agreement-dependent and additive on the driver invoice, the driver
billing path must move from the legacy DSO+retailer tariff chain
(`lib/tariff/*`) to the **ADR 0019 agreement resolver**
(`lib/agreement/resolveBillingLines`), which already produces per-line
billing output from the driver's agreement. The legacy chain remains
the electricity sub-computation; the agreement model layers the
contract-defined fee lines on top. This IS the P1 billing engine.

> This does not block P0 commit or ADR 0029 (attribution). It gated the
> P1 billing-module design — now resolved; P1.3/P1.6 unblocked.

### Amendment 2026-06-14 — no MDU gating; forward-with-markup

Two clarifications that override earlier wording in this ADR and ADR 0019:

1. **No `MDU only` gating.** Drop the notion that any factor is restricted to
   an MDU/site type. `IDL` (idle power loss) and `NET` (internet/SIM) are
   ordinary host operating costs the host may enlist and forward at **any**
   installation — they are not site-type-gated. This follows
   [[agreement_sole_bearer_determinant]] (agreements alone determine
   bearer/terms; `Site.siteType` is descriptive only). `installation_type`
   does **not** gate factor enlistment; `BearerType.trd` is **not** MDU-only.

2. **Forward-with-markup.** Every cost item's rate is *decided in the
   Straumvakt ↔ Host contract* (the base). The host may then **forward** an
   item to drivers and **add its own markup** on top — the markup is host
   margin. Canonical case: `USRF` — the Straumvakt→host USRF is fixed by the
   `service_cpo` agreement; the host may bill the driver USRF **+ a host
   addition**. Mechanically this is the base clause on the Straumvakt↔host
   agreement plus a host-authored clause/BearerRule on the host↔driver
   agreement carrying the host's (≥ base) rate. No new schema — two agreements,
   two rates. (Resolver realignment is part of the P1 cutover; no code change
   here.)

## Open questions

> **RESOLVED 2026-06-04 — see Decisions above.** Retained for the option
> analysis and rejected-alternative history.

Three sub-models are intentionally left in this ADR with **options**
the operator must pick from before the implementation work starts.

### Open Q1 — Tariff structure flexibility (items 2 / 9 / 11)

What's the catalogue of fee components hosts can layer on top of the
mandatory DSO + ELE base? Options, not mutually exclusive:

- **Option A — fixed code catalogue.** A small enum of codes
  (`MTR`, `TRF_CHG`, `TRF_IDLE`, `TRF_CONN`) hard-coded in the
  agreements schema. Hosts pick which apply and set rate refs.
- **Option B — open code namespace.** Hosts (or Straumvakt staff)
  can register new factor codes per agreement. More flexible, more
  rope.
- **Option C — fixed catalogue + custom override.** Default catalogue
  + an "Annað" (Other) code with free-text label + amount. Simple to
  audit, leaves an escape hatch.

Recommended starting point: **Option C** — predictable + safe + has
an escape hatch.

### Open Q2 — Straumvakt revenue model (item 7)

What does the Straumvakt → Host invoice charge for? Options:

- **Option A — per-charger SaaS.** Flat monthly fee per managed
  charger (e.g. 4 900 kr/charger/month). Predictable for both
  parties; doesn't track usage.
- **Option B — per-driver SaaS.** Flat monthly fee per active driver
  (e.g. 590 kr/driver/month). Aligns Straumvakt revenue with the
  host's driver base.
- **Option C — per-session transaction fee.** A few króna per
  session (e.g. 25 kr/session). Aligns with actual usage; revenue
  fluctuates with charging activity.
- **Option D — per-kWh markup.** A small per-kWh fee (e.g. 0.50
  kr/kWh) added to the host's DSO+ELE that's labeled as Straumvakt
  service. Revenue scales with energy throughput.
- **Option E — hybrid.** Floor + per-session OR floor + per-kWh.
  Most flexible, harder to communicate cleanly.

Recommended starting point: **Option A (per-charger) + Option C
(per-session)** as a hybrid — predictable floor for the host, scales
with actual operational load. Per-driver SaaS adds friction for HOAs
with high resident counts and low charger counts; avoid.

### Open Q3 — Subscription model for hosts (item 11)

How do hosts enter the subscription relationship? Options:

- **Option A — fixed tier per host type.** Multi-dwelling tier vs.
  Company tier vs. Fleet tier; rates differ by tier. Operator picks
  the tier at host onboarding.
- **Option B — per-host negotiated.** Every host has individually
  negotiated terms. Maximally flexible, ops-heavy.
- **Option C — published price list + volume discounts.** Public
  rates with automatic discounts above thresholds (e.g.
  10+ chargers → 10%, 50+ chargers → 25%). Transparent + scales.

Recommended starting point: **Option C** — published price list +
volume discounts. Maps cleanly to the "going public + RFQ" pivot;
prospects see what they'd pay before contacting sales.

## Consequences

### Enabled

- Straumvakt's agent posture removes payment-processor and
  client-money regulatory exposure entirely.
- Host bears bad-debt risk on driver invoices, aligning incentive
  (host knows their residents / employees; Straumvakt doesn't).
- Family / HOA group support (item 18) unlocks the multi-driver-per-
  apartment + minor-child case without requiring a kennitala per
  human.
- Free-vend hosts (HOA covers electricity in dues) are first-class,
  with full cost visibility for both host and driver.
- Company-pays (item 12) supports employer reimbursement without the
  full reimbursement-workflow complexity that ADR 0017 deferred to
  post-pilot tag B.

### Disabled / out of scope (explicitly)

- Reservation fees (item 10).
- Driver-side prepaid wallet / credits (item 17).
- Straumvakt as payment processor or money mover (item 4).
- Standalone non-kennitala adult users (still out per ADR 0026 item
  10A; the item-18 carve-out only covers dependents in a group whose
  owner has a kennitala).
- Currency other than ISK (item 3).

### Required follow-up

- ~~Pick Open Q1 / Q2 / Q3 options.~~ **DONE 2026-06-04** (Q1→B, Q3→B,
  Q2→per-host negotiated service fee + driver access fee). Remaining
  billing-module blocker: pin the **driver-access-fee mechanics**
  (collector / cadence / free-vend interaction) before P1.3/P1.6.
- **Schema work** — `billing.sponsor_companies` registry (item 12),
  `users.kennitala` nullability with group-owner FK constraint (item
  18), mid-session-segment cost computation enhancements (item 14).
- **Mobile app surface work** — company-pays badge (item 13), free-vend
  "Innifalið" badge (item 19), faulted-session flag in history (item
  16), metering-dispute action (item 15), suspended-unpaid login
  response (item 8).
- **Host operator view** — per-driver session overview for free-vend
  hosts (item 11), pending metering disputes (item 15), faulted
  sessions log (item 16).
- **Tariff resolver hardening** — make (installation, DriverGroup)
  the resolution key per item 9; add mid-session-boundary splitter
  per item 14.

## Rejected alternatives

- **Straumvakt as principal seller of electricity** — would impose
  full VAT-on-revenue posture, electricity-supplier licensing risk,
  client-money safeguarding requirements. Out per item 1.
- **Driver-pays-Straumvakt-pays-host money flow** — would require
  Straumvakt to be a payment processor with client-money safeguarding.
  Out per item 4. Direct driver → host is simpler operationally and
  regulatorily.
- **Prepaid driver wallets** — would change everything: collection
  rules, refund posture, age-of-credit accounting, surrender to host
  on driver-leaves cases. Out per item 17 (post-paid only).
- **Per-kWh-only Straumvakt fee** — would tie Straumvakt revenue
  entirely to energy throughput and hurt the case for free-vend
  hosts (who'd see Straumvakt's incentive misaligned with their
  zero-extra-fees policy). Open Q2 discusses but recommends against
  pure per-kWh.
- **Straumvakt arbitrates metering disputes** — would require
  Straumvakt to take a position on host hardware fault behaviour.
  Out per item 15.
