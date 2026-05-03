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
| 3 | OCPI Foundation (CPO-only) | CPO surface exists; eMSP deferred (A) | OCPI 2.2.1 **CPO** endpoints respond correctly to contract tests; external property/site shadow records work; basic RFID authorize. *eMSP endpoints + token push deferred per ADR 0005.* |
| 4 | **Data Storage Lifecycle** *(NEW per ADR 0006)* | Charge-log retention machinery enforces V3 §8 classes | Nightly aggregation of `raw_protocol` → `aggregate`. `raw_protocol` ageing-out at 30–90 days. Financial + operational events kept hot indefinitely. Cold-archive scaffolding for `issue_history`. First concrete implementation of V3 §8 retention classes; Sprint 4 exit verified by retention-class job logs and synthetic age-out test. |
| 5 | Commercial Model | The money math works (ISK only) | Tariff engine resolves contracts + driver-contracts + accumulators, evaluates compute_rule DSL, emits `billing_lines` per cost center for ~18 synthetic scenarios in **ISK** (including the four worked scenarios from [ADR 0008](../adr/0008-cost-center-splitting.md)). Every factor allocates fully or session-stop fails. *Multi-currency (EUR) deferred per ADR 0005 (C).* |
| 6 | Billing **Dashboard** | Billing data is reviewable, split by cost center | Billing dashboard shows per-cost-center, per-driver, per-Host accumulating amounts in ISK both ex-VAT and inc-VAT, rolled up by period, read-only. Cost-center beneficiary surfaced (e.g. "Krónan owes 300 ISK to N1 for hardware rental this period") — display only, no inter-org settlement. *Invoice generation, transactions, statements, employer reimbursement, PDF invoices deferred per ADR 0005 (E). Inter-org settlement deferred per ADR 0005 (F).* The Issue Engine that previously sat in this sprint slot moved entirely to post-pilot per ADR 0006 (D). |
| 7 | Push API + Observability | External systems can consume; we can see inside | Push API delivers canonical events to test subscribers with retries; OTel traces end to end |
| 8 | Hardening | Pilot-grade reliability | Restore drill clean; OCPP gateway load test documented. *Payment provider, dunning, EU residency verification ceremony deferred per ADR 0005 (F). EU runtime posture (CF Data Localization, Neon EU) stays in place.* |
| 9 | Multi-Tenant + White-Label | Platform is a platform | Second org onboards cleanly via the admin flows from Sprint 2 (re-skinned for branding); RLS audit; scoped API keys. *OCPP 2.0.1 adapter deferred per ADR 0005 (A).* |
| 10 | Pilot Go-Live (admin-only) | Demonstrable platform, admin-functionality only | Pilot site live; real charger sessions visible through native OCPP, OEM API/control, external CPMS overlay, or read-only import path; admin runs the site via operator console; billing dashboard reviewable; charge-log retention verified for 30+ days; backup restore drill completed; retrospective captured. *No money movement during pilot. No driver onboarding during pilot.* |

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

## 8. Sprint 5 — Invite Flow + Driver Self-Registration (ADR 0014 build order)

> **Scope shift recorded in [ADR 0016](../adr/0016-sprint-5-scope-call-invite-over-tariff.md):**
> Sprint 4's permissions infrastructure needs real multi-user sessions
> to be load-bearing. Sprint 5 lands those — agent invite flow, driver
> self-registration, impersonation. The previous occupant of this
> slot — **Commercial Model (ISK only for pilot)** — slips to
> **Sprint 6**. Subsequent sprints cascade by one slot; **Pilot
> Go-Live moves from Sprint 10 to Sprint 11.** ADR 0016 documents the
> reasoning (Sprint 4's runway needs landing on; tariff engine slips
> cleanly as a pure-function deliverable; multi-user shakedown wants
> as many sprints as possible before pilot).

**Goal.** Customer admins can invite their team. Drivers can sign up
for the mobile app. Straumvakt staff can impersonate for support.
`requirePermission` flips from bootstrap god-mode to real per-user
checks, and the ~30 sub-resource routes from Sprint 4.4 get inline
`assertPermission` retrofits.

**Entry.** Sprint 4 closure list checked (every milestone shipped;
retro committed; ADR 0016 authored).

**Exit.** All eight milestones in
[docs/sprints/SPRINT_05_TASKS.md](../sprints/SPRINT_05_TASKS.md) green.
Specifically:
1. Bootstrap admin has a real User row; SessionPayload carries userId.
2. UserCredential is polymorphic (`password | magic_link | otp` for
   pilot; passkey / oauth_* / api_key defer).
3. Agent invite flow works end-to-end on staging.
4. Driver self-registration flow works end-to-end on staging.
5. Sub-resource route retrofits complete.
6. Impersonation flow logs actor + acting_as for every privileged
   write during the impersonating session.
7. Sprint 4.5 production-cutover dead code deleted.

**Milestones.** See [SPRINT_05_TASKS.md](../sprints/SPRINT_05_TASKS.md)
for detail; summary:

- **5.1** Bootstrap admin → real User row + SessionPayload.userId.
- **5.2** UserCredential polymorphic schema (Rule 4 — additive).
- **5.3** Agent invite flow — admin side (POST invitations).
- **5.4** Agent invite flow — recipient side (accept-invite landing).
- **5.5** Driver self-registration flow (signup + OTP verify).
- **5.6** Sub-resource route `assertPermission` retrofits (~30 routes).
- **5.7** Impersonation flow with audit logging.
- **5.8** Production cutover follow-up cleanup (delete UI-Worker dead code).

**Risks.**
- **5.1 spike must land before 5.6.** Real userIds are the
  prerequisite for `assertPermission` to actually check membership.
- **5.2 schema migration is non-additive in spirit** — existing
  `UserCredential.passwordHash` rows reshuffle into typed
  `kind='password'` rows. Run against scratch Neon branch first;
  verify row counts before/after.
- **Token security in 5.3 / 5.4.** Bearer tokens treated like
  passwords: hashed before storage, constant-time compare. Sprint 9
  will harden further (rotation, revocation hooks).
- **OTP delivery channel for 5.5.** Cloudflare-friendly SMS provider
  (Twilio? something else). Plan a fallback for staging.
- **Impersonation audit drift in 5.7.** Every privileged write under
  impersonation must log both `actor_user_id` (the support agent)
  and `acting_as_user_id` (the impersonated user). Drift = security
  incident.

**Out of scope (Sprint 6+).**
- Commercial Model (tariff engine, CustomerPlan, ChargerServicePlan) → **Sprint 6**.
- Billing Dashboard → Sprint 7 (slipped from previous Sprint 6).
- Data Storage Lifecycle → Sprint 7 (slipped from previous Sprint 6).
- OAuth credentials (`oauth_google`, `oauth_microsoft`) → Sprint 9.
- Passkey credentials → Sprint 9.
- API-key credentials (service principals) → Sprint 11.
- MFA enforcement on PlatformGrant → Sprint 9.
- Postgres RLS → Sprint 9.

**Milestones.**

- **5.1** `CustomerPlan` schema in full richness: products
  (setup/subscription/RFID/usage credit), tariffs (ToU + per-connector +
  per-speed), displays with locales, country/currency variants, balance
  type, category, termination behavior.
  - *Exit:* Create a plan via `/v1/customer-plans`, attach products and
    tariffs, retrieve it; all fields round-trip.

- **5.2** `ChargerServicePlan` schema. Revenue share rule, electricity
  reimbursement rule, maintenance responsibility, platform fee model,
  default tariff, term.
  - *Exit:* Create a service plan for the pilot Host; attach chargers;
    verify that cost calculation uses the Host-defined default tariff
    when no user plan overrides.

- **5.3** Tariff engine. Pure function: given a session + applicable
  tariff chain, produce cost breakdown (energy cost, time cost,
  overtime penalty, total, taxes). No side effects; fully
  unit-testable.
  - *Exit:* Ten synthetic session scenarios produce expected cost
    breakdowns matching hand-computed results.

- **5.4** Plan selection logic. Given a user + site + charger, pick
  the applicable `CustomerPlan` by priority (user override > site >
  Host default > org default).
  - *Exit:* Priority tests pass for four combinations.

- **5.5** Locale + currency posture for pilot — **ISK only**.
  Icelandic + English display variants ship; the schema's `currency`
  column accepts EUR but no EUR plans are created during pilot.
  **Multi-currency (EUR variants, per-locale rendering) deferred per
  ADR 0005 (tag C).**
  - *Exit:* A plan renders correctly in `is-IS` and `en-GB` locales
    with the ISK variant.

**Risks.** This is where silent bugs are most expensive. Follow
Rule 5 from CLAUDE.md strictly — any change to billing math requires
explicit approval of the change summary before coding.

---

## 9. Sprint 6 — Billing Dashboard (read-only for pilot)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md) tag E
> + [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md) tag D):**
> Sprint 6 ships a **read-only billing dashboard** — the operator can
> see what *would* be invoiced, but no money moves and no driver-facing
> surface exists during pilot. **Real invoice generation, billing
> transactions as ledger entries, statements, employer reimbursement
> workflow, and PDF invoices are deferred to post-pilot** (tag E).
> **Driver-side billing views ship together with the rest of the
> Driver Experience post-pilot** (tag B). Schema for all of these
> already exists (Sprint 0); turning them on post-pilot is additive.

**Goal.** Billing data is reviewable in the operator console.
Per-driver / per-Host accumulating amounts roll up by period. No
invoice generation, no payment processing, no PDFs, no driver-facing
"My charges" page during pilot — those land post-pilot.

**Entry.** Sprint 5 exit met.

**Exit.** Operator console "Billing" page renders, for each
driver / Host, the sum of session-derived charges in the current
period and prior periods. Numbers match what the tariff engine
(Sprint 5) computes for each session.

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

- **6.3** ~~Billing dashboard — driver view~~ — **deferred per
  ADR 0006 (tag B).** Ships with the rest of the Driver Experience
  post-pilot. Pilot drivers exist as inert records only; no PWA, no
  "My charges" page.

- **6.4** ~~Invoice generation, billing transactions, statements,
  employer reimbursement, PDF invoices~~ — **deferred per ADR 0005
  (tag E).** Post-pilot work, on top of the schema and the dashboard
  data already in place.

**Risks.** Rule 5 still applies — the dashboard renders billing
numbers. If the rendered total differs from what the tariff engine
computed, the operator loses trust before pilot exits. Validate
against tariff-engine output in unit tests, not just visual review.

---

## 10. Sprint 7 — Push API + Observability

> **Pilot scope:** Push API + OTel are in pilot. Issue-related event
> types (`issue.opened`, `issue.resolved`) and issue-count dashboard
> tiles defer with the rest of the Issue Engine per
> [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md) (tag D).
> Driver-initiated event types defer with the Driver Experience
> (tag B). The push-API and observability *plumbing* ships, the
> issue-and-driver *vocabulary* fills in post-pilot.

**Goal.** External systems can subscribe to platform events; internal
teams (i.e., the operator) can see what's happening inside the platform.

**Entry.** Sprint 6 exit met.

**Exit.** Push API delivers canonical events to subscribers with
durable retry. OpenTelemetry traces every request across both workers.
A per-tenant dashboard shows uptime and session success rate.
Issue-engine and driver-engagement metrics on the dashboard ship
post-pilot when those engines exist.

**Milestones.**

- **7.1** Push API subscriber registry. `webhooks.subscriptions` per
  tenant with scopes (which events), endpoint URL, signing secret,
  status.
  - *Exit:* Operator can register a subscriber via console; event types
    listed; test-send works.

- **7.2** Canonical event vocabulary emitted (pilot subset):
  `transaction.started`, `transaction.updated`, `transaction.stopped`,
  `charger.added`, `connector.status_updated`,
  `card.authorize_request`. Schemas documented.
  *(`transaction.billed` ships when invoice generation does — tag E.
  `issue.opened` / `issue.resolved` ship with the Issue Engine post-pilot
  — tag D.)*
  - *Exit:* Each in-scope event type emitted by the platform is
    documented and validated against its schema at emission.

- **7.3** Durable retry with exponential backoff. Dead-letter queue for
  subscribers that have failed >N times. Subscriber health score.
  - *Exit:* A misbehaving test subscriber eventually lands in DLQ; a
    recovering subscriber resumes.

- **7.4** OpenTelemetry across both workers. Traces propagate across
  the signed webhook boundary via `traceparent` headers. Correlation ID
  from the OCPP message flows all the way to the billing-dashboard row.
  - *Exit:* Given an OCPP message ID, the trace viewer shows the
    full path: WebSocket → DO → webhook → event log → projection →
    API response.

- **7.5** Per-tenant dashboard in the operator console. Uptime,
  session success rate, charge-log retention job status. Reads from
  aggregates (Sprint 4), not raw event log. Issue-related and MRR
  tiles ship post-pilot.
  - *Exit:* Dashboard renders for the pilot tenant with live data.

**Risks.** OTel on Cloudflare Workers requires specific libraries;
verify early that the chosen path works. Dashboard queries can become
expensive — use aggregate tables, not raw events.

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
> Multi-tenant onboarding, per-Host branding, RLS, and scoped API
> keys ship for pilot. **OCPP 2.0.1 adapter is deferred to post-pilot**
> (groups under tag A, Roaming, since 2.0.1 unlocks 2.0.1-only roaming
> partners). Pilot stays on OCPP 1.6J. The Sprint 2 admin onboarding
> shell is the same shell this sprint re-skins for second-tenant
> branding — no rebuild per [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md).

**Goal.** Prove the platform is a platform, not a single-customer
app. Second org onboards cleanly via the Sprint 2 admin flows;
branding scopes work; multi-tenant isolation is enforceable.

**Entry.** Sprint 8 exit met.

**Exit.** A second (staged) org onboards end to end through the
Sprint 2 admin flows. Per-Host branding applies to operator-facing
surfaces (driver-facing surfaces ship post-pilot per ADR 0006 tag B).
API keys + scopes work for partner integrations.

**Milestones.**

- **9.1** Second-tenant onboarding via the Sprint 2 admin flows.
  Re-run the Sprint 2 admin sequence (Org → Host → Property → Site
  → Installation → Circuit → Charger → OCPPIdentity → Connector +
  members) for a fresh tenant; attach a CustomerPlan + a
  ChargerServicePlan. No new wizard — this milestone validates that
  the Sprint 2 flows work for a second tenant cleanly.
  - *Exit:* Fresh tenant onboarded in <30 min using only the
    Sprint 2 admin pages; no schema or code changes required.

- **9.2** Per-Host branding. Logo, colors, sender email domain.
  Stored in `hosts.branding` JSONB. Applied to operator console
  chrome (sidebar / topbar) for the operator's tenant; reserved for
  the post-pilot driver PWA.
  - *Exit:* Operator from Host A sees Host A's brand in console;
    operator from Host B sees Host B's brand. Driver-PWA branding
    deferred with the rest of the Driver Experience.

- **9.3** Postgres Row-Level Security where it makes sense. Turn on
  for the most mixed-role tables (sessions, users in operator
  console queries; the issues table is post-pilot but RLS policy
  scaffolding ships now since the table exists).
  - *Exit:* RLS policies audited; an operator from org A cannot see
    org B's sessions even with a raw query.

- **9.4** API key + scopes subsystem. Per-tenant API keys with
  scopes (`sessions.read`, `chargers.write`, etc.), rotation, audit
  log of uses.
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

## 13. Sprint 10 — Pilot Go-Live (admin-only, demonstrable)

> **Pilot scope (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md)
> + [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md)):**
> The pilot is an **admin-functionality demonstrable platform**, not
> a commercial release. Real chargers, real session activity, real
> charge-log retention — but **no driver-facing surface, no money
> movement, no Issue Engine** during the pilot window. Drivers exist
> as inert admin-created records linked to RFID idTags only.
> Commercial readiness and driver experience live in the post-pilot
> backlog (tags A–F).

**Goal.** Real charger activity visible and operable in Straumvakt,
whether the control path is native OCPP 1.6J, OEM API/webhook,
external CPMS overlay, or read-only import. RFID idTags or imported
driver/session references resolve to admin-created driver records when
available. Operator runs the site from the console. Billing dashboard
shows what *would* be invoiced. Charge-log
retention machinery has run cleanly for ≥30 days. Pilot retrospective
captured.

**Entry.** Sprint 9 exit met.

**Exit.** Pilot site is live on Straumvakt. Real charger sessions
complete end-to-end. Billing dashboard reflects the period's
activity. Charge-log retention has fired ≥30 nights cleanly. Backup
restore drill executed at least once. Pilot retrospective written
and post-pilot plan outlined.

**Milestones.**

- **10.1** Real chargers onboarded. Whichever hardware/control path the
  pilot uses (Zaptec API/webhook/OCPP, Easee API control, generic OCPP
  1.6J via the gateway, or external CPMS overlay) — provisioned,
  connected/importing, status showing healthy.
  - *Exit:* Pilot chargers visible in operator console with live
    `Available` status; Zaptec-managed chargers show their pulled
    `vendor_circuit_ref` and `vendor_installation_ref`.

- **10.2** Pilot driver records (admin-created, inert). The admin
  creates pilot driver rows in `identity.users` + `tenancy.memberships`
  with `role=driver`; assigns RFID cards; links to a Host. **No
  driver signup, no driver login, no driver PWA, no email invites
  during pilot per ADR 0006 (tag B).** Drivers exist so OCPP idTag
  lookups resolve to a person.
  - *Exit:* Pilot driver records exist; each has ≥1 RFID card row
    that maps to an OCPP idTag the chargers will present.

- **10.3** Pilot session lifecycle. Native OCPP path: RFID idTag
  presented at a pilot charger triggers `Authorize` →
  `StartTransaction` → meter values → `StopTransaction`. OEM/API or
  overlay path: vendor/external system emits or exposes equivalent
  session start, meter/energy, and stop records that normalize into
  the same operator session view. **No driver-facing history surface
  during pilot per ADR 0006 (tag B).**
  - *Exit:* At least 10 real sessions completed during pilot window
    with no operator intervention.

- **10.4** Billing dashboard reviewed against pilot activity.
  Per-driver and per-Host accumulated amounts (ISK) match what the
  tariff engine computed for each session. Operator reviews the
  dashboard at least weekly during pilot.
  - *Exit:* Dashboard totals reconcile to tariff-engine output for
    every pilot session. **No invoices issued during pilot per ADR
    0005 (tag E)** — operator-side manual invoicing is post-pilot,
    not a Straumvakt pilot deliverable.

- **10.5** Charge-log retention verified for ≥30 nights. Sprint 4's
  aggregator runs nightly across the pilot window; `raw_protocol`
  rows past TTL purge correctly; financial / operational rows
  preserved.
  - *Exit:* Retention-job log shows ≥30 successful runs; spot-check
    confirms TTL behaviour on real pilot rows.

- **10.6** Runbooks finalized. Incident response, backup restore,
  OCPP reconnect troubleshooting, retention-job monitoring, common
  operator tasks. Living doc in `/docs/runbooks/`.
  - *Exit:* Runbook index exists; each top-5 scenario documented.

- **10.7** Pilot retrospective. What went right, what broke, what
  the data says, what the operator says. Post-pilot plan drafted,
  listing the order in which tags A–F (per ADR 0005 + 0006) are
  picked up. **Driver Experience (tag B) and Issue Engine (tag D)
  are explicitly named in the post-pilot kick-off** since both were
  removed from pilot scope late in planning.
  - *Exit:* Retrospective doc written; post-pilot plan outlined
    (typically tag F first to unlock money movement, B + D shortly
    after to put drivers and ops in front of real users).

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

## 15. Risks and mitigations

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
