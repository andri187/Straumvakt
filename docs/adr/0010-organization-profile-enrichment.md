# ADR 0010 — Organization Profile Enrichment + Multi-Role + User Profile Enrichment + OCPP Configuration Keys

**Status:** Accepted
**Date:** 2026-04-26
**Sprint:** schema migration ships in Sprint 2 milestone 2.6 (consolidated with ADRs 0007 + 0008 + 0009)
**Supersedes (in part):** [ADR 0001](./0001-v3-foundation-schema.md) — enriches `tenancy.organizations` and `identity.users` from minimum-viable to operationally complete; the rest of ADR 0001 stands.
**Rollback anchor:** `pre-org-enrichment-2026-04-26` (tag created before this migration applies).

## Context

V3 (Sprint 0, ADR 0001) deliberately kept `tenancy.organizations` and
`identity.users` minimal:

```
Organization:                User:
  id, slug, displayName,       id, email, displayName, status
  countryCode, status          + optional UserCredential sibling
```

The reasoning at the time: every column is a future migration risk;
we don't yet know which fields are load-bearing; minimum viable lets
us add what proves necessary.

Three things have made the missing columns non-negotiable for pilot:

1. **Real Iceland operations need kennitala.** Every legal entity in
   Iceland has a kennitala (national legal-entity ID). Every human
   has a personal kennitala. Invoices, contracts, regulatory filings,
   insurance, GDPR data subject requests — all keyed by kennitala,
   not by email or company name. A schema with no kennitala column
   forces every operation that touches Skatturinn (Icelandic Tax) or
   any external system into JSONB-blob workarounds. The
   [`iceland-energy-parties.json`](../reference/iceland-energy-parties.json)
   catalogue we already maintain shows the shape — kennitala, vsk_nr,
   legal_form, addresses, contacts, branding, regulator licence, all
   present for 21 real parties. The Org schema must match.

2. **Org is not just "the SaaS tenant."** [ADR 0008](./0008-cost-center-splitting.md)
   established that ownership ≠ operation ≠ payment by adding
   `assets.chargers.owner_org_id` distinct from `assets.chargers.org_id`,
   and `cost_centers.payer_org_id` / `beneficiary_org_id`. But Org
   itself was still implicitly "the operator" — there's no schema
   way to say "this Org is a retailer, never operates anything, but
   is referenced by `tariff_definitions` as the REPF beneficiary."
   Real cases that need Org rows but never sit in the asset
   hierarchy:
   - **Retailers** (HS Orka, ON, Orkusalan) — referenced by
     installation-anchored REPF tariff_definitions.
   - **DSOs** (Veitur, RARIK, HS Veitur, Norðurorka, Orkubú
     Vestfjarða) — referenced by site-anchored DSOF
     tariff_definitions.
   - **TSO** (Landsnet) — referenced indirectly via DSO upstream.
   - **Service contractors** — perform repairs / SLA work; receive
     payment from Krónan-style customer Orgs; never operate iron.
   - **Pure customers / payers** — workplaces buying
     charging-as-a-service from a CPO; no operator role; cost-center
     `payer_org_id` references them.
   - **Hardware vendors** (Zaptec, Easee) — referenced by
     `hardware.vendors.slug` and `installation.vendor_id`.

3. **RFID idTags are how chargers identify drivers, but the link is
   invisible in the UI.** `roaming.ocpi_tokens` rows with
   `tokenType=RFID` and `userId` set ARE the OCPP authorize lookup
   path — but the `/people/users/[id]` page doesn't surface them.
   The schema is correct; the UI gap matters operationally.

Plus one OCPP gap surfaced by the standard-compliance audit:

4. **Configuration keys are not modelled.** OCPP 1.6J expects each
   ChargingStation to expose a key/value config registry
   (`HeartbeatInterval`, `MeterValueSampleInterval`,
   `AuthorizeRemoteTxRequests`, `LocalAuthListEnabled`, etc.) that
   the CSMS reads/writes via `GetConfiguration` /
   `ChangeConfiguration`. V3 has no schema to record what's set on
   each charger. When a charger misbehaves, the operator has no
   audit-trailed way to see "what's the current `MeterValueSampleInterval`
   on this charger?" Adding a small `ocpp.configuration_keys` table
   closes this gap and is OCPP-spec aligned.

## Decision

Land four schema enrichments in one consolidated migration in
Sprint 2.6, alongside ADR 0007 (Circuit), ADR 0008 (cost-center
splitting), and ADR 0009 (drop Host).

### 1. Organization profile enrichment + multi-role

```prisma
enum OrganizationRole {
  // ── Operational ──────────────────────────────────────────────
  csms_provider        // the platform itself (Straumvakt). Single row expected.
  operator             // runs OCPP charging sessions (CPO role).
  service_contractor   // repairs / maintenance / SLA work.
  installer            // new electrical / hardware installations.

  // ── Hardware ─────────────────────────────────────────────────
  vendor               // charger OEM (Zaptec, Easee, Kempower, ABB).
  asset_owner          // owns charger hardware (chargers.owner_org_id).

  // ── Commercial ───────────────────────────────────────────────
  payer                // pays cost factors (cost_centers.payer_org_id).
  beneficiary          // receives money (cost_centers.beneficiary_org_id).
  customer             // consumes charging-as-a-service without operating.

  // ── Energy market (mirrors iceland-energy-parties.role_legend) ─
  retailer             // söluaðili — sells electricity (REPF source).
  dso                  // dreifiveita — distribution (DSOF source).
  tso                  // transmission system operator (Landsnet).
  producer             // generation owner (hydro / geothermal / wind).
  aggregator           // group-buying / comparison platform.

  // ── Charging-network specialisation (overlap with operator + asset_owner) ─
  public_charging      // public-station CPO (N1, Ísorka, ON e-mob).
  home_charging        // home / MDU / workplace charger sales + service.

  // ── Roaming / eMobility (post-pilot, ADR 0005 tag A) ─────────
  emsp                 // e-Mobility Service Provider (driver app/billing).
  roaming_hub          // Hubject, Gireve, direct peer.

  // ── Financial / regulatory (post-pilot mostly) ───────────────
  payment_processor    // Stripe, Adyen, Netgíró, Valitor.
  insurance_provider   // liability / property insurance.
  regulator            // Orkustofnun, Skatturinn, Mannvirkjastofnun (read-only ref).

  @@schema("tenancy")
}

model Organization {
  // ── existing columns (Sprint 0) ──────────────────────────────
  id            String       @id @default(uuid()) @db.Uuid
  slug          String       @unique
  displayName   String       @map("display_name")
  countryCode   String       @map("country_code")
  status        OrgStatus    @default(active)
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")

  // ── ADD per ADR 0010 ─────────────────────────────────────────
  legalName              String?              @map("legal_name")
  legalForm              String?              @map("legal_form")          // ehf, ohf, hf, sf, ses, ...
  kennitala              String?              @unique                     // Iceland legal-entity ID
  vskNr                  String?              @map("vsk_nr")              // Skatturinn VAT
  leiCode                String?              @map("lei_code")            // ISO 17442 LEI
  defaultCurrency        String               @map("default_currency") @default("ISK")
  addresses              Json                 @default("{}") @db.JsonB    // { registered, billing, postal }
  contacts               Json                 @default("{}") @db.JsonB    // { phone_main, email_main, billing_email, website }
  branding               Json                 @default("{}") @db.JsonB    // { logo_url, primary_color, sender_email_domain }
  regulatorLicenceNo     String?              @map("regulator_licence_no")
  roles                  OrganizationRole[]   @default([])                // multi-role array
  notes                  String?              @db.Text

  // ── existing relations unchanged ─────────────────────────────
  // memberships, properties, sites, installations, …
}
```

### 2. User profile enrichment

```prisma
model User {
  // ── existing (Sprint 0) ──────────────────────────────────────
  id            String         @id @default(uuid()) @db.Uuid
  email         String         @unique @db.Citext
  displayName   String?        @map("display_name")
  status        UserStatus     @default(active)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  credentials   UserCredential?

  // ── ADD per ADR 0010 ─────────────────────────────────────────
  kennitala     String?        @unique           // personal kennitala — KYC + Icelandic identity
  phone         String?                          // E.164 format preferred
  locale        String         @default("is")    // is / en — driver-facing UX language
  notes         String?        @db.Text

  // ── existing relations unchanged ─────────────────────────────
}
```

### 3. OCPP configuration-key registry (closes OCPP-spec gap)

```prisma
model OcppConfigurationKey {
  id                   String       @id @default(uuid()) @db.Uuid
  orgId                String       @map("org_id") @db.Uuid
  ocppIdentityId       String       @map("ocpp_identity_id") @db.Uuid
  keyName              String       @map("key_name")              // OCPP 1.6 standard key, e.g. HeartbeatInterval
  keyValue             String?      @map("key_value")
  readonly             Boolean      @default(false)
  observedAt           DateTime     @map("observed_at") @db.Timestamptz(6) // when CSMS last read this from the charger
  setByActorUserId     String?      @map("set_by_actor_user_id") @db.Uuid
  setAt                DateTime?    @map("set_at") @db.Timestamptz(6)      // when CSMS last wrote this
  notes                String?

  organization         Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  ocppIdentity         OcppIdentity @relation(fields: [ocppIdentityId], references: [id], onDelete: Cascade)
  setByActor           User?        @relation(fields: [setByActorUserId], references: [id])

  @@unique([ocppIdentityId, keyName])
  @@index([orgId, ocppIdentityId])
  @@map("configuration_keys")
  @@schema("ocpp")
}
```

Pilot interaction:
- `GetConfiguration` round-trip (Sprint 1.5) updates these rows with
  observed values + `observedAt`.
- `ChangeConfiguration` round-trip records the new value with `setAt`
  + `setByActorUserId`.
- The Sprint 2.5 charger detail page surfaces this table as the
  "OCPP configuration" panel — operator sees what's actually set on
  the charger and when.

OCPP 1.6 standard keys we expect to see populated for any charger:

| Key | Type | Role |
|---|---|---|
| `HeartbeatInterval` | int (seconds) | how often charger sends Heartbeat |
| `MeterValueSampleInterval` | int (seconds) | sampling cadence during a transaction |
| `MeterValuesSampledData` | CSL | which measurands to send (`Energy.Active.Import.Register`, `Voltage`, `Current`, `Power.Active.Import`, `SoC`) |
| `AuthorizeRemoteTxRequests` | bool | whether RemoteStartTransaction needs Authorize first |
| `ConnectionTimeOut` | int | OCPP WebSocket reconnect floor |
| `LocalAuthListEnabled` | bool | offline-auth posture |
| `LocalAuthListMaxLength` | int | charger local auth cache size |
| `ResetRetries` | int | Reset-attempt budget |
| `WebSocketPingInterval` | int | OCPP-J ping cadence |
| (vendor-specific) | various | DataTransfer extension keys |

### 4. Seed: iceland-energy-parties → tenancy.organizations

Sprint 2.10 cost-factor catalog seed extends to load every party from
[`docs/reference/iceland-energy-parties.json`](../reference/iceland-energy-parties.json)
into `tenancy.organizations` with role mapping:

| iceland-energy-parties role | OrganizationRole |
|---|---|
| `retailer` | `retailer` |
| `dso` | `dso` |
| `tso` | `tso` |
| `producer` | `producer` |
| `aggregator` | `aggregator` |
| `public_charging` | `public_charging` |
| `home_charging` | `home_charging` |

Plus the bootstrap row for the platform itself:

```sql
INSERT INTO tenancy.organizations (id, slug, display_name, legal_name,
  kennitala, country_code, default_currency, roles, status)
VALUES (
  /* TBD UUID */, 'straumvakt', 'Straumvakt',
  /* legal_name TBD when entity formed */,
  /* kennitala TBD */, 'IS', 'ISK',
  ARRAY['csms_provider']::tenancy."OrganizationRole"[],
  'active'
);
```

**Krónan, N1, etc. are NOT seeded.** They're admin-created at runtime
through the Sprint 2.1 UI as test tenants — same path real customers
will follow once pilot opens.

After seeding, the Reference subsection pages
(`/reference/electricity/dso`, `/retailers`, `/tso`,
`/public-charging`, `/rental-service`) become **filtered queries
against `tenancy.organizations` by role**, not separate JSON-loaders.
The JSON file becomes the seed source of record; runtime reads from
the DB.

## Consequences

### Positive

- Org and User finally hold the data Iceland actually uses (kennitala,
  vsk_nr, legal_form, addresses, contacts).
- Multi-role lets the same `tenancy.organizations` table hold
  retailers, DSOs, hardware vendors, service contractors, payers,
  customers, the platform itself — all with appropriate role tags.
  `tariff_definitions.org_id` (NEW — ADR 0008 had this implicitly via
  org_id) now points at a real, queryable Org row instead of "the
  retailer named ON" being scattered metadata.
- Reference pages are no longer a separate JSON viewer — they're real
  DB-backed Org-list views. Filter UI reuses the same admin
  components that operate on Krónan and other test tenants.
- OCPP configuration_keys closes a real OCPP-spec gap. Operator
  always knows what's actually set on each charger, with audit trail.
- Cost-center splitting (ADR 0008) gets a concrete payer/beneficiary
  identity model. `payer_org_id` and `beneficiary_org_id` reference
  real Org rows with kennitala, addresses, contact emails.

### Negative

- `tenancy.organizations` row size grows materially. Every new column
  is a future migration risk we accepted.
- `OrganizationRole` enum has 21 values. New roles post-pilot
  (`emsp`, `roaming_hub`, `payment_processor`) are reserved but
  unused for the 30-day pilot window — operators may be confused
  why the dropdown has more options than apply.
- Seeding 21 iceland-energy-parties rows means the admin
  `/people/users` and `/tenants/organizations` pages now show 22
  rows on day one (21 parties + Straumvakt platform org). Some are
  pure-reference Orgs the operator never directly interacts with —
  UI may want a "platform-managed" filter to hide them by default.
- `User.kennitala` is unique and nullable — pilot drivers may not
  have one entered initially (operator-created RFID-only records).
  Schema permits null; UI prompts for it on driver-detail edit.

### Neutral

- All existing Sprint 2.1 + 2.2 admin CRUD UIs need a refresh to
  surface the new fields (kennitala, addresses, contacts, branding,
  roles[]) — work for Sprint 2.6 close-out + 2.10 cost-center setup.
- The `/people/users/[id]` page gets a "Linked RFID idTags" panel
  reading `roaming.ocpi_tokens WHERE userId = X AND tokenType =
  'RFID'`. Schema unchanged; UI work in Sprint 2.5 / 2.6.
- ER diagram (`docs/architecture/entity_relationships.svg`) and the
  `data_model_worked_example.svg` need a regeneration run to show
  enriched Org cards (kennitala + roles[] chips), enriched User
  cards (kennitala + RFID list), and the configuration_keys table
  hanging off OCPPIdentity.

## Alternatives considered

**Stash everything in a JSONB metadata column.** Rejected — kennitala
needs a UNIQUE constraint, role-filter queries become JSON path
traversals across the whole table, addresses get unindexable.

**Add columns one at a time as needed.** Rejected — six migrations
hitting `tenancy.organizations` across as many sprints would be
churn. One coherent enrichment migration in Sprint 2.6 is cheaper.

**Model `OrganizationRole` as a separate join table
(`organization_roles` (org_id, role) one row per role).** Rejected —
1:N normalisation is more correct in pure-relational terms, but
Postgres `enum[]` arrays are queryable with `ANY()`, indexable with
GIN, and use less storage for what's at most a handful of roles per
Org. Array stays.

**Skip the `ocpp.configuration_keys` table; rely on JSONB on
`ocpp_identities.capabilities`.** Rejected — capabilities is for
"what the charger can do" (declared at BootNotification);
configuration_keys is "what's currently set." Different lifecycle
(observed-at + set-at), different write paths
(GetConfiguration vs ChangeConfiguration), different audit needs.
Conflating them costs us the audit trail.

**Separate ADR for User enrichment.** Considered. Folded into 0010
because it's the same migration cycle and the same conceptual
"profile rows are too thin" problem. Splitting would add ADR
overhead with no architectural clarity.

## References

- [`docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md`](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) §3 + §4 + §10 — to be amended
- [`docs/reference/iceland-energy-parties.json`](../reference/iceland-energy-parties.json) — seed source (21 rows)
- [`docs/reference/iceland-energy-parties.md`](../reference/iceland-energy-parties.md) — narrative companion
- [`docs/adr/0001-v3-foundation-schema.md`](./0001-v3-foundation-schema.md) — original thin schema
- [`docs/adr/0008-cost-center-splitting.md`](./0008-cost-center-splitting.md) — cost_centers reference org rows
- [`docs/adr/0009-drop-charger-host-tier.md`](./0009-drop-charger-host-tier.md) — sibling decision (multi-role Orgs make Host vestigial)
- [`docs/architecture/data_model_worked_example.svg`](../architecture/data_model_worked_example.svg) — to be regenerated with enriched Org/User/charger data
