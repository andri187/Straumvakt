# Sprint 7 — Hot Ingest + Retention + R2 Archive · Task List

**Status:** FUTURE — entry condition: Sprint 6 exit met (ADR 0018
committed).
**Branch:** `dev/sprint-07-hot-ingest-r2-archive`.

> Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> Implements ADR 0018's data-platform decision. Sprint 5's queue
> consumer is replaced with a raw-SQL batched-write hot path.
> Retention bounds Postgres. R2 archive bounds storage cost while
> preserving billing-dispute evidence — the **CDR-archive work
> specifically lives here.**

---

## Milestone 7.1 — Hot-path raw-SQL batch writes

> Replace the queue consumer's per-event Prisma writes (Sprint 5.3)
> with the raw-SQL driver chosen in ADR 0018. Batch by N or T_ms,
> whichever fires first.

- [ ] `apps/api/src/lib/db/raw.ts` — thin wrapper around the chosen
      driver (per ADR 0018) exposing `query<T>()`, `tx(fn)`, and
      `batchInsert(table, rows)` with parametrized statements.
- [ ] `apps/api/src/queues/ocpp-events.ts` rewritten:
      accumulate events per-batch (Cloudflare Queues delivers a
      batch of up to 100 messages already); flush via
      `batchInsert('event_log_raw_protocol', batch)` in a single
      `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
- [ ] Per-action projection writes also batched (e.g. all
      `MeterValues` in the batch → one `INSERT INTO meter_values`).
- [ ] Same idempotency invariant: replay-safe; same `eventId` → no
      double-row.
- [ ] Tests: 100-event batch, 1000-event batch, mixed-action batch.

## Milestone 7.2 — Partition / hypertable strategy applied

> Whatever ADR 0018 decided. Default plan: Postgres native range
> partitioning on `received_at` daily, with a 7-day-ahead
> partition-creation cron.

- [ ] Migration: drop `event_log_raw_protocol`, recreate as
      `PARTITION BY RANGE (received_at)` parent. Initial partitions
      for today + 7 days forward. **Operator-instructed Rule 4 +
      Rule 5 — schema reshape, billing-grade table.**
- [ ] Same for `meter_values` partitioned by `recorded_at`.
- [ ] `charge_sessions` reviewed: if low-volume (one row per
      session, ~12k/day at 4k chargers @ 3 sessions/day),
      partitioning probably overkill. Leave non-partitioned;
      documented decision.
- [ ] Cron `apps/api/src/crons/partition-creator.ts` creates
      tomorrow + day-after-tomorrow partitions if absent. Runs
      daily 03:00 UTC.
- [ ] Test: insert into a non-existent partition fails loudly;
      cron-creates the partition; retry succeeds.

## Milestone 7.3 — Retention enforcement

- [ ] `apps/api/src/crons/retention.ts` — daily 04:00 UTC.
- [ ] `raw_protocol` retention: delete rows from
      `event_log_raw_protocol` older than 7 days **where the
      corresponding R2 archive marker (per 7.4) exists**. Never
      delete unarchived data.
- [ ] `financial` retention: indefinite (legal hold, billing
      dispute window).
- [ ] `operational` retention: 90 days (BootNotification,
      Heartbeat, StatusNotification — useful for forensics, not
      billing).
- [ ] Drop expired partitions instead of row-by-row delete where
      partition is fully out-of-window (10× faster).
- [ ] Test: insert 8-day-old row + R2 marker → retention deletes.
      Insert 8-day-old row WITHOUT marker → retention skips +
      alerts.

## Milestone 7.4 — R2 raw-archive (CDR evidence bundle)

> The CDR-archive work specifically. Per-day partition files in R2
> per ADR 0018's key scheme. Bundle manifest indexes the events.

- [ ] `apps/api/src/crons/r2-archive.ts` — runs after partition
      creation, before retention. Streams aged-out
      `event_log_raw_protocol` rows by `(orgId, day)` into
      `<orgId>/<yyyy>/<mm>/<dd>/<chargerId>/<eventId>.json.gz`.
- [ ] Bundle manifest `<orgId>/<yyyy>/<mm>/<dd>/manifest.json`
      lists every archived eventId + chargerId for that day.
- [ ] Archive marker table `archive.r2_partitions(orgId, day,
      object_key, archived_at, byte_size, event_count)` —
      retention cron's source of truth for "is it safe to delete".
- [ ] Failure path: R2 write fails → alert + retry; never deletes
      Postgres rows past unmarked R2 partitions.
- [ ] Read-back route: `GET /api/admin/sessions/:id/evidence` —
      privileged admin, returns signed URLs for the bundle of
      events between StartTransaction and StopTransaction for that
      session.
- [ ] Test: 1-day archive run → manifest matches Postgres rows
      exactly. Disputed-session evidence read returns the right
      bundle.

## Milestone 7.5 — Aggregate tables + nightly aggregation

> Per ADR 0018 §"Named data products" — aggregates are
> rebuild-from-raw if the aggregator is rerun. Idempotent.

- [ ] Aggregate tables created: `aggregate.charger_hourly`,
      `aggregate.connector_status_hourly`, `aggregate.fault_hourly`.
- [ ] Aggregator cron `apps/api/src/crons/aggregator.ts` runs
      hourly at :05; reads from `event_log_raw_protocol` +
      `meter_values` for the prior hour; upserts aggregate rows.
- [ ] Reads BEFORE retention runs (sequence: aggregate hourly → R2
      archive nightly → retention nightly).
- [ ] Test: replay aggregator twice for the same hour → same row
      values (idempotent).

## Milestone 7.6 — Report-ready datasets

> The named data products from ADR 0018 §"Named data products".
> Sprint 8's billing dashboard reads from these.

- [ ] `billing.session_ledger` — per session: driver, charger,
      kWh, duration, cost (cost computed Sprint 8.5; row created
      empty here, populated by tariff engine).
- [ ] `billing.period_summary` — per (orgId, yyyy-mm): total kWh,
      total ISK, session count.
- [ ] `reports.site_energy_daily` — per (siteId, day): total kWh,
      peak power, session count, uptime %.
- [ ] `reports.charger_uptime_daily` — per (chargerId, day):
      heartbeats received, status transitions, offline-minutes.
- [ ] `reports.command_history` — per outbound command:
      dispatched-at, accepted-at, result, latency. Populates
      from Sprint 9's outbox state machine; stub here.

## Milestone 7.7 — Synthetic load smoke

> Not the full Sprint 9 simulator — just a confidence check that
> the hot path holds up at the volume Sprint 9 will hammer.

- [ ] Script `apps/api/scripts/synthetic-load.ts` produces 4M
      synthetic OCPP events via the queue.
- [ ] Run against staging; measure: queue lag, p50/p99 batch
      insert time, R2 archive cron duration, retention cron
      duration, partition cron correctness.
- [ ] Target: 4M events drained in <1h (~1100/sec sustained, ≥
      Sprint 9's 4k-charger 30s-MeterValues rate of 133/sec by
      8×). Document results in `docs/runbooks/sprint-07-load-smoke.md`.
- [ ] If target missed → spike fix or escalate to ADR 0018
      revision (e.g. switch to Timescale).

---

**Risks.**
- **R2 write reliability under burst.** If R2 write fails AND
  retention cron has run, raw evidence is gone. Mitigated by the
  archive-marker check in 7.3.
- **Partition maintenance miss.** Tomorrow's partition not created
  → inserts fail at 00:00 UTC. Mitigated by 7-day-ahead creation
  + alert if cron skipped.
- **Aggregate vs raw drift.** Replayed aggregator must produce
  identical aggregate rows. Spot-check daily.
- **Rule 5 territory.** Hot-path SQL changes the canonical write
  path for billing-grade data. Stop-and-summarize before each
  milestone's code lands.
- **Tariff engine dependency reversed.** Sprint 8 depends on 7.6
  schema; 7.6 ships report-ready tables empty for tariff. Tight
  contract here.

**Out of scope (Sprint 8+).**
- Tariff engine, billing dashboard → Sprint 8.
- Outbound command state machine, load test simulator → Sprint 9.
- OpenTelemetry instrumentation → Sprint 10.
- OCPI roaming CDR (the OCPI protocol's CDR object) → Sprint 15+.
  This sprint's "CDR archive" is the raw OCPP payload archive used
  for billing-dispute evidence; OCPI CDRs are a roaming-domain
  concept that defers post-pilot per ADR 0017.
