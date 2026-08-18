# Track B — tasks 9, 10 and 11 as executable plans

Written 2026-08-18 by `claude-b`. TASKS.md tasks 9–11 have never been more
than a sentence each. Each below is a plan someone can execute, with a stop
point at every irreversible step.

Basis labels: `[repo]` · `[cf]` read-only observation this run · `[inferred]` ·
`[confirm:]`.

**Read [`2026-08-18-what-production-means.md`](2026-08-18-what-production-means.md)
first.** Its finding — that the live production system *is* the `-staging`
Workers — changes what all three of these tasks mean.

---

## Task 9 — the shared Dev tier

> **Production-option assumption: OPTION-INDEPENDENT, and it is a
> prerequisite for options (b) and (c).**
> Under option (a) it is the thing that gives back a place to test. Under
> (b) or (c) it is where the cutover must be rehearsed before it is
> performed. There is no option under which this is optional.

### Why it is now urgent rather than nice-to-have

The 14:15 round established that top-level is not a working environment. This
round established something sharper: **`wrangler deploy --env staging` on the
gateway or API deploys to the live production system** `[cf]`. There is
currently **nowhere to test anything**. Task 9 is not about developer
convenience; it is about there being any non-production target at all.

### What resources, and what names

| Resource | Name | Notes |
|---|---|---|
| Neon branch | `dev` | Branch off the branch that currently backs the live system. Branches are billed on compute only `[repo: SERVICES.md]`. |
| Console Worker | `hlada-dev` | New `env.dev` block in `wrangler.jsonc`. |
| API Worker | `hlada-api-dev` | New `env.dev` block in `apps/api/wrangler.jsonc`. |
| Gateway Worker | `straumvakt-ocpp-dev` | New `env.dev` block in `gateway/wrangler.jsonc`. |
| Queues | `straumvakt-ocpp-events-dev` + `-dlq`, `straumvakt-outbound-dev` + `-dlq`, `straumvakt-archive-events-dev` + `-dlq` | Six, mirroring staging `[repo: apps/api/wrangler.jsonc]`. |
| R2 bucket | `straumvakt-evidence-dev` | |
| Hyperdrive | new config against the `dev` Neon branch | |
| Hostnames | **`workers.dev` only — no custom domain** | Deliberate: a dev environment with no branded hostname cannot be mistaken for production, and cannot have a charger pointed at it by habit. |

**Fly `zaptec-consumer`: do not duplicate.** It is one shared app `[repo:
SERVICES.md]` and the dev tier does not need vendor sync to prove the deploy
and migration flow. This removes the `$2–5/mo` Fly line from the estimate.

### What it costs, precisely enough to decide

| Line | Scale-to-zero | Always-hot |
|---|---|---|
| Neon compute, 0.5 CU | a few $/mo | **≈ $39/mo** |
| Neon storage | $0.35/GB-mo, shared with the parent branch | same |
| Neon branch itself | **free** — billed on compute only | free |
| Cloudflare Workers | **$0 delta** — the $5/mo Paid base is already paid, and additional Workers cost usage only | $0 delta |
| Queues, R2, DO | negligible at dev volume — no chargers, no traffic | same |
| Fly | **$0** — not duplicated, see above | $0 |
| **Total delta** | **≈ $3–10/mo** | **≈ $40–45/mo** |

All rows `[repo: SERVICES.md]` except the Fly exclusion `[inferred]`.

**Recommendation: scale-to-zero**, unchanged from the standing one. The only
argument for hot is something automated reaching Dev on a schedule, and
nothing does. The cold-start cost lands on developers, not chargers — Dev has
no chargers by construction.

`[confirm: Andri — which Neon plan is active, Launch or Scale? Scale is ~2.1×
Launch per CU-hour, which is the difference between "a few dollars" and "not
quite a few dollars". It does not change the recommendation.]`

### The migration flow, end to end — what this environment is FOR

```
 1. Create the Neon `dev` branch from the live branch.       [reversible: delete it]
 2. Create the six queues, the bucket, the Hyperdrive config. [reversible: delete them]
 3. Add env.dev blocks to the three wrangler configs.         [reversible: git revert]
 4. `npm run check:bindings` — must pass with the new names in the snapshot.
 5. Deploy all three Workers to dev.
 6. Run the migration chain from the recorded state. Confirm
    `prisma migrate status` / drizzle check reports no drift.
 7. Point a VIRTUAL charger at straumvakt-ocpp-dev — never a real one.
    `apps/api/scripts/virtual-cp.ts --gateway=wss://straumvakt-ocpp-dev...`  [repo]
 8. Drive one session end to end: CDR → priced line → invoice document →
    the offline validator.
```

**Step 7 is the point of the whole tier.** Today a virtual charger has to be
pointed at the live gateway to test anything `[repo: docs/dev-tools/virtual-charger.md
uses the staging host]` — which means test traffic lands in the same Durable
Objects and the same queues as 21 real chargers.

### What must be true before it is created

1. **The production definition is decided**, because it determines whether
   `dev` branches from a database that is about to be renamed.
   `[confirm: Q1 in the production packet]`
2. **The Neon plan is known** — cost only, not a blocker.
3. **Deploy go-ahead**, which TASKS.md already marks `[GATE: deploy go-ahead]`
   `[repo]`.

### Stop points

> **STOP 1** — before step 1. Creating a Neon branch is an account mutation.
> **STOP 2** — before step 5. First deploy of three new Workers; the names
> are claimed permanently once deployed.
> **STOP 3** — before step 7, confirm the gateway URL is the **dev** one.
> Pointing a virtual charger at `ws.straumvakt.org` by copy-paste is the most
> likely single mistake in this whole plan.

---

## Task 10 — per-service path-scoped deploys

> **Production-option assumption: OPTION-INDEPENDENT.**
> The path filters key on source directories, not on Worker names, so they
> survive any renaming.

### The current state, which is not what the task assumes

TASKS.md says "a push touching one app rebuilds one app", implying a build
system that currently rebuilds everything. What actually exists:

| Workflow | Trigger | Scope |
|---|---|---|
| `check.yml` | `push: **` + `pull_request` | Runs `npm run check`. **No deploy.** `[repo]` |
| `zaptec-consumer-deploy.yml` | `push` to 3 branches, **`paths: apps/zaptec-consumer/**`** | Deploys to Fly. **Already path-scoped — this is the template.** `[repo]` |

**No GitHub workflow deploys any Worker.** The console's staging deploy runs
through **Cloudflare's Git integration from the `staging` branch** `[repo:
wrangler.jsonc:33-35]`.

**That is the actual defect**, and it is worse than "rebuilds too much": a
Git-integration build triggers on a branch, not on a path, so **a docs-only
commit on `staging` redeploys the console** `[inferred from how Workers Builds
triggers work]` `[confirm: Cloudflare dashboard → Workers → hlada-staging →
Builds — is the Git integration enabled, on which branch, and does it have
build-path filters configured?]`.

### The written diff

New file, modelled directly on the existing Fly workflow:

```yaml
# .github/workflows/deploy-workers.yml
#
# Per-service, path-scoped Worker deploys. Modelled on
# zaptec-consumer-deploy.yml, which has been doing exactly this for Fly.
#
# ── S0 ────────────────────────────────────────────────────────────────
# The gateway job is the ONLY one that can disturb a charger: deploying a
# Worker terminates its open WebSockets, and straumvakt-ocpp-staging holds
# 21 of them on ws.straumvakt.org. Its `paths:` filter therefore excludes
# everything that cannot affect gateway behaviour, and the job carries a
# manual approval environment so it can never fire unattended.
# ─────────────────────────────────────────────────────────────────────

name: Deploy Workers

on:
  push:
    branches: [staging]
    paths:
      - "src/**"
      - "apps/api/**"
      - "gateway/**"
      - "packages/**"          # shared — see "the shared-dependency trap"
      - "package.json"
      - "*.jsonc"
      - ".github/workflows/deploy-workers.yml"
  workflow_dispatch:

jobs:
  changed:
    runs-on: ubuntu-latest
    outputs:
      console: ${{ steps.f.outputs.console }}
      api:     ${{ steps.f.outputs.api }}
      gateway: ${{ steps.f.outputs.gateway }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - id: f
        uses: dorny/paths-filter@v3
        with:
          filters: |
            shared: &shared
              - 'packages/**'
              - 'package.json'
            console:
              - *shared
              - 'src/**'
              - 'wrangler.jsonc'
            api:
              - *shared
              - 'apps/api/**'
            gateway:
              - *shared
              - 'gateway/**'

  console:
    needs: changed
    if: needs.changed.outputs.console == 'true'
    runs-on: ubuntu-latest
    concurrency: deploy-console
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install --no-audit --no-fund
      - run: npm run db:generate
      - run: npm run check
      - run: npm run deploy:staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_DEPLOY_TOKEN }}

  api:
    needs: changed
    if: needs.changed.outputs.api == 'true'
    runs-on: ubuntu-latest
    concurrency: deploy-api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install --no-audit --no-fund
      - run: npm run db:generate
      - run: npm run check
      - working-directory: apps/api
        run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_DEPLOY_TOKEN }}

  gateway:
    needs: changed
    if: needs.changed.outputs.gateway == 'true'
    runs-on: ubuntu-latest
    concurrency: deploy-gateway
    # S0: manual approval. 21 chargers reconnect on every gateway deploy.
    environment: gateway-production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install --no-audit --no-fund
      - run: npm run check
      - run: npm run check:bindings
      - working-directory: gateway
        run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_DEPLOY_TOKEN }}
```

**Also required, and it is not in the diff because it is not a file change:**
disable the Cloudflare Git integration on `hlada-staging`, or the console
deploys twice from two systems. `[confirm: dashboard — is it enabled?]`

### How S0 is preserved — the proof

Four independent guarantees, and the argument is that **any one of them
failing still leaves three**:

1. **Path scope.** The gateway job runs only when `gateway/**` or a shared
   path changes. A console or API change cannot trigger it.
2. **Manual approval.** `environment: gateway-production` requires a human to
   approve the job before it runs. A gateway deploy cannot happen unattended.
3. **The hostnames are now declared in config with `workers_dev: true`**
   `[repo: this run]`. Before this run, a deploy that introduced `routes`
   would have inferred `workers_dev: false` and removed the workers.dev host
   from under whichever chargers use it. That foot-gun is now closed in the
   file rather than in someone's memory.
4. **`check:bindings` runs before the gateway deploy** `[repo: this run]`, so
   a deploy cannot proceed while a binding names a resource that does not
   exist.

**What is NOT claimed:** that a gateway deploy is non-disruptive. It is
disruptive by nature — WebSockets terminate. The guarantee is that it happens
*only when intended*, with the reconnection stop point from the deploy runbook
`[repo: 2026-08-18-dead-paths-and-deploy-runbook.md §3 step 6]`.

### The shared-dependency trap, and how it is detected rather than missed

**The failure mode:** `packages/contracts` changes. A naive filter of
`gateway/**` does not match, so the gateway is not redeployed — and now the
deployed gateway is running against a contract the rest of the system has
moved past. **Nothing fails; the system is quietly inconsistent.**

**The fix above is deliberately blunt:** `packages/**` and `package.json` are
in *every* service's filter via the `&shared` anchor. A shared change
redeploys everything.

**Why blunt rather than clever.** A dependency-graph-driven filter would
redeploy only the services that actually import the changed package. It would
be correct more often and wrong catastrophically: the failure mode of
under-triggering is a silent version skew, and the failure mode of
over-triggering is a wasted CI minute. **Fail long, not short** — the same
principle `retentionClassFor` already uses for unrecognised OCPP actions
`[repo: gateway/src/heartbeat-fastpath.ts:98-109]`.

**And it is detectable, not merely hoped for.** The repo already generates a
dependency graph and gates it (`check:deps-graph`) `[repo]`. A follow-up check
can assert that **every path appearing as a workspace dependency edge is
covered by some filter** — so adding `packages/newthing` without adding it to
the filters fails the build instead of silently under-triggering.
`[inferred — proposed, not built this run: it needs the deploy workflow to
exist first, and the workflow needs the deploy go-ahead.]`

### Stop points

> **STOP 1** — creating `CLOUDFLARE_DEPLOY_TOKEN` is a credential decision.
> It should be **scoped to Workers Scripts: Edit on this account only**, not
> the account-wide OAuth this machine carries. `[repo: the standing posture
> note — any process that can run wrangler here can deploy]`
> **STOP 2** — before the first gateway job runs, confirm the approval
> environment actually gates it. Test with a no-op commit under `gateway/`.
> **STOP 3** — before disabling the Cloudflare Git integration, confirm the
> new workflow has successfully deployed the console at least once.

---

## Task 11 — clean Prod from migrations, clean seed, data hygiene

> **Production-option assumption: DEPENDS ON THE PRODUCTION DECISION, and
> this is the plan most changed by it.**
> Under **option (a)** there is no "clean Prod" to build — the live database
> already holds 21 chargers' real data and cannot be rebuilt from empty. The
> task becomes *reconcile drift and seed nothing*.
> Under **option (b)** a genuinely empty production database is created and
> this plan runs in full.
> **Both variants are given.**

### What "clean" means, precisely

Three distinct claims that get conflated:

1. **Schema is reproducible** — the database can be rebuilt from the
   committed migration chain, in order, with no hand-applied steps.
2. **Migration state is honest** — every applied migration is recorded in the
   migrations table, and nothing is recorded that was not applied.
3. **Data is intentional** — every row is either real customer data or a
   documented seed row. No test chargers, no leftover fixtures.

**Today, claim 2 is known false.** Two migrations were applied by hand and
never recorded — `20260807003000_drop_issues_scaffold` and
`20260807120000_drop_never_used_tables` `[repo: .github/workflows/check.yml
comment]`. That is the drift, and it is why `check:migrations` is not wired
into CI: turning it on today makes every branch red.

### Cross-reference against A's `0002` preflight — no contradiction

Read
`docs/notes/2026-08-18-migration-0002-preflight.md` on
`dev/core-billing-integration` `[repo, read-only]`.

| A's preflight says | This plan says | Consistent? |
|---|---|---|
| `0002` cannot corrupt or lock existing data; steps 1–5 are reversible | Applies to the existing database, which is option (a)'s world | **Yes** |
| The rollback window runs **from apply until the first generation run**; after the first settlement row, rollback destroys data | The seed must therefore **never** run a billing generator | **Yes — and this plan adopts it as a hard rule** |
| "Do **not** run a generator in the same sitting" | Step 7 below enforces a separate sitting | **Yes** |
| `0001` must be applied before `0002` (the `per_connector` enum value) | The chain is replayed in order, so this is automatic | **Yes** |

**Where the two documents could have contradicted and do not:** A's preflight
governs applying `0002` *to the live database*; this plan governs *building a
database from the chain*. They meet at the ordering rule, and both say the
same thing — the chain in order, generators later, never in the same sitting.

**One thing this plan adds that A's does not cover:** the two unrecorded
hand-applied migrations. A rebuilt-from-chain database will have them recorded
properly; the *existing* one will not, so under option (a) they must be
reconciled by hand.

### Variant A — option (a): reconcile, do not rebuild

```
 1. Snapshot. Neon branch off the live branch, named `pre-hygiene-<date>`.
    This is the rollback for everything below.       [reversible]
 ── STOP — do not continue without the snapshot branch confirmed. ──
 2. Read-only: list applied vs recorded migrations.
       npm run check:migrations       # currently exits non-zero
 3. Reconcile the two hand-applied migrations into the migrations table by
    recording them as applied WITHOUT re-running them.
 ── STOP — this edits the migrations ledger. Irreversible in effect: a
    wrongly-recorded migration will never be applied. Verify each of the two
    is genuinely already applied by inspecting the schema first. ──
 4. Re-run `npm run check:migrations` — expect clean.
 5. Wire it into check.yml (the comment there already describes the
    remaining decision: a DATABASE_URL secret reachable from every branch).
 6. Data hygiene: identify test chargers and fixture rows. The virtual
    charger docs use identities like `zpr-test-00N`  [repo], which is the
    search key.
 ── STOP — deleting rows. Every deletion is irreversible past the snapshot's
    retention. Produce the list, have it reviewed, then delete. ──
 7. Separately, later, in its own sitting: apply `0002` per A's preflight.
```

### Variant B — option (b): build clean

```
 1. Create the production Neon project/branch (none exists today).
 ── STOP — account mutation. ──
 2. Replay the full migration chain from empty, in order.
 3. `check:migrations` must be clean on the first try. If it is not, the
    chain is not reproducible and THAT is the bug — fix it before seeding.
 4. Seed. Contents below.
 5. Verify: no charger, no session, no CDR, no settlement row.
 ── STOP — before pointing any real charger at it. ──
 6. Migrate real data across, or re-onboard. This is a separate project and
    is the reason option (b) is expensive.
```

### What the seed contains, and what it must not

**Contains:** the platform organisation; admin role definitions; the money-line
catalogue if it is data rather than code `[repo: MONEY_LINES is currently code
— `packages/contracts/src/money/lines.ts`]`; VAT rate rows with effective
dates; the flat-fee rate reference at 200 kr/connector/month and
50 kr/driver/month with the 450 kr cap `[repo: FOCUS.md]`.

**Must not contain:** any charger, any session, any CDR, any settlement row,
any invoice, any user other than the initial admin, and **no kennitala** —
including in any fixture, per the standing rule.

**Must not run:** a billing generator. Per A's preflight, the first
settlement row closes the `0002` rollback window `[repo]`.

### What data must be preserved, under both variants

The 21 chargers' identities, their `ocpp_identities` rows and their
credentials — **losing these means 21 truck rolls.** Sessions and CDRs are
evidence and are never destructively edited `[repo: FOCUS.md rule 4]`.

---

## Summary — option assumptions at a glance

| Task | Assumption |
|---|---|
| **9 — Dev tier** | **Option-independent**, and a prerequisite for (b) and (c). |
| **10 — path-scoped deploys** | **Option-independent** — filters key on source paths, not Worker names. |
| **11 — clean Prod** | **Option-dependent.** Variant A for (a): reconcile drift, seed nothing. Variant B for (b): build clean, then face the data migration. |
