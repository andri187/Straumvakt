---
agent: claude-b
status: ready
lane: cloudflare-cost-observability-release-drill
created_utc: 2026-08-11T04:10:00Z
worktree: E:\Claude\Straumvakt-relops-b
completion_md: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-cost-observability-release-drill-completion.md
completion_json: E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-cost-observability-release-drill-completion.json
target_wall_clock: 4-8h
very_tldr: Prove Cloudflare Core ops/cost readiness with config gates, observability wiring, release drill, and measured failure conditions.
---

# Claude B Prompt — Cloudflare Cost/Observability Release Drill

You are `claude-b`. Execute this prompt only if Andri says `go` and the dispatch row in `E:\Claude\Straumvakt\docs\agent-prompts\latest.md` points to this file. Before doing work, verify this header says `agent: claude-b` and `status: ready`.

## Non-negotiable operating rules

1. Work only in `E:\Claude\Straumvakt-relops-b` unless another path is explicitly named for read-only comparison.
2. Do not create any new top-level folder under `E:\Claude`.
3. Do not push, deploy, bind domains, change DNS, mutate Cloudflare, mutate Neon, mutate GitHub remotes, query live SQL, command chargers, use BLE/NFC, or touch hardware.
4. You may use read-only local CLI/config inspection. If Cloudflare credentials are present, do not use mutating calls. For Cloudflare API/wrangler, read-only metadata is allowed only if it does not expose secret values. Never print tokens, DSNs, keys, connection strings, or secret contents.
5. No cleanup, deletion, archive, prune, reset, or worktree retirement.
6. Local source edits are allowed on the existing scratch branch. If you are not on a scratch branch, stop and report.
7. Record wall-clock start and end UTC. Target is 4-8 hours. If you finish under 4 hours, explain exactly what bounded the work and which fallback phases you completed. Do not pad time.
8. Write completion Markdown and JSON at the paths in the header. The Markdown must start with a human-readable TL;DR. The JSON must include: agent, status, start_utc, end_utc, wall_clock_seconds, target_met, worktree, branch, start_tip, end_tip, dirty, commits, files_changed, checks, findings, blockers, external_state, very_tldr.
9. Commit local work if and only if the worktree is cleanable and checks you claim have run. Use small commits by slice. Do not amend prior commits.
10. Preserve peer work. Read other worktrees only when named below and only for comparison.

## Locked architecture to preserve

Straumvakt Core Cloud architecture is locked as:

- Cloudflare Workers for web/API/OCPP surfaces.
- One ChargerDO per charger/OCPP identity.
- Cloudflare Queues for meaningful events only, not unchanged heartbeat logging.
- Neon Postgres as business truth.
- Workers Analytics Engine for connector/OCPP economics and fleet telemetry economics.
- Sentry plus Cloudflare observability for errors/traces.
- R2 for exports/debug bundles.
- Cloudflare Access for internal/ops tools.
- Workflows only for billing/report jobs if useful and cost-visible.
- No SiteDO for Core launch, but model `site_id` now so a SiteDO can be introduced later.
- No multi-cloud abstraction project. Keep small seams only: `publishOcppEvent`, `recordConnectorMetric`, `billingRepository`, `archiveStatement`, `sendChargerCommand`.

Heartbeats are liveness buffers, not log data. A normal received heartbeat updates liveness only. A missed heartbeat creates an event. Unchanged heartbeats are not queued/persisted. Noisy charger detection/constraints are Core.

Recent Claude B work delivered heartbeat interval derivation, a metrics surface, Sentry scrubber, and observability gates. This run must make the release/ops/cost readiness executable and harder to fool.

## Primary objective

Produce a local, source-backed release drill that answers:

> Can the Cloudflare OCPP/Web/API estate ship the locked Core observability and cost controls without hidden 60x heartbeat cost, missing Sentry/Analytics bindings, unsafe secret exposure, unbounded noisy chargers, or a release that cannot be rolled back?

Implement safe local code/config/checkers where possible. Where credentials or production confirmation are required, produce exact read-only dashboard/API checklists and fail-closed local gates.

## Required source areas to inspect

Inspect at minimum:

- `gateway/src/`
- `gateway/wrangler.jsonc` or wrangler configs
- any API/web worker wrangler configs
- Cloudflare Pages config if present
- queue producer/consumer code
- Durable Object code
- boot/heartbeat handling
- metrics/observability code
- Sentry or error handling code
- scripts/analysis and release checkers
- docs/notes for release and Cloudflare findings
- package scripts and CI scripts
- any environment variable schema/auth code

Read-only comparison allowed:

- `E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-b-cloudflare-observability-implementation-completion.md`
- `E:\Claude\Straumvakt\docs\agent-runs\2026-08-11\claude-a-core-billing-ledger-implementation-completion.md`
- `E:\Claude\Straumvakt-beta-production\docs\notes\` for prior release packet only if local and read-only
- `E:\Claude\Straumvakt-release-candidate` for read-only config comparison only

## Phase 0 — Start state and branch safety

Record:

- branch
- start tip
- dirty state
- package/dependency availability
- generated output already present
- relevant running server/processes if visible without killing anything
- whether `wrangler whoami` works; do not require it
- whether Cloudflare API credentials appear available; do not read token contents

If dirty, classify files before editing. If dirty files overlap your target code and are not yours, stop.

## Phase 1 — Config and deployed-shape census

Create a table with at least 150 rows in a docs/notes file. Include:

- file path
- config key/symbol/route/binding/script
- Cloudflare product: Worker, DO, Queue, Analytics Engine, Sentry/env, R2, Pages, Access, Workflows, DNS/domain, unknown
- environment: top-level, staging, production, preview, local, unknown
- current value shape without secrets
- inheritance behavior if relevant
- cost impact
- release impact
- rollback impact
- blocker yes/no
- evidence reference

Specifically verify or refute:

1. OCPP heartbeat advertised interval is derived from the liveness config and not a second literal.
2. Unchanged heartbeats skip queue/DB ingest.
3. Missed heartbeat creates an event path or still only has `expectedNextHeartbeatAt` without a sweeper.
4. Queue binding exists in config for the intended environment.
5. Fallback Worker-to-Worker synchronous path still exists and when it triggers.
6. Per-connector frame cap exists and is tested.
7. Noisy charger breach emits metric/event without logging sensitive payload.
8. Sentry DSN binding/env is present or fail-closed missing.
9. Sentry scrubber cannot leak idTag, Basic Auth, charger credentials, query strings, user objects, kennitala, or future unknown payload fields.
10. Analytics Engine binding/env is present or fail-closed missing.
11. Metrics vocabulary is closed and cannot accept arbitrary payload keys.
12. Worker/Pages custom domain and workers_dev behavior is safe.
13. Route/custom-domain config cannot break pinned mobile host accidentally.
14. Production release has a version id / rollback target or remains blocked.
15. R2/export/debug bundle story exists or is absent.
16. Workflows are absent/present and whether billing jobs would benefit.
17. Cloudflare Access is absent/present for internal tools.
18. Secrets endpoint/runbook cannot expose secret values in evidence artifacts.
19. Sentry and Analytics additions are in Core docs or missing.
20. All cost-sensitive terms have an owner/checker.

## Phase 2 — Implement or strengthen local gates

Build or extend local checkers so that the locked Cloudflare decisions fail fast. Minimum gate set:

- Heartbeat interval drift gate: one source of truth, no stray `interval: 60` default unless test names it as explicit override.
- Heartbeat ingest gate: unchanged heartbeat must not enqueue/persist.
- Missed heartbeat gate: event path or explicit blocking failure until sweeper exists.
- Queue binding gate by environment.
- Workers.dev/custom-domain gate: adding routes must not silently disable pinned hosts unless declared.
- Analytics binding gate: metrics writer no-ops safely but release gate fails if Core release expects metrics and binding is absent.
- Sentry binding gate: scrubber exists; release gate fails if DSN/env missing for target release.
- Secret-scrub gate: known and unknown sensitive fields removed.
- Noisy charger cap gate.
- Metrics vocabulary gate.
- R2 export/debug artifact gate, if relevant.
- Workflows decision gate: absent is allowed only if billing/report jobs have an alternate scheduler and alert path.
- Cloudflare Access gate for internal-only tools.
- Cost model gate: if heartbeat interval drops below 3600 for idle default, report monthly frame multiplier.
- Deployment evidence gate: release cannot be marked rollback-safe without version IDs/domains/bindings recorded.

The gates must have fixtures. Add at least 35 new fixture cases and at least 70 assertions across checker/selftest files. Every new rule must have at least one positive and one negative fixture unless impossible; explain exceptions.

## Phase 3 — Observability code survival

Review the code added in the last B run and harden it. Look for:

- async work in hot path
- accidental PII in metrics blobs
- cardinality explosion
- missing env validation
- confusing no-op behavior
- runtime errors if binding absent
- route or DO code that can throw before scrubber sees errors
- Sentry beforeSend shape mismatch
- wrong assumptions about `CF_VERSION_METADATA`
- stale docs or TODOs

Implement safe fixes with tests. If installing Sentry SDK is impossible/out of-scope, write the exact integration adapter boundary and tests around the scrubber/adapter without adding dependency.

## Phase 4 — Cost evidence model

Create a source-backed cost model file under docs/notes with machine-readable JSON evidence if useful. It must model at least:

- idle connector with 1h heartbeat
- idle connector with accidental 60s heartbeat
- noisy connector 1 frame/s for 1h, 1d, 1mo
- active session sample patterns: 1s startup for 5m, 10s settling, 120s active, 240s connected-idle; mark intervals TBD from real data
- 50 connectors
- 500 connectors
- 1000 connectors
- 20,000 connectors dream-scale

For each scenario estimate or count:

- DO wakeups/requests
- queue ops
- consumer invocations
- DB rows avoided/created
- metrics points
- events generated
- storage class: liveness only, event, raw protocol, billing material
- what config/code controls it
- what gate detects it

Do not invent exact kr costs where Cloudflare pricing is unknown locally. If using pricing, cite the source and date, or mark as formula placeholders. The useful output is sensitivity and multiplier, not fake precision.

## Phase 5 — Release drill

Build a dry-run release checklist that an operator can execute without mutation until the final explicit deploy step. It must include:

- preflight local checks
- Cloudflare dashboard read-only checks
- wrangler read-only checks where available
- required bindings and env names
- Pages/Workers domain checks
- version id capture
- rollback capture
- DNS/domain confirmation
- Google Maps key/referrer note for DSO POC if relevant
- Sentry project/DSN check without exposing DSN
- Analytics Engine dataset/binding check
- Queue backlog check
- DO alarms/liveness sweep check
- R2 bucket check for exports/debug bundles
- what “GO” means
- what “NO-GO” means

Write it so a tired human can follow it tomorrow morning.

## Phase 6 — Alert policy and incident definitions

Define alert conditions for Core launch. Minimum:

- missed heartbeat rate by connector/site/org
- noisy charger cap breach
- queue backlog growing
- consumer failure rate
- OCPP gateway error spike
- BootNotification interval drift
- Sentry error rate spike
- Sentry PII scrubber violation
- Analytics binding missing/no data
- statement/billing job failure
- delivery failure/retry storm
- Cloudflare deployment mismatch
- pinned hostname broken
- Neon connection/error spike from Workers

For each alert:

- severity
- source: Sentry, Cloudflare metric, Analytics Engine, Queue metric, DB query, log, synthetic probe
- threshold proposal
- false positives
- first responder action
- customer impact
- whether it blocks launch

## Phase 7 — Tool comparison, without reopen-the-architecture chaos

Write a concise comparison note for alternatives only to validate that locked choices still make sense. Compare:

- Cloudflare Queues vs NATS JetStream vs Kafka vs SQS
- Analytics Engine vs ClickHouse vs BigQuery
- Neon vs RDS/Supabase/self-hosted Postgres/D1
- CF Workflows vs Temporal/Trigger.dev/custom scheduled jobs
- Sentry vs Cloudflare-only logs/errors

For each:

- why not now
- what would force reconsideration
- minimum seam already needed
- what not to abstract today
- migration pain if wrong

The recommendation must not create a multi-cloud abstraction project. Keep the locked architecture unless evidence says otherwise.

## Phase 8 — Second-pass correction audit

Before final commit, rerun your own gates and reread your own docs. List:

- at least 5 assumptions you corrected or narrowed
- any prior Claude B claim now wrong
- any rule that first passed for the wrong reason
- any fixture that failed for two reasons and had to be narrowed
- any code you wrote that was too permissive on first attempt
- any remaining blocker that is credential-gated rather than engineering-gated

## Phase 9 — Checks and commits

Run all relevant local checks. At minimum attempt:

- observability checker self-test
- OCPP cost checker self-test
- gateway dependency-free selftests
- relevant TypeScript or package checks if dependencies exist
- root/checker suite if available
- config scanner against the real local repo

Commit locally if green enough and clearly isolated. Include checks in commit message or completion doc.

## Phase 10 — Completion artifacts

Write:

1. Completion Markdown at the path in the header.
2. Completion JSON at the path in the header.
3. Docs/notes created by this run.
4. Local commits if source changed.

Completion Markdown must include:

- TL;DR
- elapsed time
- target met yes/no
- start/end tips
- files changed
- commits
- checks run
- what landed
- findings
- blockers
- release go/no-go
- exact next human actions
- external-state confirmation

Completion JSON must be machine-readable and include the keys listed in the operating rules.

## Fallback queue if primary work completes under 4 hours

Do not stop early until you have exhausted at least 8 of these 12 fallback items, unless they are impossible and you explain why.

1. Add 25 more fixtures across Cloudflare config edge cases.
2. Create 30 issue-ready implementation packages for ops/cost observability.
3. Create a dashboard specification for Sentry + Analytics Engine + Queue metrics.
4. Create a runbook for noisy charger containment.
5. Create a runbook for missed heartbeat/offline detection.
6. Create a runbook for billing/report job failure.
7. Create a no-secrets evidence capture template for Cloudflare dashboard sessions.
8. Create a cost sensitivity appendix for 50/500/1000/20000 connectors.
9. Create an incident taxonomy for OCPP gateway failures.
10. Create a release rollback drill with explicit commands/checkpoints but no mutation.
11. Create a security note for Maps key, Sentry DSN, Cloudflare API tokens, and wrangler OAuth state.
12. Run a final source diff review and add at least 10 review comments/questions to the completion doc.

The target is useful progress, not idle time. If wall-clock is still under 4 hours, the completion must say exactly why.
