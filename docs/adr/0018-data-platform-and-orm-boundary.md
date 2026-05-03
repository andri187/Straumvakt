# ADR 0018 — Data Platform + ORM Boundary + Raw OCPP Archive

**Status:** Accepted
**Date:** 2026-05-03
**Sprint:** Sprint 6 — decision sprint. Three decisions land here so Sprint 7 has a foundation to build on. No code in Sprint 6.
**Supersedes:** "Prisma everywhere" was the implicit assumption. ADR 0018 carves explicit boundaries.
**Relates to:** [ADR 0017](./0017-prepilot-rescope-for-4k-charger-target.md) (the 4k-charger trajectory that forces these decisions), [ADR 0013](./0013-split-ui-api-do-queues.md) (split topology that this ADR builds on), [`gbtNotes/scale-to-4000-chargers-sprint-plan.md`](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md) (origin of the nine-category taxonomy), [`docs/architecture/DATA_PRODUCTS.md`](../architecture/DATA_PRODUCTS.md) (table-by-table classification this ADR commits to).

## Context

Sprint 5 shipped queue-backed inbound OCPP. Charger CALLRESULT
latency is now decoupled from Postgres write latency on the gateway
side. That moves the bottleneck downstream — the queue **consumer**
in `apps/api` does Prisma per-row writes through Hyperdrive, which
runs out of headroom around 4000 chargers:

- Sustained writes at 4k chargers: ~133 events/sec (Heartbeat +
  StatusNotification + MeterValues during active sessions). Peak
  during morning boot storms: ~400/sec.
- Per-row Prisma + Hyperdrive round-trip: ~5–15ms p50, 50–200ms p95.
- 400 inserts/sec × 100ms p95 = the consumer needs >40 concurrent
  invocations just to keep up with peak. Cloudflare Queues consumer
  concurrency caps make this fragile.
- Storage growth at 4k: `event_log_raw_protocol` alone produces
  ~11.5M rows/day = ~2.5GB/day uncompressed. 30-day window =
  75GB hot. Prisma migrations on a non-partitioned 75GB table get
  slow.

Sprint 7 implements the hot-ingest path. Sprint 7's velocity depends
on knowing:

1. What database engine? Neon (current) with partitioning, or
   Timescale Cloud?
2. What ORM boundary? Where does Prisma stop and raw SQL begin?
3. What does the raw OCPP archive look like? R2 bucket layout,
   retention rules, evidence-bundle shape.

This ADR commits to the answers so Sprint 7 has its foundation and
Sprint 9's load test has a target to measure against.

## Decision 1 — Telemetry data platform

**Decision: Neon-with-partitioning. Default per ADR 0017 confirmed.**

Sprint 7 partitions the two HOT-VOLUME tables daily by their
write timestamp:
- `event_log_raw_protocol` partitioned by `received_at` (daily
  range partitions).
- `meter_values` partitioned by `recorded_at` (daily range
  partitions).

Both via Postgres declarative partitioning (PARTITION BY RANGE),
not application-level sharding. Daily partition windows mean a
cron job creates tomorrow's partition each midnight UTC and detaches
partitions older than 30 days (which then get archived to R2 and
dropped).

### Sizing math

- 4k chargers × 30s Heartbeat = 8k events/min sustained baseline.
- StatusNotification ~5/charger/day average × 4k = 20k/day extra.
- MeterValues during active sessions: assume 25% duty, 6 samples/
  min/charger × 4k × 0.25 = 36k/min during the active half-day.
- Daily total: ~10–15M `event_log_raw_protocol` rows + ~25M
  `meter_values` rows.
- Compressed Postgres row + index: ~150 bytes/event.
  10M rows/day × 150B = 1.5 GB/day. 30-day hot window = 45 GB.
- Neon's autoscaling compute handles up to 10 vCPU on the EU-WEST-2
  branch we use today. Cost projection: ~$200/mo for the bigger
  compute tier vs ~$80/mo today. Acceptable.

### Why not Timescale Cloud

Considered. Rejected for now on three grounds:

1. **No proven Cloudflare-Workers connectivity story.** Hyperdrive
   speaks PostgreSQL wire to Neon, which is convenient. Timescale
   Cloud also speaks PostgreSQL wire and Hyperdrive theoretically
   works against it, but we'd be the first Cloudflare deploy hitting
   it at our scale. That's a discovery cost we don't need to take
   for the pre-pilot 4k target.

2. **Continuous aggregates aren't a Sprint 7 must-have.** Timescale's
   marquee feature (compressed hypertables + continuous aggregates)
   would help post-pilot at 50k chargers. At 4k, daily Postgres
   partitions plus a manual aggregate-write pass (Sprint 7.5) gets
   us the same query latency.

3. **Two source-of-truth control planes is operational pain.** Today
   we have one Neon project hosting every table. Timescale would
   add a second control plane (separate billing, separate IAM,
   separate backup posture). Not worth it before the load test
   surfaces a Postgres ceiling.

### Fallback plan

If Sprint 9's load test surfaces a Neon-with-partitioning ceiling
(p99 ingest latency > 250ms sustained, OR Hyperdrive connection
saturation, OR Postgres autovacuum-blocked-by-partition-DDL
incidents), revisit. The migration path:

1. Provision Timescale Cloud in the same region (eu-west-2).
2. Convert the two partitioned tables to hypertables (Timescale's
   `create_hypertable()` works on existing partitioned tables).
3. Switch the queue consumer's connection string to Timescale.
4. Backfill is automatic (Timescale ingests across the wire).

Migration is ~2-3 days of work IF Sprint 7 follows the raw-SQL
boundary in Decision 2 (which lets us re-point the connection
string for the hot path without touching Prisma). Mitigation lives
in Decision 2.

## Decision 2 — ORM boundary

**Decision:** Prisma stays the source of truth for migrations and
for everything in the **control-plane / current-state row /
billing-grade row** categories. Raw SQL via `pg` direct (postgres-
js considered, rejected — see below) for **time-series writes**,
**hot-path upserts on drift columns**, **outbox dispatch**, and
**aggregate writes**.

### What stays Prisma

- All admin CRUD routes (orgs, sites, installations, chargers,
  users, memberships, etc.) — the routes already migrated. Prisma's
  relations help the operator console reads more than they hurt
  the writes.
- Membership / PlatformGrant / UserCredential / UserToken — control
  plane, low volume.
- Charge sessions — billing-grade. Reads from Prisma (operator
  console), writes via raw SQL during ingest (the hot path is
  per-meter-value upserts on `energyWh`).
- Tariff + cost-factor + contract tables — control plane, admin
  CRUD.
- Audit log — append-only, low volume. Prisma writes, Prisma reads.

### What becomes raw SQL

Three hot paths only:

1. **Time-series inserts** — `event_log_raw_protocol` and
   `meter_values`. The queue consumer batches messages within the
   batch (configured in 5.1 as max_batch_size=100, max_batch_timeout=1s)
   and INSERTs all of a batch in one statement using Postgres's
   `INSERT ... VALUES (), (), ()` multi-row form. Conflict policy:
   `ON CONFLICT (event_id) DO NOTHING` for idempotency. Skips Prisma
   entirely — opens its own pooled connection via Hyperdrive's
   PostgreSQL wire.

2. **Drift-column upserts** — see [DATA_PRODUCTS.md](../architecture/DATA_PRODUCTS.md)
   "Drift candidates" section. The hot fields on `connectors`,
   `evses`, `ocpp_identities`, `charging_stations` get updated
   directly via raw `UPDATE` statements from the projection
   handlers. Row identity stays Prisma-managed; only the column-
   write path bypasses the ORM.

3. **Outbox dispatch** — `outbound_commands.status` flips
   (pending → dispatched → accepted/rejected) happen on the queue-
   consumer hot path. Raw SQL UPDATE with row-level lock semantics.
   Admin reads (operator console listing pending commands) stay
   Prisma.

### Postgres driver choice

**`pg` direct.** The classic node-postgres driver. Workers-
compatible via the same Hyperdrive binding we use for Prisma's
adapter. Considered alternatives:

- `postgres.js` — smaller bundle, tagged-template SQL syntax. Works
  in Workers. Rejected because Prisma's adapter ecosystem standardised
  on `pg` and we already depend on it transitively. Adding a second
  PostgreSQL driver ships duplicate code in the bundle.

- `@neondatabase/serverless` — Neon-specific WebSocket driver. Works
  in Workers, lower latency than `pg` over standard PostgreSQL
  wire. Rejected because it doesn't support Hyperdrive (Hyperdrive
  speaks PostgreSQL wire, not Neon's WebSocket protocol). Locking
  in a Neon-specific driver would also undermine Decision 1's
  fallback plan.

### Worked example

The queue consumer's batch insert looks like:

```ts
// apps/api/src/lib/db/raw.ts (Sprint 7)
import { Pool } from "pg";
const pool = new Pool({ connectionString: env.HYPERDRIVE_DB });

export async function batchInsertEventLog(batch: IngestEvent[]): Promise<number> {
  if (batch.length === 0) return 0;
  const values: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const e of batch) {
    tuples.push(`($${p}, $${p+1}, $${p+2}, $${p+3}, $${p+4}, $${p+5}, $${p+6}, $${p+7})`);
    values.push(
      e.eventId, e.orgId, e.aggregateType, e.aggregateId,
      e.eventType, e.occurredAt, e.retentionClass, JSON.stringify(e.payload),
    );
    p += 8;
  }
  const sql = `
    INSERT INTO events.event_log_raw_protocol
      (event_id, org_id, aggregate_type, aggregate_id, event_type, occurred_at, retention_class, payload)
    VALUES ${tuples.join(",")}
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  const { rows } = await pool.query(sql, values);
  return rows.length;
}
```

Migrations stay in `prisma/migrations/`. Prisma is the schema's source
of truth — the raw SQL paths trust that the schema Prisma created
matches what they expect.

### What this buys us

- 100-event batch insert is one round-trip vs 100 round-trips. At
  133 events/sec sustained, drops the consumer's wire-time from
  ~5–15ms per row to ~10–30ms per BATCH of 100.
- ON CONFLICT DO NOTHING preserves Sprint 5's idempotency contract
  (event_id unique constraint) without the per-row idempotency_keys
  cache lookup that Prisma's `ingestEvent` does today.
- Drift-column updates skip the ORM read-modify-write cycle for
  fields that don't need optimistic concurrency.

### What this costs us

- Two write paths in the codebase (Prisma + raw SQL). Operators
  reading code have to know which path applies for which column.
  Mitigation: every raw SQL function lives in `apps/api/src/lib/db/`
  with a comment header pointing at this ADR.
- Migration coordination is fragile. If a Prisma migration renames
  a column the raw SQL paths reference, the raw SQL break silently
  at runtime. Mitigation: the raw SQL functions reference column
  names through a single `SCHEMA_COLUMNS` constant set so a
  schema-change diff surface every break.

## Decision 3 — Raw OCPP archive layout (R2)

**Decision:** One R2 bucket per environment, hierarchical key
scheme keyed by tenant, written from a dedicated archive consumer
on a separate queue.

### Bucket layout

- `straumvakt-evidence-staging` (staging)
- `straumvakt-evidence-prod` (prod)

One bucket per env, NOT per tenant. Per-tenant buckets would scale
worse (R2's bucket count limits + cross-tenant cleanup
complexity).

### Key scheme

```
<orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz
```

Rationale per scope:
- `<orgId>` first → enables per-tenant export (or per-tenant delete,
  e.g. GDPR right-to-be-forgotten requests).
- `<yyyy>/<mm>/<dd>` → enables R2 lifecycle rules (expire by
  prefix age) AND human-debuggable when an operator browses for a
  specific date.
- `<chargingStationId>` → enables per-charger forensics (single
  charger gets pulled into the operator console; bundle is one
  prefix list).
- `<eventId>` → unique key, idempotent overwrite.
- `.json.gz` → JSON envelope, gzipped (gateway DO already has the
  envelope serialised; gzip drops it ~5x).

### Retention policy

| Event class | Retention | Mechanism |
|---|---|---|
| Billing-touched | 7 years (Iceland VAT) | R2 lifecycle: don't expire |
| Operational (StatusNotification, ChangeAvailability) | 90 days | R2 lifecycle: expire prefix-by-date |
| Heartbeat | 7 days | R2 lifecycle: expire prefix-by-date |
| Diagnostics (FirmwareStatusNotification, Diagnostic*) | 30 days | R2 lifecycle |

"Billing-touched" = anything between StartTransaction and the
matching StopTransaction PLUS the StartTransaction and
StopTransaction themselves PLUS the MeterValues from that session.
The archive consumer tags the bundle's metadata with
`retention_class` from the envelope; an operator-side post-session
job promotes the session's bundle to billing-touched if a charge
got billed.

### Write path

A new queue `straumvakt-archive-events-<env>`. The Sprint 5 inbound
queue consumer writes to Postgres (per Decision 2). A SECOND consumer
on a SECOND queue writes to R2.

Why split:
- Postgres write is on the charger's perceived correctness path
  (operator console must reflect the state).
- R2 write is on the audit / billing-evidence path. A failed R2
  write should NOT block consumer ack — billing evidence can be
  reconstructed from the Postgres event log within the 30-day hot
  window.
- The two consumers can have different retry/DLQ policies.

The Sprint 5 inbound consumer fans out: it acks Postgres-side, and
*also* publishes the same envelope to the archive queue. Sprint 7
implements the archive consumer as a separate `apps/api` queue
handler that reads from `straumvakt-archive-events-<env>` and
writes to R2. Out of scope for Sprint 6.

### Read-back contract

For an operator to fetch a session's evidence bundle:

1. Operator console requests `GET /api/admin/charge-sessions/<id>/evidence-bundle`.
2. apps/api admin route reads the session row, extracts the
   timeframe, generates a list of expected R2 keys (one per
   eventId tied to the session via the event_log).
3. Server signs short-lived (5-min) R2 URLs for each key OR streams
   them inline as a single zip download.
4. Operator gets a single download containing all the raw envelopes
   plus a `manifest.json` with the session ID, charger ID, time
   window, and a hash chain over the envelope eventIds.

Out of scope for Sprint 6 (this is Sprint 7's evidence-bundle
implementation). Decision 3's contribution is only the bucket
layout + key scheme + retention rules.

## Named data products

Sprint 7 builds the ingest. Sprint 8 builds the read paths.
Six named products:

| Name | Schema | Source | Read by |
|---|---|---|---|
| **Billing-period summary** | `billing.period_summary` | Period-close job (Sprint 8) | Operator console |
| **Per-driver session ledger** | `billing.session_ledger` | session.ended projection (Sprint 7) | Driver app, billing dashboard |
| **Per-site energy report** | `reports.site_energy_daily` | Daily aggregate job (Sprint 7) | Operator console, customer portal |
| **Charger uptime** | `reports.charger_uptime_daily` | Daily aggregate job (Sprint 7) | Operator console, SLA reports |
| **Command history** | `reports.command_history` | outbound_commands write-through (Sprint 5 → 7) | Operator console |
| **Evidence bundle** | R2 `<orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz` | Archive consumer (Sprint 7) | Billing-dispute API + operator console |

Each gets its own table-or-bucket schema in Sprint 7's milestone
breakdown. Sprint 8's tariff engine writes into `billing.session_ledger`;
Sprint 8's billing dashboard reads from `billing.period_summary`.

## Consequences

### Positive

- Sprint 7 has a foundation. The hot-ingest implementation knows
  which tables to partition, which to migrate to raw SQL, where
  the archive bucket lives.
- Migration risk is bounded. The Neon → Timescale fallback plan
  is one connection-string change away IF Sprint 7 honours the
  Decision 2 boundary.
- The drift-column problem is named and addressed (raw SQL path
  on the four current-state-fields-on-control-plane-tables) without
  requiring a schema split.

### Negative

- Two write paths to maintain. Mitigated by the `apps/api/src/lib/db/`
  convention.
- Raw SQL paths are not reflected in TypeScript types automatically.
  Sprint 7 introduces a thin runtime check OR generates types from
  the Prisma schema for raw SQL consumers.
- R2 archive write is a new SOPS-style workflow (lifecycle rules,
  per-tenant deletion). Operators need a runbook before pilot.
  Sprint 7 produces it.

### Neutral

- Sprint 9's load test now has a measurable target: p99 ingest
  latency at 4k synthetic chargers, partitioned table query
  performance after 30 days of partitions, R2 write latency.
- Sprint 10's observability work expands to track partition health
  (autovacuum on partitioned tables, partition creation/detachment
  cron status).

## Revisit triggers

Per Decision 1's fallback section: revisit Decision 1 if Sprint 9
surfaces sustained p99 ingest > 250ms, Hyperdrive connection
saturation, or autovacuum DDL incidents.

Per Decision 2: revisit if a third hot-volume table emerges that
doesn't fit the time-series / current-state-upsert / outbox
categories, OR if `pg` driver shows allocation pressure under
Workers' V8 isolate memory limits.

Per Decision 3: revisit retention policy if Iceland tax law changes
the 7-year rule. Revisit key scheme if cross-tenant evidence-export
becomes a recurring flow (today it's per-tenant in the operator
console).

## References

- [DATA_PRODUCTS.md](../architecture/DATA_PRODUCTS.md) — table-by-
  table classification this ADR commits to.
- [ADR 0017](./0017-prepilot-rescope-for-4k-charger-target.md) —
  the 4k-charger target this ADR serves.
- [`gbtNotes/scale-to-4000-chargers-sprint-plan.md`](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md)
  — origin of the nine-category taxonomy.
- [Sprint 5 retro](../retros/sprint-05.md) — Sprint 5's queue path
  is the pre-condition this ADR builds on.
