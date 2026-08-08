# Staging catch-up runbook — git branch, database, and deploy

**Status: planning document. Nothing here has been executed.**
Written 2026-08-08 from `docs/staging-catchup-runbook`. Every fact below was
measured read-only against the live Neon branches and the real GitHub remote
on that date; re-verify before acting, because several will decay.

This exists so the catch-up is a reviewed sequence rather than something
improvised at the moment it becomes urgent. It covers five things that have to
happen in a particular order: a backup, a config fix, a database
reconciliation, a git fast-forward, and a deploy that will attach the brand
domain for the first time.

---

## 0. Where things actually stand

| | value | measured |
|---|---|---|
| Deploy branch | `origin/staging` @ `f53fb55` (2026-06-14) | 2026-08-08 |
| Frontier | `origin/dev/drizzle-ownership-and-market-harvest` @ `2b7ebf6` | 2026-08-08 |
| Gap | **140 commits**, staging is a strict ancestor (0 behind) | `rev-list --left-right` |
| Neon staging | `br-tiny-river-abgpqq37`, compute `ep-quiet-bird-abxartp8` | `list_branch_computes` |
| Neon test | `br-withered-hat-abtc5gzi`, compute `ep-holy-surf-abjvdrdo` | `list_branch_computes` |
| Migrations on disk (frontier) | 47 | `ls prisma/migrations` |
| Recorded on staging | 45 distinct (51 rows, 6 rolled-back) | `_prisma_migrations` |
| Pending on staging | 2 | `migrate status` |
| Pending on test | the same 2 | `migrate status` |

Because staging is a strict ancestor of the frontier, the git step is a real
fast-forward — no merge, no conflicts possible. The work is everything around it.

### The two pending migrations are not the same case

Both were applied by hand and neither is recorded. But their *database* states differ:

| | `20260807120000_drop_never_used_tables` | `20260807003000_drop_issues_scaffold` |
|---|---|---|
| On staging | fully applied — 32/32 tables gone, 9/9 named survivors intact | **half** applied: its 3 `DROP TABLE`s are moot (the other migration removed the same tables), its 3 `DROP TYPE`s never ran |
| On test | fully applied | **fully** applied — the enum types are gone there |
| Recorded | nowhere | nowhere |

So `issues."IssueStatus"`, `"IssueSeverity"` and `"IssueSubject"` exist on
staging and not on test. They have **zero dependent columns**. That single
difference is the only structural divergence between the two branches apart
from time-based partition counts (staging `charging` 113 / `events` 122; test
111 / 118 — expected, test was reset 2026-08-06).

### One thing that is *not* a problem

The currently deployed June code references **none** of the 32 dropped tables
(checked by grepping `origin/staging` for every dropped model accessor). The
drops were genuinely safe against the running deployment. The database being
ahead of the deploy is a bookkeeping problem, not a live breakage.

---

## Step 1 — Back up the Neon staging branch

Match the existing habit: `backup-YYYY-MM-DD-pre-<thing>`, e.g.
`backup-2026-08-09-pre-catchup`. Prior art: `backup-2026-08-03-pre-protocol-log-split`,
`backup-2026-08-03-pre-placeholder-purge`, `backup-2026-08-03-pre-falkahraun-delete`.

Create it from `br-tiny-river-abgpqq37` in the Neon console (or MCP
`create_branch`). It is copy-on-write — near-instant and near-free at creation.

**Verify**

```
# branch exists, parent is staging, and parent_lsn is recent
mcp__Neon__describe_project → find the new branch, check parent_id = br-tiny-river-abgpqq37
```

**Rollback** — delete the backup branch. Nothing depends on it.

> Do this even though every statement in step 3 is idempotent. The cost is a
> minute; the thing it protects against is the step-3 decision turning out to
> have been made against a stale reading.

---

## Step 2 — Land the migrations-path config fix

`fix/prisma-migrations-path` (`6b9246e`) adds `migrations.path` to
`prisma.config.ts`. Without it Prisma looks for migrations next to the
datasource file (`prisma/schema/migrations`, absent) instead of
`prisma/migrations`, reports *"No migration found"* / *"Database schema is up
to date!"*, and exits 0 — a green regardless of reality.

**Nothing else in this runbook can be trusted until this is in.** With the old
config, step 3's `migrate deploy` would apply nothing at all and exit cleanly.

This is a code change with zero database effect. It can land on the frontier at
any time, independently of everything else here.

**Verify**

```
npm run check:migrations      # needs DATABASE_URL pointed at staging
# expect: "47 migrations found in prisma/migrations"
#         the two drops listed as not yet applied
#         exit 1   <- non-zero is correct while they are pending
```

If it says *"No migration found"*, the fix is not in the tree you are running from.

**Rollback** — revert the commit. No database state involved.

---

## Step 3 — Reconcile the two migrations on staging

Both files are **fully idempotent**: every statement is `DROP … IF EXISTS`, and
`drop_never_used_tables` wraps its 32 in `BEGIN/COMMIT`. That is what makes the
straightforward option viable.

### Option A — `prisma migrate deploy` (recommended)

```
npx prisma migrate deploy       # DATABASE_URL → staging
```

What actually executes: 35 of the 38 statements are no-ops against objects that
are already gone, and `DROP TABLE IF EXISTS` on an absent table takes no lock at
all. The only real DDL is the three `DROP TYPE`s on the orphaned `issues` enum
types — which have no dependent columns. Both migrations get recorded properly,
and staging ends up matching test.

### Option B — `prisma migrate resolve --applied`

```
npx prisma migrate resolve --applied 20260807120000_drop_never_used_tables
npx prisma migrate resolve --applied 20260807003000_drop_issues_scaffold   # <- the problem
```

The first is truthful — that migration *is* fully applied. The second is not:
it records as applied a migration whose `DROP TYPE` half never ran, permanently
stranding three enum types with no history entry that explains them. If you take
this route, the three types need their own follow-up migration, and you should
expect a future reader to be confused by them.

**Use Option B only if DDL against live staging is unacceptable in the window
you have.** Otherwise A is the only path that leaves history and database
agreeing.

> Live-write caution, retained from the migration's own header: staging carries
> 21 continuously-writing chargers. Option A's real DDL touches only unreferenced
> enum types, so no ingest table is locked — but run it in a quiet window anyway.

**Verify**

```
npm run check:migrations
# expect: "47 migrations found" AND "Database schema is up to date!"  exit 0
#   -> the "47 found" half is what proves step 2 held; "up to date" alone
#      is the false green you started with

# and confirm the types are gone (Option A only):
SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname='issues' AND t.typtype='e';     -- expect 0
```

**Rollback** — this is the one genuinely irreversible step. `DROP TYPE` does not
undo. Recovery is the step-1 backup branch: point the app at it, or restore from
it. That is exactly why step 1 is not optional.

---

## Step 4 — The `test` branch

Test has the same history gap (0 of 2 recorded) but its schema is already fully
caught up, so `migrate resolve --applied` on **both** migrations is factually
correct there — unlike on staging.

**Cheaper and more durable option:** do nothing to test directly. Reconcile
staging (step 3), then reset test from staging. Test is a working branch that
gets reset periodically (`last_reset_at` 2026-08-06), so any reconciliation
applied to it directly is thrown away at the next reset; inheriting a corrected
parent is permanent.

Ordering matters: reset test from staging only *after* step 3, or test inherits
staging's three orphaned enum types and the divergence reverses.

**Verify**

```
# DATABASE_URL → ep-holy-surf-abjvdrdo-pooler…
npm run check:migrations       # expect "47 migrations found" + "up to date!"
```

**Rollback** — test is disposable; reset it from staging again.

---

## Step 5 — Fast-forward the git `staging` branch

```
git fetch origin
git rev-list --left-right --count origin/staging...origin/dev/drizzle-ownership-and-market-harvest
# expect "0<TAB>140" — left must be 0, or it is no longer a fast-forward
git push origin origin/dev/drizzle-ownership-and-market-harvest:staging
```

### ⚠ Confirm first whether this push *is* the deploy

Cloudflare deploys the console Worker from the branch `staging`. If the Git
integration is connected, **this push triggers the deploy** — it is not a
separate, safe step, and step 6 happens automatically and immediately. The
2026-04-24 deploy-pause note records that `hlada-staging`'s Git integration was
disconnected from the CPMS repo; whether it was later reconnected to this repo
is not determinable from inside the repository. **Check the Cloudflare
dashboard before pushing.** If it is connected, treat steps 5 and 6 as one
irreversible action and read step 6 fully first.

**Verify**

```
git ls-remote --heads origin staging     # expect 2b7ebf6…
```

**Rollback** — `git push --force origin f53fb55:staging` restores the old tip.
This is a rollback of the *pointer*; if the push already triggered a deploy, the
deploy also needs rolling back (step 6).

---

## Step 6 — Deploy, and the custom-domain binding

### What is new in the deploy

- Root `wrangler.jsonc` gains, under `env.staging`:
  `routes: [{ pattern: "straumvakt.org", custom_domain: true },
  { pattern: "www.straumvakt.org", custom_domain: true }]` plus `workers_dev: true`.
- `apps/api/wrangler.jsonc`: OCPP queue `max_batch_timeout` 1s → 10s (up to 10s
  of ingest lag on operator-visible StatusNotification — deliberate, documented
  in that file).
- Two new workspace packages (`packages/commercial`, `packages/contracts`), so a
  fresh `npm install` is required. `package-lock.json` is gitignored here, so
  `npm ci` is not available.
- The Workers-targeted Prisma client is not committed — run `npm run db:generate`
  before building or typecheck fails with TS2307 everywhere.
- Five API route files were deleted in the gap. Anything still calling them gets
  a 404 after this lands.

### Order

Gateway → API → Web, per the parked status page: reversed, OCMF frames get
marked `raw_protocol` and land in the short-retention table.

```
cd gateway   && npm run deploy:staging
cd apps/api  && npm run deploy:staging
cd ..        && npm run deploy:staging     # root = the console Worker
```

### The DNS/SSL part — this is the externally visible change

`custom_domain: true` is **not** the mechanism
`docs/operator/STRAUMVAKT_ORG_CUSTOM_DOMAIN_TODO.md` recommends; that doc
predates the decision and proposes `routes` + `zone_name`, which requires DNS
records to already exist. **The TODO is stale — the implemented approach
supersedes it.** Treat this section as the current word.

On first deploy Cloudflare will:

1. Create the DNS records for `straumvakt.org` (CNAME-flattened at the apex) and
   `www.straumvakt.org` in the zone, pointing at `hlada-staging`.
2. Provision an SSL certificate for both. Usually fast, occasionally minutes.
3. Leave `hlada-staging.straumvakt.workers.dev` working, because `workers_dev`
   stays `true`.

Before deploying, confirm the apex and `www` have **no** existing A/AAAA/CNAME
records — a conflict makes provisioning fail. Per the TODO these were
deliberately never created, and the existing email records (`resend._domainkey`
TXT, `send.straumvakt.org` MX/SPF, `_dmarc` TXT) are all on subdomains and do
not collide. Verify rather than assume.

Note what this means: the brand apex will point at the **staging** Worker. That
is intentional pre-pilot, and the wrangler comment says the routes move to the
root config when a production Worker is cut over.

**Verify**

```
curl -sI https://straumvakt.org        | head -3    # expect 200, valid TLS
curl -sI https://www.straumvakt.org    | head -3
curl -sI https://hlada-staging.straumvakt.workers.dev | head -3   # fallback still alive
```

Then sign in and confirm a page that reads the database renders — the point is
to exercise the new schema against the new code, not just get a 200.

**Rollback** — removing the `routes` block and redeploying does **not** reliably
detach an already-provisioned custom domain; wrangler adds these but does not
always remove them. Detaching is a Cloudflare dashboard/API action on the
Worker's Custom Domains list, and the DNS records may need deleting separately.
Budget for that: this step is the least cleanly reversible thing in the runbook
after step 3.

---

## Decisions that must be made before starting

1. **Option A or B in step 3.** A is recommended; B only if no DDL window exists.
2. **Is the Git integration connected?** Determines whether step 5 is safe or is
   itself the deploy.
3. **Is pointing the brand apex at the staging Worker acceptable now?** If not,
   the fast-forward and the domain binding have to be separated, which means
   deploying from a branch with the `routes` block stripped — extra work, and
   worth deciding before rather than during.
4. **`check:migrations` in CI** — still unwired, needs a `DATABASE_URL` secret
   that does not exist. See the note in `.github/workflows/check.yml`; wiring it
   before step 3 turns CI red on every branch.

## Appendix — the measurements this runbook rests on (2026-08-08)

All read-only. Recorded so the claims above can be re-checked rather than trusted.

**`migrate status` returns the *same* output for both branches**, with the
config fix applied:

```
47 migrations found in prisma/migrations
Following migrations have not yet been applied:
20260807003000_drop_issues_scaffold
20260807120000_drop_never_used_tables
```
exit 1 — identical against staging (`ep-quiet-bird-abxartp8-pooler`) and test
(`ep-holy-surf-abjvdrdo-pooler`).

**That sameness is misleading, and it is worth understanding why.**
`migrate status` compares the migrations *directory* against
`_prisma_migrations`. It never inspects the schema. So it cannot distinguish
"applied and unrecorded" from "genuinely not applied" — and here the two
branches are in different states behind an identical report. Anything that
needs to know which case it is has to query the catalogue directly:

| check | staging | test |
|---|---|---|
| of the 32 dropped tables, still present | 0 | 0 |
| of the 9 named survivors, missing | 0 | 0 |
| `issues` enum types present | **3** (`IssueStatus`, `IssueSeverity`, `IssueSubject`) | **0** |
| `roaming` orphan enum types | 2 (`HubKind`, `CdrDirection`) | 2 |
| `_prisma_migrations` rows / rolled back | 51 / 6 | 51 / 6 |
| newest recorded migration | `20260805230000_vendor_auth_state` | same |

Per-schema table counts are identical across both branches except `charging`
(113 vs 111) and `events` (122 vs 118) — time-based partitions, expected, test
was reset 2026-08-06.

The `issues` enum types on staging have **0 dependent columns**, so nothing
blocks dropping them.

The six rolled-back rows are inert: each has a successful counterpart, and
`migrate status` — which can see all 47 migrations with the fix in — lists
*only* the two drops as pending, none of the five May migrations. Prisma
already treats those as applied.

## What this runbook does not cover

The Neon `production` branch (`br-fragrant-bonus-abrc01g6`) and the `hlada`
production Worker. Both are CPMS-era, not Straumvakt, and neither is on this
path. `hlada` is connected to the `andri187/CPMS` repo — do not touch it as part
of this.
