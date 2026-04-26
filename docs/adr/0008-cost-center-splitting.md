# ADR 0008 — Cost-Center Splitting + Inherited Contracts + Runtime Cost-Factor Catalog + Driver-Contract Routing

**Status:** Accepted
**Date:** 2026-04-26
**Sprint:** schema lands in Sprint 2 milestone 2.6 (consolidated with Circuit migration); resolver + dashboards across Sprints 5–6
**Supporting material:** [`cost_center_splitting_model.svg`](../architecture/cost_center_splitting_model.svg)
**Rollback anchor:** `pilot-rescope-rev2-2026-04-25` (state immediately before this ADR)

---

## Context

The pilot must split charging session cost across multiple cost
centers based on agreements. Two named pilot operators have
materially different patterns:

- **Krónan** (workplace operator) absorbs every cost factor on its
  workplace sites — driver pays zero. Krónan's employees may charge
  at non-Krónan sites with workplace coverage routed through their
  driver contract.
- **N1** (public-station operator) splits cost: drivers pay the DSO
  tariff and idle fees; N1 absorbs the retailer + service fees.

The earlier rev 2 commercial model (`billing.customer_plans` +
`hosts.charger_service_plans`) treats "who pays" as conflated with
`org_id` — a single tenant boundary covering the operator AND the
payer AND (implicitly) the hardware owner. That works for a single-Org
charge but breaks for the cases above where:

1. **Ownership ≠ operation ≠ payment.** A charger may be physically
   owned by N1, operated at a Krónan workplace site (because N1
   leases hardware to Krónan), and paid for by Krónan workplace via
   the driver's workplace contract — three different Orgs touching
   the same row.
2. **Cost factors anchor at different hierarchy tiers.** DSOF is
   site-level (one DSO per geographical grid connection); REPF is
   installation-level (a site can have multiple installations under
   different retailer contracts); CHRGRF is charger-level (per-unit
   rental fee); WRKPF is driver-contract-level (Straumvakt's service
   fee for handling workplace routing).
3. **Cost factors are not a closed enum.** Straumvakt platform staff
   need to add new factors over time without a schema migration.
4. **Driver contracts override factor allocation per session,** with
   support for caps measured per calendar month (e.g. "Krónan covers
   REPF up to 200 kWh/employee/month, overflow to driver").
5. **Issue Engine must route service tickets to the hardware owner,**
   not the operator. When the leased N1 charger at the Krónan
   workplace breaks, N1's service team gets the ticket — even
   though Krónan operates the site.

The Issue Engine is post-pilot per ADR 0006 (tag D), but the
`owner_org_id` column it reads must land in pilot's schema.

## Decision

Add a **runtime cost-factor catalog** + **per-tier inherited contracts**
+ **driver-contracts with factor-level overrides** + **per-period
accumulators** to V3's billing schema. Additive migration ships in
Sprint 2 milestone 2.6 alongside the Circuit migration (ADR 0007),
under one combined Prisma migration named
`<timestamp>_add_circuit_and_billing_contracts`.

### 1. Cost factor catalog (runtime, platform-admin-managed)

```prisma
model CostFactor {
  id                  String              @id @default(uuid()) @db.Uuid
  code                String              @unique // DSOF, REPF, USRF, USRF_PREM, XTRRF, SPVIVF, CHRGRF, WRKPF, ...
  displayName         String              @map("display_name")
  description         String?
  anchorTier          CostFactorAnchor    @map("anchor_tier")
  defaultVatRatePct   Decimal             @map("default_vat_rate_pct") @db.Decimal(4, 2)
  defaultCurrency     String              @map("default_currency") @default("ISK")
  status              CostFactorStatus    @default(active)
  createdAt           DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  tariffDefinitions   TariffDefinition[]

  @@map("cost_factors")
  @@schema("billing")
}

enum CostFactorAnchor {
  org
  host
  property
  site
  installation
  charger
  driver_contract

  @@schema("billing")
}

enum CostFactorStatus {
  draft
  active
  archived

  @@schema("billing")
}
```

Pilot seeds eight rows with `status = active`:

| code | anchor_tier | shape (compute_rule kind) |
|---|---|---|
| DSOF | site | per-kWh / tou_per_kwh |
| REPF | installation | per-kWh / tou_per_kwh |
| USRF | site | per_session_flat |
| USRF_PREM | site | per_session_flat |
| XTRRF | site | per_minute_after_minutes |
| SPVIVF | site | per_session_flat / per_kwh |
| CHRGRF | charger | per_session_flat / per_calendar_month_flat / per_day_flat |
| WRKPF | driver_contract | open DSL — flat / per-kWh / percent / ToU |

Adding a 9th factor post-pilot is a single `INSERT INTO cost_factors`
plus admin-UI step for Orgs to configure tariff_definitions for that
factor. Zero migration. Catalog managed only by Straumvakt platform
staff (see §6 below).

### 2. Tariff definitions (rates, anchored at the entity that holds the contract)

```prisma
model TariffDefinition {
  id              String           @id @default(uuid()) @db.Uuid
  orgId           String           @map("org_id") @db.Uuid
  costFactorId    String           @map("cost_factor_id") @db.Uuid
  displayName     String           @map("display_name")
  computeRule     Json             @map("compute_rule") @db.JsonB
  vatRatePct      Decimal          @map("vat_rate_pct") @db.Decimal(4, 2)
  currency        String           @default("ISK")
  validFrom       DateTime         @map("valid_from") @db.Timestamptz(6)
  validUntil      DateTime?        @map("valid_until") @db.Timestamptz(6)
  status          String           @default("active")
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization    Organization     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  costFactor      CostFactor       @relation(fields: [costFactorId], references: [id])

  @@index([orgId, costFactorId, validFrom])
  @@map("tariff_definitions")
  @@schema("billing")
}
```

`compute_rule` is a JSONB DSL evaluated by the tariff engine. Pilot
shapes:

```json
// per-kWh flat
{"type": "per_kwh", "rate_minor": 1500}

// per-kWh ToU bands
{"type": "tou_per_kwh", "bands": [
  {"days": "mon-fri", "from": "07:00", "to": "19:00", "rate_minor": 1250},
  {"days": "*", "rate_minor": 800}
]}

// per-session flat
{"type": "per_session_flat", "amount_minor": 5000}

// per-minute after threshold (idle fees)
{"type": "per_minute_after_minutes", "after_minutes": 30, "rate_minor": 100}

// percent of other factors (WRKPF derivative case)
{"type": "percent_of_factors", "of": ["DSOF", "REPF"], "percent": 100.0}

// charger rental — calendar-month flat (slice per session via accumulator)
{"type": "per_calendar_month_flat", "amount_minor": 30000}
```

Anchor entities gain optional FKs to tariff_definitions:

```prisma
model Site {
  // existing columns…
  dsoTariffId        String?           @map("dso_tariff_id") @db.Uuid
  usrfTariffId       String?           @map("usrf_tariff_id") @db.Uuid
  usrfPremTariffId   String?           @map("usrf_prem_tariff_id") @db.Uuid
  xtrrfTariffId      String?           @map("xtrrf_tariff_id") @db.Uuid
  spvivfTariffId     String?           @map("spvivf_tariff_id") @db.Uuid
  // FKs enforced in app code: factor_code must match column intent
}

model Installation {
  // existing columns…
  retailerTariffId   String?           @map("retailer_tariff_id") @db.Uuid
}

model Charger {
  // existing columns…
  ownerOrgId         String?           @map("owner_org_id") @db.Uuid
  chrgrfTariffId    String?           @map("chrgrf_tariff_id") @db.Uuid
  // owner_org_id default in app code = org_id (operator). When set
  // explicitly, hardware owner differs from operator. Issue Engine
  // post-pilot reads this for service-ticket routing.
}

model DriverContract {
  // see §4 below
  wrkpfTariffId      String?           @map("wrkpf_tariff_id") @db.Uuid
}
```

### 3. Cost centers (payers + beneficiaries)

```prisma
model CostCenter {
  id                  String       @id @default(uuid()) @db.Uuid
  orgId               String       @map("org_id") @db.Uuid
  code                String                                  // unique per org, e.g. KRONAN_WORKPLACE
  displayName         String       @map("display_name")
  payerOrgId          String?      @map("payer_org_id") @db.Uuid
  payerUserId         String?      @map("payer_user_id") @db.Uuid
  beneficiaryOrgId    String?      @map("beneficiary_org_id") @db.Uuid // for inter-org transfers (e.g. CHRGRF → owner)
  status              String       @default("active")
  createdAt           DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime     @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization        Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, code])
  @@map("cost_centers")
  @@schema("billing")
}
```

- Both `payer_org_id` and `payer_user_id` null → driver of the
  session pays (the anonymous-driver case at public sites).
- Exactly one set → that entity pays.
- `beneficiary_org_id` is populated when money should eventually flow
  to a different Org than the payer (e.g. Krónan covers a charger
  rental whose hardware owner is N1; payer = Krónan, beneficiary =
  N1). Pilot displays this on dashboards but does NOT settle —
  inter-org settlement is post-pilot per ADR 0005 (tag F).

### 4. Contracts (per-tier, inherited)

```prisma
model Contract {
  id                  String                    @id @default(uuid()) @db.Uuid
  orgId               String                    @map("org_id") @db.Uuid
  scopeType           ContractScopeType         @map("scope_type")
  scopeId             String?                   @map("scope_id") @db.Uuid
  parentContractId    String?                   @map("parent_contract_id") @db.Uuid
  displayName         String                    @map("display_name")
  status              ContractStatus            @default(pending_configuration)
  validFrom           DateTime                  @map("valid_from") @db.Timestamptz(6)
  validUntil          DateTime?                 @map("valid_until") @db.Timestamptz(6)
  createdAt           DateTime                  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime                  @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization        Organization              @relation(fields: [orgId], references: [id], onDelete: Cascade)
  parent              Contract?                 @relation("ContractInheritance", fields: [parentContractId], references: [id])
  children            Contract[]                @relation("ContractInheritance")
  assignments         ContractFactorAssignment[]

  @@index([orgId, scopeType, scopeId])
  @@map("contracts")
  @@schema("billing")
}

enum ContractScopeType {
  org
  host
  property
  site
  installation
  charger

  @@schema("billing")
}

enum ContractStatus {
  pending_configuration
  active
  superseded
  archived

  @@schema("billing")
}

model ContractFactorAssignment {
  id                  String         @id @default(uuid()) @db.Uuid
  contractId          String         @map("contract_id") @db.Uuid
  costFactorId        String         @map("cost_factor_id") @db.Uuid
  costCenterId        String         @map("cost_center_id") @db.Uuid
  allocationRule      Json           @map("allocation_rule") @db.JsonB
  priority            Int            @default(0)
  validFrom           DateTime       @map("valid_from") @db.Timestamptz(6)
  validUntil          DateTime?      @map("valid_until") @db.Timestamptz(6)

  contract            Contract       @relation(fields: [contractId], references: [id], onDelete: Cascade)
  costFactor          CostFactor     @relation(fields: [costFactorId], references: [id])
  costCenter          CostCenter     @relation(fields: [costCenterId], references: [id])

  @@index([contractId, costFactorId, priority])
  @@map("contract_factor_assignments")
  @@schema("billing")
}
```

`allocation_rule` shapes:

```json
{"type": "all"}                                      // 100% to this cost center
{"type": "percent", "value": 30.00}                  // 30% slice
{"type": "flat_minor_ex_vat", "amount_minor": 5000}  // first 50 ISK ex-VAT slice
{"type": "kwh_cap", "cap_kwh": 200, "period": "calendar_month"}  // up to 200 kWh per month
```

Multiple assignments for the same `(contract, factor)` stack by
priority — the resolver allocates priority-0 first, then priority-1
catches what's left, etc., until the factor is fully allocated.

**Auto-create root contract on Org creation.** When admin creates a
new Org (Sprint 2.1), the platform auto-creates a root `Contract`
with `scope_type=org`, `scope_id=null`, `parent_contract_id=null`,
`status=pending_configuration`. Resolver blocks any session-stop on
that Org with a clear "contracts not configured" error until admin
adds factor assignments.

### 5. Driver contracts + factor overrides

```prisma
model DriverContract {
  id                  String                          @id @default(uuid()) @db.Uuid
  orgId               String                          @map("org_id") @db.Uuid
  userId              String                          @map("user_id") @db.Uuid
  scopeType           ContractScopeType?              @map("scope_type")  // nullable = global (any site)
  scopeId             String?                         @map("scope_id") @db.Uuid
  parentContractId    String?                         @map("parent_contract_id") @db.Uuid
  ownerType           DriverContractOwnerType         @map("owner_type")
  ownerId             String                          @map("owner_id") @db.Uuid // org_id (workplace), family_group_id, or user_id (self)
  wrkpfTariffId       String?                         @map("wrkpf_tariff_id") @db.Uuid
  displayName         String                          @map("display_name")
  status              ContractStatus                  @default(pending_configuration)
  validFrom           DateTime                        @map("valid_from") @db.Timestamptz(6)
  validUntil          DateTime?                       @map("valid_until") @db.Timestamptz(6)

  organization        Organization                    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user                User                            @relation(fields: [userId], references: [id], onDelete: Cascade)
  parent              DriverContract?                 @relation("DriverContractInheritance", fields: [parentContractId], references: [id])
  children            DriverContract[]                @relation("DriverContractInheritance")
  overrides           DriverContractFactorOverride[]

  @@index([orgId, userId, validFrom])
  @@map("driver_contracts")
  @@schema("billing")
}

enum DriverContractOwnerType {
  workplace
  family_group
  self

  @@schema("billing")
}

model DriverContractFactorOverride {
  id                  String          @id @default(uuid()) @db.Uuid
  driverContractId    String          @map("driver_contract_id") @db.Uuid
  costFactorId        String          @map("cost_factor_id") @db.Uuid
  costCenterId        String          @map("cost_center_id") @db.Uuid
  allocationRule      Json            @map("allocation_rule") @db.JsonB
  priority            Int             @default(0)
  scopeType           ContractScopeType? @map("scope_type")
  scopeId             String?            @map("scope_id") @db.Uuid

  driverContract      DriverContract  @relation(fields: [driverContractId], references: [id], onDelete: Cascade)
  costFactor          CostFactor      @relation(fields: [costFactorId], references: [id])
  costCenter          CostCenter      @relation(fields: [costCenterId], references: [id])

  @@index([driverContractId, costFactorId, priority])
  @@map("driver_contract_factor_overrides")
  @@schema("billing")
}
```

Driver-contract overrides win over the resolved `Contract` chain at
the matched scope. Family-member contracts can inherit from the
family-group contract via `parent_contract_id`.

When an active `DriverContract` has `owner_type=workplace` AND
`wrkpf_tariff_id IS NOT NULL`, the resolver also emits a WRKPF line
for the session — Straumvakt's service fee for handling workplace
routing, billed to a workplace cost center designated in the
contract's overrides.

### 6. Period accumulators (per-month caps)

```prisma
model ContractPeriodAccumulator {
  id                          String          @id @default(uuid()) @db.Uuid
  orgId                       String          @map("org_id") @db.Uuid
  driverContractId            String?         @map("driver_contract_id") @db.Uuid
  contractId                  String?         @map("contract_id") @db.Uuid
  costFactorId                String          @map("cost_factor_id") @db.Uuid
  periodType                  String          @map("period_type") @default("calendar_month")
  periodStartDate             DateTime        @map("period_start_date") @db.Date
  periodEndDate               DateTime        @map("period_end_date") @db.Date
  cumulativeKwh               Decimal         @map("cumulative_kwh") @db.Decimal(12, 4) @default(0)
  cumulativeAmountExVatMinor  BigInt          @map("cumulative_amount_ex_vat_minor") @default(0)
  cumulativeSessionCount      Int             @map("cumulative_session_count") @default(0)
  lastSessionId               String?         @map("last_session_id") @db.Uuid
  updatedAt                   DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization                Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  costFactor                  CostFactor      @relation(fields: [costFactorId], references: [id])

  @@unique([driverContractId, costFactorId, periodStartDate])
  @@unique([contractId, costFactorId, periodStartDate])
  @@index([orgId, periodStartDate])
  @@map("contract_period_accumulators")
  @@schema("billing")
}
```

Calendar-month is the only `period_type` for pilot; rolling-window
caps defer to post-pilot. Accumulator updates happen atomically with
the corresponding `billing_lines` write inside the session-stop
transaction.

### 7. Billing lines (resolver output)

```prisma
model BillingLine {
  id                          String          @id @default(uuid()) @db.Uuid
  orgId                       String          @map("org_id") @db.Uuid
  sessionId                   String          @map("session_id") @db.Uuid
  costFactorId                String          @map("cost_factor_id") @db.Uuid
  costFactorCode              String          @map("cost_factor_code")  // denormalised for query ergonomics
  costCenterId                String          @map("cost_center_id") @db.Uuid  // NOT NULL — every factor must allocate
  amountExVatMinor            BigInt          @map("amount_ex_vat_minor")
  vatRatePct                  Decimal         @map("vat_rate_pct") @db.Decimal(4, 2)
  vatAmountMinor              BigInt          @map("vat_amount_minor")
  amountIncVatMinor           BigInt          @map("amount_inc_vat_minor")
  currency                    String
  computationDetail           Json            @map("computation_detail") @db.JsonB
  createdAt                   DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)

  organization                Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  session                     ChargeSession   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  costFactor                  CostFactor      @relation(fields: [costFactorId], references: [id])
  costCenter                  CostCenter      @relation(fields: [costCenterId], references: [id])

  @@index([orgId, sessionId])
  @@index([costCenterId, createdAt(sort: Desc)])
  @@map("billing_lines")
  @@schema("billing")
}
```

`charging.sessions` gains rolled-up summary columns:
`cost_ex_vat_minor`, `cost_inc_vat_minor`, both populated from the
sum of `billing_lines` at session-stop.

### 8. Platform admin role (separate from tenant memberships)

```prisma
model PlatformAdmin {
  userId          String       @id @map("user_id") @db.Uuid
  level           PlatformAdminLevel
  grantedAt       DateTime     @default(now()) @map("granted_at") @db.Timestamptz(6)
  grantedByUserId String?      @map("granted_by_user_id") @db.Uuid

  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("platform_admins")
  @@schema("identity")
}

enum PlatformAdminLevel {
  read_only
  superuser

  @@schema("identity")
}
```

`identity.platform_admins` is separate from `tenancy.memberships` —
platform admins operate cross-tenant. Pilot has no humans logging in,
so this table exists with seeded rows for Straumvakt staff but no
runtime user-rights-hierarchy enforcement is wired up yet (the broader
RBAC engine is post-pilot per architecture canon §11.1). The `level`
column is reserved for future use.

Platform admins are the only role permitted to write to:
- `billing.cost_factors`
- Enabling/disabling factors via `cost_factors.status`

Org admins can read the cost factor catalog and configure
`tariff_definitions` for any active factor; they cannot create new
factor codes.

### 9. Resolver order at session-stop

For each `cost_factors` row WHERE `status = 'active'`:

1. Resolve the anchor entity from session lineage (DSOF anchor =
   site → look up `session.site_id`'s `dso_tariff_id`).
2. If anchor entity has no `tariff_definition` for this factor, skip
   silently (factor not applicable for this session).
3. Compute `amount_ex_vat_minor` via `tariff_definition.compute_rule`.
4. Apply `vat_rate_pct` → `vat_amount_minor`, `amount_inc_vat_minor`.
5. Resolve the deepest applicable `Contract` by walking session
   lineage (charger → site → property → host → org). Walk
   `parent_contract_id` chain collecting `contract_factor_assignments`
   — child overrides parent.
6. Look up active `DriverContract` for `session.user_id` (scoped or
   global). If found, its `factor_overrides` win over the contract's
   assignments for those factors.
7. If `DriverContract.owner_type = workplace` AND
   `wrkpf_tariff_id IS NOT NULL`, additionally compute WRKPF amount
   from that tariff and add it to the line set.
8. For each factor, apply assignments in priority order. `kwh_cap`
   rules read the accumulator and consume from it; overflow falls to
   the next priority. Continue until 100% of the factor amount is
   allocated to one or more cost centers.
9. If any factor remains unallocated, the session-stop fails (atomic
   transaction rolls back). The error message names which factor +
   which scope was missing rules.
10. Write `billing_lines` + update `contract_period_accumulators` in
    one transaction. Sum into `charging.sessions.cost_ex_vat_minor`
    and `cost_inc_vat_minor`.

### 10. Worked scenarios

See [`cost_center_splitting_model.svg`](../architecture/cost_center_splitting_model.svg)
for four worked scenarios with exact billing-line outputs:

1. **Krónan-employee at Krónan workplace** — workplace absorbs
   everything, driver pays zero, WRKPF emitted to Krónan service-fees.
2. **Anonymous driver at N1 public** — site contract splits: driver
   pays DSOF + XTRRF, N1 absorbs REPF + SPVIVF.
3. **Krónan-employee at N1, mid-month REPF cap** — driver-contract
   override caps Krónan's REPF coverage at 200 kWh/month;
   accumulator at 180/200 → 20 kWh covered + 30 kWh overflow to
   driver, plus DSOF + XTRRF to N1_DRIVERS_POOL, SPVIVF to N1_HOUSE,
   WRKPF to Krónan service-fees.
4. **Rental** — Krónan operates a Krónan workplace site with a
   charger physically owned by N1; driver A's CHRGRF rental fee is
   routed via driver contract to a Krónan rental-coverage cost
   center with `beneficiary_org_id = N1`. Issue Engine reads
   `owner_org_id` to route service tickets to N1.

## Consequences

### Positive

- Pilot can cleanly model both workplace-pays-everything and
  public-station-driver-pays-DSOF patterns without overloading JSONB
  metadata fields.
- Factor catalog is extensible at runtime — adding a 9th factor
  post-pilot is one INSERT, not a migration.
- Three-way ownership/operation/payment distinction surfaces in the
  schema (owner_org_id distinct from org_id, payer resolved via
  contracts), unlocking correct Issue Engine routing post-pilot.
- Per-month kWh caps with overflow fallback supported in pilot via
  the accumulator table.
- "Every factor reaches a cost center or session-stop fails" is a
  hard invariant — no silent rounding, no orphaned amounts.
- Inheritance via `parent_contract_id` lets admins define one Krónan
  Standard Contract that 47 sites inherit from with site-level
  overrides only where they differ — single approval moment, not 47
  configurations.

### Negative

- Schema gains 9 new tables / 4 enum types in one migration. Larger
  surface area to maintain.
- Sprint 2 grows by four milestones (2.10–2.13) covering CRUD pages
  for cost factors, contracts, driver contracts, and accumulator
  inspection. Sprint 5's tariff engine work expands from "compute
  cost" to "resolve rules + evaluate compute_rule DSL + emit lines
  per cost center + update accumulators." Estimated +10–15 days
  across Sprints 2 + 5.
- Accumulator correctness is high-trust. CLAUDE.md Rule 5 applies
  doubly — kwh_cap allocation + accumulator updates must be atomic
  with billing_lines write, or a crash mid-transaction silently
  miscounts caps next session.
- Inter-org settlement (e.g. Krónan paying N1 for the rented
  charger) is NOT implemented in pilot; only the
  `cost_centers.beneficiary_org_id` column is populated for dashboard
  display. Real settlement is post-pilot per ADR 0005 (tag F).
- Architecture canon §6 (commercial model — two contracts) becomes
  partially obsolete: `billing.customer_plans` and
  `hosts.charger_service_plans` still exist as Sprint 0 schema, but
  the new `Contract` + `ContractFactorAssignment` + `DriverContract`
  tables are the operational layer. The legacy tables are unused
  during pilot. Architecture canon §6 needs an amendment noting the
  new layer; the legacy tables stay for now (no drop) since they may
  be repurposed for the post-pilot real-billing work.

### Neutral

- Architecture canon §10 (schemas) needs `billing.cost_factors`,
  `billing.tariff_definitions`, `billing.cost_centers`,
  `billing.contracts`, `billing.contract_factor_assignments`,
  `billing.driver_contracts`,
  `billing.driver_contract_factor_overrides`,
  `billing.contract_period_accumulators`, `billing.billing_lines`,
  `identity.platform_admins` listed alongside the existing tables.
- ER diagram (`docs/architecture/entity_relationships.svg`) needs an
  update to include the contract / cost-center side. Tracked as a
  follow-up to the Sprint 2.6 migration commit.
- Architecture canon §11.2 (post-pilot deferrals) gains a clarifying
  note that inter-org settlement and real invoicing are still in
  tag E + tag F; the schema for *attribution* is in pilot, not the
  schema for *settlement*.

## Alternatives considered

**Bolt cost-center splitting onto `customer_plans.products` JSONB
without new tables.** Rejected — queryability evaporates; "show me
all sessions where Krónan workplace covered REPF this month" becomes
a JSON path traversal across thousands of rows. Cost-center
dashboards in Sprint 6 would be unworkable.

**Keep cost factors as a hardcoded Postgres ENUM.** Rejected — adding
a 9th factor post-pilot would require a migration that's coordinated
across all Orgs simultaneously. Runtime catalog supports rolling
introduction.

**Model contracts as flat `cost_allocation_rules` (no `parent_contract_id`,
no named contract entity).** Rejected — admins need to think in terms
of named, versioned, audit-stamped contracts ("Krónan Standard v3
effective 2026-09-01") not loose rule rows. Single-table flat-rules
is mathematically equivalent but UX-hostile.

**Defer cost-center splitting to post-pilot, ship pilot with a
single-payer model.** Rejected — the operator stated explicitly that
Krónan and N1 require materially different splits for pilot to be
honest. Single-payer would force JSONB workarounds that re-implement
the full design without queryability, then need migration of the
populated dataset.

**Conflate Issue Engine ownership routing into the existing
`assets.chargers.org_id`.** Rejected — V3's `org_id` is the operator
tenant boundary; Issue Engine ticket routing needs hardware-owner
information distinct from the operating tenant. Adding
`owner_org_id` as a separate column with default-equals-org_id is
the smallest possible change.

## References

- [`cost_center_splitting_model.svg`](../architecture/cost_center_splitting_model.svg) — visual model with 4 worked scenarios
- [`STRAUMVAKT_ARCHITECTURE_V3.md`](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) §6 (commercial model — to be amended), §10 (schema list — to be amended)
- [`STRAUMVAKT_V3_DELIVERY_PLAN.md`](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md) Sprint 2 milestones 2.6, 2.10–2.13; Sprint 5 tariff engine; Sprint 6 dashboard
- [`docs/sprints/SPRINT_02_TASKS.md`](../sprints/SPRINT_02_TASKS.md) — task-level grain
- [`docs/adr/0005-pilot-scope-tightening-2026-04-25.md`](./0005-pilot-scope-tightening-2026-04-25.md) — pilot scope rev 1 (tag E real billing, tag F payments deferred)
- [`docs/adr/0006-pilot-scope-rev2-2026-04-25.md`](./0006-pilot-scope-rev2-2026-04-25.md) — pilot scope rev 2 (tag B Driver Experience, tag D Issue Engine deferred)
- [`docs/adr/0007-circuit-asset-tier-back.md`](./0007-circuit-asset-tier-back.md) — Circuit migration co-shipped in 2.6
