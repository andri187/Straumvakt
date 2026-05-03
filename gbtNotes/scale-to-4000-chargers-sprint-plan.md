# Scale To 4,000 Chargers In 6 Months - Sprint Plan

**Status:** planning note.
**Date:** 2026-05-01.
**Context:** based on the current `E:\Claude\Straumvakt` codebase review.

## Gaps Found In The Current Situation

This note does not change the current Straumvakt scope. It records the gaps
that must be planned around before production-scale rollout.

### Architecture And Scale Gaps

- **OCPP inbound ingest split-brain.** Gateway staging points to
  `hlada-api-staging`, but `/api/ocpp/events` appears to still live in the
  Next app, not in `apps/api`.
- **Inbound OCPP events are not queue-first yet.** The gateway/DO path should
  enqueue events before persistence so charger WebSocket handling stays fast
  when the database is slow.
- **Prisma/Neon hot-ingest risk.** Prisma is fine for admin CRUD, but risky as
  a row-by-row writer for high-volume telemetry.
- **Telemetry data-platform decision missing.** The project needs an explicit
  Neon-with-partitioning vs TimescaleDB/Timescale Cloud decision for
  MeterValues and OCPP event facts.
- **Raw SQL/batched ingest path missing.** Queue consumers need a hot path that
  can batch writes, upsert current state, and avoid unnecessary ORM round trips.
- **Retention and archive policy incomplete.** Raw protocol payloads,
  billing-grade facts, operational state, and analytics summaries need separate
  retention rules.
- **Report/export pipeline missing.** Large CSV/XLSX/PDF exports need
  `export_jobs`, a queue, workers, object-storage artifacts, signed URLs,
  expiry, audit, and retry behavior.
- **Report-ready datasets missing.** Exports and future APIs need stable
  ledgers/summaries instead of scanning raw OCPP/event tables.
- **Enterprise/public API layer missing.** Enterprise agreement integrations
  need a separate `/v1` API product with scoped auth, rate limits, OpenAPI,
  idempotency, and webhooks. Internal admin APIs should not be exposed.
- **Load testing is incomplete.** Tests need charger traffic, reconnect storms,
  app/web traffic, report exports, enterprise API traffic, queue backlog, and
  database latency scenarios.
- **Observability/runbooks are incomplete.** Production needs dashboards,
  alerts, DLQ handling, replay procedures, backup/restore, and rollback
  runbooks.

### Product And Production Gaps

- **Real user registration is missing.** Production needs invite flows,
  driver signup, account activation, password reset or identity-provider
  decisions, and account suspension.
- **User privileges/RBAC are incomplete.** The system needs a clear role and
  permission model for platform admins, organization admins, site/property
  managers, finance/report users, support users, and drivers.
- **Tenant administration is incomplete.** Operators need safe UI and API flows
  for membership management, scoped access, and permission review.
- **Driver/mobile app production UX is missing.** The repo has mobile app
  reference/mock surfaces, but production needs driver login/signup, charger
  availability, start/stop charge, active session state, session history, and
  error handling.
- **Driver billing UX is incomplete.** Users need tariff visibility before
  charging, active cost/kWh visibility, completed-session summaries, receipts,
  statements, and dispute/evidence flows.
- **Payment/provider decision is open.** If production requires direct driver
  billing, payment methods, refunds, adjustments, and provider integration need
  explicit scope.
- **Privacy/compliance hardening is missing.** Production needs PII
  classification, export privacy controls, data deletion/GDPR policy, audit
  retention, and abuse protection for login/registration.
- **Production launch plan is incomplete.** The project needs production
  resources, secrets, domains, migration dry-runs, limited rollout, monitoring
  windows, and go/no-go criteria.

---

This note scopes the work needed to make the current Cloudflare + Postgres
architecture ready for a fast scale-up from roughly 20 chargers to roughly
4,000 chargers within 6 months.

The current architectural direction is sound:

- UI separated from API.
- API Worker owns auth, admin routes, and database access.
- OCPP gateway Worker owns charger WebSockets.
- Durable Object per OCPP identity owns transient charger connection state.
- Queues are used for outbound command dispatch.
- Postgres remains the operational system of record, reached through
  Cloudflare-compatible pooling from Workers.

The main risk is not the high-level architecture. The main risk is that the
implementation is mid-transition: OCPP inbound ingest still appears to live in
the old Next route while the staging gateway service binding points at the new
API Worker.

The second major risk is the data path. Prisma + Neon is acceptable for the
control plane, but it should not be the only tool for high-volume OCPP telemetry.
At scale, the better target is:

- Prisma for admin CRUD and business workflows.
- Raw SQL / batched writes for queue consumers and hot ingest.
- Postgres for operational truth.
- TimescaleDB / Timescale Cloud for time-series telemetry if raw MeterValues
  and event history remain in SQL.
- Object storage for raw OCPP payload archive after short retention.
- Object storage for generated report artifacts.
- Public enterprise APIs for agreement integrations, kept separate from the
  internal admin API.
- ClickHouse later only if fleet analytics outgrow Postgres/Timescale.

## Target Architecture

```text
Browser
  -> UI Worker / Pages
  -> API Worker
  -> Postgres pooler / Hyperdrive
  -> Operational Postgres

Report Export
  -> UI export request
  -> API Worker creates export_job row
  -> Export Queue
  -> Export Worker reads report-ready tables / aggregates
  -> CSV / XLSX / PDF artifact in object storage
  -> signed download URL with expiry

Enterprise Integration
  -> Enterprise system
  -> Public API /v1
  -> enterprise auth, scopes, quotas
  -> agreement, billing, session, export APIs
  -> webhook queue for outbound notifications

Charger
  -> OCPP Gateway Worker
  -> Identity Durable Object
  -> Inbound Event Queue
  -> API Worker consumer
  -> raw SQL batch writer
  -> Operational Postgres / Timescale telemetry tables
  -> optional raw archive in object storage

Admin Command
  -> UI
  -> API Worker
  -> Postgres outbox row
  -> Outbound Command Queue
  -> API Worker queue consumer
  -> OCPP Gateway service binding
  -> Identity Durable Object
  -> Charger WebSocket
```

## Scale Assumptions

- Target fleet: 4,000 chargers.
- Pilot growth window: 6 months.
- Heartbeat interval assumption: 60 seconds.
- MeterValues interval target: 30-60 seconds unless billing or operations
  requires more frequent sampling.
- Expected steady-state inbound traffic:
  - Heartbeat every 60s: about 67 events/second.
  - MeterValues every 60s: about 67 events/second.
  - MeterValues every 30s: about 133 events/second.
  - MeterValues every 10s: about 400 events/second.
- Reconnect storms and firmware misconfiguration are treated as normal events,
  not exceptions.

## Success Criteria

- 4,000 simulated chargers can remain connected through the gateway without
  sustained error growth.
- Inbound OCPP events are accepted quickly by the gateway and persisted through
  an asynchronous path.
- API and queue consumers can absorb at least 2x expected peak event volume for
  a short window.
- Admin commands are durable, retryable, observable, and correlated end to end.
- Raw protocol data has an explicit retention policy.
- Prisma is not used as the hot ingest mechanism for high-volume telemetry.
- The team has made an explicit Neon vs Timescale decision before large
  onboarding batches.
- Operators have dashboards for charger health, event lag, command status, and
  database health.
- Users can request large reports without blocking API requests or competing
  directly with OCPP ingest.
- Export artifacts are permission-scoped, auditable, expiring, and stored
  outside the database.
- Enterprise agreement APIs are designed as a separate public API product, not
  a thin exposure of internal admin routes.
- Staging can run realistic load tests before production cutover.

---

# Sprint S1 - Fix The Runtime Split

**Goal:** make the deployed staging topology internally consistent.

## Task List

- [ ] Confirm the intended source of truth for OCPP inbound event ingest.
- [ ] Port `/api/ocpp/events` from the Next app into `apps/api`.
- [ ] Mount the new route in `apps/api/src/index.ts`.
- [ ] Move or duplicate the OCPP event-envelope parsing and projection bootstrap
      needed by the API Worker.
- [ ] Ensure API Worker event ingest uses the current Postgres runtime path
      only as a temporary compatibility step.
- [ ] Mark any Prisma-based event ingest as transitional; do not optimize the
      4,000-charger plan around per-event Prisma writes.
- [ ] Add API Worker tests for:
  - [ ] missing `x-straumvakt-ingest`
  - [ ] malformed JSON
  - [ ] invalid event envelope
  - [ ] duplicate/idempotent event
  - [ ] successful fresh event
- [ ] Update gateway docs/comments so `MAIN_APP` clearly means the API Worker.
- [ ] Deploy API Worker staging and gateway staging together.
- [ ] Smoke test:
  - [ ] OCPP auth lookup succeeds.
  - [ ] pending discovery logging succeeds.
  - [ ] BootNotification event persists.
  - [ ] Heartbeat event persists.
  - [ ] MeterValues event persists.

## Exit Criteria

- Gateway staging no longer posts inbound charger events to a route that only
  exists in the old Next app.
- One real or simulated charger can connect, authenticate, send events, and
  produce rows/projections in the current Postgres store.

---

# Sprint S2 - Queue-Backed Inbound OCPP Events

**Goal:** prevent charger WebSocket handling from depending on synchronous DB
projection latency.

## Task List

- [ ] Add an inbound OCPP event queue in `apps/api/wrangler.jsonc`.
- [ ] Add an inbound queue producer binding to `gateway/wrangler.jsonc`.
- [ ] Change the gateway Durable Object event path:
  - [ ] accept/parse charger frame
  - [ ] create event envelope
  - [ ] enqueue event
  - [ ] reply to charger quickly
- [ ] Keep the current service-binding ingest route as a fallback or local-dev
      path until queue ingest is proven.
- [ ] Add an API Worker queue consumer for inbound OCPP events.
- [ ] Make the consumer idempotent using `eventId`.
- [ ] Define retry behavior:
  - [ ] validation failure is permanent
  - [ ] DB/transient failure is retried
  - [ ] poison messages land in DLQ
- [ ] Add a DLQ plan:
  - [ ] inspect DLQ count
  - [ ] record failed event metadata
  - [ ] replay after fix
- [ ] Add tests around queue consumer behavior.

## Exit Criteria

- A charger can continue receiving timely OCPP responses while the database is
  slow or briefly unavailable.
- Inbound event lag is measurable.
- No valid event is lost during normal Worker/API retry paths.

---

# Sprint S3 - Data Platform And ORM Decision

**Goal:** decide the correct database and ORM boundary before optimizing the
wrong persistence path.

## Task List

- [ ] Classify tables into:
  - [ ] control-plane relational data
  - [ ] operational current state
  - [ ] command/outbox state
  - [ ] billing-grade session facts
  - [ ] high-volume time-series telemetry
  - [ ] raw protocol archive
  - [ ] report-ready aggregates and ledgers
  - [ ] export job metadata
  - [ ] public API client/app metadata
  - [ ] enterprise agreement integration state
- [ ] Decide whether production telemetry remains on Neon Postgres or moves to
      Timescale Cloud / TimescaleDB.
- [ ] If staying on Neon:
  - [ ] define native Postgres partitioning strategy for event and meter tables
  - [ ] define retention jobs
  - [ ] define aggregate/projection tables
  - [ ] confirm plan sizing, write IOPS, storage growth, backup, and PITR
- [ ] If moving to Timescale:
  - [ ] define hypertables for meter values and OCPP event facts
  - [ ] define continuous aggregates for hourly/daily fleet views
  - [ ] define compression / hypercore policy for older chunks
  - [ ] define retention and tiering policy
  - [ ] confirm Cloudflare Worker connectivity and pooling
- [ ] Decide ORM boundary:
  - [ ] Prisma remains for admin CRUD, tenant setup, users, orgs, sites,
        chargers, contracts, and low-volume workflows
  - [ ] raw SQL / driver-level access is used for queue consumers, event
        projection, batch insert, current-state upserts, and MeterValues writes
  - [ ] migrations remain centralized and reviewable
- [ ] Choose the runtime SQL client for hot paths:
  - [ ] `pg` / `@prisma/adapter-pg` direct raw SQL
  - [ ] `postgres.js`
  - [ ] another Cloudflare-compatible Postgres driver
- [ ] Decide where raw OCPP payloads live:
  - [ ] short retention in Postgres/Timescale
  - [ ] object storage archive
  - [ ] no long-term raw archive unless billing/compliance requires it
- [ ] Define report-ready datasets so exports do not scan raw telemetry:
  - [ ] billing-period summaries
  - [ ] per-driver/session ledger
  - [ ] per-site energy report
  - [ ] cost-center allocation report
  - [ ] charger uptime/availability report
  - [ ] command history report
  - [ ] raw meter evidence bundle for billing disputes
- [ ] Define enterprise API data products early so later public endpoints do
      not bypass the report-ready/read-model layer:
  - [ ] active agreements
  - [ ] contract terms and effective dates
  - [ ] tariffs and cost factors
  - [ ] cost-center assignments
  - [ ] driver/session ledgers
  - [ ] invoice/statement summaries
  - [ ] charger/site availability summaries
  - [ ] export job references
- [ ] Decide report artifact formats:
  - [ ] CSV for machine-readable exports
  - [ ] XLSX for operator finance workflows
  - [ ] PDF for statements/invoices if required
- [ ] Decide report artifact storage:
  - [ ] object storage bucket
  - [ ] artifact retention window
  - [ ] signed URL expiry
  - [ ] per-org storage limits
- [ ] Produce a written ADR or implementation note before Sprint S4 starts.

## Exit Criteria

- The team has explicitly chosen Neon-with-partitioning or Timescale for
  telemetry.
- Prisma is scoped to the control plane, not the hot ingest path.
- Raw SQL/batched write ownership is accepted before queue consumers are
  load-tested.
- Report-ready datasets and artifact storage strategy are defined before export
  UI is built.
- Enterprise API read/write surfaces have named data products before public API
  routes are built.

---

# Sprint S4 - Hot Ingest, Retention, And Projection Implementation

**Goal:** make the selected database write path sustainable at 4,000 chargers.

## Task List

- [ ] Document event classes:
  - [ ] raw protocol
  - [ ] operational state
  - [ ] financial/billing facts
  - [ ] issue history
  - [ ] aggregates
- [ ] Decide retention windows per class.
- [ ] Implement retention enforcement for raw protocol events.
- [ ] Implement the chosen time-series schema:
  - [ ] native Postgres partitions if staying on Neon
  - [ ] Timescale hypertables if choosing Timescale
- [ ] Review indexes on:
  - [ ] `event_log_entries`
  - [ ] `charge_sessions`
  - [ ] `meter_values`
  - [ ] `outbound_commands`
  - [ ] `ocpp_identities`
- [ ] Add or revise projection code so high-frequency MeterValues do not cause
      unnecessary write amplification.
- [ ] Replace per-event Prisma writes in the queue consumer with raw
      SQL/batched writes.
- [ ] Add batch insert support for MeterValues and event facts.
- [ ] Add current-state upserts using raw SQL where Prisma would create
      excessive round trips.
- [ ] Add current-state projection tables or fields where the UI needs fast
      charger status.
- [ ] Define MeterValues sampling policy:
  - [ ] default interval
  - [ ] minimum accepted interval
  - [ ] billing-grade handling
  - [ ] raw payload retention
- [ ] Add aggregate tables or continuous aggregates for:
  - [ ] hourly charger availability
  - [ ] hourly energy delivered
  - [ ] daily site energy delivered
  - [ ] command success/failure summaries
- [ ] Add report-ready tables/views for:
  - [ ] monthly site energy
  - [ ] monthly driver/session ledger
  - [ ] billing line exports
  - [ ] cost-center splits
  - [ ] charger uptime summaries
- [ ] Add integration-ready tables/views for future enterprise APIs:
  - [ ] agreement status by org/customer
  - [ ] contract effective-period lookup
  - [ ] tariff/cost-factor snapshot by period
  - [ ] external reference mapping
  - [ ] API-visible session ledger
- [ ] Add migration and rollback notes for any schema changes.

## Exit Criteria

- The team knows exactly which OCPP data is kept forever, kept temporarily, or
  projected and discarded.
- Query patterns for dashboard and charger detail pages are index-backed.
- MeterValues traffic has a known and tested write strategy.
- Queue consumers can write expected peak telemetry without using Prisma as the
  row-by-row insert layer.
- Large reports can read from summary/ledger surfaces instead of raw protocol
  tables.
- Future public APIs can read stable views/ledgers instead of internal admin
  repository shapes.

---

# Sprint S5 - Report Export Pipeline

**Goal:** let users export large CSV/XLSX/PDF reports without blocking API
requests or damaging ingest latency.

## Task List

- [ ] Add `export_jobs` table with:
  - [ ] org ID
  - [ ] requested by user/admin
  - [ ] report type
  - [ ] filters/scope
  - [ ] format
  - [ ] status
  - [ ] artifact object key
  - [ ] signed URL expiry
  - [ ] error message
  - [ ] created/started/completed/expires timestamps
- [ ] Add export queue and DLQ bindings.
- [ ] Add API endpoints:
  - [ ] create export job
  - [ ] list export jobs
  - [ ] get export job status
  - [ ] cancel export job if still pending
  - [ ] create short-lived signed download URL
- [ ] Design export job ownership so both UI users and future enterprise API
      clients can request exports through the same backend pipeline.
- [ ] Implement export worker:
  - [ ] claim pending job idempotently
  - [ ] read report-ready datasets
  - [ ] stream/generate CSV
  - [ ] generate XLSX if required for finance workflows
  - [ ] generate PDF only for statement/invoice-style reports
  - [ ] write artifact to object storage
  - [ ] update job status
  - [ ] send retryable failures to queue retry
  - [ ] send permanent failures to failed status / DLQ
- [ ] Add permissions and tenant isolation:
  - [ ] org-scoped exports
  - [ ] site/property/user scope checks
  - [ ] no cross-tenant artifact access
- [ ] Add audit events:
  - [ ] export requested
  - [ ] export completed
  - [ ] export failed
  - [ ] export downloaded
  - [ ] export expired/deleted
- [ ] Add rate limits and quotas:
  - [ ] max concurrent exports per org
  - [ ] max date range per report type
  - [ ] max rows per synchronous preview
  - [ ] object storage retention limit
- [ ] Add UI:
  - [ ] export request panel
  - [ ] report filters
  - [ ] job status list
  - [ ] download action when complete
  - [ ] failed/cancelled states
- [ ] Add tests:
  - [ ] cannot export another org's data
  - [ ] large export stays async
  - [ ] expired artifact cannot be downloaded
  - [ ] duplicate queue delivery does not create duplicate artifacts
  - [ ] failed export records useful error state

## Exit Criteria

- Large report exports run through queue-backed jobs, not synchronous API
  requests.
- Export artifacts are stored outside Postgres and downloaded through short-lived
  signed URLs.
- Export activity is auditable and tenant-scoped.
- The export backend can be reused by the future enterprise API without
  duplicating report generation logic.

---

# Sprint S6 - Outbound Command Hardening

**Goal:** make remote start/stop/reset/config commands reliable and observable
at fleet scale.

## Task List

- [ ] Review current outbox + queue flow in `apps/api/src/repositories/outbound-commands.ts`.
- [ ] Review queue consumer flow in `apps/api/src/lib/dispatcher.ts`.
- [ ] Add command timeout semantics.
- [ ] Persist gateway command-result events back into the API Worker.
- [ ] Ensure command-result ingest works after the Sprint S1/S2 route changes.
- [ ] Ensure command-result persistence follows the same ORM boundary:
  - [ ] Prisma for command metadata if low volume
  - [ ] raw SQL for high-volume event/result facts
- [ ] Add command status states if needed:
  - [ ] pending
  - [ ] dispatched
  - [ ] sent
  - [ ] accepted
  - [ ] rejected
  - [ ] timed_out
  - [ ] failed
- [ ] Add UI visibility for command history per charger.
- [ ] Add retry limits and clear permanent failure reasons.
- [ ] Add tests for:
  - [ ] no active WebSocket
  - [ ] gateway 503 retry
  - [ ] gateway 4xx permanent failure
  - [ ] duplicated queue message
  - [ ] command result correlation

## Exit Criteria

- Operators can tell whether a command is pending, sent, accepted, rejected, or
  timed out.
- A disconnected charger does not cause data corruption or invisible command
  loss.

---

# Sprint S7 - Load Test Harness

**Goal:** prove the architecture under realistic fleet behavior before real
scale arrives.

## Task List

- [ ] Build or adopt an OCPP 1.6J charger simulator.
- [ ] Simulate:
  - [ ] 100 chargers
  - [ ] 500 chargers
  - [ ] 1,000 chargers
  - [ ] 4,000 chargers
  - [ ] 4,000 chargers with reconnect storm
- [ ] Model normal message mix:
  - [ ] BootNotification
  - [ ] Heartbeat
  - [ ] StatusNotification
  - [ ] Authorize
  - [ ] StartTransaction
  - [ ] MeterValues
  - [ ] StopTransaction
- [ ] Model failure behavior:
  - [ ] bad credentials
  - [ ] unknown identity
  - [ ] duplicate identity connection
  - [ ] API Worker unavailable
  - [ ] Postgres/Timescale latency spike
  - [ ] queue backlog
  - [ ] object storage write failure
  - [ ] export queue backlog
- [ ] Record metrics during each test:
  - [ ] active WebSockets
  - [ ] gateway errors
  - [ ] queue depth
  - [ ] queue retries
  - [ ] DLQ count
  - [ ] ingest lag
  - [ ] database write latency
  - [ ] batch size and flush latency
  - [ ] partition/hypertable chunk growth
  - [ ] export job latency
  - [ ] export queue depth
  - [ ] export artifact write latency
  - [ ] export artifact storage growth
  - [ ] API Worker error rate
  - [ ] command round-trip latency
- [ ] Run A/B persistence tests if the data-platform decision is still open:
  - [ ] Neon partitioned tables
  - [ ] Timescale hypertables
  - [ ] raw payload archive enabled/disabled
- [ ] Run report/export load tests while OCPP ingest is active:
  - [ ] 10 concurrent monthly session CSV exports
  - [ ] 10 concurrent billing XLSX exports
  - [ ] 5 concurrent charger uptime reports
  - [ ] one large raw meter evidence export
  - [ ] repeated downloads of completed artifacts
- [ ] Reserve test scenarios for future enterprise APIs:
  - [ ] many small paginated reads
  - [ ] repeated agreement lookups
  - [ ] concurrent export creation via API clients
  - [ ] webhook retry burst
- [ ] Capture a repeatable runbook for load-test execution.

## Exit Criteria

- Staging can survive a 4,000-charger simulation at expected event frequency.
- Staging can run concurrent report exports during ingest without unacceptable
  queue lag, DB read pressure, or API timeouts.
- The load harness can be extended to public API clients without redesign.
- Known bottlenecks are documented with owners and follow-up tasks.

---

# Sprint S8 - Observability And Operations

**Goal:** make a 4,000-charger fleet operable by humans.

## Task List

- [ ] Define production dashboards:
  - [ ] charger connected/disconnected count
  - [ ] charger reconnect rate
  - [ ] auth failures
  - [ ] pending discoveries
  - [ ] event queue depth
  - [ ] event queue age
  - [ ] outbound command queue depth
  - [ ] command success/failure rate
  - [ ] database latency and error rate
  - [ ] ingest batch flush latency
  - [ ] partition/hypertable storage growth
  - [ ] raw archive write failures
  - [ ] export queue depth
  - [ ] export job duration
  - [ ] export failure rate
  - [ ] export artifact storage growth
  - [ ] public API request rate by client
  - [ ] public API error rate by endpoint
  - [ ] webhook queue depth and failure rate
  - [ ] API Worker 4xx/5xx rate
  - [ ] gateway Worker 4xx/5xx rate
- [ ] Add structured logs with correlation IDs:
  - [ ] OCPP identity ID
  - [ ] org ID
  - [ ] charger/station ID
  - [ ] event ID
  - [ ] command ID
  - [ ] OCPP uniqueId
- [ ] Add alert thresholds:
  - [ ] queue age too high
  - [ ] DLQ non-empty
  - [ ] sudden auth failure spike
  - [ ] connected chargers drop
  - [ ] database errors
  - [ ] database write latency spike
  - [ ] storage growth above forecast
  - [ ] export queue age too high
  - [ ] export failure spike
  - [ ] export artifact storage growth above forecast
  - [ ] public API client error spike
  - [ ] public API rate-limit spike
  - [ ] webhook DLQ non-empty
  - [ ] command timeout spike
- [ ] Create runbooks:
  - [ ] charger cannot connect
  - [ ] vendor import mismatch
  - [ ] queue backlog
  - [ ] DLQ replay
  - [ ] Postgres/Timescale slow or unavailable
  - [ ] partition/hypertable maintenance
  - [ ] raw archive replay
  - [ ] export job stuck/failed
  - [ ] export artifact cleanup
  - [ ] signed URL/download issue
  - [ ] enterprise API key/client disabled
  - [ ] webhook delivery replay
  - [ ] OCPP gateway deploy rollback
  - [ ] API Worker deploy rollback

## Exit Criteria

- A non-author operator can diagnose the common failure modes without reading
  source code.
- Production incidents have named alerts and runbooks.

---

# Sprint S9 - Security, Tenant Isolation, And Secrets

**Goal:** harden the multi-tenant and credential paths before scale.

## Task List

- [ ] Review admin session cookie scope and custom-domain plan.
- [ ] Move away from broad `straumvakt.workers.dev` cookie domain before
      production custom domains if needed.
- [ ] Verify every API route enforces admin auth or internal ingest auth.
- [ ] Add route-level authorization tests for org-scoped data.
- [ ] Review `OCPP_INGEST_SECRET` rotation procedure.
- [ ] Review `OCPP_CRED_KEK` rotation and blast radius.
- [ ] Ensure vendor credentials are encrypted and never returned plaintext.
- [ ] Add audit events for:
  - [ ] charger create/update/delete
  - [ ] OCPP credential creation
  - [ ] vendor credential create/update/delete
  - [ ] remote start/stop/reset commands
- [ ] Review pending-discovery abuse risk and rate limits.
- [ ] Review CORS allowed origins before production.
- [ ] Review direct database credentials for hot-path SQL clients.
- [ ] Ensure object-storage raw archives do not leak tenant or credential data.
- [ ] Ensure report artifacts do not leak tenant, driver, billing, or credential
      data.
- [ ] Add authorization tests for every export type and filter scope.
- [ ] Add audit review for export downloads because exports can contain
      sensitive billing and driver-session data.
- [ ] Design enterprise API auth model before S11:
  - [ ] API keys vs OAuth2 client credentials
  - [ ] per-client scopes
  - [ ] key rotation and revocation
  - [ ] optional IP allowlisting
  - [ ] per-client rate limits
- [ ] Add schema placeholders or ADR for public API clients:
  - [ ] client ID
  - [ ] org/customer binding
  - [ ] scopes
  - [ ] status
  - [ ] last used timestamp
- [ ] Define public API audit fields:
  - [ ] request ID
  - [ ] client ID
  - [ ] scope used
  - [ ] endpoint
  - [ ] status code
  - [ ] changed resource IDs

## Exit Criteria

- Tenant boundaries are tested, not assumed.
- Secret rotation has a written procedure.
- Operator actions that affect chargers are auditable.
- Enterprise API authentication, authorization, and audit model are decided
  before public routes are built.

---

# Sprint S10 - Production Cutover Readiness

**Goal:** prepare for real fleet growth with rollback and capacity plans.

## Task List

- [ ] Decide final domain layout:
  - [ ] UI domain
  - [ ] API domain
  - [ ] OCPP gateway domain
  - [ ] public enterprise API domain
- [ ] Create production Cloudflare resources:
  - [ ] API Worker
  - [ ] gateway Worker
  - [ ] Durable Object namespace
  - [ ] inbound event queue
  - [ ] outbound command queue
  - [ ] export queue
  - [ ] DLQs
  - [ ] database pooler / Hyperdrive production binding
- [ ] Create production database resources:
  - [ ] Neon production plan if staying on Neon
  - [ ] Timescale production service if moving telemetry to Timescale
  - [ ] object storage bucket for raw OCPP archive if selected
  - [ ] object storage bucket/prefix for report artifacts
- [ ] Confirm database plan, connection limits, write capacity, storage growth,
      backup, PITR, and retention jobs.
- [ ] Confirm export artifact retention, cleanup job, storage forecast, and
      signed URL policy.
- [ ] Confirm backup and restore process.
- [ ] Run migration dry-run.
- [ ] Run staging 4,000-charger load test after production-like config.
- [ ] Define rollback paths:
  - [ ] UI rollback
  - [ ] API Worker rollback
  - [ ] gateway rollback
  - [ ] database migration rollback or forward-fix
- [ ] Define go/no-go checklist.
- [ ] Document first 30 days of post-launch monitoring.
- [ ] Keep public enterprise API disabled/hidden until S11 acceptance criteria
      are met; production cutover should not accidentally expose internal APIs.

## Exit Criteria

- Production has matching resources and secrets.
- Rollback is written and tested where feasible.
- The team has evidence from staging load tests before onboarding large batches.
- Public API domain and auth plan are prepared, but no enterprise endpoints are
  exposed before the dedicated S11 work.

---

# Sprint S11 - Enterprise API And Agreement Integrations

**Goal:** expose agreement, billing, session, and reporting capabilities to
enterprise systems through a versioned, scoped, documented public API.

## Principles

- Do not expose internal admin routes as the enterprise API.
- Public APIs are versioned from day one: `/v1/...`.
- Public APIs use stable data products, not raw internal table shapes.
- Every write API is idempotent where duplicate submissions are possible.
- Large reports go through the existing export job pipeline.
- Outbound notifications go through a webhook queue with retry and DLQ.

## Task List

- [ ] Define API product boundary:
  - [ ] base URL and domain
  - [ ] `/v1` route prefix
  - [ ] OpenAPI specification
  - [ ] pagination convention
  - [ ] filtering convention
  - [ ] error shape
  - [ ] request ID / correlation ID convention
  - [ ] compatibility and deprecation policy
- [ ] Implement enterprise auth:
  - [ ] API key or OAuth2 client credentials decision from S9
  - [ ] client registration model
  - [ ] secret/key hashing
  - [ ] scope checks
  - [ ] disabled/revoked client handling
  - [ ] optional IP allowlist
  - [ ] per-client rate limits
- [ ] Implement agreement APIs:
  - [ ] list agreements/contracts
  - [ ] get agreement detail
  - [ ] list effective tariffs/cost factors
  - [ ] list cost centers
  - [ ] list driver contract assignments
  - [ ] expose effective-date history
  - [ ] support external reference IDs
- [ ] Implement operational read APIs:
  - [ ] list sites/properties available to client
  - [ ] list chargers and current status
  - [ ] list sessions by date range
  - [ ] get session detail
  - [ ] list command history where allowed
- [ ] Implement billing/reporting APIs:
  - [ ] list billing periods
  - [ ] list invoice/statement summaries
  - [ ] create export job for allowed report types
  - [ ] get export job status
  - [ ] create signed download URL for completed artifacts
- [ ] Implement write APIs only where needed:
  - [ ] contract reference update
  - [ ] cost-center assignment update
  - [ ] driver contract metadata update
  - [ ] idempotency key support for every write
  - [ ] validation and conflict responses
- [ ] Implement webhooks:
  - [ ] endpoint registration
  - [ ] signing secret
  - [ ] event subscriptions
  - [ ] session completed
  - [ ] invoice/statement ready
  - [ ] export ready
  - [ ] agreement changed
  - [ ] charger status changed if agreed
  - [ ] delivery retry and DLQ
  - [ ] replay endpoint/admin action
- [ ] Add audit and observability:
  - [ ] request log per client
  - [ ] write action audit
  - [ ] export request/download audit
  - [ ] webhook delivery log
  - [ ] dashboard by client and endpoint
  - [ ] alert on error/rate-limit/webhook failures
- [ ] Add enterprise API tests:
  - [ ] missing credentials
  - [ ] revoked client
  - [ ] wrong scope
  - [ ] cross-tenant access blocked
  - [ ] pagination stability
  - [ ] idempotent write replay
  - [ ] export creation through API client
  - [ ] webhook signature verification
  - [ ] webhook retry/DLQ behavior
- [ ] Add documentation:
  - [ ] OpenAPI file committed in repo
  - [ ] getting-started guide
  - [ ] auth guide
  - [ ] endpoint examples
  - [ ] webhook verification example
  - [ ] changelog
  - [ ] sandbox/staging instructions

## Exit Criteria

- Enterprise clients can integrate through `/v1` APIs without admin UI access.
- Public API access is scoped, rate-limited, audited, and documented.
- Large reports use the shared export pipeline.
- Webhook delivery is retryable, observable, and replayable.
- No internal admin endpoint needs to be documented or exposed as an enterprise
  integration surface.

---

# Priority Order

1. Sprint S1 - Fix the runtime split.
2. Sprint S2 - Queue-backed inbound OCPP events.
3. Sprint S3 - Data platform and ORM decision.
4. Sprint S4 - Hot ingest, retention, and projection implementation.
5. Sprint S5 - Report export pipeline.
6. Sprint S7 - Load test harness.
7. Sprint S8 - Observability and operations.
8. Sprint S6 - Outbound command hardening.
9. Sprint S9 - Security, tenant isolation, and secrets.
10. Sprint S10 - Production cutover readiness.
11. Sprint S11 - Enterprise API and agreement integrations.

Sprint S6 can move earlier if remote start/stop is a pilot requirement. Sprint
S9 should run in parallel with S8 if production custom domains and real
operator access are being prepared.

Sprint S11 is intentionally last, but its prerequisites are spread through
S3-S10: data products, export jobs, observability, auth, rate limits, audit,
domains, and production safety all need to exist before public enterprise APIs
are opened.

## Key Architectural Decision

The architecture should remain Cloudflare-native, but inbound OCPP events
should not stay as synchronous service-binding writes to the persistence path at
4,000 chargers. The long-term scalable shape is:

```text
Gateway Durable Object -> Queue -> API Worker consumer -> raw SQL batch writer -> Postgres/Timescale
```

That preserves fast charger protocol responses while giving the persistence
side backpressure, retries, DLQ handling, and measurable lag.

User report exports need the same treatment. They should be asynchronous jobs
with durable status and object-storage artifacts:

```text
UI -> API Worker -> export_jobs row -> Export Queue -> Export Worker -> object storage -> signed URL
```

Exports should read from report-ready summaries and ledgers, not raw protocol
tables, except for explicit evidence bundles.

Enterprise agreement APIs should be a public API product, not exposed admin
routes:

```text
Enterprise system -> Public API /v1 -> scoped auth/rate limits -> agreement data products -> exports/webhooks
```

Prisma should remain in the project, but only where it fits: control-plane CRUD
and normal business workflows. The hot ingest path should be designed around
batching, retention, explicit indexes, and the selected time-series strategy.
