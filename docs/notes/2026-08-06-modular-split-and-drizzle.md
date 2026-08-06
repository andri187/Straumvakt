# Modular split and the first Drizzle domain — overnight, 2026-08-05/06

Five commits on `dev/p4-c-ingest-integrity`. Nothing deployed. No migration
against staging. No Prisma model, schema file or generated client deleted.

| | commit | CI |
|---|---|---|
| A1 + A1b | `ec2b86e` split the Prisma schema by domain, stop the two copies drifting | ❌ *(pre-existing break — see below)* |
| — | `6c08890` generate the API Worker's Prisma client so `check` passes on a clean runner | ✅ |
| A2 | `31605e1` enforce the domain boundaries instead of documenting them | ✅ |
| B1 | `7ab5cc6` Drizzle: identity tables declared, and a harness that checks they are true | ✅ |
| B2 + B3 | `1049e40` port users and id-tokens to Drizzle, in their domain home | ✅ |

---

## Read first: three things that were not as briefed

**1. `--from-schema` already takes a directory.** The brief said the parity
check would break because a schema folder needs `--from-schema-datamodel` in
Prisma 7. There is no such flag in 7.8 — `prisma migrate diff --help` lists
`--from-schema` as "Path to a Prisma schema file", and it accepts a directory
without complaint. The script needed a path change, not a flag change. Half an
hour of budgeted work that did not exist.

**2. CI on this branch had never been green — not once.** `gh run list` over
the full history of `dev/p4-c-ingest-integrity`: **25 failures, 0 successes**,
from the branch's first run on 2026-08-03 22:40 through 2026-08-06 09:23. The
four successes it now shows are all from tonight.

At least two distinct causes. The oldest run failed on
`Dependencies lock file is not found` — `actions/setup-node` with `cache: npm`
against a gitignored `package-lock.json`, which the workflow header says was
addressed by dropping the cache. The four most recent pre-session failures have
a different cause: `npm run db:generate` builds the console's two Prisma clients
and stops. `apps/api` imports `../generated/prisma/client`, which only
`npm --prefix apps/api run prisma:generate` produces, and CI runs `db:generate`
alone. On a clean Linux runner the API workspace typechecked against a client
that had never been generated — TS2307 on every import of it, then a cascade of
implicit-`any`. Locally it passed the whole time, because a developer machine
already has `apps/api/src/generated/prisma` lying around.

That is exactly the failure the workflow's own header warns about for the two
checks it was written to wire up. Fixed in `6c08890`; verified by deleting
`apps/api/src/generated` entirely and rebuilding from nothing. **The A1 commit
was pushed into an already-red CI and inherited the red — it did not cause it.**

The uncomfortable part is not the bug. It is that a branch carrying the OCPP
silence watch — a feature whose entire premise is that silent failures must be
made loud — ran red for three days without anyone reading it.

**3. The database is drifted from the schema, and was before tonight.**
`prisma migrate diff --from-config-datasource` produces a 212-line report:
two legacy tables the schema no longer declares, and a long list of altered
defaults, renamed indexes and re-added foreign keys across the agreements
schema. Untouched, and reported here only because the A1 verification had to
account for it. **Parked — needs a decision, see below.**

---

## A1 — the schema split

`prisma/schema.prisma`, 3,736 lines and 157 blocks, is now `prisma/schema/`:

| file | blocks | Postgres schemas |
|---|---|---|
| `identity.prisma` | 32 | identity · tenancy · people |
| `assets.prisma` | 22 | properties · assets · energy |
| `charging.prisma` | 9 | charging |
| `commercial.prisma` | 56 | billing · agreements · entitlements · reports |
| `vendor.prisma` | 9 | vendors · hardware |
| `protocol.prisma` | 13 | ocpp · roaming |
| `platform.prisma` | 16 | events · audit · issues · webhooks |

`hosts` is declared on the datasource and holds no models.

### Proof it is a pure reorganisation

Three independent checks, all run before the commit:

1. `migrate diff --from-schema <old file> --to-schema <new folder>` →
   **No difference detected.**
2. The full `CREATE` script from empty is **identical as a multiset of
   statements** — 2,304 lines, `sort`ed and `diff`ed to nothing. Only the
   emission order moves, because a schema folder merges in filename order.
3. `migrate diff --from-config-datasource` produces a **byte-identical
   212-line drift report** before and after.

### Judgement calls worth flagging

Two of the twenty Postgres schemas do not have an obvious domain home, and
both are worth a second opinion:

- **`reports` → commercial.** `session_ledger` and `billing_period_summary`
  clearly belong there, but `site_energy_daily` and `charger_uptime_daily` are
  asset rollups sitting in the commercial file. They cannot go in `platform`,
  which imports nothing, and they do reference charging and assets — so
  commercial is dependency-legal but semantically loose.
- **`roaming` → protocol.** OCPI is a protocol, alongside OCPP. But
  `cdr_queue_entries` is a billing record by any other name.

Neither affects behaviour. Both are one `git mv` of a block away.

### A1b — the two schemas cannot drift again

`apps/api/prisma/schema/` is now **generated** from `prisma/schema/` by
`scripts/sync-api-prisma-schema.mjs`. The only hand-written file on the API
side is `apps/api/prisma/header.prisma`, holding its generator block — even
the datasource is lifted from the console schema, so the two cannot describe
different databases. `npm run check` fails if the tree is stale.

They had drifted **twice**. `ArchiveWatermark` went missing and was found by
the 2026-08-03 audit; then the vendor-auth columns landed on the root side
only. The second drift was **sitting uncommitted in the working tree** when
this session started — someone's in-flight hand-copy of a +20-line change.
Generating the API side resolved it rather than copying it across by hand a
third time.

---

## A2 — the boundaries are enforced now, not documented

`dependency-cruiser` runs in `npm run check`:

```
commercial → charging → assets → identity   layering, one way
nothing may import vendor                   an adapter stays at the edge
platform imports nothing                    logs, audit, webhooks are a leaf
no cycles
no devDependency in shipping code
the console must not reach into the API Worker's internals
```

**Prisma cannot express any of this.** A relation is declared on both sides,
so the schema-level dependency graph is necessarily symmetric — measured, and
every single cross-schema edge appears in both directions. The rule lives in
TypeScript or nowhere.

**24 violations recorded in `.dependency-cruiser-known-violations.json`, not
fixed.** 22 are the Zaptec path: routes and repositories importing
`lib/zaptec.ts`, `credential-crypto.ts` and the vendor-credential repositories
directly. One is a genuine cycle in the console, between the org email-domains
page and its panel. One is the transitional import this session introduced
(below). Grandfathered, not accepted — a new one fails the build.

The rules match **both** layouts at once: the target
`src/domains/<domain>/` and today's flat `src/repositories`, `src/routes`,
`src/lib`. So they keep working while files move, rather than switching on
whatever day the move finishes.

`docs/architecture/dependency-graph.md` is a **generated** artefact — mermaid,
so it renders on GitHub without graphviz — with `--check` wired into
`npm run check`. A hand-drawn architecture diagram is a claim; this is a
measurement, and it goes stale as a diff rather than as folklore.

---

## B — Drizzle, identity

### What landed

```
apps/api/src/domains/identity/
  schema.ts                       15 tables, 17 enums, 3 Postgres schemas
  repositories/users.ts           ported from src/repositories/users.ts
  repositories/id-tokens.ts       ported, + its 12 unit tests
  repositories/errors.ts          the error boundary Prisma used to be
  routes/admin-users.ts           moved from src/routes/admin/users.ts
  routes/admin-id-tokens.ts       moved
  routes/admin-memberships.ts     moved
apps/api/src/lib/drizzle.ts       per-request client, node-postgres/Hyperdrive
apps/api/test/parity/             the harness
scripts/drizzle-scaffold-from-prisma.mjs
```

Additive. Prisma still owns all 157 models, still generates both clients,
still runs every other repository.

### The route-path diff is empty

```
$ diff routes-before.txt routes-after.txt
$ echo $?
0
```

44 `app.route(` mounts before, 44 after, **byte-identical including the line
numbers**. The mobile app's 6 driver endpoints and the console's admin routes
are untouched.

### What the parity harness proved — and what it caught

**Structural, 60 assertions** (`identity-schema.test.ts`): every table found
at the right schema, every column declared and no column invented, every type
and nullability agreeing with `information_schema`, and every NOT NULL column
having *someone* who supplies a value.

**Behavioural, 11 assertions** (`identity-repositories.test.ts`): six ported
functions run under Prisma and Drizzle against the same rows and must agree on
shape and content. The Prisma side is the old implementation **inlined**, not
imported — importing the new one under a different name would prove nothing.

It caught two things that would otherwise have shipped.

**1. `tenancy.organizations.roles` is nullable and Prisma says it is not.**
Prisma types it `OrganizationRole[]`, which is never null in its client. The
column has permitted NULL since the 2026-05-01 `org_profile_iceland_reshape`
migration dropped `roles` and re-added it as `roles_new` **without the NOT NULL
it previously carried** (`migration.sql:89`). The two `uuid[]` columns on
`tenancy.memberships` kept theirs, so it is a one-off slip, not how Prisma
emits array columns.

Harmless today — 0 of 19 organisations on staging have NULL, and the
`ARRAY[]::"OrganizationRole"[]` default still applies. But nothing prevents
one, and the first row that gets NULL makes Prisma's type a lie at that row.
The Drizzle declaration matches the **database**. *Restoring the constraint is
a staging migration — parked, see below.*

**2. Half these tables have no database default for `id`.** Prisma's
`@default(uuid())` is **client-side** and emits no DDL default, so
`identity.users.id` and `tenancy.organizations.id` have none at all — while
`identity.id_tokens.id` has `gen_random_uuid()` because that migration was
written by hand. Leave `id` to the database and exactly half the identity
tables reject every insert on a NOT NULL, at runtime, on the write path, with
the typechecker perfectly happy. `@default(now())` behaves the opposite way
(genuinely database-side), and `@updatedAt` is client-side on insert *and*
update with no trigger anywhere. Three attributes, three different answers,
nothing in the DDL to tell them apart.

The structural test now asserts both directions: a NOT NULL column with no
supplier fails, and a column *claiming* a database default the database does
not have fails too.

### The harness has been made to fail

A green harness that has never failed is not known to work. Two deliberate
regressions, both caught:

| mutation | result |
|---|---|
| `leftJoin` → `innerJoin` on `user_credentials` | 3 tests fail, one reporting *"users disappeared — user_credentials is joined too strictly: expected 4 to be 8"* |
| drop the `status != 'deleted'` filter | 1 test fails |

### The fixtures exist because the harness was passing vacuously

The test branch held **3 users, 1 membership and 2 id_tokens**. The
deleted-user filter, the NULL-hash credential, the `virtual_rfid`-first
partition and the multi-org cases all looped **zero times**. 71 green
assertions over an empty table is not evidence.

`test/parity/fixtures/identity.sql` seeds exactly those cases — idempotent,
fixed UUIDs, `@parity.test` addresses, test branch only. The `innerJoin`
mutation above only produces its 4-vs-8 diagnostic *because* the fixtures are
there.

### Behaviour that had to be handled rather than inherited

- **Error codes.** Prisma raised P2002/P2025 and five call sites matched on
  `err.message.includes("Unique constraint")` — a string node-postgres never
  produces. Left alone, a duplicate email goes from 409 to 500 silently. Now
  `UniqueViolationError` / `RecordNotFoundError`, with SQLSTATE detection
  (23505, 23503) in one file.
- **DELETE of a missing row.** Prisma raised P2025 and the route returned 404;
  SQL makes it a silent no-op. `RETURNING` restores the difference.
- **Two pre-existing Rule 7 violations.** The password routes reached into
  `db.user` and `db.userCredential` directly. Moving them into the domain was
  the moment to give them a repository instead of carrying it over.
- **One deliberate improvement**, called out because it is the only one:
  `PATCH /users/:id` with a taken email was a 500 (nothing caught P2002). It is
  now the 409 the POST already returned.

### The transitional cost, stated

`admin-users.ts` opens **both** clients on one handler. The identity reads are
Drizzle; `listAgreementMembershipsForUser` is still Prisma, because commercial
must not be touched while ADR 0025 D1–D5 are unanswered. That is one extra
Hyperdrive checkout on two handlers.

dependency-cruiser was extended to name the legacy commercial modules so the
layering rule bites **today** rather than whenever commercial moves — it caught
this import immediately, and it is violation 24 of 24 in the baseline. The rule
existing but not firing until a year from now would have been decoration.

---

## Bundle size — it went UP, and that is expected

Measured with `npx wrangler deploy --dry-run --outdir`.

| | raw | gzip |
|---|---|---|
| before (`c7156e1`) | 6,698.06 KiB | 1,801.19 KiB |
| after (`1049e40`) | **6,955.20 KiB** | **1,848.17 KiB** |
| delta | **+257 KiB** | **+47 KiB** |

**This is not a regression and it is not a reduction.** Prisma is still
installed, still generating a 16 MB client, and still bundled in full; Drizzle
is now bundled alongside it. Two ORMs weigh more than one. Removing Prisma is
deliberately out of scope, so the baseline stands until it happens.

(The brief cited 6,650 KiB / 1,790 KiB. The 6,698 KiB measured at `c7156e1`
is the same figure plus a few commits of ordinary drift.)

### The number worth extrapolating from

Each path bundled in isolation with esbuild, minified, same `node_modules`:

| | raw | gzip |
|---|---|---|
| `pg` alone — the floor both share | 79.6 KiB | — |
| **Drizzle identity path** — `drizzle-orm` + 15 tables + 2 repositories + `pg` | **189.1 KiB** | **52.0 KiB** |
| **Prisma client path** — `makePrisma` and nothing else | **6,302 KiB** | **2,045 KiB** |

Netting out the shared `pg` floor: **109.5 KiB of Drizzle against 6,223 KiB of
Prisma.** A factor of **56.9×** on the ORM layer, for a domain that is 1 of 7
and 15 tables of 157.

That is a projection from one domain, not a promise. What it does establish is
that the remaining six domains' declarations are cheap — table declarations are
data, and the `drizzle-orm` runtime is already paid for once. The 6 MB does not
leave until Prisma does.

---

## The OCPP silence watch — it is happening right now, and it has not fired yet

The operator disabled OCPP cloud in the Zaptec portal and expected the fleet to
disconnect. **It began at 10:27 UTC on 2026-08-06.**

Measured against `events.protocol_log` on staging at 10:56 UTC:

| | |
|---|---|
| steady state, previous 18 hours | ~1,050–1,140 frames/hour, 18–19 identities |
| **17 chargers fell silent between** | **10:27:38 and 10:28:31 UTC — a 53-second window** |
| newest frame anywhere | 10:28:31 UTC |
| silent for, at time of writing | 28–29 minutes |
| detector threshold | **45 minutes** |

**53 seconds for seventeen chargers.** In May it was thirteen within fifty. The
signature is identical, and this time it is a change someone made on purpose.

At 10:56 the watch has **not** fired, and should not have — the threshold is 45
minutes and nothing has been silent that long. On the current trajectory
`[ocpp-silence] FLEET-WIDE` should appear on the first cron tick after roughly
**11:13 UTC**.

Three chargers were already silent before this: 84 minutes, 685 minutes and
2,988 minutes (since 2026-08-04 09:08). Those predate the portal change and are
separate — worth a look, but not tonight's story.

**Confirm the log line landed.** The detector's first real test is in progress
and the evidence for the last 45 minutes of it is in Cloudflare logs, which
this session cannot read (the Cloudflare MCP servers need an interactive OAuth
that a headless run cannot do). Everything above is from the database.

---

## Parked — each needs a decision

**P1. `tenancy.organizations.roles` should be NOT NULL again.**
One `ALTER TABLE ... SET NOT NULL` after a `SET roles = '{}' WHERE roles IS
NULL` (which currently matches 0 rows). Blocked only because it is a migration
against staging with 21 chargers writing. *Needs: go-ahead to run it.*

**P2. The database is 212 lines drifted from `prisma/schema/`.**
Two dropped legacy tables plus a wide set of altered defaults, renamed indexes
and re-added FKs across `agreements`. Pre-existing and unrelated to tonight.
*Needs: a decision on whether the schema or the database is right — they
disagree in both directions, so it is not a single `migrate deploy`.*

**P3. Identity is one-fifth ported.** Two of roughly a dozen identity
repositories are on Drizzle. `orgs.ts`, `invites.ts`, `host-invites.ts`,
`registration.ts` (671 lines), `create-driver.ts`, `admin-bootstrap.ts`,
`host-applications.ts`, `org-email-domains.ts`, `family-groups.ts`,
`vehicles.ts`, `user-tokens.ts` are not. **Stated plainly: the brief said "port
identity" and identity is not fully ported.** What is ported is proven; the
rest is the same mechanical work with the traps now known and the harness
already built.

**P4. `org-email-domains.ts` cannot be ported without a decision.** It joins
`tenancy.org_email_domains` to `agreements.driver_groups` for a display name —
identity reaching into commercial, which the layering rule forbids. Options: a
denormalised name, a domain service above both, or accept it as a documented
exception. *Needs: which one.* Encouraging that the rule found this on its
first day rather than after the port.

**P5. `reports` and `roaming` domain placement**, above.

**P6. Nothing has been deployed and no staging migration was run.** Both
require asking, per the brief.

---

## Already built, nobody knew — the list moves from nine to eleven

**10. `check:schema-parity` was already failing, and no one could see it.**
The 2026-08-03 audit found it existing-but-never-called and wired it into CI.
What was missed is that it was *red at `c7156e1`* — running it against the two
committed schemas at that commit reports three missing columns
(`vendor_auth_required`, `vendor_auth_seen_at`, `vendor_authentication_type`).
It never got the chance to say so: `check` is an `&&` chain and `typecheck`
died first, so the run ended before parity was reached. **A check that exists,
runs, and is correct can still be invisible if it sits behind a broken one.**
Fixed as a side effect — the API schema is generated now, so the drift is gone
and parity passes for a structural reason rather than a lucky one.

**11½. The parity harness typechecked nowhere, on the night it was written.**
`apps/api/tsconfig.json` has `"include": ["src/**/*.ts", ...]`, and the harness
lives in `test/parity/`. It ran under vitest, which transpiles without type
checking, so `npm run check` was green while a whole directory went unverified
— the third instance tonight of a check that exists and silently does not run.
Fixed with `apps/api/tsconfig.test.json`, wired into the workspace's
`typecheck`. A separate config because the harness is Node and needs
`@types/node`, while the Worker deliberately restricts `types` to
`@cloudflare/workers-types`; both together typecheck clean.

**11. `apps/api/prisma/generated/` is gitignored and nothing generates it.**
It holds a `node-client` directory last written 2026-06-04. The API's client
goes to `src/generated/prisma`; this is a leftover from a layout that no longer
exists. Harmless, left alone, recorded so the next person does not go looking
for what fills it.

---

## Verification, run before every commit

| gate | result |
|---|---|
| `npm run typecheck` (all workspaces + gateway, now including the harness) | clean |
| `npm run check:schemas` | both valid |
| `npm run check:api-schema` | in sync, 8 files |
| `npm run check:schema-parity` | No difference detected |
| `npm run check:deps` | 0 new, 24 known ignored |
| `npm run check:deps-graph` | up to date |
| `cd apps/api && npx vitest run` | **649 passed / 1 skipped** — the baseline, unchanged |
| `npm --prefix apps/api run test:parity` | **71 passed** (60 structural + 11 behavioural) |

CI checked from the dev workstation after every push. Green from `6c08890`
onward — **the first green runs this branch has ever had**, against 25 prior
failures going back to its first run on 2026-08-03.
