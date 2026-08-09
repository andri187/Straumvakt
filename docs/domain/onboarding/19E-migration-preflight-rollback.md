# Appendix 19E — migration, preflight and rollback

**40 checks**, `MP-01`–`MP-40`. The brief asked for 25.

**No SQL in this document was executed.** Every query below is a
specification. Preflights return **counts**, never rows — a preflight that dumps
customer rows into a terminal is a data incident, not a check.

Three structural facts, verified in source:

- **Two migration systems.** `prisma/migrations` has 47 directories plus
  `migration_lock.toml`; `apps/api/drizzle/meta/_journal.json` has 2 entries.
- **Only Prisma is checked**, and that check is deliberately excluded from CI
  with a documented rationale (`check.yml:10-44`): it needs a live
  `DATABASE_URL`, no such secret exists, the workflow triggers on every branch
  and PR, and two migrations pending against staging would turn CI red
  immediately.
- **Those two pending migrations are named:**
  `20260807003000_drop_issues_scaffold` and
  `20260807120000_drop_never_used_tables` — both already applied by hand,
  neither recorded.

Several checks below are **irreversible by construction**. PostgreSQL has no
`DROP VALUE` for an enum, so every `ALTER TYPE … ADD VALUE` in this packet is
one-way. `MP-05` exists to force the full value list to be decided in a single
commit rather than discovered across three.

---

## 19E — Migration, preflight and rollback checks

**No SQL in this document was executed.** Every statement below is a *specification* of
what to run, written to be read and approved before anyone connects to a database.
Nothing here was run against test, staging or production; no connection was opened
during authoring. All counts are `SELECT count(*)` by design — this document never
specifies a row dump, and any check that would return personal data, a token, a hash
or a connection string is written as a count or a boolean instead.

### The migration situation these checks assume

Two migration systems describe one database, and only one of them is authoritative.

- **Prisma**: `prisma/migrations/` holds **47 migration directories** plus
  `migration_lock.toml` (`provider = "postgresql"`). Latest on disk is
  `20260807120000_drop_never_used_tables`. Prisma is downstream as of ADR 0051 —
  `apps/api/drizzle.config.ts:3-18` states it — but still generates the client that
  ~500 un-ported calls use, so `prisma/schema/` must be kept true.
- **Drizzle**: `apps/api/drizzle/meta/_journal.json` has **2 entries** —
  `0000_baseline` (1187 lines, every `CREATE SCHEMA` / `CREATE TABLE`, recorded as
  applied without running, via `apps/api/scripts/drizzle-baseline.mjs`) and
  `0001_regular_talos`, whose entire body is one statement:
  `ALTER TYPE "agreements"."RateBasis" ADD VALUE 'per_connector';`
- **Correction to the brief:** `per_connector` has **no Prisma migration** (grep of
  `prisma/migrations/` returns nothing) but it *does* have a Drizzle migration —
  `apps/api/drizzle/0001_regular_talos.sql`. It is declared at
  `prisma/schema/commercial.prisma:406`, `apps/api/prisma/schema/commercial.prisma:416`
  and `packages/shared/src/db/commercial.ts:46`. Whether `0001` has been *applied* to
  any branch is **unverified** here. If it has not, a `prisma migrate dev` would
  generate a second, competing `ALTER TYPE`.
- **`check:migrations` is `prisma migrate status --schema prisma/schema`** and covers
  Prisma only. It needs a live `DATABASE_URL`, is deliberately **excluded from CI**
  (`.github/workflows/check.yml:1-44` explains why: the only secret any workflow
  references is `FLY_API_TOKEN_ZAPTEC_CONSUMER`, and this workflow triggers on
  `push: **`), and it only started telling the truth on 2026-08-08 when
  `migrations.path` was added to `prisma.config.ts:57`. Before that it answered
  "No migration found" then "Database schema is up to date!" and exited 0.
- **Two migrations are pending against staging today** and would make
  `check:migrations` exit non-zero the moment it were wired in:
  `20260807003000_drop_issues_scaffold` and `20260807120000_drop_never_used_tables`.
  The first one's header records that its three `DROP TABLE`s are already moot (the
  second migration dropped the same three among its 32) but its three `DROP TYPE`s —
  `issues."IssueStatus"`, `issues."IssueSeverity"`, `issues."IssueSubject"` — are
  genuinely outstanding **on staging only**; on test they are already gone.
- **CI runs no tests.** `npm run check` is `scripts/check-all.mjs`, nine offline
  checks (typecheck, schemas, api-schema, schema-consistency, deps, deps-graph,
  api-endpoints, unused-exports, work-view). None is vitest.
- **There is no read-only probe gap:** `apps/api/scripts/probe-migration-state.ts`
  already exists and is explicitly "Read-only probe of migration state vs actual
  schema. No writes." It queries `_prisma_migrations` unqualified (default
  `search_path`), `information_schema.tables`, `pg_type` and `pg_enum`. Most of the
  preflight checks below are extensions of that script's shape, not new machinery.

Owners: **DBA** = whoever holds the staging credential and executes against Neon;
**Claude B/release-ops** = deploy sequencing and flag/kill-switch operation;
**backend** = code changes required before a check can pass.
Neon branch discipline (staging `br-tiny-river-abgpqq37`) is a precondition for every
`preflight` and `verify` item, not a check in itself.

---

### Preflight — count queries only

**MP-01** — Prisma migration ledger matches the 47 directories on disk
**Phase** preflight · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** `SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;` — same table and predicate shape `apps/api/scripts/probe-migration-state.ts:12-17` already reads. Compare to the directory count under `prisma/migrations/` (47 today, excluding `migration_lock.toml`). Do not select `migration_name` in bulk; if a name is needed, take `count(*)` per name.
- **Expected:** 45 applied against staging, with exactly the two names from MP-02 absent. · **If it fails:** if the applied count is *higher* than the directory count, someone applied a migration from another branch — stop the release and diff branches before anything else. If lower by more than two, do not run `migrate deploy`; escalate to Andri, because the delta is not the known pair.

**MP-02** — the two known-pending migrations are still exactly two, and still those two
**Phase** preflight · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** `npm run check:migrations` with `DATABASE_URL` pointed at staging (`prisma migrate status --schema prisma/schema`). This is a status read, not a write. Then, for the enum half: `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'issues' AND t.typname IN ('IssueStatus','IssueSeverity','IssueSubject');`
- **Expected:** exactly two pending — `20260807003000_drop_issues_scaffold` and `20260807120000_drop_never_used_tables` — and the enum count is 3 on staging, 0 on test. · **If it fails:** a third pending name means an unreviewed migration reached the branch; block the release. An enum count of 0 on staging means someone dropped the types by hand and `migrate resolve --applied` is now the correct reconciliation instead of `migrate deploy` — record which was used, because the two are not interchangeable (the migration's own header says resolving without running "would record something untrue").

**MP-03** — Drizzle ledger matches the 2-entry journal
**Phase** preflight · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** `node apps/api/scripts/drizzle-baseline.mjs --verify` (the script's documented read path; `--apply` is the writing path and is NOT used here). It recomputes `sha256` of each file in `apps/api/drizzle/` and compares against `drizzle.__drizzle_migrations`. Equivalent count form: `SELECT count(*) FROM drizzle.__drizzle_migrations;`
- **Expected:** 2, and both hashes match `0000_baseline` and `0001_regular_talos`. · **If it fails:** count 1 means `0001` (the `per_connector` `ALTER TYPE`) has never been applied — go to MP-04 and decide there which system applies it; do NOT let `drizzle-kit generate` run first, because it will diff against the snapshot and may emit a second `ALTER TYPE`. A hash mismatch means a committed migration file was edited after application — treat as a code incident, not a migration one.

**MP-04** — `per_connector` presence in the live `agreements.RateBasis` enum
**Phase** preflight · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** `SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'agreements' AND t.typname = 'RateBasis' AND e.enumlabel = 'per_connector';` — same join shape as `probe-migration-state.ts:41-48`.
- **Expected:** 1 after `0001_regular_talos` has been applied; 0 before. Either is acceptable *as long as it agrees with MP-03*. · **If it fails:** disagreement between MP-03 and MP-04 (ledger says applied, enum says absent, or vice versa) means the Drizzle ledger is lying. Do not proceed. The recovery is to apply the single statement explicitly and re-baseline, with Andri's go-ahead, never `drizzle-kit push` (`apps/api/drizzle.config.ts:14-17` forbids it against a database 21 chargers write to).

**MP-05** — no accidental re-creation of the 32 dropped tables
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** yes
- **Check:** `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'billing' AND table_name IN ('invoice_lines','invoices','statements','billing_transactions','subscriptions','customer_plans','contract_factor_assignments','contract_period_accumulators','driver_contract_factor_overrides');` and the same shape for the `issues` set (`ticket_events`, `tickets`, `detection_rules`).
- **Expected:** 0 in both schemas on staging and test. · **If it fails:** a table came back, which means some tool reconciled the schema against a stale declaration — almost certainly `drizzle-kit push` or a `prisma db push`. Stop, identify the tool, and re-read `prisma/migrations/20260807120000_drop_never_used_tables/migration.sql:31-33` ("this statement is not reversible") before deciding anything.

**MP-06** — password-credential baseline, taken as counts, never as rows
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** yes
- **Check:** `SELECT count(*) FROM identity.user_credentials;` and `SELECT count(*) FROM identity.user_credentials WHERE password_hash IS NOT NULL;` Record both numbers in the release ticket. Never select `password_hash`, not even a prefix, not even a length.
- **Expected:** two integers, recorded. The second is the number that MP-25 defends. · **If it fails:** if the two numbers are equal, note it — `password_hash` is nullable (`packages/shared/src/db/identity.ts:215`) and `clearUserPasswordHash` (`apps/api/src/domains/identity/repositories/users.ts:381-386`) nulls the column while keeping the row, so equality means no admin has ever cleared one. That is information a guard written as "does a credential row exist" needs; it must test `password_hash IS NOT NULL`.

**MP-07** — membership baseline by status
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** yes
- **Check:** `SELECT status, count(*) FROM tenancy.memberships GROUP BY status;` — status values come from the enum on `packages/shared/src/db/identity.ts:323`. Also `SELECT count(*) FROM tenancy.memberships;` for the total.
- **Expected:** a small fixed table of counts, recorded. · **If it fails:** an unexpected status value means the enum changed under you. Block, and reconcile the Drizzle enum against the live `pg_enum` before any membership-touching migration.

**MP-08** — session ledger baseline (row count, priced count, attributed count)
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** yes
- **Check:** three counts against `reports.session_ledger` (`packages/shared/src/db/commercial.ts:227-251`): `count(*)`; `count(*) WHERE cost_isk_minor IS NOT NULL`; `count(*) WHERE driver_user_id IS NOT NULL`.
- **Expected:** three integers, recorded. On staging the third is expected to be small — the source records 1,619 completed sessions with 8 carrying a `userId` (`apps/api/src/lib/agreement/billing-tick.ts:62-87`). · **If it fails:** if the priced count is less than the row count by more than the known unpriced tail, do not start a pricing migration — an unpriced backlog plus a resolver change is two variables at once.

**MP-09** — agreements billing-lines baseline
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** no
- **Check:** `SELECT count(*) FROM agreements.billing_lines;` and `SELECT count(DISTINCT session_id) FROM agreements.billing_lines WHERE session_id IS NOT NULL;`
- **Expected:** the two numbers, recorded. Expect them to be very small or zero: `runAgreementsBillingTick` selects only sessions ended within `RECENT_WINDOW_DAYS = 30` that carry a `userId`, and the newest attributable session ended 2026-05-13, so the predicate matches nothing today. · **If it fails:** a non-trivial count means the resolver *has* priced sessions and the "zero sessions priced" premise the whole K/L plan rests on is stale — re-read `apps/api/src/repositories/driver-pricing.ts:25-34` before continuing.

**MP-10** — outstanding onboarding tokens, by kind
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** yes
- **Check:** `SELECT kind, count(*) FROM identity.user_tokens WHERE used_at IS NULL AND expires_at > now() GROUP BY kind;` Columns per `packages/shared/src/db/identity.ts:222-243`.
- **Expected:** counts across `invite`, `driver`, `magic_link`, `password_reset`. Note that `repositories/user-tokens.ts:47` only declares three of the four — `driver` is in the DB enum and missing from the TypeScript union. · **If it fails:** a large outstanding `invite` count is a *scheduling* answer, not a failure: every one of those is a live link that a compatibility break (MP-17) would strand. If the count is above whatever Andri accepts as strandable, the release waits or the tokens are re-issued after cutover.

**MP-11** — audit baseline and actor-kind distribution
**Phase** preflight · **Owner** DBA · **Approval** none · **Blocking** no
- **Check:** `SELECT count(*) FROM audit.actions;` and `SELECT actor_kind, count(*) FROM audit.actions GROUP BY actor_kind;`
- **Expected:** counts distributed across exactly four values — `user`, `system`, `vendor_webhook`, `ocpp_worker` (`prisma/schema/platform.prisma:119-126`). · **If it fails:** a fifth value means `ActorKind` was migrated without the schema files being updated; `packages/shared/src/db/platform.ts` and both Prisma copies must be corrected before `recordAuditAction` is touched.

**MP-12** — agreement overlap census, before any exclusion constraint is proposed
**Phase** preflight · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** a self-join count over `agreements.agreements` on `(installation_id, effective_from, effective_until)` where two rows with `status = 'active'` and the same `installation_id` have overlapping ranges — expressed as `SELECT count(*) FROM ...` over the pair set, never as a listing. Columns confirmed at `packages/shared/src/db/commercial.ts:304-306`.
- **Expected:** 0. · **If it fails:** any non-zero count means K05's `EXCLUDE` constraint will fail at creation. Do not add the constraint. The current behaviour is a `console.warn` plus a deterministic `orderBy` that picks the newest (`apps/api/src/lib/agreement/persist.ts:143-165`) — the overlaps must be superseded first, by the same shape as the one-off `apps/api/scripts/supersede-orphan-b6771541.ts`, and that is a separate, Andri-approved change.

---

### Migrate — schema change ordering

**MP-13** — `ALTER TYPE ... ADD VALUE` is isolated in its own migration
**Phase** migrate · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** inspect the generated SQL before applying. `apps/api/drizzle/0001_regular_talos.sql` is the correct precedent: one file, one statement, nothing else. Any new enum-value addition must be the only statement in its migration and must not be followed, in the same transaction, by a statement that *uses* the new label.
- **Expected:** one `ALTER TYPE` per migration file, and no `INSERT`/`UPDATE` referencing the new label in the same file. · **If it fails:** split the migration. Do not "just try it" against staging — a new enum label used in the same transaction that added it is a Postgres error, and discovering that on a database 21 chargers write to costs a rollback that `ALTER TYPE ADD VALUE` does not cleanly support.

**MP-14** — every schema change is written twice, Drizzle first
**Phase** migrate · **Owner** backend · **Approval** none · **Blocking** yes
- **Check:** `npm run check:schema-consistency` (offline; in `check-all.mjs`) plus `npm run check:api-schema` (regenerates `apps/api/prisma/schema/` and detects staleness). The order mandated by `apps/api/drizzle.config.ts:3-13` is: edit `packages/shared/src/db/*.ts`, run `npm run db:generate:sql`, read the SQL, then mirror into `prisma/schema/*.prisma`.
- **Expected:** both green. · **If it fails:** fix the declaration, not the check. Note the gap explicitly: `scripts/check-schema-consistency.mjs` compares **table and column names only** — no types, no nullability, no defaults — so a green result does not mean the two schemas agree, only that they name the same things.

**MP-15** — expand phase is additive only (Q01)
**Phase** migrate · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** grep the generated migration SQL for `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, `ALTER COLUMN ... SET NOT NULL` and `ALTER COLUMN ... TYPE`. Count of matches, per file.
- **Expected:** 0 matches in any expand-phase migration. New columns arrive nullable, new tables arrive empty, new enum labels arrive additively. · **If it fails:** the migration is a contract-phase change wearing an expand-phase label. Move it behind Q03's gate. A `SET NOT NULL` on a column the old code does not write is the specific shape that breaks a rollback: the old binary cannot insert.

**MP-16** — new tables land inside the Drizzle `schemaFilter`
**Phase** migrate · **Owner** backend · **Approval** none · **Blocking** yes
- **Check:** for any new table (C01 `support_contexts`, E01 attribution, G01-G05 onboarding aggregate — all greenfield), confirm its Postgres schema is one of the 18 in `apps/api/drizzle.config.ts:36-39`. The Prisma datasource lists 21 (`prisma/schema/schema.prisma:67`); `hosts` and `issues` are in the Prisma list and **not** in the Drizzle filter.
- **Expected:** the new table's schema is inside the filter. · **If it fails:** do not widen the filter casually and do not place the table in `hosts` or `issues`. The config's own comment says an incomplete filter is dangerous rather than merely wrong: drizzle-kit treats anything outside it as none of its business and "a table it cannot see is a table it will happily propose creating on top of the one already there."

**MP-17** — reconcile the two pending Prisma migrations before wiring `check:migrations` into CI
**Phase** migrate · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** sequence Q10 before Q09. After reconciliation, re-run MP-02 and confirm zero pending; only then add the CI step that `.github/workflows/check.yml:36-40` sketches (`npm run check:migrations` with a `DATABASE_URL` secret).
- **Expected:** zero pending, and only after that a green CI step. · **If it fails:** if reconciliation is deferred, the CI step must also be deferred — wiring it first turns CI red on **every branch immediately**, because the workflow triggers on `push: **`. Also note the unresolved decision the comment names: this workflow runs on every PR, so a staging credential added as a secret is reachable from every branch. That is Andri's call, not a wiring chore.

**MP-18** — `migration_lock.toml` provider unchanged
**Phase** migrate · **Owner** backend · **Approval** none · **Blocking** yes
- **Check:** `prisma/migrations/migration_lock.toml` still reads `provider = "postgresql"`.
- **Expected:** unchanged. · **If it fails:** a changed provider means someone ran Prisma against a different engine (a local SQLite scratch, most likely) and the migration history is now suspect. Revert the file and re-run MP-01 before trusting anything else in this list.

---

### Compatibility gates

**MP-19** — `ConsumeBody` stays non-strict for as long as shipped clients send `kennitala`
**Phase** preflight · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** inspect `apps/api/src/routes/public/invites.ts:36-39`. It is a plain `z.object({token, password})` with no `.strict()`. `apps/mobile/lib/api/client.dart:101-105` posts a third field, `kennitala`, which zod silently strips. Compare with `RegisterBody` at `apps/api/src/routes/public/register.ts:41-56`, which *is* `.strict()`.
- **Expected:** `.strict()` is NOT added in the same release as anything else. · **If it fails:** if a change adds `.strict()` here, reject it. It would 400 **every** current mobile invite redemption — that is scenario 20 failing, not passing, and it lands on shipped clients. The only safe orders are: accept and validate `kennitala` first, or ship the client change first and gate on MP-21.

**MP-20** — mounting `org-email-domains` is a behaviour change, not a migration
**Phase** verify · **Owner** backend · **Approval** Andri · **Blocking** no
- **Check:** `apps/api/src/routes/admin/org-email-domains.ts` exists and is fully implemented, and `apps/api/src/repositories/org-email-domains.ts` reads `tenancy.org_email_domains` (`packages/shared/src/db/identity.ts:339+`), but `app.route(...)` for it appears nowhere in `apps/api/src/index.ts` — the mount list runs from `:125` to `:270` and does not include it.
- **Expected:** the route stays unmounted unless mounting it is an explicit, separately approved line item. · **If it fails:** if a release mounts it silently, treat the domain-match join path as newly live and re-run the driver-onboarding scenarios before shipping — the table already exists, so there is no migration to warn anyone.

**MP-21** — `check:migrations` is run by hand against staging before every deploy
**Phase** preflight · **Owner** Claude B/release-ops · **Approval** none · **Blocking** yes
- **Check:** the release ticket carries the pasted (name-only, no connection string) output of `npm run check:migrations` run against staging, dated within the deploy window.
- **Expected:** present and clean. · **If it fails:** no output, no deploy. Until MP-17 is done this is the *only* thing standing between a schema change and production, because CI does not run it — `.github/workflows/check.yml:44` says exactly that: "Until then, run it by hand against staging before deploying."

**MP-22** — any acceptance criterion that says "in CI" names the CI step that provides it
**Phase** preflight · **Owner** backend · **Approval** none · **Blocking** yes
- **Check:** for every P-group package whose acceptance is "In CI" (P01, P02, P03, P04, P05, P09, P11 in `18A-work-packages.md:291-307`), confirm the PR adds a step to `.github/workflows/check.yml` or an entry to the `CHECKS` array in `scripts/check-all.mjs:14-36`.
- **Expected:** a named step or a named `CHECKS` entry. · **If it fails:** the package is not done. Writing a `.test.ts` file satisfies nothing today: the three CI steps are `npm install`, `npm run db:generate`, `npm run check`, and none of the nine checks under `check` is vitest. `vitest.config.ts` exists and its globs cover `src`, `apps/api/src`, `packages` and `scripts/**/*.test.mjs`, but nothing invokes it in CI, and the parity suite under `apps/api/test/parity/` matches none of those globs at all.

---

### Feature flags and kill switches

**MP-23** — there is no feature-flag store, so name the mechanism before relying on one
**Phase** preflight · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** grep for a flag surface. `entitlements.feature_flags` appears **only** as a comment placeholder at `packages/shared/src/db/commercial.ts:84`; there is no Drizzle table and no `model FeatureFlag` in `prisma/schema/`. The `entitlements` Postgres schema is in the datasource list and in the Drizzle `schemaFilter` but declares no tables. A repo-wide grep for `FEATURE_`, `featureFlag`, `ENABLE_` across `apps/api/src`, `packages/` and the wrangler configs returns one hit, and it is a comment: `apps/api/src/lib/agreement/billing-tick.ts:20`, which records that ADR 0025's per-installation `useAgreementsResolver` flag **does not exist in code**.
- **Expected:** every group whose stated rollback is "feature flag off" names its actual mechanism — a Worker env var, a wrangler var, or a new table with its own migration. · **If it fails:** the package cannot claim a rollback. Group C's stated rollback ("feature flag off → current behaviour", `18A-work-packages.md:76-78`) has no flag behind it today.

**MP-24** — support-context kill switch is evaluated OUTSIDE `requirePermission`
**Phase** verify · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** read `apps/api/src/lib/auth/require-permission.ts:55-59`. `isBootstrapSession(session)` returns `next()` with no permission check at all, before any other logic runs. `assertPermission` has the identical early return at `:115-117`. C02 proposes putting the support-context guard "inside `requirePermission`" to gate 43 routes with one change.
- **Expected:** the guard sits before the bootstrap early return, or the kill switch is read at a layer above it. · **If it fails:** a guard placed after `:59` is bypassed entirely by a bootstrap session (`sub === "admin"` with no `userId`), and so is the kill switch that is supposed to turn it off. The login route now always sets `userId` (`apps/api/src/routes/admin/auth.ts:136`), so fresh cookies take the real path — but that is a property of *new* sessions, not of the code, and an old cookie or a re-introduced bootstrap path silently restores god mode.

**MP-25** — rate-limit direction is stated explicitly, because it currently fails OPEN
**Phase** verify · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** `apps/api/src/lib/rate-limit.ts:121-129` — when the binding is missing or malformed the middleware logs `[rate-limit] binding ... missing or malformed — failing open` and calls `next()`. Confirm which bindings exist in the target environment, as a count of configured bindings, not by printing their values.
- **Expected:** the binding is present in staging and production, so fail-open never triggers there. · **If it fails:** P09's "rate-limit fail-closed test / join refuses" is asserting the opposite of the shipped behaviour — either the code changes or the acceptance does, and that is a decision. Separately: `POST /api/public/invites/consume` and `GET /peek` have **no rate limit at all** (`publicInvites` registers no middleware), so flipping the direction does not cover them.

---

### Client version gates

**MP-26** — the adoption gate has no input signal today
**Phase** preflight · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** grep `apps/api/src` and `apps/mobile/lib` for `X-App-Version`, `appVersion`, `min_version`, `X-Client`. Zero hits. `apps/mobile/pubspec.yaml:4` is `version: 0.1.0+1`. There is no header the API can count.
- **Expected:** before Q06 ("supported version defined") can be accepted, a version header exists and the API records it. · **If it fails:** Q06 and Q08 ("old-app tail model / users-blocked metric") cannot be measured. The gate is a guess. Add the header in an expand-phase release, wait a full adoption window, *then* gate — do not gate on a header no shipped client sends.

**MP-27** — legacy-consume call volume by version, as a count
**Phase** verify · **Owner** Claude B/release-ops · **Approval** none · **Blocking** yes
- **Check:** R05 ("Metric: legacy consume calls by version") is the input to the MP-19 decision. Once MP-26's header exists, the metric is a count of `POST /api/public/invites/consume` requests grouped by version over the window — a count, never a request log with tokens in it. Scenario 156 forbids any log line containing a hash, token or personal identifier.
- **Expected:** a per-version count, with the pre-header calls bucketed as "unknown". · **If it fails:** if "unknown" is the majority bucket, the adoption window is not over. Do not tighten `ConsumeBody` (MP-19) on a majority-unknown population.

---

### Idempotency

**MP-28** — new write surfaces reuse `events.idempotency_keys` rather than inventing a key store
**Phase** migrate · **Owner** backend · **Approval** none · **Blocking** no
- **Check:** the table exists — `packages/shared/src/db/platform.ts:74-88` and `prisma/schema/platform.prisma:82-92`: primary key `(scope, key)`, a nullable `result` jsonb, `created_at`, `expires_at`, and an index on `expires_at`. Helpers already exist: `findExistingIdempotencyKeys` and `batchInsertIdempotencyKeys` in `apps/api/src/lib/db/raw.ts:249` and `:283`, the second using `ON CONFLICT`. The Prisma model's own comment gives the scope convention: `'ocpp:<identity>'`, `'api'`, `'webhook:<partner>'`.
- **Expected:** K-group agreement writes and G-group onboarding writes pick a scope string in that convention and go through the existing helpers. · **If it fails:** a second key store is a second thing to migrate and a second thing to roll back. Push back on it in review.

**MP-29** — the agreements idempotency is a read-then-write race, not a constraint
**Phase** preflight · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** `apps/api/src/lib/agreement/persist.ts:356` implements idempotency as "skip if any billing_lines already exist for this session". `agreements.billing_lines` (`packages/shared/src/db/commercial.ts:458-489`) has three plain indexes — `(agreement_id, billable_event_type)`, `(session_id, factor_code, kind)`, `(recipient_org_id, created_at)` — and **no unique constraint** on any of them. Preflight count: `SELECT count(*) FROM (SELECT session_id, factor_code, kind FROM agreements.billing_lines WHERE session_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1) d;`
- **Expected:** 0 duplicate triples. · **If it fails:** duplicates already exist and the skip-if-exists guard has raced. Do not add a `UNIQUE` index until they are resolved — the index creation will fail, and the resolution is a pricing correction, which is Andri's call.

---

### Audit backfill

**MP-30** — no `bearer` actor kind exists; the audit branch needs a decision before code
**Phase** migrate · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** `ActorKind` has exactly four values — `user`, `system`, `vendor_webhook`, `ocpp_worker` (`prisma/schema/platform.prisma:119-126`, mirrored in `packages/shared/src/db/platform.ts`). A04 asks for `actorKind: "bearer"` on a refused consume, and `18A` scopes it as "New audit branch". It is not a branch; it is an enum migration on `audit.actions.actor_kind`, or it reuses `system`.
- **Expected:** an explicit choice, recorded: migrate the enum (additive, subject to MP-13's isolation rule) or reuse `system` and carry the distinction in `metadata`. · **If it fails:** if code lands using `"bearer"` without the migration, `recordAuditAction` (`apps/api/src/lib/audit.ts:58`) will fail at insert on both the Drizzle and the Prisma branch — it takes `ActorKind` from the generated Prisma enum, so it will not even typecheck.

**MP-31** — audit backfill for C10/C11 is "leave NULL", not a data job
**Phase** migrate · **Owner** backend · **Approval** none · **Blocking** yes
- **Check:** `audit.actions` today has `id`, `org_id`, `actor_user_id`, `actor_kind`, `action`, `target_type`, `target_id`, `metadata`, `occurred_at` (`packages/shared/src/db/platform.ts:91-105`). There is no `support_context_id` and no `on_behalf_of_org_id`. C10 and C11 add both.
- **Expected:** both columns arrive nullable with no default and no backfill; the pre-cutover rows stay NULL and that is the correct historical answer. Verify with `SELECT count(*) FROM audit.actions WHERE support_context_id IS NULL;` after the migration and confirm it equals the MP-11 baseline. · **If it fails:** if anyone proposes backfilling a synthetic support context onto historical rows, refuse — it fabricates a record of an authorisation that never happened. Q11's "no import job exists" assertion covers exactly this.

**MP-32** — one audit row per state change survives the migration (scenario 155)
**Phase** verify · **Owner** backend · **Approval** none · **Blocking** no
- **Check:** post-cutover, for a representative window: `SELECT count(*) FROM audit.actions WHERE occurred_at > <cutover>;` compared against the count of state-changing requests in the same window. `recordAuditAction` picks its client at runtime (`apps/api/src/lib/audit.ts:56-80`) — the dual Drizzle/Prisma branch means a repository that ports to Drizzle mid-release must still land exactly one row.
- **Expected:** one row per state change, no doubling. · **If it fails:** doubling almost always means a caller writes an audit row both inside and outside a transaction during a port. Fix the caller; do not delete rows to clean up.

---

### Rollback

**MP-33** — rollback without password loss
**Phase** rollback · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** re-run MP-06's two counts after the rollback. `SELECT count(*) FROM identity.user_credentials;` and `SELECT count(*) FROM identity.user_credentials WHERE password_hash IS NOT NULL;`
- **Expected:** both counts greater than or equal to the MP-06 baseline. A rollback may leave *extra* credentials created during the forward window; it must never leave fewer. · **If it fails:** a decrease means the rollback dropped or truncated something it should not have. Stop and restore from the Neon branch snapshot — do not attempt a partial repair. Note the structural hazard that makes this check necessary: `identity.user_credentials` has **no `updated_at`** column (`packages/shared/src/db/identity.ts:211-219`), so nothing in the row records when a hash was overwritten. The count is the only signal available; an overwrite in place is invisible to it, which is why A01/A05's guard and R01's alert matter more than any rollback check can.

**MP-34** — rollback without membership loss
**Phase** rollback · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** re-run MP-07 grouped counts. Additionally `SELECT count(*) FROM tenancy.memberships WHERE revoked_at IS NOT NULL;` and `SELECT count(*) FROM tenancy.memberships WHERE accepted_at IS NOT NULL;`
- **Expected:** total count greater than or equal to baseline; `revoked_at` count unchanged by the rollback itself. · **If it fails:** a drop in the active count locks real operators out of their orgs. The primary key is `(org_id, user_id)` with no surrogate id, so a lost row cannot be identified after the fact by anything except the pair — restore from snapshot rather than reconstruct. Also confirm `scope_site_ids` and `scope_property_ids` are still arrays with a `[]` default; a rollback that nulls them silently widens scope rather than narrowing it.

**MP-35** — pricing rollback leaves settled money alone
**Phase** rollback · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** `SELECT count(*) FROM reports.session_ledger WHERE computed_at > <cutover_timestamp>;` and re-run MP-08's `cost_isk_minor IS NOT NULL` count.
- **Expected:** the priced count is unchanged or higher; the `computed_at > cutover` count matches the number of sessions genuinely closed in the window. · **If it fails:** if `computed_at` moved on rows whose session closed *before* cutover, something re-priced settled sessions. That is scenario 147 ("when pricing changes, the session is not rewritten") failing. The known mechanism is `apps/api/scripts/backfill-session-costs.ts:176-199`, whose ledger upsert carries a full-row `update` that overwrites `cost_isk_minor` and the attribution columns in place, unaudited. Establish whether that script ran; if it did, the correction path is an explicit re-resolve producing a correction record, not another in-place UPDATE.

**MP-36** — attribution rollback does not un-attribute sessions
**Phase** rollback · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** re-run MP-08's third count — `SELECT count(*) FROM reports.session_ledger WHERE driver_user_id IS NOT NULL;` — and add `SELECT count(*) FROM charging.sessions WHERE user_id IS NOT NULL;`
- **Expected:** neither count decreases. · **If it fails:** the two counts measure two different, disjointly-populated columns and that is the real risk here, not the rollback. The OCPP writers never set `charging.sessions.user_id` (`apps/api/src/lib/ocpp/projections.ts:185-199`, `:859-872`); only the Zaptec webhook (`apps/api/src/routes/webhooks/zaptec.ts:211`, `:335`) and the CDR sync (`apps/api/src/repositories/zaptec-session-sync.ts:329`, `:347`) do. A rollback that restores one column and not the other flips which driver-facing endpoint returns a session: `GET /api/driver/sessions/current` and `/invoices` filter `sessions.user_id`, while `/sessions/history` is ledger-scoped. Record both numbers before and after, and if they diverge, say so in the incident note rather than picking one as truth.

**MP-37** — greenfield tables roll back by drop, and nothing depends on them
**Phase** rollback · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** for each genuinely new table (C01 `support_contexts`, E01 attribution, G01-G05 onboarding aggregate — all confirmed absent from every `.ts`, `.prisma` and `.sql` in the repo), confirm no *existing* table gained a `NOT NULL` foreign key to it: `SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND ...` scoped to the new table as the referenced side.
- **Expected:** referencing columns, if any, are nullable. · **If it fails:** a `NOT NULL` FK from an existing table to a new one makes the rollback a data migration instead of a `DROP TABLE`. Change the column to nullable in the expand phase and defer the constraint to the contract phase behind Q03's gate.

**MP-38** — support-context kill switch verified by exercising it, not by reading it
**Phase** rollback · **Owner** Claude B/release-ops · **Approval** Andri · **Blocking** yes
- **Check:** with the switch off, confirm a platform-derived staff request that would require a context succeeds exactly as it does today, and that a tenant-member request is unaffected either way (C03's dual-role case). Count form for the audit side: `SELECT count(*) FROM audit.actions WHERE support_context_id IS NOT NULL AND occurred_at > <switch_off_time>;`
- **Expected:** zero new context-carrying audit rows after the switch is off, and no 403 with reason `support_context_required`. · **If it fails:** if the switch is off and staff are still blocked, the guard is not reading the switch — most likely because of MP-24's ordering problem. Turn the deploy back rather than hunting it live; a support agent who cannot act during an incident is worse than an unenforced verb. Related and worth stating in the same breath: `platform.impersonate` and `platform.support.action` have **zero enforcement call sites** today (`platform.impersonate` is declared at `apps/api/src/lib/auth/permissions.ts:82`, bundled at `:249` and `:261`, reaches `super_user` via the spread at `:243`, and is asserted in `permissions.test.ts:192`), so "off" is indistinguishable from "never shipped" unless MP-38 is actually exercised.

**MP-39** — `sales_cs` blast radius is re-measured after any permission migration
**Phase** verify · **Owner** backend · **Approval** Andri · **Blocking** yes
- **Check:** read `expandPlatformTenantVerbs` (`apps/api/src/lib/auth/effective-permissions.ts:103-139`). `platform.tenant.write` expands to every per-tenant read **and** every write in `WRITES` — `member.remove`, `charger.remote_start`, `charger.remote_stop`, `charger.config`, `member.invite`, `billing.export`, plus everything ending in `.write` — in **every** org. `sales_cs` holds `platform.tenant.write`. The "column-restricted in repo layer" mitigation claimed in the comment at `permissions.ts:268` is not implemented anywhere.
- **Expected:** the expansion set is unchanged by the migration, or the change is deliberate and approved. · **If it fails:** any migration that adds a new per-tenant `.write` verb silently grants it to `sales_cs` in every org, with no code change and no review. P05's enforced-verb inventory test is the durable fix; until it exists in CI (MP-22), this is a manual read of `PER_TENANT_PERMISSIONS` on every permission change.

**MP-40** — rollback rehearsal happens on a disposable branch, never on staging
**Phase** rollback · **Owner** DBA · **Approval** Andri · **Blocking** yes
- **Check:** P10 ("Migration rehearsal, DB-flagged, disposable branch only"). Confirm the rehearsal target is a Neon branch created for the rehearsal and deleted after — not `br-tiny-river-abgpqq37` (staging), which 21 chargers write to continuously and which the drop migration measured against.
- **Expected:** a named disposable branch in the release ticket, and its deletion recorded. · **If it fails:** no rehearsal branch, no rehearsal. Running a forward-and-back cycle against staging is how the "empty means unused" mistake gets made twice — `20260807120000_drop_never_used_tables` documents 17 empty tables that have live writers and are merely idle, including `charging.live_sessions`, `charging.tap_intents` and `identity.user_tokens`.
