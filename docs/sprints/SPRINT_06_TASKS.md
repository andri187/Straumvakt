# Sprint 6 — Data Platform + ORM Decision · Task List

**Status:** FUTURE — entry condition: Sprint 5 exit met (queue-backed
ingest live on staging).
**Branch:** `dev/sprint-06-data-platform-decision`.

> Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> A **decision sprint**, not a code sprint. Headline: ADR 0018 — the
> persistence model that survives 4,000 chargers, written down once
> with a named-data-products taxonomy that Sprints 7 and 8 consume.

---

## Milestone 6.1 — Data-product taxonomy

> Classify every existing or planned table into one of nine
> categories. Categories drive choices: which tables stay Prisma,
> which graduate to raw SQL, which partition, which archive.

- [ ] Read every model in `prisma/schema.prisma` and
      `apps/api/prisma/schema.prisma`. Classify into:
      operational / current-state / outbox / billing-grade /
      time-series / raw-archive / aggregate / report-ready /
      API-metadata.
- [ ] Output: `docs/architecture/DATA_PRODUCTS.md` table of
      `(schema.table → category → owner module → query pattern)`.
- [ ] Existing tables that don't fit cleanly get flagged for review
      (likely candidates for split or rename).

## Milestone 6.2 — Telemetry platform decision

> Default per ADR 0017: **Neon-with-partitioning**. Sprint 6 confirms
> with sizing math against the 4k-charger volume.

- [ ] Write IOPS forecast: 4000 chargers × 30s MeterValues =
      ~133/sec sustained, peak 400/sec during boot storms.
- [ ] Storage growth: ~11.5M `event_log_raw_protocol` rows/day =
      ~2.5GB/day uncompressed; with 7-day retention + R2 archive,
      Postgres steady-state ≤20GB.
- [ ] Partition strategy proposal: `event_log_raw_protocol`
      partitioned by `received_at` daily (range), `meter_values`
      partitioned by `recorded_at` daily.
- [ ] Counter-proposal: Timescale Cloud — managed hypertables,
      compression, continuous aggregates. Cost + Cloudflare
      connectivity (Hyperdrive over Postgres wire) review.
- [ ] **Decision** + rationale captured in ADR 0018. Default Neon;
      explicit fallback plan if Sprint 9 load test forces a switch.

## Milestone 6.3 — ORM boundary decision

- [ ] Prisma stays for: admin CRUD, control-plane writes
      (Site, Org, User, Membership, ChargingStation registration),
      reporting reads where Prisma's relations help.
- [ ] Raw SQL for: queue consumer batch inserts
      (`event_log_raw_protocol`, `meter_values`),
      current-state upserts (`charger_status`, `connector_status`),
      outbox enqueue/dequeue, retention age-out, R2 archive
      cursor management.
- [ ] Postgres driver pick: evaluate `pg` direct vs `postgres.js`
      vs `@neondatabase/serverless` for Cloudflare-Workers runtime
      compatibility, connection pooling via Hyperdrive, and
      multi-statement transaction support.
- [ ] Migration ownership stays single — Prisma migrations are the
      source of truth; raw SQL paths assume the schema Prisma
      created.
- [ ] **Decision** captured in ADR 0018, including the chosen driver
      and a worked example of the queue-consumer batch-insert path.

## Milestone 6.4 — R2 raw-archive layout decision

> The CDR-evidence question. Raw OCPP envelopes that drove a billing
> charge must survive long enough to defend the invoice in dispute.

- [ ] Bucket layout: one bucket per environment (`straumvakt-evidence-staging`,
      `-prod`), or one per tenant? Recommend per-environment with
      tenant prefix in the key.
- [ ] Key scheme proposal: `<orgId>/<yyyy>/<mm>/<dd>/<chargerId>/<eventId>.json.gz`
      — supports per-day eviction, per-org export, per-charger
      forensics in one layout.
- [ ] Retention policy: 7 years for billing-touched events
      (StartTransaction, MeterValues during a billed session,
      StopTransaction). 90 days for non-billing operational events
      (Heartbeat, BootNotification). Lifecycle rules expire at
      bucket level.
- [ ] Read-back contract: how does the operator console fetch an
      evidence bundle for a session? (Recommend signed-URL flow
      from a privileged admin route — no direct R2 binding from
      the operator UI.)
- [ ] **Decision** captured in ADR 0018, including a sample bundle
      manifest schema.

## Milestone 6.5 — Named data products

> Sprint 7 implements ingest into these tables; Sprint 8 reads from
> them. Names and contracts defined here so the implementation knows
> what to build.

- [ ] **Billing-period summary** (`billing.period_summary` —
      report-ready). Per orgId × month: total kWh, total ISK,
      session count.
- [ ] **Per-driver session ledger** (`billing.session_ledger`).
      Per session: driver, charger, kWh, duration, computed cost,
      tariff applied.
- [ ] **Per-site energy report** (`reports.site_energy_daily`).
      Per site × day: total kWh, peak power, session count,
      uptime %.
- [ ] **Charger uptime** (`reports.charger_uptime_daily`). Per
      charger × day: heartbeats received, status transitions,
      offline-minutes.
- [ ] **Command history** (`reports.command_history`). Per
      outbound command: dispatched-at, accepted-at, result,
      latency.
- [ ] **Evidence bundle** (R2). Per session: array of raw OCPP
      envelopes between StartTransaction and StopTransaction +
      the manifest.

## Milestone 6.6 — ADR 0018 authored + committed

- [ ] Author `docs/adr/0018-data-platform-and-orm-boundary.md`
      pulling in 6.1–6.5. Includes:
      - Status: Accepted (this sprint's deliverable)
      - Context (4k-charger goal + Sprint 5 queue-backed ingest)
      - Decisions (one per milestone)
      - Consequences (storage cost, dev effort, fallback plans)
      - References to gbtNotes/scale-to-4000-chargers-sprint-plan.md
- [ ] Reference ADR 0018 from delivery plan §9 + §10.
- [ ] Open a follow-up SPIKE ticket for any Sprint 6 question that
      gets deferred (e.g. evidence-bundle signing scheme specifics).

---

**Risks.**
- **Decision sprint feels light.** Mitigation: review with operator
  at sprint mid-point; if velocity outpaces scope, start Sprint 7.5
  scaffolding (raw-SQL helpers in `apps/api/src/lib/db/raw.ts`).
- **Driver-pick lock-in.** Whichever Postgres driver wins becomes
  load-bearing for Sprint 7+. Validate against a real Hyperdrive +
  Workers runtime spike before deciding.
- **R2 bucket layout becomes hard to migrate.** Proposed layout
  needs to survive 4k-tenant scale; pre-flight with one synthetic
  org of 100 chargers' worth of payloads against staging R2 before
  locking the decision.

**Out of scope (Sprint 7+).**
- Any code that implements 6.2–6.5 → Sprint 7.
- Tariff engine, billing dashboard → Sprint 8.
- Load-test simulator (which validates 6.2's choice) → Sprint 9.
