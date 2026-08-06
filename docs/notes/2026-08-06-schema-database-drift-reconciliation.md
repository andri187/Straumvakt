# Schema vs database — reconciled, 2026-08-06

Read-only. Nothing applied, nothing migrated. This resolves parked item **P2**
from [the overnight report](./2026-08-06-modular-split-and-drizzle.md).

`prisma migrate diff --from-config-datasource --to-schema prisma/schema`
produces a 212-line report / 415-line SQL script. The parked question was
"which side is right — the schema or the database?"

## The answer

**The database. On every substantive item, without exception.**

There is not one difference in the 212 lines where the database holds something
wrong. Every real disagreement is the Prisma schema **failing to declare
something the database correctly has**.

Which means **P2 needs no migration at all.** It is a schema-editing job, and
it can be done any time, with no staging window and no risk to the 21 chargers.

## Do not run the generated migration

Not as a whole, and not in part. Applying it would:

- **drop 21 working column defaults** (`gen_random_uuid()`, `now()`)
- **drop 4 correct foreign keys** on `charging.tap_intents`
- **drop a UNIQUE index** on `vendors.vendor_asset_refs`
- **destroy `agreements.driver_access_requests.triggered_by`** and its data,
  replacing it with an empty camelCase column

It would also break the Drizzle identity schema landed tonight, which declares
those defaults — `apps/api/test/parity/identity-schema.test.ts` asserts the
database has them and would go red. That is the harness doing its job.

## The 212 lines, categorised

| # | category | verdict |
|---:|---|---|
| 37 | foreign-key **renames** — hand-named `…_fk` → Prisma's `…_fkey` | cosmetic |
| 27 | index **renames** — all 27 are `RENAME TO`, none structural | cosmetic |
| 21 | `ALTER COLUMN … DROP DEFAULT` | **DB right, schema wrong** |
| 4 | foreign keys on `charging.tap_intents` | **DB right, schema wrong** |
| 3 + 2 | FKs on, and `DROP TABLE` of, the two legacy tables | deliberate leftovers |
| 2 | indexes the schema does not declare | **DB right** |
| 1 | `driver_access_requests.triggeredBy` | **schema wrong, and code is broken** |

The 44 `DROP CONSTRAINT` / 37 `ADD CONSTRAINT` churn resolves cleanly: 37 are
drop-and-re-add of the same key under a different name, 3 belong to the legacy
tables, and 4 are the `tap_intents` keys below. Nothing is being genuinely
removed except by that last group.

---

## Finding 1 — `driver_access_requests` cannot be read by Prisma at all

**Severity: live breakage. Rule 5 territory — proposed, not applied.**

`DriverAccessRequest.triggeredBy` is the only field in its model with **no
`@map`**. Every sibling has one. So Prisma addresses a column named
`"triggeredBy"`; the database column is `triggered_by`.

Confirmed against the database rather than reasoned about — a real Prisma query
through the node client:

```
The column `driver_access_requests.triggeredBy` does not exist in the current database.
```

Every Prisma call touching this model fails at runtime. That is
`create`, `findFirst`, `findMany`, `groupBy`, `findUnique` and two `update`
paths in [`repositories/driver-access-requests.ts`](../../apps/api/src/repositories/driver-access-requests.ts),
plus [`routes/admin/access-requests.ts:166`](../../apps/api/src/routes/admin/access-requests.ts#L166)
and the driver self-request flow described at
[`routes/public/driver.ts:846`](../../apps/api/src/routes/public/driver.ts#L846).

The unit tests pass because they run against a hand-rolled fake, which has no
column names to get wrong. Nothing exercises this model against Postgres.

**The fix is one line**, in both schema files:

```prisma
triggeredBy  DriverAccessRequestTrigger  @map("triggered_by")
```

**Not applied.** `driver_access_requests` is access-grant resolution, and Rule 5
says stop and summarise first. What the change does: makes Prisma address the
column that exists. What breaks: nothing — the path is 100% broken today, so
there is no working behaviour to regress. Why it is correct: the database column
is `triggered_by`, matching every other column in the table and every other
field's `@map` in the model; the omission is a typo, not a decision.

**Worth deciding separately:** whether the driver access-request flow has ever
run in production. If it has not, that is a second finding — a shipped feature
nobody has exercised.

## Finding 2 — the 2026-08-03 audit's Finding 2 is stale, in the good direction

That audit called `charging.tap_intents` having **zero foreign keys** the
"cheapest high-value fix in the audit", noting the migration said
*"NOT YET APPLIED"*.

It has been applied. All four exist, with sensible delete semantics:

```
tap_intents_org_id_fkey              → tenancy.organizations(id)      ON DELETE RESTRICT
tap_intents_user_id_fkey             → identity.users(id)             ON DELETE CASCADE
tap_intents_charging_station_id_fkey → assets.charging_stations(...)  ON DELETE CASCADE
tap_intents_evse_id_fkey             → assets.evses(id)               ON DELETE SET NULL
```

The audit's concern — *"a deleted user leaves live intents that still authorise
a charge"* — is already closed by `ON DELETE CASCADE`.

What remains is only that **`prisma/schema/charging.prisma` does not declare
them**, which is why `migrate diff` offers to drop them. Declaring them costs
nothing and removes four lines from the drift.

*(The audit's separate point — that `org_id` is written but never filtered on in
the BLE resolver — is about query code and is untouched by this.)*

## Finding 3 — 21 column defaults exist only in the database

`gen_random_uuid()` and `now()` on `id` / `updated_at` across `agreements`,
`identity`, `charging`, `events`, `hardware`, `people` and `tenancy`. They came
from hand-written migrations; Prisma's `@default(uuid())` is client-side and
emits no DDL, so Prisma has never known about them.

This is the same split that bit the Drizzle port tonight, seen from the other
side: **the database's defaults are inconsistent because half the tables were
created by Prisma and half by hand.** `identity.users.id` has no default;
`identity.id_tokens.id` has `gen_random_uuid()`.

Recommendation: **keep them and declare them.** They are a safety net for
anything writing raw SQL (`lib/db/raw.ts`, the migration scripts,
`archive-watermark.ts`), and the new Drizzle declarations rely on them.

## Finding 4 — two undeclared indexes, one of which is a correctness guard

```
vendors.vendor_asset_refs_vendor_slug_vendor_asset_id_key   UNIQUE
tenancy.organizations_main_contact_user_id_idx
```

The first is a **unique constraint the schema does not know about**. It is
enforcing something — worth understanding before anyone regenerates from the
schema and quietly loses it. The second is an ordinary FK-column index.

## Finding 5 — the legacy tables

`charging.meter_values_legacy` and `events.event_log_legacy`, with three FKs
between them. Deliberate leftovers, already absent from the schema. Dropping
them is safe whenever someone wants the drift report shorter; there is no
urgency and no risk either way.

---

## Recommended sequence

All of it is schema-only. No migration, no staging window, no charger impact.

1. **`@map("triggered_by")`** — needs your go-ahead (Rule 5), one line, unblocks
   a broken feature.
2. Declare the four `tap_intents` relations.
3. Declare the 21 defaults, or record a decision not to.
4. Declare the two indexes.
5. Adopt the database's constraint and index names, or accept the rename churn
   as permanent noise in the diff.
6. Drop the two legacy tables whenever convenient.

After 1–4 the drift report is the rename churn plus the legacy tables, and
`migrate diff` becomes a check that can be believed again.
