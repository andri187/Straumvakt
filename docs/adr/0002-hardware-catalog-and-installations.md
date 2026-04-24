# ADR 0002 — Hardware Catalog and Installations

**Status:** Accepted
**Date:** 2026-04-24
**Sprint:** 0

## Context

Onboarding chargers onto Straumvakt is not one flow — it is three,
driven by the hardware itself:

1. **AC vendor-managed** (Zaptec Pro, Easee One). The vendor portal is
   the authority. Load balancing, firmware, site-level configuration
   all happen in the vendor's backend. OCPP is often not used at all;
   where it is, it is a read-only route. A single set of credentials
   (OAuth token or basic auth) covers every charger in a vendor
   "installation" — a multi-charger group the vendor already models.
2. **DC vendor-managed** (Kempower, Tritium, ABB). The vendor backend
   is primary for firmware, diagnostics, and session orchestration;
   OCPP is added as a third-party backend URL on a *per-identity*
   basis. Credentials attach to each OCPP identity, not to a group.
3. **Generic OCPP** (any charger without a vendor adapter). No vendor
   portal involvement. No credentials. OCPP is the only channel.

The current schema (`assets.chargers`, `ocpp.ocpp_identities`) stores
`vendor` and `model` as free-text strings. That is not enough:

- There is no catalog of *which* vendors and models the platform
  supports, what their technical capabilities are, or where
  credentials attach.
- There is no first-class "Installation" entity to group AC chargers
  that share a credential set and a vendor-side configuration.
- Onboarding flows have to hardcode credential-scope rules per vendor.
- Charger records have to be populated by hand from spec sheets;
  there is no model profile to read from.

Beyond chargers, the same gap exists for meters, modems, and
controllers (Shelly-class). They need a catalog too so a site can be
provisioned from known-good models rather than ad-hoc entries.

## Decision

We introduce a global **hardware catalog** and a first-class
**Installation** entity under sites, both landing in Sprint 0 as
additive schema.

### 1. New Postgres schema: `hardware`

The catalog is platform-level, not tenant-scoped. All Orgs see the
same vendors and models. (Later, we can extend with per-Org custom
entries if a buyer demands it; not required for V3.)

- `hardware.vendors` — one row per supported vendor (Zaptec, Easee,
  Kempower, Tritium, Shelly, generic…). Carries `api_kind` (`oauth` /
  `basic_auth` / `none`) and display metadata.
- `hardware.models` — one row per supported model (Zaptec Pro, Easee
  One, Kempower C-Series, Shelly Pro 4PM…). Carries:
  - `kind` — charger_ac / charger_dc / meter / modem / controller
  - `asset_class` — ac / dc (for chargers)
  - `credential_scope` — `installation` / `identity` / `none`
  - `profile` (JSONB) — technical specs: rated power, phases,
    connector types, supported OCPP versions, firmware update path,
    capability flags. Acts as the template for a charger's displayed
    data when a model is selected.

### 2. New `properties.installations` table

Optional grouping between Site and SiteAsset, used when chargers share
a vendor-side credential set:

- `installations.vendor_id` → `hardware.vendors` (primary vendor)
- `installations.vendor_installation_ref` — vendor's own installation
  ID (obtained after credential-based discovery)
- `installations.credentials_ref` — secret store key (Cloudflare
  Secrets); never the credential itself
- `installations.onboarding_status` — `pending_credentials` →
  `discovering` → `active`

OCPP-only chargers have no installation. DC vendor-managed chargers
may have an installation for grouping but do not use its credentials.

### 3. Credentials attach where the model says

Per `hardware.models.credential_scope`:

- `installation` — credentials live on `properties.installations.credentials_ref`.
  One set per installation, covers every charger below it (Zaptec Pro,
  Easee One).
- `identity` — credentials live on `ocpp.ocpp_identities.credentials_ref`.
  One set per OCPP identity (DC chargers).
- `none` — no credentials; OCPP is the only channel.

This is data, not code. Adding a new vendor with a different auth
pattern means writing a catalog row plus an adapter module; no
schema change.

### 4. Charger links to its model and (optionally) its installation

`assets.chargers` gains two additive nullable fields:

- `model_id` → `hardware.models` — when set, the charger's displayed
  technical info reads from the model profile by default. The existing
  free-text `vendor` and `model` columns remain for OCPP-only or
  catalog-gap cases.
- `installation_id` → `properties.installations` — set for AC
  vendor-managed chargers that belong to a group.

### 5. OCPP identity gains per-identity credential slots

`ocpp.ocpp_identities` gains `credentials_ref` and `credentials_status`
(both nullable). Used only when the charger's model has
`credential_scope = identity`.

### 6. Operator console — "Hardware" navigation group

In Sprint 5 (operator console), a new **Hardware** sidebar group
exposes the catalog:

- Vendors list / detail
- Models list / detail (showing the technical profile)
- Read-write for org admins; read-only for helpers and operators

Not tied to any single site or host — it is a platform-level
reference surface.

## Consequences

### Positive

- Onboarding flows are driven by catalog data, not per-vendor
  hardcoding. "Zaptec installation needs OAuth credentials" is a
  consequence of two rows in `hardware` (vendor + model), not an if
  branch in code.
- Adding a new vendor (DC or AC) is a catalog insert plus an adapter
  module. No schema change, no front-end change.
- Model profiles mean a new charger is provisioned with correct
  technical details the moment its model is picked.
- Clean separation between what exists (catalog) and what is
  installed (inventory).
- Installation as a first-class concept unblocks the Zaptec/Easee
  onboarding flows Sprint 9 (or the pilot, whichever comes first).

### Negative

- Sprint 0 gains three tables (`hardware.vendors`, `hardware.models`,
  `properties.installations`) and three enums. Small incremental
  complexity.
- Catalog data has to be maintained. Policy: catalog seed is checked
  into the repo as a migration, not an admin-only runtime edit. A
  catalog update is an engineering event, not an operator event.
- The asset hierarchy diagram in `straumvakt_architecture_v3.svg`
  becomes stale and must be updated in a follow-up commit (tracked
  under Sprint 0).

### Neutral

- Catalog rows are small and rarely change; cache cost is negligible.
- The free-text `charger.vendor` / `charger.model` columns remain for
  OCPP-only chargers and cases where the catalog has not yet been
  extended. They become redundant when `model_id` is set; the
  repository layer reads from the model profile first and falls back
  to the text fields.

## Alternatives considered

**Keep vendor as a free-text string; special-case Zaptec/Easee in
code.** Rejected — credential-scope logic would scatter across every
onboarding path, and DC hardware with per-identity creds would need
its own separate plumbing. Turning scope into data is cheaper.

**Installation as a grouping column on `assets.chargers` (no separate
table).** Rejected — installations carry their own metadata
(credentials, onboarding status, vendor reference, vendor's own ID)
that belongs on a dedicated row. A grouping column cannot carry that
state.

**One credentials table per vendor, bespoke shape per vendor.**
Rejected — credential shape belongs in the secret store (Cloudflare
Secrets), not in the relational schema. The schema holds a reference
(`credentials_ref`) plus status; the adapter reads the real credential
from the secret store at dispatch time.

**Per-tenant catalog (each Org carries its own vendors/models).**
Deferred — adds multi-tenant CRUD on the catalog, which is a feature
no pilot customer has asked for. The schema can be extended with an
optional `org_id` column later without reshaping existing rows
(nullable = platform-default).

## References

- `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md` §4 (hierarchy),
  §5 (Vendor Adapter Track), §10 (schemas)
- `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` §3 (Sprint 0
  milestones 0.1, 0.2, 0.6)
- `prisma/schema.prisma` (the implementation)
- `docs/adr/0001-v3-foundation-schema.md` (the schema this extends)
