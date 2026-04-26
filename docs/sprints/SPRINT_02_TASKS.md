# Sprint 2 — Admin Onboarding + Vendor/API/Overlay Readiness · Task List

**Generated:** 2026-04-25 from delivery-plan rev 2 ([ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md), [ADR 0007](../adr/0007-circuit-asset-tier-back.md)).
**Status:** NEXT — does not start until Sprint 1 exit is met (1.5
runbook executed against staging + retro filed).
**Branch:** `dev/sprint-02-admin-onboarding` (cut from `staging` once
Sprint 1 closes).

> Tasks below are the implementation grain beneath each milestone in
> [STRAUMVAKT_V3_DELIVERY_PLAN.md](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md) §5.
> If a task isn't covered by an existing milestone, it doesn't belong
> here — open an ADR + plan edit instead (CLAUDE.md Rule 11).

> **UI structure is presentational, not architectural.** The sidebar
> nav layout in milestone 2.8 (and any per-page nav grouping) is a
> starting point and can be reshuffled freely without touching schema
> or repository contracts. Pages can be reordered, renamed, or
> regrouped during a sprint. **What cannot drift without an ADR:**
> table names, column names, API path stems (`/api/admin/orgs`,
> `/api/admin/sites`, etc.), repository function signatures. Visual
> change ≠ data change.

---

## Rev 3 + Rev 4 status

- [ADR 0008](../adr/0008-cost-center-splitting.md) accepted 2026-04-26 — adds milestones 2.10 through 2.13.
- [ADR 0009](../adr/0009-drop-charger-host-tier.md) accepted 2026-04-26 — drops the ChargerHost tier; superseded UI in milestone 2.1 (`/tenants/hosts`) gets removed; Property attaches directly to Org.
- [ADR 0010](../adr/0010-organization-profile-enrichment.md) accepted 2026-04-26 — adds milestone 2.14 (OCPP configuration_keys) and enriches the existing 2.1 + 2.2 + 2.3 milestones with the new Org/User profile fields. iceland-energy-parties seeded as real Org rows.
- [ADR 0011](../adr/0011-control-plane-optionality.md) accepted 2026-04-26 — native OCPP, OEM API control, external CPMS overlay, hybrid, and read-only intelligence are first-class modes. OCPPIdentity is a control endpoint, not the physical charger. Future schema work targets `ChargingStation -> EVSE -> Connector` plus optional control refs.

Schema for ADRs 0007 + 0008 + 0009 + 0010 lands in **one consolidated
migration** in milestone 2.6 named
`<timestamp>_rev3_foundation_consolidated`. Single migration moment;
no further schema reshaping expected during pilot.

ADR 0011 reopens that last sentence for the charger/session core only:
before pilot data exists, decide whether a protocol-neutral physical
`ChargingStation -> EVSE -> Connector` correction should join the
foundation migration or land as a follow-up migration. Do not apply the
foundation migration until this decision is explicit.

---

## 2.0 — Pre-sprint cleanup (small, before 2.1)

- [ ] Refresh `src/app/(app)/dashboard/page.tsx` — three cards
      currently say Sprint 0/1/2 with "OCPI foundation" copy. Update
      to reflect rev 2 sprint sequence (Sprint 2 = Admin Onboarding +
      Zaptec; Sprint 3 = OCPI; Sprint 4 = Data Storage Lifecycle).
      Add a fourth card linking to
      [`cost_center_splitting_model.svg`](../architecture/cost_center_splitting_model.svg)
      and the rev 2 roadmap.
- [ ] Update sidebar footer label `Sprint 0` → current sprint label
      (`Sprint 2 — Admin Onboarding`).
- [ ] Cut feature branch `dev/sprint-02-admin-onboarding` from
      `staging` after Sprint 1 closes.
- [ ] ADR 0011 design checkpoint: decide whether protocol-neutral
      physical charging tables land before applying the consolidated
      foundation migration. Rollback anchor reserved:
      `pre-control-plane-optionality-2026-04-26`.

---

## Entry

- Sprint 1 exit met: 1.5 runbook executed on staging, real charger
  confirmed observable, [sprint-01.md](../retros/sprint-01.md) retro
  filed.
- Rev 2 ADRs (0006 + 0007) committed.
- Plaintext password in `docs/notes/2026-04-24-deploy-pause.md`
  scrubbed before push to staging.

## Exit

- Admin user can stand up the entity hierarchy and onboard at least
  one control-plane shape: native OCPP, Zaptec/Easee-style OEM API,
  external CPMS overlay, or read-only import. Zaptec metadata
  enrichment remains the first concrete vendor path.
- Beta operator console shell renders for admin, operator, and
  helper role; nav restrictions verified.
- Billing dashboard scaffold exists (read-only empty state).
- ER diagram updated with the Circuit tier; architecture canon §4
  cross-checked.

---

## Milestone 2.1 — Org admin CRUD (with profile enrichment per ADR 0010)

> ChargerHost dropped per ADR 0009. The `/tenants/hosts` UI built in
> the first pass of this milestone gets removed; Property attaches
> directly to Org. Org schema gets enriched per ADR 0010 — kennitala,
> contacts, addresses, branding, multi-role array.

- [x] Repo: `src/lib/repositories/organizations.ts` — basic CRUD
      already shipped (first pass). **Refactor for ADR 0010:** add
      input fields + UI types for `legal_name`, `legal_form`,
      `kennitala` (UNIQUE), `vsk_nr`, `lei_code`, `default_currency`,
      `addresses` (JSONB), `contacts` (JSONB), `branding` (JSONB),
      `regulator_licence_no`, `roles[]` (OrganizationRole), `notes`.
- [x] ~~Repo: `src/lib/repositories/charger-hosts.ts`~~ —
      **DROPPED per ADR 0009.** File removed; `/tenants/hosts` and
      `/tenants/hosts/[id]` pages removed; sidebar "Charger Hosts"
      leaf removed. Property attaches to Org directly.
- [ ] Zod schemas: extend `OrgCreateInput` + `OrgUpdateInput` with the
      new fields. Validate kennitala format (DDMMYY-XXXX Iceland).
- [ ] API routes: extend existing `/api/admin/orgs/*` routes to accept
      and return the enriched fields. Existing slug + display_name
      paths unchanged.
- [ ] UI: extend `/tenants/organizations` create form with kennitala +
      legal_form + contacts + roles[] picker. Detail page shows full
      profile + edit panel. **No more `/tenants/hosts`** — link from
      Org detail to Properties directly.
- [ ] Audit log entries on every mutation (already wired).
- [ ] Tests: repo tests covering kennitala uniqueness, role-array
      filtering, profile-field round-trip; boundary test asserts no
      Prisma type leaks.
- [ ] Smoke: create Org "Test Pilot" with kennitala 700101-9999, role
      `[operator, asset_owner]`, edit, archive; rows reflect each step.

## Milestone 2.2 — Membership + invite admin CRUD

Drivers are admin-created records only per ADR 0006 — no signup, no
invite emails.

- [ ] Repo: `src/lib/repositories/users.ts` — `createUser` (admin-only
      path, hashes + stores password OR leaves credentials null for
      driver-only records), `listUsers`, `updateUser`, `softDeleteUser`.
- [ ] Repo: `src/lib/repositories/memberships.ts` — `addMembership`,
      `listMemberships`, `updateMembershipRole`, `removeMembership`.
- [ ] Zod input schemas covering the role enum (`owner`, `admin`,
      `operator`, `helper`, `contractor`, `driver`, `viewer`).
- [ ] API routes: `POST/GET /api/admin/users`, `PATCH /api/admin/users/[id]`,
      `POST /api/admin/orgs/[orgId]/memberships`, `PATCH/DELETE
      /api/admin/memberships/[orgId]/[userId]`.
- [ ] UI: `src/app/(app)/users/page.tsx` already exists from earlier
      work — extend with role chip, invite-user modal, role-edit
      dropdown. Driver records render distinctly (greyed sign-in
      column with a "Pilot inert record (ADR 0006)" tooltip).
- [ ] RFID linking: under a driver detail page, add "Link RFID idTag"
      action that creates a `roaming.ocpi_tokens` row (`tokenType=RFID`,
      `userId` set). Reused later by the OCPP authorize path.
- [ ] Tests covering role updates, membership removal, RFID link/unlink.
- [ ] Smoke: create driver → link 2 RFID idTags → unlink one → confirm
      `roaming.ocpi_tokens` rows match.

## Milestone 2.3 — Property / Site admin CRUD

- [ ] Repos: `properties.ts`, `sites.ts` with create / list / update /
      archive. Property attaches to a Host; Site attaches to a Property.
- [ ] Address JSONB shape standardised in
      `src/lib/repositories/_types.ts` — `{ street, city, postal_code,
      country, formatted? }`. Country defaults to `IS`.
- [ ] Site form fields: `displayName`, `timezone` (default
      `Atlantic/Reykjavik`), `accessLevel`, `powerClass`. Lat/lon
      optional, validated as decimals with 6dp.
- [ ] Nav-tree component
      `src/components/nav/HostPropertySiteTree.tsx` — collapsible
      Host → Property → Site → (Sprint 2.4) Installation → (2.6)
      Circuit → (2.5) Charger. Reused by 2.4–2.6.
- [ ] API + UI pages.
- [ ] Tests + smoke (create three Sites under one Property, verify
      tree renders).

## Milestone 2.4 — Installation admin CRUD

- [ ] Repo: `installations.ts` with `createInstallation(orgId,
      siteId, ...)`, `listInstallationsBySite`, `updateInstallation`,
      `setInstallationStatus`.
- [ ] Form fields: `displayName`, optional `vendorId` (from hardware
      catalog dropdown — Zaptec / Easee / generic-ocpp), optional
      `modelId` (filtered by vendor), `vendorInstallationRef` (free
      text for now; the 2.7 wizard populates it from Zaptec API),
      `onboardingStatus` (default `pending_credentials`).
- [ ] No real credential capture in 2.4 — `credentialsRef` stays null
      until 2.7.
- [ ] UI: under Site detail, an "Installations" sub-list with
      create-installation modal.
- [ ] Tests + smoke (vendor-less installation, vendor-linked
      placeholder).

## Milestone 2.5 — Charger / OCPPIdentity / Connector admin CRUD

The 1.5 `provision-identity/route.ts` route is the bones — promote it
from `/dev/` to a real admin flow split across the three entities.

> ADR 0011 constraint: do not present OCPPIdentity as "the charger".
> The UI should show the physical charger/connector first, then a
> control-method section: Straumvakt OCPP, OEM API, external CPMS, or
> read-only. Current schema may still store connector rows under
> `ocpp.connectors` until the follow-up migration lands.

- [ ] Promote and split: move auth_secret hashing into
      `src/lib/ocpp/identity-secret.ts`; expose
      `hashIdentitySecret(plaintext): string` and `generateSecret():
      string` for reuse.
- [ ] Repo: `chargers.ts` (kind=charger SiteAsset + Charger row in
      `assets`), `ocpp-identities.ts`, `connectors.ts`. Each with
      create / list / update.
- [ ] API routes (admin-gated, NOT under `/dev/`):
      `POST /api/admin/sites/[id]/chargers`,
      `POST /api/admin/chargers/[id]/identities`,
      `POST /api/admin/identities/[id]/connectors`.
- [ ] **One-shot password reveal pattern.** Mirror the 1.5
      provision-identity route — return Basic-Auth password ONCE in
      the 201 response, never log, never re-fetch. Plaintext discarded
      after response.
- [ ] UI: charger create wizard (basic) — pick Site, optional
      Installation (2.4), optional Circuit (2.6, may not exist when
      this lands first), set displayName + serial + firmware fields,
      auto-spawn an OCPPIdentity with generated Basic-Auth, then
      walk through Connector creation.
- [ ] Add control-method metadata to the wizard copy/state:
      `native_ocpp`, `oem_api`, `external_cpms`, `read_only`. For this
      milestone, non-OCPP modes may create only physical/vendor
      reference records or be marked "planned" if the schema correction
      has not landed.
- [ ] Smoke: created identity authenticates from the OCPP simulator
      and posts a BootNotification that lands in the event log.
- [ ] Migrate the existing `/api/admin/dev/provision-identity/route.ts`
      to a deprecation shim that re-exports the new path until Sprint
      2.5 is done, then delete it.

## Milestone 2.6 — Consolidated rev-3 foundation migration (ADRs 0007 + 0008 + 0009 + 0010)

> Schema migration. Rule 4 (`prisma/schema.prisma` is edit-with-instruction)
> applies — this milestone is the explicit instruction for all four ADRs
> in one Prisma migration named `<timestamp>_rev3_foundation_consolidated`.
> No "while I was in there" edits to other models.
>
> **Rollback anchors created BEFORE this migration applies:**
> - `pre-host-drop-2026-04-26` (ADR 0009)
> - `pre-org-enrichment-2026-04-26` (ADR 0010)

- [ ] Prisma migration: add `properties.circuits` per ADR 0007. Add
      optional `circuitId` FK on `assets.chargers`. **Add the eleven
      tables/types from ADR 0008** in the same migration:
      `billing.cost_factors` + `CostFactorAnchor` enum + `CostFactorStatus`
      enum, `billing.tariff_definitions`, `billing.cost_centers`,
      `billing.contracts` + `ContractScopeType` enum + `ContractStatus`
      enum, `billing.contract_factor_assignments`,
      `billing.driver_contracts` + `DriverContractOwnerType` enum,
      `billing.driver_contract_factor_overrides`,
      `billing.contract_period_accumulators`, `billing.billing_lines`,
      `identity.platform_admins` + `PlatformAdminLevel` enum.
      Plus `ALTER` columns: `properties.sites` gains five tariff FKs;
      `properties.installations` gains `retailer_tariff_id`;
      `assets.chargers` gains `owner_org_id` + `chrgrf_tariff_id`;
      `charging.sessions` gains `cost_ex_vat_minor` + `cost_inc_vat_minor`.
- [ ] Migration name: `<timestamp>_rev3_foundation_consolidated`.
      Apply to dev Neon branch first, verify with `prisma migrate status`.
- [ ] **ADR 0009 — drop ChargerHost.** Migration steps in order:
      `Site.site_type` column added (default `standard`); per-Site
      backfill from existing host's type; `Property.host_id` dropped;
      `properties.properties.org_id` becomes the only parent FK;
      `ContractScopeType.host` value renamed to `host_legacy` (drop
      in a follow-up migration after one release); `hosts.charger_service_plans`
      and `hosts.charger_hosts` tables dropped. The `hosts` schema
      itself stays empty for future ServiceAgreement table.
- [ ] **ADR 0010 — Org enrichment.** Add columns to
      `tenancy.organizations`: `legal_name`, `legal_form`, `kennitala`
      (UNIQUE), `vsk_nr`, `lei_code`, `default_currency` (default
      ISK), `addresses` (JSONB), `contacts` (JSONB), `branding`
      (JSONB), `regulator_licence_no`, `roles[]` (new
      `OrganizationRole` enum, 21 values), `notes`. Backfill existing
      rows with defaults; existing slug + display_name unchanged.
- [ ] **ADR 0010 — User enrichment.** Add columns to
      `identity.users`: `kennitala` (UNIQUE), `phone`, `locale`
      (default `is`), `notes`.
- [ ] **ADR 0010 — OCPP configuration keys.** Add
      `ocpp.configuration_keys` table per the schema in ADR 0010.
- [ ] Repo: `circuits.ts` with `createCircuit`, `listCircuitsBySite`,
      `listCircuitsByInstallation`, `updateCircuit`,
      `attachChargerToCircuit`, `detachCharger`.
- [ ] Form fields: `displayName`, `ampereCeiling` (int amps, optional),
      `phaseCount` (default 3), `vendorCircuitRef` (text, populated by
      2.7 for Zaptec).
- [ ] UI: under Site or Installation detail, a "Circuits" sub-list
      with create-circuit modal. Charger detail gets a "Circuit"
      dropdown that calls `attachChargerToCircuit`.
- [ ] Update `src/components/nav/HostPropertySiteTree.tsx` to render
      Circuits between Installation and Chargers when present.
- [ ] Update [`docs/architecture/entity_relationships.svg`](../architecture/entity_relationships.svg)
      — add Circuit between Installation and SiteAsset.
- [ ] Update [`docs/architecture/straumvakt_architecture_v3.svg`](../architecture/straumvakt_architecture_v3.svg)
      — Circuit row in the asset hierarchy lane (already noted as
      pending from Sprint 0 retro).
- [ ] Cross-check architecture canon §4 hierarchy ASCII tree (already
      updated) and §10 schema list (already updated) match the
      migration.
- [ ] Tests + smoke (create Circuit, attach 3 chargers, detach 1,
      query "all chargers on Circuit X" indexed lookup).

## Milestone 2.7 — Charger onboarding wizard with Zaptec OAuth + API enrichment

> Largest milestone in Sprint 2. Touches secrets, a third-party API,
> and several existing UIs. Treat as its own mini-sprint within the
> sprint.

- [ ] Secret store contract: define `getInstallationCredentials(orgId,
      installationId)` and `setInstallationCredentials(orgId,
      installationId, payload)` against Cloudflare KV. The
      `installations.credentialsRef` column holds the KV key (e.g.
      `inst:<uuid>`). Never log payloads. Rule 2 applies hard.
- [ ] Zaptec API client: `src/lib/vendors/zaptec/client.ts` —
      OAuth password grant (`POST /oauth/token` with
      `grant_type=password`), token refresh, automatic re-auth on
      401, rate-limit awareness. Pin OpenAPI version in repo
      (`docs/vendors/zaptec/openapi-snapshot.json`).
- [ ] Zaptec read endpoints we exercise: `/api/installation` (list),
      `/api/installation/{id}` (detail), `/api/chargers` filtered by
      installation, `/api/installation/{id}/circuits`. Map to local
      types in `src/lib/vendors/zaptec/types.ts`.
- [ ] Wizard step 1: enter Zaptec username + password (admin-only
      page; password input + warning copy that this is one-time use,
      we exchange it for a refreshable token immediately).
- [ ] Wizard step 2: list Zaptec installations the credentials have
      access to. Admin selects one.
- [ ] Wizard step 3: preview pulled metadata — installation name,
      circuits, chargers per circuit. Admin reviews + can deselect
      individual chargers.
- [ ] Wizard step 4: confirm + save. One transaction:
      - Create or upsert `installation` row with
        `vendorInstallationRef`.
      - For each circuit: create `circuits` row with `vendorCircuitRef`.
      - For each charger: create `site_assets` (kind=charger),
        `chargers`, `ocpp_identities` (auth_secret_hash with reveal),
        `connectors`. Attach to the right circuit.
      - Audit log a single composite event: `vendor.zaptec.imported`
        with counts in the payload.
- [ ] ADR 0011 control-plane classification: every imported charger
      gets a declared mode (`oem_api`, `native_ocpp`, `hybrid`,
      `external_cpms`, or `read_only`) and a capability profile for
      authorize/start/stop/status/session-history/configuration.
- [ ] Easee-shaped adapter notes: document which parts of the same
      wizard can support API authorize/start/stop when an Easee pilot
      appears. Do not hardcode Zaptec assumptions into shared vendor
      onboarding components.
- [ ] Overlay import path: allow an admin to represent an externally
      controlled charger/site even when Straumvakt does not have OCPP
      credentials. Minimum viable mode: asset + external reference +
      imported session/charge-history placeholder.
- [ ] Token-refresh background fetch: store both access + refresh
      tokens in KV; client checks expiry and refreshes if needed.
- [ ] Health check: vendor adapter health table (`vendors.adapter_health`
      already in schema) — record per-window error rate + latencies.
- [ ] Tests: contract test against the pinned Zaptec OpenAPI snapshot;
      unit tests on the client; wizard component test (mock the API).
- [ ] Smoke: start with empty DB → run wizard against a real Zaptec
      sandbox → confirm rows match what was selected → simulator
      uses one of the imported identities to BootNotification.

## Milestone 2.8 — Beta operator console shell

The shell already exists from Sprint -1 + the Sprint 1.5 detour. This
milestone tightens it for admin / operator / helper roles.

- [ ] Sidebar nav groups (presentational — see UI-vs-data note at top
      of file; reshuffles don't need an ADR). Proposed starting
      structure for Sprint 2:

      ```
      Dashboard

      Operations         ← sites · installations · circuits · chargers ·
                           sessions · onboard (Zaptec wizard)
      Tenants            ← organizations · properties  (Charger Hosts dropped per ADR 0009)
      People             ← users · memberships
      Billing            ← cost factors · tariff defs · cost centers ·
                           contracts · driver contracts · accumulators ·
                           billing lines (post ADR 0008)
      Hardware           ← vendors · models (read-only catalog)

      Reference          ← Iceland Energy Parties · Zaptec API (existing)
      Mobile App         ← Flutter PWA preview (existing)
      Technical Read     ← zaptec-test iframe (existing)
      ```

      Existing leaf items (Mobile App, Technical Read, Reference) stay
      put. The five new groups (Operations, Tenants, People, Billing,
      Hardware) appear as collapsible groups matching the existing
      Reference group pattern in
      [`src/components/sidebar.tsx`](../../src/components/sidebar.tsx).
- [ ] Role-aware route guard `requireRole(role: MembershipRole[]):
      Promise<Session>` in `src/lib/api-auth.ts`. Wraps existing
      `requireAdmin` for backwards compat.
- [ ] Helper role constraint: when role=helper, list views filter to
      sites the helper is assigned to. Implement
      `getAssignedSites(userId): string[]` and feed into the site /
      session / charger queries.
- [ ] Placeholder pages: `/issues` (post-pilot copy with link to
      ADR 0006 D), `/drivers` (post-pilot copy with link to tag B),
      `/roaming` (post-pilot copy with link to tag A).
- [ ] Topbar: org switcher (admin-only — operator / helper see their
      assigned org as static text).
- [ ] Audit log: nav-route rendering doesn't emit audit events; only
      mutations do.
- [ ] Smoke: log in as admin → see all nav items; log in as operator →
      sidebar hides Hardware admin, Tenants admin; log in as helper →
      additionally hides Billing.

## Milestone 2.9 — Billing UI scaffold

- [ ] Page `src/app/(app)/billing/page.tsx` with:
      - Period selector (current month / prior 1–3 months) — UI only,
        no DB query yet.
      - Empty state: "Billing data lights up in Sprint 6 (read-only
        dashboard) — see the [delivery plan](../docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md)."
      - "Driver-side billing view ships post-pilot per ADR 0006 (tag
        B)" footer.
- [ ] No repository, no API route. Pure scaffold.
- [ ] Smoke: page renders without errors at `/billing`.

## Milestone 2.10 — Cost factor catalog + cost centers + tariff definitions (ADR 0008)

> Foundation for the splitting model. Pure data-management screens.
> Schema is in 2.6.

- [ ] Repo: `cost-factors.ts` — `listCostFactors(status?)`,
      `getCostFactorByCode(code)`, `createCostFactor(input)` (platform
      admin only), `setStatus(id, status)`. Platform admins write;
      Org admins read-only.
- [ ] Repo: `cost-centers.ts` per `withOrgContext` — `createCostCenter`,
      `listCostCenters`, `updateCostCenter`, `archiveCostCenter`. Enforce
      that exactly zero or one of `payer_org_id` / `payer_user_id` is set.
- [ ] Repo: `tariff-definitions.ts` per `withOrgContext` — `createTariff`,
      `listByCostFactor`, `updateTariff`, `archiveTariff`. Validate
      `compute_rule` JSONB against the DSL schema (per_kwh /
      tou_per_kwh / per_session_flat / per_minute_after_minutes /
      percent_of_factors / per_calendar_month_flat / per_day_flat).
- [ ] Seed migration: insert the 8 pilot factor rows in
      `billing.cost_factors` with `status=active`. One additional seed
      file in `prisma/seed.ts` (idempotent upsert by `code`).
- [ ] API routes (admin-gated): `GET /api/admin/cost-factors`,
      `POST /api/admin/platform/cost-factors` (platform-admin only),
      `POST /api/admin/cost-centers`, `POST /api/admin/tariff-definitions`,
      plus PATCH/DELETE variants.
- [ ] UI: `/billing/cost-factors` (list, read-only for Org admin),
      `/billing/cost-centers` (CRUD), `/billing/tariff-definitions`
      (CRUD with `compute_rule` JSON editor + preview button that
      simulates a session input).
- [ ] Wire site / installation / charger detail pages to surface the
      attached `tariff_definition` for each anchored factor.
- [ ] Tests: repo tests covering payer constraint, compute_rule
      validation, status transitions; smoke creating one tariff per
      factor and attaching to a Site.

## Milestone 2.11 — Contracts with inheritance + factor assignments (ADR 0008)

- [ ] Repo: `contracts.ts` per `withOrgContext` — `createContract`,
      `listContracts(scope?)`, `getContractWithChain(id)` (walks
      `parent_contract_id` and merges `contract_factor_assignments` by
      child-overrides-parent), `setStatus(id, status)`,
      `archiveContract(id)`.
- [ ] Auto-create root contract on Org create (Sprint 2.1 calls
      `createRootContract(orgId)` immediately after Org create with
      `scope_type=org`, `scope_id=null`, `status=pending_configuration`).
- [ ] Repo: `contract-factor-assignments.ts` —
      `addAssignment(contractId, factorId, costCenterId, allocationRule, priority)`,
      `listAssignments(contractId)`, `removeAssignment(id)`.
      Validate `allocation_rule` JSONB shape (all / percent / flat /
      kwh_cap).
- [ ] Resolver helper: `resolveContractChainForSession(session) →
      Map<costFactorId, ContractFactorAssignment[]>` — walks deepest
      scope to org and merges. Pure function for testability.
- [ ] API routes: `POST /api/admin/contracts`,
      `POST /api/admin/contracts/[id]/assignments`, etc.
- [ ] UI: `/billing/contracts` — tree view rendering inheritance
      chains visually (parent → child indented, deepest at the
      leaves). Each contract card shows its factor assignments;
      clicking opens an editor.
- [ ] UI: contract preview tool — given a synthetic session input
      (kWh, idle min, site, user), show the resolved chain and the
      allocations that would be applied. Reuses the resolver helper.
- [ ] Tests: 6 inheritance scenarios (root only, root + site
      override, root + host override, two-level chain, three-level
      chain, archived parent fallback).

## Milestone 2.12 — Driver contracts + factor overrides (ADR 0008)

- [ ] Repo: `driver-contracts.ts` per `withOrgContext` —
      `createDriverContract(userId, ownerType, ownerId, ...)`,
      `listDriverContracts(userId)`, `setStatus`, `archive`.
- [ ] Repo: `driver-contract-factor-overrides.ts` —
      `addOverride(driverContractId, factorId, costCenterId, allocationRule, priority, scope?)`,
      `listOverrides(driverContractId)`, `removeOverride(id)`.
- [ ] Resolver helper:
      `resolveDriverContractOverrides(session, factorIds) →
      Map<costFactorId, DriverContractFactorOverride[]>` — finds
      active driver contract for the session's user (scope-matched)
      and returns its overrides. Returns empty map when no contract.
- [ ] WRKPF emission: when resolved driver contract has
      `owner_type=workplace` AND `wrkpf_tariff_id IS NOT NULL`, the
      resolver computes WRKPF as a separate factor line.
- [ ] API routes: `POST /api/admin/users/[id]/driver-contracts`,
      `POST /api/admin/driver-contracts/[id]/overrides`, etc.
- [ ] UI: under `/people/users/[id]`, a "Driver contracts" sub-list.
      Per contract, an editor for overrides (factor → cost center →
      allocation rule + scope picker). Workplace contracts surface
      a `wrkpf_tariff_id` selector.
- [ ] UI: `/billing/driver-contracts` — global list across all users
      with filters (owner_type, status, factor coverage).
- [ ] Tests: 5 driver-contract scenarios — workplace global,
      workplace site-scoped, family-group inheritance from parent
      contract, self-paid contract, archived contract falls through.

## Milestone 2.13 — Period accumulator infrastructure (ADR 0008)

- [ ] Repo: `contract-period-accumulators.ts` — `getOrCreate(driver_or_contract,
      factor_id, period_start)`, `consume(accumulator, kwh,
      amount_ex_vat)`, `query(driver_id, factor_id, period?)`.
      All writes inside the session-stop transaction.
- [ ] Resolver: `applyAllocationRule(rule, factorAmount, accumulator)
      → AllocationResult` — pure function. For `kwh_cap` rules: read
      accumulator's `cumulative_kwh`, compute remaining-cap kWh,
      allocate min(remaining, session_kwh) to this priority, return
      overflow_kwh + overflow_amount to the next priority's evaluator.
- [ ] Period start computation: calendar-month based on the session's
      `started_at` in the org's timezone (Atlantic/Reykjavik for
      pilot). Period start = first day of month at 00:00 local time.
- [ ] Test fixtures: 4 cap scenarios — under cap (no overflow), at
      cap exactly, over cap (overflow), session spanning month
      boundary (resolved to the started_at month, not split).
- [ ] UI: under driver-contract detail, an "Accumulators" card
      showing current-month state for each factor with a cap rule
      ("REPF: 180/200 kWh used this month, resets 2026-12-01").
- [ ] Smoke: configure Anna's Krónan workplace contract with REPF
      cap 200 kWh/month; run two sessions totalling 250 kWh; assert
      that 200 kWh allocated to KRONAN_WORKPLACE and 50 kWh to
      DRIVER_PAYS; accumulator reads 200/200 after.

## Milestone 2.14 — OCPP configuration-key registry (ADR 0010)

> Schema in 2.6. This milestone wires GetConfiguration / ChangeConfiguration
> round-trips into the registry so operators see what's actually set
> on each charger.

- [ ] Repo: `ocpp-configuration-keys.ts` per `withOrgContext` —
      `listKeysForIdentity(ocppIdentityId)`, `getKey(ocppIdentityId, keyName)`,
      `recordObserved(ocppIdentityId, keyName, value, observedAt)`,
      `recordSet(ocppIdentityId, keyName, value, setByActorUserId, setAt)`.
- [ ] Translator hook: when a `GetConfigurationResponse` lands, write
      one row per returned key via `recordObserved`. Existing OCPP
      ingest flow extends.
- [ ] Outbound dispatcher hook: when `ChangeConfiguration` is sent
      and acked, write the new value via `recordSet`.
- [ ] UI: under charger detail (`/operations/chargers/[id]` —
      Sprint 2.5), an "OCPP configuration" panel shows the latest
      observed + set values. Sortable by key name. Diff view when
      observed differs from set.
- [ ] Standard-key seed: insert/upsert the 9 OCPP 1.6 standard keys
      from ADR 0010 (HeartbeatInterval, MeterValueSampleInterval,
      MeterValuesSampledData, AuthorizeRemoteTxRequests,
      ConnectionTimeOut, LocalAuthListEnabled, LocalAuthListMaxLength,
      ResetRetries, WebSocketPingInterval) as the expected baseline
      for a freshly-onboarded charger.
- [ ] Smoke: from operator console, trigger GetConfiguration on a
      simulator charger; assert all standard keys land in the
      registry with `observedAt` set.

## Milestone 2.15 — Control-plane optionality design close-out (ADR 0011)

> Documentation/design gate before pilot data. No schema edit happens
> here unless the operator explicitly names `prisma/schema.prisma` and
> approves Phase 3.

- [ ] Decide exact physical model names: `ChargingStation`, `EVSE`,
      `Connector`, and whether current `assets.chargers` survives as
      an implementation table or is superseded by additive siblings.
- [ ] Decide source-reference tables: `VendorAssetRef`,
      `ExternalCpmsRef`, `ProtocolTransactionRef`, `ImportedCdrRef`.
- [ ] Decide routing/capability schema: where `authorize/start/stop/
      status/configuration/session_history` capabilities live and how
      command dispatch resolves them.
- [ ] Update diagrams for the target hierarchy and mark current schema
      rows as "implementation today" versus "target physical model".
- [ ] If the operator approves schema work, reserve/create rollback
      anchor `pre-control-plane-optionality-2026-04-26` before any
      migration apply.

---

## Definition of Done (sprint-level)

- All milestones' tasks above checked off.
- `npx tsc --noEmit` exit 0 (main + gateway).
- `npm run build` clean.
- `npx vitest run` all green.
- Migrations applied to dev + staging Neon branches.
- `docs/architecture/entity_relationships.svg` and
  `straumvakt_architecture_v3.svg` updated for Circuit.
- Sprint 2 retro filed at `docs/retros/sprint-02.md` per CLAUDE.md
  Rule 11.

## Risks (sprint-specific)

- **Zaptec OAuth scope.** If Zaptec API surface diverges from the
  pinned OpenAPI snapshot mid-sprint, the wizard breaks. Mitigation:
  contract test catches it; vendor-credentials layer isolates the
  surface so we can re-pin without touching wizard UI.
- **CRUD form explosion.** Nine milestones × ≥1 form each. Stay
  minimal — only fields the next sprints actually read; everything
  else can be a JSONB metadata field.
- **Rule 5 trap on charger create.** OCPPIdentity Basic-Auth
  generation + hashing is fundamental-logic territory. Don't refactor
  the 1.5 secret-handling without an explicit instruction.
- **Circuit migration ordering.** 2.6 depends on 2.5 *not* having
  hardcoded "no circuit" anywhere. Land 2.6 before 2.7 so the wizard
  populates the new column on first run.
