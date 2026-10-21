# Lifetime counters — what writes them, when, and why a replay does not double

ADR 0054 decision 1 says a device carries **lifetime energy and lifetime
session count**, and decision 7 says those are permanent — no erasure on
transfer, because they are facts about hardware rather than about a person.

Migration 0005 creates the columns. **Nothing writes them yet.** This note says
what should, and it is design only: no writer is built here.

## The columns, and the shape they are already in

```
lifetime_kwh                        numeric(14,3)   nullable
lifetime_kwh_observed_at            timestamptz     nullable
lifetime_session_count              integer         nullable
lifetime_session_count_observed_at  timestamptz     nullable
```

**Every one is nullable and every one is paired with its own observed-at**, and
that is the design rather than laxity. Ledger note 22: a device we have never
polled has `NULL`, which reads as *unavailable*. **A device with 0 kWh and a
device we have not asked are not the same claim**, and a `NOT NULL DEFAULT 0`
would have made them identical and irreversibly so.

## The problem, stated before the mechanism

A lifetime counter is a **monotonic total reported by the device**, and there
are three ways to maintain one. Two of them are wrong here:

| approach | why not |
|---|---|
| **sum our sessions** | we do not have all of them. A charger's sessions before it was imported are ours to bill nothing for and the device's to have charged. Summing produces a number that is smaller than the truth and looks authoritative. |
| **increment on each session** | every replay double-counts, every missed message under-counts, and the error is **permanent and invisible** — there is nothing to reconcile against. |
| **store the device's own reading** | monotonic, self-correcting, and a replay is a no-op. |

**Chosen: store the reading, never accumulate.** The counter is not ours to
compute; it is the device's to report and ours to record.

## What writes them

Two sources, and they are ranked:

1. **OCPP `MeterValues` with `measurand: Energy.Active.Import.Register`,
   `context: Sample.Periodic` or `Transaction.End`.** This is the meter's own
   cumulative register — exactly the number wanted — and OCMF signs it on the
   installations that have it.
2. **The vendor's own lifetime figure**, where the API exposes one, as a
   fallback for chargers that never reach our gateway. Zaptec-authentication
   installations are permanently in that position, which is the same blind spot
   the connector-activity status tier exists for.

Session **count** has no equivalent register in OCPP 1.6. It is therefore
either the vendor's figure or `unavailable` — and **it must not be quietly
derived from our own session rows**, which is the "sum our sessions" error
wearing a different hat.

## Why a replay does not double-count

Because the write is an **assignment, not an increment**, and it is guarded:

```sql
UPDATE assets.devices
   SET lifetime_kwh = $reading,
       lifetime_kwh_observed_at = $observed_at
 WHERE id = $device
   AND ($observed_at > lifetime_kwh_observed_at OR lifetime_kwh_observed_at IS NULL)
   AND ($reading >= lifetime_kwh OR lifetime_kwh IS NULL)
```

Three properties fall out, and each is worth stating:

- **A replay of the same message is a no-op.** `observed_at` is not greater
  than itself.
- **An out-of-order message is a no-op.** Queues reorder; the older reading
  loses rather than overwriting the newer one.
- **A reading that goes BACKWARDS is refused.** A lifetime register that
  decreases is a meter replacement, a firmware reset or a wrong device — never
  a smaller lifetime. The row keeps the larger value and the event is a
  finding, not a silent correction.

That last clause is the one that will fire in practice, and **what to do when
it fires is not decided here**: a meter swap is legitimate and its register
genuinely restarts. The honest options are a separate `meter_serial_number`
change record, or a `lifetime_kwh_offset` carried alongside. Both need the
event to be visible first, which is why the guard refuses rather than clamps.

## Transfer

**No erasure.** Decision 7. A device moving from one host to another keeps its
lifetime figures, because they describe hardware and the customer is an
organisation rather than a departing private individual.

The consequence a host will notice: **the new host can see how much energy the
unit delivered at its previous site.** That is a deliberate disclosure and it
should be an explicit product decision rather than a surprise — it is a fact
about equipment they now own, but it is also a number about somebody else's
business. *(Per-driver session retention is a separate question and ADR 0054
explicitly does not decide it.)*

## What is not decided here

- **The cadence.** Once per `MeterValues`, or once per hour? Every write is
  cheap and idempotent, so the answer is a load question rather than a
  correctness one.
- **Backfill.** `charging_stations` carries a lifetime-kWh cache (Sprint 3 /
  ADR 0013). Whether that seeds `devices.lifetime_kwh` depends on whether it
  was itself accumulated or observed — **and if it was accumulated, it must not
  seed anything**, because it carries the error this design exists to avoid.
  That is a question for whoever writes the backfill, and it is the first thing
  they should check.
