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

> **Pilot is admin-functionality only — a demonstrable platform from
> the operator's seat.** Scope tightened across four passes on
> 2026-04-25/26:
> [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md) (rev 1)
> deferred six topical groups;
> [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md) (rev 2) added
> Sprints 2 (Admin Onboarding + Zaptec) and 4 (Data Storage
> Lifecycle), and moved Driver Experience and the Issue Engine entire
> sprints to post-pilot;
> [ADR 0008](../adr/0008-cost-center-splitting.md) (rev 3) added
> cost-center splitting + inherited contracts + driver-contract
> routing;
> [ADR 0009](../adr/0009-drop-charger-host-tier.md) +
> [ADR 0010](../adr/0010-organization-profile-enrichment.md) (rev 4,
> 2026-04-26) drop the ChargerHost tier and enrich
> Org + User profiles with kennitala, contacts, addresses, multi-role
> array, plus the OCPP configuration-key registry — making Org the
> queryable seat-of-record for retailers, DSOs, vendors, contractors,
> payers, and the platform itself.
> [ADR 0011](../adr/0011-control-plane-optionality.md) (rev 5,
> 2026-04-26) reframes Straumvakt as the protocol-neutral operating
> layer: native OCPP, OEM API control, hybrid control, external CPMS
> overlay, and read-only intelligence are all first-class modes.
> [ADR 0007](../adr/0007-circuit-asset-tier-back.md) re-adds the
> Circuit asset tier. See
> [`straumvakt_roadmap.svg`](./straumvakt_roadmap.svg) for the visual
> roadmap and
> [`cost_center_splitting_model.svg`](./cost_center_splitting_model.svg)
> for the rev-3 splitting model.

- One pilot site operating on Straumvakt with real chargers and real
  charger session activity (no driver-facing surface, no money
  movement during pilot)
- Both native-OCPP and non-native control paths represented in the
  operator model. At minimum, the pilot should keep the native OCPP
  path alive and show an OEM API / external CPMS / read-only asset
  path using the same asset, session, billing, and operations surfaces.
- **Admin onboarding tooling** for the entire entity hierarchy
  (Org/CPO → Property → Site → Installation → Circuit → physical
  charging asset → optional control endpoint) plus admin-side User /
  Membership CRUD. Beta operator console shell.
- **Vendor/API and overlay readiness** — OAuth/API credential capture,
  installation discovery, charger metadata, session/history import,
  capability profiles, and control routing for Zaptec/Easee-style AC
  OEMs and external CPMS mode (Sprint 2)
- **Charge log retention machinery** — V3 §8 retention classes
  enforced: nightly aggregation of `raw_protocol` → `aggregate`,
  `raw_protocol` ageing-out at 30–90 days, financial + operational
  kept hot indefinitely (Sprint 4)
- Commercial model **schema + cost-center splitting** live (Sprint 2.6
  migration via [ADR 0008](../adr/0008-cost-center-splitting.md): 8
  cost factors as a runtime catalog, per-tier inherited contracts,
  driver contracts with factor overrides, calendar-month period
  accumulators). Sprint 5 ships the resolver/tariff engine; Sprint 6
  ships a read-only **billing dashboard** split by cost center (no
  invoice generation, no inter-org settlement)
- **CPO-side** OCPI (locations, sessions, CDRs, tariffs, basic RFID
  authorize). eMSP endpoints + OCPI token push deferred to post-pilot
- Push API with canonical event vocabulary
- EU residency **posture** in place (Cloudflare Data Localization,
  Neon EU region, R2 EU jurisdiction). Verification *ceremony*
  (audit runbook, sign-off paperwork) deferred to post-pilot
- Backups verified by restore drill (Sprint 8)
- Multi-tenant onboarding wizard, Host branding, RLS, scoped API
  keys (Sprint 9)
- ISK currency only (multi-currency post-pilot)
- **Pilot Go-Live (Sprint 10):** real chargers or imported real
  charger sessions, admin runs the site, sessions logged, presentable
  billing data, no driver onboarding during pilot. Native OCPP is
  preferred for one path but not required for every pilot asset.

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

#### 1.2b — Deferred from pilot to post-pilot

Tags A, C, E, F unchanged from rev 1 (ADR 0005). Tags **B and D
expanded** in rev 2 (ADR 0006) to absorb the entire Driver Experience
and Issue Engine sprints. Tags match the
[roadmap SVG](./straumvakt_roadmap.svg).

- **A · Roaming** — eMSP endpoints, OCPI token push to roaming
  partners, OCPP 2.0.1 adapter
- **B · Driver Experience** *(expanded — entire sprint)* — driver
  self-signup + login (any kind), driver PWA shell, Auðkenni
  electronic-ID (OIDC), QR-code session start, family groups,
  employer reimbursement workflow. Pilot has admin-created driver
  records only; no driver-facing surface.
- **C · Multi-currency** — EUR + per-locale variants on top of
  ISK-only pilot
- **D · Issue Engine** *(expanded — entire sprint)* — five basic
  detection rules, ticket workflow, helper role, charger lifetime
  history, operator console issue pages, advanced detection, smart
  routing, ML categorization, helper reputation scoring. Pilot
  operator diagnoses by hand from the raw event log.
  > **Partially re-sequenced into go-live by [ADR 0032](../adr/0032-neighbour-helper-and-issue-engine-go-live.md).**
  > Pulled forward into the going-public production push: the five basic
  > detection rules, ticket workflow + console issue pages, and the
  > **neighbour-helper (*nágrannahjálp*)** capability — modelled as a
  > flag on `agreements.driver_group_memberships`, **not** the deprecated
  > `tenancy.MembershipRole.helper` staff enum (removed in the Sprint 9
  > RLS rebuild). **Still deferred post-pilot:** advanced detection, smart
  > multi-tier routing automation, ML categorization, helper reputation
  > scoring, charger lifetime-history analytics, and the contractor /
  > marketplace ops layer. Owner-routing (ADR 0008) and the
  > `assignedToContractorId` contractor path are unchanged / still
  > deferred.
- **E · Real billing** — monthly invoice generation, billing
  transactions as ledger entries, statements, employer
  reimbursement workflow, PDF invoices
- **F · Commerce + compliance** — payment provider integration,
  dunning workflow, EU residency *verification ceremony* (the
  runtime *posture* stays in place during pilot)

### 1.3 Success criteria for pilot

Pilot is judged successful when all of the following hold for 30
consecutive days:

1. ≥95% of charging sessions complete (ie. observe Boot →
   StartTransaction → MeterValues → StopTransaction without
   operator intervention)
2. ≥99% OCPP gateway uptime (excluding planned maintenance windows)
3. **Billing dashboard reflects what *would* have been invoiced** —
   per-driver and per-Host totals, per-period rollups, all reviewable
   in the operator console. *Real invoice generation + payment is
   post-pilot per ADR 0005 / 0006.*
4. ~~Issue Engine has opened, routed and resolved 10 real issues~~ —
   replaced by: **operator can produce an event-log dump for any
   real-world charger fault during pilot using the diagnostics drawer
   + raw event log.** Issue Engine itself is post-pilot per ADR 0006
   (tag D).
5. ~~Driver NPS from the 6 pilot drivers ≥ 40~~ — removed: pilot has
   no driver-facing surface (ADR 0006). Driver NPS criterion returns
   when Driver Experience ships post-pilot.
6. **Charge-log retention runs cleanly** — nightly aggregation job
   has fired ≥ 30 times during pilot, raw_protocol rows older than
   the configured TTL are demonstrably purged, financial events are
   preserved (ADR 0006 Sprint 4 acceptance).
7. Zero Rule-1 / Rule-2 / Rule-3 / Rule-5 violations from CLAUDE.md
8. Zero data loss incidents
9. Backup restore drill completed successfully at least once

---

## 2. Sprint overview

| # | Sprint | Goal | Exit criterion |
|---|---|---|---|
| 0 | Foundation Schema | V3 schema live; concrete drying | All V3 schemas created (incl. `hardware` + `properties.installations`), catalog seeded (Zaptec + Zaptec Pro minimum), tsc clean, build clean, money as BIGINT minor units. No CPMS backfill (ADR 0003). |
| 1 | OCPP Foundation | One simulator charger, full loop | Simulator boots, starts session, ends session; events in log; commands dispatchable via outbox |
| 2 | **Admin Onboarding + Vendor/API/Overlay Readiness + Cost-Center Splitting + Foundation Profile Rev** *(NEW per ADR 0006; expanded per ADRs 0008 + 0009 + 0010 + 0011)* | Admin can stand up the entity hierarchy, onboard a Zaptec/Easee-style vendor installation or external-control asset, configure cost-center splitting, and operate against fully-enriched Org + User profiles | Admin CRUD live for Org/CPO, Property, Site, Installation, Circuit (per ADR 0007), physical charger/connector records, optional OCPPIdentity/control endpoint, vendor/external references, and capability/routing metadata — **ChargerHost tier dropped per ADR 0009.** Org + User profiles enriched with kennitala, contacts, addresses, branding, multi-role array per ADR 0010. iceland-energy-parties seeded as real Org rows. Charger onboarding wizard wires Zaptec OAuth + API enrichment and leaves room for Easee/API-control and external CPMS overlay modes per ADR 0011. Beta operator console shell. **Plus ADR 0008 milestones 2.10–2.13:** runtime cost-factor catalog (8 factors seeded), per-tier inherited contracts with factor assignments, driver-contracts with factor-level overrides, calendar-month period accumulators backing kWh-cap allocation rules. **Plus ADR 0010 milestone 2.14:** OCPP configuration-key registry (`ocpp.configuration_keys`) populated by GetConfiguration/ChangeConfiguration round-trips. |
| 3 | **Identity Foundation** *(per ADR 0015 — was OCPI Foundation; OCPI defers to Sprint 15+)* | Polymorphic IdToken, audience-tagged users, S1 events-ingest fix | Path A1 schema (audience enum, IdToken polymorphism), S1 events-ingest port to apps/api, OCPP Authorize handler wired to identity model. |
| 4 | **Membership + Permissions Foundation** *(per ADR 0014 build order)* | Real RBAC layer behind a still-bootstrap session | Membership lifecycle + PlatformGrant; permission catalogue (40 verbs, 13 bundles) + `effectivePermissions()`; `requirePermission` middleware migrated across ~60 admin routes; `Installation.enforceAuthorize` flag wired through gateway. |
| 5 | **Queue-Backed Inbound OCPP + Invite Flow MVP** *(per ADR 0017)* | Charger WebSocket responses stay sub-second under DB load; agents can be invited | Cloudflare Queue + DLQ in front of all inbound OCPP events; idempotent consumer keyed by `eventId`. **Parallel track:** invite-flow MVP + bootstrap-admin User row. |
| 6 | **Data Platform + ORM Decision** *(per ADR 0017 — ADR 0018 deliverable)* | The persistence model that survives 4k chargers is decided in writing | ADR 0018 committed: data-product taxonomy (operational / current-state / outbox / billing-grade / time-series / raw archive / aggregate / report-ready / API-metadata), Neon-with-partitioning vs Timescale decision, ORM boundary (Prisma control plane vs raw SQL hot path), R2 layout. **No code; the deliverable is the decision.** |
| 7 | **Hot Ingest + Retention + R2 Archive** *(per ADR 0017)* | Postgres stays bounded at 4k-charger volume; raw OCPP payloads survive for billing-dispute evidence | Queue consumer rewritten to raw-SQL batches per ADR 0018; 7-day retention on `raw_protocol`; per-day R2 partition archive; aggregate + report-ready tables populated. |
| 8 | **Tariff Engine + Billing Dashboard** *(was Sprint 5; per ADR 0017)* | The money math works (ISK only); operator can review accumulating amounts | Pure-function tariff engine; CustomerPlan + ChargerServicePlan; plan-priority resolver; billing dashboard reads from Sprint 7 report-ready tables. **Parallel track:** driver self-registration + impersonation flow (deferred from Sprint 5); export pipeline MVP. |
| 9 | **Outbound Command Hardening + Load Test Harness** *(per ADR 0017)* | THE sprint that proves the architecture | Outbox state machine with retry semantics; gateway command-result event ingest; load-test simulator at 100 → 500 → 1000 → 4000 chargers — staging survives 4000-charger sim at 30s MeterValues for 1 hour without DLQ growth. |
| 10 | **Observability + Security/Tenancy** *(was scattered across "Hardening + Multi-Tenant"; per ADR 0017)* | 4k chargers cannot be operated by tail-watching — dashboards, alerts, RLS land here | Production dashboards (charger counts, queue depth, command latency, R2 archive growth); structured logs with correlation IDs; alert thresholds; runbooks for the 14 named failure modes; Postgres RLS as defense-in-depth; AuditAction append-only DB enforcement; MFA mandatory on PlatformGrant. |
| 11 | **Production Cutover + Pilot Go-Live** *(per ADR 0017 — was Sprint 10)* | First batch on scale-validated infrastructure | Production resources provisioned (CF prod Workers, Neon prod plan, R2 buckets, Hyperdrive, Queues + DLQs); migration dry-run; final 4k-staging load test against production-like config; rollback paths for UI / API / gateway / DB; go/no-go checklist signed; pilot ramp begins (target ~50 chargers, scaled by who's contracted). |

Total: 22 weeks / 5.5 months at full-time solo pace (post ADR 0015 + ADR 0016 + ADR 0017 cascade).

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

## 5. Sprint 2 — Admin Onboarding + Zaptec API Enrichment

> **Pilot scope (per [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md)):**
> Admin tooling lands early so every downstream sprint can test
> against real-shaped data. Includes Zaptec OAuth + API enrichment as
> a vendor adapter ride-along. Beta operator console shell. Billing
> UI scaffold. No driver-facing surface.
> [ADR 0007](../adr/0007-circuit-asset-tier-back.md) re-adds the
> Circuit asset tier as part of milestone 2.6.

**Goal.** A platform admin can stand up the entire entity hierarchy
and onboard a Zaptec installation end-to-end — from creating an Org
through to a charger streaming events into the platform. Zero gap
between "V3 schema exists" and "platform is operable."

**Entry.** Sprint 1 exit met (E2E simulator test green).

**Exit.** Admin user can: create Org/CPO, ChargerHost, Property,
Site, Installation, Circuit (per ADR 0007), Charger, OCPPIdentity,
and Connector rows from the operator console; invite members and
assign roles; run the charger onboarding wizard end-to-end with
Zaptec OAuth + API enrichment; see the beta operator console shell
(sidebar, topbar, role-aware nav); see the billing UI scaffold
(read-only, real numbers come in Sprint 6).

**Milestones.**

- **2.1** Org / CPO / Host admin CRUD. Operator console pages plus
  repository functions for `tenancy.organizations` and
  `hosts.charger_hosts`.
  - *Exit:* Admin creates an Org and a Host from the console; both
    rows appear; can be edited and (soft-)deleted.

- **2.2** Membership + invite admin CRUD. `tenancy.memberships`,
  `identity.users` (admin-created only — no signup during pilot),
  role assignment across admin / operator / helper / driver.
  Driver-creation path verified as inert-record-only per ADR 0006
  (no signin during pilot).
  - *Exit:* Admin creates a user record + assigns Org + role; row
    appears in users list; driver record can be linked to OCPP
    `idTag`s.

- **2.3** Property / Site admin CRUD. `properties.properties`,
  `properties.sites`. Site form carries timezone, address, contact.
  - *Exit:* Admin creates Property + Site for a Host; rows appear
    in nav-tree under the Host.

- **2.4** Installation admin CRUD. `properties.installations` with
  optional vendor link (vendor row + `vendor_installation_ref`).
  - *Exit:* Admin creates an Installation under a Site; can leave
    it vendor-less (manual install) or link a Zaptec / Easee
    account placeholder for the Sprint 2.7 wizard to populate.

- **2.5** Charger / OCPPIdentity / Connector admin CRUD. Charger-kind
  `properties.site_assets`, `ocpp.ocpp_identities`, `ocpp.connectors`.
  Authentication secret hashing (`auth_secret_hash`) for OCPP
  Basic-Auth identity.
  - *Exit:* Admin creates a charger row → OCPPIdentity → Connectors;
    Basic-Auth credential roundtrips through `auth_secret_hash`;
    simulator can connect using the created identity.

- **2.6** **Circuit asset tier migration (per [ADR 0007](../adr/0007-circuit-asset-tier-back.md)).**
  Additive migration adds `properties.circuits` and an optional
  `circuit_id` FK on charger-kind `site_assets`. Admin Circuit CRUD
  page added to nav; Circuit selector wired into charger-create form.
  - *Exit:* Migration applied to staging Neon branch; Circuit CRUD
    works; charger can be assigned to a Circuit; ER diagram and
    architecture canon §4 updated.

- **2.7** Charger onboarding wizard with Zaptec OAuth + API enrichment.
  `vendors.vendor_credentials` stores installation-scoped Zaptec OAuth
  tokens; wizard fetches the installation list from Zaptec; admin
  selects an installation; wizard pre-fills Site / Installation /
  Circuit / Charger metadata; admin reviews and saves.
  - *Exit:* End-to-end demo from "Add Charger" → Zaptec OAuth → pick
    an installation → save a charger row whose `vendor_circuit_ref`
    and `vendor_installation_ref` point at real Zaptec entities.

- **2.8** Beta operator console shell. Sidebar, topbar, role-aware
  nav (admin sees everything; operator sees site-scoped nav; helper
  sees their assigned sites). Placeholder pages for nav items later
  sprints fill in (Issues — post-pilot per ADR 0006 D; Billing
  dashboard real data — Sprint 6).
  - *Exit:* All nav items render; role-restricted nav verified for
    at least one admin and one operator user.

- **2.9** Billing UI scaffold. Read-only billing dashboard page
  exists with placeholder copy. Real numbers wire in Sprint 6.
  - *Exit:* Page renders, shows "no data yet" empty state pointing
    at Sprint 6.

**Risks.** Zaptec OAuth scopes / API rate limits — verify token
handling and rate-limit behaviour before committing to a wizard UX.
CRUD form explosion is the obvious time sink — keep forms minimal
(only the fields the next sprints actually read).

---

## 6. Sprint 3 — Identity Foundation (ADR 0014 closure + S1 events-ingest fix)

> **Scope swap recorded in [ADR 0015](../adr/0015-sprint-3-scope-swap-ocpi-to-identity.md):**
> The original Sprint 3 ("OCPI Foundation (CPO-only for pilot)") deferred
> mid-sprint when ADR 0014 work substituted. OCPI moves to a new **Sprint 14
> — OCPI Foundation (post-pilot)**. The gbtNotes scale-plan item **S1
> (events-ingest path fix)** absorbs into this sprint's closure list. This
> rewrite preserves Sprint 3's slot in the calendar but replaces its goal
> with the work that actually shipped + the operational items that must close
> alongside it.

**Goal.** ADR 0014's Build-Order *"NOW (Sprint 3 finish)"* items land. The
identity-model schema additions (`UserAudience`, `IdToken`, `UserVendorRef`,
`VendorUserGroup`, `VendorUserGroupMembership`, `Vehicle`) gain at least
one write path each so they exit orphan-table status. The events-ingest
path on staging is fixed so projections actually fire under inbound
charger traffic. The OCPP Authorize handler on the gateway either becomes
real or Dalvegur reverts to anonymous — the unsafe middle is closed. Sprint 3
has a known-true exit and Sprint 4 can pull from the membership-and-permissions
queue without inheriting Sprint 3 carry-forward.

**Entry.** Sprint 2 exit met (admin onboarding flow demonstrable). ADR 0014
authored (2026-05-01). ADR 0015 authored (2026-05-02).

**Exit.** All items in [docs/retros/sprint-03.md "closure list"](../retros/sprint-03.md)
are checked. Specifically:

1. Identity-schema new tables have repository-level write paths (not just DDL).
2. gbtNotes Sprint S1 lands: `/api/ocpp/events` ports to `apps/api`,
   gateway URL one-line update, UI-Worker-side route deleted, smoke list
   passes (BootNotification, Heartbeat, MeterValues, StatusNotification,
   StartTransaction → ChargeSession row, StopTransaction).
3. Dalvegur is not running with `AuthenticationType=2` against a stub
   gateway. Either the gateway Authorize handler is real (per the design
   sketched 2026-05-02), or the Zaptec installation is reverted to
   `AuthenticationType=0`. Pick one; not picking is not an option.
4. ADR 0015, this delivery plan edit, and the Sprint 3 retro are committed
   on the working branch.

**Milestones.**

- **3.1** ADR 0014 schema landed.
  - *Status:* DONE — migration `20260502120000_user_profile_enrichment`,
    commit history under `[Sprint 3 / ADR 0014]` tag.
  - *Exit:* `npx prisma validate` clean against the new schema; migrations
    apply cleanly to a fresh local Neon branch.

- **3.2** Orphan-table write paths. Each of `IdToken`, `UserVendorRef`,
  `VendorUserGroup`, `Vehicle` gains at least one repository function
  that writes (not just lists). Manual admin user-create extension is
  the canonical path for `IdToken` and `UserVendorRef` — operator creates
  a user in `/people/users/new` and attaches RFID tokens inline in the
  same form. `VendorUserGroup` keeps its current "deferred sync engine"
  stance but stops being claimed as part of Sprint 3 closure (its write
  path is a Sprint 4+ concern).
  - *Exit:* a hand-tested round trip — create a user with an RFID token
    via the admin form; row exists in `identity.id_tokens`; surfaces in
    the user-detail page; revoke works; idempotent re-create surfaces
    the existing row instead of duplicating.

- **3.3** Sprint S1 events-ingest port. Per
  [`gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md`](../../gbtNotes/2026-05-01-ocpp-ingest-current-state-and-gaps.md)
  and the seven sharpenings from
  [`gbtNotes/ocpp-ingest-note-review.md`](../../gbtNotes/ocpp-ingest-note-review.md).
  Files port from `src/lib/ocpp/{event-envelope,projections,bootstrap}` and
  `src/lib/repositories/events` into `apps/api/src/lib/ocpp/*` and
  `apps/api/src/lib/repositories/events.ts`. New Hono handler at
  `apps/api/src/routes/internal/ocpp-events.ts`, mounted at
  `/api/internal/ocpp-events` (renamed from `/api/ocpp/events` for prefix
  consistency). Gateway `gateway/src/ingest-client.ts` updated. UI-Worker-side
  `src/app/api/ocpp/events/route.ts` and supporting files **deleted in the
  same change set** to avoid a foot-gun where both routes accept traffic.
  Idempotency-key derivation, transaction boundary, and dedupe TTL
  preserved exactly. Auth-secret parity diff between the two existing
  ingest-auth modules done before cutover.
  - *Exit:* staging gateway forwards a synthetic event; `apps/api`
    accepts; ingest test passes for missing header / malformed JSON /
    invalid envelope / idempotent replay / fresh event success;
    `OcppIdentity.lastSeenAt` ticks on Heartbeat from a real charger;
    `Connector.status` flips on StatusNotification; a `ChargeSession`
    row appears on StartTransaction.

- **3.4** OCPP Authorize handler real-or-revert. Operator chooses one:
  - **(a)** Replace gateway `Authorize.req` and `StartTransaction.req`
    stubs with calls to a new `/api/internal/ocpp-authorize` route. Route
    looks up `IdToken` by `value`, applies status + scope rules, returns
    OCPP-shaped `idTagInfo`. Per-installation `enforceAuthorize` flag
    defaults `false` (shadow mode — log verdicts, return Accepted) so
    deployment doesn't break customers. Flip to `true` per-installation
    once the IdToken table is seeded.
  - **(b)** Operator reverts Dalvegur installation to `AuthenticationType=0`
    in the Zaptec portal. Dev stub stays in the gateway as documented
    in `identity-do.ts:206-207`. Real handler ships in Sprint 4 or later.
  - *Exit:* whichever path was picked, verified against the live Dalvegur
    installation. The unsafe middle ("auth required + stub gateway")
    is closed.

- **3.5** Reconciliation docs. ADR 0015, this delivery-plan §6 rewrite,
  the Sprint 3 retro at `docs/retros/sprint-03.md`. Retro names
  carry-forward items into Sprint 4 explicitly.
  - *Exit:* all three docs committed; ADR 0015 cross-referenced in
    ADR 0014 (`Relates to:` line); delivery plan §11 (post-pilot timeline)
    references the new Sprint 14 OCPI placement.

**Risks.**

- **3.2 surface area is larger than it looks.** Five new tables, each
  needing one write path. The admin form rewrite is the bulk of it.
  If a write path surfaces a schema issue (e.g., `VendorUserGroup`
  tenancy semantics unclear), the milestone carries forward to Sprint 4
  as captured carry-forward, not silent drift. Capture in the retro.
- **3.3 is a coordinated gateway+API deploy.** Atomicity matters. Plan
  a deploy window outside customer traffic. Production cutover
  (gateway from `hlada` to `hlada-api`) is **deferred to Sprint 4** —
  Sprint 3 only cuts staging. The note's review §10 covers the
  production sequence.
- **3.4 cannot drift.** It's the operational safety item. Pick a path
  on day one of the closure window; do not let the unsafe middle persist.

**Out of scope (deferred to Sprint 4 or later).**

- `MembershipRole` + `MembershipStatus` enums and lifecycle fields → Sprint 4.
- `requirePermission(...)` middleware migration from `requireAdmin` → Sprint 4.
- Invite flow + driver self-registration → Sprint 5.
- Membership scope narrowing (`scopeSiteIds`, `scopePropertyIds`) → Sprint 4.
- `PlatformGrant` rename + role bundling → Sprint 4.
- Sidebar restructure (Operations / Tenants / Platform per ADR 0014's
  navigation section) → Sprint 4 (UI work paired with the permissions migration).
- VendorUserGroup write/sync paths → Sprint 4 or later.
- OCPI Foundation work (originally 3.1–3.5) → **Sprint 14 (post-pilot)**.
  Schema scaffolding (`roaming.external_properties`, `roaming.cdr_queue`,
  `roaming.ocpi_tokens`, `roaming.hub_connections`) stays in place from
  Sprint 0 so the post-pilot add is additive, not migration-bearing.

---

## 7. Sprint 4 — Membership + Permissions Foundation (ADR 0014 build order)

> **Scope shift recorded in [ADR 0015](../adr/0015-sprint-3-scope-swap-ocpi-to-identity.md):**
> Sprint 3 absorbed identity-foundation work that ADR 0014 originally
> scheduled for here. With that schema landed, Sprint 4 picks up ADR
> 0014's "Sprint 4 (membership + permissions foundation)" build-order
> items and ships the first real role-aware authorization. The
> previous occupant of this slot — **Data Storage Lifecycle** — slips
> to **Sprint 6**: at the pilot scale (20 chargers × 30 days = ~3 M
> events) the unbounded growth that motivated the original placement
> isn't blocking, while membership + permissions IS blocking real
> customer onboarding (ADR 0014 §"These gaps will block"). Plus the
> Sprint 3 carry-forward items (production cutover for events ingest,
> per-installation `enforceAuthorize` flag) land here so they don't
> haunt Sprint 5.

**Goal.** Operators stop being a binary `requireAdmin` check and
become real role-bearers. Customer admins can invite team members in
Sprint 5; this sprint lays the model and middleware that Sprint 5
plugs into. Plus the production gateway flip and per-installation
auth-enforce flag — Sprint 3 carry-forward closure items.

**Entry.** Sprint 3 closure list checked (membership scaffolding
shipped, S1 events-ingest port live on staging, Authorize handler in
shadow mode, ADR 0015 + retro committed).

**Exit.** All six milestones below have a green test or a hand-tested
round-trip; the last `requireAdmin` call in `apps/api/src/routes/admin/*`
is replaced with `requirePermission`; production gateway binds to
`hlada-api` (not `hlada`) and the events route is renamed to
`/api/internal/ocpp-events`; Dalvegur runs with `Installation.enforceAuthorize=true`
and only seeded RFIDs charge.

**Milestones.**

- **4.1** Membership / Platform schema additions. `MembershipRole` +
  `MembershipStatus` enums; `Membership` lifecycle fields
  (`invitedById`, `invitedAt`, `acceptedAt`, `suspendedAt`, `revokedAt`,
  `scopeSiteIds[]`, `scopePropertyIds[]`); `PlatformAdmin` → `PlatformGrant`
  rename with role + lifecycle + nullable scope JSON. **Additive
  only** per Rule 4 — drops only the `PlatformAdmin` table after
  backfill into `PlatformGrant`.
  - *Exit:* migration applies cleanly to a fresh local Neon branch;
    every existing `PlatformAdmin` row materialised as `PlatformGrant`
    with `role='platform_admin'`; every existing `Membership` row
    backfilled with `role='admin'`, `status='active'`,
    `acceptedAt=createdAt`.

- **4.2** Permission catalogue + role-to-permission map. `~30` atomic
  verbs in `apps/api/src/lib/auth/permissions.ts` per ADR 0014's
  Layer-4 listing; `MEMBERSHIP_ROLE_PERMISSIONS` and
  `PLATFORM_ROLE_PERMISSIONS` records mapping each enum value to its
  bundle. Exhaustive-switch test asserts every enum value has an
  entry.
  - *Exit:* permission set documented in code; map covers every
    `MembershipRole` and `PlatformRole` value; type test catches new
    enum values that don't have a map entry.

- **4.3** `requirePermission(perm)` middleware + admin-route
  migration. New middleware in `apps/api/src/lib/auth/`. Migrate
  `apps/api/src/routes/admin/*` route-by-route. `requireAdmin` stays
  during the transition for routes not yet migrated.
  - *Exit:* every admin route gated by either `requirePermission(...)`
    or `requireAdmin`; no orphan-style guards. Test per migrated
    route: minimal-permission user → 200; insufficient-permission user
    → 403.

- **4.4** Sidebar restructure (Operations / Tenants / Platform tiers
  per ADR 0014 §"Sidebar navigation reflecting this model"). Move
  Properties under Operations; rename current Accounts navigation to
  Tenants with three sub-tabs (Organizations / Agents / Drivers); add
  a Platform group visible only to `PlatformGrant` holders.
  - *Exit:* sidebar visibility responds to membership / platform
    grants; `requirePermission`-gated nav items hide for users
    without the verb; manual smoke against three test users (operator
    member, platform admin, no-perms).

- **4.5** Production cutover for events-ingest path. Per Sprint 3
  retro carry-forward. Atomic deploy: production gateway binding
  flips `hlada` → `hlada-api`; rename `/api/ocpp/events` to
  `/api/internal/ocpp-events` on api Worker; gateway URL flips; UI
  Worker route deleted (`src/app/api/ocpp/events/`,
  `src/lib/ocpp/{event-envelope,projections,bootstrap,ingest-auth}.ts`,
  `src/lib/repositories/events.ts`).
  - *Exit:* production gateway smoke list passes (`OcppIdentity.lastSeenAt`
    ticks on Heartbeat; `Connector.status` flips on StatusNotification;
    `ChargeSession` row appears on StartTransaction). UI Worker
    serves only `/(app)/*` routes; the events ingest path 404s
    cleanly on UI Worker (loud failure for any stale poster).

- **4.6** `Installation.enforceAuthorize` flag + per-installation
  enforced auth. Schema column added (boolean, default false). Gateway
  reads the flag from the API authorize response; when `true`, replies
  per the verdict; when `false`, stays in shadow mode (today's
  behaviour). Operator flips Dalvegur to `enforceAuthorize=true` once
  the IdToken table is verified seeded.
  - *Exit:* test charger swipe with seeded RFID → Accepted, session
    starts; swipe with unknown idTag → Rejected, no session; flag
    flip from operator UI persists and applies on the next
    Authorize.req.

**Risks.**

- **Schema migration in 4.1 is the largest single change since Sprint
  0** — touches `Membership`, `User`, replaces `PlatformAdmin`, trims
  `OrganizationRole` enum (already trimmed in Sprint 3 prep). Rule 4
  applies; explicit operator instruction needed before each schema
  edit. Migration runs once against staging Neon; backfill is the
  irreversible part. Test against a scratch branch first.
- **4.3 admin-route migration is mechanical but spans ~30 routes** —
  easy to miss one. Watch for routes still using `requireAdmin` after
  the migration sweep with a grep. Don't remove `requireAdmin` until
  every route is on the new middleware.
- **4.5 atomic deploy** — gateway and api Worker must deploy together.
  If gateway flips first while api Worker still serves old URL,
  production loses event ingest for the deploy window. Sequence: API
  mounts new URL → smoke → gateway URL flip → smoke → UI Worker
  route delete → smoke.
- **4.6 enforceAuthorize=true on Dalvegur is a customer-impacting
  flip** — without seeded tokens, every swipe rejects. Confirm IdToken
  table state (Sprint 3 backfill ran cleanly + every operator-known
  card has a row) before flipping.

**Out of scope (Sprint 5+).**

- Invite flow (agent + driver self-registration) → Sprint 5 per ADR 0014.
- Impersonation flow (audit + session swap + max duration) → Sprint 5.
- Postgres RLS as defense-in-depth → Sprint 9.
- AuditAction append-only DB enforcement → Sprint 9.
- MFA mandatory for `PlatformGrant` holders → Sprint 9.
- Data Storage Lifecycle (retention classes + nightly aggregation +
  age-out + cold archive) → **Sprint 6** (slipped from this slot).

---

## 8. Sprint 5 — Queue-Backed Inbound OCPP + Invite Flow MVP

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> The 4k-charger target makes queue-backed inbound OCPP a pre-pilot
> must-have, not post-pilot polish. ADR 0017 absorbs gbtNotes Sprint
> S2 as the headline of Sprint 5. Invite flow MVP rides as a parallel
> track (it's mostly UI + one schema, low scale-path interaction).
> Driver self-registration + impersonation slip to Sprint 8 (parallel
> track there). The previous Sprint 5 framing (Invite Flow + Driver
> Self-Registration + Impersonation per ADR 0016) is partially
> absorbed; the rest reschedules per ADR 0017's table.

**Goal.** Inbound OCPP events stop blocking on synchronous DB writes —
gateway DO enqueues to Cloudflare Queues, replies fast to charger,
API Worker consumer drains asynchronously. Charger WebSocket
turn-around stays sub-second when the database is slow. Plus: invite
flow MVP — agent invitation endpoint + accept-invite landing + the
bootstrap-admin-→-User-row spike that unblocks Sprint 4 carry-forward
work.

**Entry.** Sprint 4 closed (all six milestones shipped, retro
committed). ADR 0017 authored.

**Exit.** Both tracks green:
1. **Track A (queue-backed ingest):** A charger continues to receive
   timely OCPP responses while the database is slow or briefly
   unavailable. Inbound event lag is measurable. No valid event is
   lost during normal Worker/API retry paths. DLQ has a replay path.
2. **Track B (invite MVP):** Bootstrap admin has a real `User` row +
   `PlatformGrant`; `SessionPayload` carries `userId`. Agent invite
   token + accept-invite landing flow works end-to-end on staging
   (operator-curated email send for now). `UserCredential` polymorphic
   for `kind='password'` + `kind='magic_link'`.

**Milestones.** See [SPRINT_05_TASKS.md](../sprints/SPRINT_05_TASKS.md)
for detail; summary:

- **5.1** (Track A) Inbound queue + DLQ binding (gateway producer +
  apps/api consumer).
- **5.2** (Track A) Gateway DO enqueues; replies to charger
  immediately; legacy service-binding path stays as fallback for
  local dev.
- **5.3** (Track A) Idempotent consumer keyed by `eventId`. Validation
  failure permanent (DLQ). DB/transient retried. Tests for replay.
- **5.4** (Track A) Observability — queue depth, ingest lag, DLQ
  count (read-only via wrangler tail; full dashboards Sprint 10).
- **5.5** (Track B) Bootstrap admin → real `User` row spike. Option C
  (login-path upsert) per ADR 0017 open-decision resolution.
  `SessionPayload` extends with `userId`.
- **5.6** (Track B) Agent invite flow — `Invitation` model + admin
  POST + accept-invite GET/POST + `UserCredential.kind='password' |
  'magic_link'`.

**Risks.**
- **5.1 + 5.2 atomicity** — gateway and api Worker must deploy in
  order (api consumer first, then gateway producer). DLQ behavior
  during the deploy window: messages produced before the consumer
  is live land in the DLQ; manual replay after consumer goes green.
- **5.3 idempotency parity** with the existing `ingestEventInTx`
  shape (Sprint S1 port). Same idempotency-key derivation + dedupe
  TTL. Test "same eventId twice → no double row" against the new
  consumer path.
- **5.5 race condition** — concurrent logins to the bootstrap admin
  hit `INSERT ... ON CONFLICT` cleanly; verify with a test.
- **5.6 token security** — invitation tokens are bearers, treated
  like passwords. Hash before storage; constant-time compare. Sprint
  10 hardens further.

**Out of scope (defer per ADR 0017).**
- Driver self-registration (OTP) → Sprint 8 parallel track.
- Impersonation flow → Sprint 8 parallel track.
- Sub-resource route `assertPermission` retrofits → Sprint 8 (rides
  with tariff once invite-issued userIds are in sessions).
- Sprint 4.5 production-cutover dead-code cleanup → Sprint 10
  (after observability + security pass).
- OAuth / passkey / api_key credentials → Sprint 10.
- MFA on PlatformGrant → Sprint 10.
- Postgres RLS → Sprint 10.

---

## 9. Sprint 6 — Data Platform + ORM Decision *(delivered: ADR 0018)*

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> Sprint 6 absorbs gbtNotes Sprint S3 — a decision sprint, not a
> code sprint. **Landed as [ADR 0018](../adr/0018-data-platform-and-orm-boundary.md)
> (2026-05-03)** with the three decisions and the named-data-product
> taxonomy that Sprints 7 + 8 consume. Table-by-table classification
> in [DATA_PRODUCTS.md](./DATA_PRODUCTS.md).

**Goal.** Three decisions written down as ADR 0018, with named data
products that Sprint 7 + 8 consume:

1. **Telemetry data platform.** Neon-with-partitioning (default per
   ADR 0017) or Timescale Cloud, with rationale.
2. **ORM boundary.** Prisma scoped to admin CRUD + business
   workflows. Raw SQL / driver-level for queue consumers, event
   projection, batch insert, current-state upserts, MeterValues.
3. **Raw OCPP archive layout.** R2 bucket + key scheme + retention
   policy. The CDR-archive question for billing-dispute evidence.

**Entry.** Sprint 5 exit met (queue-backed ingest live on staging).

**Exit.** ADR 0018 committed with the three decisions and the named
data products. No production code changes; this is a decision sprint
with a written deliverable.

**Milestones.** See [SPRINT_06_TASKS.md](../sprints/SPRINT_06_TASKS.md)
for detail; summary:

- **6.1** Classify tables into the eight categories from gbtNotes
  S3 (control-plane / current-state / outbox / billing-grade /
  time-series / raw-archive / aggregate / report-ready / API-metadata).
- **6.2** Decision: Neon-with-partitioning vs Timescale Cloud.
  Includes plan sizing, write IOPS forecast, storage growth at 4k
  chargers, backup/PITR posture.
- **6.3** Decision: ORM boundary specifics. Which Postgres driver
  for hot paths (`pg` direct vs `postgres.js` vs other CF-compatible).
  Migration ownership stays Prisma-centralised.
- **6.4** Decision: raw OCPP archive layout. R2 bucket, key scheme
  (recommend `<orgId>/<yyyy>/<mm>/<dd>/<eventId>.json.gz` for evidence
  bundles), retention policy (recommend 7-year hot per VAT records,
  shorter for non-billing).
- **6.5** Named data products defined for Sprint 7 + 8 to implement:
  billing-period summaries, per-driver/session ledger, per-site
  energy report, charger uptime, command history, raw evidence
  bundle.
- **6.6** ADR 0018 written, reviewed, committed.

**Risks.**
- **Decision sprint feels like "no shippable feature."** Mitigation:
  ADR 0018 is the deliverable; Sprint 7's velocity depends on it.
  No pre-pilot calendar slip if Sprint 6 lands in 1 week.
- **Wrong decision compounds.** If we pick Neon-with-partitioning
  and Sprint 9 load test surfaces a Postgres ceiling, we re-pick at
  Sprint 7+ cost. Mitigation: Sprint 6 explicitly captures the
  fallback plan ("if Sprint 9 surfaces X, switch to Timescale via
  this migration path").

**Out of scope (defer).**
- Implementation of any of the above → Sprint 7.
- Tariff engine, billing dashboard → Sprint 8.
- Driver UX, OCPI → post-pilot.

---

## 10. Sprint 7 — Hot Ingest + Retention + R2 Archive

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> Sprint 7 implements gbtNotes Sprint S4. Replaces per-event Prisma
> writes in the queue consumer (Sprint 5) with raw SQL batched
> writes per ADR 0018 (Sprint 6). Retention enforcement, partition /
> hypertable strategy, aggregate tables, and the R2 raw archive
> all land here. **The CDR-archive work specifically — raw OCPP
> payload bytes archived to R2 for billing-dispute evidence —
> lives in this sprint.**

**Goal.** Postgres stays bounded under 4k-charger load. Raw OCPP
payloads archive to R2 with a known key scheme. Aggregate tables
power Sprint 8's billing dashboard. Report-ready datasets exist for
Sprint 8's exports + future enterprise APIs.

**Entry.** Sprint 6 exit met (ADR 0018 committed).

**Exit.** A 7-day-aged `raw_protocol` event-log row archives to R2 +
gets purged from Postgres in the nightly retention job. Aggregate
tables (per-charger-per-hour message count, energy delta, fault
count) populate as projections. Synthetic 4-million-row test
demonstrates the queue consumer batches writes at expected throughput.

**Milestones.** See [SPRINT_07_TASKS.md](../sprints/SPRINT_07_TASKS.md)
for detail; summary:

- **7.1** Replace queue consumer's per-event Prisma writes with raw
  SQL batched writes per ADR 0018. Same idempotency invariant.
  Same projection dispatch, but projection writes go via the new
  hot-path client.
- **7.2** Partition / hypertable strategy applied to `event_log`,
  `meter_values`, `charge_sessions`. Native Postgres if Neon
  decision; Timescale chunks if Timescale decision. Migration with
  forward-only, no rollback note.
- **7.3** Retention enforcement — daily cron deletes `raw_protocol`
  rows older than 7 days where the corresponding R2 archive write
  succeeded. `financial` and `operational` retention indefinite.
- **7.4** R2 raw archive — daily cron streams aged-out
  `raw_protocol` rows to R2 with the key scheme from ADR 0018
  (`<orgId>/<yyyy>/<mm>/<dd>/<eventId>.json.gz`). Per-day partition
  files. **CDR-evidence bundle work hangs off this** — Sprint 8's
  billing dashboard reads from these for dispute evidence.
- **7.5** Aggregate tables (per-charger-per-hour) + nightly
  aggregation job. Reads from raw rows BEFORE retention runs.
- **7.6** Report-ready datasets per ADR 0018 §"Named data products"
  — billing-period summaries, per-driver session ledger, charger
  uptime, command history.
- **7.7** Synthetic load: 4M synthetic events through the queue
  consumer in <1h on staging. Postgres write latency stays within
  budget.

**Risks.**
- **R2 write reliability under burst.** If R2 write fails AND
  Postgres retention cron has run, the raw evidence is gone. Mitigate:
  retention cron checks "R2 archive marker exists" before deleting;
  failed archive writes alert + retry, never delete.
- **Partition/hypertable maintenance.** New partitions need to exist
  before the date they cover; cron job. Forgotten = inserts fail.
  Mitigate: 7-day-ahead partition creation.
- **Aggregate consistency.** Aggregate row vs raw rows must reconcile.
  Sum/count assertions in spot-checks daily.
- **Rule 5 territory.** Hot-path SQL changes the canonical write
  path for billing-grade data. Stop-and-summarize before each
  milestone's code lands.

**Out of scope (defer).**
- Tariff engine + billing dashboard → Sprint 8 (consumes 7.5 + 7.6
  output).
- Push API + webhook delivery → Sprint 12+ post-pilot. Pilot ships
  without a webhook surface; operators read the dashboard.
- OpenTelemetry instrumentation across both workers → Sprint 10.

---

## 11. Sprint 8 — Tariff Engine + Billing Dashboard

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> Sprint 8 picks up the original Sprint 5 (Commercial Model) +
> original Sprint 6 (Billing Dashboard) content, since both fit
> naturally on top of Sprint 7's report-ready datasets. Plus parallel
> tracks for driver self-registration + impersonation flow (slipped
> from Sprint 5 per ADR 0017) + sub-resource route `assertPermission`
> retrofits (carry-forward from Sprint 4 — needs invite-issued userIds
> from Sprint 5).

**Goal.** Pure-function tariff engine produces correct ISK cost
breakdowns. Operator console "Billing" page renders per-driver +
per-Host totals from the tariff-engine projection. Drivers can sign
up for the mobile app via OTP. Straumvakt staff can impersonate for
support.

**Entry.** Sprint 7 exit met (hot ingest + R2 archive live).

**Exit.** Given a session, the tariff engine produces a correct ISK
cost breakdown. `CustomerPlan` and `ChargerServicePlan` both active.
Plan-selection priority resolver picks the right `CustomerPlan` per
user/site. Console Billing page renders for the pilot tenant with
real session data. Driver signup + OTP verify works on staging. ~30
sub-resource admin routes use `assertPermission` instead of bare
`requirePermission(verb)`.

**Milestones.** See [SPRINT_08_TASKS.md](../sprints/SPRINT_08_TASKS.md)
for detail; summary:

- **8.1** (Tariff) `CustomerPlan` + `ChargerServicePlan` schema.
  Products, tariffs, displays, country/currency, balance type.
  Rule 4 territory — additive.
- **8.2** (Tariff) Pure-function tariff engine
  `computeSessionCost(session, tariffChain): CostBreakdown`. Energy
  cost + time cost + overtime + total + tax. No I/O. 10 hand-computed
  scenarios pass.
- **8.3** (Tariff) Plan-selection priority resolver — user override >
  site > Host default > org default. 4 priority test scenarios.
- **8.4** (Billing UI) Operator-side dashboard reads from Sprint 7
  aggregate + report-ready tables. Per-driver totals, per-Host
  totals, per-period rollups, drillable to individual sessions.
  Read-only.
- **8.5** (Billing UI) Tariff-engine session cost projection lands
  in `charging.sessions.cost_minor` at session-stop. Test: 10
  sessions, `cost_minor` matches pure-function output exactly.
- **8.6** (Identity parallel) Driver self-registration. `POST
  /api/public/signup` + `POST /api/public/verify-otp`. OTP via
  staging stub provider; production SMS provider decision in Sprint 10.
- **8.7** (Identity parallel) Impersonation flow.
  `ImpersonationGrant` model. `POST /api/admin/platform/impersonate`.
  Audit-logged (`actor_user_id` + `acting_as_user_id` on every
  privileged write). 4-hour max duration.
- **8.8** (Carry-forward) Sub-resource route `assertPermission`
  retrofits (~30 routes from Sprint 4.4 carry-forward). Each route
  fetches the resource by id, gets orgId, calls `assertPermission`.

**Risks.**
- **Rule 5 territory.** Tariff math is the highest-stakes
  correctness surface in the platform. Stop-and-summarize before
  each tariff milestone. Synthetic-scenario tests are the only way
  to validate.
- **Sprint 7 dependency.** 8.4 (billing dashboard) reads from Sprint
  7 report-ready tables. If 7.6 slips, 8.4 slips with it.
- **OTP provider for 8.6.** Staging stub is fine for testing; pick
  a Cloudflare-friendly SMS provider in Sprint 10 before pilot.
- **Audit drift in 8.7.** Every privileged write under impersonation
  must log both actor and acting_as. Drift = security incident.

**Out of scope (defer).**
- ~~Multi-currency (EUR + per-locale variants)~~ → post-pilot per
  ADR 0005 (tag C). Schema accepts EUR; no plans created.
- ~~Invoice generation, billing transactions, statements,
  employer reimbursement, PDF invoices~~ → post-pilot per ADR 0005
  (tag E).
- ~~Driver-side billing view~~ → post-pilot per ADR 0006 (tag B).
- ~~Payment provider integration~~ → post-pilot per ADR 0005 (tag F).
- Push API + webhook delivery → Sprint 12+.
- OAuth / passkey credentials → Sprint 10.

---

## 12. Sprint 9 — Outbound Command Hardening + Load Test Harness

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> Sprint 9 absorbs gbtNotes Sprint S6 + S7. Outbound commands
> (remote start / stop / config / restart) get state-machine
> semantics, timeouts, and result-event correlation. The load test
> harness simulates 100 → 4000 chargers and proves the architecture
> from Sprint 5 (queue ingest), 7 (hot ingest + R2), and 8 (billing)
> survives at scale. **This is THE sprint that proves we can ramp to
> 4k.**

**Goal.** Operators can tell whether a command is pending, sent,
accepted, rejected, or timed out. A disconnected charger doesn't
cause data corruption or invisible command loss. Staging survives
4000-charger simulation at 30s MeterValues for 1 hour without DLQ
growth or unacceptable lag.

**Entry.** Sprint 8 exit met.

**Exit.** Outbound command state machine + UI visibility. 4000-charger
sim runs cleanly on staging. A/B persistence test results captured if
Timescale was the Sprint 6 fork (otherwise Neon-with-partitioning
results captured).

**Milestones.** See [SPRINT_09_TASKS.md](../sprints/SPRINT_09_TASKS.md)
for detail; summary:

- **9.1** Outbound command state machine — pending / dispatched /
  sent / accepted / rejected / timed_out / failed. Timeout
  semantics. Retry limits. Per-state transition audit.
- **9.2** Gateway command-result event ingest. Result events flow
  back through the inbound queue (Sprint 5). Idempotent. Same
  ORM-boundary rules as Sprint 7 (raw SQL for hot-volume; Prisma
  for command metadata).
- **9.3** Operator UI — command history per charger. Filter by
  state, by time. Drill into result payload.
- **9.4** Load test simulator. OCPP 1.6J charger sim, scriptable.
  Builds out runbook entries for: 100, 500, 1000, 4000 chargers,
  4000+reconnect storm, 4000+API-Worker-unavailable, 4000+
  Postgres-latency-spike.
- **9.5** Run the load tests. Capture metrics: queue depth, ingest
  lag, DLQ count, DB write latency, batch flush latency, command
  round-trip latency, partition growth, R2 archive throughput.
- **9.6** A/B persistence test (only if Sprint 6 chose Timescale —
  re-run against Neon-with-partitioning to validate the fork was
  correct). Otherwise: document Neon results as the reference.
- **9.7** Run report-export load tests concurrent with OCPP ingest
  (10 monthly session CSVs + 10 billing XLSX + 5 charger uptime
  reports + 1 raw evidence export). Confirm ingest lag stays
  acceptable.

**Risks.**
- **Surprises in the 4k sim.** This is the highest-variance sprint.
  Findings might require Sprint 10 + 11 to absorb fixes.
  Mitigation: budget Sprint 10 + 11 with float; if 9 slips, pilot
  Go-Live slips by the same amount.
- **Simulator framework choice.** Build vs adopt. Decision in
  9.4 design summary.
- **R2 archive backpressure under load.** If R2 throughput is the
  ceiling at 4k chargers, Sprint 7's per-day partition strategy
  needs revision (per-hour? per-org-per-day?).
- **Rule 5 territory.** Outbound command semantics changes
  alter access-grant resolution implicitly (charger.remote_start +
  member.write interaction). Stop-and-summarize per milestone.

**Out of scope.**
- Multi-tenant white-label re-skin (was Sprint 9 originally) →
  post-pilot per ADR 0017.
- OCPP 2.0.1 adapter → Sprint 14 with OCPI Foundation.
- Issue Engine → post-pilot per ADR 0006 (tag D).

---

## 13. Sprint 10 — Observability + Security/Tenancy

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> Sprint 10 absorbs gbtNotes Sprint S8 (Observability) + S9
> (Security, Tenant Isolation, Secrets). Production dashboards,
> structured logs, alert thresholds, and runbooks make a 4k-charger
> fleet operable by humans. Postgres RLS as defense-in-depth on
> per-tenant tables. AuditAction append-only enforcement at the DB
> layer. MFA mandatory on PlatformGrant. SMS provider for OTP
> (deferred from Sprint 8). UI Worker dead-code cleanup
> (Sprint 4.5 carry-forward).

**Goal.** A non-author operator can diagnose common failure modes
without reading source. Production incidents have named alerts and
runbooks. Tenant boundaries are tested, not assumed. Secret rotation
has a written procedure. Operator actions affecting chargers are
auditable. Multi-currency posture (EUR plans schema-allowed but not
created) confirmed pre-pilot.

**Entry.** Sprint 9 exit met (4k sim runs cleanly on staging).

**Exit.** All ~14 named failure modes from gbtNotes S8 have
runbooks. Production dashboards live in Cloudflare/Grafana with
alert thresholds wired. RLS policies cover the mixed-role tables
(sessions, users, memberships). MFA enforced for every PlatformGrant
holder. Pre-pilot security audit checklist signed.

**Milestones.** See [SPRINT_10_TASKS.md](../sprints/SPRINT_10_TASKS.md)
for detail; summary:

- **10.1** Production dashboards — charger counts, queue depths,
  ingest lag, DLQ count, command round-trip, DB write latency,
  R2 archive growth, partition health, public API rate (when
  Sprint 12+).
- **10.2** Structured logs with correlation IDs (OCPP identity / org /
  station / event / command / unique). Cloudflare Logpush
  destination configured.
- **10.3** Alert thresholds — queue age, DLQ non-empty, auth failure
  spike, charger drop, DB latency spike, storage growth above
  forecast, command timeout spike. Wired to operator's preferred
  channel (PagerDuty, email, Slack — TBD).
- **10.4** Runbooks for the 14 named scenarios from gbtNotes S8 in
  `/docs/runbooks/`. Includes the new pilot-relevant ones: charger
  cannot connect, vendor import mismatch, queue backlog, DLQ replay,
  Postgres slow, partition maintenance, R2 archive replay, gateway
  deploy rollback, API Worker deploy rollback.
- **10.5** Postgres RLS on per-tenant tables — sessions, users,
  memberships, sites, chargers, billing data. Application role
  drops in/out via session variable; RLS enforces orgId scope.
  Performance impact measured pre-flip.
- **10.6** AuditAction append-only DB enforcement — revoke
  UPDATE/DELETE on `audit.audit_actions` from the application
  Postgres role. Tenant admins see "who from Straumvakt accessed
  our data" via `audit.read`-gated query.
- **10.7** MFA mandatory for PlatformGrant holders. Passkey
  primary; TOTP fallback. Required at first login after this lands;
  no grandfathering.
- **10.8** SMS provider for OTP — final pick (Twilio /
  CF-friendly alternative). Replace Sprint 8 staging stub.
  Cost forecast at 4k driver-onboarding pace.
- **10.9** Tenant-isolation tests — per-tenant data, per-tenant
  R2 prefix isolation, per-tenant API key scope. Run the test
  suite as cross-tenant; expect 0 leaked rows.
- **10.10** Secret rotation procedures written — `OCPP_INGEST_SECRET`,
  `OCPP_CRED_KEK`, `AUTH_SECRET`, Neon connection string, R2 bucket
  credentials. Each has a documented rotation steps + rollback.
- **10.11** UI-Worker dead-code cleanup (Sprint 4.5 carry-forward) —
  delete `src/app/api/ocpp/events/`, `src/app/api/internal/ocpp-auth/`,
  `src/lib/ocpp/{event-envelope,projections,bootstrap,ingest-auth,
  internal-auth}.ts`, `src/lib/repositories/events.ts`. Drop the
  legacy `/api/ocpp/events` mount on apps/api.

**Risks.**
- **RLS performance.** Measure before enabling in hot paths. If RLS
  costs >5% on the dashboard query path, take a different
  enforcement layer (in-app `requirePermission` only).
- **MFA enrollment friction.** Operator + Straumvakt staff need to
  enrol passkeys before the flip. Plan a 1-week parallel period.
- **Secret rotation downtime.** Some rotations need a brief
  reconnection (Neon connection string). Schedule outside peak.
- **AuditAction enforcement is irreversible** at the Postgres role
  level. Test against scratch branch first.

**Out of scope.**
- Push API + webhook delivery → Sprint 12+ post-pilot.
- Multi-tenant white-label re-skin → Sprint 12+ post-pilot.
- OCPP 2.0.1 adapter → Sprint 14 with OCPI Foundation.

---

## 14. Sprint 11 — Production Cutover Readiness + Pilot Go-Live

> **Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md):**
> Sprint 11 absorbs gbtNotes Sprint S10. **Pilot opens here.**
> Pilot scope tightens from "20 chargers, demonstrable" (ADR 0006)
> to "first batch on scale-validated infrastructure." Production
> resources, migration dry-run, final 4k staging load test against
> production-like config, rollback paths, go/no-go checklist.
> First-batch ramp begins.

**Goal.** Production has matching resources and secrets. Rollback
is written and tested. Final 4k load test against prod-like config
passes. First batch of customer chargers (~50, scaled by who's
contracted) lands cleanly. Pilot retrospective captured at end of
the 30-day window.

**Entry.** Sprint 10 exit met (observability + RLS + MFA live;
runbooks complete).

**Exit.** Pilot site is live on Straumvakt. First-batch chargers
visible in operator console with live status. At least 50 real
sessions completed during the pilot window. Billing dashboard
reflects period activity. Retention + R2 archive have run cleanly
for ≥30 nights. Pilot retrospective + post-pilot plan written.

**Milestones.** See [SPRINT_11_TASKS.md](../sprints/SPRINT_11_TASKS.md)
for detail; summary:

- **11.1** Final domain layout — UI domain, API domain, OCPP
  gateway domain, future enterprise API domain.
- **11.2** Production Cloudflare resources — API Worker (`hlada-api`),
  gateway Worker (`straumvakt-ocpp`), DO namespace, inbound + outbound
  + export queues, DLQs, Hyperdrive prod binding.
- **11.3** Production DB resources — Neon prod plan (or Timescale
  prod service per ADR 0018), R2 prod bucket for raw archive, R2 prod
  bucket for export artifacts. Confirm plan sizing, write IOPS
  forecast at 4k, backup, PITR.
- **11.4** Production migration dry-run. Apply all
  `prisma/migrations/*` against a fresh prod-shape Neon branch,
  confirm clean apply, run integration smoke against it.
- **11.5** Final 4k-staging load test against production-like config.
  Catches any prod-only environmental issues (Hyperdrive
  configuration, R2 region pinning, secrets distribution).
- **11.6** Rollback paths. UI rollback to previous Pages deployment.
  API Worker rollback via wrangler-versioned deploy. Gateway rollback
  similarly. DB migration: forward-only, with documented hot-fix
  forward migration paths for each post-Sprint-4 migration.
- **11.7** Go/no-go checklist signed. Includes: backup restore drill
  passes; 4k load test passes; runbooks reviewed; secret rotations
  rehearsed; on-call rotation set; communication plan to pilot
  customer documented.
- **11.8** Pilot first-batch onboarding. ~50 chargers from
  contracted customer(s). Through Sprint 2's admin onboarding flow,
  not a special pilot wizard. RFID seeding via Sprint 5 invite flow
  + Sprint 8 driver signup.
- **11.9** Pilot operation. 30-day window. Operator runs the site
  from console. Retention + R2 archive + aggregate jobs run nightly.
  Billing dashboard reviewed weekly. **No money moves during pilot
  per ADR 0005 (tag E)** — invoice generation post-pilot.
- **11.10** Pilot retrospective. What went right, what broke, what
  the data says, what the operator says. Post-pilot plan listing the
  order in which deferred items (tags A–F + multi-tenant white-label
  + push API + Issue Engine + driver UX + payment provider + OCPI)
  ramp up.

**Risks.**
- **First-batch surprises.** First real customer chargers will surface
  edge cases the simulator missed. Allocate Sprint 11.5 (post-pilot
  hotfix) before any post-pilot scale work begins.
- **Production secret distribution.** Don't echo any secret to chat
  during cutover. Per Rule 2.
- **Atomic deploy ordering.** API Worker + gateway must redeploy in
  the order documented in Sprint 4.5's commit message. Sprint 11.2
  rehearses this.
- **Customer expectation management.** Pilot is operational, not
  commercial. No money moves; driver app deferred; explicit in the
  pilot kickoff letter.

**Out of scope (post-pilot).**
- Driver-facing UX (PWA, mobile app) → Sprint 12+ per ADR 0006 (tag B).
- Issue Engine → Sprint 12+ per ADR 0006 (tag D).
- Push API + webhook delivery → Sprint 12+.
- Payment provider integration + dunning → Sprint 12+ per ADR 0005
  (tag F).
- Multi-tenant white-label / second-tenant branding → Sprint 12+.
- Enterprise API + OpenAPI surface → Sprint 13+ (was gbtNotes S11).
- OCPI Foundation → Sprint 15+ (was Sprint 14 per ADR 0015, slipped
  by ADR 0017's cascade).

---

## 15. Open questions / missing decisions

These block or materially shape the sprint plan. Lock them as early as
possible; each has a suggested default if you need to move.

### Commercial / pilot

- **Pilot customer commitment.** Is the pilot site a confirmed
  workplace / MDU / hotel / fleet? Who is the Host? Who pays? *Default
  if unknown: pilot against your own test site for Sprints 0–9, commit
  a real pilot customer before Sprint 10.*
- **First charger hardware.** Zaptec, Easee, generic OCPP, or a mix?
  *Default: choose one native-OCPP path and one non-native path if
  available. Zaptec remains the first vendor enrichment path; Easee is
  the preferred API-control proof if a site is available; generic OCPP
  1.6J via the gateway remains the fallback. External CPMS/read-only
  import is acceptable for proving the operating layer when control is
  locked elsewhere.*
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
- **Customer feedback loop.** Pilot is admin-only per ADR 0006 — no
  driver-facing surface, so there are no pilot drivers to NPS-survey.
  *Default: structured weekly check-in with the pilot operator
  (single user, deep feedback) for 30 minutes; written retrospective
  doc co-authored at pilot end. Driver feedback loop returns when
  Driver Experience ships post-pilot (tag B).*
- **On-call / incident response.** Single dev = single point of failure.
  *Default: accept it through pilot. Document expected response time
  in SLA ("operator-hours" not "24/7"). Post-pilot plan covers second
  body.*

### Technical / unresolved

- **Auðkenni credentials.** Applied for? Test env accessible?
  *Default: now post-pilot per ADR 0006 (tag B). Auðkenni paperwork
  can wait for the post-pilot Driver Experience kick-off, but cost
  almost nothing to start now since the application takes weeks.
  Recommended: file paperwork in parallel with pilot anyway so the
  test env is live when Driver Experience starts.*
- **Hardware-level firmware management.** OCPP 1.6 supports it; do we
  exercise it? *Default: no firmware pushes through pilot. Vendor
  portals handle firmware on Zaptec/Easee. Revisit in Phase 4 with DC.*
- **OCPP 2.0.1 pilot hardware availability.** Do any pilot chargers
  support 2.0.1? *Default: no; Sprint 9 produces the adapter for future
  buyers, not pilot use.*
- **Employer reimbursement legal form.** Is reimbursement a salary
  benefit (taxable) or an expense reimbursement (not taxable) in
  Iceland? *Default: now post-pilot per ADR 0005 (tag E) — the
  reimbursement flow ships with real billing. Confirm with an
  Icelandic accountant before the post-pilot billing sprint.*

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
- **Terms of service + driver privacy policy.** Required before
  onboarding any real driver. **Now post-pilot per ADR 0006 (tag
  B)** since pilot has no driver-facing surface. Pilot still needs
  an operator-side ToS and a residency-posture statement (the
  pilot operator is the platform's first customer).

---

## 16. Risks and mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Scope creep into battery/solar / AI / smart charging | High | Adds 2–4 sprints | `/docs/adr/` for every scope change; this plan is read at every sprint kickoff |
| Auðkenni test environment delayed | Medium | Blocks post-pilot Driver Experience kick-off | Now post-pilot per ADR 0006 (tag B); file paperwork during pilot anyway since lead time is weeks |
| Invoice math bug reaches production | Low if Rule 5 honored | High (money + trust) | Dry-run in simulator; explicit sign-off when invoice generation lands post-pilot per ADR 0005 (tag E) |
| OCPI spec interpretation wrong at hub time | Medium | Rework of a sprint | Read Virta's and Hubject's interop docs carefully; keep schemas versioned |
| Cloudflare Workers edge runtime constraint bites late | Medium | Sprint delay | Validate each new library on Workers before committing to it; prefer stdlib + minimal deps |
| Single-dev burnout / velocity collapse | Medium | Timeline slip | Honest capacity planning; skip a sprint rather than ship half-done; the plan is commitments to *order*, not dates |
| Pilot customer changes scope late | Medium | Sprint 10 blowup | Lock pilot requirements by end of Sprint 5 latest |
| DO hibernation semantics surprise | Low | Charger disconnect issues | Sprint 1 tests reconnection explicitly |
| Event log grows faster than expected | Medium | Cost / query pain | Retention-class column from Sprint 0; nightly aggregation + age-out land in Sprint 4 (ADR 0006) before pilot scale matters |
| Zaptec API shape changes during Sprint 2 | Low | Wizard rework | Pin the Zaptec OpenAPI version in the repo; vendor-credential layer isolates the surface — wizard can be re-pointed to a snapshot if needed |
| Payment provider integration longer than expected | Medium | Post-pilot delay | Provider decision now post-pilot per ADR 0005 (tag F); start onboarding paperwork during pilot wind-down |

---

## 17. Working conventions

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

## 18. What's explicitly NOT in this plan

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

## 19. Next step

Read this plan. Mark up anything that's wrong. Lock the §14 open
questions one at a time. Then start Sprint 0.

If you need to revise the plan: revise the plan. But don't silently
drift.
