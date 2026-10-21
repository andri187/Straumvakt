---
agent: claude-a
lane: core-backend-billing
status: ready
created_utc: 2026-08-10T22:35:00Z
estimated_wall_clock: 4-8h
target_worktree: E:\Claude\Straumvakt-core-billing
completion_artifact: E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-a-core-backend-billing-apply-plan-completion.md
external_mutation_allowed: false
---

# Claude A — Core Backend Billing Apply Plan

## Very TL;DR

Turn the proven Core billing/security findings into an integration-ready backend
plan: merge-now slices, schema-needed slices, decision-needed slices, and exact
tests guarding the money path.

## Goal

Build the next backend/commercial bridge for Straumvakt Core. Reconcile the
recent `Straumvakt-core-billing` work into a concrete apply/merge plan with
code-level evidence, test requirements, and review-ready work packages.

## Locked Context

Straumvakt Core is Iceland-only AC charging for MDUs/workplaces: connectors,
drivers, access, pricing, billing material, reporting, and standard telemetry.

Core pricing:

- 200 kr / active connector / month.
- 50 kr / active driver / month.
- Cap at 450 kr / connector / month.

Core billing must cover DSO/network rates, retailer rates, CPO add-on,
plug-time fee with grace, clear per-driver billing material, organisation
statement/export material, versioned effective dates, Icelandic assumptions.

Known recent work in `E:\Claude\Straumvakt-core-billing` includes meter fix,
CDR invariant, provenance state machine, period close, pricing SSOT guard,
billing document delivery log, and commercial hardening notes. Re-read source;
do not trust chat summaries.

## Hard Rules

No push, deploy, database mutation, Cloudflare/Neon/DNS/GitHub remote mutation,
hardware/OCPP/BLE/NFC action, or new top-level `E:\Claude` folder. Avoid
`node_modules`, `.next`, build output, screenshots, and caches. Preserve all
peer work.

## Phases

1. Record start UTC, branch, tip, dirty state, recent commits, and diff since
   `bb43e72` if available.
2. Inventory commercial/billing source and tests:
   `packages/commercial/src/core-billing/`, `packages/commercial/src/index.ts`,
   pricing SSOT scripts, commercial hardening docs, API/repository callers.
3. Build a module table: purpose, production caller, tests, merge readiness,
   risk if wrong.
4. Verify the money path: meter semantics, CDR provenance, DSO/rate source,
   effective date, retailer/CPO add-on, plug-time grace, rounding, VAT/tax
   placeholder, delivery log, period close, statements.
5. Produce integration slices: safe pure-library merge, CI guard merge, schema
   prerequisites, API/repository write surface, UI contract enablement,
   statement/report enablement.
6. Design the missing write surface for DSO rates, retailer rates, CPO add-on,
   plug-time fee, grace, effective dating, rate lock-in, org overrides,
   permissions, audit, idempotency, validation.
7. Produce a test matrix: unit, contract, migration, authorization,
   cross-tenant negative, math edge cases, rounding/VAT placeholders, rate
   effective-date boundaries, plug-time boundaries, CDR mismatch,
   delivery-log idempotency.
8. Write a Codex UI contract: what may be interactive now, what must be
   disabled/read-only, exact disabled copy, fields never to fake, API responses
   needed to unlock.

## Required Deliverables

Inside `E:\Claude\Straumvakt-core-billing`:

- `docs/notes/2026-08-10-core-billing-apply-merge-plan.md`
- `docs/notes/2026-08-10-core-billing-test-matrix.md`
- `docs/notes/2026-08-10-core-billing-ui-contract.md`

Completion artifact:

```text
E:\Claude\Straumvakt\docs\agent-runs\2026-08-10\claude-a-core-backend-billing-apply-plan-completion.md
```

If practical, also write the JSON sidecar next to it.

## Verification

Run safe local checks available in the worktree, such as targeted
`packages/commercial` tests and TypeScript checks. Do not install dependencies
unless already available. If blocked by missing deps, report plainly.

## Final Handoff

Chat response: short TL;DR and link/path to completion artifact.

Completion artifact must include start/end UTC, wall-clock duration, whether
4-8h target was met, start/end tips, dirty/clean close state, files changed,
commits, tests, apply-now slices, needs-schema slices, needs-decision slices,
external state confirmation, cleanup candidates, and next action.
