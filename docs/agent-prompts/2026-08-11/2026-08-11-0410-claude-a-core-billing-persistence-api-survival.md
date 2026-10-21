---
agent: claude-a
status: ready
lane: core-billing-persistence-api-survival
created_utc: 2026-08-11T04:10:00Z
worktree: E:\Claude\Straumvakt-core-billing
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-persistence-api-survival-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-persistence-api-survival-completion.json
target_wall_clock: 4-8h
very_tldr: Turn Core billing pure logic into a persistence/API survival slice with schema map, route contracts, tests, and merge ordering.
---

# Claude A Prompt — Core Billing Persistence/API Survival Run

You are `claude-a`. Execute this prompt only if Andri says `go` and the dispatch row in `E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points to this file. Before doing work, verify this header says `agent: claude-a` and `status: ready`.

## Non-negotiable operating rules

1. Work only in `E:\Claude\Straumvakt-core-billing` unless this prompt explicitly names another path for read-only comparison.
2. Do not create any new top-level folder under `E:\Claude`.
3. Do not push, deploy, run live migrations, mutate Cloudflare, mutate Neon, mutate GitHub remotes, query personal rows, command chargers, use BLE/NFC, or touch hardware.
4. Local source edits are allowed on the existing scratch branch. If you are not on a scratch branch, stop and report.
5. Do not delete build output or folders. No cleanup work in this lane.
6. If you need database facts, use source/schema/tests only unless a local disposable database already exists in this worktree. Do not connect to staging or production unless the prompt specifically authorizes it. This prompt does not authorize it.
7. Record wall-clock start and end UTC. Target is 4-8 hours. If you finish under 4 hours, you must explain exactly what bounded the work and which fallback phases you completed. Do not pad time.
8. Write the completion files named in the header. The Markdown completion must start with a human-readable TL;DR. The JSON completion must include: agent, status, start_utc, end_utc, wall_clock_seconds, target_met, worktree, branch, start_tip, end_tip, dirty, commits, files_changed, tests, blockers, external_state, very_tldr.
9. Commit local work if and only if the worktree is cleanable and tests/checks you claim have run. Use small commits by slice. Do not amend earlier commits.
10. Preserve peer work. Read other worktrees only when named below and only for comparison.

## Context you must preserve

Straumvakt Core is locked as Iceland-only AC charging operations for MDUs and workplaces: connectors, drivers, access, pricing, billing material, reporting, and standard telemetry.

Commercial model is locked:

- `200 kr / active connector / month`
- `50 kr / active driver / month`
- capped at `450 kr / connector / month`

Core billing includes:

- DSO/network rates
- electricity retailer rates
- CPO add-on
- plug-time fee with grace
- driver billing material
- organisation statements/exports
- delivery log
- versioned/effective-dated rates
- rate lock-in at session start
- CDR/meter trust handling
- Iceland-only tax/currency framing for now

Recent Claude A work already delivered pure modules for money, settlement and statement logic. This run must move closer to market by finding and implementing the next persistence/API slice that can survive contact with the codebase.

## Primary objective

Produce a merge-ready or near-merge-ready backend survival slice that answers this question:

> What exact schema, repository, route/API, permission, audit, and test changes are needed so Core billing can persist settlement snapshots and statement material without lying, leaking cross-tenant data, or inventing unavailable inputs?

You are expected to implement safe local code where the shape is clear, and write precise follow-up specs where a decision or migration blocks implementation. This is not a docs-only prompt unless the source proves implementation would be unsafe.

## Required source areas to inspect

Use `rg` if available; otherwise use PowerShell/native equivalents. Inspect at minimum:

- `packages/commercial/src/core-billing/`
- `packages/commercial/src/index.ts`
- `apps/api/src/` billing, admin, driver, organisation and repository routes
- all schema sources in the worktree: Prisma, Drizzle, SQL migrations, generated types, or equivalents
- tests that mention billing, statements, invoices, sessions, cost factors, tariffs, DSO, retailer, CDR, meter, plug time, delivery log
- permission middleware and audit/event logging utilities
- route registration and OpenAPI/contract docs if present
- existing idempotency key handling
- any export/email/provider code used for statement delivery

Read-only comparison allowed:

- `E:\Claude\Straumvakt\docs\notes\` for locked decisions and agent-run notes
- `E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-ledger-implementation-completion.md`
- `E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-observability-implementation-completion.md`

## Phase 0 — Start state and branch safety

Record:

- branch
- start tip
- dirty state
- untracked files summary
- dependency/build output already present
- whether generated clients are present
- whether tests can run without installing dependencies

If dirty, classify each dirty file as yours/peer/pre-existing before touching anything. If ambiguity touches your target files, stop and report.

## Phase 1 — Billing persistence census, not from memory

Create a table with at least 120 rows in a doc under `docs/notes/` in this worktree. Each row should include:

- file path
- symbol/route/table/test name
- category: schema, route, repository, permission, audit, calculation, delivery, export, test, generated, unknown
- tenant scoping behavior
- idempotency behavior
- persistence behavior
- whether it is Core launch relevant
- whether it blocks market launch
- evidence line/reference

This is meant to stop repeated assumptions. Do not trust prior docs; re-read source.

Minimum required findings to confirm or refute:

1. Settlement snapshots have no durable table.
2. Statement material has no durable table.
3. Driver active-month and connector active-month do not have a reliable persisted source.
4. Plug-time billing lacks required stop/unplug or charging-ceased inputs.
5. Billing reads still have unscoped org surfaces.
6. DSO/rate definitions can leak cross-tenant or global data.
7. Delivery log has no durable provider-proof chain or has one.
8. Idempotency keys exist but may lack TTL/purge or route-specific scope.
9. Current statement/export formats are not final.
10. The API has no safe write surface for agreement/cost-factor/rate authoring or only partial one.

For each, mark: verified true, verified false, narrowed, or unknown.

## Phase 2 — Schema survival design

Produce a schema design that is concrete enough to implement. Include:

- `session_settlements`
- settlement component lines
- held/review reasons
- `billing_periods`
- `statements`
- `statement_lines`
- `statement_delivery_attempts`
- `driver_activity_month`
- `connector_activity_month`
- `rate_books` / rate windows / DSO/rate composition if absent
- any needed audit/event fields
- idempotency keys needed for generate/retry/export

For each table/field:

- ownership tenant/org scope
- natural key / uniqueness
- idempotency key
- rollback story
- migration order
- read path
- write path
- PII/secrets risk
- what test fails if omitted

Then inspect existing migration style and decide whether to implement a local migration proposal file, a real migration, or a docs-only migration draft. Implement only if it matches local patterns and does not require live DB.

## Phase 3 — API/write surface contract

Design and implement, where safe, the first route/repository contract layer for Core billing. At minimum produce contracts for:

- generate period settlement preview
- commit period settlement snapshot
- create/retry statement delivery
- list driver statements for org/admin context
- list own driver billing material
- export org statement material
- mark settlement hold/review resolution
- rate book effective-dated update

For each route:

- method/path
- request DTO
- response DTO
- permissions
- `orgIdParam`/scope derivation
- support-context behavior if platform staff
- idempotency behavior
- audit event
- failure modes
- disabled/UI behavior until backend lands

Implement DTO/types/tests if there is a local pattern. If a route implementation would require schema that does not exist, write compile-checked types or route contract tests around pure handlers rather than fake persistence.

## Phase 4 — Permission and tenant leak hardening plan

Find every billing/admin route involved in Core and classify:

- tenant-scoped correctly
- global by design
- global accidentally
- missing `orgIdParam`
- platform support-context needed
- needs new permission verb
- cannot be made safe without route shape change

Implement one safe local hardening if obvious and testable. Examples: route contract rejects missing org, repository signature requires orgId, pure service refuses cross-org snapshots. Do not break live operator workflows without documenting blast radius and tests.

## Phase 5 — Tests and fool tests

Minimum test requirements:

- Add or update at least 60 assertions across new/existing tests.
- Include at least 10 negative tests.
- Include at least 5 cross-tenant tests.
- Include at least 5 idempotency/retry tests.
- Include at least 5 CDR/meter trust tests.
- Include at least 5 rounding/rate-window edge tests.
- Include at least 5 statement/export/delivery edge tests.

Fool-test at least 5 sabotages:

- remove org scoping
- change rate lock from session start to statement date
- sum unrounded values instead of rounded lines
- allow CDR mismatch through as billable
- duplicate statement on retry
- leak another org's session id in excluded/held list
- accept rate window with overlapping effective periods

For each fool test, write what you broke, which test failed, and restore the file.

## Phase 6 — Build/check matrix

Run all checks that are locally available and relevant. Prefer exact commands from package scripts. At minimum attempt:

- core billing focused test suite
- relevant API tests if available
- package/commercial typecheck
- root test suite if feasible
- root typecheck if feasible
- static check command if available

If a command fails because of known unrelated failure, prove unrelated by running a narrower command or comparing file ownership. Do not claim green if only focused tests passed.

## Phase 7 — Merge ordering and market-readiness board

Create a market-readiness board with rows for:

- rate lock-in persistence
- settlement snapshots
- statement generation
- delivery attempts
- active connector/driver month source
- plug-time input
- CDR mismatch policy
- DSO/rate update authoring
- org export formats
- driver statement read surface
- tenant scoping hardening
- idempotency purge/TTL

Columns:

- current state
- implemented this run
- tests added
- blockers
- decision needed
- migration needed
- merge order
- UI readiness: interactive / read-only / disabled / hidden
- risk if shipped now

## Phase 8 — Second-pass correction audit

Before final commit, reread your own docs and code. Produce a correction section. You must explicitly answer:

- Which prior Claude A finding did this run refute or narrow?
- Which new code assumption was wrong on first attempt?
- Which TODO is a real blocker vs polish?
- Which part of this can be merged without DB migration?
- Which part must not be merged before schema exists?

Do not hide corrections in prose. List them.

## Phase 9 — Completion artifacts

Write:

1. The completion Markdown at the path in the header.
2. The completion JSON at the path in the header.
3. Any new docs under this worktree's `docs/notes/`.
4. If code changed, local commits with meaningful messages.

Completion Markdown must include:

- TL;DR
- elapsed time
- target met yes/no
- start/end tips
- files changed
- commits
- checks run
- what landed
- what remains blocked
- corrected findings
- next merge order
- external-state confirmation

Completion JSON must be machine-readable and include the keys listed in the operating rules.

## Fallback queue if primary work completes under 4 hours

Do not stop early until you have exhausted at least 8 of these 12 fallback items, unless they are impossible and you explain why.

1. Add a second independent route census pass by permission verb.
2. Create 30 issue-ready implementation packages for the next backend work.
3. Create 30 Gherkin scenarios for statement generation and delivery.
4. Create 20 API examples with valid/invalid payloads.
5. Create a migration rollback/preflight checklist.
6. Create a UI contract note for Codex: what is interactive/read-only/disabled/hidden.
7. Create a data-quality checklist for billing source rows.
8. Create a support/operator runbook for statement regeneration/retry.
9. Create a privacy/security note for driver billing material.
10. Create a rate-authoring UX/API handoff note.
11. Create a cross-tenant threat model for billing reads/writes.
12. Run a final source diff review and add at least 10 review comments/questions to the completion doc.

The target is useful progress, not idle time. If wall-clock is still under 4 hours, the completion must say exactly why.
