---
agent: claude-a
lane: market-core-backend-readiness
status: ready
created_utc: 2026-08-10T23:05:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-core-billing
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-a-market-core-backend-readiness-completion.md
external_mutation_allowed: false
---

# Claude A — Market Core Backend Readiness

## Very TL;DR

Move Straumvakt Core backend from scattered findings toward a market-ready
implementation plan: billing/pricing/access/session truth, exact merge order,
schema/API decisions, and tests that must pass before first customer.

## Goal

Create the backend readiness package for Straumvakt Core launch. This is not
another abstract analysis packet. It must produce a concrete, implementation-
ready sequence for the Core product spine:

```text
organisation -> chargers/connectors -> drivers/access -> pricing -> session ->
settlement -> driver statement -> organisation billing material/report
```

## Locked Product Decisions

Straumvakt operates in Iceland only.

Straumvakt Core is AC charging operations for MDUs and workplaces:

- connectors
- drivers
- access
- pricing
- billing material
- reporting
- standard telemetry

Core commercial model:

- 200 kr / active connector / month
- 50 kr / active driver / month
- capped at 450 kr / connector / month

Core billing includes:

- DSO/network rates
- electricity retailer rates
- CPO add-on
- plug-time fee with grace period
- clear invoice/billing material per driver
- organisation statement/export material
- delivery log
- versioned/effective-dated rates
- rate lock-in at session start

Core excludes for launch:

- DC charger productization
- OCPI/roaming
- Plug & Charge
- OpenADR automation
- contractor Service UI as a live Core product
- Samgöngustofa market-data work

## Locked Cloud/Backend Context

- Business truth: Neon Postgres.
- D1 is rejected for Core business truth.
- Runtime: Cloudflare Workers.
- OCPP state: one Charger Durable Object per charger/OCPP identity.
- Queues: meaningful events only.
- Metrics: Workers Analytics Engine.
- Errors/traces: Sentry + Cloudflare observability.
- Files/exports/debug bundles: R2.
- Internal protection: Cloudflare Access.
- Billing/report jobs: Cloudflare Workflows only if useful and cost-visible.

## Worktree

Primary:

```text
E:\Claude\Straumvakt-core-billing
```

Read-only reference:

```text
E:\Claude\Straumvakt
E:\Claude\Straumvakt-release-candidate
E:\Claude\Straumvakt-onboarding-web
```

Do not write into canonical except the completion artifact.

## Hard Rules

- No push.
- No deploy.
- No database mutation.
- No SQL mutation.
- No Cloudflare/Neon/DNS/GitHub remote mutation.
- No hardware/OCPP/BLE/NFC action.
- No new top-level `E:\Claude` folder.
- Avoid `node_modules`, `.next`, build output, screenshots, caches.
- Preserve peer work. Do not reset/clean/revert unrelated changes.

## Phase 0 — Start State

Record start UTC, branch, tip, dirty state, recent commits, and whether prior
commercial/billing commits are present. If dirty, inspect before writing.

## Phase 1 — Market Core Backend Census

Inventory source and tests for:

- organisation onboarding/readiness
- charger/connector onboarding
- driver onboarding/access
- driver groups/access grants
- session/projection/ledger
- DSO rate reads/writes
- retailer rate reads/writes
- CPO add-on/cost factors
- plug-time rules
- billing period close
- statement/invoice material
- delivery log
- audit/provenance
- cross-tenant permission gates

Deliver a table with:

- workflow
- current implementation state
- production caller
- test state
- data model state
- security risk
- market-readiness verdict
- exact blocker

## Phase 2 — Decisions To Lock Or Escalate

For each open backend decision, either recommend a lock or mark explicitly
human-required:

- exact schema changes
- exact API/write surface
- merge order
- rate lock-in behavior
- rounding edge cases
- VAT/tax placeholders
- CDR mismatch policy
- plug-time anchor/grace
- statement/export formats
- which UI parts become interactive before write APIs

Use the current lock recommendations unless source evidence contradicts them:

- rate lock-in at session start
- internal aurar, final line rounded to ISK
- statement total is sum of rounded lines
- CDR mismatch beyond tolerance -> billing_review_required
- plug-time anchor = charging_end, grace after charging stops
- partial minutes round down
- no silent mutation of closed periods
- CSV + human-readable statement first; bank/e-invoice adapters later

## Phase 3 — Schema/API Package

Design a minimal Core V1 backend surface:

- tables
- DTOs
- routes
- permissions
- audit events
- idempotency keys
- validation rules
- migration order
- rollback plan

Must cover:

- DSO rates
- retailer rates
- CPO add-on
- plug-time/grace rules
- price-rule versioning
- session settlement snapshot
- billing statements/lines
- delivery log

## Phase 4 — Merge Plan

Produce a strict sequence:

1. Pure commercial library/tests.
2. CI/static guards.
3. Schema migrations.
4. Repository/API writes.
5. Authorization/audit hardening.
6. Period close/statement generation.
7. UI interactivity unlocks.

For each slice:

- files likely touched
- tests required
- migration required
- feature flag required
- risk
- rollback
- reviewer checklist
- done definition

## Phase 5 — Test And Acceptance Matrix

Create a launch acceptance matrix with at least 80 rows across:

- billing math
- energy meter semantics
- rate effective dates
- DSO/retailer/CPO layering
- plug-time/grace
- CDR mismatch
- statement total invariants
- delivery log idempotency
- cross-tenant negative tests
- support/audit actions
- driver access/session authorization
- migration/rollback

Mark each as existing, missing, blocked, or future.

## Phase 6 — Issue-Ready Work Packages

Create at least 40 issue-ready implementation packages. Each must include:

- title
- lane
- why it matters
- files/systems touched
- acceptance criteria
- tests
- dependency
- risk

## Deliverables

Create/update inside `E:\Claude\Straumvakt-core-billing`:

- `docs/notes/2026-08-10-market-core-backend-readiness.md`
- `docs/notes/2026-08-10-core-schema-api-package.md`
- `docs/notes/2026-08-10-core-launch-acceptance-matrix.md`
- `docs/notes/2026-08-10-core-backend-work-packages.md`

Completion artifact:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-a-market-core-backend-readiness-completion.md
```

Also write JSON sidecar if practical.

## Verification

Run available safe tests/checks. Do not install dependencies. If dependencies
are missing, report. Verify no external mutation and no generated clutter.

## Final Handoff

Short chat TL;DR with path to completion artifact. The completion file must
include timing, target met yes/no, start/end tips, dirty state, files changed,
commits, checks run, launch blockers, decisions locked, decisions still human,
cleanup candidates, and next action.
