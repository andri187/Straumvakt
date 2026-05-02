# Sprint 4 — Membership + Permissions Foundation · Task List

**Status:** ACTIVE — entry condition: Sprint 3 closure list checked.
**Branch:** `dev/sprint-04-membership-permissions` (cut from `staging`).

> Scope per [ADR 0014](../adr/0014-identity-tenancy-and-authorization.md)
> §"Sprint 4 (membership + permissions foundation)" + Sprint 3
> carry-forward (production cutover for events ingest, per-installation
> `enforceAuthorize` flag). The previous Sprint 4 (Data Storage
> Lifecycle) slipped to Sprint 6 — see [delivery plan §7](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#7-sprint-4--membership--permissions-foundation-adr-0014-build-order)
> for the why.

---

## Milestone 4.1 — Membership / Platform schema additions

> Rule 4 file (prisma/schema.prisma) — explicit operator instruction
> per edit. Additive only.

- [ ] `MembershipRole` enum (owner | admin | manager | technician |
      finance | support | viewer)
- [ ] `MembershipStatus` enum (invited | active | suspended | revoked)
- [ ] `Membership` lifecycle fields:
  - [ ] `invitedById` (UUID, nullable, FK → User)
  - [ ] `invitedAt`, `acceptedAt`, `suspendedAt`, `revokedAt` (timestamptz, nullable)
  - [ ] `scopeSiteIds` (UUID array)
  - [ ] `scopePropertyIds` (UUID array)
- [ ] `Membership.role` migrate from `String` → `MembershipRole`
- [ ] `PlatformRole` enum (super_user | platform_admin | support_agent |
      sales_cs | finance_internal | auditor)
- [ ] `PlatformGrantStatus` enum (active | suspended | revoked)
- [ ] `PlatformGrant` model (replaces `PlatformAdmin`):
  - [ ] `userId` (PK, FK → User)
  - [ ] `role` (PlatformRole)
  - [ ] `status` (PlatformGrantStatus)
  - [ ] `grantedById`, `grantedAt`, `expiresAt`, `revokedAt`,
        `revokedById`
  - [ ] `scope` (Json, nullable)
- [ ] Migration: backfill `PlatformAdmin` rows → `PlatformGrant` with
      `role='platform_admin'` before dropping the old table
- [ ] Migration: backfill `Membership.role` strings → enum values
      (currently free-form; default to `'admin'` for any unrecognised
      value)

## Milestone 4.2 — Permission catalogue + role-to-permission map

- [ ] `apps/api/src/lib/auth/permissions.ts` with the ~30 atomic
      verbs from ADR 0014 §"Permission catalogue":
  - [ ] Per-tenant verbs: org.* / member.* / site.* / property.* /
        charger.* / billing.* / tariff.* / contract.* / audit.read
  - [ ] Platform verbs: platform.tenant.* / platform.impersonate /
        platform.support.action / platform.feature_flag.* /
        platform.tariff_catalogue.* / platform.migration.run /
        platform.audit.read / platform.finance.* / platform.grant.*
- [ ] `MEMBERSHIP_ROLE_PERMISSIONS: Record<MembershipRole, Permission[]>`
      with the bundles from ADR 0014 §"Role-to-permission map"
- [ ] `PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, Permission[]>`
- [ ] Exhaustive-switch test that every enum value has an entry
- [ ] `effectivePermissions(userId, orgId)` resolver (returns the union
      of MEMBERSHIP_* + PLATFORM_*; narrows by `Membership.scope*`
      arrays at the repo layer downstream)

## Milestone 4.3 — `requirePermission` middleware + admin-route migration

- [ ] `apps/api/src/lib/auth/require-permission.ts` middleware
- [ ] Tenant resolution from session + path param (`:orgId`)
- [ ] Migrate `apps/api/src/routes/admin/*` routes to
      `requirePermission(...)`:
  - [ ] orgs (read/write/delete)
  - [ ] sites + properties + installations + circuits
  - [ ] chargers (read/write/config/remote_start/remote_stop)
  - [ ] users + memberships + tokens (read/write/invite/remove)
  - [ ] vendor-credentials + zaptec + onboarding
  - [ ] groups + pending-discoveries
- [ ] Per-route test: minimal-permission user → 200; insufficient
      user → 403
- [ ] Grep for any remaining `requireAdmin` in apps/api/src/routes/admin
- [ ] Remove `requireAdmin` once the last route is migrated

## Milestone 4.4 — Sidebar restructure (Operations / Tenants / Platform)

- [ ] `src/components/sidebar.tsx` — three top-level groups:
  - [ ] Operations → Sites, Installations, Circuits, Chargers, Properties
  - [ ] Tenants → Organizations, Agents, Drivers (filter chips)
  - [ ] Platform → Tenant overview, Platform users, Feature flags,
        Audit log, Tariff catalogue (visible only to PlatformGrant holders)
- [ ] `src/components/section-tabs.tsx` — TENANTS_TABS / OPERATIONS_TABS
      / PLATFORM_TABS
- [ ] Properties moves from `/people/properties` (or wherever) to
      `/operations/properties`
- [ ] `/tenants` mash-up dropped, redirect to `/tenants/organizations`
- [ ] `/people/users` redirects to `/tenants/agents` (with Drivers
      filter chip set)
- [ ] Role-aware visibility: Platform group renders only when the
      user's effective permissions include any `platform.*` verb
- [ ] Manual smoke: three test users (operator member, platform
      admin, no-perms — sidebar renders correctly for each)

## Milestone 4.5 — Production cutover for events-ingest path

> Atomic deploy. Sequence: API mounts new URL → smoke → gateway URL
> flip → smoke → UI Worker route delete → smoke.

- [ ] Mount `/api/internal/ocpp-events` on apps/api **in addition
      to** the existing `/api/ocpp/events` (dual-mount for cutover)
- [ ] Update `gateway/src/ingest-client.ts` URL → `/api/internal/ocpp-events`
- [ ] Update `gateway/wrangler.jsonc` production binding:
      `services[0].service: "hlada"` → `"hlada-api"`
- [ ] Production gateway redeploys against `hlada-api`
- [ ] Smoke: `OcppIdentity.lastSeenAt` ticks on Heartbeat;
      `Connector.status` flips on StatusNotification;
      `ChargeSession` row appears on StartTransaction
- [ ] DELETE UI-Worker-side files in same change as URL-rename:
  - [ ] `src/app/api/ocpp/events/route.ts`
  - [ ] `src/lib/ocpp/event-envelope.ts` (+ test)
  - [ ] `src/lib/ocpp/projections.ts` (+ test)
  - [ ] `src/lib/ocpp/bootstrap.ts`
  - [ ] `src/lib/ocpp/ingest-auth.ts` (+ test)
  - [ ] `src/lib/repositories/events.ts` (+ test)
  - [ ] `src/lib/ocpp/boundary.test.ts` (its allowlist will need to
        scan apps/api now — port the test there or drop it)
- [ ] Drop the old `/api/ocpp/events` mount on apps/api once the
      gateway URL flip is live

## Milestone 4.6 — `Installation.enforceAuthorize` flag

- [ ] Schema: `Installation.enforceAuthorize` (boolean, default false).
      Rule 4 — additive.
- [ ] API authorize response carries the flag alongside the verdict
- [ ] Gateway DO honours the flag: when `true`, replies per verdict
      (Accepted only on `verdict: "Accepted"`); when `false`, replies
      `Accepted` regardless (today's shadow-mode behaviour)
- [ ] Operator UI on `/sites/[id]` to flip the flag with a confirm
      dialog (warns: "with auth required, only seeded RFIDs can charge")
- [ ] Tests: per-installation flag flip; verdict path covers all four
      verdicts (Accepted / Blocked / Expired / Invalid)
- [ ] Operator hand-test: flip Dalvegur to `enforceAuthorize=true`
      after IdToken table is verified seeded; charge with a known
      RFID → success; charge with an unknown RFID → reject

---

**Risks:**
- 4.1 schema migration: irreversible backfill of `PlatformAdmin` →
  `PlatformGrant`. Test against scratch branch first; verify row
  count matches.
- 4.3 route migration: easy to miss one route. Run a grep audit
  before claiming the milestone done.
- 4.5 atomic deploy: gateway and api must deploy together with
  pre-confirmed URL routing. Schedule a window when chargers aren't
  in active use.
- 4.6 enforceAuthorize flip: customer-impacting if seeded RFIDs are
  incomplete. Backfill report (Sprint 3 dashboard button) is the
  pre-flip checklist.

**Out of scope:** invite flow + driver self-registration (Sprint 5),
impersonation (Sprint 5), Postgres RLS (Sprint 9), AuditAction
append-only enforcement (Sprint 9), MFA on PlatformGrant (Sprint 9),
Data Storage Lifecycle (Sprint 6).
