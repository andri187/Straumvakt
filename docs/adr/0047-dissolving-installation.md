# ADR 0047 — Dissolving Installation

**Status:** Proposed · 2026-08-06
**Supersedes nothing. Implements** the "Installation dissolves" decision in
[`docs/notes/2026-08-04-target-domain-tree.md`](../notes/2026-08-04-target-domain-tree.md),
which asked for exactly this ADR.

---

## Context

The asset tree today is

```
Property → Site → Installation → ChargingStation → EVSE → Connector
```

Driivz and AMPECO — the reference architecture chosen for the structure — have
no Installation level. Theirs is Property → Site → Charger → EVSE → Connector.

Measured on staging, 2026-08-06:

| level | rows |
|---|---:|
| properties | 2 |
| sites | 3 |
| **installations** | **2** |
| charging_stations | 31 |

Three levels above the charger, essentially one-to-one-to-one, and the middle
one carries **9 endpoints and a 171-line repository for two rows**.

**Installation is not a domain concept here. It arrived through the Zaptec
import**, which has installations, and it brought `credentialsRef` with it —
one of the three vendor leaks named in the target-domain-tree.

## The table does four unrelated jobs

| job | columns | where it belongs |
|---|---|---|
| **vendor** | `vendorInstallationRef`, `credentialsRef`, `credentialsId`, `credentialsStatus`, `vendorId`, `modelId` | `VendorAssetRef` |
| **commercial** | `retailerTariffId`, `installationType` | Property |
| **electrical** | `circuits[]` back-relation | root Circuit (ADR 0045 D2) |
| **protocol** | `enforceAuthorize` | **open — see D2** |

Six of nineteen columns are Zaptec's. That is the whole reason the level
exists.

## Blast radius, measured

**Eight tables carry a foreign key to `properties.installations`, across five
Postgres schemas:**

| table | column | domain |
|---|---|---|
| `assets.charging_stations` | `installation_id` | assets |
| `properties.circuits` | `installation_id` | assets |
| `agreements.agreements` | `installation_id` | **commercial** |
| `agreements.driver_access_requests` | `installation_id` | **commercial** |
| `billing.bill_objects` | `installation_id` | **commercial** |
| `identity.id_tokens` | `scope_installation_id` | identity |
| `identity.user_vendor_refs` | `scope_installation_id` | identity |
| `identity.vendor_user_groups` | `installation_id` | identity |

Plus **58 code files**, **12 endpoints**, and **68 `enforceAuthorize` call
sites**.

This is not a refactor. It is a migration touching five schemas and the
access-grant path.

## Decisions needed

**D1. Where does `enforceAuthorize` go? — ANSWERED 2026-08-07: ChargingStation.**

Operator decision, against my recommendation of Site, and on reflection the
better answer. It decides whether an unknown card may charge, which is a
property of the charge point itself: two chargers on one site can legitimately
differ — a public forecourt bay enforcing while a staff bay does not — and a
site-level flag cannot express that without a second override mechanism.

Cost: 31 rows to keep consistent instead of 3, and a bulk-set surface for the
operator. Accepted.

Still requires sign-off to CHANGE any value — it is `false` everywhere today
and turning it on is charger behaviour, separate from where the column lives.

**D2. Does `agreements.installation_id` become a Site or a Property?**
An agreement is with a party about a place. Under the 2026-08-04 "any party can
be Straumvakt's customer" decision the counterparty is already changing, so
this should be settled in the same pass rather than migrated twice.

**UNBLOCKED 2026-08-07** — [ADR 0048](./0048-billing-cutover-resolved-agreements-survives.md)
settles that the agreements generation survives, so its anchor is now the one
that matters. Still open, but answerable.

**D3. `id_tokens.scope_installation_id` — Site, or dropped?**
It narrows which install a token authorises at. Rule 5 territory
(access-grant resolution). If Site replaces it, the semantics are unchanged;
if it is dropped, tokens become global and that is a behaviour change.

**D4. Do the vendor columns move now or with the rest?**
They are the only group with no cross-domain dependency —
`VendorAssetRef` already exists and already carries `credentialsRef`. This is
the one piece that could start ahead of ADR 0025.

## Sequencing

1. ~~Answer D1~~ **done — ChargingStation.** D3 still open (Rule 5).
2. **Move the vendor columns to `VendorAssetRef`** (D4). Independent of 0025.
3. **Resolve ADR 0025 D1–D5.** Everything commercial waits here.
4. Repoint `charging_stations` and `circuits` to Site.
5. Repoint the three identity columns.
6. Repoint the three commercial columns.
7. Drop `properties.installations`, its repository, and its 9 endpoints.

## Constraints that apply

- **Every step is a staging migration** and 21 chargers write continuously.
  Each needs explicit go-ahead; none of it is pre-authorised.
- **Build and prove each step on the test branch first.** It mirrors staging,
  it is disposable, and `test/parity/` already compares behaviour against real
  rows.
- **Route paths are a public contract.** 12 endpoints carry `installation`;
  `docs/reference/api-endpoints.md` makes any change to them a reviewable diff.

## What this buys

- One level out of the asset tree, matching Driivz/AMPECO
- 9 endpoints and a repository removed
- **One of the three named vendor leaks closed** — `Installation.credentialsRef`
- A table doing four jobs replaced by four things each doing one

## What it does not buy

Nothing for the driver, the operator or the invoice. This is structural debt
repayment, and it competes for time with ADR 0025 — which is upstream of it,
and where 8,695 lines of billing have so far produced no invoices.
