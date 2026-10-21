# Wiring `check:migrations` into CI — proposal

**Status: proposal, awaiting Thor's decision. Nothing here has been created or
wired.** No Neon role exists, no GitHub secret exists, no workflow was changed.

## The problem

`npm run check:migrations` runs `prisma migrate status`, which needs a live
`DATABASE_URL`. `.github/workflows/check.yml` triggers on `push: branches: ["**"]`
and on `pull_request`. Adding `secrets.DATABASE_URL` there naively would put a
credential for the database holding all real Straumvakt data within reach of
every branch push and every PR.

That is the objection. It is a good one, but it is narrower than it looks, and
there is a clean way through.

## What the check actually needs

`prisma migrate status` compares the migrations directory against the
`_prisma_migrations` table. **It never writes, and it reads exactly one
table.** It does not read `charging.sessions`, `identity.users`, or anything
else. The credential it needs is therefore far smaller than "a database URL".

Confirmed by running it read-only against both staging and test on 2026-08-08:
row counts, recorded migrations and schema were byte-identical before and
after.

## Findings

### 1. Fork PRs already cannot reach secrets

GitHub: *"With the exception of `GITHUB_TOKEN`, secrets are not passed to the
runner when a workflow is triggered from a forked repository."*

So the exposure being worried about is **same-repository branches and PRs
only** — not the open internet. That materially shrinks the problem, though it
does not eliminate it: any branch pushed to this repo would still see the
secret.

### 2. Neon CAN produce a genuinely narrow credential — but only via SQL

This is the important finding, and it cuts against the obvious approach.

Neon: *"Roles created in the Neon Console, CLI, or API ... are granted
membership in the `neon_superuser` role."* That role carries `CREATEDB`,
`CREATEROLE`, `BYPASSRLS`, `REPLICATION`, **`pg_read_all_data`** and
**`pg_write_all_data`**.

**So creating the CI role through the Neon console or API would produce an
account with full read *and write* access to everything — the opposite of what
we want.** It would be strictly worse than reusing the existing credential,
because it would add a second admin credential rather than a limited one.

The alternative works: *"Roles created with SQL ... are only granted the basic
public schema privileges granted to newly created roles in a standalone
Postgres installation. These users must be selectively granted permissions for
each database object."*

That is exactly the primitive needed. Note also that Neon roles are
**branch-scoped**, and *"when you create a child branch, roles in the parent
branch are duplicated in the child branch"* — so creating it on `staging` means
it propagates to future `test` resets automatically.

### 3. GitHub Environments scope secrets to specific jobs *and* branches

GitHub: *"These secrets are only available to workflow jobs that use the
environment"*, and jobs *"can only access these secrets after any configured
rules (for example, required reviewers) pass."* Environments also support
deployment branch and tag rules that *"specify what branches and tags can
deploy to this environment"*.

So the secret can be fenced off twice: only a job that names the environment
can read it, and only from an approved branch.

### 4. `pull_request_target` is the wrong tool — it is worse, not better

It was worth checking, and the answer is unambiguous. GitHub describes these
workflows as *"privileged, which means they ... may have repository write
access and access to referenced secrets"*, warns *"Avoid using the
`pull_request_target` workflow trigger if it's not necessary"*, and states
plainly that *"These vulnerabilities can be exploited to take over a
repository."*

`pull_request_target` **grants** secret access to PR-triggered runs that
`pull_request` withholds. Using it here would widen the hole, not narrow it.
Discard this option.

### 5. Point at `staging`, not `test` — and `test` is the worst choice available

`test` looks tempting: lower stakes, disposable, and a leaked credential there
matters less. Reject it anyway.

The check exists to answer one question: *does the deploy target's migration
history match the repo?* Only `staging` is the deploy target. But the decisive
argument is sharper than that — **`test` is where migrations get applied
first.**

Tonight's evidence: commit `ff012bf` states *"Applied to the TEST branch;
staging pending."* Had CI been pointed at `test`, it would have gone **green on
2026-08-07 while staging had received nothing at all.** A check that goes green
before the thing it guards is not a weak check, it is an actively misleading
one — it would have concealed precisely the drift this whole exercise was about.

The two branches also genuinely diverge: as of 2026-08-08 staging carries three
`issues` enum types that `test` does not.

## Recommendation

Two tiers. The first needs no approval and no credential; the second is the
actual ask.

### Tier 0 — an offline guard, no credential, land it any time

The specific failure that made all of this invisible was *config*, not
database: `prisma.config.ts` had no `migrations.path`, so Prisma looked in
`prisma/schema/migrations` (absent) and reported "No migration found" +
"Database schema is up to date!" with exit 0.

**That regression is detectable with no database at all**, and therefore can
run on every branch and PR in the existing `check` job:

```ts
// scripts/check-migrations-visible.mts   (run with tsx)
import { existsSync, readdirSync } from "node:fs";
import cfg from "../prisma.config.ts";

const path = (cfg as unknown as { migrations?: { path?: string } }).migrations?.path;
if (!path) throw new Error("prisma.config.ts sets no migrations.path — Prisma will not find prisma/migrations");
if (!existsSync(path)) throw new Error(`migrations.path points at ${path}, which does not exist`);
const n = readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
if (n === 0) throw new Error(`${path} contains no migration directories`);
console.log(`ok — migrations.path=${path}, ${n} migrations visible to Prisma`);
```

Add as `"check:migrations-visible"` and include it in `npm run check`.

One implementation wrinkle to expect: `defineConfig` returns a branded opaque
type, so reading `.migrations.path` needs the cast shown above. Validate when
implementing.

This does not replace Tier 1 — it cannot see the database, so it cannot detect
unrecorded migrations. It closes the hole that hid them.

### Tier 1 — a scoped read-only role, for Thor to approve

**What to create — via SQL only** (Neon SQL Editor or psql; *not* the console,
CLI, or API, per finding 2). Values are Thor's to generate; nothing below
contains or requires a credential value:

```sql
-- On the staging branch (br-tiny-river-abgpqq37), database neondb.
CREATE ROLE ci_migrate_status WITH LOGIN PASSWORD '<generate: >=60 bits entropy>';

GRANT CONNECT ON DATABASE neondb        TO ci_migrate_status;
GRANT USAGE   ON SCHEMA   public        TO ci_migrate_status;
GRANT SELECT  ON TABLE public._prisma_migrations TO ci_migrate_status;
-- and nothing else. No other table, no INSERT/UPDATE/DELETE, no CREATE,
-- no neon_superuser membership, no pg_read_all_data.
```

**Validate before trusting it.** `prisma migrate status` is read-only in
observed behaviour, but whether the migrate engine also wants an advisory lock
or a `CREATE TABLE IF NOT EXISTS` on `_prisma_migrations` under a
minimally-privileged role has not been tested. Test it on a throwaway child
branch of staging first — child branches inherit parent roles, so the role can
be exercised there without touching staging. If it needs more, grant the
minimum that makes it pass and record what and why.

**How to wire it.** Not into `check.yml`. A separate workflow, so the
every-branch job keeps needing no secrets at all:

```yaml
# .github/workflows/migrations-check.yml
name: migrations-check
on:
  workflow_dispatch:
  push:
    branches: ["staging", "dev/drizzle-ownership-and-market-harvest"]
jobs:
  migrations:
    runs-on: ubuntu-latest
    environment: staging-readonly     # secret lives here, not at repo level
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install --no-audit --no-fund
      - run: npm run db:generate
      - run: npm run check:migrations
        env:
          DATABASE_URL: ${{ secrets.CI_MIGRATE_STATUS_URL }}
```

Then in repo settings, create environment **`staging-readonly`**, add
`CI_MIGRATE_STATUS_URL` as an *environment* secret (not a repository secret),
and set its deployment branch rule to the same branches listed above.

**Resulting blast radius.** If the credential leaks, the holder can read the
names and timestamps of migrations. They cannot read a single row of customer,
charger, session or billing data, and cannot write anything. Compare that to
the current `DATABASE_URL`, which owns the database.

### Sequencing

`check:migrations` exits **non-zero while migrations are pending**, and two are
pending on staging right now. Wiring Tier 1 before those are reconciled (see
`docs/notes/2026-08-08-staging-catchup-runbook.md`) makes the new workflow red
from its first run. Order: reconcile → create role → wire. Tier 0 has no such
dependency and can land immediately.

## Decisions for Thor

1. **Tier 0** — land the offline guard now? (No credential, no approval surface.)
2. **Tier 1** — approve creating `ci_migrate_status` via SQL on staging?
3. Which branches belong in the environment's deployment branch rule?
4. Confirm the answer to "point CI at `test` instead" is **no** — the reasoning
   in finding 5 is the load-bearing one, and worth disagreeing with explicitly
   if you see it differently.
