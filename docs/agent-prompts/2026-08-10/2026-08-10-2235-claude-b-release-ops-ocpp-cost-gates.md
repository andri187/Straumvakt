---
agent: claude-b
lane: release-ops-ocpp-cost
status: ready
created_utc: 2026-08-10T22:35:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-beta-production
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-b-release-ops-ocpp-cost-gates-completion.md
external_mutation_allowed: false
---

# Claude B — Release Ops And OCPP Cost Gates

## Very TL;DR

Make the OCPP heartbeat/cost fixes release-safe: verify gates, reconcile relops
scratch code, and produce the Cloudflare/Neon/release checklist before real
chargers are connected.

## Goal

Continue the release-ops/OCPP cost lane. Recent work found and partly fixed the
idle heartbeat cost problem. Turn that into reliable release gates and an
operational readiness packet. This is not a Cloudflare mutation task.

## Locked Context

Architecture: Cloudflare Worker/API, one Charger DO per charger/OCPP identity,
Cloudflare Queues for ingest, Neon for relational truth. Idle heartbeat target
is 1 hour. Active-session telemetry intervals are TBD from real charger data.
Heartbeats should not become permanent high-volume DB rows.

Known work:

- `E:\Claude\Straumvakt-beta-production` has OCPP cost checkers/gates.
- `E:\Claude\Straumvakt-relops-b` has scratch heartbeat fast path,
  per-connector frame cap, dependency-free vitest config.
- Do not assume these are merged. Reconcile them.

## Worktrees

Primary write target:

```text
E:\Claude\Straumvakt-beta-production
```

Read-only comparison:

```text
E:\Claude\Straumvakt-relops-b
E:\Claude\Straumvakt-release-candidate
E:\Claude\Straumvakt
```

## Hard Rules

No push, deploy, DNS/Cloudflare mutation, Neon mutation, SQL mutation, GitHub
remote mutation, hardware/OCPP command, delete/move/archive, or new top-level
`E:\Claude` folder. Avoid `node_modules`, `.next`, build output, screenshots,
and caches.

## Phases

1. Record start UTC, branch/tip/dirty state for beta-production and relops-b,
   release-candidate tip, recent commits after `c8bd022` / `d9ed8f0`.
2. Audit gates: heartbeat enqueue fast-path, heartbeat reply still sent,
   per-connector frame cap, DO hibernation, queue binding/config,
   workers_dev/domain foot-gun, no permanent heartbeat persistence, no fake
   active-session interval.
3. For each gate record where implemented, what it proves, what it misses,
   fixtures, known-bad coverage, false positives, and whether regular checks
   include it.
4. Reconcile relops-b scratch implementation against beta-production:
   runtime source changes, test/config changes, docs/checker changes,
   safe-to-carry-forward vs scratch-only.
5. Prepare the real charger measurement plan for ZPR074002/Zaptec/FEV300:
   what to measure, where, expected OCPP messages, idle heartbeat proof,
   active telemetry intervals, queue ops, DO invocations, Neon writes,
   missed-heartbeat/offline detection, cost-per-connector projection.
6. Build Cloudflare/Neon release checklist: Worker version IDs, queue binding,
   DO namespace, route/custom-domain, workers_dev, DSO POC exclusion,
   Neon protection, metrics/alert sink, rollback evidence.
7. Update Core cloud OPEX assumptions in ISK/formulas: idle heartbeat fast
   path, 1h heartbeat, per-connector cap, no permanent heartbeat row,
   disposable-heartbeat queue suppression, unknown active-session interval,
   noisy charger containment.

## Required Deliverables

Inside `E:\Claude\Straumvakt-beta-production`:

- `docs/notes/2026-08-10-ocpp-cost-gate-audit.md`
- `docs/notes/2026-08-10-real-charger-measurement-plan.md`
- `docs/notes/2026-08-10-cloudflare-neon-release-readiness-checklist.md`
- `docs/notes/2026-08-10-core-cloud-opex-assumptions.md`

Completion artifact:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-b-release-ops-ocpp-cost-gates-completion.md
```

If practical, also write JSON sidecar next to it.

## Verification

Run existing offline checkers/self-tests if available. Do not install
dependencies. Verify no external mutation, no new top-level folder, no large
generated output, no branch push, no deletion/move/archive.

## Final Handoff

Chat response: short TL;DR and path to completion artifact.

Completion artifact must include start/end UTC, wall-clock duration, whether
4-8h target was met, start/end tips, dirty/clean state, files changed, commits,
tests/checks, gates passing/failing, release blockers, external confirmation,
cleanup candidates, and next action.
