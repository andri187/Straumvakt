# Sprint 6 — Data Platform + ORM Decision · Retrospective

**Dates:** 2026-05-03 (same working day as Sprint 5 close — decision sprint)
**Exit criterion:** ADR 0018 committed with the three decisions per
[delivery plan §9](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#9-sprint-6--data-platform--orm-decision-delivered-adr-0018).
**Status:** **Met.**

Sprint 6 was a decision sprint, not a code sprint. The deliverable
is one ADR + one taxonomy doc. No production code changed; no
migrations applied; no Workers deployed.

The three decisions:

1. **Telemetry data platform — Neon-with-partitioning.** Daily
   partitions on `event_log_raw_protocol` and `meter_values`. 30-day
   hot window in Postgres, archive to R2 thereafter. Timescale
   Cloud is the documented fallback if Sprint 9 surfaces a Postgres
   ceiling.
2. **ORM boundary — Prisma for control plane / billing-grade /
   admin CRUD; `pg` direct raw SQL for time-series inserts, drift-
   column upserts, and outbox dispatch.** Migrations stay Prisma-
   centralised (single source of truth). The raw SQL boundary lives
   in `apps/api/src/lib/db/` (Sprint 7 implements).
3. **Raw OCPP archive — one R2 bucket per environment, key scheme
   `<orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz`,
   tiered retention (7y billing-touched, 90d operational, 7d
   heartbeat).** Written by a separate consumer on a separate
   queue so archive failures don't block Postgres ack.

---

## What shipped

| Milestone | Status | Commits | Notes |
|---|---|---|---|
| 6.1 — Data product taxonomy | ✅ | (this branch) | Every model in `prisma/schema.prisma` classified into one of nine categories. Output: [DATA_PRODUCTS.md](../architecture/DATA_PRODUCTS.md). 75 models surveyed; four "drift candidate" tables flagged where row identity is control-plane but specific columns are heartbeat-hot. |
| 6.2 — Telemetry platform decision | ✅ | (this branch) | Neon-with-partitioning chosen. Sizing math against the 4k volume (~10–15M event-log rows/day, ~25M meter-value rows/day, ~45GB hot Postgres). Timescale Cloud fallback documented with the migration path (3 steps, ~2–3 days work IF Decision 2 boundary is honoured). |
| 6.3 — ORM boundary decision | ✅ | (this branch) | Prisma + raw SQL split documented. `pg` driver chosen (postgres.js + @neondatabase/serverless considered, both rejected). Worked example for batch insert. Cost/benefit listed explicitly. |
| 6.4 — R2 raw-archive layout | ✅ | (this branch) | Bucket-per-env, key scheme committed, tiered retention table. Read-back contract sketched (signed-URL flow from privileged admin route — Sprint 7's evidence-bundle implementation). |
| 6.5 — Named data products | ✅ | (this branch) | Six products defined: billing-period summary, per-driver session ledger, per-site energy report, charger uptime, command history, evidence bundle. Each gets a target schema or bucket name + write/read owner. |
| 6.6 — ADR 0018 authored + committed | ✅ | (this branch) | [ADR 0018](../adr/0018-data-platform-and-orm-boundary.md) written + committed on `dev/sprint-06-data-platform-adr`. Delivery plan §9 updated to mark Sprint 6 delivered. |

### Verification at sprint close

- `npx prisma validate` — N/A (no schema changes).
- `npx tsc --noEmit` — N/A (no code changes).
- No tests added (decision sprint).
- All artefacts text-only:
  - [docs/adr/0018-data-platform-and-orm-boundary.md](../adr/0018-data-platform-and-orm-boundary.md)
  - [docs/architecture/DATA_PRODUCTS.md](../architecture/DATA_PRODUCTS.md)
  - delivery plan §9 marked "delivered."

---

## Decisions made (ADRs)

- **[ADR 0018](../adr/0018-data-platform-and-orm-boundary.md)** —
  the three decisions. Retroactively documents Sprint 5's per-row
  Prisma writes as the migration target Sprint 7 will replace.
  Each decision carries an explicit revisit trigger (when to
  reopen the conversation) so we don't lock-in by accident.

### Why Neon over Timescale (the harder decision)

Three reasons in the ADR; the operationally-load-bearing one is
**no second control plane**. Adding Timescale today means a second
billing surface, a second IAM, a second backup posture, and a
second deploy story. That's overhead a 4-person team doesn't
absorb cheaply. At 4k chargers Postgres-with-partitioning works.
At 50k+ Timescale wins. Today we're not at 50k.

### Why `pg` direct over `@neondatabase/serverless` (the easy decision)

The Neon serverless WebSocket driver is faster than `pg` over
PostgreSQL wire by ~30%. We rejected it anyway because it doesn't
work with Hyperdrive — Hyperdrive speaks PostgreSQL wire, not
Neon's WebSocket protocol. Locking in the Neon driver would also
undermine Decision 1's fallback plan (we'd have to re-pick a
driver if we ever switched to Timescale). Two-flank lock-in
avoidance > 30% latency win.

---

## What slipped (or shifted)

Nothing. Decision sprint scoped to its six milestones and finished
all six in one working day. The pre-existing
[SPRINT_06_TASKS.md](../sprints/SPRINT_06_TASKS.md) was already
written (operator wrote it sprint-start during Sprint 4); Sprint 6
just executed against it.

The one minor deviation: I cut the branch as
`dev/sprint-06-data-platform-adr` rather than the
`dev/sprint-06-data-platform-decision` named in the task list.
Functionally identical; renaming would just be churn.

---

## What changed in the plan

- Delivery plan §9 — Sprint 6 stamped delivered with link to ADR
  0018.
- Sprint 7's task list (when it gets written) inherits ADR 0018's
  named-data-products and ORM boundary as INPUTS. Sprint 7
  scaffolds `apps/api/src/lib/db/` per Decision 2 and the
  `straumvakt-archive-events-staging` queue per Decision 3.

---

## Carry-forward into Sprint 7

Sprint 7 is the **implementation** sprint for ADR 0018:

1. **Partition the two hot tables** (`event_log_raw_protocol`,
   `meter_values`) via Postgres declarative partitioning. Cron job
   for daily partition create + 30-day-old detach.
2. **Wire `apps/api/src/lib/db/` raw SQL helpers** — at minimum
   the batch-insert path for the queue consumer (Sprint 5's per-
   row Prisma path becomes the slow fallback, NOT the primary).
3. **Drift-column upsert paths** — raw SQL UPDATE for
   `connectors.status`, `evses.status`, `ocpp_identities.lastSeenAt`,
   `charging_stations.lifetimeKwhCached`. Projection handlers move
   off Prisma for these columns only.
4. **Archive consumer + queue** — `straumvakt-archive-events-<env>`
   queue + a second `apps/api` queue handler that drops envelopes
   into R2 per Decision 3's key scheme.
5. **R2 bucket provisioning** — `straumvakt-evidence-staging` with
   the documented lifecycle rules. Worker binding for the archive
   consumer.
6. **Named data product scaffolds** — Sprint 7 writes the schema
   migrations for the six products from Decision 5; the
   read/write paths come Sprints 7-8.

Sprint 9's load test then validates Decision 1's choice. If the
test surfaces the documented revisit triggers (p99 > 250ms
sustained, Hyperdrive saturation, autovacuum DDL incidents),
Decision 1's fallback plan kicks in.

---

## Carry-forward learnings

### 1. Decision sprints are short when the design canon already exists

Sprint 6 took one working day because the underlying choices were
already largely staked out — gbtNotes
`scale-to-4000-chargers-sprint-plan.md` had the nine-category
taxonomy; ADR 0017 had the rescope; Sprint 5 had measured the
actual queue path. The ADR was synthesis + committal, not
discovery. Worth capturing the pattern: "decision sprint" is
cheap when the inputs are already gathered. If they aren't, it
becomes a research sprint and takes longer.

### 2. The "drift candidate" framing is useful

Discovered during 6.1's classification: four tables don't fit
cleanly into one category because their row identity is control-
plane but specific columns are heartbeat-hot. Rather than splitting
those tables (which would be a big reshape), Decision 2 carves a
column-level boundary — Prisma owns the row, raw SQL owns those
columns' writes. Reusable framing for any future table that
straddles two categories.

### 3. Fallback plans matter more than primary picks

Decision 1's primary choice (Neon-with-partitioning) is made on
forecasts, not measurements. Sprint 9's load test will tell us if
the primary is correct. The ADR's `Migration plan` section is
where the actual de-risking happens — if Sprint 9 invalidates the
primary, we know the path back. Write fallback plans like they're
the actual decision; the primary is just the default.

### 4. ORM boundary is column-level, not table-level

The intuitive split is "this table is Prisma, this table is raw
SQL." Reality at 4k scale is "this table has both — most columns
Prisma, four columns raw." Decision 2 commits to this; Sprint 7's
implementation has to honor it. Worth flagging in the
[DATA_PRODUCTS.md](../architecture/DATA_PRODUCTS.md) drift section
so future-self reading "raw SQL for `connectors`" doesn't
misinterpret as "the whole table is raw."

### 5. The taxonomy doc earns its keep when Sprint 7 starts

[DATA_PRODUCTS.md](../architecture/DATA_PRODUCTS.md) is dry until
Sprint 7's first PR cites it. Then it becomes the answer to "where
should this new table go?" — same way ADR 0014 became the answer
during Sprint 4. Worth keeping it up to date as new tables land
(adding a row to the table is cheap).

---

## Sign-off

Sprint 6 closes. ADR 0018 + DATA_PRODUCTS.md + delivery plan
update committed. No code changed. Sprint 7 inherits Decision 2's
ORM boundary and Decision 3's archive design as inputs.

Sprint 7 (hot ingest + retention + R2 archive — the
implementation of ADR 0018) starts on operator go.
