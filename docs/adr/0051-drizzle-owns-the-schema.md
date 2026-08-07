# ADR 0051 — Drizzle owns the schema

**Status:** Accepted · 2026-08-07 · **applied to the test branch**
**Unblocks** [ADR 0047](./0047-dissolving-installation.md),
[ADR 0049](./0049-the-cdr-is-the-record.md),
[ADR 0050](./0050-read-models-and-the-single-onboarding.md) — all three are
schema changes, and all three were blocked on this.

---

## The problem

Every structural decision on the books required editing Prisma. Not because
Prisma owned the runtime — it owned the **schema**: `prisma/schema/*.prisma`
was the source of truth, `scripts/drizzle-scaffold-from-prisma.mjs` drafted
the Drizzle declarations from it, and `check:schema-parity` guarded two
copies of the Prisma files against each other.

So "remove Prisma" and "change the database" were the same task, and neither
could start. That is backwards: the schema is not the ORM's to own.

## Decision

**`packages/shared/src/db/*.ts` is the source of truth. Migrations are
`drizzle-kit`.**

A schema change now reads:

```
edit packages/shared/src/db/<domain>.ts
npm run db:generate:sql          # drizzle-kit writes the delta SQL
read the SQL                     # it is reviewable, and it is small
apply it                         # test branch first, then staging
mirror into prisma/schema/       # until the last Prisma call is ported
npm run sync:api-schema
```

Prisma is downstream. `prisma/schema/` survives only because ~500 un-ported
calls need the generated client, and it is now a **mirror**, not a master.

## How the handover was done safely

drizzle-kit had never seen this database. Prisma created every table, so a
naive `drizzle-kit generate` diffs the declarations against an empty snapshot
and writes a migration that CREATEs all 66 tables — 1,187 lines, 248
statements. Running that would fail on the first table; a `push` would try to
*reconcile*, against a database 21 chargers write to continuously.

So: generate that migration, then **record it as applied without executing
it**. `apps/api/scripts/drizzle-baseline.mjs` writes the file's sha256 into
`drizzle.__drizzle_migrations` — the table shape and hashing copied from
`drizzle-orm/pg-core/dialect.js` so drizzle's own migrator agrees. It has a
`--verify` mode, because if drizzle-orm ever changes that contract this
stops matching silently.

**Proof it worked.** With the baseline recorded, adding one column produced:

```sql
ALTER TABLE "events"."archive_watermark" ADD COLUMN "proof_of_authority" text;
```

One line, not 1,187. That is the whole point of this ADR.

## `check:schema-parity` → `check:schema-consistency`

The old check ran `prisma migrate diff` between `prisma/schema` and
`apps/api/prisma/schema` — **two copies of the same file set**, one generated
from the other by `sync-api-prisma-schema.mjs`. It could only catch a stale
copy, which `check:api-schema` already catches.

The replacement compares **Drizzle against Prisma**: 66 tables, 782 columns,
no database required so it runs in CI where the parity suite cannot. That is
the divergence that can actually happen now, and it means the Prisma client
lying to the code still using it.

It found nothing real on first run, but it did surface two parsing traps
worth writing down, because a confident false report is worse than no check:

- **A 1:1 back-relation looks exactly like a column.** `modem Modem?` has no
  `@relation`, no `[]`, and no `@map`.
- **A scalar array IS a column despite the `[]`.** `roles String[]` is
  `tenancy.organizations.roles`, not a relation.

Both need the full model-name set, so the parser reads the schema twice.

## Consequences

- **The three blocked ADRs can proceed.** ADR 0047's FK repointing, ADR
  0049's CDR columns, ADR 0050's read model are now ordinary migrations.
- **`drizzle-kit push` is banned**, in the config banner and here. It diffs
  and reconciles in one step with no SQL to review. Generate, read, apply.
- `db:migrate` (`prisma migrate dev`) is gone. `db:generate:sql`,
  `db:baseline` and `db:migrate:status` replace it.
- `drizzle-kit generate` cannot serialise a BigInt literal —
  `.default(0n)` made it fail outright. Use `sql\`0\``.
- The baseline is applied to the **test branch only**. Staging needs the same
  two steps (generate is already done; run `db:baseline --apply`) and that is
  a shared-branch write, so it needs go-ahead.

## What this does not change

The port. ~500 Prisma calls still exist and still need translating, and the
parity harness still dies with them — anything not covered before that point
never will be. This ADR removes the constraint on the *database*, not on the
code.
