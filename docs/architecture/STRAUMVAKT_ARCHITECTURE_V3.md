# Straumvakt — Architecture V3

> **LEGACY — superseded as active canon by /FOCUS.md (2026-08-07). Kept as historical reference; nothing here is being worked from.**

> Canonical architecture. Supersedes V2. Read alongside
> `straumvakt_architecture_v3.svg` for the visual map.
>
> V3 absorbs three rounds of input: the architecture brief (Apr 2026), the
> Driivz API reference (~220 endpoints, 386 schemas), the market scan
> (Ampcontrol, Monta, Virta, Ampeco, Driivz), and the constraints locked
> by the operator — chargers + meters + connectivity as Day-1 site assets,
> OCPI as a foundation module, Charger Host as a first-class tier, AI
> deferred to Phase 3+.

---

## 1. Design thesis

A structurally lighter charging operating platform whose moat is the
quality of its event log, the cleanness of its commercial model, and the
ability to operate above whichever control plane the customer already
uses — native OCPP, OEM API, external CPMS, hybrid, or read-only
imports. Ship the platform, not the slides.

## 2. Principles (firm)

Ten commitments, each one non-negotiable without a decision log entry.

1. **Foundations before floors.** The concrete has to dry.
2. **Event log is the source of truth.** Tiered retention; never
   destructive aggregation without preserving source.
3. **Tenancy in the schema from row one.** Every operational row carries
   `org_id` (or equivalent tenant key) and every query is scoped.
4. **Control planes behind adapters.** OCPP, OEM APIs, webhooks,
   external CPMS imports, and read-only feeds emit canonical domain
   events; the rest of the platform never depends on protocol
   vocabulary.
5. **Capability ≠ entitlement.** What an asset *can* do is independent of
   what a tenant is *permitted* to do.
6. **No split-brain control.** One primary owner per control domain per
   asset. Routing policy is data, not code.
7. **OCPI as foundation.** Dual-role (CPO + eMSP) from day one. External
   Property/Site shadow records from day one.
8. **Postgres until proven otherwise.** One durable store. Scale through
   schema discipline, not new stores.
9. **Fair-use, not surprise billing.** Soft limits with review triggers;
   meter everything, invoice only what's declared.
10. **EU residency is verified, not assumed.** Cloudflare Data
    Localization, Durable Object `locationHint`, Neon EU region —
    checked quarterly.

> **ADR 0011 amendment (2026-04-26).** Native OCPP is one supported
> control plane, not the architecture's center. Physical charging
> assets, sessions, billing, issues, and intelligence must work when
> Straumvakt controls the charger through OCPP, controls it through an
> OEM API, receives webhook authorization callbacks, overlays an
> external CPMS, or only imports read-only history.

## 3. What changed from V2

V2 stands as the architectural backbone. V3 commits the following
overrides and additions:

| Area | V2 | V3 |
|---|---|---|
| Business hierarchy | 3-tier: Org → Site → Asset | **4-tier: Org → Charger Host → Property → Site → Asset** |
| Contract model | Single `CustomerPlan` blob | **Two first-class contracts**: `CustomerPlan` (driver↔SP) + `ChargerServicePlan` (Host↔SP) |
| Asset model | `Charger → OCPPIdentity → Connector` | **Protocol-neutral physical asset model** per [ADR 0011](../adr/0011-control-plane-optionality.md): current schema still has `SiteAsset -> Charger -> OCPPIdentity -> Connector`, but the decided target is physical charging equipment first, with optional OCPP / OEM API / external CPMS control attachments. |
| Hardware catalog | None (free-text `vendor` / `model`) | **`hardware` schema** with global Vendor + Model registry; Model profile is the technical template for a charger |
| Installation layer | None | **`properties.installations`** — optional grouping between Site and charger SiteAsset, holds installation-scope vendor credentials (Zaptec/Easee pattern) |
| Credential placement | Implied on adapter | **Data-driven by `Model.credential_scope`** — `installation` (AC vendor-managed) vs. `identity` (DC) vs. `none` (OCPP-only) |
| OCPI | Phase 5 scaffold | **Phase 1 foundation module**, dual-role, external shadow records from day one |
| Push API | Implied | **First-class subsystem** with fixed event vocabulary and subscriber registry |
| Plan richness | Thin tariff | **Driivz-style** plans with products, displays, locales, country/currency variants, balance types, categories, termination behavior |
| AI/ML | Phase 3+ with scaffolding | Phase 3+, **no scaffolding Day 1** — event log written to be ML-ready but no feature store committed |
| DC enrichment | Phase 4 | Unchanged; first vendor (Kempower or Tritium) decided when first DC site enters scope |

V1 (Node-on-Hetzner) remains rejected. V2 (Cloudflare Workers + Durable
Objects + OpenNext + Neon) is the runtime.

## 4. The asset hierarchy

> **Rev 4 amendment (2026-04-26).** ChargerHost dropped per
> [ADR 0009](../adr/0009-drop-charger-host-tier.md). Property attaches
> directly to Org. The HostType classifier moved to `Site.site_type`.
> Org is now a **multi-role entity** per
> [ADR 0010](../adr/0010-organization-profile-enrichment.md) — the
> same row holds operator / asset_owner / payer / retailer / DSO etc.
> via the `roles[]` enum array.
>
> **Control-plane optionality amendment (2026-04-26,
> [ADR 0011](../adr/0011-control-plane-optionality.md)).** The current
> schema still names `OCPPIdentity -> Connector`, but that is not the
> conceptual root. OCPPIdentity is a protocol endpoint. The target
> physical model is `ChargingStation -> EVSE -> Connector`, with
> optional `OcppIdentity`, vendor API references, external CPMS
> references, routing policy, and capability profile attached.

```
Org (multi-role: csms_provider / operator / asset_owner / payer / retailer / dso / tso / ...)
 └─ Property (physical building or parcel)
     └─ Site (sublocation, with site_type: workplace/MDU/hotel/fleet/retail/standard)
         ├─ [optional] Installation (vendor-managed grouping, AC)
         │   ├─ [optional] Circuit (breaker-bound charger group)
         │   │   └─ SiteAsset (polymorphic: charger / meter / modem / controller)
        │   │       └─ [when Charger] ChargingStation/EVSE/Connector (target)
        │   │           └─ optional control: OCPPIdentity / OEM API / External CPMS
         │   └─ SiteAsset (no circuit — circuit is optional)
        │       └─ [when Charger] physical connector(s) + optional control refs
         └─ SiteAsset (no installation — OCPP-only or DC)
            └─ [when Charger] physical connector(s) + optional control refs
```

**Org** = a legal entity on Straumvakt — kennitala-keyed, multi-role.
The same row may carry roles `[operator, asset_owner, payer]` (a
typical CPO tenant), `[retailer]` (a pure söluaðili referenced by
REPF tariff_definitions), `[dso]` (a distribution system operator
referenced by DSOF tariff_definitions), `[csms_provider]` (Straumvakt
itself), `[service_contractor]` (a maintenance partner — post-pilot
Issue Engine routes work orders here), or any combination. See
[ADR 0010](../adr/0010-organization-profile-enrichment.md) for the
21-value `OrganizationRole` enum.
**Property** = a physical building or site address.
**Site** = a sublocation within a property (each floor of a car park;
each depot bay).
**Installation** (optional) = a vendor-managed grouping of chargers at
a site. Holds a single credential set (OAuth token, basic auth, etc.)
that covers every charger in the group. Used for AC vendor-managed
hardware (Zaptec Pro, Easee One) where the vendor portal itself models
installations. Not used for OCPP-only chargers or for DC hardware.
**Circuit** (optional, per [ADR 0007](../adr/0007-circuit-asset-tier-back.md))
= a breaker-bound grouping of chargers that share an ampere ceiling.
Used when an operator needs to answer "what's on the same breaker?"
or when a vendor portal exposes circuit data (Zaptec Pro circuits).
Optional in two ways: a Site without explicit circuit modeling
doesn't need one, and a Circuit can belong directly to a Site
without an Installation. Future load-balancing intelligence is
per-circuit math by definition.
**SiteAsset** = anything physical at a site that the platform manages.
On Day 1 the kinds are: `charger`, `meter`, `modem`, `controller`
(Shelly-class onsite monitoring/switching). Battery and solar are
deliberately absent from V3 but the polymorphic shape admits them
later.
**ChargingStation / EVSE / Connector** = the target physical model for
charging equipment. The current Prisma schema has not yet been reshaped
to these names, but new design work should treat physical connector
identity as independent of OCPP control.
**OCPPIdentity** = an optional OCPP control endpoint. It exists only
when Straumvakt or an attached integration needs an OCPP identity. It
is not the charger itself.
**VendorAssetRef / ExternalCpmsRef** = optional references that map a
physical charger/EVSE/connector to an OEM API or external CPMS.
**Connector** = the socket an EV plugs into. A connector may be
controlled by Straumvakt OCPP, an OEM API, an external CPMS, or not
controlled by Straumvakt at all.

Sitting alongside this hierarchy is the **Hardware Catalog**
(`hardware` schema) — a platform-level registry of supported vendors
and models. A `SiteAsset` (charger, meter, modem, controller) links to
a `HardwareModel`; the model's profile is the template for the
asset's technical fields. See §10.

## 5. Integration: control-plane tracks

Every integration with the outside world is a control-plane or data
plane track. All tracks emit canonical events into the same event log.
Downstream modules consume Straumvakt events, not protocol vocabulary.

**OCPP Track.** WebSocket connections from chargers into the OCPP
Gateway Worker, routed to Durable Objects per `OCPPIdentity`. Messages
are validated (Zod), translated to domain events, persisted, projected.
The translator is the only place OCPP vocabulary lives. Versions: 1.6J
Day 1, 2.0.1 in Phase 3, 2.1 when buyers ask. Supports an outbox for
reliable outbound commands.

**Vendor Adapter Track.** HTTP integrations with vendor backends
(Zaptec, Easee for AC portal-managed; Kempower, Tritium for DC
enrichment later). Each adapter is a self-contained module with
client, schemas, capabilities, dispatch, health. Vendor onboarding is a
first-class flow — enter portal credentials, discover assets, set
routing. Contract tests run nightly against vendor schemas.

**External CPMS Overlay Track.** Existing CPMS/OCPP provider remains
the control plane. Straumvakt imports assets, status, sessions, CDRs,
and faults through APIs, exports, webhooks, or scheduled files. The
operator still gets Straumvakt billing, issue tracking, reporting,
cost allocation, and intelligence. No Straumvakt-owned OCPP identity is
required for this mode.

**Read-Only Intelligence Track.** The external system owns both
control and operational execution. Straumvakt receives enough history
and telemetry to provide reporting, allocation, anomaly/issue
intelligence, audit, and management dashboards.

> **Vendor API references live in the app.** The cloud-API surface and
> OCPP integration notes for each supported vendor are in-app
> reference pages — see [README §"Vendor APIs"](./README.md#vendor-apis-in-app-live).
> Today: [`/reference/zaptec-api`](../../src/app/(app)/reference/zaptec-api/page.tsx)
> (live OpenAPI table + Zaptec constants + OCPP 1.6J notes) and
> [`/reference/easee-api`](../../src/app/(app)/reference/easee-api/page.tsx)
> (curated reference until the Easee adapter ships). Real Zaptec
> traffic is observable today via
> [`/technical-read`](../../src/app/(app)/technical-read/page.tsx).

*Where credentials attach* is declared by `HardwareModel.credential_scope`
on the catalog row, so onboarding flows are data-driven rather than
hardcoded per vendor:

- **`installation`** — AC vendor-managed (Zaptec Pro, Easee One). One
  credential set per `properties.installations` row covers every
  charger below it. Onboarding: create Installation → enter portal
  user/password → adapter exchanges for OAuth token → discovery
  populates chargers → routing set to vendor as primary. Easee-style
  API control may support authorize/start/stop directly; Zaptec-style
  integrations may combine API enrichment, webhook auth, OCPP, or
  imported history depending on installation capability.
- **`identity`** — DC vendor-managed (Kempower, Tritium, ABB). One
  credential set per `ocpp.ocpp_identities` row. Onboarding: add OCPP
  identity → enter vendor user/password → adapter validates. The
  vendor backend is primary; OCPP is added as a third-party URL.
- **`none`** — Generic OCPP charger with no vendor API. No
  credentials; OCPP is the only channel.

**Control routing is data.** For each action (`authorize`, `start`,
`stop`, `unlock`, `reset`, `read_status`, `read_configuration`,
`import_session`, `import_cdr`), routing resolves against capability
and policy. Lack of a control capability does not block read-only
operations, billing allocation, issue tracking, or reporting.

**OCPI Roaming Track.** Dual-role — we act as CPO (publishing our
chargers, sessions, CDRs, tariffs to roaming partners) and as eMSP
(letting our drivers charge at partner CPO chargers). Hub connectors
(Hubject, Gireve) plus direct peer support. Token translator maps RFID
UID ↔ OCPI token ↔ user. External Property/Site shadow records hold
partner locations without polluting the operational model.

All three tracks emit domain events into the same event log. Downstream
modules — Issue Engine, billing, analytics, operations — cannot tell
which track produced a given event.

## 6. Commercial model — two contracts (legacy) + cost-center splitting (rev 3)

> **Rev 3 amendment (2026-04-26, [ADR 0008](../adr/0008-cost-center-splitting.md)).**
> The original two-contract model below remains in the schema (`billing.customer_plans`
> + `hosts.charger_service_plans` from Sprint 0) but is **not** the
> operational layer for pilot session-stop resolution. The rev-3
> operational layer is:
>
> - **`billing.cost_factors`** — runtime catalog of factor codes
>   (DSOF, REPF, USRF, USRF_PREM, XTRRF, SPVIVF, CHRGRF, WRKPF in
>   pilot; extensible by Straumvakt platform admins).
> - **`billing.tariff_definitions`** — rates per Org per factor, anchored
>   on the entity that holds the contract (DSO contract on Site, retailer
>   contract on Installation, rental contract on Charger, workplace fee
>   on DriverContract).
> - **`billing.contracts`** — per-tier inherited contracts
>   (Org / Host / Property / Site / Installation / Charger), with
>   `parent_contract_id` chains.
> - **`billing.contract_factor_assignments`** — which cost center pays
>   each factor's allocation (with `priority` for stacked rules).
> - **`billing.driver_contracts`** — per-user overrides
>   (workplace / family-group / self), with optional WRKPF tariff
>   emission.
> - **`billing.contract_period_accumulators`** — calendar-month state
>   for kWh-cap allocation rules.
> - **`billing.cost_centers`** — payers (`payer_org_id` /
>   `payer_user_id`) + beneficiaries (`beneficiary_org_id` for
>   inter-org transfers; settlement is post-pilot tag F).
> - **`billing.billing_lines`** — resolver output; every factor
>   reaches a cost center or session-stop fails.
>
> See [`cost_center_splitting_model.svg`](./cost_center_splitting_model.svg)
> for the visual model and four worked scenarios. The legacy
> CustomerPlan / ChargerServicePlan tables stay for now (no drop) —
> they may be repurposed for post-pilot real-billing work
> (ADR 0005 tag E) but are unused during pilot.
>
> **Three concepts the rev-3 model makes distinct on every charger:**
> *Owner* (`assets.chargers.owner_org_id` — who physically owns the
> hardware; gets paid CHRGRF; Issue Engine routes service tickets
> here), *Operator* (`assets.chargers.org_id` — runs sessions, the
> SaaS tenant on Straumvakt), *Payer* (resolved at session-stop via
> contract chain → `cost_centers.payer_org_id` / `payer_user_id`).
> Pilot examples — Krónan absorbs everything at workplace sites; N1
> splits public sites driver-pays-DSOF / N1-absorbs-rest; rented
> chargers route CHRGRF to whichever cost center the workplace
> driver-contract designates.

### 6.1 Legacy commercial template (Sprint 0 schema; not operational in pilot)

**CustomerPlan** (driver ↔ Service Provider). Rich commercial template:
- Products: setup fee, subscription fee, RFID card purchase, usage credit
- Tariffs: time-of-use, per-connector-type, per-charger-speed, overtime
  penalty behavior
- Displays: per-locale presentation (Icelandic + English day one)
- Variants: country + currency
- Balance type: prepaid / postpaid / non-paying / pay-immediately /
  postpaid-immediately
- Category: single-tariff / membership / roaming / OTP-guest
- Termination behavior: terminate / evergreen / rollover
- Cost factor, minimum commitment, financial code for ERP, display code

**ChargerServicePlan** (Host ↔ Service Provider). Separate contract
governing the Host relationship:
- Revenue share rules (Host keeps X%, SP keeps Y%)
- Electricity reimbursement (SP reimburses Host for consumption)
- Maintenance responsibility (who fixes what, who pays for truck rolls)
- Platform fee model (flat / per-charger / per-user / none)
- Default tariff to apply to chargers at Host's properties
- Term, renewal, termination conditions

This split is what enables the full commercial surface: workplace
charging ("my employer pays my bill"), MDU (building owner earns a cut),
fleet operator (all costs absorbed by the company), hotel chain (one
contract, many properties), retail (charger-as-amenity). Each becomes a
combination of `ChargerServicePlan` + available `CustomerPlan`s.

## 7. Push API — first-class outbound

The Push API publishes a fixed event vocabulary to subscribed external
systems (ERP, CRM, loyalty, fleet ops, analytics). It is a subsystem,
not a bag of routes.

Canonical events: `transaction.started`, `transaction.updated` (periodic
during active charging), `transaction.stopped`, `transaction.billed`
(the CDR — charge detail record with final cost), `charger.added`,
`connector.status_updated`, `card.authorize_request`, `issue.opened`,
`issue.resolved`.

Delivery: signed HTTP POST, idempotency keys, durable retry with
exponential backoff, subscriber registry per tenant with scoped API
keys, dead-letter queue for unrecoverable failures.

## 8. Data retention classes

One `events.event_log` table, tiered by `retention_class`:

| Class | Source | Lifetime | Storage |
|---|---|---|---|
| `financial` | session start/stop, invoicing, refunds | indefinite | hot Postgres |
| `operational` | charger boot, status changes, command results | indefinite (small) | hot Postgres |
| `raw_protocol` | every OCPP message, every vendor API call | 30–90 days | hot, then deleted |
| `aggregate` | hourly/daily rollups of protocol events | 12–24 months | hot Postgres |
| `issue_history` | issue lifecycle events | indefinite | hot Postgres |
| `audit` | actor-did-what events | indefinite | separate `audit` schema |

Raw events aggregate nightly; aggregates preserve what the Issue Engine
and analytics need. Financial and issue records live forever. Audit log
is separate because it answers a different question (governance, not
domain).

## 9. Runtime

- **Main app (`hlada`):** Cloudflare Worker via OpenNext, Next.js 16 App
  Router, TypeScript, Prisma 7 on Neon (EU).
- **OCPP gateway (`straumvakt-ocpp`):** Cloudflare Worker with Durable
  Objects per OCPP Identity. WebSocket Hibernation API. Signed webhook
  to main app for domain events.
- **Database:** Neon Postgres, EU region (Frankfurt), branches per
  environment, point-in-time recovery enabled.
- **Jobs & cron:** Cloudflare Queues + Cron Triggers. No `pg-boss`.
- **Object storage:** Cloudflare R2 (EU jurisdiction) for invoice PDFs,
  exports, firmware images.
- **Observability:** OpenTelemetry → Better Stack or Axiom (EU region).
- **Secrets:** Cloudflare dashboard (per-environment), never in
  `wrangler.jsonc`, never in git.
- **Auth:** Better Auth in-app for operator login; Auðkenni OIDC for
  Icelandic driver authentication; API keys for partners.
- **Payments:** TBD — Stripe fastest, Adyen / Netgíró possible. Decision
  in Sprint 8.

## 10. Schemas (Postgres)

Logical schema namespaces inside one Neon database:

| Schema | Owns |
|---|---|
| `identity` | users (enriched per [ADR 0010](../adr/0010-organization-profile-enrichment.md): `kennitala`, `phone`, `locale`, `notes`), credentials, **platform admins** ([ADR 0008](../adr/0008-cost-center-splitting.md)) |
| `tenancy` | organizations (enriched per [ADR 0010](../adr/0010-organization-profile-enrichment.md): `legal_name`, `legal_form`, `kennitala`, `vsk_nr`, `lei_code`, `default_currency`, `addresses` JSONB, `contacts` JSONB, `branding` JSONB, `regulator_licence_no`, `roles[]` enum, `notes`), memberships, org-level config |
| `hosts` | *empty after [ADR 0009](../adr/0009-drop-charger-host-tier.md) drop. Schema reserved for future host-domain tables (e.g. `ServiceAgreement` when Issue Engine ships post-pilot).* |
| `properties` | properties (now attached directly to Org per [ADR 0009](../adr/0009-drop-charger-host-tier.md)), sites (with `site_type` enum carrying the workplace/MDU/hotel/fleet/retail classifier formerly on Host), **installations** (vendor-managed groupings), **circuits** (breaker-bound, [ADR 0007](../adr/0007-circuit-asset-tier-back.md)), site assets (charger/meter/modem/controller). Sites carry `dso_tariff_id`, `usrf_tariff_id`, `usrf_prem_tariff_id`, `xtrrf_tariff_id`, `spvivf_tariff_id`; installations carry `retailer_tariff_id`. |
| `assets` | kind-specific asset extensions (chargers, meters, modems, controllers). Chargers carry `owner_org_id` + `chrgrf_tariff_id` per [ADR 0008](../adr/0008-cost-center-splitting.md). |
| `hardware` | **vendor + model catalog** (platform-level, not tenant-scoped); model profiles that template asset records |
| `ocpp` | OCPP identities, outbound commands, routing policy, capability registry, **per-identity vendor credentials (DC)**, **`configuration_keys` registry** populated by GetConfiguration / ChangeConfiguration round-trips ([ADR 0010](../adr/0010-organization-profile-enrichment.md)). Per [ADR 0011](../adr/0011-control-plane-optionality.md), this schema owns optional OCPP control endpoints, not the physical charger hierarchy. |
| `charging` | sessions, meter values, connector status, reservations. Sessions carry `cost_ex_vat_minor` + `cost_inc_vat_minor` (rolled up from `billing.billing_lines` at session-stop). Target direction per ADR 0011: sessions anchor to physical station/EVSE/connector first, with optional OCPP/vendor/external CPMS transaction references. |
| `billing` | legacy commercial template (plans, tariffs, products, subscriptions, transactions, invoices, statements) **plus rev-3 cost-center splitting**: `cost_factors` (runtime catalog), `tariff_definitions`, `cost_centers`, `contracts`, `contract_factor_assignments`, `driver_contracts`, `driver_contract_factor_overrides`, `contract_period_accumulators`, `billing_lines` ([ADR 0008](../adr/0008-cost-center-splitting.md)). `charger_service_plans` dropped per [ADR 0009](../adr/0009-drop-charger-host-tier.md) (legacy under `hosts.*` schema). |
| `issues` | tickets, ticket events, detection rules |
| `events` | event log, idempotency keys |
| `audit` | actor-did-what log |
| `entitlements` | feature flags, enterprise licenses, fair-use config |
| `people` | family groups, family memberships |
| `vendors` | vendor adapter health scores, contract test results |
| `roaming` | OCPI tokens, external properties/sites, hub connections, CDR queue |
| `energy` | site/property energy policies, energy planning results |
| `webhooks` | subscribers, subscription scopes, delivery history, dead letters |

**Where credentials live.** Vendor API credentials are referenced from
the row that owns the control relationship, keyed to a secret store
(Cloudflare Secrets) rather than stored in the database:

- AC vendor-managed (Zaptec Pro, Easee One) — `properties.installations.credentials_ref`
- DC vendor-managed (Kempower, Tritium) — `ocpp.ocpp_identities.credentials_ref`
- OCPI roaming — `roaming.hub_connections.credentials_ref`

The schema row holds the reference and a status (`pending`, `valid`,
`expired`, `revoked`); adapters read the actual credential from the
secret store at dispatch time.

Module boundaries are the schema boundaries: code in one module never
reads another's tables directly. Cross-boundary communication is
through events or explicit typed interfaces.

## 11. Non-goals for V3

Explicit exclusions so scope doesn't silently creep. **Two tiers** —
items deferred from V3 entirely, and items deferred from the *pilot*
into the post-pilot backlog (per [ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md)).

### 11.1 Deferred from V3 entirely

- Battery and solar as `SiteAsset` kinds (deferred; shape admits them)
- ML models, feature store, model registry (deferred; event log written
  to remain ML-ready)
- Smart charging optimization algorithms
- V2G, vehicle telematics integration
- Contractor marketplace (Helper role ships; contractor ops layer
  defers)
- White-label mobile apps (PWA sufficient Day 1)
- OCPP 2.1 adapter
- ClickHouse or dedicated analytics store
- Kafka or dedicated event bus — Cloudflare Queues + Postgres suffice
- MCP access for agent-friendly APIs (interesting; deferred past V3)

### 11.2 Deferred from pilot to post-pilot

The pilot is **admin-functionality only — a demonstrable platform from
the operator's seat**, not a commercial release. Scope tightened in
two passes on 2026-04-25:
[ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md) (rev 1)
deferred six topical groups; [ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md)
(rev 2) **expanded tags B and D** to absorb the entire Driver
Experience and Issue Engine sprints, and reorganised the sprint
sequence to add Sprint 2 (Admin Onboarding + Zaptec) and Sprint 4
(Data Storage Lifecycle).

The following items have schema and module boundaries already in
place from earlier sprints — turning them on post-pilot is additive,
not migrational. Tags match the
[`straumvakt_roadmap.svg`](./straumvakt_roadmap.svg).

- **A · Roaming** — eMSP endpoints (`/ocpi/emsp/2.2.1/*`), OCPI token
  push to roaming partners, OCPP 2.0.1 adapter
- **B · Driver Experience** *(expanded in ADR 0006 — entire sprint)* —
  driver self-signup + login (any kind), driver PWA shell, Auðkenni
  electronic-ID (OIDC), QR-code session start, family groups,
  employer reimbursement workflow. Pilot has admin-created driver
  records only (inert, linked to OCPP idTags); no driver-facing
  surface.
- **C · Multi-currency** — EUR + per-locale variants (pilot is ISK
  only)
- **D · Issue Engine** *(expanded in ADR 0006 — entire sprint)* —
  five basic detection rules, ticket workflow, helper role, charger
  lifetime history, operator console issue pages, advanced
  detection (anomaly + sequence rules), smart routing, ML
  categorization, helper reputation scoring. Pilot operator
  diagnoses by hand from the raw event log.
- **E · Real billing** — monthly invoice generation, billing
  transactions as committed ledger entries, statements, employer
  reimbursement workflow, PDF invoice rendering
- **F · Commerce + compliance** — payment provider integration,
  dunning workflow, EU residency *verification ceremony* (the
  runtime *posture* — Cloudflare Data Localization, Neon EU region,
  R2 EU jurisdiction, DO `locationHint=weur` — stays in place
  during pilot; only the audit ceremony defers)

## 12. Reading guide

- `straumvakt_architecture_v3.svg` — the visual.
- `STRAUMVAKT_ARCHITECTURE.md` (V2) — prior canon, still valid for
  unchanged sections (OCPP gateway design, idempotency detail, outbox
  pattern specifics).
- `STRAUMVAKT_ARCHITECTURE_V2.md` — the V1→V2 synthesis, still valid for
  the three-layer charger asset model detail and retention class
  definitions.
- `STRAUMVAKT_V3_DELIVERY_PLAN.md` — how this architecture becomes a
  shipping pilot. **Read this next.**
