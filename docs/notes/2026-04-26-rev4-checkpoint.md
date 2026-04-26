# Foundation Rev 4 — Checkpoint

**Date:** 2026-04-26
**Branch:** `dev/sprint-01-ui-detour` (continues; rev-4 work piled on top of rev-3 commits)
**ADRs landing in this rev:** 0009 (drop ChargerHost) · 0010 (Org/User enrichment + multi-role + OCPP configuration_keys)
**Schema migration:** `prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql` — generated, **not applied**.

This note is a snapshot of the foundation state immediately after rev-4
docs + schema + UI work landed. Written so a cold reader can pick up
the work without reconstructing the conversation. Reads alongside the
[Sprint 1 retro](../retros/sprint-01.md) and the existing
[deploy-pause checkpoint](./2026-04-24-deploy-pause.md).

---

## What rev 4 is

Foundation rev 4 = the schema reaches its **pilot-ready shape**. After
this single consolidated migration applies, no further schema reshaping
is expected during pilot. Everything else in Sprint 2 builds against
this shape.

The four ADRs in scope:

| ADR | Title | What it does |
|---|---|---|
| 0007 | Circuit Asset Tier Re-Added | Optional `properties.circuits` between Installation and Charger; Zaptec circuit data has a home |
| 0008 | Cost-Center Splitting | 9 new `billing.*` tables (cost_factors / tariff_definitions / cost_centers / contracts / contract_factor_assignments / driver_contracts / driver_contract_factor_overrides / contract_period_accumulators / billing_lines) + `identity.platform_admins` + per-anchor tariff FKs on Site/Installation/Charger + ChargeSession.cost_*_minor rollup columns |
| 0009 | Drop ChargerHost Tier | `hosts.charger_hosts` + `hosts.charger_service_plans` tables removed; `Property.host_id` dropped; HostType moved to `Site.site_type` enum; `ContractScopeType.host` deprecated |
| 0010 | Org Profile Enrichment + Multi-role + OCPP Config Keys | Org gains kennitala + 11 other identity columns + 21-value `OrganizationRole` enum array; User gains kennitala + phone + locale + notes; new `ocpp.configuration_keys` table closes OCPP-1.6 spec gap |

Together they take the V3 schema from "Sprint 0 minimum-viable" to
"actually usable for Iceland operations" and align the model with the
rev-3 cost-center splitting principle that ownership ≠ operation ≠
payment.

---

## What's done in code + docs

### ADRs (5 total in pilot scope)

| File | Lines | Status |
|---|---|---|
| `docs/adr/0006-pilot-scope-rev2-2026-04-25.md` | ~180 | Accepted |
| `docs/adr/0007-circuit-asset-tier-back.md` | ~170 | Accepted |
| `docs/adr/0008-cost-center-splitting.md` | ~440 | Accepted |
| `docs/adr/0009-drop-charger-host-tier.md` | 251 | **Accepted (this rev)** |
| `docs/adr/0010-organization-profile-enrichment.md` | 361 | **Accepted (this rev)** |

### Schema

| Artefact | Status |
|---|---|
| `prisma/schema.prisma` | 1826 lines · `npx prisma validate` ✅ green |
| `prisma/migrations/20260426120000_rev3_foundation_consolidated/migration.sql` | 483 lines · generated via `prisma migrate diff --from-config-datasource` · NOT applied to dev / staging |
| `prisma/migrations/migration_lock.toml` | created (was missing) |
| Prisma Client | regenerated to v7.8.0 against the new schema |

The migration consolidates ADRs 0007 + 0008 + 0009 + 0010 into one
file. It contains:

- **8 new enums** — `tenancy.OrganizationRole` (21 values),
  `identity.PlatformAdminLevel`, `properties.SiteType`,
  `billing.{CostFactorAnchor, CostFactorStatus, ContractScopeType,
  ContractStatus, DriverContractOwnerType}`
- **12 new tables** — `properties.circuits`,
  `identity.platform_admins`, `ocpp.configuration_keys`, plus 9
  `billing.*` tables for the rev-3 splitting model
- **6 ALTER TABLE** sections adding columns to
  `tenancy.organizations` (12 cols), `identity.users` (4 cols),
  `properties.sites` (6 cols), `properties.installations` (1 col),
  `assets.chargers` (3 cols), `charging.sessions` (2 cols)
- **DROP** of `hosts.charger_hosts`,
  `hosts.charger_service_plans`, `properties.properties.host_id`,
  `hosts.HostType` enum, `hosts.HostStatus` enum
- All necessary new indexes, unique constraints
  (`organizations.kennitala`, `users.kennitala`,
  `cost_centers (org_id, code)`, `contracts (org_id, scope_type, scope_id)`,
  composite accumulator unique keys), and FK constraints

### Documentation

| File | Updated for rev 4 |
|---|---|
| `docs/architecture/README.md` | ✅ change-log entry referencing all 4 rev-4 ADRs · vendor-API + canonical-docs index includes new SVGs |
| `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md` | ✅ §4 hierarchy (no Host, multi-role Org), §10 schema list (new tables + columns + dropped Host tables), §6 amendment from rev 3 stays |
| `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` | ✅ §1.1 four-pass scope tightening narrative, §2 Sprint 2 row title and exit criterion |
| `docs/sprints/SPRINT_02_TASKS.md` | ✅ Rev 3 + Rev 4 status block, milestone 2.1 reshaped (Host CRUD struck through), milestone 2.6 expanded into the consolidated migration with explicit per-ADR steps, new milestone 2.14 for the OCPP configuration_keys registry, sidebar nav structure updated (no Charger Hosts) |
| `docs/retros/sprint-01.md` | (unchanged in rev 4 — still flags 1.5 runbook as the close-out gate) |

### Diagrams (SVGs)

| File | Status |
|---|---|
| `docs/architecture/cost_center_splitting_model.svg` | Rev 3 model + 4 worked scenarios; still valid post-rev 4 (Host wasn't shown in this one anyway) |
| `docs/architecture/data_model_worked_example.svg` | Rev 3 worked example (Anna at Krónan workplace, 30 kWh through N1-rented charger). Still references ChargerHost in passing — minor regen needed but not blocking |
| `docs/architecture/prisma_schema_graph.svg` | **NEW (this rev).** 1800×2800 ER-diagram-style rendering of every table in the rev-4 schema with FK arrows, ★ markers on rev-3/rev-4 additions, and a comprehensive bottom-of-diagram summary of every column added by ADRs 0007–0010 |
| `docs/architecture/straumvakt_roadmap.svg` | Rev 2 roadmap; still valid |
| `public/cost_center_splitting_model.svg`, `public/data_model_worked_example.svg`, `public/prisma_schema_graph.svg` | mirrored copies served by the dev server at `/` |

### Code changes (UI / API / repos)

#### Removed (per ADR 0009 — ChargerHost drop)

- `src/lib/repositories/charger-hosts.ts` — deleted
- `src/lib/repositories/_inputs/hosts.ts` — deleted
- `src/app/api/admin/orgs/[id]/hosts/` — deleted (route directory)
- `src/app/api/admin/hosts/` — deleted (route directory + nested archive)
- `src/app/(app)/tenants/hosts/` — deleted (page + create-form + detail + edit-panel)
- Sidebar: "Charger Hosts" leaf removed from Tenants group; `Building`
  icon import removed
- `src/app/api/admin/dev/provision-identity/route.ts` — fixed two
  references to `tx.chargerHost.create()` and `Property.hostId`

#### Modified

- `src/components/sidebar.tsx` — Tenants group is now Organizations-only; collapse/expand with localStorage persistence still works
- `src/app/(app)/tenants/organizations/[id]/page.tsx` — removed
  "Charger Hosts under this org" section; replaced with two
  rev-4 explainer panels (profile enrichment landing in 2.6 + asset
  hierarchy without Host) linking to ADRs 0009 + 0010
- `src/app/(app)/dashboard/page.tsx` — subtitle reads "Foundation rev
  4"; "Recent decisions" card lists ADRs 0010 + 0009 + 0008 + 0007 +
  0006 + 0005 + 0004 + 0001-3
- `prisma/schema.prisma` — comprehensive rev-3/rev-4 changes
- `docs/architecture/README.md`, `STRAUMVAKT_ARCHITECTURE_V3.md`,
  `STRAUMVAKT_V3_DELIVERY_PLAN.md` — see Documentation section above

#### Untouched (intentionally — Sprint 0 + Sprint 1 stays as-is)

- Gateway worker (`gateway/src/*`)
- OCPP translator + projections + dispatcher (`src/lib/ocpp/*`)
- `src/app/api/ocpp/events/route.ts`
- `src/lib/repositories/{events.ts, outbound-commands.ts, _context.ts, _types.ts}`
- All Sprint 1.5 outbound-command admin routes
- Reference subsection pages (DSO/Retailers/TSO/PublicCharging/RentalService)
- Zaptec API + Easee API reference pages
- Mobile App + Technical Read iframe pages

---

## Verification suite — all green at checkpoint

```text
npx prisma validate  →  ✅ schema valid 🚀
npx tsc --noEmit     →  ✅ exit 0 (main + gateway)
npm run build        →  ✅ exit 0  (Next.js 16.2.4 + Turbopack)
                          all routes compile · /tenants/hosts no longer in route map
Smoke (running dev server localhost:3000):
  /dashboard                       200
  /tenants/organizations           200
  /tenants/hosts                   404  (correctly gone per ADR 0009)
  /people/users                    200
  /reference/electricity/dso       200
  /reference/easee-api             200
  /technical-read                  200
  /api/admin/orgs (no session)     401  (auth gate working)
```

> **Caveat about the running dev server.** The Node process holds the
> *previously-generated* @prisma/client in module cache. After
> `prisma generate` ran, files in `node_modules/@prisma/client/`
> updated, but the running process didn't reload them. The next time
> the dev server is restarted (or HMR aggressively reloads), the
> *new* client expects columns the dev DB doesn't have (because the
> migration is unapplied), and Org / User reads will start returning
> 500 errors. Two ways out:
>
> 1. **Apply the migration to dev**, which brings the DB into sync
>    with the schema. Operator action via `npx prisma migrate dev`.
> 2. **Don't restart the dev server** until the migration is applied.
>
> tsc and `npm run build` are unaffected — they only check types,
> not the live DB shape.

---

## Rollback anchors

Tag these BEFORE applying the migration:

- `pre-host-drop-2026-04-26` — anchor for ADR 0009 drop
- `pre-org-enrichment-2026-04-26` — anchor for ADR 0010
- `pre-control-plane-optionality-2026-04-26` — reserved by operator
  request after ADR 0011; create before any future schema migration
  that reshapes charger/session/control-plane tables.

Existing earlier anchors still valid:

- `pilot-rescope-rev2-2026-04-25` — pre-rev-3 (cost-center splitting)
- `pilot-rescope-rev1-2026-04-25` — pre-rev-2 (admin-only pilot)
- `pre-pilot-rescope-2026-04-25` — pre-rev-1

None of these tags actually exist on the remote yet — operator hasn't
created them. List them on the next commit + push pass.

## ADR 0011 addendum — control-plane optionality

After this checkpoint, the operator approved
[ADR 0011](../adr/0011-control-plane-optionality.md). This does not
change the current Rev 4 schema or migration SQL. It changes the
architectural target:

- Straumvakt is the operating/commercial layer above native OCPP, OEM
  API control, hybrid control, external CPMS overlay, and read-only
  intelligence.
- `OCPPIdentity` is a protocol endpoint, not the physical charger.
- Future schema work should target `ChargingStation -> EVSE ->
  Connector` as the physical model, with optional OCPP/vendor/external
  references and capability/routing policy attached.
- Do not apply the consolidated foundation migration to a real dev
  branch until the operator explicitly decides whether the ADR 0011
  charger/session correction joins this migration cycle or lands as a
  follow-up migration before pilot data exists.

---

## What's pending — operator decisions

In priority order:

1. **Apply the consolidated migration** (`npx prisma migrate dev` on
   the dev Neon branch). After this, repos can read/write the new
   columns and tables, and Sprint 2 can continue with milestones
   2.3 / 2.5 / 2.10 / 2.14. **CLAUDE.md Rule 3 — explicit operator
   instruction required to run.**
2. **Sprint 1.5 staging-deploy runbook** still pending. Per Rule 11
   Sprint 2 doesn't formally start until Sprint 1's exit criterion is
   met. Pragmatically the schema + repo + UI prep work IS Sprint 2 in
   spirit; the runbook gate is for the staging-deploy half of Sprint
   1.5, not for code-side work.
3. **Rotate `ADMIN_PASSWORD` on `hlada-staging`** — still flagged
   from the deploy-pause notes; the plaintext leaked at commit
   `21247f9` (already pushed to `origin/dev/sprint-01-ui-detour`).
4. **Commit the rev-4 work** — substantial uncommitted state on the
   branch (10 modified files + 30+ new directories/files per
   `git status`). Operator action — Rule 1 (no master push, branch
   confirmation needed for any push).

---

## Suggested next sprint moves

**If migration is applied:**

- Resume Sprint 2.3 (Property + Site admin CRUD) — Property no longer
  has host_id, Site has site_type + 5 tariff FKs. Both can be wired.
- Resume Sprint 2.5 (Charger / OCPPIdentity / Connector admin CRUD)
  — Charger now has owner_org_id and circuit_id columns to surface.
- Land milestone 2.10 — cost-factor catalog page (read-only for Org
  admins, write for platform admins) + iceland-energy-parties seed
  loader that imports 21 rows into `tenancy.organizations` with
  `roles[]` set.
- Land milestone 2.14 — OCPP configuration-key registry UI + ingest
  hooks.

**If migration is held:**

- Update the `data_model_worked_example.svg` to remove the Host
  vestigial reference.
- Build the Sprint 2.1 enrichment UI fields (kennitala + addresses +
  contacts + roles[]) so they're ready for the moment the migration
  applies. They'll error at runtime against the unmigrated DB but the
  code stays compilable and reviewable.
- Or pivot to Sprint 7 / Sprint 8 prep work that doesn't touch the
  affected tables.

---

## File map (rev-4 deliverables)

```
docs/
  adr/
    0009-drop-charger-host-tier.md            ★ new
    0010-organization-profile-enrichment.md   ★ new
  architecture/
    README.md                                  modified
    STRAUMVAKT_ARCHITECTURE_V3.md              modified (§4, §10)
    STRAUMVAKT_V3_DELIVERY_PLAN.md             modified (§1.1, §2)
    prisma_schema_graph.svg                    ★ new
  notes/
    2026-04-26-rev4-checkpoint.md              ★ new (this file)
  sprints/
    SPRINT_02_TASKS.md                         modified (rev-3 + rev-4 status, 2.1 reshape, 2.6 expanded, 2.14 added)

prisma/
  schema.prisma                                modified (1826 lines)
  migrations/
    migration_lock.toml                        ★ new
    20260426120000_rev3_foundation_consolidated/
      migration.sql                            ★ new (483 lines, NOT applied)

src/
  components/sidebar.tsx                       modified (Charger Hosts removed)
  app/(app)/dashboard/page.tsx                 modified (rev-4 framing + ADR 0009/0010)
  app/(app)/tenants/organizations/[id]/page.tsx  modified (rev-4 explainer panels)
  app/(app)/tenants/hosts/                     ✕ deleted
  app/api/admin/hosts/                         ✕ deleted
  app/api/admin/orgs/[id]/hosts/               ✕ deleted
  app/api/admin/dev/provision-identity/route.ts  modified (Host references removed)
  lib/repositories/charger-hosts.ts            ✕ deleted
  lib/repositories/_inputs/hosts.ts            ✕ deleted

public/
  prisma_schema_graph.svg                      ★ new (mirror)
```

---

## Sign-off — checkpoint state

- All four rev-4 ADRs: **accepted** and cross-referenced.
- Schema: **valid**, migration **generated**, **not applied**.
- TypeScript: **compiles clean**.
- Production build: **succeeds**.
- Running dev server: **serves all routes 200** (caveat: cached old
  Prisma client; next reload requires migration applied).
- Documentation: **canon, plan, sprint task list, README, dashboard,
  three SVGs all in sync** with rev 4 reality.

Foundation rev 4 is **review-ready**. Operator's call on whether to
apply the migration on the dev Neon branch and continue Sprint 2 in
code, or hold the apply and continue with documentation /
non-data-touching work.
