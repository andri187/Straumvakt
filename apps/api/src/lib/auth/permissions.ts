// Permission catalogue + role-to-permission bundles per ADR 0014.
//
// Sprint 4 milestone 4.2. The catalogue is ~30 atomic verbs covering
// the entire admin surface today. Roles are mapped to permission
// bundles in code — no DB rows for the mapping itself, since "what
// does role X allow?" is a system-wide rule, not a tenant concern.
//
// Milestone 4.3 wires `requirePermission(perm)` middleware that
// composes membership + platform grants via `effectivePermissions`
// below. Until then, this module exports the data; nothing reads it.
//
// Design notes:
//
// - Permissions are atomic strings of shape "<resource>.<action>".
//   No wildcards in the catalogue itself — wildcards only live in the
//   role-to-permission MAP for ergonomics ("super_user gets all
//   platform.*"). Routes always check a concrete verb.
//
// - MEMBERSHIP_ROLE_PERMISSIONS covers every value of MembershipRole
//   including the pre-ADR-0014 deprecated ones (operator | helper |
//   contractor | driver), to keep the exhaustive switch happy until
//   Sprint 9's RLS rebuild can retire them. Deprecated roles map to
//   their nearest new-bundle equivalent so existing rows don't lose
//   access.
//
// - PLATFORM_ROLE_PERMISSIONS is platform-side only (no per-tenant
//   verbs). super_user gets the entire platform.* set as a literal
//   list, NOT a wildcard, so a future addition to the platform
//   catalogue forces a deliberate decision about whether super_user
//   gets it (TS will surface the missing key).

import type {
  MembershipRole,
  PlatformRole,
} from "@straumvakt/shared/domain/users";

// ─────────────────────────────────────────────────────────────────────
// 1. Permission catalogue — ~30 atomic verbs
// ─────────────────────────────────────────────────────────────────────

export const PER_TENANT_PERMISSIONS = [
  "org.read",
  "org.write",

  "member.read",
  "member.invite",
  "member.write",
  "member.remove",

  "site.read",
  "site.write",
  "site.delete",

  "property.read",
  "property.write",
  "property.delete",

  "charger.read",
  "charger.write",
  "charger.config",
  "charger.remote_start",
  "charger.remote_stop",

  "billing.read",
  "billing.write",
  "billing.export",

  "tariff.read",
  "tariff.write",

  "contract.read",
  "contract.write",

  "audit.read",
] as const;

export const PLATFORM_PERMISSIONS = [
  "platform.tenant.read",
  "platform.tenant.write",
  "platform.tenant.delete",

  "platform.impersonate",
  "platform.support.action",

  "platform.feature_flag.read",
  "platform.feature_flag.write",

  "platform.tariff_catalogue.read",
  "platform.tariff_catalogue.write",

  "platform.migration.run",

  "platform.audit.read",

  "platform.finance.read",
  "platform.finance.write",

  "platform.grant.read",
  "platform.grant.write",
] as const;

export type PerTenantPermission = (typeof PER_TENANT_PERMISSIONS)[number];
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type Permission = PerTenantPermission | PlatformPermission;

// ─────────────────────────────────────────────────────────────────────
// 2. Building blocks — read-only and write bundles for the role map
// ─────────────────────────────────────────────────────────────────────

const READ_ALL: PerTenantPermission[] = [
  "org.read",
  "member.read",
  "site.read",
  "property.read",
  "charger.read",
  "billing.read",
  "tariff.read",
  "contract.read",
  "audit.read",
];

const VIEWER_BUNDLE: PerTenantPermission[] = [
  "org.read",
  "site.read",
  "charger.read",
  "property.read",
];

const TECHNICIAN_BUNDLE: PerTenantPermission[] = [
  ...VIEWER_BUNDLE,
  "charger.config",
  "charger.remote_start",
  "charger.remote_stop",
];

const MANAGER_BUNDLE: PerTenantPermission[] = [
  ...TECHNICIAN_BUNDLE,
  "site.write",
  "charger.write",
  "tariff.read",
  "contract.read",
  "member.read",
];

const ADMIN_BUNDLE: PerTenantPermission[] = [
  ...MANAGER_BUNDLE,
  "member.invite",
  "member.write",
  "member.remove",
  "billing.read",
  "billing.write",
  "tariff.write",
  "contract.write",
  "property.write",
  // audit is admin-and-up; viewer/manager/technician/finance don't see
  // audit logs (driver/contractor data privacy concern). support gets
  // it via the READ_ALL bundle.
  "audit.read",
];

const OWNER_BUNDLE: PerTenantPermission[] = [
  ...ADMIN_BUNDLE,
  "org.write",
  "site.delete",
  "property.delete",
  "billing.export",
];

const FINANCE_BUNDLE: PerTenantPermission[] = [
  ...VIEWER_BUNDLE,
  "billing.read",
  "billing.write",
  "billing.export",
  "contract.read",
  "contract.write",
  "tariff.read",
];

const SUPPORT_BUNDLE: PerTenantPermission[] = READ_ALL;

// ADR 0027 — going-public host self-management. Tenancy-scoped: manage
// the host's own drivers (invite + edit/suspend memberships) + read its
// billing + read its chargers/sites/property. No platform surface, no
// charger config, no tariff authoring (operator sets the negotiated
// terms), no member.remove.
const HOST_ADMIN_BUNDLE: PerTenantPermission[] = [
  ...VIEWER_BUNDLE,
  "member.read",
  "member.invite",
  "member.write",
  "billing.read",
];

// ─────────────────────────────────────────────────────────────────────
// 3. Role-to-permission map
// ─────────────────────────────────────────────────────────────────────

/**
 * Membership role → per-tenant permission bundle. Every value of the
 * `MembershipRole` enum (including pre-ADR-0014 deprecated values) has
 * an entry; an exhaustive-switch test in permissions.test.ts catches
 * any missing key on enum extension.
 *
 * Deprecated mappings: pre-ADR-0014 roles map to their nearest new
 * equivalent so existing memberships don't lose access on migration.
 * Operators reassign roles in Sprint 9 alongside the RLS rebuild
 * before the deprecated values are dropped from the enum.
 */
export const MEMBERSHIP_ROLE_PERMISSIONS: Record<
  MembershipRole,
  PerTenantPermission[]
> = {
  // ── ADR 0014 — primary bundles ────────────────────────────────────
  owner: OWNER_BUNDLE,
  admin: ADMIN_BUNDLE,
  manager: MANAGER_BUNDLE,
  technician: TECHNICIAN_BUNDLE,
  finance: FINANCE_BUNDLE,
  support: SUPPORT_BUNDLE,
  viewer: VIEWER_BUNDLE,

  // ── ADR 0027 — going-public host self-management (tenancy-scoped) ──
  host_admin: HOST_ADMIN_BUNDLE,

  // ── Pre-ADR-0014 — map to equivalent new bundles ──────────────────
  operator: MANAGER_BUNDLE, // operator was overloaded; manager is the closest non-org-edit role.
  helper: TECHNICIAN_BUNDLE,
  contractor: TECHNICIAN_BUNDLE, // contractors historically had remote_start/stop access.
  driver: [], // drivers shouldn't have memberships; if a row exists, no perms.
};

/**
 * Platform role → platform-permission bundle. Every value of the
 * `PlatformRole` enum has an entry; same exhaustive-switch test
 * coverage as above.
 *
 * Note: super_user gets a literal list of every platform.* verb, NOT
 * a wildcard. Adding a new platform permission to PLATFORM_PERMISSIONS
 * forces a deliberate decision about whether super_user gets it (the
 * exhaustive test will fail until super_user's bundle is updated).
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  super_user: [...PLATFORM_PERMISSIONS],

  platform_admin: [
    "platform.tenant.read",
    "platform.tenant.write",
    "platform.tenant.delete",
    "platform.impersonate",
    "platform.feature_flag.read",
    "platform.feature_flag.write",
    "platform.tariff_catalogue.read",
    "platform.tariff_catalogue.write",
    "platform.migration.run",
    "platform.audit.read",
    "platform.grant.read",
  ],

  support_agent: [
    "platform.tenant.read",
    "platform.impersonate",
    "platform.support.action",
    "platform.audit.read",
  ],

  sales_cs: [
    "platform.tenant.read",
    "platform.tenant.write", // column-restricted in repo layer (org notes/tags only)
    "platform.audit.read",
  ],

  finance_internal: [
    "platform.finance.read",
    "platform.finance.write",
    "platform.tenant.read",
  ],

  auditor: ["platform.tenant.read", "platform.audit.read"],
};

// ─────────────────────────────────────────────────────────────────────
// 4. Pure effective-permissions resolver
// ─────────────────────────────────────────────────────────────────────

/**
 * Tiny shape the resolver consumes. The middleware in milestone 4.3
 * wraps this with the actual DB lookups (active Membership for the
 * user×org, active PlatformGrant for the user) and feeds the result.
 *
 * Membership.status='active' is the only state that grants permissions;
 * 'invited' is pre-acceptance, 'suspended' is paused, 'revoked' is
 * gone. Same for PlatformGrant.status. Caller filters out non-active
 * rows before calling.
 *
 * PlatformGrant.expiresAt is enforced by the caller too (auditor /
 * support_agent grants are time-limited per ADR 0014). When the
 * caller decides a grant is "active" it's already passed expiry.
 */
export interface ActiveMembership {
  role: MembershipRole;
  // Optional scope narrowing — caller applies these at the repo
  // layer to filter site/property reads. The permission set
  // returned here doesn't change based on scope; permission checks
  // operate on the verb, scope checks operate on the row.
  scopeSiteIds?: string[];
  scopePropertyIds?: string[];
}

export interface ActivePlatformGrant {
  role: PlatformRole;
}

/**
 * Returns the union of the membership and platform-grant permission
 * bundles, deduplicated. Pure function — no DB calls; the caller
 * looks up the rows and passes the active ones in.
 *
 * If `membership` is null AND `platformGrant` is null, returns [];
 * the user has no relationship to this org and isn't platform staff.
 *
 * Permission set is order-stable and unique. Order: per-tenant verbs
 * in catalogue order, then platform verbs in catalogue order.
 */
export function effectivePermissions(
  membership: ActiveMembership | null,
  platformGrant: ActivePlatformGrant | null,
): Permission[] {
  const seen = new Set<Permission>();
  const out: Permission[] = [];

  if (membership) {
    for (const p of MEMBERSHIP_ROLE_PERMISSIONS[membership.role]) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  if (platformGrant) {
    for (const p of PLATFORM_ROLE_PERMISSIONS[platformGrant.role]) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Convenience: does the effective set include the given verb?
 * The middleware in 4.3 uses this on the hot path.
 */
export function hasPermission(
  perms: Permission[],
  needed: Permission,
): boolean {
  return perms.includes(needed);
}
