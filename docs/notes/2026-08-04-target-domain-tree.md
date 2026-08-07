# Target domain tree — provisional

**Status: agreed in conversation 2026-08-04, "until further notice".**
Not an ADR. Nothing here is implemented, and it touches enough existing
decisions that the first job is reconciliation, not construction.

**Read before acting on this:** ADR 0014 (identity/tenancy, five layers),
ADR 0025 (billing cutover legacy → agreements), ADR 0031 + its 2026-06-14
amendment (agent model, per-factor markup), ADR 0034 (contractor billing),
ADR 0045 (topology as a graph).

---

## Parties — roles, not types

```
Organization  ─ roles: host · contractor · retailer · dso
User          ─ audience: operator · driver · service
Membership    ─ User → Organization, in a role
```

One row per real company. The decisive case is the operator's own:
**ON is an electricity retailer AND a chargepoint rental service. So is
N1.** Model "retailer" as reference data and "host" as an Organization
and those companies must exist twice, then be kept in sync forever.
Iceland is small enough that overlapping roles will be the norm, not the
exception.

Consequence: the customer is **an Organization holding the host role** —
not every Organization. Veitur is a party (0 chargers, `dso`), not a
customer. An invoice run that targets "all organisations" is wrong.

## Ownership — where things are, who owns them

```
Property            the building · owner · residents · MDU billing unit
  Site              where the chargers are
    ChargingStation → EVSE → Connector
```

**Property is not redundant, and it looks redundant only because the
live data is a petrol station.** At a forecourt, Property and Site are
one thing. At a fjölbýlishús they are not: residents belong to the
*building*, the building may have two car parks, and the húsfélag that
owns it is often not the party operating the chargers. MDU is the Iceland
case and ADR 0031 explicitly targets multi-dwelling sessions. A level
that is 1:N *sometimes* earns its place.

**Installation dissolves.** It is currently doing three jobs, and it
exists partly because *Zaptec* has installations — the concept arrived
through the vendor import, carrying `credentialsRef`. Redistribute:

| job | goes to |
|---|---|
| metered grid connection *(electrical)* | root circuit (ADR 0045 D2) |
| billing / ownership unit *(commercial)* | Property |
| Zaptec installation reference *(vendor)* | `VendorAssetRef` |

Driivz has no Installation level; their tree is Property → Site →
Charger → EVSE → Connector, and their Site carries an **energy
management tab**, so capacity attaches to the site rather than to a
separate entity. Notably their Site has **no billing tab** — money
attaches higher, which is the same conclusion reached here.

## Electricity — a separate graph, referenced not nested

```
Circuit (parent_circuit_id)
   root = the grid connection point   ← what OSCP and OpenADR address
```

A station references one circuit; its electrical position is derived by
walking upward, never by its position in the ownership tree. Re-wiring is
an edge update, not a tree move.

Per ADR 0045 D5, `parent_circuit_id` stays **unpopulated** until an
electrician confirms the wiring. Vendor circuit data is not ground truth,
and a wrong topology is worse than a flat one.

## Commercial — contracts, not tree nodes

```
Agreement (between two parties)
  ├─ clauses          what forwards, what may be marked up
  ├─ cost factors     the inputs
  └─ rate references  the numbers, time-bounded
```

**This resolves "what are DSOs and electricity retailers?"** — the
question that prompted the whole discussion. They are neither a tree
level nor a reference table. They are **parties with agreements**:

| agreement | carries |
|---|---|
| property owner ↔ retailer | the energy price |
| property owner ↔ DSO | the distribution tariff |
| host ↔ driver group | what drivers pay |
| Straumvakt ↔ host | the platform fee |

Every rate arrives through one mechanism. The tariff engine reads
agreements and never special-cases a party type. A DSO tariff change is a
new rate reference on an existing agreement — not a schema change.

## Vendors — at the edge, never in the core

```
VendorAssetRef ─ our entity ↔ their id
```

Zaptec and Easee identifiers live here and nowhere else. The rule:
**an adapter must never appear in a model.** Today it does —
`circuits.vendor_circuit_ref`, `OcppIdentity.vendorResourceId`,
`Installation.credentialsRef` — which is the slowest-changing layer
depending on the fastest-changing external dependency. Easee is when that
bill comes due.

---

## Where this diverges from Driivz, deliberately

- **Composable roles**, so ON exists once
- **Contractors as parties with agreements**, not a field on an asset —
  ADR 0045 D5 argues this is an acquisition channel for topology data,
  and neither Driivz nor AMPECO treats the contractor as a customer
- **Grid parties billed through the same path as everyone else**

## Cost, and the order to do it in

Most of this is close to what exists. `parent_circuit_id` is one nullable
column; roles are a table; `VendorAssetRef` half-exists.

**Dissolving Installation is the real work** — it is referenced by
chargers, agreements, credentials and `enforceAuthorize`. That wants its
own ADR and a migration, and it should come *after* the billing cutover
(ADR 0025) is resolved, since agreements reference installations today.

Nothing here is urgent. The commercial tables are empty, which is what
makes the whole rearrangement cheap — and that window closes the day a
real customer generates an invoice.

---

## Resolved 2026-08-07 — org roles are set by Straumvakt admin

ADR 0031 §18 derives an organisation's role from the `service_*` agreements
it holds — a commercial fact determining an identity fact, which the layering
forbids permanently since identity may never read commercial.

**Operator decision: roles are written by Straumvakt admin.** There is no
derivation, so there is no inversion. ADR 0031's derive-from-agreements rule
is superseded on this point.

Consequence: `tenancy.organizations.roles` is operator-maintained state, not
a projection. And P4 (`org_email_domains` needing a driver-group display
name) is a different problem than it looked — it is not an instance of a
general identity-reads-commercial pattern, because that pattern no longer
exists. It needs its own answer.
