# OCPI ↔ the asset model

One page, written now so the export is not redesigned from scratch later.
There is no OCPI implementation in this repository; what follows is the
**mapping the schema was built to satisfy**, and the two places where getting
it wrong is expensive.

ADR 0054's "What this aligns with" says the shape *"is what the
interoperability specifications already require, arrived at independently"*.
This note is the receipt for that claim.

## The one that matters: `EVSE.uid` is a PLACEMENT, not a device

OCPI `mod_locations` says an `EVSE.uid` *"can never be changed, modified or
renamed"*, and warns explicitly:

> a CPO will typically want to avoid using identifiers of the physical hardware
> for this `uid` property. If they do use such a physical identifier, they will
> find themselves breaking the uniqueness requirement for `uid` when the same
> physical EVSE is redeployed at another Location.

**So `EVSE.uid` maps to `placements.public_id`, and never to a serial, a device
id or an OCPP identity string.** That column exists from day one — migration
0005 — for exactly this reason: it is free now and impossible to retrofit once
anything external holds a reference to it.

| OCPI | ours | note |
|---|---|---|
| `Location.id` | `installations.id` | the site as the roaming network sees it |
| `EVSE.uid` | **`placements.public_id`** | never the device, never the serial |
| `EVSE.evse_id` | not issued yet | the eMI3 id; a separate registration question |
| `EVSE.status` | `connectors.status`, converted | see the vocabulary note below |
| `Connector.id` | `connectors.connector_index` | OCPP's index, as a string |
| `Connector.standard` | `connectors.type` | |
| `CDR.cdr_location` | the session's **sealed** context | copied in, never referenced |

## Opening and closing

Ending a placement is **`PATCH status: REMOVED`** on the EVSE, with the
`evse_id` released for reuse. Opening one publishes a **new** EVSE under the
new Location, with a **new** `uid`.

That is why closing a placement is a state and not a delete (ADR 0054 item 13):
a deleted row cannot emit the PATCH, and a CPO with no closed placements has
nothing to send. **CPOs who delete instead are why the ecosystem has an open
issue about it.**

The move sequence maps one-to-one onto `moveDevice`:

| our operation | OCPI |
|---|---|
| close the placement at `t` | `PATCH .../{old_uid}` with `status: REMOVED` |
| open a placement at `t` | `PUT .../{new_uid}` under the new Location |

Both in one transaction on our side; two calls on the wire, in that order. **If
the PUT is sent before the PATCH, the same physical unit is live at two
Locations** — which is the roaming-visible form of the double-invoice.

## The status vocabularies are different, and the conversion is stated

OCPI `EVSE.status` is **not** OCPP `StatusNotification.status`. They are
different alphabets and the mapping is lossy in one direction:

| OCPP 1.6 | OCPI |
|---|---|
| `Available` | `AVAILABLE` |
| `Preparing`, `Charging`, `Finishing` | `CHARGING` |
| `SuspendedEV`, `SuspendedEVSE` | `CHARGING` |
| `Reserved` | `RESERVED` |
| `Unavailable` | `INOPERATIVE` |
| `Faulted` | `OUTOFORDER` |
| *no StatusNotification yet* | `UNKNOWN` |

**Five OCPP values collapse into `CHARGING`, and `SuspendedEV` versus
`SuspendedEVSE` — "the car stopped it" versus "we stopped it" — is gone.** That
is the whole argument for ADR 0054 item 11: OCPP → OCPI is a stated conversion
performed at the boundary; OCPP → house enum → OCPI loses the distinction
permanently, and the driver support call that needs it happens on our side of
the boundary, not the roaming partner's.

The last row is the other half of item 11. A connector that has never reported
maps to `UNKNOWN`, **not** to `INOPERATIVE` — which is why the stored sentinel
is `unknown` and not `Unavailable`. Mapping silence to "out of service" would
tell a roaming partner to route drivers away from a charger that may be fine.

## CDRs

OCPI `mod_cdrs`: a CDR is *"sealed, preserving the information valid at the
moment in time the underlying session was started"*, carries the owning party,
and **copies the location in rather than referencing it**.

Migration 0008 is that rule: `placement_id`, `tariff_snapshot_json` and
`tariff_snapshot_at` on `charging.sessions`. A CDR emitted years later reads
its own columns; it does not resolve where the device is now.

## What this note does not decide

- **`EVSE.evse_id`** — the eMI3 identifier — is a registration question, not a
  schema one. `public_id` is a UUID and is deliberately not it.
- **Tariff mapping** to OCPI `Tariff` objects. The sealed snapshot has the
  values; the shape of the export is a separate piece of work.
- **Whether we publish at all.** Nothing here commits to a roaming connection.
  The point is that the schema does not *prevent* one, and that the two
  identifiers OCPI says can never change are stable in our model from day one.
