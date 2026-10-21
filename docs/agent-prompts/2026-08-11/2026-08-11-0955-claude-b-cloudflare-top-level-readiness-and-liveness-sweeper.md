---
agent: claude-b
status: superseded
superseded_by: 2026-08-18\2026-08-18-1415-claude-b-market-rails-invoice-delivery-and-collection.md
superseded_utc: 2026-08-18T14:15:00Z
superseded_reason: dispatched 2026-08-11, never fired - no commit on any branch after 2026-08-11T09:33:29Z
lane: cloudflare-top-level-readiness-and-liveness-sweeper
created_utc: 2026-08-11T09:55:00Z
worktree: E:\Claude\Straumvakt-relops-b
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-top-level-readiness-and-liveness-sweeper-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-top-level-readiness-and-liveness-sweeper-completion.json
target_wall_clock: 4-8h
very_tldr: Fix or fully gate top-level Cloudflare event architecture and missed-heartbeat liveness, with release-ready config/readiness proof.
---

# Claude B Prompt — Cloudflare Top-Level Readiness and Liveness Sweeper

You are `claude-b`. Execute this prompt only after Andri says `go` and only if `E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points Claude B to this file. Verify this header says `agent: claude-b` and `status: ready` before doing anything.

## Operating rules

1. Work only in `E:\Claude\Straumvakt-relops-b` unless this prompt explicitly says read-only comparison elsewhere.
2. Do not create new top-level folders under `E:\Claude`.
3. Do not push, deploy, bind domains, change DNS, mutate Cloudflare, mutate Neon, mutate GitHub remote, query live SQL, command chargers, touch BLE/NFC, or touch hardware.
4. Local source/config/checker edits and local commits are allowed on the existing scratch branch.
5. Cloudflare access, if present, is read-only only. Do not read/print token values or secret values. Do not use mutating endpoints.
6. No cleanup/deletion/prune/reset/worktree retirement.
7. Record start/end UTC and wall-clock. Target 4-8h. If under 4h, explain exactly why and which fallback items were completed. Do not pad time.
8. Write completion Markdown and JSON at the header paths. JSON must include: agent, status, start_utc, end_utc, wall_clock_seconds, target_met, worktree, branch, start_tip, end_tip, dirty, commits, files_changed, checks, findings, blockers, next_actions, external_state, very_tldr.
9. Commit coherent local slices. Do not amend prior commits.
10. Preserve peer changes. If target files are dirty and not yours, stop.

## Context

Locked architecture:

- Workers for web/API/OCPP.
- One ChargerDO per charger/OCPP identity.
- Queues for meaningful events only.
- Neon for business truth.
- Analytics Engine for connector/OCPP economics.
- Sentry + Cloudflare observability.
- R2 for exports/debug bundles.
- Access for internal tools.
- Workflows only for billing/report jobs if useful and cost-visible.
- Heartbeats are liveness buffers, not log data.
- Normal heartbeat updates liveness only.
- Missed heartbeat must create an event.
- Noisy charger detection/constraints are Core.

Recent B run found:

- Event-driven architecture exists only in staging: top-level lacks queue producer, consumer, DLQ and R2.
- Missed heartbeats create no event; liveness is computed only when frames arrive.
- Top-level is NO-GO; staging GO only after version metadata/rollback capture.
- Observability gates OB16-OB28 exist and flagged real gaps.

Your job is to move the top-level release posture from “documented NO-GO” to either “locally fixed and gateable” or “exactly blocked with one human approval/action per blocker”.

## Primary objective

Make the Cloudflare OCPP/Core operations path release-ready locally by addressing two concrete blockers:

1. Top-level event architecture missing queue producer/consumer/DLQ/R2/version metadata.
2. No missed-heartbeat event/sweeper path.

Where implementation is locally safe, implement it. Where Cloudflare mutation or deployment confirmation is required, build fail-closed gates, exact config patches, and operator runbooks.

## Phase 0 — Start-state verification

Record:

- branch
- start tip
- dirty state
- dependency availability
- prior B completion file path exists
- recent 10 commits
- current gate results before edits
- whether wrangler is authenticated, without printing tokens
- whether Cloudflare read-only commands are available, without mutating

Read:

- `E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-cost-observability-release-drill-completion.md`
- latest B docs/notes in this worktree
- current gateway source and wrangler configs

## Phase 1 — Top-level Cloudflare config patch or explicit hold

Inspect all wrangler/config files for top-level, staging, production, preview, local.

Required:

- Determine exactly what top-level must declare for queue producer, queue consumer, DLQ, R2 bucket, version metadata, Analytics Engine binding, Sentry DSN env, worker routes/custom domains, workers_dev.
- If local config can be safely patched without secret values and without deployment, patch it with placeholders/comments matching project conventions.
- If patching top-level would risk live behavior when later deployed, implement a commented/staged config block plus a gate that fails until explicit activation.
- Ensure staging remains working and unchanged unless needed.
- Add fixtures for: top-level missing producer, missing consumer, missing DLQ, missing R2, missing version metadata, routes disabling workers_dev, inherited config, env override, invalid JSONC, commented placeholder not counted as live.
- Update release drill to identify exactly what Andri must create in Cloudflare dashboard, with names but no secrets.

## Phase 2 — Missed-heartbeat liveness sweeper

Design and implement local source for missed-heartbeat event detection.

Required:

- Trace current ChargerDO heartbeat/liveness storage.
- Identify where expected next heartbeat is written.
- Decide whether sweeper belongs in ChargerDO alarm, scheduled Worker, queue consumer, Workflow, or API cron. Compare pros/cons briefly.
- Implement the smallest safe local mechanism if possible. If not safe to wire live, implement pure sweeper logic plus tests and a gated adapter.
- It must emit an event only on transition from online/expected to missed/offline, not every sweep.
- It must recover on next heartbeat and emit recovery event once.
- It must not persist raw heartbeat payloads.
- It must include per-connector/org/site identity enough for alerting without leaking credentials/idTags.
- It must tolerate clock skew, delayed queues, and changed heartbeat interval.
- Add tests for: normal on-time heartbeat, late heartbeat within grace, missed heartbeat, repeated missed sweeps no duplicate event, recovery, interval change, noisy charger, no prior heartbeat, disabled charger, site/org grouping.
- Fool-test by making it emit every sweep and proving test failure.

## Phase 3 — Queue/DLQ/R2 failure semantics

Build a failure-mode matrix and local gates for event transport.

Required:

- For every meaningful OCPP event class, classify: can drop, must retry, must persist, must alert, raw/debug only, billing material.
- Define queue message envelope with schema version, event id, charger identity, org/site, idempotency key, retention class, sensitive fields excluded.
- Add tests/checks that Heartbeat unchanged is not enqueued but BootNotification, Start/Stop, Authorize, StatusNotification changes, MeterValues if meaningful, and command responses are classified correctly.
- Define DLQ handling and R2 debug bundle shape without storing secrets.
- Add a gate that fails if queue producer exists without consumer or DLQ.
- Add a gate that fails if R2 debug bucket is referenced but not declared.

## Phase 4 — Observability integration survival

Harden Analytics/Sentry code from prior run.

Required:

- Verify metrics dimensions cannot explode cardinality.
- Verify metric names are closed vocabulary.
- Verify Sentry scrubber removes idTag, basic auth, query strings, charger credentials, kennitala, user, unknown future payload fields.
- Add tests for Cloudflare-specific event/request shapes if available.
- Add synthetic examples for OCPP gateway error spike, queue backlog growing, missed heartbeat rate, noisy charger cap breach, billing job failure, statement delivery failure.
- Decide which source owns each alert: Analytics Engine, Sentry, Queue metrics, Cloudflare logs, synthetic probe, DB query.

## Phase 5 — Read-only Cloudflare verification kit

If credentials are available, run read-only checks only. If not, write commands that Andri can run.

Required outputs:

- Project/account identity without token values.
- Pages/Workers service list commands.
- Worker version id capture commands.
- Queue/DLQ binding verification commands.
- R2 bucket existence verification commands.
- Analytics Engine binding/dataset verification commands.
- Sentry env/DSN presence verification without printing DSN.
- Routes/custom domains/workers_dev verification commands.
- Rollback target capture.

Every command must be labeled read-only or mutating. Mutating commands must be separated under “do not run until approved”.

## Phase 6 — Release go/no-go automation

Update or create a single command/checker that produces:

- GO staging / NO-GO staging
- GO top-level / NO-GO top-level
- exact failed rules
- exact human action to clear each failed rule
- cost multiplier if heartbeat interval is wrong
- version rollback readiness
- pinned hostname safety
- missing liveness sweeper status

It must be fixture-tested.

## Phase 7 — Cost model refinement

Extend the cost model with the missed-heartbeat sweeper and queue/DLQ/R2 shapes.

Include scenarios:

- 50 connectors, 500, 1000, 20000
- 1h heartbeat normal
- 60s heartbeat regression
- charger dies silently
- charger flaps every 5 minutes
- noisy 1 frame/s charger capped
- active session with TBD intervals
- all statements generated monthly
- queue backlog for 1h, 6h, 24h

Report multipliers, not fake exact kr if pricing is not locally sourced. Include which metric would reveal each scenario.

## Phase 8 — Runbooks and issue packages

Create/update docs for:

- missed heartbeat/offline incident
- noisy charger incident
- queue backlog incident
- DLQ drain/replay incident
- Sentry scrubber violation
- top-level release preflight
- rollback drill
- monthly billing/report job failure as code red
- Maps/DSO POC key/domain note if still relevant

Create at least 30 issue-ready packages with owner lane, acceptance criteria, tests, risk and dependency.

## Phase 9 — Checks and fool tests

Run all relevant local checks. Minimum attempt:

- observability checker self-test
- OCPP cost checker
- gateway dependency-free selftests
- release go/no-go checker
- config census
- cost model
- any available typecheck/test if dependencies exist

Run at least 8 fool tests and record sabotage/failure/restore.

## Phase 10 — Completion

Write completion Markdown and JSON. Markdown must include:

- TL;DR
- time and target met/not met
- start/end tips
- commits
- files changed
- checks run
- what landed
- release verdict staging/top-level
- blockers
- corrected findings
- exact next human actions
- external-state confirmation

## Fallback queue if under 4 hours

Exhaust at least 10 of these 14 before stopping under 4h:

1. Add 25 more config fixtures.
2. Add 25 more liveness sweeper edge tests.
3. Add 20 queue envelope examples.
4. Add 20 DLQ/replay scenarios.
5. Add 30 issue-ready packages.
6. Add an operator evidence-capture template.
7. Add a Cloudflare dashboard step-by-step checklist.
8. Add a no-secrets policy checker for evidence files.
9. Add a Sentry setup checklist.
10. Add an Analytics Engine dashboard specification.
11. Add a Cloudflare Access internal-tools proposal.
12. Add a Workflows vs scheduled Worker decision note.
13. Add a second-pass correction audit with at least 10 entries.
14. Run final diff review and list at least 10 review questions/comments.
