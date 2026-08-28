# Retiring `charging_stations` and `ocpp_identities`

**Written with migration 0005, which does not perform any of this.** 0005 adds
`assets.devices`, `assets.device_identities` and `assets.placements` and
touches neither predecessor: no `ALTER`, no `DROP`, no backfill, no data
movement. Both predecessors are marked in their Drizzle declarations and remain
live and correct for every existing reader.

This note exists so that "marked for retirement" names a plan rather than an
intention.

## Why the two are not one migration

Adding a successor and dropping a predecessor in one migration cannot be rolled
back without losing every row written in between. Between apply and revert,
writes land in the new tables; a revert that drops them destroys those rows,
and a revert that keeps them leaves a schema that matches no migration. The
only safe shape is: create, backfill, dual-read, cut over, then drop — with an
approval at each boundary.

## What has to be true before a `DROP` is even proposed

1. **A backfill exists, has been reviewed, and has been reconciled.** Row
   counts on both sides, and a per-row comparison of the columns that carry
   money-affecting meaning: which org, which installation, which circuit.
2. **Every `charging_stations` reader has moved.** `grep` is the start, not the
   finish: raw SQL, Prisma `include`s and the gateway's identity resolution all
   reach these tables by different spellings.
3. **The placement history is not invented.** This is the hard part and it is
   flagged here rather than discovered during the backfill —
   `charging_stations` records where a device **is**, and nothing anywhere
   records when it got there or where it was before. A backfill can therefore
   produce exactly one placement per station, and the honest lower bound for
   its `from` is the row's `created_at`.

   **It must not be written as `[-infinity, )` or as the installation's
   creation date.** Both would be a claim about the past that no evidence
   supports, and decision 5 bills by overlap — a fabricated early `from` bills
   a host for months the device may not have been there. If `created_at` is
   itself unreliable for imported rows, the placement's start is
   **unavailable**, and ledger note 22 says that is not a zero and not a guess.
   The reconciliation must list those rows rather than fill them.

## `ocpp_identities` has one extra precondition

The gateway resolves an inbound connection by identity string. Its resolution
path must read `device_identities` — with the interval applied, so a released
identity does not authenticate the device that used to hold it — **before**
the old table stops being written. A cutover that flips the reader and the
writer in the same deploy has a window where a charger cannot connect.

## Order

| step | migration | approval |
|---|---|---|
| create the successors | **0005 — written, unapplied** | this round |
| backfill + reconcile | a script, no schema change | after review of the report |
| dual-read, old table still authoritative | code only | — |
| cut over readers, including the gateway | code only | — |
| drop the predecessors | a later migration | separately, by Andri |

Nothing past row 1 is in this round's scope, and nothing past row 1 has been
started.
