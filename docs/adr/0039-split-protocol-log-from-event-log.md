# ADR 0039 — Split the raw protocol log out of the event log

**Status:** Proposed — 2026-08-02.
**Amends:** [ADR 0018](./0018-data-platform-and-orm-boundary.md) Decision 1
(single partitioned `events.event_log` carrying every retention class).
Decision 2 (ORM boundary) and Decision 3 (R2 archive) stand.
**Supersedes:** the reclamation half of
[ADR 0037](./0037-r2-key-scheme-retention-class-segment.md) — 0037's key
scheme and archive watermark stand and are already shipped.
**Closes:** [ADR 0035](./0035-multi-operator-scale-readiness-roadmap.md)
findings **F5** and **F22**.

---

## Context

ADR 0018 chose one append-only `events.event_log`, partitioned by day,
with a `retention_class` column distinguishing 7-day protocol noise from
keep-forever billing facts. ADR 0018 §3c committed to tiered retention on
that basis.

**The tiering cannot be enforced, at either layer.** A table can only be
partitioned one way per level. Partitions are cut by day; retention
varies by class; and effectively every day's partition holds a mix
including `operational`, which never expires. So dropping a partition
would destroy billing-grade rows alongside heartbeats, and P4.15's
fail-closed gate — correctly — blocks on essentially every real
partition. **Nothing reclaims `raw_protocol` rows. F5 was never
actually addressed** (F22).

This is the same defect ADR 0037 fixed one layer up in R2, where
retention class was absent from the object key. Fixing it in the object
key was cheap. Fixing it inside a partitioned table is not — the axis
is already spent on time.

### What the volume actually is

Heartbeats alone are ~80% of all events. At 1000 chargers that is
roughly **2 million rows per day** with nothing removing them, sharing a
table with the rows that must survive seven years and that billing
disputes are settled from.

### What actually reads the event log

A code search on 2026-08-02 found **no production reader**. Not the API
Worker, not the operator console, not the driver apps — every match was
generated Prisma client boilerplate. Projections run inline against the
event *envelope* during ingest, never against the table. The archive
consumer fans out to R2. The partition cron manages partitions.

The only readers are **7 operator-run diagnostic probe scripts**
(`probe-ocpp-event-coverage`, `probe-full-health`, `probe-vcp-events`
and four others) — which is precisely the short-window forensics use
case that justifies keeping raw frames at all.

**The event log is, today, a write-only sink.** That makes this change
far cheaper than it would normally be.

---

## Decision

### D1 — Raw protocol frames move to their own table

```
events.protocol_log      -- raw OCPP frames. Partitioned by day.
                         -- 7-day retention. Dropped wholesale.

events.event_log         -- domain facts only: financial, operational,
                         -- aggregate, issue_history. Retention aligned
                         -- to the table, not to a column.
```

The queue consumer routes by retention class at write time. Both tables
keep the same envelope shape and the same idempotency semantics, so the
projection dispatcher is unchanged.

Retention becomes trivially correct rather than cleverly correct:
dropping a day of `protocol_log` is a `DROP TABLE` on a partition —
O(1) metadata, instant, no bloat, no `VACUUM`, no lock held on anything
that matters. P4.15's watermark gate applies unchanged, now at a
granularity where it can actually fire.

### D2 — R2 remains the durable record for raw frames

Every raw frame is already archived to R2 — 353,730 objects, verified
working, and since ADR 0037 keyed by retention class. **The Postgres
copy of `raw_protocol` is a 7-day forensics cache, not the system of
record.** Dropping it loses nothing; the evidence bundle reads from R2.

This is the fact that makes D1 safe, and it should be stated plainly in
the runbook so nobody later mistakes `protocol_log` for authoritative.

### D3 — Long-term availability is a derived aggregate, not raw frames

An OCPP `Heartbeat` carries no business data — it is "I am alive" plus a
clock sync in the response. Nothing in the frame is worth keeping.

What must survive is the *derived* fact: was this charger reachable
during period X. That is what SLA reporting, uptime commitments and the
issue engine consume. **P4.30 (derived downtime periods) is that
artifact**, and it is already in the plan.

So the retention split is: **raw frames for days, derived availability
indefinitely.** Once P4.30 lands, raw heartbeats have no long-term value
whatsoever. Until it lands, `ocpp_identities.last_seen_at` already
carries current state.

### D4 — Sub-partitioning by retention class is rejected

Postgres supports composite partitioning and it would work. Rejected
because it multiplies partition count (5 classes × 365 days ≈ 1,800/year
before any growth), it degrades planning at scale, it is the more
specialist pattern for whoever maintains this next — and it keeps 2M
rows/day of noise in the billing-grade table, which D1 removes entirely.
Separating tables is what the field does; AMPECO exposes
`Communication logs` and `OCPI Logs` as resources distinct from CDRs for
the same reason.

---

## Amendment 2026-08-02 — `raw_protocol` is too coarse to expire

**Operator, on reviewing the retention split:** *"I see no reason to keep
the heartbeats for more than 7 days, but that is limited to heartbeat
messages only."*

That distinction exposes a defect in **both this ADR and ADR 0037**.

`gateway/src/identity-do.ts:570` stamps `retentionClass: "raw_protocol"`
on **every** inbound OCPP frame, whatever the action. So `raw_protocol`
does not mean "disposable protocol noise" — it means "arrived over
OCPP", and that set includes:

| frame | what it actually carries |
|---|---|
| `Heartbeat` | nothing. Liveness plus a clock sync. Genuinely disposable. |
| **`MeterValues`** | **OCMF signed billing evidence** — the tamper-evident meter reading |
| **`StopTransaction`** | the charger's own record of delivered energy, the basis of the invoice |
| `StartTransaction`, `Authorize` | who was admitted and when |
| `StatusNotification` | the input to downtime periods and fault diagnosis |

ADR 0037 D2 expires `raw_protocol/` from R2 after 7 days. This ADR drops
`protocol_log` partitions after 7 days. **Together they would delete
signed billing evidence from both stores on a timer** — while ADR 0031
§15 settles metering disputes on exactly those logs, and ADR 0018 §3c
calls billing-touched retention "non-negotiable" at 7 years.

This is the same mistake P4.12 refused to make at the ingest layer —
where MeterValues was kept off the batched path specifically to protect
OCMF — reintroduced at the retention layer.

### Decision — classify at the gateway, by action

`retentionClass` is assigned where the action is known:

| action | class | retention |
|---|---|---|
| `Heartbeat` | `raw_protocol` | 7 days |
| `MeterValues`, `StartTransaction`, `StopTransaction` | `financial` | indefinite |
| `StatusNotification`, `BootNotification`, `Authorize`, `DataTransfer`, everything else | `operational` | 90 days |

Consequences:

- **`protocol_log` holds heartbeats and nothing else** — which is what
  the operator asked for, and it makes the 7-day drop unconditionally
  safe rather than conditionally dangerous.
- **The split still delivers nearly all its benefit.** Heartbeats are
  ~80% of event volume on their own, so the billing-grade table still
  sheds the overwhelming majority of the noise.
- **F5/F22 close more cleanly.** Every `protocol_log` partition is
  single-class by construction, so the fail-closed drop gate can always
  fire rather than blocking on a mixed partition.
- ADR 0037's `raw_protocol/` prefix rule becomes correct as written,
  because the prefix now contains only what it claims to.

**Unclassified default must be `operational`, not `raw_protocol`.** A
frame type nobody has triaged should age out in 90 days, not 7 — an
unknown frame is more likely to be something new that matters than
something disposable. Fail long, not short.

**Backfill:** existing rows are already stamped `raw_protocol`
indiscriminately, including OCMF-bearing MeterValues. They must be
reclassified — or at minimum excluded from expiry — **before** either
7-day rule is switched on. This is the one part of this work that is
not safe to ship incrementally.

---

## Migration

1. Create `events.protocol_log` with the same shape as `event_log`,
   partitioned by day, plus forward partitions from the existing cron.
2. Route `raw_protocol` writes to it in the queue consumer. Both paths
   keep `ON CONFLICT DO NOTHING … RETURNING` so idempotency and the
   archive fanout are unaffected.
3. Update the 7 probe scripts. They are operator tools, not a shipped
   surface; a `UNION ALL` shim during the overlap window is acceptable.
4. Leave existing `raw_protocol` rows in `event_log` where they are.
   They age out of relevance on their own and R2 holds them regardless.
   **Do not** bulk-delete them — that is the heavy operation this ADR
   exists to avoid. Once they are past the forensics window, the day
   partitions containing them can be dropped by the normal gate, since
   by then their `operational` neighbours will also be droppable.
5. Extend the retention window in the partition cron to cover
   `protocol_log` at 7 days.

No downtime, no backfill, no reader migration.

---

## Consequences

**Positive.** Retention is enforceable for the first time. The
billing-grade table stops carrying ~80% noise, which makes it faster to
query and cheaper to back up, not merely smaller. `DROP TABLE`
reclamation avoids the bloat-and-`VACUUM` trap that bulk `DELETE` would
have created at 2M rows/day. F5 and F22 close. The change is safe today
precisely because nothing reads the table yet — and that will not be
true for much longer.

**Negative.** ADR 0018's single-log model is amended: a consumer wanting
"everything that happened" must read two tables or R2. Two partition
lifecycles to operate instead of one. The 7 probe scripts need updating.

**Timing.** This is cheap now and expensive later. At 529 MB with no
readers it is a routing change. After P4-E's read models,
[ADR 0038](./0038-read-serving-tier-and-state-propagation.md)'s serving
tier, or the issue engine start querying the log, it becomes a migration
with dependents. **Do it before those land, not after.**

**Open.** Whether `protocol_log` should live in Postgres at all once
P4.30 derives availability and R2 holds the frames. A 7-day forensics
cache is defensible; it is also the kind of thing that quietly becomes
permanent. Revisit after P4-D measures what the probes are actually used
for.
