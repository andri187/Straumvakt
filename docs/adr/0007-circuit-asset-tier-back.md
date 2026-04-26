# ADR 0007 — Circuit Asset Tier Re-Added to V3 Schema

**Status:** Accepted
**Date:** 2026-04-25
**Sprint:** schema migration ships in Sprint 2 milestone 2.6

## Context

The CPMS (pre-V3) workspace had the asset hierarchy:

```
Site → Installation → Circuit → Charger
```

When V3 was drafted (ADR 0001 + ADR 0002), the Circuit tier was
deliberately flattened out, leaving:

```
Site → [optional Installation] → SiteAsset (charger / meter / modem / controller)
```

The reasoning at the time: pilot scale didn't need explicit circuit
modeling, Installation could carry credential-scoped grouping, and
fewer rows in the hierarchy meant simpler queries.

Two things changed that calculus:

1. **Operator's admin onboarding list** (per [ADR 0006](./0006-pilot-scope-rev2-2026-04-25.md))
   explicitly named "Admin Circuit creation" as a pilot-required
   capability. The pilot operator works at a site where electrical
   circuits are a real, named, breaker-bound thing. Modeling a
   circuit as data lets the operator answer "what's on the same
   breaker?" — which is the question they actually ask when load
   distributes unevenly or when a circuit trips.

2. **Vendor-portal-managed installations** (Zaptec Pro / Easee Home)
   already model circuits internally — Zaptec Pro chargers are
   grouped into a *circuit* that shares an ampere ceiling. Sprint 2's
   Zaptec onboarding wizard pulls this from the Zaptec API; without
   a Circuit row to attach it to, the data evaporates.

3. **Future load-balancing intelligence** (out of pilot scope, but
   on the V3 horizon) is per-circuit math by definition. Modeling
   Circuit explicitly lets us add load-balancing without
   re-shaping the hierarchy.

## Decision

Add `Circuit` as a first-class entity between `Installation` and
charger-kind `SiteAsset` in the V3 hierarchy. **Optional** — like
Installation. Sites without explicit circuit modeling don't need
to populate it.

### New asset hierarchy

```
Org
 └─ Charger Host
     └─ Property
         └─ Site
             └─ [optional Installation]
                 └─ [optional Circuit]
                     └─ SiteAsset (charger / meter / modem / controller)
                         └─ [when Charger] OCPPIdentity
                             └─ Connector
```

### New schema (additive, ships in Sprint 2 milestone 2.6)

```prisma
model Circuit {
  id              String        @id @default(uuid()) @db.Uuid
  orgId           String        @map("org_id") @db.Uuid
  siteId          String        @map("site_id") @db.Uuid
  installationId  String?       @map("installation_id") @db.Uuid
  displayName     String        @map("display_name")
  ampereCeiling   Int?          @map("ampere_ceiling") // amps
  phaseCount      Int           @map("phase_count") @default(3)
  vendorCircuitRef String?      @map("vendor_circuit_ref")
  metadata        Json          @default("{}") @db.JsonB
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization    Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  site            Site          @relation(fields: [siteId], references: [id], onDelete: Cascade)
  installation    Installation? @relation(fields: [installationId], references: [id])
  chargers        SiteAsset[]   @relation("CircuitChargers")

  @@index([orgId, siteId])
  @@index([installationId])
  @@map("circuits")
  @@schema("properties")
}
```

`assets.chargers` (the kind-specific extension of charger-kind
`SiteAsset` rows) gains an optional `circuitId` foreign key.

The migration is **purely additive** — no existing rows reshape, no
existing columns drop, no existing indexes change. Per CLAUDE.md
Rule 4 schema discipline, the change is allowed and the Sprint 2.6
milestone ships it as a single migration named
`<timestamp>_add_circuit_tier`.

### What does NOT change

- `Installation` stays optional. Sites without installations don't
  need circuits either.
- Sites with Installation but without Circuit are valid (zero or
  one circuits per Installation, the schema doesn't force it).
- Sites with Circuits but no Installation are valid (a circuit can
  belong directly to a Site).
- Connectors keep their relationship to `OCPPIdentity` — no Circuit
  rewiring.
- The `withOrgContext` tenant-boundary pattern stays.

## Consequences

### Positive

- Pilot operators can name and group chargers by circuit. Real
  electrical-engineering reality lands in the schema.
- Zaptec-style "circuit ceiling" data has a place to live. Future
  vendor adapters that expose circuit info (Easee, Kempower DC
  cabinets) populate the same column.
- Future load-balancing logic (post-pilot) doesn't need a schema
  re-shape; the field is there waiting.
- Reverses the V3-vs-CPMS divergence on this one entity, easing
  knowledge transfer for anyone who learned the CPMS shape.

### Negative

- One more table, one more relation. Slightly more SQL in queries
  that walk the hierarchy.
- One more admin CRUD page (Sprint 2.6) and one more wizard step
  in charger onboarding.
- ADR 0001 (V3 foundation schema) and ADR 0002 (hardware catalog)
  both pre-date this. Their non-goal sections used "Circuit deferred"
  language. Updating those would be revisionism — leave them and let
  this ADR be the authoritative reversal.

### Neutral

- ER diagram (`docs/architecture/entity_relationships.svg`) needs an
  update to show Circuit between Installation and SiteAsset. Tracked
  as a follow-up to the Sprint 2.6 schema migration commit.
- The architecture canon's §4 (hierarchy) is updated alongside this
  ADR.

## Alternatives considered

**Keep V3 flat, model circuits as a JSONB blob on Site.** Rejected —
queryability evaporates; "show me all chargers on circuit X" becomes
a JSON path query instead of an indexed FK lookup.

**Model circuits only on Zaptec-managed installations (denormalized
into hardware catalog).** Rejected — works for Zaptec, doesn't
generalize to manually-wired sites or non-Zaptec hardware that the
operator wants to circuit-group anyway.

**Wait for post-pilot to add Circuit when load-balancing actually
needs it.** Rejected — the operator named it as a pilot need; the
ADR cost of adding it now is small; the cost of adding it later is
schema migration on a populated database, much higher.

## References

- [`STRAUMVAKT_ARCHITECTURE_V3.md`](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) §4 — asset hierarchy
- [`STRAUMVAKT_V3_DELIVERY_PLAN.md`](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md) — Sprint 2 milestone 2.6
- [`docs/adr/0001-v3-foundation-schema.md`](./0001-v3-foundation-schema.md) — original V3 schema (pre-Circuit)
- [`docs/adr/0002-hardware-catalog-and-installations.md`](./0002-hardware-catalog-and-installations.md) — Installation tier, also-optional pattern
- [`docs/adr/0006-pilot-scope-rev2-2026-04-25.md`](./0006-pilot-scope-rev2-2026-04-25.md) — Sprint structure that schedules the migration
