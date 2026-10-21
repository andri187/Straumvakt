# Tool comparison — validating the locked architecture

This note exists to **confirm or falsify** the locked choices, not to
reopen them. The conclusion up front: **every locked choice survives**,
and the honest reason is usually the same one — the estate's problems
right now are not platform problems.

Nothing here recommends a multi-cloud abstraction. The five named seams
(`publishOcppEvent`, `recordConnectorMetric`, `billingRepository`,
`archiveStatement`, `sendChargerCommand`) are the whole insurance
policy, and they are cheap because they are already the shape the code
wants.

---

## 1 · Cloudflare Queues vs NATS JetStream / Kafka / SQS

**Why not now.** The gateway is a Worker holding WebSockets. A queue in
the same runtime is a binding and a `send()`; anything else is a
network hop, a credential, a client library in a Worker bundle, and an
operational surface nobody is on call for. Volumes are small — 720
frames/connector/month idle, and the fast path removes those from the
queue entirely.

**What would force reconsideration.**
- Needing **replay** of an event log. Queues are delivery, not a log.
  Reprocessing a month of sessions after a billing bug is a Kafka-shaped
  problem and Queues cannot do it.
- Fan-out to more than about three independent consumers.
- Ordering guarantees per charger, which Queues do not give.

**Minimum seam already needed.** `publishOcppEvent` — already exists as
`enqueueOrPost`, and it already has a fallback path, which is exactly
the seam.

**What not to abstract today.** Message schema. Writing a
broker-agnostic envelope now would freeze a shape nobody has validated
against a second broker.

**Migration pain if wrong.** Moderate. The producer is one function.
The consumer is a Worker handler that would become a service. Weeks,
not months — but only because the seam exists.

> **The live issue is not the broker.** Top-level declares no queue at
> all (OB16/OB17). Swapping brokers would not fix a binding that was
> never added.

## 2 · Analytics Engine vs ClickHouse / BigQuery

**Why not now.** The requirement is counters with bounded cardinality,
written from a Worker, read on a dashboard. Analytics Engine is a
binding and a synchronous `writeDataPoint`; it costs nothing to operate
and nothing to secure. ClickHouse is a database to run; BigQuery is a
credential, an egress path, and a batch story.

**What would force reconsideration.**
- Needing joins between telemetry and business data. Analytics Engine
  cannot join to Neon.
- Retention beyond its window, for a regulator or a customer dispute.
- High-cardinality *indexes* — the current design deliberately indexes
  only the metric name, and a per-charger index would change this
  answer.

**Minimum seam already needed.** `recordConnectorMetric` — implemented
as `createMetricsWriter`, already no-op safe, already vendor-shaped
behind `AnalyticsEngineLike`.

**What not to abstract today.** The blob layout. It is positional and
vendor-specific by nature; wrapping it buys nothing.

**Migration pain if wrong.** Low. Nine metric names behind one
interface.

## 3 · Neon vs RDS / Supabase / self-hosted Postgres / D1

**Why not now.** It is Postgres, it branches, and branching is what
makes this estate's test and staging story work at all. **D1 was
rejected for Core business truth and that holds** — billing needs
transactional Postgres semantics and a restore story, and D1's is not
comparable.

**What would force reconsideration.**
- The **7-day PITR ceiling** meeting a regulatory retention
  requirement. This is the real one: beyond 7 days there is currently
  no recovery at all, and no backup branch exists.
- Connection ceilings under a fleet-wide reconnect storm (M-9).
- Data-residency requirements. Icelandic customer data in an EU region
  is likely fine; a specific requirement would need checking, not
  assuming.

**Minimum seam already needed.** `billingRepository`. This is the seam
that matters most, because it is the one whose absence would be
expensive later.

**What not to abstract today.** SQL. Writing dialect-neutral queries to
keep RDS available is a real cost paid against a hypothetical.

**Migration pain if wrong.** Postgres→Postgres is the easy case. The
hard part is the branch workflow, which is Neon-specific and which the
team's habits now depend on.

> **The live issues are operational, not vendor:** no production
> project, no protected branch, `require_mfa` false on the org that
> owns the only database, no backup branches. None of these are fixed
> by changing vendor.

## 4 · Cloudflare Workflows vs Temporal / Trigger.dev / cron

**Why not now.** Billing and report jobs are monthly, idempotent, and
few. Temporal is a cluster. Trigger.dev is a vendor and a credential.

**What would force reconsideration.** Multi-step jobs with
human-in-the-loop steps, or jobs that must survive a partial failure
mid-run with exactly-once semantics. A monthly close that has to
resume from step 7 of 12 is a Workflows-or-Temporal problem, not a cron
problem.

**Minimum seam already needed.** `archiveStatement`, plus an explicit
job runner boundary that does not exist yet.

**What not to abstract today.** Nothing — there is nothing to abstract
until a job exists.

**Migration pain if wrong.** Low, if jobs stay idempotent. Idempotence
is the property to protect, not the scheduler.

> **This is the one place the locked architecture has a genuine gap.**
> "Workflows only if useful" was a decision about Workflows. But there
> is **no cron trigger and no Workflow anywhere** (OB21) — so the
> billing job has no scheduler of any kind, and no alert if it fails
> (A10). Absent-by-decision and absent-by-omission look identical in a
> config file, which is why OB21 now fails rather than shrugging.

## 5 · Sentry vs Cloudflare-only logs and errors

**Why not now — inverted.** This is the one case where the alternative
is *already* what is running, and it is not enough. Cloudflare
observability gives logs and error counts; it does not give grouped
exceptions with stack traces, release attribution, or regression
detection. The gateway's structured `[ocpp-gw]` lines are genuinely
useful and are the cheapest path to first telemetry — but grep is not
triage.

**What would force reconsideration.** Cost at volume, or a scrubbing
failure. **Sentry is the only component here that receives raw
application data**, which is why the scrubber was built before the SDK
and why A8 blocks the DSN.

**Minimum seam already needed.** `scrubEvent` as `beforeSend` — built,
tested, no SDK dependency. If Sentry is ever swapped, the scrubber is
the part worth keeping.

**Migration pain if wrong.** Low. One `beforeSend` and one DSN.

---

## Verdict

| Choice | Verdict | Real risk |
|---|---|---|
| Cloudflare Queues | **hold** | not deployed top-level — a config gap, not a platform one |
| Analytics Engine | **hold** | binding still commented |
| Neon | **hold** | 7-day PITR ceiling; no backups; MFA off |
| Workflows | **hold, with a caveat** | no scheduler *at all* exists — genuine gap |
| Sentry | **hold** | absent; scrubber ready, DSN blocked on M-8 |

**Nothing in this estate is currently limited by its platform choices.**
Every open problem is a binding that was never declared, a signal that
was never wired, or a number that was never measured. That is a
reassuring answer, and it is also the argument for not spending a single
day on abstraction layers this quarter.
