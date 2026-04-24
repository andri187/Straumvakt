# Straumvakt — Architecture V3

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
completeness of its OCPI roaming posture — not proprietary AI. Ship the
platform, not the slides.

## 2. Principles (firm)

Ten commitments, each one non-negotiable without a decision log entry.

1. **Foundations before floors.** The concrete has to dry.
2. **Event log is the source of truth.** Tiered retention; never
   destructive aggregation without preserving source.
3. **Tenancy in the schema from row one.** Every operational row carries
   `org_id` (or equivalent tenant key) and every query is scoped.
4. **OCPP behind a translator.** The OCPP gateway emits domain events;
   the rest of the platform never sees OCPP vocabulary.
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

## 3. What changed from V2

V2 stands as the architectural backbone. V3 commits the following
overrides and additions:

| Area | V2 | V3 |
|---|---|---|
| Business hierarchy | 3-tier: Org → Site → Asset | **4-tier: Org → Charger Host → Property → Site → Asset** |
| Contract model | Single `CustomerPlan` blob | **Two first-class contracts**: `CustomerPlan` (driver↔SP) + `ChargerServicePlan` (Host↔SP) |
| Asset model | `Charger → OCPPIdentity → Connector` | Unchanged, plus **`SiteAsset` supertype** covering chargers, meters, 4G modems, onsite controllers (Shelly-class) |
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

```
Org (tenant / CPO)
 └─ Charger Host (workplace / MDU / hotel / fleet operator / retailer)
     └─ Property (physical building or parcel)
         └─ Site (sublocation: floor, lot, depot bay)
             ├─ [optional] Installation (vendor-managed grouping, AC)
             │   └─ SiteAsset (polymorphic: charger / meter / modem / controller)
             │       └─ [when Charger] OCPPIdentity (control endpoint)
             │           └─ Connector (physical socket)
             └─ SiteAsset (no installation — OCPP-only or DC)
                 └─ [when Charger] OCPPIdentity (control endpoint)
                     └─ Connector (physical socket)
```

**Org** = the SaaS tenant on Straumvakt (the CPO).
**Charger Host** = the operating entity that owns the charging
experience at a location (the workplace, the MDU, the fleet, the hotel
chain). One Org serves many Hosts under its brand.
**Property** = a physical building or site address.
**Site** = a sublocation within a property (each floor of a car park;
each depot bay).
**Installation** (optional) = a vendor-managed grouping of chargers at
a site. Holds a single credential set (OAuth token, basic auth, etc.)
that covers every charger in the group. Used for AC vendor-managed
hardware (Zaptec Pro, Easee One) where the vendor portal itself models
installations. Not used for OCPP-only chargers or for DC hardware.
**SiteAsset** = anything physical at a site that the platform manages.
On Day 1 the kinds are: `charger`, `meter`, `modem`, `controller`
(Shelly-class onsite monitoring/switching). Battery and solar are
deliberately absent from V3 but the polymorphic shape admits them
later.
**OCPPIdentity** = an OCPP control endpoint. Exists only when the
SiteAsset is a charger. One charger may expose many identities or one
identity may control many connectors. For DC hardware, OCPPIdentity
also holds its own vendor API credentials (one set per identity).
**Connector** = the socket an EV plugs into.

Sitting alongside this hierarchy is the **Hardware Catalog**
(`hardware` schema) — a platform-level registry of supported vendors
and models. A `SiteAsset` (charger, meter, modem, controller) links to
a `HardwareModel`; the model's profile is the template for the
asset's technical fields. See §10.

## 5. Integration: three parallel tracks

Every integration with the outside world is one of three shapes.

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

*Where credentials attach* is declared by `HardwareModel.credential_scope`
on the catalog row, so onboarding flows are data-driven rather than
hardcoded per vendor:

- **`installation`** — AC vendor-managed (Zaptec Pro, Easee One). One
  credential set per `properties.installations` row covers every
  charger below it. Onboarding: create Installation → enter portal
  user/password → adapter exchanges for OAuth token → discovery
  populates chargers → routing set to vendor as primary.
- **`identity`** — DC vendor-managed (Kempower, Tritium, ABB). One
  credential set per `ocpp.ocpp_identities` row. Onboarding: add OCPP
  identity → enter vendor user/password → adapter validates. The
  vendor backend is primary; OCPP is added as a third-party URL.
- **`none`** — Generic OCPP charger with no vendor API. No
  credentials; OCPP is the only channel.

**OCPI Roaming Track.** Dual-role — we act as CPO (publishing our
chargers, sessions, CDRs, tariffs to roaming partners) and as eMSP
(letting our drivers charge at partner CPO chargers). Hub connectors
(Hubject, Gireve) plus direct peer support. Token translator maps RFID
UID ↔ OCPI token ↔ user. External Property/Site shadow records hold
partner locations without polluting the operational model.

All three tracks emit domain events into the same event log. Downstream
modules — Issue Engine, billing, analytics, operations — cannot tell
which track produced a given event.

## 6. Commercial model — two contracts

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
| `identity` | users, credentials |
| `tenancy` | organizations, memberships, org-level config |
| `hosts` | charger hosts, host service plans, host contracts |
| `properties` | properties, sites, **installations** (vendor-managed groupings), site assets (charger/meter/modem/controller) |
| `assets` | kind-specific asset extensions (chargers, meters, modems, controllers) |
| `hardware` | **vendor + model catalog** (platform-level, not tenant-scoped); model profiles that template asset records |
| `ocpp` | OCPP identities, outbound commands, routing policy, capability registry, **per-identity vendor credentials (DC)** |
| `charging` | sessions, meter values, connector status, reservations |
| `billing` | plans, tariffs, products, subscriptions, billing transactions, invoices, statements |
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

Explicit exclusions so scope doesn't silently creep:

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
