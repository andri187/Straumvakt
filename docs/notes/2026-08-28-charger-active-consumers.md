# `Charger.Active` — who would consume it, and what writes it

§12 backlog item 2: *"every read path that currently assumes all rows are
live"*.

**The first finding is that the question has no consumers yet, because nothing
writes the field.** That is not a reason to skip the census — it is the reason
to do it now, while the answer can still be designed rather than retrofitted.

## What writes it: nothing, and it is one line from being something

`apps/api/src/lib/zaptec.ts` — B's file — declares `Active?: boolean` on
`ZaptecChargerLite`, so **the bulk response already carries it and we already
parse it.**

`apps/api/src/repositories/zaptec-charger-status-sync.ts:265-280` persists the
other two fields from that same response, each guarded so `undefined` does not
overwrite a known value:

```ts
if (charger.IsAuthorizationRequired !== undefined) { … }
if (charger.AuthenticationType !== undefined) { … }
```

**`Active` is read and dropped.** There is no third block.

That sync is the natural writer for `assets.vendor_config_observations`, and
the port it should write through — `VendorConfigSinkPort` — exists as of this
round. **The importer is B's**, which is why this note names the site rather
than editing it.

## The census: read paths that treat every row as live

`charging_stations` has no `active` column at all, so *every* path below is
"assumes live" by construction. What differs is whether that matters.

| path | what it does | does it matter |
|---|---|---|
| **`billing-tariff-mgmt.ts:339`** `chargingStation.count({ chrgrfTariffId })` | "how many chargers use this tariff", gating deletion | **YES.** A tariff held only by deactivated chargers cannot be deleted, forever. |
| **`billing-tariff-detail.ts:168`** | lists chargers on a tariff | **YES**, same shape — an operator sees decommissioned units in a live list. |
| **`contracts.ts:296`, `driver-pricing.ts:347`** | chargers under an agreement | **YES** if either ever feeds a count that reaches money. |
| **`site-tree.ts:411`** | the site tree an operator browses | **Probably.** A deactivated charger should still be visible, but marked — deleting it from the tree loses where it was. |
| **`routes/public/driver.ts:296`** | chargers a driver can see | **YES, and it is the worst one.** A driver routed to a deactivated charger arrives at hardware that will not start. |
| **`circuits.ts:131`, `installations.ts:157`** | load/capacity aggregation | **Yes, in the other direction** — a deactivated charger draws no power, so including it over-estimates the circuit. |
| **`zaptec-bulk-config.ts:60`, `charger-zaptec-config.ts`** | pushes config to chargers | **No.** Configuring a deactivated charger is harmless and arguably right. |
| **`vehicle-id-sessions.ts`, `vehicle-recurrence.ts`** | historical session analysis | **No.** History is history; a charger being deactivated today does not unmake last month's sessions. |
| **`agreements-debug.ts:183`** | a debug surface | **No.** |

**Five matter, two matter in the opposite direction, and four do not.**

## The rule that falls out

Not "filter everywhere". Three different rules, and conflating them is how the
next fix goes wrong:

1. **Anything that reaches money or routes a driver must filter to active.**
   Billing (Phase 5's predicate, done), the driver-facing charger list, and any
   count that becomes a quantity.
2. **Anything operational should SHOW deactivated rows, marked.** The site
   tree, the tariff detail list. Hiding them makes an operator wonder where
   their charger went; marking them answers it.
3. **Anything historical must not filter at all.** Sessions, recurrence,
   vehicle analysis. Filtering history by today's state rewrites the past — the
   same error `tariff_snapshot_json` exists to prevent.

## What must happen first, and it is not a read path

**The writer.** Until `vendor_config_observations` has rows, every consumer
above would read `unavailable` — and `unavailable` is a hold, not a filter. So
adding filters before the writer exists would turn every one of those five
surfaces off.

**Order: writer, then backfill, then filters — in that sequence, and not
overlapping.** The writer is one guarded block in a sync that already writes
two neighbouring fields, and it belongs to B.
