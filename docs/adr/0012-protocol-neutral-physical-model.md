# ADR 0012 — Protocol-Neutral Physical Model + Control Attachments

**Status:** Accepted
**Date:** 2026-04-26
**Operator approval:** "proceed" — all proposed answers to the
six open questions accepted in the same session as ADR draft.
**Sprint:** Sprint 2 — schema lands inside the consolidated rev-3
foundation migration as Branch A per the post-rev-5 action list.
**Implements:** [ADR 0011](./0011-control-plane-optionality.md) Phase 3.
**Rollback anchor:** `pre-control-plane-optionality-2026-04-26` (must
exist on `origin` before this migration applies).

## Context

ADR 0011 accepted that Straumvakt is protocol-neutral. The rev-4
schema still encodes an OCPP-first hierarchy:

```text
assets.chargers ─► ocpp.ocpp_identities ─► ocpp.connectors
                                              ▲
charging.sessions ──────────────────────────────┘  (also chargerId, ocppIdentityId)
```

That shape conflates three distinct concerns:

1. **The physical equipment** — the box on the wall, the supply
   units inside it, the sockets on its face.
2. **The control endpoint** — the OCPP identity, OEM API resource ref,
   or external CPMS asset ref that lets us send commands and receive
   data.
3. **The session identity** — the protocol-side transaction ID, vendor
   session ID, or imported CDR reference.

Rev-4 collapses (1) and (2) into the same hierarchy. This ADR splits
them.

The pilot has **zero data** in `assets.chargers`, `ocpp.ocpp_identities`,
`ocpp.connectors`, or `charging.sessions` right now. The migration
cost of getting the physical model right is paid once now versus paid
forever as data migration tax later.

## Decision

### Physical model

Three new tables in the `assets` schema:

```text
assets.charging_stations  ◄─ rename of assets.chargers (was the physical box)
assets.evses              ◄─ NEW. Electric Vehicle Supply Equipment unit.
assets.connectors         ◄─ moved from ocpp.connectors. Anchors on EVSE.
```

`ChargingStation` matches OCPP 2.0.1 terminology. For an OCPP 1.6
charge point with N connectors, the canonical mapping is **one
ChargingStation, one EVSE per connector** (1.6 has no EVSE concept,
so each connector_id becomes its own EVSE for forward compatibility).
For 2.0.1 stations, the mapping is direct.

### Control attachments

Five optional attachment tables. A station may have any combination
of these; absence of all of them = read-only intelligence mode.

| Table | Schema | Anchors on | Purpose |
|---|---|---|---|
| `ocpp_identities` | `ocpp` | ChargingStation | Native OCPP control endpoint. Existing table; FK retargeted. |
| `vendor_asset_refs` | `vendors` | ChargingStation | OEM API control attachment (Easee, Zaptec). Holds vendor's resource ID + credentials_ref. |
| `external_cpms_refs` | `roaming` | ChargingStation | Overlay mode. Holds external CPMS ID + their asset ID + sync state. |
| `capability_profiles` | `assets` | ChargingStation | Declares which capabilities (authorize / start / stop / unlock / reset / config-read / session-history) this station supports through which control plane. |
| `control_routing_policies` | `assets` | ChargingStation | Per-action routing: `authorize → ocpp`, `start → vendor:easee`, `unlock → ocpp`, etc. Resolved at command-dispatch time. |

### Session anchoring

`charging.sessions` retargets:

- **Primary FK becomes `evseId`**, not `chargerId` or `ocppIdentityId`.
- `chargingStationId` kept as denormalized convenience (cheap
  station-level rollups).
- `ocppIdentityId` retained but **nullable** — overlay/imported
  sessions don't have one.
- `connectorId` retained for sub-EVSE granularity (CCS+Type2 combo
  EVSEs).

Two new sibling tables capture protocol-side identity:

```text
charging.protocol_transaction_refs  ◄─ (sessionId, sourceKind, sourceId)
                                       sourceKind ∈ {ocpp_1_6, ocpp_2_0_1, vendor_easee, vendor_zaptec, ...}
                                       sourceId = the foreign system's transaction/session id

charging.imported_cdr_refs          ◄─ (sessionId, sourceKind, sourceCdrId, importedAt)
                                       sourceKind ∈ {external_cpms, vendor_export, ocpi_cdr, ...}
```

A native-OCPP session has one row in `protocol_transaction_refs` with
`sourceKind=ocpp_1_6`. An imported session has one row in
`imported_cdr_refs` and zero rows in `protocol_transaction_refs`.

## Proposed Prisma models

### assets.ChargingStation (rename of Charger)

```prisma
model ChargingStation {
  // Renamed from Charger. Same UUID, same FK-from-SiteAsset shape.
  siteAssetId      String        @id @map("site_asset_id") @db.Uuid
  orgId            String        @map("org_id") @db.Uuid
  modelId          String?       @map("model_id") @db.Uuid
  installationId   String?       @map("installation_id") @db.Uuid
  circuitId        String?       @map("circuit_id") @db.Uuid
  ownerOrgId       String?       @map("owner_org_id") @db.Uuid
  chrgrfTariffId   String?       @map("chrgrf_tariff_id") @db.Uuid

  vendor           String?
  model            String?
  serialNumber     String?       @map("serial_number")
  installDate      DateTime?     @map("install_date") @db.Date
  warrantyExpires  DateTime?     @map("warranty_expires") @db.Date
  firmwareVersion  String?       @map("firmware_version")

  createdAt        DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  siteAsset        SiteAsset     @relation(fields: [siteAssetId], references: [id], onDelete: Cascade)
  organization     Organization  @relation("StationOperator", fields: [orgId], references: [id])
  ownerOrg         Organization? @relation("StationOwner", fields: [ownerOrgId], references: [id])
  hardwareModel    HardwareModel? @relation(fields: [modelId], references: [id])
  installation     Installation? @relation(fields: [installationId], references: [id])
  circuit          Circuit?      @relation("CircuitStations", fields: [circuitId], references: [id])
  chrgrfTariff     TariffDefinition? @relation("StationChrgrfTariff", fields: [chrgrfTariffId], references: [id])

  evses            EVSE[]
  ocppIdentities   OcppIdentity[]
  vendorAssetRefs  VendorAssetRef[]
  externalCpmsRefs ExternalCpmsRef[]
  capabilityProfiles    CapabilityProfile[]
  controlRoutingPolicies ControlRoutingPolicy[]

  @@map("charging_stations")
  @@schema("assets")
}
```

### assets.EVSE (NEW)

```prisma
model EVSE {
  id                    String   @id @default(uuid()) @db.Uuid
  orgId                 String   @map("org_id") @db.Uuid
  chargingStationId     String   @map("charging_station_id") @db.Uuid
  evseIndex             Int      @map("evse_index")              // 1..N within the station
  maxPowerKw            Decimal? @map("max_power_kw") @db.Decimal(8, 2)
  phaseCount            Int?     @map("phase_count")
  status                String   @default("unknown")              // available / occupied / faulted / unavailable / reserved
  statusUpdatedAt       DateTime? @map("status_updated_at") @db.Timestamptz(6)
  createdAt             DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt             DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization          Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chargingStation       ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId], onDelete: Cascade)
  connectors            Connector[]
  sessions              ChargeSession[]

  @@unique([chargingStationId, evseIndex])
  @@index([orgId, status])
  @@map("evses")
  @@schema("assets")
}
```

### assets.Connector (moved from ocpp.connectors)

```prisma
model Connector {
  id              String          @id @default(uuid()) @db.Uuid
  orgId           String          @map("org_id") @db.Uuid
  evseId          String          @map("evse_id") @db.Uuid
  connectorIndex  Int             @map("connector_index")
  type            String                                          // Type2 / CCS2 / CHAdeMO / Schuko
  maxPowerKw      Decimal?        @map("max_power_kw") @db.Decimal(8, 2)
  status          String          @default("unknown")
  statusUpdatedAt DateTime?       @map("status_updated_at") @db.Timestamptz(6)
  createdAt       DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization    Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  evse            EVSE            @relation(fields: [evseId], references: [id], onDelete: Cascade)
  sessions        ChargeSession[]
  reservations    Reservation[]

  @@unique([evseId, connectorIndex])
  @@index([orgId])
  @@map("connectors")
  @@schema("assets")
}
```

### ocpp.OcppIdentity (FK retargeted)

```prisma
model OcppIdentity {
  id                String      @id @default(uuid()) @db.Uuid
  orgId             String      @map("org_id") @db.Uuid
  chargingStationId String      @map("charging_station_id") @db.Uuid   // ← was charger_id
  identityString    String      @map("identity_string")
  authSecretHash    String      @map("auth_secret_hash")
  ocppVersion       OcppVersion @map("ocpp_version")
  // ...all other existing columns unchanged...

  organization      Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chargingStation   ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId], onDelete: Cascade)
  outboundCommands  OutboundCommand[]
  configurationKeys OcppConfigurationKey[]
  // connectors[] relation REMOVED — connectors no longer anchor on identity
  // sessions[] relation REMOVED — sessions anchor on EVSE; protocol ref is in protocol_transaction_refs

  @@unique([orgId, identityString])
  @@index([orgId, chargingStationId])
  @@map("ocpp_identities")
  @@schema("ocpp")
}
```

### vendors.VendorAssetRef (NEW)

```prisma
model VendorAssetRef {
  id                  String   @id @default(uuid()) @db.Uuid
  orgId               String   @map("org_id") @db.Uuid
  chargingStationId   String   @map("charging_station_id") @db.Uuid
  vendorSlug          String   @map("vendor_slug")                       // 'easee' / 'zaptec' / 'monta'
  vendorAssetId       String   @map("vendor_asset_id")                   // the resource ID in the vendor's API
  credentialsRef      String?  @map("credentials_ref")                   // KV key for OAuth tokens or API credentials
  capabilities        Json     @default("{}") @db.JsonB                  // declared API capabilities snapshot
  status              String   @default("pending")                       // pending / active / revoked / failed
  lastSyncedAt        DateTime? @map("last_synced_at") @db.Timestamptz(6)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization        Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chargingStation     ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId], onDelete: Cascade)

  @@unique([vendorSlug, vendorAssetId])
  @@index([orgId, vendorSlug])
  @@map("vendor_asset_refs")
  @@schema("vendors")
}
```

### roaming.ExternalCpmsRef (NEW)

```prisma
model ExternalCpmsRef {
  id                  String   @id @default(uuid()) @db.Uuid
  orgId               String   @map("org_id") @db.Uuid
  chargingStationId   String   @map("charging_station_id") @db.Uuid
  externalCpmsSlug    String   @map("external_cpms_slug")    // 'driivz' / 'monta-cpms' / 'iz-evis' / etc.
  externalAssetId     String   @map("external_asset_id")     // their station ID
  importMode          String   @map("import_mode")            // 'sessions_only' / 'sessions_and_status' / 'full'
  credentialsRef      String?  @map("credentials_ref")
  status              String   @default("pending")
  lastImportedAt      DateTime? @map("last_imported_at") @db.Timestamptz(6)
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization        Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chargingStation     ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId], onDelete: Cascade)

  @@unique([externalCpmsSlug, externalAssetId])
  @@index([orgId])
  @@map("external_cpms_refs")
  @@schema("roaming")
}
```

### assets.CapabilityProfile (NEW)

```prisma
model CapabilityProfile {
  id                 String   @id @default(uuid()) @db.Uuid
  orgId              String   @map("org_id") @db.Uuid
  chargingStationId  String   @map("charging_station_id") @db.Uuid
  controlPlane       String   @map("control_plane")               // 'ocpp' / 'vendor:easee' / 'vendor:zaptec' / 'external_cpms:<slug>'
  capabilities       Json     @db.JsonB                            // {authorize:true, start:true, stop:true, unlock:false, reset:true, config_read:true, config_write:true, session_history:true}
  source             String                                        // 'declared' / 'observed' / 'imported'
  observedAt         DateTime? @map("observed_at") @db.Timestamptz(6)
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization       Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chargingStation    ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId], onDelete: Cascade)

  @@unique([chargingStationId, controlPlane])
  @@map("capability_profiles")
  @@schema("assets")
}
```

### assets.ControlRoutingPolicy (NEW)

```prisma
model ControlRoutingPolicy {
  id                 String   @id @default(uuid()) @db.Uuid
  orgId              String   @map("org_id") @db.Uuid
  chargingStationId  String   @map("charging_station_id") @db.Uuid
  routing            Json     @db.JsonB
                              // { authorize: 'ocpp',
                              //   start: 'vendor:easee',
                              //   stop: 'vendor:easee',
                              //   unlock: 'ocpp',
                              //   reset: 'ocpp',
                              //   config_read: 'ocpp',
                              //   config_write: 'ocpp',
                              //   session_history: 'vendor:easee' }
  fallback           String?  @map("fallback_plane")               // 'ocpp' / null = no fallback
  status             String   @default("active")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization       Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chargingStation    ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId], onDelete: Cascade)

  @@unique([chargingStationId])
  @@map("control_routing_policies")
  @@schema("assets")
}
```

### charging.ChargeSession (FK retargeted)

```prisma
model ChargeSession {
  id                String        @id @default(uuid()) @db.Uuid
  orgId             String        @map("org_id") @db.Uuid
  siteId            String        @map("site_id") @db.Uuid
  chargingStationId String        @map("charging_station_id") @db.Uuid    // ← was charger_id
  evseId            String        @map("evse_id") @db.Uuid                 // ← NEW primary anchor
  connectorId       String?       @map("connector_id") @db.Uuid            // ← now nullable
  ocppIdentityId    String?       @map("ocpp_identity_id") @db.Uuid        // ← now nullable (overlay sessions)
  userId            String?       @map("user_id") @db.Uuid
  idTag             String?       @map("id_tag")
  startedAt         DateTime      @map("started_at") @db.Timestamptz(6)
  endedAt           DateTime?     @map("ended_at") @db.Timestamptz(6)
  energyWh          BigInt?       @map("energy_wh")
  stopReason        String?       @map("stop_reason")
  status            SessionStatus @default(in_progress)
  costExVatMinor    BigInt?       @map("cost_ex_vat_minor")
  costIncVatMinor   BigInt?       @map("cost_inc_vat_minor")
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization      Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  site              Site            @relation(fields: [siteId], references: [id])
  chargingStation   ChargingStation @relation(fields: [chargingStationId], references: [siteAssetId])
  evse              EVSE            @relation(fields: [evseId], references: [id])
  connector         Connector?      @relation(fields: [connectorId], references: [id])
  ocppIdentity      OcppIdentity?   @relation(fields: [ocppIdentityId], references: [id])
  user              User?           @relation(fields: [userId], references: [id])
  meterValues       MeterValue[]
  billingLines     BillingLine[]
  protocolTransactionRefs ProtocolTransactionRef[]
  importedCdrRefs   ImportedCdrRef[]

  @@index([orgId, startedAt(sort: Desc)])
  @@index([evseId, startedAt(sort: Desc)])
  @@index([userId, startedAt(sort: Desc)])
  @@map("sessions")
  @@schema("charging")
}
```

### charging.ProtocolTransactionRef (NEW)

```prisma
model ProtocolTransactionRef {
  id           String   @id @default(uuid()) @db.Uuid
  orgId        String   @map("org_id") @db.Uuid
  sessionId    String   @map("session_id") @db.Uuid
  sourceKind   String   @map("source_kind")     // 'ocpp_1_6' / 'ocpp_2_0_1' / 'vendor:easee' / 'vendor:zaptec'
  sourceId     String   @map("source_id")       // OCPP transactionId (int as string), vendor session UUID, etc.
  metadata     Json     @default("{}") @db.JsonB
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  organization Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  session      ChargeSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sourceKind, sourceId])
  @@index([sessionId])
  @@map("protocol_transaction_refs")
  @@schema("charging")
}
```

### charging.ImportedCdrRef (NEW)

```prisma
model ImportedCdrRef {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @map("org_id") @db.Uuid
  sessionId     String   @map("session_id") @db.Uuid
  sourceKind    String   @map("source_kind")    // 'external_cpms:<slug>' / 'ocpi_cdr' / 'vendor_export:<slug>'
  sourceCdrId   String   @map("source_cdr_id")
  importedAt    DateTime @map("imported_at") @db.Timestamptz(6)
  rawPayload    Json?    @map("raw_payload") @db.JsonB
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  organization Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  session      ChargeSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@unique([sourceKind, sourceCdrId])
  @@index([sessionId])
  @@map("imported_cdr_refs")
  @@schema("charging")
}
```

## Migration plan

The consolidated rev-3 foundation migration at
`prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql`
gets **extended in place**, not replaced. Because pilot has zero data,
the destructive moves are safe.

In migration order:

1. **Create new tables** — `assets.evses`, `assets.connectors`,
   `vendors.vendor_asset_refs`, `roaming.external_cpms_refs`,
   `assets.capability_profiles`, `assets.control_routing_policies`,
   `charging.protocol_transaction_refs`, `charging.imported_cdr_refs`.
2. **Drop old `ocpp.connectors`** — no rows to migrate. The new
   `assets.connectors` supersedes it.
3. **Rename `assets.chargers` → `assets.charging_stations`** —
   single `ALTER TABLE assets.chargers RENAME TO charging_stations`.
   Recreate FKs that reference it under the new name.
4. **Retarget FKs** — `ocpp.ocpp_identities.charger_id` →
   `charging_station_id`; `charging.sessions.charger_id` →
   `charging_station_id`; add `evse_id`; make `connector_id` and
   `ocpp_identity_id` nullable.
5. **Drop unused JSONB fields on OcppIdentity** — `capabilities` and
   `controlRouting` become first-class tables; the JSONB fields are
   removed (the data they would have held now lives in
   `capability_profiles` / `control_routing_policies`).

Any pre-pilot code that references `Charger`, `Charger.id`, or
`ocpp.connectors` updates to the new names in the same commit as the
migration.

## Open questions for operator

These are the design choices that aren't obvious enough to make
without confirmation. **None** of these block migration design — but
they affect the shape that lands.

1. **Naming: keep "Charger" or rename to "ChargingStation"?** OCPP
   2.0.1 is "ChargingStation". This ADR proposes the rename. Leaving
   "Charger" in place is also defensible.
2. **EVSE granularity for OCPP 1.6 chargers.** Proposed: one EVSE per
   connector. Alternative: one EVSE per electrical group when a
   station has multiple connectors sharing one circuit. The
   alternative needs hardware metadata we don't have at onboarding
   time, so the proposal is the simpler default.
3. **CapabilityProfile per control plane vs unified.** Proposed:
   one row per (station, control_plane). Alternative: one row per
   station with all planes in JSONB. Per-plane rows make
   query-and-update cleaner.
4. **VendorAssetRef cardinality.** Proposed: one ref per (station,
   vendor). Allowing multiple per station would be needed if a
   single physical station has two distinct vendor identities (rare
   — only if a station is integrated with two OEM APIs at once).
5. **ProtocolTransactionRef vs columns on session.** Proposed:
   separate table. Allows zero-or-many; supports OCPP-stop-then-
   vendor-imported-CDR cases where one session has two protocol
   refs. Columns-on-session would be simpler but lossy.
6. **Drop `ocpp.OcppIdentity.capabilities` JSONB?** Proposed yes —
   superseded by `assets.capability_profiles` rows where
   `controlPlane='ocpp'`. Retaining the JSONB creates a duplicate
   source of truth.

## Operating mode impact

- **Native OCPP:** ChargingStation + EVSE + Connector + OcppIdentity +
  CapabilityProfile{controlPlane:'ocpp'} + ControlRoutingPolicy
  routing all actions to OCPP. Existing Sprint 1.4 gateway
  unchanged in behavior; FK names update.
- **OEM API control (Easee/Zaptec):** ChargingStation + EVSE +
  Connector + VendorAssetRef + CapabilityProfile{controlPlane:'vendor:easee'}.
  No OcppIdentity required when API can do auth/start/stop.
- **Hybrid:** ChargingStation + both OcppIdentity AND VendorAssetRef.
  ControlRoutingPolicy resolves per action.
- **External CPMS overlay:** ChargingStation + EVSE + Connector +
  ExternalCpmsRef. Sessions arrive via ImportedCdrRef. No
  OcppIdentity, no VendorAssetRef.
- **Read-only intelligence:** ChargingStation + EVSE + Connector +
  ImportedCdrRef on sessions. No control plane.

The pilot rule from ADR 0011 holds: demonstrate at least two of
these shapes in the same operating model.

## Consequences

### Positive

- Physical and control concerns separated cleanly.
- Pilot data lands on the canonical model from row one.
- OCPI translation later becomes mechanical — both `vendor_asset_refs`
  and `external_cpms_refs` already model the source-system fields.
- Session imports stop needing fake OcppIdentity rows.

### Negative

- One bigger migration. ~10 new tables, 1 rename, ~5 FK retargets,
  3 column drops on OcppIdentity.
- Repository + mapper layer for any pre-existing Charger/Connector
  reference updates in the same commit. Manageable scope (no
  production data; rev-4 admin UI hasn't shipped to staging).

### Neutral

- ADRs 0001 / 0002 / 0004 / 0011 references in canon docs need a
  one-line "as implemented by ADR 0012" footnote in milestone 2.15
  close-out.
- SVG regen at milestone 2.6 / 2.15 reflects the new shape.

## Alternatives considered

**Land as a follow-up migration (Branch B from action list).**
Rejected: would need to either gate Sprint 2 milestone 2.5 on the
follow-up, or accept that pilot data starts on the wrong model.

**Keep `assets.chargers` name and add tables alongside.** Rejected:
the rename is part of the conceptual fix. Half-renaming is worse
than either renaming fully or not at all.

**Put control-plane policy/capability tables in a new `control`
schema.** Rejected: they describe **station-level** policy. Living
in `assets` keeps the FK chain shallow and the schema list shorter.

**Use a single polymorphic `control_attachments` table.** Rejected:
JSONB-per-row hides type information at query time. Three typed
tables (`ocpp_identities`, `vendor_asset_refs`, `external_cpms_refs`)
preserve type-safety in Prisma client and indexes.

## References

- [ADR 0011 — Control-Plane Optionality](./0011-control-plane-optionality.md) — the parent decision.
- [STRAUMVAKT_ARCHITECTURE_V3.md §4](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) — hierarchy diagram needs amendment block update.
- [SPRINT_02_TASKS.md milestone 2.15](../sprints/SPRINT_02_TASKS.md) — design close-out gate this ADR fulfills.
- [post-rev-5 action list](../notes/2026-04-26-post-rev5-actions.md) Branch A path.
