---
agent: claude-a
status: superseded
superseded_by: 2026-08-18\2026-08-18-1415-claude-a-core-billing-integration-and-blocker-burn-down.md
superseded_utc: 2026-08-18T14:15:00Z
superseded_reason: dispatched 2026-08-11, never fired - no commit on any branch after 2026-08-11T09:33:29Z
lane: core-billing-merge-blocker-burn-down
created_utc: 2026-08-11T09:55:00Z
worktree: E:\Claude\Straumvakt-core-billing
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-merge-blocker-burn-down-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-merge-blocker-burn-down-completion.json
target_wall_clock: 4-8h
very_tldr: Burn down Core billing merge blockers: money display, tenant scoping, CDR org filter, double-billing idempotency, persistence merge plan.
---

# Claude A Prompt — Core Billing Merge-Blocker Burn-Down

You are `claude-a`. Execute this prompt only after Andri says `go` and only if `E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude A to this file. Verify this header says `agent: claude-a` and `status: ready` before doing anything.

## Operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing` unless this prompt explicitly says read-only comparison elsewhere.
2. Do not create new top-level folders under `E:\Claude`.
3. Do not push, deploy, run live migrations, mutate Neon/Cloudflare/GitHub, query production/staging personal rows, command chargers, touch BLE/NFC, or touch hardware.
4. Local code edits, local tests, generated local migrations, and local commits are allowed on the existing scratch branch.
5. No cleanup, deletion, prune, reset, branch deletion, or worktree retirement.
6. Start by recording branch, start tip, dirty state, and whether prior A completion files exist.
7. Record start/end UTC and wall-clock. Target 4-8h. If under 4h, explain exactly why and which fallback items were completed. Do not pad time.
8. Write completion Markdown and JSON at the paths in this header. JSON must include: agent, status, start_utc, end_utc, wall_clock_seconds, target_met, worktree, branch, start_tip, end_tip, dirty, commits, files_changed, tests, blockers, next_actions, external_state, very_tldr.
9. Commit only coherent local slices with checks. Do not amend prior commits.
10. Preserve peer changes. If target files are dirty and not yours, stop and report.

## Context

Locked Core: Iceland-only AC charging operations for MDUs/workplaces. Core includes connectors, drivers, access, DSO/network rates, retailer rates, CPO add-on, plug-time fee with grace, driver billing material, org statements/exports, delivery log, reporting and standard telemetry.

Locked commercial model:

- `200 kr / active connector / month`
- `50 kr / active driver / month`
- capped at `450 kr / connector / month`

Recent A run found:

- Core billing calculation library existed but was mostly unreachable.
- 11 persistence tables were declared/generated offline and committed but unapplied.
- Two by-id session reads were tenant-hardened.
- Launch blockers: double-billing from count-then-insert outside transaction with no unique constraint; Zaptec CDR import resolves driver by token value without org filter; driver money endpoints render aurar as krónur; active connector/driver source still missing; plug-time input still missing.

Your job is now to burn down merge blockers, not merely describe them.

## Primary objective

Make Core billing safer and closer to merge by implementing every blocker that can be solved locally without a live DB, and by producing exact merge-ready patches/specs for blockers that require migration or product decision.

Prioritize in this order:

1. Fix aurar-as-krónur display defects in driver money endpoints and tests.
2. Fix or isolate CDR driver resolution without org filter, or prove the safe local patch needs a schema/route dependency.
3. Eliminate or gate double-billing risk in any local pure/repository code you can reach without applying migration.
4. Expand tenant-scoping hardening for billing reads/writes where safe.
5. Convert generated billing persistence into a staged merge plan: what lands now, what waits for DB migration, what needs feature flag/rollback.
6. Define the active connector/driver source in code/contracts/tests if possible; otherwise make the missing data impossible to fake in UI/API.
7. Define plug-time input boundary and rejection behavior until unplug/charging-cease timestamps exist.

## Phase 0 — Start-state verification

Record:

- branch
- start tip
- dirty state
- recent 10 commits
- generated migration files present
- prior completion doc paths present
- test commands available
- whether dependencies are present

Read, at minimum:

- `E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-persistence-api-survival-completion.md`
- current worktree `docs/notes/` docs from the last A run
- touched billing source files from the last 10 commits

## Phase 1 — Money display defect: fix live today

Find all places where aurar/minor units are rendered as krónur/ISK in driver/admin/org billing endpoints or UI-adjacent API responses.

Required:

- Locate every formatter/parser/converter touching money in driver money endpoints.
- Fix the known defect where `649.88 kr` displays as `64,988 kr`.
- Add regression tests using at least these values: 0, 1 aur, 50 aur, 100 aur, 64988 aur, negative adjustment, 45000 aur cap, large amount.
- Include tests proving web/mobile contract shape if those contracts exist locally.
- Add a source comment only if needed to explain aurar/ISK boundary.
- Fool-test by reverting the conversion and verifying a test fails.

If the defect is in a different worktree or only in docs, prove it and write the exact patch target instead.

## Phase 2 — CDR driver/org safety

Find the Zaptec CDR import path and token-to-driver resolution.

Required:

- Trace from CDR input to ledger/settlement/driver assignment.
- Identify where `orgId`, charger/site/org ownership and token value meet.
- Implement org-scoped lookup if local schema/repository supports it.
- If not implementable, add a guard that refuses ambiguous unscoped resolution and tests it.
- Add tests for: same token in two orgs, unknown token, token belongs to other org, disabled token, historical token, missing org context, CDR mismatch.
- Do not print or export real token values.
- Fool-test by removing the org filter/guard.

## Phase 3 — Double-billing/idempotency hardening

Find all statement/ledger/session billing writers that count-then-insert, generate line numbers, or rely on handler code instead of unique constraints.

Required:

- Implement pure idempotency/identity functions where possible.
- Add tests for overlapping cron/generate/retry behavior.
- If a unique constraint/migration is required, ensure the generated schema/migration has it and the route/service contract refuses to proceed without idempotency key.
- Produce exact SQL preflight queries for duplicate detection before migration.
- Add a small static checker or test that statement identity remains deterministic.
- Fool-test by allowing duplicate generation.

## Phase 4 — Tenant scoping burn-down

Use the 310-row census and current source to pick the next safest scoping fixes.

Required:

- Classify all remaining billing gates into: safe to fix now, blocked by route shape, global by design, needs platform support context, needs product decision.
- Implement at least two safe scoping fixes if available.
- Add cross-tenant tests for each.
- Do not break bootstrap/operator workflows without documenting and testing the alternative.
- Update the orgId-param checker allowlist; if the allowlist shrinks, prove it fails if stale.

## Phase 5 — Active connector/driver source

Core price model depends on active connector/month and active driver/month.

Required:

- Find every possible source of connector activity and driver activity.
- Decide whether the source is: existing reliable, existing unreliable, missing, or derivable from settlement snapshots.
- Implement pure derivation from settlement/connector history if possible.
- If not possible, define the exact table/DTO/repository contract and disabled API behavior.
- Add tests for 0 connectors with N drivers, 1 connector/1 driver, 1 connector/10 drivers capped at 450 kr, inactive connector, driver with zero sessions, driver with one session, connector active but no driver, historical month.
- Explicitly state whether active driver means “used charger at least once that month” and enforce that in code/tests or document as decision.

## Phase 6 — Plug-time input boundary

Core includes plug-time fee with grace. Existing source may lack unplug or charging-ceased timestamp.

Required:

- Locate current session timestamps and OCPP status events.
- Determine whether plug-time can be computed correctly today.
- If no, implement a refusal/hold reason so UI/API cannot bill plug-time from guessed data.
- Add tests for grace period, one second after grace, missing unplug time, missing charging end, unplug before stop, status-only evidence, UTC/Iceland date boundary.
- Write follow-up contract for what OCPP/status/session event must be persisted.

## Phase 7 — Route/API survival patch

Implement or refine route contract tests for:

- commit settlement snapshot
- generate statement preview
- commit statement
- retry delivery
- export statement
- driver reads own billing material
- org admin reads own org statement material
- admin/support reads tenant material with support context

If routes cannot be implemented without applied DB migration, create compile-checked DTOs/pure handlers and tests that prove disabled behavior rather than fake success.

## Phase 8 — Market launch merge plan

Create/update one doc under `docs/notes/` with a strict merge order:

- apply-now code fixes
- schema migration preflight
- schema migration
- repository writes
- route enablement
- UI enablement
- observability/alert dependencies
- rollback plan
- test command for each step
- launch gate for each step

Mark each item as merge-now, migration-gated, decision-gated, or blocked.

## Phase 9 — Checks and fool tests

Run relevant local checks. Minimum attempt:

- focused money/billing tests
- CDR/import tests
- tenant scoping checker
- package typecheck
- root test suite
- root typecheck/check if feasible

Run at least 8 fool tests total across phases and record each sabotage/failure/restore.

## Phase 10 — Completion

Write the completion Markdown and JSON. The Markdown must include:

- TL;DR
- time and target met/not met
- start/end tips
- commits
- files changed
- checks run
- what landed
- what remains blocked
- launch blocker status table
- corrected findings
- exact next actions for Andri/Codex/Claude B
- external-state confirmation

## Fallback queue if under 4 hours

Exhaust at least 10 of these 14 before stopping under 4h:

1. Add 20 more money edge cases.
2. Add 20 CDR mismatch/provenance scenarios.
3. Add 20 cross-tenant billing scenarios.
4. Add 20 idempotency/retry scenarios.
5. Add 30 issue-ready work packages.
6. Add an API examples appendix with 20 payloads.
7. Add SQL preflight/rollback pack.
8. Add UI contract note: interactive/read-only/disabled/hidden.
9. Add operator runbook for statement regeneration.
10. Add privacy/security review for billing material.
11. Add a migration risk matrix.
12. Add a test coverage gap map.
13. Add a second-pass correction audit with at least 10 entries.
14. Run final diff review and list at least 10 review questions/comments.
