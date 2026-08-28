# Retiring `ocpp.ocpp_identities`

**Nothing is deleted in this round.** Migration 0005 creates
`assets.device_identities` and touches `ocpp_identities` not at all. This is
the ordered plan, and it exists because "marked for retirement" should name a
plan rather than an intention.

Companion to `2026-08-28-asset-model-retirement-plan.md`, which covers
`charging_stations`. This table is **harder**, for one reason stated up front.

## Why it is harder than `charging_stations`

`charging_stations` is read by reporting and admin surfaces. **`ocpp_identities`
is on the authentication path.** The gateway resolves an inbound WebSocket by
its identity string and checks `auth_secret_hash`; if that lookup is wrong for
one second, chargers cannot connect for that second — and a charger that cannot
connect is a charger that is not earning and not answering a driver.

`gateway/src/auth.ts:6` states the boundary plainly: *"The main app owns the
`ocpp_identities` table; the gateway never [writes it]"*. `identity-do.ts` keys
its Durable Object on `ocpp_identities.id` — **the UUID, not the identity
string** — which is a piece of good luck: the DO key survives an identity
string changing, and it will survive the move if and only if
`device_identities` rows carry the same ids or a mapping is kept.

## What reads it

**64 files** reference `ocppIdentity` / `ocpp_identities` / `OcppIdentity`
outside generated code. They are not equal, and the plan turns on the split:

| tier | examples | risk |
|---|---|---|
| **auth path** | `gateway/src/auth.ts`, `identity-do.ts`, `lib/ocpp-internal-auth.ts` | **a charger cannot connect** |
| **write path** | `chargers.ts` (`createCharger`), `onboarding-chains.ts`, `credential-management.ts`, `local-auth-list-push.ts` | a new charger is unreachable |
| **projection / queue** | `lib/ocpp/projections.ts`, `queues/ocpp-events.ts`, `ocpp-silence-watch.ts` | events unattributed |
| **read-only surfaces** | `site-tree.ts`, `host-views.ts`, `installations.ts`, `sites.ts`, `properties.ts`, `circuits.ts`, `driver-sessions.ts`, `charger-technical-read.ts` | a screen is wrong |

**Only the first tier can take the site down.** Everything else fails visibly.

## The extra precondition, and it is a hard one

**The gateway's resolution must read `device_identities` — with the interval
applied — before the old table stops being written.** With the interval
applied, because a released identity must not authenticate the device that used
to hold it: that is the entire point of dating the credential, and a lookup
that ignores `period` re-creates the bug the new table exists to remove.

A cutover that flips the reader and the writer in the same deploy has a window
in which a charger cannot connect. So the write must be **doubled** first:
every path that writes `ocpp_identities` writes `device_identities` too, both
for a period long enough to prove they agree.

## Order

| step | what | approval |
|---|---|---|
| 1 | **create the successor** — migration `0005`, written, unapplied | this round |
| 2 | backfill `device_identities` from `ocpp_identities`, `[created_at, )`, and reconcile | after the report is reviewed |
| 3 | **double-write**: every writer writes both tables | code only |
| 4 | gateway reads `device_identities` with `period @> now()`, old table still written | code only, and **watched** |
| 5 | cut over the remaining 60 readers, tier by tier | code only |
| 6 | stop writing `ocpp_identities` | code only |
| 7 | drop it | a later migration, **separately, by Andri** |

**Steps 3 and 4 must not be one deploy**, and step 4 must not be one deploy
with step 6.

## The backfill's honest bound, and a question it cannot answer

`[created_at, )` for every existing row, same rule as placements: the row
exists, so the identity was valid from at least when it was written, and it has
never been ended because nothing could end it.

**What the backfill cannot recover is any identity that was CHANGED.** If an
operator ever edited an `identity_string` in place, the old value is gone and
no interval can be reconstructed for it — the history the new table exists to
hold does not exist for the period before it. That is a known and permanent
hole, and it should be recorded on the row rather than papered over: those
placements' identity history begins at backfill, and any question about an
earlier date is **unavailable**.

## What must be verified before step 7

1. Zero reads of `ocpp_identities` outside the migration itself — checked with
   `grep`, and then checked again against raw SQL, which `grep` for a TypeScript
   symbol does not find. `lib/db/raw.ts` is where to look.
2. The Durable Object key still resolves. It is `ocpp_identities.id`; if
   `device_identities` issues new ids, **every live DO is orphaned at cutover**
   and every connected charger is dropped. Either carry the ids across in the
   backfill or ship a mapping — and decide which **before step 2**, because the
   backfill is where the ids are chosen.
3. A charger has connected, authenticated and completed a session through the
   new path, on real hardware, watched.

Nothing past step 1 is in this round's scope, and nothing past step 1 has been
started.
