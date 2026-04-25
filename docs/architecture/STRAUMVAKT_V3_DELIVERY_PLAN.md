# Straumvakt V3 — Delivery Plan

> Execution canon. Reads the V3 architecture and turns it into a
> 20-week, ten-sprint delivery plan with milestone-level exit criteria.
> Assumes solo developer, near-full-time capacity (~30–40 hrs/week). At
> half-time, double the timeline.
>
> This plan is the single source of truth for what is being built, in
> what order, with what exit criteria. Sprints slip; milestones don't
> change shape.

---

## 0. How to read this plan

**Sprint** = 2 calendar weeks, one coherent goal, 3–5 milestones.
**Milestone** = a unit of work with an observable exit criterion. If you
can't demo it or run a test that proves it, it isn't a milestone.
**Exit criterion** = what you can show/run to prove the sprint is done.
**DoD** (Definition of Done) applies to every milestone: code merged to
`staging`, tests pass, tsc clean, migration applied, runbook entry
updated.

Sprint numbers are sequential, not calendar-locked. Don't start Sprint N+1
until N has fully met its exit criterion. The plan is not a commitment to
dates — it's a commitment to *order*.

---

## 1. Scope

### 1.1 In scope for pilot go-live (end of Sprint 10)

- One pilot site operating on Straumvakt with real chargers, real
  drivers, real invoices
- Both OCPP-managed and vendor-portal-managed chargers (Zaptec or Easee
  onboarded via vendor adapter; any OCPP charger via the gateway)
- Full commercial model live (`CustomerPlan` + `ChargerServicePlan`)
- Issue Engine v1 with rule-based detection (5 core rules)
- Operator console covering chargers, sessions, users, issues, billing
- Driver PWA with Auðkenni login, QR start, session history, family
  group, employer reimbursement flow
- OCPI foundation (CPO + eMSP endpoints scaffolded; hub connection
  feasible but not required for pilot)
- Push API with canonical event vocabulary
- Payments live (provider decided Sprint 8)
- EU residency posture verified
- Backups verified by restore drill

### 1.2 Out of scope for V3

Deferred explicitly to keep focus:

- Battery and solar as `SiteAsset` kinds
- AI / ML scaffolding (event log stays ML-ready; no models Day 1)
- Smart charging optimization (load balancing, demand response, V2G)
- DC enrichment vendor adapters (Kempower, Tritium) — unless a DC site
  enters scope before Sprint 4
- Contractor marketplace
- White-label mobile apps (PWA sufficient)
- OCPP 2.1 adapter
- Dedicated analytics store (ClickHouse, etc.)
- Fleet/depot-specific features beyond Host = FLEET account type
- Advanced RBAC engine (roles stay enum-based)
- MCP access for agents

### 1.3 Success criteria for pilot

Pilot is judged successful when all of the following hold for 30
consecutive days:

1. ≥95% of charging sessions complete without operator intervention
2. ≥99% OCPP gateway uptime (excluding planned maintenance windows)
3. First invoice issued and paid through the platform
4. Issue Engine has opened, routed, and resolved at least 10 real
   issues (not just simulator-generated)
5. Driver NPS from the 6 pilot drivers ≥ 40 (baseline, not industry
   comparable)
6. Zero Rule-1 / Rule-2 / Rule-3 / Rule-5 violations from CLAUDE.md
7. Zero data loss incidents
8. Backup restore drill completed successfully at least once

---

## 2. Sprint overview

| # | Sprint | Goal | Exit criterion |
|---|---|---|---|
| 0 | Foundation Schema | V3 schema live; concrete drying | All V3 schemas created (incl. `hardware` + `properties.installations`), catalog seeded (Zaptec + Zaptec Pro minimum), tsc clean, build clean, money as BIGINT minor units. No CPMS backfill (ADR 0003). |
| 1 | OCPP Foundation | One simulator charger, full loop | Simulator boots, starts session, ends session; events in log; commands dispatchable via outbox |
| 2 | OCPI Foundation | Roaming surface exists | OCPI 2.2.1 CPO + eMSP endpoints respond correctly to contract tests; external property/site shadow records work |
| 3 | Driver Experience | A real driver can charge | Auðkenni login, QR start, session history, family group, all working end to end in PWA |
| 4 | Commercial Model | The money math works | `CustomerPlan` + `ChargerServicePlan` + tariff engine compute correct cost for 10 synthetic scenarios |
| 5 | Issue Engine + Console | Operator can run a site | Operator console covers chargers, users, sessions, issues, plans; 5 detection rules firing against simulator |
| 6 | Billing v1 | Invoices issue correctly | Monthly cron produces correct draft invoices; PDF generation works; employer reimbursement flow complete |
| 7 | Push API + Observability | External systems can consume; we can see inside | Push API delivers canonical events to test subscribers with retries; OTel traces end to end |
| 8 | Payments + Hardening | Production-grade commercially | Payment provider integrated; dunning flow; restore drill clean; EU residency verified; load test documented |
| 9 | Multi-Tenant + White-Label | Platform is a platform | Second org onboards cleanly; branding scopes per Host; API keys + scopes; OCPP 2.0.1 adapter complete |
| 10 | Pilot Go-Live | Real chargers, real drivers, real invoices | Pilot site live; real session completed; first invoice issued; retrospective captured |

Total: 20 weeks / 5 months at full-time solo pace.

---

## 3. Sprint 0 — Foundation Schema

**Goal.** Everything downstream depends on the V3 schema. Get it right
once; never migrate it again without a real reason.

**Entry.** Current CPMS codebase in the state reviewed during this
conversation. Feature branch `dev/v3-foundation` cut from `staging`.

**Exit.** All schemas from the V3 architecture exist. Existing CPMS
`chargers`/`connectors`/`drivers` data migrated into the new shape.
`npx tsc --noEmit` clean. `npm run build` succeeds. Restore drill from
the new schema completes.

**Milestones.**

- **0.1** Create all V3 Postgres schemas (`identity`, `tenancy`,
  `hosts`, `properties`, `assets`, `hardware`, `ocpp`, `charging`,
  `billing`, `issues`, `events`, `audit`, `entitlements`, `people`,
  `vendors`, `roaming`, `energy`, `webhooks`). One migration per
  schema family.
  - *Exit:* `psql` shows all schemas; `prisma migrate status` clean.

- **0.2** Define core tables per schema (see Architecture V3 §10). Not
  every column of every future feature — just the shape. `events.event_log`,
  `events.idempotency_keys`, `ocpp.ocpp_identities` (with per-identity
  `credentials_ref` for DC), `ocpp.outbound_commands`,
  `hosts.charger_hosts`, `hosts.charger_service_plans`,
  `properties.sites`, `properties.installations`, `properties.site_assets`,
  `hardware.vendors`, `hardware.models`, `people.family_groups`,
  `billing.customer_plans` etc.
  - *Exit:* Prisma introspection (`prisma db pull`) generates a coherent
    schema; model list matches V3 architecture.

- **0.3** ~~Backfill existing CPMS data into V3 shape~~ — **superseded
  by [ADR 0003](../adr/0003-no-cpms-backfill.md).** Straumvakt is a
  clean rebuild with no data to migrate; the database was wiped before
  Sprint 0 began. Sprint 9 milestone 9.1 (onboarding wizard) is the
  only supported path into an empty system. No exit criterion — the
  milestone is closed as a no-op.

- **0.4** Money type fix: `driver_profiles.account_balance` and all
  tariff rate fields become `BIGINT` minor units. Write a one-shot
  migration with `ROUND(balance * 100)`.
  - *Exit:* Grep `real\|float\|double` in schema returns zero results in
    financial columns.

- **0.5** Data-access layer with `withOrgContext` pattern. Every
  repository function takes `TenantDb` not raw Prisma. Every query has
  `org_id` in a `WHERE` clause.
  - *Exit:* A unit test verifies that a query missing `org_id` throws;
    all existing repo functions pass the audit.

- **0.6** Seed the Hardware Catalog. One data migration populates
  `hardware.vendors` with at least Zaptec, Easee, generic-ocpp, and
  Shelly; populates `hardware.models` with Zaptec Pro, Easee One, a
  generic OCPP AC entry, and a Shelly Pro 4PM entry. Each model row
  carries its `credential_scope`, `asset_class`, and a `profile` JSONB
  with rated power, phases, connector types, and supported OCPP
  versions. DC placeholders (Kempower C-Series, Tritium) allowed but
  not required.
  - *Exit:* `SELECT slug, credential_scope FROM hardware.models` shows
    at least four rows; operator-console smoke page renders them.
  - *Follow-up (out of Sprint 0):* update
    `docs/architecture/straumvakt_architecture_v3.svg` to show the
    Installation layer and Hardware Catalog inset. Flagged in ADR
    0002.

**Risks.** Data migration edge cases on existing pilot data (likely
trivial given current row counts). Neon branch management during
migration iteration (use a scratch branch, don't touch staging).

---

## 4. Sprint 1 — OCPP Foundation

**Goal.** One simulated charger goes end-to-end through the V3 pipeline
and the event log is the source of truth.

**Entry.** Sprint 0 exit met.

**Exit.** A simulator charger sends `BootNotification`, then a full
transaction (`StartTransaction` → `MeterValues` × N → `StopTransaction`),
and every step produces a row in `events.event_log` with correct
retention class and idempotency. Operator console can issue a
`RemoteStartTransaction` via the outbox and the command reaches the
simulator.

**Status as of 2026-04-24:** milestones 1.1 through 1.4 are complete.
The `gateway/` worker now exists with per-OCPPIdentity Durable Objects,
Basic-Auth per identity, OCPP 1.6J envelope parsing, and the signed
ingest client calling `hlada` via Cloudflare Service Binding. 1.5
(end-to-end simulator test) is the last remaining milestone for
Sprint 1 exit.

**Milestones.**

- **1.1 ✓ (done 2026-04-24)** Create `src/app/api/ocpp/events/route.ts`
  event-log-first + idempotent. (V1 said "refactor" — no prior code
  exists in Straumvakt; this is a create from scratch.) On receipt:
  gate by `OCPP_INGEST_SECRET` header (constant-time compare, not
  HMAC — see [ADR 0004](../adr/0004-ocpp-transport-service-binding.md)),
  check `events.idempotency_keys`, insert to `events.event_log`,
  dispatch projection by event type, all in one Postgres transaction.
  - *Exit met:* Replay test green — same `eventId` posted twice
    produces exactly one event-log row and one projection dispatch;
    second call returns the cached 202 envelope. Auth test green —
    missing / wrong secret returns 401 constant-time.

- **1.2 ✓ (done 2026-04-24)** Domain event translator module for OCPP
  1.6J. Maps every 1.6J message type to a named domain event. No OCPP
  vocabulary escapes this module.
  - *Exit met:* OCPP 1.6J envelope parser + translator live under
    `gateway/src/ocpp-frame.ts`; non-`ocpp` modules carry no OCPP
    vocabulary.

- **1.3 ✓ (done 2026-04-24)** Outbox table + dispatcher.
  `ocpp.outbound_commands` populated by API calls (e.g. remote start).
  Cloudflare Cron Trigger every 30s polls pending, dispatches to DO,
  writes result back.
  - *Exit met:* Remote start from operator console succeeds against
    simulator; a forced crash mid-dispatch produces retry not loss.

- **1.4 ✓ (done 2026-04-24)** OCPP worker DO key changes from charger
  identity string to `ocpp_identity.id` (UUID). Authentication still
  by Basic-Auth on the identity string; DO instance named by UUID.
  - *Exit met:* `gateway/src/identity-do.ts` runs one DO per
    OCPPIdentity; reconnect after hibernation works; Service Binding
    dispatch path live.

- **1.5** End-to-end simulator test: scripted charger runs a full
  session against local dev env; assertions verify event log rows,
  projection state, idempotency keys, outbound dispatch.
  - *Exit:* `npx vitest run integration/ocpp-e2e` passes.

**Risks.** Durable Object `locationHint` needs verification for EU
residency (set to `weur` and test). OCPP 1.6J edge cases on
reconnection behavior (use the simulator — don't guess).

---

## 5. Sprint 2 — OCPI Foundation

**Goal.** OCPI is a foundation seam, not a Phase-5 scaffold. Dual-role
endpoints respond correctly; external Property/Site shadow records work.

**Entry.** Sprint 1 exit met.

**Exit.** OCPI 2.2.1 endpoints for both CPO and eMSP respond to contract
tests. Token translator works between RFID UIDs, OCPI tokens, and users.
External Property/Site auto-creation on receipt of partner location push
is functional. Hub connection code exists but a real hub is not yet
contracted.

**Milestones.**

- **2.1** CPO endpoints: `/ocpi/cpo/2.2.1/locations`,
  `/ocpi/cpo/2.2.1/sessions`, `/ocpi/cpo/2.2.1/cdrs`,
  `/ocpi/cpo/2.2.1/tariffs`, `/ocpi/cpo/2.2.1/tokens` (authorize).
  Projections from our data into OCPI shapes.
  - *Exit:* Contract test against OCPI 2.2.1 reference spec passes.

- **2.2** eMSP endpoints: `/ocpi/emsp/2.2.1/tokens` (push),
  `/ocpi/emsp/2.2.1/cdrs` (pull). Inbound location and session pushes
  accepted and stored.
  - *Exit:* Mock partner can publish a location to us and we create an
    external `properties.sites` shadow record.

- **2.3** Token translator. `roaming.ocpi_tokens` table maps OCPI tokens
  to our users / family groups / cards. Authorize requests from chargers
  flow through: charger → OCPP gateway → authorize check (local RFID or
  OCPI token) → response.
  - *Exit:* Authorization works for both a local RFID UID and a
    hypothetical partner-issued OCPI token.

- **2.4** Hub connector scaffold. A `roaming.hub_connections` table with
  fields for Hubject, Gireve, or direct peer. One mock hub in test env
  to validate push/pull flows.
  - *Exit:* Hub connection can be created, credentials stored, mock
    hub receives our published locations.

- **2.5** Contract tests for OCPI 2.2.1 schemas. Vendored JSON Schemas
  in the repo. Nightly CI.
  - *Exit:* `npm run test:ocpi-contract` passes.

**Risks.** OCPI 2.2.1 has real ambiguities (party IDs, versioning
semantics, tariff alternatives). Follow the Virta / Hubject interop docs
closely. Book 2–3 days of spec-reading before coding.

---

## 6. Sprint 3 — Driver Experience

**Goal.** A real Icelandic driver can sign in with Auðkenni, see the
chargers at their home site, and start a charging session from the app.

**Entry.** Sprint 2 exit met.

**Exit.** Driver opens the PWA, signs in with Auðkenni, lands on a
dashboard showing their family group + session history + available
chargers at assigned sites. QR start works end to end against the
simulator. Employer reimbursement field exists on sessions.

**Milestones.**

- **3.1** Auðkenni OIDC end to end. `.env.example` already has the vars;
  wire the flow. Token exchange, user creation / linking, session cookie.
  - *Exit:* A developer can log in via Auðkenni in dev environment and
    have a user row created with the national ID linked.

- **3.2** Driver PWA shell. Sign in, home dashboard, bilingual.
  Components follow the existing sidebar/topbar conventions from CPMS.
  - *Exit:* PWA installable on iOS and Android; sign-in works on both.

- **3.3** QR start flow. Each charger gets a stable QR that encodes
  `org_id + site_id + identity_id + connector_id`. Driver scans,
  authorization check runs, charger starts if authorized.
  - *Exit:* Simulator charger starts a session triggered by the app.

- **3.4** Family group management. `people.family_groups` and
  `people.family_memberships`. Primary user can invite family members.
  AC pricing will later read from this.
  - *Exit:* Primary user invites a family member; family member appears
    in group; sessions by family member roll up to primary for billing.

- **3.5** Employer reimbursement flag on sessions. Session carries an
  `employer_site_id` (nullable); employer reimbursement workflow is
  stubbed but fields exist. Full flow lands in Sprint 6.
  - *Exit:* Schema fields present; operator console shows the flag.

**Risks.** Auðkenni test environment access and timing (start ordering
credentials Sprint 1 if not already). PWA push notifications on iOS are
limited; acceptable for pilot but flag for later.

---

## 7. Sprint 4 — Commercial Model

**Goal.** The money math is correct and the two-contract model works end
to end for the pilot Host.

**Entry.** Sprint 3 exit met.

**Exit.** Given a session, the tariff engine produces a correct cost
breakdown. `CustomerPlan` and `ChargerServicePlan` both active; plan
selection logic picks the right `CustomerPlan` for a given user/site.
Revenue share from `ChargerServicePlan` computes correctly.

**Milestones.**

- **4.1** `CustomerPlan` schema in full richness: products
  (setup/subscription/RFID/usage credit), tariffs (ToU + per-connector +
  per-speed), displays with locales, country/currency variants, balance
  type, category, termination behavior.
  - *Exit:* Create a plan via `/v1/customer-plans`, attach products and
    tariffs, retrieve it; all fields round-trip.

- **4.2** `ChargerServicePlan` schema. Revenue share rule, electricity
  reimbursement rule, maintenance responsibility, platform fee model,
  default tariff, term.
  - *Exit:* Create a service plan for the pilot Host; attach chargers;
    verify that cost calculation uses the Host-defined default tariff
    when no user plan overrides.

- **4.3** Tariff engine. Pure function: given a session + applicable
  tariff chain, produce cost breakdown (energy cost, time cost, overtime
  penalty, total, taxes). No side effects; fully unit-testable.
  - *Exit:* Ten synthetic session scenarios produce expected cost
    breakdowns matching hand-computed results.

- **4.4** Plan selection logic. Given a user + site + charger, pick the
  applicable `CustomerPlan` by priority (user override > site > Host
  default > org default).
  - *Exit:* Priority tests pass for four combinations.

- **4.5** Multi-currency + multi-locale scaffolding. ISK as primary
  currency, EUR supported; Icelandic + English display variants.
  - *Exit:* A plan renders correctly in `is-IS` and `en-GB` locales
    with ISK and EUR variants.

**Risks.** This is where silent bugs are most expensive. Follow
Rule 5 from CLAUDE.md strictly — any change to billing math requires
explicit approval of the change summary before coding.

---

## 8. Sprint 5 — Issue Engine + Operator Console

**Goal.** An operator can actually run the site from the console. The
Issue Engine opens, categorizes, routes, and resolves issues from real
event log rows.

**Entry.** Sprint 4 exit met.

**Exit.** Operator console has live views for chargers, sessions, users,
issues, plans, and settings — all reading from repositories, not raw
Prisma. Five issue detection rules fire against simulator-generated
events. Helper role exists with scope-limited views.

**Milestones.**

- **5.1** Five issue detection rules implemented as modules under
  `src/lib/issues/rules/`:
  1. Charger offline > 5 min
  2. Repeated `Faulted` status in 1 hr
  3. Session start failures > 3 in 24h on same connector
  4. Meter value anomaly (reports non-monotonic energy)
  5. Session stuck in `Preparing` > 10 min
  - *Exit:* Simulator can trigger each rule; issues appear in console.

- **5.2** Ticket workflow. States: open → triaged → assigned → in_progress
  → waiting → resolved → closed. State transitions emit events and show
  in ticket timeline.
  - *Exit:* An operator can walk a ticket through the lifecycle.

- **5.3** Helper role scoped to assigned sites. Helper sees only
  chargers, sessions, and issues at their sites. Cannot see billing.
  - *Exit:* A helper user logs in and sees a restricted view.

- **5.4** Lifetime asset history view. Per charger, per OCPP identity,
  per connector: cumulative session count, total energy, total faults,
  resolved/open issue count, firmware history.
  - *Exit:* Console renders a charger detail page showing its lifetime
    record.

- **5.5** Operator console pages wired. Chargers list, charger detail,
  sites, users, sessions (with filters), issues kanban, plans list,
  settings, and the Hardware nav group (vendor catalog + model catalog,
  read-only for operators / helpers, read-write for org admins). All
  through repositories. No Prisma type leakage.
  - *Exit:* Nine top-level nav pages render with real data; tsc clean.

**Risks.** Rule tuning — rules that over-alert will train the operator
to ignore the console. Start conservative; expand after real data.

---

## 9. Sprint 6 — Billing v1

**Goal.** Invoices generate correctly from sessions, employer
reimbursement works, PDFs render, and billing transactions are
auditable.

**Entry.** Sprint 5 exit met.

**Exit.** Monthly cron run produces draft invoices for the pilot Host.
Each driver receives a correct invoice. Employer reimbursement routes
workplace charging costs to the Host's employer account. PDF invoices
render and are downloadable.

**Milestones.**

- **6.1** Invoice generation job. Cloudflare Cron Trigger runs monthly
  (1st of month at 02:00 Icelandic time), reads sessions for the prior
  month, groups by user and billing period, produces draft invoices.
  - *Exit:* Cron fires on schedule; draft invoices appear.

- **6.2** Billing transaction types: payment, refund, penalty, credit,
  contract-charge, external-payment. Each can be applied via API or
  console; rolls up into invoices.
  - *Exit:* Each transaction type created via API; invoice totals match.

- **6.3** Statements rollup. Cross-period view of all transactions for a
  user or Host. Read-only aggregate.
  - *Exit:* Statement view renders for a user across 3 test months.

- **6.4** Employer reimbursement flow. When a session is flagged
  workplace (via the Sprint 3 stub), the cost is routed to the Host's
  employer billing entry. Employer receives a consolidated monthly
  invoice.
  - *Exit:* Workplace sessions route to employer invoice; driver
    invoice omits them.

- **6.5** PDF invoice generation. Use a headless renderer (Cloudflare
  Browser Rendering or a lightweight server-side lib). Stored in R2
  (EU). Downloadable from console.
  - *Exit:* A driver invoice PDF renders; matches the digital view.

**Risks.** Rule 5 applies — invoice generation is the highest-stakes
code path. Run a dry-run against simulator data for a full month before
firing against real data. Sign off on the first real run manually.

---

## 10. Sprint 7 — Push API + Observability

**Goal.** External systems can subscribe to platform events; internal
teams (i.e., the operator) can see what's happening inside the platform.

**Entry.** Sprint 6 exit met.

**Exit.** Push API delivers canonical events to subscribers with durable
retry. OpenTelemetry traces every request across both workers. A
per-tenant dashboard shows uptime, session success rate, open issue
count, MRR.

**Milestones.**

- **7.1** Push API subscriber registry. `webhooks.subscriptions` per
  tenant with scopes (which events), endpoint URL, signing secret,
  status.
  - *Exit:* Operator can register a subscriber via console; event types
    listed; test-send works.

- **7.2** Canonical event vocabulary emitted: `transaction.started`,
  `transaction.updated`, `transaction.stopped`, `transaction.billed`,
  `charger.added`, `connector.status_updated`,
  `card.authorize_request`, `issue.opened`, `issue.resolved`. Schemas
  documented.
  - *Exit:* Each event type emitted by the platform is documented and
    validated against its schema at emission.

- **7.3** Durable retry with exponential backoff. Dead-letter queue for
  subscribers that have failed >N times. Subscriber health score.
  - *Exit:* A misbehaving test subscriber eventually lands in DLQ; a
    recovering subscriber resumes.

- **7.4** OpenTelemetry across both workers. Traces propagate across
  the signed webhook boundary via `traceparent` headers. Correlation ID
  from the OCPP message flows all the way to the invoice line.
  - *Exit:* Given an OCPP message ID, the trace viewer shows the
    full path: WebSocket → DO → webhook → event log → projection →
    API response.

- **7.5** Per-tenant dashboard in the operator console. Uptime, session
  success rate, open issues, MRR, top issue categories. Reads from
  aggregates, not raw event log.
  - *Exit:* Dashboard renders for the pilot tenant with live data.

**Risks.** OTel on Cloudflare Workers requires specific libraries;
verify Sprint 5 that the chosen path works. Dashboard queries can
become expensive — use aggregate tables, not raw events.

---

## 11. Sprint 8 — Payments + Hardening

**Goal.** Production-grade. Payments live. Backups verified. EU
residency posture re-confirmed. Load ceiling documented.

**Entry.** Sprint 7 exit met.

**Exit.** First real test invoice charged against a live payment
provider. Dunning workflow functional. Restore from backup produces a
clean working system. EU residency verified via documented checklist.
Load test establishes the single-process ceiling.

**Milestones.**

- **8.1** Payment provider integration. Decision this sprint: Stripe
  (fastest, global), Adyen (enterprise EU), Netgíró (Iceland-local,
  easiest for pilot). Integrate one. Tokenize cards, handle
  authorization, capture on invoice issuance.
  - *Exit:* A real test invoice (low value, your own card) charges
    successfully.

- **8.2** Dunning workflow. Failed payment → retry schedule →
  notifications → suspension after N failed attempts.
  - *Exit:* A forced payment failure triggers the dunning path
    correctly.

- **8.3** Backup verification by restore drill. Nightly Neon PITR
  backups; once this sprint, actually restore to a scratch branch and
  run the app against it.
  - *Exit:* Restore drill runbook exists; executed successfully once.

- **8.4** EU residency posture verification. Cloudflare Data
  Localization configured; Durable Object `locationHint` set to EU
  regions; Neon region confirmed; R2 jurisdiction confirmed; OTel
  backend in EU. Document in runbook.
  - *Exit:* Residency runbook checked off; screenshots in docs.

- **8.5** Load test OCPP gateway. Spin up N simulator chargers (100,
  1000, 10000 target), measure CPU/memory/latency of the DO fleet.
  Document the ceiling.
  - *Exit:* Load test results document exists; ceiling is above
    3× pilot scale.

**Risks.** Payment provider SLA sign-offs may take time — don't let
procurement paperwork block code. Restore drill will find problems;
allocate a day for unexpected fixes.

---

## 12. Sprint 9 — Multi-Tenant + White-Label

**Goal.** Prove the platform is a platform, not a single-customer app.
Second org onboards cleanly; branding scopes work; OCPP 2.0.1 adapter is
in place.

**Entry.** Sprint 8 exit met.

**Exit.** A second (staged) org onboards end to end. Per-Host branding
applies to driver-facing surfaces. API keys + scopes work for partner
integrations. OCPP 2.0.1 adapter is code-complete.

**Milestones.**

- **9.1** Onboarding flow for a new org. Step-through wizard: create
  org, create first Host, create first Property, create first Site,
  add first charger (via OCPP or vendor adapter), create first
  CustomerPlan, first ChargerServicePlan.
  - *Exit:* Wizard runs end to end for a fresh tenant in <30 min.

- **9.2** Per-Host branding. Logo, colors, sender email domain for
  driver-facing surfaces. Stored in `hosts.branding` JSONB.
  - *Exit:* Driver sees the Host's brand on their PWA when charging at
    that Host's sites.

- **9.3** Postgres Row-Level Security where it makes sense. Turn on for
  the most mixed-role tables (sessions, issues, users in operator
  console queries).
  - *Exit:* RLS policies audited; an operator from org A cannot see
    org B's sessions even with a raw query.

- **9.4** API key + scopes subsystem. Per-tenant API keys with scopes
  (`sessions.read`, `chargers.write`, etc.), rotation, audit log of
  uses.
  - *Exit:* A scoped API key can call permitted endpoints and is
    rejected on others.

- **9.5** OCPP 2.0.1 adapter. Second protocol module under
  `gateway/protocol/2.0.1/` with schemas, parsers, state machine mapping.
  Both versions tested against simulator.
  - *Exit:* Simulator charger can connect with 2.0.1 and complete a
    session; translation to domain events identical to 1.6J path.

**Risks.** OCPP 2.0.1 state model differs in non-trivial ways; plan a
spec-reading day. RLS can slow down queries; measure before enabling in
hot paths.

---

## 13. Sprint 10 — Pilot Go-Live

**Goal.** Real chargers, real drivers, real invoices at the pilot site.

**Entry.** Sprint 9 exit met.

**Exit.** Pilot site is live on Straumvakt. At least one real session
completed and invoiced. Retrospective held. Post-pilot plan drafted.

**Milestones.**

- **10.1** Real chargers onboarded. Whichever hardware the pilot uses
  (Zaptec / Easee via vendor adapter; or generic OCPP via the gateway)
  — provisioned, connected, status showing healthy.
  - *Exit:* Pilot chargers visible in operator console with live
    `Available` status.

- **10.2** Real drivers invited. Pilot 6 drivers onboarded via
  Auðkenni; family groups created where relevant; RFID cards assigned
  where applicable.
  - *Exit:* All 6 drivers completed sign-up and appear in users list.

- **10.3** First commercial invoice issued. For one driver or Host,
  covering real charging activity, matching the ChargerServicePlan
  rules.
  - *Exit:* Invoice issued, paid, recorded in `billing.invoices`.

- **10.4** Runbooks finalized. Incident response, backup restore, EU
  residency check, OCPP reconnect troubleshooting, common operator
  tasks. Living doc in `/docs/runbooks/`.
  - *Exit:* Runbook index exists; each top-5 scenario documented.

- **10.5** Pilot retrospective. What went right, what broke, what the
  data says, what the drivers and operator say. Post-pilot plan
  (Sprints 11+) drafted.
  - *Exit:* Retrospective doc written; post-pilot plan outlined (next
    two sprints of priorities).

**Risks.** Real hardware always surprises. Budget time for diagnosing
one or two unexpected OCPP quirks at the pilot site. Don't ship a
hotfix to master — follow Rule 1 even under launch pressure.

---

## 14. Open questions / missing decisions

These block or materially shape the sprint plan. Lock them as early as
possible; each has a suggested default if you need to move.

### Commercial / pilot

- **Pilot customer commitment.** Is the pilot site a confirmed
  workplace / MDU / hotel / fleet? Who is the Host? Who pays? *Default
  if unknown: pilot against your own test site for Sprints 0–9, commit
  a real pilot customer before Sprint 10.*
- **First charger hardware.** Zaptec, Easee, generic OCPP, or a mix?
  *Default: generic OCPP via the gateway (simplest). If pilot site has
  existing Zaptec, plan a Zaptec adapter spike in Sprint 2 (compresses
  Sprint 9 OCPP 2.0.1 work).*
- **Commercial deadline.** When must the first invoice issue? *Default:
  Sprint 10 as planned; if earlier is required, Sprints 6 and 8 have to
  compress.*
- **Payment provider.** Stripe / Adyen / Netgíró / something else?
  *Default: Stripe for fastest integration; switch later if enterprise
  buyers demand Adyen.*
- **OCPI hub.** Hubject, Gireve, direct peers, or hub-less? *Default:
  hub-less through pilot (endpoints exist, no subscription); decide hub
  during Phase 5 (post-pilot) unless a roaming partner is booked.*

### Operational / process

- **Time commitment.** Full-time, half-time, evenings? *Default
  assumption in this plan: ~30–40 hrs/week. At half that, double the
  calendar.*
- **Sprint review rhythm.** Solo dev still needs a rhythm. *Default:
  end-of-sprint written retrospective in `/docs/retros/`, 1-page. Keep
  it or the plan drifts.*
- **Decision log (ADR) practice.** Not yet in the repo. *Default:
  `/docs/adr/NNNN-title.md` for every load-bearing decision (runtime,
  hosting, OCPI approach, payment provider, etc.). Adopt in Sprint 0.*
- **Issue tracker.** GitHub Issues (simplest), Linear (nicest UX), or
  internal? *Default: GitHub Issues with a kanban project, mirroring
  these milestones.*
- **Customer feedback loop.** Pilot has 6 drivers. How are you going to
  hear from them? *Default: one structured 15-min call per driver at
  day 15 and day 30 of pilot. Automatic in-app NPS after every 5th
  session.*
- **On-call / incident response.** Single dev = single point of failure.
  *Default: accept it through pilot. Document expected response time
  in SLA ("operator-hours" not "24/7"). Post-pilot plan covers second
  body.*

### Technical / unresolved

- **Auðkenni credentials.** Applied for? Test env accessible? *Default:
  kick off the admin paperwork Sprint 0; Sprint 3 is too late.*
- **Hardware-level firmware management.** OCPP 1.6 supports it; do we
  exercise it? *Default: no firmware pushes through pilot. Vendor
  portals handle firmware on Zaptec/Easee. Revisit in Phase 4 with DC.*
- **OCPP 2.0.1 pilot hardware availability.** Do any pilot chargers
  support 2.0.1? *Default: no; Sprint 9 produces the adapter for future
  buyers, not pilot use.*
- **Employer reimbursement legal form.** Is reimbursement a salary
  benefit (taxable) or an expense reimbursement (not taxable) in
  Iceland? *Default: confirm with an Icelandic accountant before
  Sprint 6 — the implementation is shaped by the answer.*

### Business / regulatory (not in sprint plan, but in the way)

- **Company formation status.** Is the legal entity that invoices
  customers formed? VAT registered? Signatory on the payment provider
  account?
- **GDPR posture.** Privacy policy, data processing agreement template,
  data retention policy published?
- **AFIR compliance.** The EU Alternative Fuels Infrastructure
  Regulation has public-charging obligations kicking in progressively
  through 2026–2027. If any pilot charger is public, this applies.
- **NIS2.** EU cybersecurity directive; EV charging is explicitly in
  scope as "essential services" in many member states. Post-pilot, but
  don't be surprised.
- **Insurance.** Liability coverage for managing customer electrical
  infrastructure.
- **Terms of service + driver privacy policy.** Needed before onboarding
  any real driver (Sprint 10).

---

## 15. Risks and mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Scope creep into battery/solar / AI / smart charging | High | Adds 2–4 sprints | `/docs/adr/` for every scope change; this plan is read at every sprint kickoff |
| Auðkenni test environment delayed | Medium | Blocks Sprint 3 | Start paperwork Sprint 0; admin-login is fallback |
| Invoice math bug reaches production | Low if Rule 5 honored | High (money + trust) | Dry-run in simulator; explicit sign-off per pilot invoice run (Sprint 6 first run, Sprint 10 first real) |
| OCPI spec interpretation wrong at hub time | Medium | Rework of a sprint | Read Virta's and Hubject's interop docs carefully; keep schemas versioned |
| Cloudflare Workers edge runtime constraint bites late | Medium | Sprint delay | Validate each new library on Workers before committing to it; prefer stdlib + minimal deps |
| Single-dev burnout / velocity collapse | Medium | Timeline slip | Honest capacity planning; skip a sprint rather than ship half-done; the plan is commitments to *order*, not dates |
| Pilot customer changes scope late | Medium | Sprint 10 blowup | Lock pilot requirements by end of Sprint 4 latest |
| DO hibernation semantics surprise | Low | Charger disconnect issues | Sprint 1 tests reconnection explicitly |
| Event log grows faster than expected | Low | Cost / query pain | Retention classes operational from Sprint 0; nightly aggregation job by Sprint 6 |
| Payment provider integration longer than Sprint 8 | Medium | Pilot slip | Start onboarding paperwork with chosen provider by Sprint 6 |

---

## 16. Working conventions

These keep the plan executable when no one else is watching.

**Branch discipline.** Every sprint gets a feature branch
`dev/sprint-NN-topic`. Every milestone is a commit or a PR (even against
yourself). Never push to `master` for sprint work; `staging` is the
integration branch. (CLAUDE.md Rule 1 applies without exception.)

**Commit messages.** `[S05] Issue engine rule: charger-offline-5m`.
Scope by sprint number, terse summary, imperative mood.

**Definition of Done per milestone.**
1. Code merged to `staging`
2. `npx tsc --noEmit` clean
3. `npm run build` clean
4. Any new migrations applied to staging Neon branch
5. Tests green (`npx vitest run`)
6. Relevant runbook entry added or updated
7. ADR written if a load-bearing decision was made

**Sprint review.** At the end of every sprint, a one-page retrospective
in `/docs/retros/sprint-NN.md`:
- What shipped (milestones hit)
- What slipped (milestones missed + reason)
- What changed in the plan (ADRs added, scope moved)
- One thing to carry into next sprint

**ADRs.** `/docs/adr/NNNN-title.md`. Short (1–2 pages). Context,
decision, consequences. Add one for: runtime choice, OCPI approach,
payment provider, hub choice, OCPP 2.0.1 timing, anything that a future
reader will ask "why did we do it this way?"

**Cadence.** Solo dev, but still rhythm. Monday plan the sprint. Daily
standup-with-yourself in a `NOTES.md` or similar (15 min). Friday
mini-review. End of Sprint 2-week, retrospective. Pick one day per week
for deep focus; protect it.

**"Foundations before floors" applied at sprint level.** No sprint
begins before the prior sprint's exit criterion is met. If Sprint N
doesn't finish, you do not start Sprint N+1 — you extend Sprint N, or
you consciously narrow it. Concrete drying is the rule, sprint numbers
are not.

---

## 17. What's explicitly NOT in this plan

So the scope holds:

- Series A fundraising / pitch deck work. The 13-slide deck in the
  original design brief is a separate output; do not trade engineering
  time for deck iteration during Sprints 0–10.
- Hiring a second engineer. Pilot ships solo. Hiring after Sprint 10.
- Customer conferences, sales meetings, demos to prospective CPOs.
  Allocate to non-coding time.
- Second country, second language beyond Icelandic + English, second
  currency beyond ISK + EUR.
- OCPI hub live connection with real partner (Hubject or Gireve
  contracts).
- Anything in the Architecture V3 §11 non-goals list.

---

## 18. Next step

Read this plan. Mark up anything that's wrong. Lock the §14 open
questions one at a time. Then start Sprint 0.

If you need to revise the plan: revise the plan. But don't silently
drift.
