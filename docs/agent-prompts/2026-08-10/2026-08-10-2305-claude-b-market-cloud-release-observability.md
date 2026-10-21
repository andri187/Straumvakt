---
agent: claude-b
lane: market-cloud-release-observability
status: ready
created_utc: 2026-08-10T23:05:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-beta-production
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-b-market-cloud-release-observability-completion.md
external_mutation_allowed: false
---

# Claude B — Market Cloud Release Observability

## Very TL;DR

Turn Cloudflare/Neon/OCPP operations into a launch-ready control plane:
observability, Sentry, Analytics Engine, queue gates, heartbeat economics,
release rollback, and real-charger measurement.

## Goal

Create the market-launch cloud/release/observability package. The product must
be ready to run real AC chargers with low overhead and measurable per-connector
cloud OPEX.

## Locked Cloud Architecture

- Cloudflare Workers for web/API/OCPP runtime.
- Separate Workers for web, API, OCPP.
- One Charger Durable Object per charger/OCPP identity.
- Cloudflare Queues for meaningful async events only.
- Neon Postgres for business truth.
- Workers Analytics Engine for connector/OCPP economics.
- Sentry + Cloudflare observability for errors/traces/critical failures.
- R2 for statements/exports/debug bundles.
- Cloudflare Access for internal/staging/ops tools.
- Cloudflare Workflows only for billing/report jobs if useful and cost-visible.
- D1 rejected for Core business truth.
- SiteDO future only; model `site_id` now, no Core launch dependency.

## Locked OCPP Behavior

- Heartbeats are liveness buffers, not log data.
- Normal heartbeat updates liveness only.
- Missed heartbeat creates an event.
- Unchanged heartbeat is not queued/persisted.
- Noisy charger detection and constraints are Core.
- Queue meaningful events only.

## Worktrees

Primary:

```text
E:\Claude\Straumvakt-beta-production
```

Read-only:

```text
E:\Claude\Straumvakt-relops-b
E:\Claude\Straumvakt-release-candidate
E:\Claude\Straumvakt
```

## Hard Rules

No push, deploy, DNS/Cloudflare mutation, Neon mutation, SQL mutation, GitHub
remote mutation, hardware/OCPP command, delete/move/archive, or new top-level
`E:\Claude` folder. Avoid generated clutter.

## Phase 0 — Start State

Record start UTC, branches/tips/dirty states for primary and relops-b, release
candidate tip, and recent commits.

## Phase 1 — Cloud Tool Decision Register

Create a decision register for:

- Workers
- Durable Objects
- Queues
- Neon
- Analytics Engine
- Sentry
- R2
- Access
- Workflows
- D1 rejection
- SiteDO later

Each decision must include reason, what it solves, shadow side, cost risk, test
or monitor needed, and launch readiness.

## Phase 2 — Observability Plan

Design the telemetry that must exist before real charger beta:

Workers Analytics Engine metrics:

- frames_per_connector
- heartbeats_received
- heartbeats_suppressed
- missed_heartbeats
- queue_messages_by_type
- queue_backlog_age
- noisy_charger_events
- DO_invocations_estimate
- Neon_write_estimate
- gateway_errors_by_type
- billing_job_started/completed/failed

Sentry:

- OCPP gateway exceptions
- DO exceptions
- queue consumer failures
- API exceptions
- billing invariant failures
- report generation failures
- unexpected protocol parse errors
- release regression alerts

R2:

- statement/export storage
- bounded debug bundle storage
- protocol evidence snapshots

## Phase 3 — Release Gates

Audit/build offline release gates for:

- heartbeat fast path
- still replies to heartbeat
- per-connector frame cap
- hibernating DO
- queue binding exists
- queue not used for unchanged heartbeat
- no permanent heartbeat persistence
- workers_dev/domain route foot-gun
- Sentry config required before beta
- Analytics Engine metric writer required before beta
- no fake active-session interval

## Phase 4 — Backlog/Failure Semantics

Define severity and response for:

- queue backlog growing
- oldest queue message age high
- dead-letter messages
- noisy charger
- missed heartbeat
- gateway error spike
- billing_review_required
- billing_generation_failed
- billing_delivery_failed
- billing_invariant_failed

Mark code red vs recoverable.

## Phase 5 — Real Charger Measurement Plan

Build the measurement plan for ZPR074002/Zaptec/FEV300:

- idle heartbeat proof
- BootNotification heartbeat interval verification
- active-session telemetry interval measurement
- message mix
- queue ops
- Neon writes
- DO activity estimate
- Sentry/Analytics events
- noisy charger simulation constraints
- cost per connector formula in ISK

No hardware commands in this run.

## Phase 6 — Release Checklist

Produce a Cloudflare/Neon launch checklist:

- version IDs
- rollback target
- Worker routes/domains
- workers_dev state
- queue binding
- DO namespace
- Analytics Engine binding
- Sentry DSN/OTLP path
- R2 buckets
- Access protection for ops tools
- Neon branch/project/protection
- secrets separation
- branch protection

Separate read-only verification, mutation requiring approval, and blocked items.

## Deliverables

Inside `E:\Claude\Straumvakt-beta-production`:

- `docs/notes/2026-08-10-market-cloud-tool-decision-register.md`
- `docs/notes/2026-08-10-market-observability-plan.md`
- `docs/notes/2026-08-10-market-release-gates.md`
- `docs/notes/2026-08-10-real-charger-measurement-plan.md`
- `docs/notes/2026-08-10-cloudflare-neon-launch-checklist.md`

Completion artifact:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-b-market-cloud-release-observability-completion.md
```

Also write JSON sidecar if practical.

## Verification

Run available offline checkers/self-tests. Do not install dependencies. Verify
no external mutation, no deletion, no generated clutter.

## Final Handoff

Short chat TL;DR with path to completion artifact. Completion must include
timing, target met yes/no, start/end tips, dirty state, files changed, commits,
checks, gates passing/failing, launch blockers, cleanup candidates, and next
action.
