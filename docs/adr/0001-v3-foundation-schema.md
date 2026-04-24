# ADR 0001 — V3 Foundation Schema

**Status:** Accepted
**Date:** 2026-04-24
**Sprint:** 0

## Context

Straumvakt V3 needs a single coherent data foundation that the next 9
sprints can build on without schema rewrites. Five things have to be
right from row one because they are expensive to retrofit later:

1. Multi-tenancy (every operational row carries `org_id`)
2. The append-only event log as source of truth (with retention classes)
3. Idempotency on every mutating boundary (OCPP, vendor APIs, webhooks)
4. The seven-layer asset hierarchy (`Org → Host → Property → Site → SiteAsset → OCPPIdentity → Connector`)
5. Money as integer minor units (no Float, no Decimal ambiguity)

## Decision

We land the full V3 schema in one Sprint 0 migration, organised as 17
Postgres schemas (one per bounded context), using Prisma 7's
`multiSchema` preview feature. Specifically:

### Postgres schemas (one per bounded context)

```
identity, tenancy, hosts, properties, assets, ocpp, charging,
billing, issues, events, audit, entitlements, people, vendors,
roaming, energy, webhooks
```

Each schema owns a small set of tables. Code in one bounded context
never reads another's tables directly — only via events or explicit
typed interfaces (per V3 architecture §1, principle 3).

### Asset model

`SiteAsset` is the polymorphic supertype with a `kind` discriminator
(`charger`, `meter`, `modem`, `controller`). Kind-specific extension
tables live in the `assets` schema (`assets.chargers`, `assets.meters`,
`assets.modems`, `assets.controllers`). For `kind = charger`,
`assets.chargers.site_asset_id` is both the PK and the FK back to
`properties.site_assets`.

`OCPPIdentity` is a separate entity from `Charger`, owning the OCPP
control endpoint, capabilities (JSONB), and routing policy (JSONB).
This admits both "1 charger : N identities" (some DC vendors) and
"1 identity : N connectors" (Kempower-style).

### Money

All monetary fields are `BIGINT` minor units (aurar / öre / cents).
No `Float`, no `Decimal` for monetary values. Schema enforced — grep
`Decimal` in `prisma/schema.prisma` returns hits only for non-money
quantities (energy power factors, latitude/longitude, etc.).

### Tenancy

Every operational table carries `org_id` (`Organization` is the SaaS
tenant — the CPO running the platform). Cross-tenant data access is
prevented at three layers:

1. Schema — every relation is org-scoped
2. Application — `withOrgContext()` is the only sanctioned data path,
   and it stamps `orgId` onto every where-clause via `requireOrg()`
3. Future (Sprint 9) — Postgres RLS where mixed-role console queries
   demand it

### Event log

`events.event_log` is the append-only source of truth, partitioned
logically by `retention_class`:

- `financial` — indefinite, hot
- `operational` — indefinite, hot, small
- `raw_protocol` — 30–90 days, then deleted
- `aggregate` — 12–24 months
- `issue_history` — indefinite

A nightly aggregation job (Sprint 1) rolls `raw_protocol` into
`aggregate` and ages out the source rows. Financial and issue records
are never destructively aggregated.

### Idempotency

`events.idempotency_keys` holds `(scope, key)` composite primary keys.
Every webhook receiver, OCPP message handler, and vendor adapter
invocation checks this table before mutating state and writes its
result for replay.

### Outbound commands

`ocpp.outbound_commands` is the outbox. Application code inserts
commands; a Cloudflare Cron Trigger (Sprint 1) polls and dispatches
to either the OCPP gateway or a vendor adapter, based on the routing
policy on the relevant `OcppIdentity`.

### Two contracts, not one

Driver-facing pricing lives in `billing.customer_plans` (Driivz-style
template with products, tariffs, displays, locales, balance type,
category, termination behavior). Host-facing commercial terms live in
`hosts.charger_service_plans` (revenue share, electricity reimbursement,
maintenance responsibility, platform fee model). The two are independent
first-class entities.

## Consequences

### Positive

- Sprint 1 onwards never needs a "wait, the schema doesn't quite fit"
  pause. Every domain feature has a place to land.
- Pricing changes (new tariff types, new product types) become JSONB
  edits inside an existing column, not migrations.
- The Issue Engine has clean data to consume from row one (event log
  with named retention classes, not a raw firehose).
- Vendor onboarding (Sprint 4) only needs to populate
  `ocpp_identities.capabilities` and `control_routing` — no new tables.

### Negative

- The schema is large for Sprint 0 (~30 tables, 17 enums). Code review
  has to be careful, not skim.
- `multiSchema` is a Prisma preview feature; if it changes we may need
  to fold all schemas into `public` later. Risk is small (preview has
  been stable for over a year) and the migration would be mechanical.
- Some tables are populated only later (e.g. `webhooks.deliveries` not
  used until Sprint 7). They sit empty until then. Acceptable — they
  cost nothing if unused.

### Neutral

- Prisma client size grows with the schema. Negligible at this scale;
  monitor on Cloudflare Worker cold-start budget if it ever shows up
  as a flame-graph entry.

## Alternatives considered

**Defer schemas to when each sprint needs them.** Rejected — every
sprint would touch the schema, and migration noise would dominate
commit history. Single Sprint 0 migration is cleaner.

**Single `public` schema.** Rejected — module boundaries would dissolve
into naming conventions that no one enforces. Postgres schemas give us
namespacing that the database itself rejects on misuse.

**Drizzle instead of Prisma.** Rejected — CPMS already proved Prisma 7
+ `@prisma/adapter-neon` works on Cloudflare Workers, and we already
know the gotchas. Switching ORMs at Sprint 0 buys nothing.

**Event sourcing as primary write model (commands + events, no operational
tables).** Rejected — the event log is the source of truth, but
projections to operational tables stay first-class so day-to-day reads
don't need replay. We get the benefits without the complexity.

## References

- `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md` §10 (schemas)
- `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` §3 (Sprint 0)
- `prisma/schema.prisma` (the implementation)
- `src/lib/repositories/_context.ts` (`withOrgContext` enforcement)
- `src/lib/repositories/_context.test.ts` (proof of enforcement)
