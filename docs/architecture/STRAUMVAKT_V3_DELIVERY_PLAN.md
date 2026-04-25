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

> **Pilot is a demonstrable platform, not a commercial release.**
> Scope tightened 2026-04-25 — see [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md)
> and [`straumvakt_roadmap.svg`](./straumvakt_roadmap.svg) (tags A–F
> show what moved to post-pilot).

- One pilot site operating on Straumvakt with real chargers, real
  drivers, real session activity (no money movement during pilot)
- Both OCPP-managed and vendor-portal-managed chargers (Zaptec or Easee
  onboarded via vendor adapter; any OCPP 1.6J charger via the gateway)
- Commercial model **schema** live (`CustomerPlan` + `ChargerServicePlan`)
  — Sprint 4 ships the model; Sprint 6 ships a read-only **billing
  dashboard** rather than invoice generation
- Issue Engine v1 with rule-based detection (5 core rules) — basic
  scope, no advanced detection / smart routing / ML categorization
- Operator console covering chargers, sessions, users, issues, billing
  dashboard
- Driver PWA with **user/password login** (no Auðkenni for pilot),
  session history, family group, employer reimbursement flag (workflow
  itself deferred)
- **CPO-side** OCPI (locations, sessions, CDRs, tariffs, basic RFID
  authorize). eMSP endpoints + OCPI token push deferred to post-pilot
- Push API with canonical event vocabulary
- EU residency **posture** in place (Cloudflare Data Localization,
  Neon EU region, R2 EU jurisdiction). Verification *ceremony*
  (audit runbook, sign-off paperwork) deferred to post-pilot
- Backups verified by restore drill (Sprint 8)
- ISK currency only (multi-currency post-pilot)

### 1.2 Out of scope for V3 / pilot

Deferred to keep focus. **Two tiers** — items deferred from V3
entirely (long-haul scope discipline) and items deferred from the
*pilot* into the post-pilot backlog (see ADR 0005).

#### 1.2a — Deferred from V3 entirely

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

#### 1.2b — Deferred from pilot to post-pilot (per ADR 0005)

Tags A–F match the [roadmap SVG](./straumvakt_roadmap.svg).

- **A · Roaming** — eMSP endpoints, OCPI token push to roaming
  partners, OCPP 2.0.1 adapter
- **B · Driver login** — Auðkenni electronic-ID (OIDC), QR-code
  session start
- **C · Multi-currency** — EUR + per-locale variants on top of
  ISK-only pilot
- **D · Issue Engine v2** — advanced detection, smart routing,
  ML categorization, helper reputation scoring
- **E · Real billing** — monthly invoice generation, billing
  transactions as ledger entries, statements, employer
  reimbursement workflow, PDF invoices
- **F · Commerce + compliance** — payment provider integration,
  dunning workflow, EU residency *verification ceremony* (the
  runtime *posture* stays in place during pilot)

### 1.3 Success criteria for pilot

Pilot is judged successful when all of the following hold for 30
consecutive days:

1. ≥95% of charging sessions complete without operator intervention
2. ≥99% OCPP gateway uptime (excluding planned maintenance windows)
3. **Billing dashboard reflects what *would* have been invoiced** —
   per-driver and per-Host totals, per-period rollups, all reviewable
   in the operator console. *Real invoice generation + payment is
   post-pilot per ADR 0005.*
4. Issue Engine has opened, routed (basic rules only), and resolved
   at least 10 real issues (not just simulator-generated)
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
| 2 | OCPI Foundation (CPO-only) | CPO surface exists; eMSP deferred (A) | OCPI 2.2.1 **CPO** endpoints respond correctly to contract tests; external property/site shadow records work; basic RFID authorize. *eMSP endpoints + token push deferred per ADR 0005.* |
| 3 | Driver Experience | A real driver can charge | Driver PWA with **user/password** login, session history, family group, employer reimbursement flag — all working end to end. *Auðkenni login + QR start deferred per ADR 0005 (B).* |
| 4 | Commercial Model | The money math works (ISK only) | `CustomerPlan` + `ChargerServicePlan` + tariff engine compute correct cost for 10 synthetic scenarios in **ISK**. *Multi-currency (EUR) deferred per ADR 0005 (C).* |
| 5 | Issue Engine + Console | Operator can run a site (basic) | Operator console covers chargers, users, sessions, issues, plans; 5 basic detection rules firing against simulator. *Advanced detection / routing / ML deferred per ADR 0005 (D).* |
| 6 | Billing **Dashboard** | Billing data is reviewable | Billing dashboard shows per-driver / per-Host accumulating amounts in ISK, rolled up by period, read-only. *Invoice generation, transactions, statements, employer reimbursement, PDF invoices deferred per ADR 0005 (E).* |
| 7 | Push API + Observability | External systems can consume; we can see inside | Push API delivers canonical events to test subscribers with retries; OTel traces end to end |
| 8 | Hardening | Pilot-grade reliability | Restore drill clean; OCPP gateway load test documented. *Payment provider, dunning, EU residency verification ceremony deferred per ADR 0005 (F). EU runtime posture (CF Data Localization, Neon EU) stays in place.* |
| 9 | Multi-Tenant + White-Label | Platform is a platform | Second org onboards cleanly; branding scopes per Host; API keys + scopes. *OCPP 2.0.1 adapter deferred per ADR 0005 (A).* |
| 10 | Pilot Go-Live | Demonstrable platform, not commercial release | Pilot site live; real charger sessions running on OCPP 1.6J; pilot drivers using user/password login; billing dashboard reviewable; backup restore drill completed; retrospective captured. *No money movement during pilot.* |

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

## 5. Sprint 2 — OCPI Foundation (CPO-only for pilot)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag A):**
> CPO-side ships in pilot. **eMSP endpoints + OCPI token push to roaming
> partners are deferred to post-pilot.** Token translator stays — it
> supports the CPO-side authorize path (charger sends RFID, we resolve
> to a local user).

**Goal.** OCPI is a foundation seam, not a Phase-5 scaffold. CPO-side
endpoints respond correctly; external Property/Site shadow records
work. Pilot is CPO-only; eMSP shipping post-pilot.

**Entry.** Sprint 1 exit met.

**Exit.** OCPI 2.2.1 **CPO** endpoints respond to contract tests.
Token translator works for the CPO-receive direction (RFID UID + any
locally-issued OCPI token resolve to a user). Hub connection code
exists for future use but no live partner contracted.

**Milestones.**

- **2.1** CPO endpoints: `/ocpi/cpo/2.2.1/locations`,
  `/ocpi/cpo/2.2.1/sessions`, `/ocpi/cpo/2.2.1/cdrs`,
  `/ocpi/cpo/2.2.1/tariffs`, `/ocpi/cpo/2.2.1/tokens` (authorize).
  Projections from our data into OCPI shapes.
  - *Exit:* Contract test against OCPI 2.2.1 reference spec passes.

- **2.2** ~~eMSP endpoints~~ — **deferred per ADR 0005 (tag A).**
  `/ocpi/emsp/2.2.1/tokens` (push) and `/ocpi/emsp/2.2.1/cdrs` (pull)
  ship post-pilot together with OCPI token push to roaming partners.
  Schema (`roaming.external_properties`, `roaming.cdr_queue`) stays
  in place from Sprint 0 so the post-pilot work is additive.

- **2.3** Token translator (CPO-receive only). `roaming.ocpi_tokens`
  table maps OCPI tokens to our users / family groups / cards.
  Authorize requests from chargers flow through: charger → OCPP
  gateway → authorize check (local RFID or known token) → response.
  - *Exit:* Authorization works for a local RFID UID and a known
    locally-issued token.

- **2.4** Hub connector scaffold. A `roaming.hub_connections` table
  with fields for Hubject, Gireve, or direct peer. Schema only — no
  live partner credentials configured during pilot.
  - *Exit:* Hub connection row can be created and listed in console;
    real connection lands when eMSP ships post-pilot.

- **2.5** Contract tests for OCPI 2.2.1 CPO schemas. Vendored JSON
  Schemas in the repo. Nightly CI.
  - *Exit:* `npm run test:ocpi-contract` passes for the CPO surface.

**Risks.** OCPI 2.2.1 has real ambiguities (party IDs, versioning
semantics, tariff alternatives). Follow the Virta / Hubject interop docs
closely. Book 2–3 days of spec-reading before coding.

---

## 6. Sprint 3 — Driver Experience (user/password login)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag B):**
> Driver PWA ships with **user/password** login. **Auðkenni
> electronic-ID + QR-code session start are deferred to post-pilot.**
> Pilot drivers start sessions by presenting an idTag (RFID card) at
> the charger.

**Goal.** A real driver can sign in to the PWA with email/password,
see the chargers at their home site, view session history, and have
their account properly modeled.

**Entry.** Sprint 2 exit met.

**Exit.** Driver opens the PWA, signs in with email/password, lands
on a dashboard showing their family group + session history +
available chargers at assigned sites. Sessions started via RFID at
the charger appear in the driver's history. Employer reimbursement
field exists on sessions.

**Milestones.**

- **3.1** ~~Auðkenni OIDC end to end~~ — **deferred per ADR 0005
  (tag B).** `.env.example` keeps the `AUDKENNI_*` vars as placeholders;
  Auðkenni adapter ships post-pilot. Pilot uses the user/password
  path below.

- **3.2** Driver PWA shell with user/password sign-in. Sign in, home
  dashboard, bilingual. Components follow the existing sidebar/topbar
  conventions. `identity.users` rows + `identity.user_credentials`
  password hash (existing schema).
  - *Exit:* PWA installable on iOS and Android; user can register +
    sign in with email/password on both.

- **3.3** ~~QR start flow~~ — **deferred per ADR 0005 (tag B).**
  Pilot session start path is RFID-at-charger only (idTag presented
  on the charger; OCPP `Authorize` resolves to a local user).
  Sessions are visible in the driver's PWA history but the driver
  doesn't initiate them via QR during pilot.

- **3.4** Family group management. `people.family_groups` and
  `people.family_memberships`. Primary user can invite family members.
  AC pricing will later read from this.
  - *Exit:* Primary user invites a family member; family member appears
    in group; sessions by family member roll up to primary for billing.

- **3.5** Employer reimbursement **flag** on sessions. Session
  carries an `employer_site_id` (nullable); flag is set when a
  session occurs at a workplace-tagged site. **Full reimbursement
  workflow** (employer-pays-driver flow, employer invoice routing)
  is part of Sprint 6's deferred billing work — pilot has the flag,
  not the workflow.
  - *Exit:* Schema fields present; operator console shows the flag.

**Risks.** PWA push notifications on iOS are limited; acceptable for
pilot but flag for later. Email-verification ceremony (do we
require it?) is its own design decision before driver onboarding —
park it as a Sprint-3 open question.

---

## 7. Sprint 4 — Commercial Model (ISK only for pilot)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag C):**
> Tariff engine, `CustomerPlan`, and `ChargerServicePlan` ship in **ISK
> only** for pilot. **Multi-currency (EUR + per-locale variants) is
> deferred to post-pilot.** Schema already supports a `currency`
> column; turning EUR on post-pilot is additive.

**Goal.** The money math is correct and the two-contract model works
end to end for the pilot Host, in ISK.

**Entry.** Sprint 3 exit met.

**Exit.** Given a session, the tariff engine produces a correct ISK
cost breakdown. `CustomerPlan` and `ChargerServicePlan` both active;
plan selection logic picks the right `CustomerPlan` for a given
user/site. Revenue share from `ChargerServicePlan` computes correctly.

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

- **4.5** Locale + currency posture for pilot — **ISK only**.
  Icelandic + English display variants ship; the schema's
  `currency` column accepts EUR but no EUR plans are created during
  pilot. **Multi-currency (EUR variants, per-locale rendering)
  deferred per ADR 0005 (tag C).**
  - *Exit:* A plan renders correctly in `is-IS` and `en-GB` locales
    with the ISK variant.

**Risks.** This is where silent bugs are most expensive. Follow
Rule 5 from CLAUDE.md strictly — any change to billing math requires
explicit approval of the change summary before coding.

---

## 8. Sprint 5 — Issue Engine + Operator Console (basic for pilot)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag D):**
> Five basic detection rules + ticket workflow + helper role + console
> pages ship for pilot. **Advanced detection (anomaly + sequence
> rules), smart routing, ML categorization, and helper reputation
> scoring are deferred to post-pilot.** The basic Issue Engine is
> what the pilot needs to operate.

**Goal.** An operator can actually run the site from the console. The
Issue Engine opens, categorizes, and resolves issues from real
event log rows using the basic rule set.

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

## 9. Sprint 6 — Billing Dashboard (read-only for pilot)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag E):**
> Sprint 6 ships a **read-only billing dashboard** — operators and
> drivers can see what *would* be invoiced, but no money moves.
> **Real invoice generation, billing transactions as ledger entries,
> statements, employer reimbursement workflow, and PDF invoices are
> deferred to post-pilot.** Schema for all of these already exists
> (Sprint 0); turning them on post-pilot is additive, not migrational.

**Goal.** Billing data is reviewable in the operator console and the
driver PWA. Per-driver / per-Host accumulating amounts roll up by
period. No invoice generation, no payment processing, no PDFs during
pilot — those land post-pilot.

**Entry.** Sprint 5 exit met.

**Exit.** Operator console "Billing" page renders, for each
driver / Host, the sum of session-derived charges in the current
period and prior periods. Driver PWA shows the driver's own
accumulating amount with a per-session breakdown. Numbers match
what the tariff engine (Sprint 4) computes for each session.

**Milestones.**

- **6.1** Tariff-engine session cost projection. For each completed
  session, the tariff engine output is persisted in
  `charging.sessions.cost_minor` (already in schema) and rolled up
  per period.
  - *Exit:* For 10 simulator-generated sessions, `cost_minor` matches
    the tariff engine's pure-function output exactly.

- **6.2** Billing dashboard — operator view. Per-driver totals,
  per-Host totals, per-period rollups, drillable to individual
  sessions. Read-only; no actions.
  - *Exit:* Console "Billing" page renders for the pilot tenant with
    real session data.

- **6.3** Billing dashboard — driver view. PWA "My charges" page:
  accumulating amount this period, prior-period summary, per-session
  breakdown. Read-only.
  - *Exit:* Driver PWA shows correct totals matching the operator view.

- **6.4** ~~Invoice generation, billing transactions, statements,
  employer reimbursement, PDF invoices~~ — **deferred per ADR 0005
  (tag E).** Post-pilot work, on top of the schema and the dashboard
  data already in place.

**Risks.** Rule 5 still applies — the dashboard renders billing
numbers. If the rendered total differs from what the tariff engine
computed, drivers and operators lose trust before pilot exits.
Validate against tariff-engine output in unit tests, not just
visual review.

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

## 11. Sprint 8 — Hardening

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag F):**
> Backup restore drill + OCPP gateway load test ship for pilot.
> **Payment provider integration, dunning workflow, and the EU
> residency *verification ceremony* are deferred to post-pilot.**
> The EU runtime *posture* (Cloudflare Data Localization, Neon EU
> region, R2 EU jurisdiction, DO `locationHint=weur`) is configured
> from Sprint 0–1 onward and stays in place; what's deferred is the
> documented audit-trail ceremony.

**Goal.** Pilot-grade reliability. Backups verified by restore drill;
OCPP gateway ceiling measured.

**Entry.** Sprint 7 exit met.

**Exit.** Restore from backup produces a clean working system. Load
test establishes the single-process ceiling.

**Milestones.**

- **8.1** ~~Payment provider integration~~ — **deferred per ADR 0005
  (tag F).** Post-pilot. Provider decision (Stripe / Adyen / Netgíró)
  punted to the post-pilot kick-off so it gets dedicated focus.

- **8.2** ~~Dunning workflow~~ — **deferred per ADR 0005 (tag F).**
  Lives on top of the payment provider; ships in the same post-pilot
  package as 8.1.

- **8.3** Backup verification by restore drill. Nightly Neon PITR
  backups; once this sprint, actually restore to a scratch branch and
  run the app against it.
  - *Exit:* Restore drill runbook exists; executed successfully once.

- **8.4** ~~EU residency *verification ceremony*~~ — **deferred per
  ADR 0005 (tag F).** Runtime posture (CF Data Localization, Neon EU
  region, R2 EU jurisdiction, DO `locationHint=weur`) is in place from
  earlier sprints and stays in place. The deferred work is the
  audit-trail ceremony: documented residency runbook, per-quarter
  re-verification, sign-off paperwork. Communicate the *posture stays /
  ceremony defers* split clearly to any privacy-conscious pilot
  customer.

- **8.5** Load test OCPP gateway. Spin up N simulator chargers (100,
  1000, 10000 target), measure CPU/memory/latency of the DO fleet.
  Document the ceiling.
  - *Exit:* Load test results document exists; ceiling is above
    3× pilot scale.

**Risks.** Restore drill will find problems; allocate a day for
unexpected fixes.

---

## 12. Sprint 9 — Multi-Tenant + White-Label

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md), tag A):**
> Multi-tenant onboarding, per-Host branding, RLS, and scoped API keys
> ship for pilot. **OCPP 2.0.1 adapter is deferred to post-pilot**
> (groups under tag A, Roaming, since 2.0.1 unlocks 2.0.1-only roaming
> partners). Pilot stays on OCPP 1.6J.

**Goal.** Prove the platform is a platform, not a single-customer app.
Second org onboards cleanly; branding scopes work; multi-tenant
isolation is enforceable.

**Entry.** Sprint 8 exit met.

**Exit.** A second (staged) org onboards end to end. Per-Host branding
applies to driver-facing surfaces. API keys + scopes work for partner
integrations.

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

- **9.5** ~~OCPP 2.0.1 adapter~~ — **deferred per ADR 0005 (tag A).**
  Post-pilot. Pilot stays on OCPP 1.6J. The gateway / translator
  module boundary (`gateway/src/translator.ts`) was deliberately
  designed to admit a second protocol version as a sibling module
  without rework — adding 2.0.1 post-pilot is additive.

**Risks.** RLS can slow down queries; measure before enabling in hot
paths.

---

## 13. Sprint 10 — Pilot Go-Live (demonstrable, not commercial)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md)):**
> The pilot is a **demonstrable platform**, not a commercial release.
> Real chargers, real drivers, real session activity — but no money
> movement during the pilot window. Commercial readiness lives in
> the post-pilot backlog (tags A–F).

**Goal.** Real chargers (OCPP 1.6J) communicating with Straumvakt.
Real pilot drivers using user/password login + RFID at the charger
to start sessions. Operator console runs the site. Billing dashboard
shows what *would* be invoiced. Pilot retrospective captured.

**Entry.** Sprint 9 exit met.

**Exit.** Pilot site is live on Straumvakt. Real charger sessions
complete end-to-end. Billing dashboard reflects the period's
activity. Backup restore drill executed at least once. Pilot
retrospective written and post-pilot plan outlined.

**Milestones.**

- **10.1** Real chargers onboarded. Whichever hardware the pilot uses
  (Zaptec / Easee via vendor adapter; or generic OCPP 1.6J via the
  gateway) — provisioned, connected, status showing healthy.
  - *Exit:* Pilot chargers visible in operator console with live
    `Available` status.

- **10.2** Real drivers invited. Pilot 6 drivers onboarded via
  email/password sign-up; family groups created where relevant; RFID
  cards assigned where applicable.
  - *Exit:* All 6 drivers completed sign-up and appear in users list.
    Each has at least one assigned RFID card.

- **10.3** Pilot session lifecycle. Real driver presents RFID at a
  pilot charger; session starts; meter values stream; session ends.
  Session row + projection state visible in operator console;
  driver's PWA history updates.
  - *Exit:* At least 10 real sessions completed during pilot window
    with no operator intervention.

- **10.4** Billing dashboard reviewed against pilot activity.
  Per-driver and per-Host accumulated amounts (ISK) match what the
  tariff engine computed for each session. Operator and at least
  one driver review the dashboard during the pilot window.
  - *Exit:* Dashboard totals reconcile to tariff-engine output for
    every pilot session. **No invoices issued during pilot per ADR
    0005 (tag E)** — manual operator-side invoicing is a post-pilot
    or operator-side task, not a Straumvakt pilot deliverable.

- **10.5** Runbooks finalized. Incident response, backup restore,
  OCPP reconnect troubleshooting, common operator tasks. Living
  doc in `/docs/runbooks/`.
  - *Exit:* Runbook index exists; each top-5 scenario documented.

- **10.6** Pilot retrospective. What went right, what broke, what the
  data says, what the drivers and operator say. Post-pilot plan
  drafted, listing the order in which tags A–F (per ADR 0005) are
  picked up.
  - *Exit:* Retrospective doc written; post-pilot plan outlined (next
    two sprints of priorities — typically tag F first since it
    unlocks money movement).

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
