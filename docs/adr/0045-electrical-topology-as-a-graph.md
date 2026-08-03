# ADR 0045 — Electrical topology is a graph, not a level

**Status:** Proposed — 2026-08-03.
**Amends:** the asset-hierarchy description in
[STRAUMVAKT_ARCHITECTURE_V3](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md)
and CLAUDE.md's "Property → Site → Installation → Circuit → Charger →
Connector" summary.
**Relates to:** [ADR 0035](./0035-multi-operator-scale-readiness-roadmap.md)
(P4 load balancing, OSCP), and the Driivz/AMPECO comparison in
[`2026-08-03-driivz-model-comparison.md`](../notes/2026-08-03-driivz-model-comparison.md).

---

## Context

Both comparable platforms treat electrical topology as a **referenced
resource**, not a position in the asset tree:

- **Driivz** — `electricalTopologyId` on Property and Site;
  `mainInputCircuitResourceId` in the energy policy. Their asset tree is
  Property → Site → Charger → EVSE → Connector, with no circuit level.
- **AMPECO** — circuits attach to and detach from charge points as a
  relation.

Two competitors converging independently is the strongest signal either
spec carries.

### Correction: we are closer than the comparison implied

Checked against the live schema rather than the prose summary:

```
properties.circuits: id, org_id, site_id, installation_id?,
                     display_name, ampere_ceiling?, phase_count,
                     vendor_circuit_ref, metadata
assets.charging_stations: … installation_id, circuit_id …
```

`circuits.installation_id` is **nullable**, and a station carries
`circuit_id` and `installation_id` as **two independent references**. So
circuit is already a reference, not a tree position. The docs describe a
strict chain the schema does not enforce.

**The actual gap is narrower: circuits are flat.** There is no
`parent_circuit_id`, so the model has exactly one electrical level.

---

## Why flat circuits are the problem

Not "because the big platforms nest them" — because of what load
balancing and OSCP each need.

**Real MDU wiring is at least two levels.** A main incomer feeds
sub-panels; sub-panels feed chargers. Today each circuit carries its own
`ampere_ceiling`, but there is no way to say *"these three circuits share
a 200 A incomer."* The binding constraint in almost every garage is the
thing we cannot represent.

**Load balancing is multi-level by nature.** You respect the breaker
*and* the incomer simultaneously. With a flat list you can only enforce
the leaf constraint, and the fleet can collectively exceed the supply
while every individual circuit reads as compliant.

**OSCP forecasts are per grid connection point** — the incomer, not a
charger's local breaker. With no root concept, the nearest stand-in is
`Installation`. That accidentally works while one Installation has one
connection point, and stops the moment an installation has two, or two
installations share one. Making an *ownership* entity double as the
grid-connection unit is precisely the conflation this ADR exists to
prevent.

**Ownership and electricity are different graphs.** Property → Site →
Installation is about who owns, who is billed, and what is addressed.
Circuits are about wiring. They overlap but do not nest: an electrician
can re-wire a charger onto a different sub-panel without anything about
its ownership changing.

---

## Decision

### D1 — Circuits form their own graph

Add a nullable self-reference:

```
circuits.parent_circuit_id → circuits.id   (nullable, RESTRICT)
```

A circuit with `parent_circuit_id IS NULL` is a **root** — the grid
connection point. Everything below it is a sub-circuit. Depth is not
fixed; two levels is the common case and three occurs.

Cycles must be prevented — a circuit cannot be its own ancestor. Enforce
in application code plus a recursive CHECK or trigger; do not rely on
convention.

### D2 — The root circuit is the grid connection point

Not `Installation`. OSCP capacity forecasts, peak shaving and any
DSO-facing figure key on the **root circuit**, which is the physical
supply point.

`Installation` keeps exactly its current meaning and no more: the metered
grid connection **for billing and ownership**, the carrier of
`enforceAuthorize`, and the unit a host administers. It stops being
implicitly electrical.

This decoupling is the point. One installation may sit behind two roots;
two installations may share one.

### D3 — A station references one circuit, unchanged

`charging_stations.circuit_id` stays a single reference — a charger is
fed by exactly one breaker. Its position in the electrical graph is then
derived by walking `parent_circuit_id` upward, not by its position in the
asset tree.

`charging_stations.installation_id` also stays. The two answer different
questions and must not be collapsed.

### D4 — Capacity is declared per circuit at every level

`ampere_ceiling` and `phase_count` already exist and already apply. What
changes is that a balancing decision must satisfy **every ancestor**, not
just the leaf.

Root circuits should additionally carry the DSO-facing identity — grid
connection point reference, and whatever OSCP needs to address it. That
can follow when OSCP work begins; the graph is the prerequisite.

---

## Consequences

**Positive.** The binding constraint in a real garage becomes
representable. Load balancing can enforce breaker and incomer together.
OSCP gets a correct unit to forecast against instead of borrowing an
ownership entity. Re-wiring becomes an edge update, not a tree move. And
the docs stop describing a stricter hierarchy than the schema has.

**Negative.** Any capacity calculation becomes a recursive walk rather
than a single-row read. Cycle prevention is new work. Two-graph models
are harder to explain than one tree — the docs must be explicit that
ownership and electricity are separate, or someone will re-conflate them.

**Migration is trivial today.** Eight circuits exist. The change is one
nullable self-FK plus whatever parent links reflect the actual wiring at
Dalvegur and Fálkahraun — which someone has to look at, since the data
to derive them does not exist in the system.

**Timing is the whole argument.** This is a nullable column at 8
circuits and 33 chargers. Once dynamic load balancing and OSCP are built
against a flat list, both encode the assumption that a charger has one
constraint, and the change acquires two dependents that reason about
capacity. **Do it before P4's load balancing, not after.**

**Not included.** No change to Property, Site, Installation or the
station↔installation reference. No new tables. This is one column and a
decision about what the root means.

---

## D5 — Vendor circuit data is not ground truth

**Operator, 2026-08-03:** *"the circuit set up from the Zaptec portal is
not very reliable."*

`circuits.vendor_circuit_ref` exists because the current 8 rows came in
with the Zaptec import. So the topology we hold is **whatever was typed
into a vendor portal during commissioning** — not a survey, not a
drawing, and nothing that was verified against the actual panel.

That has two consequences:

1. **Parent links cannot be inferred from what we have.** Not merely
   absent — the child rows themselves are of unknown accuracy, so
   inferring a parent from them would compound an error rather than fill
   a gap.
2. **A wrong topology is worse than a flat one.** A flat list at least
   fails honestly: it enforces the leaf breaker and says nothing about
   the incomer. A graph asserting a 200 A incomer that is really 100 A
   would let load balancing exceed the supply while believing itself
   compliant — the failure mode being fixed, restored with more
   confidence attached.

**So `parent_circuit_id` must stay nullable and unpopulated until
someone competent confirms the wiring.** Absent parent = "unknown", not
"root". Only an explicit confirmation makes a circuit a grid connection
point; the balancer must treat an unconfirmed graph as flat and refuse
to claim headroom it cannot prove.

### This is what the installer/contractor product is for

Topology capture is not a data-entry chore to be got through. **The
contractor commissioning a site is the only party who knows the
wiring** — which sub-panel feeds which chargers, and what the incomer is
rated at.

That makes the installer/contractor surface (deferred, but on the list
next to overlay mode) the natural **acquisition mechanism**: give the
electrician a tool worth using — their own fleet view, their own SLA
position, their own commissioning record — and correct topology falls
out as a by-product rather than as unpaid work done for our benefit.

Neither Driivz nor AMPECO treats the contractor as a customer; both
treat them as a field on an asset. This is where that difference pays.

**Sequencing, revised:** ship the column with P4's load balancing so the
model is right, but **do not populate it from vendor data**, and treat
the balancer as flat wherever the graph is unconfirmed. Real topology
arrives with the installer product.
