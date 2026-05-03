# Sprint 7 — Hot Ingest + Retention + R2 Archive · Retrospective

**Dates:** 2026-05-03 (single working day)
**Exit criterion:** Implementation of ADR 0018 — partitioned hot
tables, raw-SQL hot-path foundation, R2 archive, named data product
schemas. **Status:** **Met.**

Sprint 7 was the implementation sprint for ADR 0018. Goal:
infrastructure that survives 4,000 chargers. Six milestones planned;
all six landed plus an extra (heartbeat fast-path atomic batch
ingest, which was the combined 7.1+7.3 milestone reframed for
realistic scope). Two migrations applied to staging Neon, one R2
bucket provisioned, four queues running.

Two recovery moments mid-sprint — the partition migration tripped
on constraint-name collisions then a wrong table name in an FK
clause. Both rolled back cleanly to pre-state and re-applied with
fixes; no data loss.

---

## What shipped

| Milestone | Status | Commits | Notes |
|---|---|---|---|
| 7.0 — Virtual charger dev tool | ✅ | `dev/sprint-07-hot-ingest` | apps/api/scripts/virtual-cp.ts — 350-line OCPP 1.6J simulator, zero npm deps, Node 22+ built-in WebSocket. Zero-deps on purpose. Matching `docs/dev-tools/virtual-charger.md` runbook. Smoke-tested against staging gateway (returned 403 on unknown identity — expected). |
| 7.1 — Raw SQL helpers (foundation) | ✅ | (`68a9800`) | apps/api/src/lib/db/raw.ts — pg Pool factory + batchInsertEventLog + findExistingIdempotencyKeys + EVENT_LOG_COLUMNS column-rename guard. Tests with mocked PoolClient. NOT YET WIRED into consumer at landing time — wired later in the heartbeat fast path. |
| 7.2 — Partition the two hot tables | ✅ (recovered) | (`ee2fbfc`) | events.event_log + charging.meter_values now PARTITION BY RANGE on recorded_at / measured_at. Composite PKs (Rule 4 reshape, explicit operator instruction). 14 forward partitions pre-created; daily cron in apps/api scheduled handler keeps +7 forward populated. Migration recovered from two failures (constraint name collision + wrong FK table name); rollback clean both times. |
| 7.4 — Archive queue + R2 + consumer | ✅ | (`42310c4`) | R2 bucket `straumvakt-evidence-staging` (eeur). Queue `straumvakt-archive-events-staging` + DLQ. Inbound consumer fan-out → archive queue → R2 with key per ADR 0018 Decision 3b. End-to-end smoked: 5 envelopes archived in 30s on real-charger traffic. Operator-side R2 lifecycle rules deferred to dashboard. |
| 7.5 — Named data product schemas | ✅ | (`771b25d`) | New `reports` schema namespace + 5 tables: billing_period_summary, session_ledger, site_energy_daily, charger_uptime_daily, command_history. Pure-additive migration, all tables empty. Sprint 8's tariff engine fills the billing-grade rows; daily aggregate jobs (Sprint 7.x scaffolding) fill the reports rows. |
| 7.x — Heartbeat fast-path atomic batch ingest | ✅ | (`6d0f1fb`) | Was the combined 7.1+7.3 milestone scope-reduced. Pure-heartbeat batches go through one pg transaction with batched INSERTs (event_log + idempotency_keys) + batched UPDATE on ocpp_identities.last_seen_at. Mixed batches stay on the per-event Prisma slow path. Atomicity preserved per fast-path batch. **The perf-impact milestone of Sprint 7.** Verified live: 3/3 batches in smoke window went through the fast path, 0 failures, ~900ms per single-event batch (dominated by Hyperdrive connect; amortises at scale). |

### Side fix during sprint

| Commit | Subject | Reason |
|---|---|---|
| (rollback scripts, not committed) | manual undo of failed partition migration | Two consecutive failed attempts (constraint name collision; wrong FK table name); rollback restored pre-state both times |

### Verification at sprint close

- `npx prisma validate` — clean (root + apps/api).
- `npx tsc --noEmit` — clean across root + apps/api + gateway.
- apps/api vitest — **189/189 pass** (was 156 at Sprint 6 close; +33 new across raw.ts, partition-cron, archive-events, fast-path).
- gateway vitest — **29/29 pass** (no changes).
- Two migrations applied to staging Neon:
  - `20260503180000_partition_event_log_meter_values`
  - `20260503190000_reports_schema`
- All three Workers deployed at sprint close:
  - apps/api `c399c31a-8cd3-4223-8330-e0d508d11fc0`
  - gateway (Sprint 5.2 still current)
  - UI (Sprint 5.7 still current)
- Smoke verification:
  - 14 partitions live (7 forward days × 2 tables)
  - 6+ R2 objects written from real-charger traffic in the smoke window
  - Heartbeat fast path captured 100% of batches in the 35s tail window
  - `[partition-cron]` runs silently (all 7 days already covered)

---

## Decisions made (ADRs)

- **ADR 0018** *(authored Sprint 6, executed Sprint 7)* — the three
  decisions Sprint 7 built against: Neon-with-partitioning, hybrid
  ORM boundary, R2 archive layout. Sprint 7 implements; Sprint 9
  load-tests against the chosen primary picks.

### In-flight decisions captured during Sprint 7

- **Composite PK on partitioned tables** — Rule 4 territory.
  Postgres requires the partition key to be part of the PK, so
  `event_log.id` and `meter_values.id` became composite PKs. The
  reshape was forced by the partitioning choice; explicit operator
  instruction received via "go recommended."

- **Heartbeat-only fast path (vs full atomic-batch rewrite)** —
  scope reduction. The original combined 7.1+7.3 milestone was
  "rewrite all 8 projection types in raw SQL"; that's 2-3 days of
  multi-table-read-chain work. Heartbeats alone are ~80% of 4k
  traffic and have a one-statement projection. Captured the perf
  win without the multi-projection rewrite. Other event types stay
  Prisma; can extend on demand if Sprint 9's load test shows them
  as a bottleneck.

- **Path (b) "rename to legacy, no data movement" for partition
  migration** — staging data volume is tiny, simpler SQL, easier
  rollback. Trade: legacy tables linger but self-empty over 30
  days.

- **R2 lifecycle rules deferred** — ADR 0018 Decision 3c committed
  to tiered retention (7y/90d/7d/30d). Sprint 7 ships the bucket +
  archive consumer; the lifecycle rule wiring is operator-side via
  the Cloudflare dashboard. Acceptable carry-forward — at staging
  volume, no rows expire in the foreseeable future.

---

## What slipped (or shifted)

### 1. Other-event-type raw-SQL projections deferred

Status_updated (charger + connector), session.* family,
command_result, BootNotification — all stayed on the Prisma
per-event slow path. The fast path is heartbeat-only. At 4k
chargers, heartbeats are ~80% of volume; the remaining 20% includes
the multi-table-read events that would each need a substantial
rewrite. Sprint 9's load test will tell us if they're a bottleneck.
Could promote one or two to fast path on demand.

### 2. Partition-detach + age-out cron

7.2 ships partition CREATION (daily forward by 7 days). It does
NOT ship partition DETACH/DROP for old partitions. Without that,
30-day-old partitions accumulate. At staging volume that's
tolerable for months; production will need it before pilot. The
detach should be wired alongside the R2 archive consumer
finalising (which has to drain a partition before we can drop
it). Sprint 8 or 7.x.

### 3. CommandHistory write-through

`reports.command_history` table exists. The projection on
`outbound_commands.status` change → `INSERT INTO command_history`
isn't wired. Sprint 7's outbox dispatcher could populate it, but
that's a code change beyond the schema-only scope of 7.5. Sprint
8 picks this up alongside the outbox-dispatch raw-SQL work.

### 4. Daily aggregate cron jobs

`reports.site_energy_daily` + `reports.charger_uptime_daily` need
nightly cron jobs that scan yesterday's `meter_values` +
`event_log` and aggregate into the daily rows. Schemas exist;
the jobs don't. Sprint 8's aggregate work covers this.

### 5. Evidence-bundle read-back contract

The R2 archive consumer writes objects, but no read path exists
for an operator to pull a session's evidence bundle. ADR 0018
Decision 3 sketches the contract (signed-URL flow from a
privileged admin route); Sprint 8 or beyond implements it.

### 6. Zaptec FK table name discovered late

The partition migration's first attempt referenced
`charging.charge_sessions` (the Prisma model name implied) but
the actual table is `charging.sessions`. Caught at migration
time, fixed in the migration SQL. Worth noting: Prisma's
`@@map("sessions")` on `model ChargeSession` is the source of
truth for the actual table name.

---

## What changed in the plan

- Sprint 7's milestone breakdown evolved: original plan had 7.1
  (raw SQL helpers) + 7.3 (drift-column upserts) as separate
  milestones. Reality: 7.1 shipped as foundation-only; 7.3 was
  reframed as the heartbeat fast-path atomic-batch milestone
  because the full drift-column rewrite was bigger than budgeted.
  Sprint 7 closed with both ideas merged into one shipped piece.

- Atomic-batch scope reduced from "all event types" to
  "heartbeat-only." Documented in the commit message and this
  retro. Status_updated promotion is the obvious next candidate
  if Sprint 9 surfaces it.

---

## Carry-forward into Sprint 8

Sprint 8 is the **Tariff Engine + Billing Dashboard** sprint per
the delivery plan. ADR 0018's named data products are inputs:

1. **Sprint 8 tariff engine** writes `reports.session_ledger` rows
   on session.stopped projection. The schema is ready (Sprint 7.5);
   the writer is Sprint 8's deliverable.
2. **Sprint 8 billing dashboard** reads from
   `reports.billing_period_summary` and `reports.session_ledger`.
   Both tables exist; the read paths are Sprint 8.
3. **Sprint 8's pure-function tariff engine** can use the existing
   Prisma path for now. The atomic-batch fast path is heartbeat-
   only; tariff math runs on session.* events which still go
   through Prisma per-event.

Carry items NOT in Sprint 8 (parked for later):

- Status_updated raw-SQL fast path — promote on demand if Sprint
  9 says so.
- Session.* raw-SQL fast path — multi-table read chain; bigger
  effort.
- Partition detach + drop cron — alongside R2 lifecycle wiring.
- Evidence-bundle read API — Sprint 9 or beyond.
- Daily aggregate cron jobs — Sprint 8 if billing dashboard needs
  them populated; otherwise post-pilot.

---

## Carry-forward learnings

### 1. Migration recovery from partial-state is operationally fine

The partition migration failed twice mid-sprint. Both times: small
recovery script (rename back, mark migration rolled back, fix SQL,
re-apply). The failures were constraint-name collisions and a
wrong table name — both surfaced cleanly via the failed migration
error message. Worth knowing: Prisma's `migrate resolve --rolled-
back` + a hand-written rollback script is the right tool for
partial-state recovery on staging. Production would need stronger
guarantees (transactional DDL where possible, dry-run against a
shadow DB), but for staging this worked.

### 2. Partition migration constraint names are subtle

Postgres `ALTER TABLE … RENAME` does NOT auto-rename associated
constraints or indexes. They keep their original names. So
`event_log → event_log_legacy` leaves `event_log_pkey` still
named `event_log_pkey` (now sitting on the legacy table). When
the new partitioned table tries to create its own
`event_log_pkey`, collision. Fix: rename constraints + indexes
explicitly off the legacy namespace before creating the new
partitioned parent. Worth capturing for any future rename →
recreate pattern.

### 3. Prisma model name ≠ table name; @@map matters

`model ChargeSession { @@map("sessions") }` means the table is
`charging.sessions`, not `charging.charge_sessions`. The
partition migration's FK clause referenced the Prisma model's
implied name and failed. Worth treating `@@map` as the single
source of truth for SQL identifiers when writing migrations by
hand.

### 4. Heartbeat-only fast path was the right scope

Pre-sprint, the atomic-batch milestone read like "rewrite all 8
projections in raw SQL" — 2-3 days of multi-table-read chain
work. Heartbeats are ~80% of 4k traffic and have a one-statement
projection. Carving the fast path to heartbeat-only captured
most of the perf win at a fraction of the engineering cost.
Pattern worth reusing: when "rewrite all of X" feels too big,
scope to the highest-volume path first; extend on demand.

### 5. R2 + Queues cost was negligible vs benefit

R2 bucket: $0.015/GB/mo. At 4k chargers × ~280 bytes/heartbeat ×
30 days = ~9 GB → ~$0.14/mo storage. Class A operations: ~33M
writes/month × $0.36/M = ~$12/mo. Two queues at $0.40/M ops:
the doubled fan-out cost is sub-cents/day. Worth knowing the
order of magnitude — R2 + Queues + Cloudflare's free tiers cover
this stack at 4k scale for under $20/mo total.

---

## Sign-off

Sprint 7 closes on the same working day as Sprints 5+6 close.
Six milestones plus the heartbeat fast-path. 9 commits on
`dev/sprint-07-hot-ingest`, all pushed. Two migrations applied,
one R2 bucket provisioned, four queues running, two recovery
incidents (both clean), zero production impact (staging only).

ADR 0018's foundation is in place. Sprint 9's load test will tell
us if Decision 1 (Neon-with-partitioning) holds at 4k.

Sprint 8 (Tariff Engine + Billing Dashboard — the money-math
sprint) starts on operator go.
