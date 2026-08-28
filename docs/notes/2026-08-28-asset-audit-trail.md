# An audit trail for the asset model

§12 backlog item 5. *"Who attached, who detached, who asserted, and what an
operator sees."*

**Design only. Nothing here is built this round**, and the reason is at the
bottom: one of the four events cannot be audited by the writer that causes it.

## What already exists, and it is more than expected

`audit.actions` is in the baseline schema with every column this needs:

```
org_id NOT NULL, actor_user_id, actor_kind, action,
target_type, target_id, metadata, occurred_at
```

**Nothing writes to it.** `audit.read`, `platform.impersonate` and
`platform.support.action` are declared permissions with no implementation.

And the asset model already carries **actor columns of its own**, added this
round: `placements.attached_by_user_id`, `placements.detached_by_user_id`,
`connector_assertions.asserted_by_user_id`, `device_identities.assigned_by_user_id`.

## The question that has to be answered first: two places or one?

The row-level actor columns and `audit.actions` overlap, and having both
without a rule is how they drift.

**The rule: the row answers "who", the audit answers "what happened".**

- **The row-level column is the CURRENT fact.** `detached_by_user_id` is who
  detached this placement, and it is on the row because that is where a reader
  of the placement will look.
- **`audit.actions` is the SEQUENCE.** It carries the attempts, the refusals
  and the order — none of which a row can hold, because a row only remembers
  its last state.

The distinction that makes both necessary: **a refused attach writes no row.**
An operator who tried to attach a device to the wrong site three times before
succeeding leaves one placement and three audit rows, and the three are what
you want when they ask why it did not work.

## The four events

| event | `action` | `target_type` / `target_id` | what `metadata` must carry |
|---|---|---|---|
| attach | `asset.placement.attached` | `placement` / id | device id, installation id, period start |
| **refused attach** | `asset.placement.refused` | `device` / id | **the reason, and the conflicting placement id** |
| detach | `asset.placement.detached` | `placement` / id | period end, reason |
| move | `asset.placement.moved` | `device` / id | both placement ids, the instant, both orgs |
| assert | `billing.connector.asserted` | `connector` / id | period, evidence note |
| retire | `asset.device.retired` | `device` / id | reason |

**The refusal row is the one that must not be dropped.** Every other row here
has a surviving artefact; the refusal has none, and it is the one an operator
asks about.

## Three rules the writer must follow

1. **`org_id` records the tenant the target belonged to AT THE TIME**, not now.
   `audit.actions.org_id` is written at insert and never updated; a device that
   later moves must not drag its history to the new host. This is the same read
   ADR 0054 exists to prevent elsewhere, and it is free provided nothing ever
   back-fills the column.

2. **The audit write is in the SAME transaction as the effect**, for the events
   that have one. An audit row without its effect is a lie about what happened;
   an effect without its audit row is the gap the trail exists to close. The
   refusal row is the exception and must be written **outside** any
   transaction, because the transaction it would join is the one that rolled
   back.

3. **No personal data in `metadata`.** Ids, reasons and timestamps. An idTag, a
   kennitala or a driver's name in an audit blob is personal data in a table
   with a 7-year retention argument attached to it and no deletion path — which
   is item 2.6's problem inherited by the one table least able to solve it.

## What an operator sees

Two surfaces, and only one of them is new:

- **On a device**, a timeline: placed at A, moved to B on the 12th, retired.
  This is `placements` read in order — `historyFor` already returns it — and it
  needs no audit table at all. **That is the point of closing rather than
  deleting.**
- **On an org**, an activity log: who did what, including what was refused.
  This is `audit.actions` filtered by `org_id`, and it is the surface that does
  not exist.

## Why nothing is built here

**`attachDevice`, `detachDevice` and `moveDevice` write through the Drizzle
adapter, which has never executed** — migration 0005 is unapplied. Adding audit
writes to a path that cannot run would add untested code to untested code, and
the audit row is precisely the thing whose absence is invisible until someone
needs it.

**And one event cannot be audited where it happens.** The refusal that matters
most — a **skipped detach**, caught by the exclusion constraint rather than by
the pre-check — surfaces as a SQLSTATE inside a rolled-back transaction. The
writer that would record it is the one whose transaction just died. It has to
be written by the caller, after the rollback, from the refusal the port
returns — which is exactly why `attachDevice` returns a **named reason** and
not an exception.

**That design decision was made in Phase 6 for a different purpose and turns
out to be the thing that makes the audit trail possible.** Recorded here so
nobody "simplifies" it back into a throw.
