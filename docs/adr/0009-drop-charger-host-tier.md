# ADR 0009 — Drop ChargerHost Tier

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Accepted
**Date:** 2026-04-26
**Sprint:** schema migration ships in Sprint 2 milestone 2.6 (consolidated with ADRs 0007 + 0008 + 0010)
**Supersedes (in part):** [ADR 0001](./0001-v3-foundation-schema.md) — drops `hosts.charger_hosts` and `hosts.charger_service_plans` from the V3 foundation; the rest of ADR 0001 stands.
**Rollback anchor:** `pre-host-drop-2026-04-26` (tag created before this migration applies).

## Context

V3 (Sprint 0, ADR 0001) introduced a four-tier business hierarchy:

```
Org → ChargerHost → Property → Site
```

ChargerHost was modelled as "the operating entity that owns the charging
experience at a location" — workplace, MDU, hotel, fleet, retail. One
Org could hold many Hosts under its brand. Host carried four things:

1. The FK target for `ChargerServicePlan` — the host ↔ Service Provider
   contract (revenue share, electricity reimbursement, maintenance
   responsibility).
2. A `type` enum (workplace / MDU / hotel / fleet / retail / standard)
   classifying the business model.
3. A `branding` JSONB for driver-facing surfaces (logo, colour, sender
   email).
4. The grouping for Properties under a sub-brand.

Three things have changed that calculus:

1. **[ADR 0008](./0008-cost-center-splitting.md) replaced
   `ChargerServicePlan` operationally.** The new
   `billing.contracts` + `billing.contract_factor_assignments` +
   `billing.cost_centers` system supersedes the per-Host service plan
   for pilot. Architecture canon §6 amendment explicitly marks
   `hosts.charger_service_plans` as legacy and unused. Host's
   commercial role evaporated.

2. **The multi-Org pattern handles every multi-brand case.** Real-world
   examples in Iceland:
   - **Subsidiaries of a parent** — Festi owns Krónan, Bónus, Elko;
     each is a separate legal entity with its own kennitala. So each
     is its own Org row. Festi (the holding company) is its own Org
     iff it directly pays/receives anything; otherwise it doesn't
     even appear.
   - **Single Org with multiple programs** — e.g. one Org runs
     workplace charging for employees AND public charging at retail
     locations. That distinction belongs at Site or Property tier
     (workplace-Site vs retail-Site), not above. Driver experience
     varies by Site, not by Host.
   - **Operator-on-behalf-of** — a fleet manager runs charging for N
     client companies. Each client is its own Org with role
     `customer` + `payer`; the fleet manager Org carries role
     `operator`. Cost-center routing handles money flow. No Host
     tier needed.

3. **[ADR 0010](./0010-organization-profile-enrichment.md) introduces
   multi-role Orgs.** When the same Org row can carry roles like
   `operator + asset_owner + payer` simultaneously, the "what does
   this Org DO" question is answered at the Org level itself — Host
   doesn't add a layer of business meaning.

The `iceland-energy-parties.json` catalogue we already maintain
confirms the shape: 21 real Icelandic energy-market parties, all
flat. No party has "sub-Hosts" inside it. Each kennitala is one Org.
The shape we already chose for real-world reference data has no Host
concept.

OCPP 1.6J and 2.0.1 specs are silent on Host (or any concept above
the ChargingStation). Host has no protocol equivalent — keep or drop
is purely a CSMS-architecture decision.

## Decision

**Drop the ChargerHost tier.**

### Schema migration (Sprint 2.6, consolidated)

```prisma
// REMOVE
model ChargerHost { ... }
model ChargerServicePlan { ... }

// ALTER properties.properties
model Property {
  // ...existing columns...
  // hostId  String  @map("host_id") @db.Uuid           ◄── REMOVED
  orgId      String  @map("org_id")  @db.Uuid           // already present, becomes
                                                        // the only parent FK
  // host     ChargerHost @relation(...)                ◄── REMOVED
  organization Organization @relation(...)              // unchanged
}

// ContractScopeType enum: drop the `host` value
enum ContractScopeType {
  org
  // host           ◄── REMOVED
  property
  site
  installation
  charger
}

// Move the Host.type classifier onto Site (was: hosts.charger_hosts.type)
model Site {
  // ...existing columns...
  siteType   SiteType  @map("site_type") @default(standard)  // NEW
}

enum SiteType {
  standard
  workplace
  mdu
  hotel
  fleet
  retail

  @@schema("properties")
}
```

**Migration mechanics** (Sprint 2.6):

```sql
-- 1. Add Site.site_type, default standard
ALTER TABLE properties.sites
  ADD COLUMN site_type properties."SiteType" NOT NULL DEFAULT 'standard';

-- 2. For each existing Site, copy its parent Host's type onto Site.site_type
UPDATE properties.sites s
SET site_type = (
  SELECT h.type::text::properties."SiteType"
  FROM properties.properties p
  JOIN hosts.charger_hosts h ON h.id = p.host_id
  WHERE p.id = s.property_id
);

-- 3. Add Property.org_id where currently null (it's already non-null in
--    Sprint 0 schema, so this is a no-op — verify in dev)

-- 4. Drop the host_id FK column from Property
ALTER TABLE properties.properties DROP COLUMN host_id;

-- 5. Drop the host relation from Contract scope_type enum
ALTER TYPE billing."ContractScopeType" RENAME VALUE 'host' TO 'host_legacy';
-- (keep the value as a deprecated stub for one release, then a follow-up
-- migration drops it entirely after we've verified no rows reference it)

-- 6. Drop hosts schema tables
DROP TABLE hosts.charger_service_plans;
DROP TABLE hosts.charger_hosts;
-- The hosts schema itself stays — it's currently empty after these drops,
-- but reserved for future host-domain tables (e.g. ServiceAgreement when
-- the Issue Engine ships post-pilot).
```

### What does NOT change

- `Site.access_level` (public / private / taxi_only) stays — unrelated.
- `Site.power_class` (lt_50kw / 50_150kw / 150_500kw / gt_500kw) stays.
- Property keeps its `display_name`, `address` JSONB, lat/lon — these
  are physical-location attributes.
- Org keeps every column it has today (and gets enriched per ADR 0010).
- All operational tables (`charging.sessions`, `events.event_log`,
  `billing.*`, `assets.chargers`, `ocpp.*`) untouched.

### Data impact

- Pilot dev/staging branches have **one** ChargerHost row
  (`host-kronan-ws` from earlier admin testing). Per the rev 3
  decision, Krónan is no longer seeded — admin creates test tenants
  at runtime — so this row evaporates with the seed reset and the
  migration starts from zero Host rows.
- No production data exists yet. Migration is risk-free in that
  sense.

## Consequences

### Positive

- One fewer entity in the asset hierarchy. Three tiers (Org →
  Property → Site) instead of four (Org → Host → Property → Site).
- Admin onboarding loses the "pick a Host" step. Properties belong
  directly to Org, simpler nav.
- Contract scope tier enum loses `host` — admins now choose between
  org / property / site / installation / charger when attaching a
  contract. Five tiers, all load-bearing.
- The hierarchy now matches `iceland-energy-parties.json` shape — Org
  is flat across the catalogue. Seeding alignment.
- Architecture documentation simplifies. The phrase "Host = the
  operating entity that owns the charging experience" — which never
  mapped cleanly to real-world identities — disappears from the canon.

### Negative

- Real schema migration. Not pure-additive — drops two tables, drops
  one enum value, drops one FK column. Per CLAUDE.md Rule 4
  (prisma/schema.prisma is edit-with-instruction), this is the
  explicit instruction.
- All admin UI under `/tenants/hosts` (built in Sprint 2.1) gets
  removed. The "Charger Hosts" sidebar leaf goes away. The Sprint
  2.1 task list closes those bullets as superseded.
- Architecture canon §3 / §4 narratives need a rewrite to remove the
  Host tier from the four-tier business hierarchy and the asset
  hierarchy diagrams.
- The ER diagram (`docs/architecture/entity_relationships.svg`) and
  the architecture v3 SVG both need updates to remove Host. The
  `data_model_worked_example.svg` we just created already noted Host
  as vestigial — that note becomes "not present."
- `Site.site_type` enum is denormalised compared to the previous
  `Host.type` (one Host with N Sites used to share a single type
  value; now each Site holds its own copy). Negligible cost: type is
  set once at Site create and rarely changes.

### Neutral

- OCPP-spec impact: zero. Host has no protocol equivalent.
- ChargerServicePlan removal aligns architecture canon §6 (already
  amended by ADR 0008 to mark these tables legacy).
- The `hosts` Postgres schema becomes empty but stays in the
  multiSchema list — reserved for future host-domain tables when
  the Issue Engine ships post-pilot (e.g. `ServiceAgreement`).

## Alternatives considered

**Keep Host as an optional grouping** (set `host_id` nullable). Rejected
— that's "Host but quietly," doesn't simplify anything, leaves the
documentation explaining when it's used vs not. Migration cost is the
same (must alter Property either way); end state is messier.

**Rename Host to BusinessUnit / SubBrand to honestly reflect its
remaining role.** Rejected — every concrete case for "BusinessUnit"
turns out to be either (a) a separate legal entity, hence separate Org,
or (b) site-level distinction, hence Site or Property. Renaming
preserves a tier that has no real role.

**Hold the drop until post-pilot, when we have actual usage data.**
Rejected — no production data exists today; hold-the-drop costs more
when Sprint 2.10 cost-center seed work has to keep `scope_type=host`
as a possible value the admin sees. Cleaner to drop now while the
hierarchy is being restructured anyway.

## References

- [`docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md`](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) §3 + §4 + §6 — to be amended
- [`docs/adr/0001-v3-foundation-schema.md`](./0001-v3-foundation-schema.md) — original four-tier hierarchy
- [`docs/adr/0008-cost-center-splitting.md`](./0008-cost-center-splitting.md) — replaced ChargerServicePlan
- [`docs/adr/0010-organization-profile-enrichment.md`](./0010-organization-profile-enrichment.md) — multi-role Orgs that obsolete Host's grouping role
- [`docs/reference/iceland-energy-parties.json`](../reference/iceland-energy-parties.json) — flat shape with no Host concept
- [`docs/architecture/data_model_worked_example.svg`](../architecture/data_model_worked_example.svg) — to be regenerated without Host
