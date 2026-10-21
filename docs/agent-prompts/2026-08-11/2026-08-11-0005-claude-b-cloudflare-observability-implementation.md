---
agent: claude-b
lane: cloudflare-observability-implementation
status: ready
created_utc: 2026-08-11T00:05:00Z
estimated_wall_clock: 4h
target_worktree: E:\Claude\Straumvakt-relops-b
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-observability-implementation-completion.md
external_mutation_allowed: false
---

# Claude B — Cloudflare Observability Implementation

## Very TL;DR

Implement local source/config gates for Sentry, Analytics Engine, heartbeat
interval 3600, queue suppression, and release observability — no cloud mutation,
but leave a mergeable, tested slice.

## Goal

Previous output says the architecture is locked but Sentry and Analytics Engine
are absent. This prompt is to implement the local code/config shape and gates
needed before real charger beta, without touching Cloudflare itself.

Target a reviewable branch/worktree state where:

- heartbeat fast path remains intact
- BootNotification interval is product-aligned or explicitly configurable
- Analytics Engine metric writer exists and is testable
- Sentry integration/scrubbing plan exists in code or clear patch form
- static gates can prove the required bindings/config are present
- no secrets are committed

## Locked Architecture

- Cloudflare Workers for web/API/OCPP.
- Separate Workers for web, API, OCPP.
- ChargerDO per charger/OCPP identity.
- Queues for meaningful events only.
- Neon Postgres for business truth.
- Workers Analytics Engine for connector/OCPP economics.
- Sentry + Cloudflare observability for errors/traces/critical failures.
- R2 for statements/exports/debug bundles.
- Access for internal/ops tools.
- D1 rejected for Core business truth.

## Locked OCPP Behavior

- Heartbeats are liveness buffers, not log data.
- Normal heartbeat updates liveness only.
- Missed heartbeat creates an event.
- Unchanged heartbeat is not queued/persisted.
- Noisy charger detection and constraints are Core.
- Product heartbeat target is 3600 seconds unless source/hardware proves a
  different safe value.

## Worktrees

Primary write target:

```text
E:\Claude\Straumvakt-relops-b
```

Read-only comparison:

```text
E:\Claude\Straumvakt-beta-production
E:\Claude\Straumvakt-release-candidate
E:\Claude\Straumvakt
```

Do not write to beta-production unless explicitly required by the prompt. This
is a local implementation/patch lane.

## Hard Rules

- No push.
- No deploy.
- No Cloudflare/DNS mutation.
- No Neon mutation.
- No SQL mutation.
- No GitHub remote mutation.
- No hardware/OCPP charger command.
- No delete/move/archive.
- No new top-level `E:\Claude` folder.
- No secrets committed.
- Avoid `node_modules`, `.next`, build output, screenshots, caches.

## Phase 0 — Start State

Record:

- Start UTC.
- Branch/tip/dirty state for relops-b.
- Branch/tip/dirty state for beta-production.
- Release-candidate tip.
- Whether existing heartbeat fast path tests/gates pass.

## Phase 1 — Source Census

Locate:

- OCPP gateway Worker entry/config.
- ChargerDO / identity DO source.
- BootNotification handler.
- Heartbeat handler.
- queue enqueue/publisher.
- wrangler config(s).
- existing OCPP cost gates.
- existing vitest/nodeps config.

Document exact files and current behavior.

## Phase 2 — BootNotification Interval

Find where BootNotification returns `interval: 60`. Implement the safest local
change:

- Prefer named constant/config with default `3600`.
- Make tests fail if it drifts back to 60.
- If protocol/source proves the interval cannot be set there, document and
  implement a check around the actual source of truth.

Do not command hardware.

## Phase 3 — Analytics Engine Metrics Interface

Implement a small metrics writer interface for OCPP economics:

- `heartbeats_received`
- `heartbeats_suppressed`
- `missed_heartbeats`
- `queue_messages_by_type`
- `noisy_charger_events`
- `gateway_errors_by_type`
- `billing_job_started`
- `billing_job_completed`
- `billing_job_failed`

Requirements:

- no-op safe when binding absent in local tests
- typed event names
- no idTag/personal data
- hashed or non-sensitive charger identity only
- tests for scrubbing/no PII fields
- static gate for Analytics Engine binding in wrangler config, if binding is
  added

If adding the binding requires unknown account dataset name, add a clearly
named placeholder/comment and gate that fails until configured.

## Phase 4 — Sentry Integration/Scrubbing

Implement or prepare the smallest safe Sentry integration:

- scrub idTags, tokens, passwords, authorization headers, OCPP payload bodies
  unless explicitly whitelisted
- capture gateway/DO/queue consumer exceptions
- include Worker version/release id if available
- no DSN literal committed
- DSN comes from secret/env binding
- tests for scrubber
- static gate for Sentry init + secret name

If package/dependency is absent and install is not safe, implement scrubber and
document exact install/config patch. Do not install dependencies unless already
available and safe.

## Phase 5 — Release Gates

Extend offline gates so they assert:

- heartbeat fast path exists
- heartbeat still replies
- frame cap exists
- unchanged heartbeat does not queue
- BootNotification interval is 3600 or config-driven
- Analytics writer exists
- Sentry scrubber exists
- no Sentry DSN literal committed
- wrangler config has required placeholders/bindings or explicit TODO gate

Run the gates.

## Phase 6 — Observability Docs

Create/update:

```text
docs/notes/2026-08-11-cloudflare-observability-implementation.md
docs/notes/2026-08-11-ocpp-heartbeat-interval-and-cost-gate.md
docs/notes/2026-08-11-sentry-analytics-engine-setup-runbook.md
```

Include:

- what was implemented
- what remains dashboard/API setup
- exact Cloudflare steps needed later
- exact secrets/bindings names
- tests/gates
- rollout order
- rollback

## Required Completion Artifact

Write:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-observability-implementation-completion.md
```

Also write JSON sidecar:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-observability-implementation-completion.json
```

## Verification

Run dependency-free tests/gates. If available, run focused vitest/nodeps tests.
Do not deploy. Do not run wrangler commands that mutate cloud state. Read-only
wrangler inspection is allowed only if already authenticated and does not expose
secret values; otherwise skip and document.

## If You Finish Early

Do not stop after the first gate passes. Continue with:

1. Add more scrubber tests.
2. Add static gates for missing bindings.
3. Compare beta-production and relops-b profiles.
4. Produce a merge patch checklist.
5. Produce a Cloudflare dashboard runbook.
6. Re-read docs for contradictions and record corrections.

## Final Handoff

Chat response must be short and point to completion artifact.

Completion must include:

- Start UTC.
- End UTC.
- Actual wall-clock duration.
- Whether 4h target was met.
- Start/end tips.
- Dirty/clean state.
- TL;DR, 5 lines or fewer.
- Files changed.
- Commits created.
- Tests/checks run.
- What is now implemented.
- What remains Cloudflare setup.
- Gates passing/failing.
- External state confirmation.
- Cleanup candidates.
- Next recommended action.
