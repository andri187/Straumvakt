---
agent: claude-a
lane: core-billing-ledger-implementation
status: ready
created_utc: 2026-08-11T00:05:00Z
estimated_wall_clock: 4h
target_worktree: E:\Claude\Straumvakt-core-billing
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-ledger-implementation-completion.md
external_mutation_allowed: false
---

# Claude A — Core Billing Ledger Implementation

## Very TL;DR

Stop at nothing short of a reviewable local implementation slice for Core billing
records: settlement snapshot, billing period, statement/lines, delivery log
integration, tests, and exact schema/API follow-up.

## Goal

Move Straumvakt Core billing from "math is tested" to "durable billing records
are implementable and locally verified." Previous work concluded that arithmetic
exists but the record is missing: no billing period, no statement, no settlement
snapshot, no rate lock-in, no enablement history. This prompt is to implement
the next safe local slice and produce the remaining schema/API work as a direct
follow-up, not another broad analysis.

## Locked Context

Straumvakt Core is Iceland-only AC charging for MDUs/workplaces:

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

Core billing must include DSO/network rates, retailer rates, CPO add-on,
plug-time fee with grace, clear per-driver billing material, organisation
statement/export material, delivery log, versioned/effective-dated rates, and
rate lock-in at session start.

## Known Prior Art To Read First

Read these before editing:

- `E:\Claude\Straumvakt-core-billing\docs\notes\2026-08-10-market-core-backend-readiness.md`
- `E:\Claude\Straumvakt-core-billing\docs\notes\2026-08-10-core-schema-api-package.md`
- `E:\Claude\Straumvakt-core-billing\docs\notes\2026-08-10-core-launch-acceptance-matrix.md`
- `E:\Claude\Straumvakt-core-billing\docs\notes\2026-08-10-core-backend-work-packages.md`
- `packages/commercial/src/core-billing/`
- `packages/commercial/src/index.ts`

Do not trust the docs blindly. Verify source and tests.

## Hard Rules

- No push.
- No deploy.
- No live database/SQL mutation.
- No Cloudflare/Neon/DNS/GitHub remote mutation.
- No hardware/OCPP/BLE/NFC action.
- No new top-level `E:\Claude` folder.
- Avoid `node_modules`, `.next`, build output, screenshots, caches.
- Preserve peer work. Do not reset/clean/revert unrelated changes.

## Phase 0 — Start State

Record:

- Start UTC.
- Branch.
- Tip.
- Dirty/clean state.
- Recent 10 commits.
- Whether prior readiness docs and modules exist.

If dirty, inspect before editing.

## Phase 1 — Implementation Target Selection

Pick the largest safe local implementation slice that can be verified without a
live DB. Default target:

1. Pure settlement snapshot builder.
2. Billing period close model.
3. Statement and statement-line generator.
4. Delivery-log integration in pure module form.
5. Explicit invariant checks.

If source proves a better slice exists, choose it and explain why.

The implementation should live under existing package boundaries, preferably:

```text
packages/commercial/src/core-billing/
```

Do not add a new framework.

## Phase 2 — Implement Settlement Snapshot

Create/extend pure modules that can produce a durable settlement snapshot with:

- organization id
- driver id / account id where available
- connector/session identity
- session start/stop timestamps
- rate version identifiers
- energy Wh/kWh
- DSO component
- retailer component
- CPO add-on component
- plug-time component
- VAT/tax placeholders
- rounding basis
- total in aurar
- review flags
- provenance: OCPP / CDR / manual / unknown

Required behavior:

- rate inputs are locked at session start
- later price edits do not change a snapshot
- CDR mismatch beyond tolerance creates `billing_review_required`
- impossible/missing values create review state, not silent settlement

## Phase 3 — Implement Billing Period / Statement Pure Flow

Create/extend pure modules for:

- opening/closing a billing period
- grouping settlement snapshots into driver statement lines
- grouping driver lines into organisation statement material
- idempotency key / deterministic statement identity
- statement total invariants
- delivery-log event generation

Do not claim this writes to DB unless it actually does. A pure flow is acceptable
if it is reviewable, tested, and maps exactly to future schema.

## Phase 4 — Tests

Add substantial tests. Minimum target: 60 new focused assertions across:

- session-start rate lock
- DSO/retailer/CPO layering
- plug-time grace
- rounding to ISK line totals
- statement total = sum of rounded lines
- CDR mismatch
- missing rate -> review-required
- duplicate period close/idempotency
- delivery log event generation
- no mutation of closed period
- one org cannot bleed into another

Use existing test style. Do not install dependencies.

## Phase 5 — Schema/API Follow-Up

Update or create a concise follow-up doc:

```text
docs/notes/2026-08-11-core-billing-ledger-schema-api-followup.md
```

It must include:

- exact tables still needed
- migration order
- routes still needed
- repository functions still needed
- permissions/audit events
- UI unlock dependencies
- remaining launch blockers

## Phase 6 — Acceptance Matrix Update

Update or create:

```text
docs/notes/2026-08-11-core-billing-ledger-acceptance-update.md
```

Include:

- tests now passing
- acceptance criteria newly satisfied
- criteria still blocked by schema/API
- criteria still human-decision-gated

## Required Deliverables

At minimum:

- source modules under `packages/commercial/src/core-billing/`
- tests beside them
- `docs/notes/2026-08-11-core-billing-ledger-schema-api-followup.md`
- `docs/notes/2026-08-11-core-billing-ledger-acceptance-update.md`

Completion artifact:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-ledger-implementation-completion.md
```

Also write JSON sidecar:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-ledger-implementation-completion.json
```

## Verification

Run focused tests for changed modules. Run package/commercial typecheck if
available. Run broader tests only if safe and already configured. No dependency
install unless already present and needed.

## If You Finish Early

Do not stop after the first green test. Continue with, in order:

1. Add more money-path edge cases.
2. Add cross-tenant/idempotency tests.
3. Add schema/API follow-up detail.
4. Add reviewer checklist.
5. Add Codex UI unlock list.
6. Re-read your own implementation and add a correction section.

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
- What remains schema/API-only.
- Launch blockers.
- External state confirmation.
- Cleanup candidates.
- Next recommended action.
