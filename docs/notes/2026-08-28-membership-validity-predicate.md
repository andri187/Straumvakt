# The membership-validity predicate — for B's item 9

**A does not implement this.** ADR 0054 item 5 is A's (the schema), the
validity check is B's item 9. This note is the contract between them: what the
schema now guarantees, and the exact predicate to write against it.

Migration `0006` is written and **unapplied**. Everything below describes the
schema after it applies.

## What the schema guarantees

`agreements.driver_group_memberships` after `0006`:

```
id                uuid    PK
driver_group_id   uuid    NOT NULL
user_id           uuid    NOT NULL
added_at          timestamptz NOT NULL   -- when the ROW was written
period            tstzrange   NOT NULL   -- when the membership is VALID
```

- `UNIQUE (driver_group_id, user_id)` is **gone**. A pair may have many rows.
- `EXCLUDE USING GIST (driver_group_id WITH =, user_id WITH =, period WITH &&)`
  — at most **one live membership per (group, user) at any instant**, enforced
  at write time. On PG 18+ the `WITHOUT OVERLAPS` form is written out and
  commented in the migration.
- `CHECK (NOT isempty(period) AND NOT lower_inf(period))` — no empty interval,
  and every membership has a known start.
- `DEFAULT tstzrange(now(), NULL, '[)')` — a row created without a period is
  valid from now, open-ended.

**`added_at` is not the validity.** It is when the row was written, an audit
fact, and it is kept for that. A membership backdated by an operator has an
`added_at` of today and a `period` starting last month; reading `added_at` as
the start would bill the wrong month.

## The predicate

**At an instant** — "may this driver charge right now", the access check:

```sql
WHERE m.driver_group_id = $group
  AND m.user_id         = $user
  AND m.period @> $at            -- $at = now() at the access check
```

`@>` is lower-inclusive and upper-exclusive, matching `[from, until)`. A
membership ending at 14:00 does not cover 14:00.

**Over a period** — "was this driver a member in March", the billing check:

```sql
WHERE m.driver_group_id = $group
  AND m.period && tstzrange($period_start, $period_end, '[)')
```

**Overlap, not currency.** ADR 0054 decision 5. A driver who joined on the 2nd
and left on the 28th was a member in March; a query asking `period @> now()` in
April finds nobody and bills for none of them.

**Counting distinct drivers over a period:**

```sql
SELECT count(DISTINCT m.user_id)
  FROM agreements.driver_group_memberships m
  JOIN agreements.driver_groups g ON g.id = m.driver_group_id
 WHERE g.owner_org_id = $org
   AND m.period && tstzrange($period_start, $period_end, '[)')
```

`DISTINCT` matters and the constraint does not remove the need for it: a driver
who left in March and returned in July has two rows, and both overlap the year.
The constraint forbids **overlapping** rows, not multiple rows.

## Three things the predicate must not do

1. **Do not read `added_at`.** See above.
2. **Do not treat "no rows" as zero.** Ledger note 22. A group with no
   membership rows and a group whose memberships have not been imported look
   identical to `count(*)`. The count is `unavailable` unless the source is
   known to have run — which is exactly what `activity-source.ts` already does
   for connectors, and the driver count should reuse rather than reinvent.
3. **Do not use `BETWEEN` or `>= AND <=` on the bounds.** Both make the upper
   bound inclusive and double-count the boundary instant, which is the one a
   move-out and a move-in share.

## The helpers that already exist

`packages/shared/src/domain/effective-dating.ts`, on
`dev/core-billing-integration`:

| function | SQL it mirrors |
|---|---|
| `containsInstant(period, at)` | `period @> $at` |
| `rowsOverlappingPeriod(rows, period)` | `period && tstzrange(...)` |
| `checkTemporalKey(existing, candidate, sameKey)` | the EXCLUDE constraint |
| `overlaps(a, b)` | `&&`, including that empty ranges overlap nothing |

And in `apps/api/src/repositories/driver-group-memberships.ts`,
`membershipCoversInstant(rangeLiteral, at)` reads a range as Postgres actually
returns it — **space separator and a two-digit offset**, which `new Date`
rejects. Any code parsing these literals needs that; a parser written against
ISO-8601 passes its tests and reads nothing from the database.
