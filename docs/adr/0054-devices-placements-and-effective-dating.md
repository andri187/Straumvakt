# ADR 0054 — A device is immortal, a placement is dated, and billing counts overlap

**Status:** Accepted · **Date:** 2026-08-20
**Supersedes in part:** nothing — this is new ground
**Touches:** ADR 0049 (the CDR is the record) §sealed sessions · ADR 0029
(bill objects) §effective-dated membership · FOCUS.md rule 4, rule 5
**Retires a pending decision:** the "charger identity access-grant model"
(D9 on the 2026-08-19 decision list) is answered here and comes off that list.

> FOCUS.md rule 8 says write an ADR only when a decision is load-bearing *and*
> irreversible. This qualifies on both. Three relationships depend on it, it
> shapes the fresh schema before that schema exists, and a settled billing
> period can never be re-priced — so a placement model that is wrong in
> February cannot be corrected in March.

---

## Context

A charger serial exists on exactly one installation. But over its life it
moves: a privately owned Zaptec Pro follows its owner to a new house; a rental
unit's subscription is cancelled and the hardware is reinstalled for a
different customer at a different site; a charger moves between buildings
mid-billing-month.

The current model has one table for all of this. `ocpp_identities` is unique on
`(org_id, identity_string)`, `createCharger` performs no existence check, and
the gateway resolves a connection with
`WHERE lower(identity_string) = lower($1) LIMIT 1` — no org scope, no ordering.
Two orgs can therefore hold the same serial and the winner is undefined, which
routes a charger's energy to an arbitrary host. The trigger is not a mistake;
it is the ordinary business event of a charger changing hands.

The obvious repair — make `identity_string` globally unique and hard-delete on
move — is wrong in two ways. It forbids the re-add that every one of the cases
above requires. And it destroys the device: lifetime energy, session counts,
firmware and fault history all live on rows that the move deletes.

**Sessions are already safe.** `charging.sessions` carries its own `org_id`,
`site_id`, `charging_station_id` and `evse_id`, with `ocpp_identity_id`
nullable. History does not move when a device does. It is the device that has
nowhere to live.

---

## Decision

### 1 · The device is the physical unit and is immortal

One row per physical charger, never deleted. It carries everything true of the
hardware irrespective of where it sits: **lifetime energy, lifetime session
count, firmware history, fault and warranty history.** These follow the asset,
never the site.

**Keyed by a surrogate id, not by the serial.** The serial is a strong natural
key and an unreliable one — OCPP 2.0.1 makes `serialNumber` optional and
"vendor-specific", capped at 25 characters; OCPP 1.6 offers two competing
serial fields plus a third for the meter. Store it as `(vendor, serial)`
unique, nullable.

### 2 · The OCPP identity is a credential, not a hardware fact, and gets its own dated table

`device × identity_string × [from, until)`.

The identity on the wire doubles as the HTTP Basic auth username, and in OCPP
2.0.1 it is a settable `SecurityCtrlr.Identity` variable. Operators keep it
when swapping a faulty unit at a site, and must change it when a device moves
tenant. Neither operation may be a data-model violation.

### 3 · A placement is device × installation × a half-open interval

`[from, until)`. A device may have many placements over its life and is in **at
most one place at any instant**.

Enforced as a temporal key, not as a partial unique index:

```sql
period tstzrange NOT NULL,
CONSTRAINT one_place_at_a_time UNIQUE (device_id, period WITHOUT OVERLAPS)
```

with `btree_gist`. On PostgreSQL below 18:
`EXCLUDE USING GIST (device_id WITH =, period WITH &&)`.

**Open-ended is `[from,)` — an unbounded range, not a NULL column.** §"Why not
the simpler constraint" explains why this is not a stylistic preference.

### 4 · Membership rows are closed, never deleted

The same shape governs driver → access group. The uniqueness constraint is on
the interval, not on the `(parent, child)` pair — so a closed row and a new
open row can coexist, which is exactly what move-out then move-in requires.

**This does not extend to connectors.** A connector is a child of the device,
not a membership; it does not migrate between devices. Its *availability* is a
separate status series with different retention and different query patterns.
Modelling it as a dated association buys nothing and would fight an OCPP 2.0.1
migration, which reorganises the EVSE/connector hierarchy.

### 5 · Billing counts placements overlapping the period

Not placements current at the moment of billing. A device placed on the 2nd and
removed on the 28th is billable; a device that moves on the 12th belongs to the
old host for eleven days and the new one for the rest.

### 6 · Sessions are sealed and carry their own context

`org_id` as today, and additionally **the placement id, the site and the
tariff, snapshotted at session start.** A session is never re-attributed when a
device moves. A dispute years later must be answerable without reconstructing
where the device was that day.

### 7 · Lifetime data is permanent

No erasure on transfer. Lifetime device statistics are facts about hardware,
not about a person, and the customer is an organisation rather than a departing
private individual. *(Per-driver session retention is a separate question and
is not decided here.)*

---

## Why not the simpler constraint

A partial unique index on `WHERE until IS NULL` enforces "one open row" and
**nothing whatsoever about closed rows.** It permits two closed placements for
one device that overlap in time, and permits a closed placement overlapping the
open one.

Decision 5 then sums over overlapping placements. So:

> A device is placed at site A `[Jan 1, Mar 1)`. A correction is later
> backfilled as a second closed row at site B `[Feb 1, Mar 1)` without ending
> the first — a bad import, or an operator fixing one half of a move. The
> `until IS NULL` index sees zero open rows and raises nothing. **February's
> billing run counts the device twice and invoices two customers for the same
> physical unit.**

With `WITHOUT OVERLAPS` that insert fails at write time. The constraint is the
only thing standing between decision 5 and a silent double-invoice, and this is
a subsystem where absent evidence is `unavailable` and never zero — a billing
model that can double-count by omission does not meet that bar.

Secondary: a nullable `until` forces `COALESCE(until, 'infinity')` into every
billing predicate and indexes poorly. A range column is one indexed `&&`.

---

## What this aligns with

Not invented here. The shape is what the interoperability specifications
already require, arrived at independently:

- **OCPI** `mod_locations` on `EVSE.uid`: *"a CPO will typically want to avoid
  using identifiers of the physical hardware for this `uid` property. If they
  do use such a physical identifier, they will find themselves breaking the
  uniqueness requirement for `uid` when the same physical EVSE is redeployed at
  another Location."* **OCPI's EVSE is our placement, not our device.** The
  mapping is `EVSE.uid` → placement id, never the serial. Ending a placement is
  `PATCH status: REMOVED` with the `evse_id` released for reuse; opening one
  publishes a new EVSE under the new Location.
- **OCPI** `mod_cdrs`: a CDR is *"sealed, preserving the information valid at
  the moment in time the underlying session was started"*, carries the owning
  party, and copies the location in rather than referencing it. Decision 6 is
  that rule.
- **OCMF**: the signed metering record binds to the meter serial — mandatory,
  with no site or contract field anywhere in its identity block. Decision 1.
- **Effective dating / SCD type 2** — Kimball's durable key, PeopleSoft's
  current/history/future rows. Decisions 3 and 4 are the assignment-history
  variant of a pattern that predates this industry.
- **Overlap-based proration** is the ordinary subscription convention.

There is no standard that governs a CPMS's internal model. These are the
constraints the interop specs impose plus the pattern the wider field settled
on; this ADR is the point at which we stop deriving them per-file.

---

## Implementation — the thirteen changes

Locked 2026-08-20. Items 1–6 land **before** the Dalvegur re-onboard, because
that run writes the first placements.

### Schema, before the fresh generation

**1 · `charging_stations` becomes `devices`.** It already carries the right
fields — vendor, model, serial numbers, firmware, meter serial, ICCID. Strip
out the placement-shaped ones: `org_id`, `installation_id`, `circuit_id`, and
the `site_assets` link. Add a surrogate PK, `(vendor, serial)` unique and
nullable, and the lifetime counters. This is also OCPP 2.0.1's own shape —
`ChargingStation` is *"the physical system where an Electrical Vehicle (EV) can
be charged."* We already had the right entity carrying the wrong foreign keys.

**2 · `placements`** — `device × installation × tstzrange`, with
`UNIQUE (device_id, period WITHOUT OVERLAPS)`. Carries what the device row used
to: org, installation, circuit, site. **Give it a stable public id from day
one** — that is the OCPI `EVSE.uid`, which the spec says *"can never be changed,
modified or renamed."* Free now, impossible to retrofit.

**3 · `device_identities`** — `device × identity_string × tstzrange`, same
temporal key.

**4 · EVSE and connector remain children of the device, and the 1:1:1
hardcoding goes.** The import currently invents one EVSE and one connector at
index 1, `type: "Type2"`, and a warranty date of install + 5 years. For Zaptec
Pro the 1:1:1 is true; bake the OCPP hierarchy rather than the coincidence, and
take vendor, model, serials and firmware from `BootNotification` instead of
inventing them.

**5 · `driver_group_memberships`** — add the interval, drop the
`(group, user)` unique, replace with the temporal key.

**6 · `charging.sessions`** — add `placement_id` and the tariff snapshot.
Additive.

### Code

**7 · `gatherConnectorEvidence`** joins placements overlapping the period
instead of reading current rows.

**8 · `ocpp-authorize.ts`** resolves identity → open `device_identity` →
device → open `placement` → installation. One more hop, same verdicts.

**9 · The membership check moves from existence to validity** —
`WHERE period @> session.started_at`. Five other call sites share the shape.

**10 · `createCharger` becomes `attachDevice` / `detachDevice`.** Explicit
close-then-open, enforced by the temporal constraint rather than by an
application check, so a move that skips the detach fails at write time.

### Bake in now, because the specs will want it

**11 · Keep the protocol's status vocabulary** on connectors — `Available`,
`Preparing`, `Charging`, `SuspendedEV`, `SuspendedEVSE`, `Finishing`,
`Reserved`, `Unavailable`, `Faulted`. No house enum: a 2.0.1 migration and any
OCPI export both want the originals.

**12 · Persist the four vendor-config fields** currently read and discarded —
`Charger.Active`, `AuthenticationType`, `IsAuthorizationRequired`,
`PropertyOcppDefaultIdTag` — each with a timestamp. Each changes what our own
rows *mean*, which is the test for what belongs in the database.

**13 · Closing a placement is a state, not a delete.** OCPI requires
`status: REMOVED` rather than removal, and CPOs who delete instead are the
reason the ecosystem has an open issue about it. A closed placement is what
would emit that.

### Explicitly not changing

The money engine (`money`, `flat-fee`, `subscription`, `period-lifecycle`,
`period-close`), all of `packages/contracts`, the nine-endpoint route surface,
migrations `0002` and `0003`, and the gateway Worker. The port pattern is why —
the engine asks `ActivitySourcePort` for a count and does not care how it was
derived. `connector_assertions` and `connector_activity_month` are already
keyed `(org_id, period_year, period_month, connector_id)`, so a device that
moves mid-month naturally produces one row per host. That shape was right
before we knew why.

---

## Consequences

**Immediate, before anything else is built:**

- The fresh schema carries `devices`, `device_identities`, `placements` — and
  `ocpp_identities` in its present form does not survive.
- Confirm the PostgreSQL version Neon serves. `WITHOUT OVERLAPS` is 18+;
  below that the `EXCLUDE` form is required and the migration differs.
- **The Dalvegur re-onboard creates the first placements.** It must happen after
  this lands, not before, or the first data written will be shaped wrong.

**Follows from decision 5:** `deriveConnectorActivity` counts connectors by
placement overlap, not by current placement. The present implementation counts
current rows and would bill a mid-month move to the wrong host.

**Follows from decision 4:** `driver_group_memberships` gains an interval and
loses its `(group, user)` unique. That is the move-out capability, which had no
owner.

**Retired:** the access-grant design decision for charger identity. There is no
grant model to choose. A device is in one place at a time, and moving it is an
explicit close-then-open.

**Not decided here:** per-driver session retention; whether the surviving
onboarding path writes placements directly or derives them from a vendor
import.
