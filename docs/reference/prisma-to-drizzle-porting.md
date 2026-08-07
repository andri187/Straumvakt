# Porting a repository from Prisma to Drizzle

Every trap in this document cost something to find. Ten files were ported on
2026-08-06; the parity harness caught four defects and two of them were things
I had asserted the opposite of in a comment. Read this before the eleventh.

## The shape of what is left

Measured 2026-08-06 across `apps/api/src` (source only, tests excluded):

| | |
|---|---:|
| queries | **571** |
| …in files with **no** `include` — mechanical rewrites | **423** (74%) |
| `include:` trees — where the join decisions live | **49**, in 16 files |
| `$transaction` uses | **51**, in 24 files |
| files using raw SQL | 3 |
| `select:` blocks | 523 |

**Three quarters of the work is mechanical.** The cost concentrates in 16
files with joins and 24 with transactions. And the 523 `select:` blocks are a
gift, not a cost — each one already enumerates its columns, which is exactly
what Drizzle's `.select({...})` wants.

---

## 1. `include` → join, and the direction matters

Prisma's `include` is a LEFT JOIN when the relation is optional and an INNER
JOIN when it is required. Drizzle makes you say which.

```ts
// Prisma
db.user.findMany({ include: { credentials: true } })

// Drizzle
db.select(COLUMNS).from(users)
  .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
```

**Get this wrong and rows vanish silently.** `innerJoin` on
`user_credentials` drops every user who has never set a password — the parity
harness reported *"users disappeared: expected 4 to be 8"*. Nothing else
would have.

Rule: **optional relation → `leftJoin`. Required relation → `innerJoin`.**
Check the Prisma model, not the query.

## 2. `_count` → correlated subquery, never GROUP BY

```ts
// Prisma
include: { _count: { select: { members: true } } }

// Drizzle
memberCount: sql<number>`(
  select count(*)::int from ${familyMemberships}
   where ${familyMemberships.familyGroupId} = ${familyGroups.id}
)`
```

A `LEFT JOIN … GROUP BY` is the obvious translation and it is wrong twice: it
changes the row shape for any other joined columns, and **it drops rows with a
count of zero**. The fixtures deliberately contain a group with two members,
one with one, and one with none, because a single one-member group cannot tell
a correct subquery from a constant.

`count(*)` is `bigint`; node-postgres returns it as a **string**. Cast
`::int`.

## 3. Decimal: Prisma normalises, Postgres does not

`numeric(6,2)` holding `77.40` comes back from Postgres as `"77.40"`. Prisma
parsed it to a Decimal and `.toString()` gave `"77.4"` — and that is what
clients have been receiving for months.

Use `normaliseDecimalString()` from `lib/decimal.ts`. It is textual on
purpose: `String(Number(x))` gives the same answer here and quietly loses
digits on a wider column, and money in this codebase is BigInt minor units
precisely to avoid float round-trips.

## 4. Error codes: P2002 / P2025 do not exist any more

Five call sites matched on `err.message.includes("Unique constraint")`, a
string node-postgres never produces. Left alone, a duplicate email goes from
409 to 500 and nothing catches it.

| Prisma | Postgres | use |
|---|---|---|
| P2002 unique | SQLSTATE **23505** | `isUniqueViolation()` → `UniqueViolationError` |
| P2003 foreign key | SQLSTATE **23503** | `isForeignKeyViolation()` |
| P2025 not found | *nothing* — see below | `RecordNotFoundError` |

All in `domains/identity/repositories/errors.ts`.

## 5. A missing row is not an error in SQL

Prisma's `update`/`delete` threw P2025 when nothing matched, and routes turned
that into a 404. SQL updates zero rows and reports success.

```ts
const deleted = await db.delete(idTokens).where(eq(idTokens.id, id))
  .returning({ id: idTokens.id });
if (deleted.length === 0) throw new RecordNotFoundError(`id_token ${id}`);
```

**Every ported `update` or `delete` that had a 404 path needs `.returning()`.**

## 6. Defaults come from three different places

This is not uniform and the trap is silent — a NOT NULL column with no
supplier fails at runtime while the type checker is happy.

| Prisma | where the value comes from | Drizzle |
|---|---|---|
| `@default(uuid())` | **client** — emits no DDL default | `.$defaultFn(() => crypto.randomUUID())` |
| `@default(now())` | **database** — emits `CURRENT_TIMESTAMP` | `.defaultNow()` |
| `@updatedAt` | **client**, on insert *and* update | `.$defaultFn(…).$onUpdateFn(…)` |

`identity.users.id` has **no** database default; `identity.id_tokens.id` has
`gen_random_uuid()` because that migration was hand-written. Half and half,
with nothing in the DDL to tell them apart.
`test/parity/domain-schemas.test.ts` asserts both directions.

## 7. Enum ordering is declaration order

`orderBy: { status: "asc" }` on a Postgres enum sorts by the order the values
were declared — `active, suspended, deleted` — not alphabetically. Plain
`ORDER BY status ASC` gives the identical result, so this needs **no**
handling. It is listed because it looks like it does, and "fixing" it
introduces a bug.

## 8. `not` → `ne`, but check nullability first

`where: { status: { not: "deleted" } }` becomes `ne(users.status, "deleted")`
— safe **only because the column is NOT NULL**. On a nullable column
`<> 'x'` silently drops NULL rows and Prisma's `not` does not.

## 9. `$transaction` → `db.transaction`

51 uses across 24 files. The callback receives a `tx` that must be threaded
into every helper — the same discipline as before, but the type differs, so
shared helpers need `Db | Transaction`:

```ts
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
```

`UPDATE … RETURNING` cannot reach a joined table. If the mapper needs a
joined column after a write, issue a second read — Prisma did too.

## 10. Two generated clients, nominally incompatible

`prisma/generated/node-client` (Node) and `apps/api/src/generated/prisma`
(Cloudflare runtime) are structurally identical and different types, and the
Cloudflare one cannot be instantiated under Node. The parity harness uses the
Node one and casts once, in `_harness.ts`, with the reason written down.

## 11. Mocks name a module path

`vi.mock("../prisma")` stops applying the moment the file under test imports
`../drizzle`. It does not fail loudly — the real factory runs, reads
`env.HYPERDRIVE_DB.connectionString` off a bindingless test Env, and the
assertion goes from 403 to **500**.

**Grep for `vi.mock` naming a client factory before porting anything it
covers.** Ten test files still do.

---

## The order to do it in

1. **Declare nothing.** All 98 tables are already in
   `packages/shared/src/db/` and verified against `information_schema`.
2. **Port the repository**, not the route. Routes only change which factory
   they call.
3. **Move it to its domain** in the same commit — the topmost domain it
   touches, under `commercial → charging → protocol → assets → identity`,
   with `vendor` taking precedence since nothing may import it.
4. **Write the parity comparison** with the old Prisma implementation
   *inlined*, not imported. Importing the new one under another name proves
   nothing.
5. **Seed fixtures if the table is empty.** A green comparison over an empty
   table is not evidence — this has already happened twice.
6. **Break it on purpose once.** Every guard in `test/parity/` has been made
   to fail deliberately. One that never has is not known to work.

## What not to touch

- **`lib/billing/*`, `lib/agreement/*`, and the commercial repositories.**
  ADR 0025 D1–D5 are unanswered and three billing generations coexist.
- **`lib/ocpp/projections.ts`** — OCPP handler semantics, Rule 5.
- **Anything reading `enforceAuthorize`** — charger behaviour, needs sign-off.
