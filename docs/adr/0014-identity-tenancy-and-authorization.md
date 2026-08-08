# ADR 0014 — Identity, Tenancy, and Authorization

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Proposed
**Date:** 2026-05-01
**Sprint:** documentation lands immediately; per-tenant membership + permission work targets Sprint 4; platform-staff role split + invite flow target Sprint 5; Postgres RLS + audit-append-only enforcement target Sprint 9.
**Supersedes (in part):** [ADR 0010](./0010-organization-profile-enrichment.md) — this ADR refines the `OrganizationRole` enum (trims to OCPI-aligned set + contractor flags) and introduces the `MembershipRole` + `PlatformRole` enums that ADR 0010 anticipated but did not specify.
**Relates to:** [ADR 0001](./0001-v3-foundation-schema.md) (User/Membership/PlatformAdmin shape), [ADR 0006](./0006-pilot-scope-rev2-2026-04-25.md) (roles inert during pilot — this ADR ends that), [ADR 0008](./0008-cost-center-splitting.md) (DriverContract anchors the driver audience), [ADR 0013](./0013-split-ui-api-do-queues.md) (the API Worker hosts the auth + permission middleware).

## Context

Straumvakt has a working `User`, `Membership`, `PlatformAdmin`, and `Organization.roles` shape from Sprint 0 and ADR 0010. The shape is correct but underspecified:

- **`Membership.role`** is a free-form string. Routes guard with `requireAdmin` (a binary check). There is no role enum, no permission catalogue, no concept of scoped membership ("limit Anna to Site X").
- **`Organization.roles`** is a 21-value Postgres enum (ADR 0010). No code in the codebase reads it for behaviour today — it is descriptive metadata only.
- **`PlatformAdmin`** is a binary grant. Straumvakt staff are either platform admin or not. There is no differentiation between `super_user`, `support_agent`, `auditor` etc., and no impersonation primitive.
- **No invite flow exists.** Users are created directly via `POST /api/admin/users`. There is no concept of "invited but not yet accepted." Drivers do not have a self-registration path either.
- **Audience is implicit.** `User` is polymorphic across Straumvakt-staff, customer-org operators, contractors, and (eventually) drivers, but nothing on the row tells the system which.

These gaps will block:

- Real customer onboarding (no invite flow → admins can't bring on their team).
- Sprint 5+ mobile app (no driver self-registration → no driver audience separation).
- Sprint 9 security hardening (no permission model → can't tighten guards beyond `requireAdmin`).
- Sprint 11 enterprise API (no scoped credential model → can't issue API keys with limited reach).

This ADR specifies the four-layer architecture (Identity → Audience → Tenancy → Authorization), the Straumvakt-staff escape hatch (Platform layer), and the agent-vs-user provenance distinction that disambiguates how a `User` row was created.

## Decision

Adopt a layered identity-and-access model with five concerns separated:

```
┌─ Identity ─────────────────────────────────────────────────────────┐
│  Person → Credentials (password | passkey | oauth_* | otp |        │
│                        magic_link | api_key)                       │
└────────────────────────────────────────────────────────────────────┘
                       ↓
┌─ Audience + Provenance ────────────────────────────────────────────┐
│  audience: operator | driver                                       │
│  provenance: invited (agent) | self_registered (user / driver)     │
│    — derived from active Membership presence + audience flag       │
└────────────────────────────────────────────────────────────────────┘
                       ↓
┌─ Tenancy ──────────────────────────────────────────────────────────┐
│  Organization (typed: cpo | emsp | hub | host | service_contractor │
│                       | installer | …)                             │
│    ├─ Membership (User × Org × MembershipRole × scope × lifecycle) │
│    └─ DriverContract (Driver-User × payer-Org × tariff)            │
│  PlatformGrant (User × PlatformRole) — Straumvakt-staff override   │
└────────────────────────────────────────────────────────────────────┘
                       ↓
┌─ Authorization (PBAC) ─────────────────────────────────────────────┐
│  Permission catalogue (~30 atomic verbs: org.write,                │
│  charger.remote_start, billing.export, platform.tenant.read, …)    │
│  Role bundles permissions; code checks permissions, never roles    │
│  Scope narrows permissions per-Membership (siteIds, propertyIds)   │
└────────────────────────────────────────────────────────────────────┘
                       ↓
┌─ Audit ────────────────────────────────────────────────────────────┐
│  AuditAction (append-only); every privileged write emits a row     │
│  Tenant admins see "who from Straumvakt accessed our data"         │
└────────────────────────────────────────────────────────────────────┘
```

## Detailed design

### Layer 1 — Identity

`User` stays as the single identity row. `UserCredential` becomes a polymorphic table with a `kind` discriminator:

```prisma
enum CredentialKind {
  password
  passkey            // WebAuthn
  oauth_google
  oauth_microsoft
  magic_link
  otp                // SMS / TOTP
  api_key            // service principals (Sprint 11)

  @@schema("identity")
}

model UserCredential {
  id           String         @id @default(uuid()) @db.Uuid
  userId       String         @map("user_id") @db.Uuid
  kind         CredentialKind
  passwordHash String?        @map("password_hash")        // kind=password
  publicKey    Bytes?         @map("public_key")           // kind=passkey
  externalSub  String?        @map("external_sub")         // kind=oauth_*
  apiKeyHash   String?        @map("api_key_hash")         // kind=api_key
  scopes       String[]       @default([])                 // kind=api_key
  status       CredentialStatus @default(active)
  lastUsedAt   DateTime?      @map("last_used_at") @db.Timestamptz(6)
  expiresAt    DateTime?      @map("expires_at") @db.Timestamptz(6)
  createdAt    DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, kind])
  @@index([externalSub])
  @@map("user_credentials")
  @@schema("identity")
}
```

A user can hold multiple credentials simultaneously (password + passkey + Google SSO). Login resolves any of them to the same `User` row.

Per-audience login UX:

| Audience | Day-1 credentials | Future |
|---|---|---|
| Operator (web portal) | `password` | + `oauth_google`, `oauth_microsoft`, `passkey` |
| Driver (mobile app) | `otp` (phone), `magic_link` (email) | + `passkey`, biometric on-device |
| Platform staff | `password` + mandatory `passkey` (MFA) | TOTP fallback |
| Service principal (Sprint 11) | `api_key` with scopes | rotation procedure |

### Layer 2 — Audience and Provenance

Two new fields on `User`:

```prisma
enum UserAudience {
  operator     // web portal users acting on behalf of an Org
  driver       // mobile app end-users (consumers of charging)

  @@schema("identity")
}

model User {
  // ... existing fields ...
  audience  UserAudience @default(operator)
}
```

**Provenance** is derived from relations, not stored as a column:

- `User` is an **Agent** if they have ≥1 active `Membership`. Agent provenance is captured by `Membership.invitedBy / invitedAt / acceptedAt`.
- `User` is a **Driver-user** if `audience = 'driver'` AND no active `Membership`.
- A single User can hold both — an Agent who also charges their own EV. This is correct and supported.

Why derived rather than a `provenance` column: a single human can legitimately be an agent (works at a customer org) AND a driver (drives an EV, uses the app). One `provenance` field forces a single answer when reality has two. Relations carry the truth.

The naming distinction:

| Term | Definition |
|---|---|
| **Agent** | A `User` invited by an Org (top-down). Has an active `Membership` with `invitedBy / invitedAt / acceptedAt`. Acts on behalf of the inviting org. |
| **Driver** | A `User` with `audience='driver'` who self-registered through the mobile app (bottom-up). Does not belong to any org; holds `DriverContract` rows for billing. |
| **User** | The abstract `User` row in the database. "User" is the schema primitive; "Agent" and "Driver" describe how a User came to exist. |
| **Platform staff** | A `User` (any audience) holding a `PlatformGrant`. Operates the platform itself. |

### Layer 3 — Tenancy

#### Organization role taxonomy (trimmed)

ADR 0010's 21-value `OrganizationRole` enum trims to an OCPI-aligned set with explicit contractor flags. Values that turned out to be billing concepts (`payer`, `beneficiary`, `customer`) move to `Contract` / `CostCenter` / `DriverContract`, where they were always going to live anyway:

```prisma
enum OrganizationRole {
  cpo                   // Charge Point Operator (OCPI)
  emsp                  // E-Mobility Service Provider (OCPI)
  hub                   // Roaming hub (OCPI)
  nsp                   // Navigation/data provider (OCPI)
  site_host             // Owns the parking/building
  service_contractor    // Performs maintenance / installation
  installer             // Sub-set of service_contractor; physical install
  vendor                // Hardware vendor (Zaptec, Easee, …)
  regulator             // Regulatory body (Orkustofnun, …)
  dso                   // Distribution System Operator
  tso                   // Transmission System Operator
  retailer              // Electricity retailer
  payment_processor     // Stripe, Adyen, …

  @@schema("tenancy")
}
```

Removed from ADR 0010's set: `csms_provider`, `operator`, `asset_owner`, `payer`, `beneficiary`, `customer`, `producer`, `aggregator`, `public_charging`, `home_charging`, `roaming_hub`, `insurance_provider`. Reasons:

- `csms_provider` = Straumvakt itself; not a tenant.
- `operator` overloaded with personnel role; CPO covers the org-level meaning.
- `asset_owner` / `payer` / `beneficiary` / `customer` are billing relationships, not org identity. They live on `Contract` / `CostCenter`.
- `producer` / `aggregator` / `public_charging` / `home_charging` are operational profiles, not tenant identity. Drop until a use case demands them.
- `roaming_hub` collapses to `hub`.
- `insurance_provider` has no behaviour wired; drop until needed.

The trimmed enum has 13 values, all of which can drive UI section visibility and report filters.

#### Membership

```prisma
enum MembershipRole {
  owner       // Full org access incl. billing + member management. 1–2 per org.
  admin       // Operational + member-management.
  manager     // Operational; no member-management.
  technician  // Read + remote commands + charger config.
  finance     // Billing, contracts, exports. No fleet ops.
  support     // Read-only across the org.
  viewer      // Read-only general.

  @@schema("tenancy")
}

enum MembershipStatus {
  invited
  active
  suspended
  revoked

  @@schema("tenancy")
}

model Membership {
  id               String           @id @default(uuid()) @db.Uuid
  userId           String           @map("user_id") @db.Uuid
  orgId            String           @map("org_id") @db.Uuid
  role             MembershipRole
  status           MembershipStatus @default(invited)

  // Lifecycle (provenance audit trail)
  invitedById      String?          @map("invited_by_id") @db.Uuid
  invitedAt        DateTime?        @map("invited_at") @db.Timestamptz(6)
  acceptedAt       DateTime?        @map("accepted_at") @db.Timestamptz(6)
  suspendedAt      DateTime?        @map("suspended_at") @db.Timestamptz(6)
  revokedAt        DateTime?        @map("revoked_at") @db.Timestamptz(6)

  // Optional scope narrowing — empty = full org access
  scopeSiteIds     String[]         @map("scope_site_ids") @db.Uuid
  scopePropertyIds String[]         @map("scope_property_ids") @db.Uuid

  createdAt        DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  user             User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  org              Organization     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  invitedBy        User?            @relation("MembershipInviter", fields: [invitedById], references: [id])

  @@unique([userId, orgId])
  @@index([orgId, status])
  @@map("memberships")
  @@schema("tenancy")
}
```

Backfill plan: existing Memberships set `role = "admin"`, `status = "active"`, `acceptedAt = createdAt`.

#### DriverContract (no schema change)

Drivers attach to payer-orgs via the existing `DriverContract` model. They do **not** get a `Membership`. Their identity row in `User` carries `audience = 'driver'`.

#### PlatformGrant (replaces `PlatformAdmin`)

```prisma
enum PlatformRole {
  super_user         // Founders, CTO. Can mint/revoke platform grants.
  platform_admin     // Lead engineers / on-call. Full cross-tenant ops.
  support_agent      // Read all tenants + impersonate + password-reset. No tenant writes.
  sales_cs           // Read tenants + write only on org notes/tags/contract metadata.
  finance_internal   // Straumvakt's own books (MRR, ARR, churn). NOT customer billing.
  auditor            // Read-only across everything. Time-limited via expiresAt.

  @@schema("identity")
}

enum PlatformGrantStatus {
  active
  suspended
  revoked

  @@schema("identity")
}

model PlatformGrant {
  userId        String              @id @map("user_id") @db.Uuid
  role          PlatformRole
  status        PlatformGrantStatus @default(active)
  grantedById   String?             @map("granted_by_id") @db.Uuid
  grantedAt     DateTime            @default(now()) @map("granted_at") @db.Timestamptz(6)
  expiresAt     DateTime?           @map("expires_at") @db.Timestamptz(6)
  revokedAt     DateTime?           @map("revoked_at") @db.Timestamptz(6)
  revokedById   String?             @map("revoked_by_id") @db.Uuid

  // Optional scope (e.g. {"tenantIds": [...]} for limited-tenant access)
  scope         Json?

  user          User @relation("PlatformGrantUser", fields: [userId], references: [id], onDelete: Cascade)
  grantedBy     User? @relation("PlatformGrantedBy", fields: [grantedById], references: [id])
  revokedBy     User? @relation("PlatformGrantRevokedBy", fields: [revokedById], references: [id])

  @@map("platform_grants")
  @@schema("identity")
}
```

Replaces the existing `PlatformAdmin` table. Migration: backfill all `PlatformAdmin` rows as `role = 'platform_admin'`, drop the old table, fix relation names on `User`.

### Layer 4 — Authorization (PBAC)

#### Permission catalogue

Atomic verbs, named `<resource>.<action>`. ~30 permissions cover the entire surface area of the system today:

```
Per-tenant (operator-side) permissions:
  org.read              org.write
  member.read           member.invite        member.write       member.remove
  site.read             site.write           site.delete
  property.read         property.write       property.delete
  charger.read          charger.write        charger.config
  charger.remote_start  charger.remote_stop
  billing.read          billing.write        billing.export
  tariff.read           tariff.write
  contract.read         contract.write
  audit.read

Platform-side (Straumvakt staff) permissions:
  platform.tenant.read           // cross-tenant read
  platform.tenant.write          // cross-tenant write
  platform.tenant.delete         // destructive
  platform.impersonate
  platform.support.action        // password reset, kick session, etc.
  platform.feature_flag.read     platform.feature_flag.write
  platform.tariff_catalogue.read platform.tariff_catalogue.write
  platform.migration.run
  platform.audit.read
  platform.finance.read          platform.finance.write   // Straumvakt's own books
  platform.grant.read            platform.grant.write     // mint platform grants
```

Permissions are atomic strings — no hierarchy, no wildcards in the catalogue itself (wildcards live only in role-to-permission mapping for ergonomics).

#### Role-to-permission map (in code, not DB)

`apps/api/src/lib/auth/permissions.ts`:

```ts
export const MEMBERSHIP_ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  owner:      [...],  // every per-tenant permission
  admin:      [...MANAGER, "member.invite", "member.write", "member.remove", "billing.write"],
  manager:    [...TECHNICIAN, "site.write", "charger.write", "tariff.read", "contract.read"],
  technician: [...VIEWER, "charger.config", "charger.remote_start", "charger.remote_stop"],
  finance:    [...VIEWER, "billing.read", "billing.write", "billing.export"],
  support:    [...ALL_READ_PERMS],
  viewer:     ["org.read", "site.read", "charger.read", "property.read"],
};

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, Permission[]> = {
  super_user:       [/* all platform.* */],
  platform_admin:   ["platform.tenant.read", "platform.tenant.write", "platform.tenant.delete",
                     "platform.impersonate", "platform.feature_flag.write",
                     "platform.tariff_catalogue.write", "platform.migration.run",
                     "platform.audit.read"],
  support_agent:    ["platform.tenant.read", "platform.impersonate",
                     "platform.support.action", "platform.audit.read"],
  sales_cs:         ["platform.tenant.read", "platform.tenant.write",
                     "platform.audit.read"],  // column-restricted in repo layer
  finance_internal: ["platform.finance.read", "platform.finance.write",
                     "platform.tenant.read"],
  auditor:          ["platform.tenant.read", "platform.audit.read"],
};
```

#### Effective-permission resolution

For a request from `User U` against `Org O`:

```
effectivePermissions(U, O) =
    MEMBERSHIP_ROLE_PERMISSIONS[ M.role ]   if M = activeMembership(U, O)
  ∪ PLATFORM_ROLE_PERMISSIONS[ G.role ]     if G = activePlatformGrant(U)
```

If `M.scopeSiteIds` is non-empty, narrow site/charger/property permissions to those scope IDs at the repo layer.

#### Route guards

Replace `requireAdmin` with `requirePermission(perm)`:

```ts
adminChargers.post(
  "/:ocppIdentityId/remote-start",
  requirePermission("charger.remote_start"),
  async (c) => { /* ... */ }
);
```

Migrate one route group at a time. `requireAdmin` stays during the transition; both can compose.

### Layer 5 — Audit

`AuditAction` already exists. Tighten:

- Append-only at DB level: revoke `UPDATE` and `DELETE` from the application role on `audit.audit_actions` (Sprint 9).
- Every privileged write emits an `AuditAction` row in the same transaction.
- Permission denials emit audit rows too (security signal).
- Impersonation rows record both `actor_user_id` (the support agent) and `acting_as_user_id` (the impersonated user).
- Tenant admins see `audit.read`-gated rows of "who from Straumvakt accessed our data" — transparency, removes the "what are they doing in there" suspicion.

## Sidebar navigation reflecting this model

```
Operations            ← physical infrastructure
  ├── Sites
  ├── Installations
  ├── Circuits
  └── Chargers

Tenants               ← all actors in the system
  ├── Organizations
  ├── Agents          ← Users with active Memberships
  │     filter chip: Organization | Contractor | All
  └── Drivers         ← Users with audience='driver'

Onboard               (existing)
Reference             (existing)
Billing               (existing)
Mobile app            (existing)

Platform              ← visible only to PlatformGrant holders
  ├── Tenant overview        (cross-tenant dashboard)
  ├── Platform users         (manage PlatformGrants)
  ├── Feature flags
  ├── Audit log
  └── Tariff catalogue       (system-wide reference)
```

Properties moves under Operations. The combined `/tenants` mash-up view is dropped (redirect to `/tenants/organizations`). `/people/users` redirects to `/tenants/agents`.

## Schema delta summary

```diff
+ enum CredentialKind { password | passkey | oauth_google |
+                      oauth_microsoft | magic_link | otp | api_key }
+ enum UserAudience { operator | driver }
+ enum MembershipRole { owner | admin | manager | technician |
+                      finance | support | viewer }
+ enum MembershipStatus { invited | active | suspended | revoked }
+ enum PlatformRole { super_user | platform_admin | support_agent |
+                    sales_cs | finance_internal | auditor }
+ enum PlatformGrantStatus { active | suspended | revoked }

  model User {
+   audience UserAudience @default(operator)
  }

  model UserCredential {
+   kind          CredentialKind
+   publicKey     Bytes?
+   externalSub   String?
+   apiKeyHash    String?
+   scopes        String[]
+   status        CredentialStatus
+   lastUsedAt    DateTime?
+   expiresAt     DateTime?
  }

  model Membership {
-   role  String
+   role             MembershipRole
+   status           MembershipStatus
+   invitedById      String?
+   invitedAt        DateTime?
+   acceptedAt       DateTime?
+   suspendedAt      DateTime?
+   revokedAt        DateTime?
+   scopeSiteIds     String[]
+   scopePropertyIds String[]
  }

  enum OrganizationRole {
-   csms_provider | operator | asset_owner | payer | beneficiary |
-   customer | producer | aggregator | public_charging |
-   home_charging | roaming_hub | insurance_provider
+   site_host | installer
    // kept: cpo | emsp | hub | nsp | service_contractor | vendor |
    // regulator | dso | tso | retailer | payment_processor
  }

- model PlatformAdmin
+ model PlatformGrant {
+   role          PlatformRole
+   status        PlatformGrantStatus
+   expiresAt     DateTime?
+   revokedAt     DateTime?
+   revokedById   String?
+   scope         Json?
+ }
```

All deltas are additive on `User`, `UserCredential`, `Membership`. The `OrganizationRole` enum trim is non-additive (drops values); requires a manual migration to remap any existing rows that hold dropped values. Today the enum has zero readers, so the only cost is mechanical enum-value removal in Postgres — no application logic changes.

`PlatformAdmin` → `PlatformGrant` is a rename + extend; backfill all rows as `role = 'platform_admin'`.

## Build order

```
NOW (Sprint 3 finish, with the Org reshape ADR work):
  • Trim OrganizationRole enum.
  • Document the four-layer model in this ADR (this document).

Sprint 4 (membership + permissions foundation):
  • MembershipRole + MembershipStatus enums.
  • Membership lifecycle fields (invitedBy, invitedAt, acceptedAt, suspendedAt, revokedAt, scope*).
  • UserAudience enum + User.audience field.
  • PlatformGrant table (rename PlatformAdmin, add role + lifecycle).
  • Permission catalogue + role-to-permission map in code.
  • requirePermission(perm) middleware in apps/api.
  • Migrate /api/admin route guards from requireAdmin to permission checks
    (one route group at a time; requireAdmin stays during transition).
  • Sidebar restructure (Tenants reframe; Properties → Operations).

Sprint 5 (invite + driver self-registration):
  • Agent invite flow:
      POST /api/admin/orgs/:orgId/invitations  (admin sends invite)
      GET  /api/public/accept-invite/:token    (recipient lands)
      POST /api/public/accept-invite/:token    (recipient confirms + sets credential)
  • Driver self-registration flow:
      POST /api/public/signup                   (phone/email + verification)
      POST /api/public/verify-otp
  • UserCredential polymorphic kinds: password, magic_link, otp.
  • UI: invite-email template, accept-invite landing page, driver app signup screens.
  • Impersonation flow (audit + session swap + max duration).

Sprint 9 (security hardening):
  • Postgres RLS as defense-in-depth on per-tenant tables.
  • AuditAction append-only enforcement via revoked UPDATE/DELETE on audit role.
  • MFA mandatory for PlatformGrant holders (passkey or TOTP).
  • Tenant-visible "who from Straumvakt accessed us" audit panel.
  • UserCredential kinds: passkey, oauth_google, oauth_microsoft for operators.
  • JIT elevation for super_user (re-prompt MFA on grant.write).

Sprint 11 (enterprise API):
  • UserCredential kind: api_key with scopes (subset of permissions).
  • Per-key rate limits + per-key audit log.
  • Key rotation procedure documented.
```

## Consequences

### Positive

- Permission checks become explicit and reviewable. Adding a route is "wire `requirePermission(...)`" instead of "remember to call `requireAdmin`."
- Operators can finally invite their team. Closes the v1 onboarding gap.
- Drivers self-register without an admin in the loop.
- Straumvakt staff get differentiated privileges. Support can do support without being able to corrupt tariffs.
- Audit becomes a real product surface (tenant-visible "who accessed us") rather than backend trivia.
- Enterprise API has a clean credential model when Sprint 11 lands.

### Negative / costs

- Schema migration touches `Membership`, `User`, `UserCredential`, `OrganizationRole`, replaces `PlatformAdmin`. Several files. One coordinated migration window.
- All admin routes need to migrate guards. ~30 routes; mechanical work but spans a sprint.
- Frontend role-aware visibility (sidebar, tabs, action buttons) becomes more conditional. UX testing matters.
- `OrganizationRole` enum trim drops values that may be in use in test data or future docs. Requires careful cutover.

### Out of scope (documented for forward reference)

- Driver audience split into a separate `Driver` model. Staying with discriminated `User` table per the audience flag. Re-evaluate when the mobile app exits pilot and driver volume justifies the migration cost.
- Cross-org data sharing (e.g., a contractor agent who works at three customer orgs simultaneously). Already supported via multiple Memberships on one User; no further design needed.
- Organization-level SSO enforcement ("all Festi staff must use Microsoft Entra"). Useful but defer to Sprint 9+ when first customer asks.
- Identity federation across CPMS platforms (eRoaming OCPI tokens). OCPI handles this at the protocol layer; not part of this ADR.

## Open questions

1. **Should agents be able to hold platform grants?** The current design says yes (a Straumvakt support engineer might also be a member of a test customer org for QA). Some shops require strict separation. Recommend allow it but log impersonation prominently.
2. **MFA enforcement timing** — required for PlatformGrant holders from day 1, or grace period? Recommend: required at first login after Sprint 4 cutover; no grandfathering.
3. **Soft-delete vs hard-delete on User**. Operators get soft-delete (`UserStatus.deleted`) to preserve audit trail. Drivers get hard-delete on GDPR request. Confirm.
4. **`AuditAction` retention.** Audit rows currently have no purge. Recommend: retain platform-write actions indefinitely; per-tenant rows for 7 years (matches Iceland VAT records); permission-denial events for 1 year.

## References

- OCPI 2.2.1 — role taxonomy alignment.
- ISO 27001 — access control principles backing the role-permission separation.
- GDPR Articles 15–17 — driver data subject rights informing the soft-vs-hard delete split.
- Auth0 / Stripe / GitHub Enterprise — industry references for the platform-staff-as-peer-of-tenants pattern.
