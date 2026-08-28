// DB-touching effective-permissions resolver. Wraps the pure resolver
// from ./permissions with the actual Membership + PlatformGrant
// lookups, plus the platform.tenant.* expansion (Recommendation A
// from the milestone-4.3 design proposal — see
// docs/notes/2026-05-02-permission-hierarchy-review.md for the
// trade-off and revisit triggers).
//
// Sprint 4 milestone 4.3.

import { and, eq } from "drizzle-orm";
import type { Db } from "../drizzle";
import { memberships, platformGrants } from "@straumvakt/shared/db/identity";
import type {
  MembershipRole,
  MembershipStatus,
  PlatformRole,
  PlatformGrantStatus,
} from "@straumvakt/shared/domain/users";
import {
  effectivePermissions as pureEffectivePermissions,
  PER_TENANT_PERMISSIONS,
  type Permission,
  type PerTenantPermission,
} from "./permissions";

// ─────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Active Membership for (userId, orgId). Returns null if no row,
 * or row exists but status != 'active'. Caller filters; this is the
 * gate.
 */
export async function getActiveMembership(
  db: Db,
  userId: string,
  orgId: string,
): Promise<{
  role: MembershipRole;
  status: MembershipStatus;
  scopeSiteIds: string[];
  scopePropertyIds: string[];
} | null> {
  const [row] = await db
    .select({
      role: memberships.role,
      status: memberships.status,
      scopeSiteIds: memberships.scopeSiteIds,
      scopePropertyIds: memberships.scopePropertyIds,
    })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) return null;
  if (row.status !== "active") return null;
  return row;
}

/**
 * Active PlatformGrant for userId. Returns null if no row, status !=
 * 'active', or expiresAt <= now (auditor / time-limited support_agent
 * grants drop out automatically once expired).
 */
export async function getActivePlatformGrant(
  db: Db,
  userId: string,
): Promise<{
  role: PlatformRole;
  status: PlatformGrantStatus;
  expiresAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      role: platformGrants.role,
      status: platformGrants.status,
      expiresAt: platformGrants.expiresAt,
    })
    .from(platformGrants)
    .where(eq(platformGrants.userId, userId))
    .limit(1);
  if (!row) return null;
  if (row.status !== "active") return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

// ─────────────────────────────────────────────────────────────────────
// Platform expansion (Recommendation A)
// ─────────────────────────────────────────────────────────────────────

/**
 * Membership administration is NOT conferred by a platform grant.
 *
 * This is the carve-out the hierarchy-review note proposed and Sprint 4.3
 * deferred. It matters more than "tidier bundles": `member.write` is what
 * gates `PUT /api/admin/users/:id/password`
 * (domains/identity/routes/admin-users.ts:138), which sets any user's
 * password. Through the unconditional expansion, every holder of
 * `platform.tenant.write` had it — including `sales_cs`, whose bundle is
 * annotated "column-restricted in repo layer (org notes/tags only)"
 * (permissions.ts:268), a restriction implemented nowhere. A sales grant
 * could take over any account in any tenant.
 *
 * Staff who legitimately administer members do so through a membership in
 * that organisation, which is the path `satisfiedOnlyByPlatformGrant`
 * exists to distinguish. Removing the shortcut is what makes that
 * distinction mean anything.
 */
const MEMBER_ADMIN_VERBS = new Set<PerTenantPermission>([
  "member.write",
  "member.invite",
  "member.remove",
]);

/**
 * When a PlatformGrant carries `platform.tenant.read`, the user
 * effectively has every per-tenant *.read verb. Same for write
 * (read + write) and delete (read + write + delete) — except the
 * membership-administration verbs above, which no platform grant confers.
 *
 * `member.read` is deliberately still expanded: staff must be able to SEE
 * a tenant's members to support it. Only mutation is withdrawn.
 */
function expandPlatformTenantVerbs(perms: Permission[]): Permission[] {
  const set = new Set<Permission>(perms);
  const has = (p: Permission) => set.has(p);

  // Categorise the per-tenant catalogue once.
  const READS: PerTenantPermission[] = PER_TENANT_PERMISSIONS.filter((p) =>
    p.endsWith(".read"),
  );
  const WRITES: PerTenantPermission[] = PER_TENANT_PERMISSIONS.filter(
    (p) =>
      !MEMBER_ADMIN_VERBS.has(p) &&
      (p.endsWith(".write") ||
        p === "member.invite" ||
        p === "member.remove" ||
        p === "billing.export" ||
        p === "charger.config" ||
        p === "charger.remote_start" ||
        p === "charger.remote_stop"),
  );
  const DELETES: PerTenantPermission[] = PER_TENANT_PERMISSIONS.filter((p) =>
    p.endsWith(".delete"),
  );

  if (has("platform.tenant.read")) {
    for (const r of READS) set.add(r);
  }
  if (has("platform.tenant.write")) {
    for (const r of READS) set.add(r);
    for (const w of WRITES) set.add(w);
  }
  if (has("platform.tenant.delete")) {
    for (const r of READS) set.add(r);
    for (const w of WRITES) set.add(w);
    for (const d of DELETES) set.add(d);
  }

  return Array.from(set);
}

// ─────────────────────────────────────────────────────────────────────
// Top-level resolver
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// Provenance (additive — nothing above changes shape)
// ─────────────────────────────────────────────────────────────────────

/**
 * The same permission set `resolveEffectivePermissions` returns, plus
 * WHERE each verb came from.
 *
 * The flat Permission[] cannot answer "is this user acting as a member
 * of this org, or as Straumvakt staff?" — `expandPlatformTenantVerbs`
 * injects platform-derived per-tenant verbs into the same array with no
 * marker, and `pureEffectivePermissions` dedupes across both sources
 * through one Set. The support-context guard needs that distinction.
 *
 * `viaMembership` is computed with a NULL platform grant, so the
 * expansion contributes nothing to it — the expansion is inert without a
 * platform.tenant.* verb to trigger on. That is what makes the
 * difference in `satisfiedOnlyByPlatformGrant` sound.
 */
export interface PermissionResolution {
  /** Identical membership to today's resolveEffectivePermissions return. */
  all: Permission[];
  /** The membership role bundle alone. Empty when orgId is null. */
  viaMembership: Permission[];
  /** The platform bundle alone, including its tenant expansion. */
  viaPlatform: Permission[];
  membershipRole: MembershipRole | null;
  platformRole: PlatformRole | null;
}

export async function resolvePermissionsWithProvenance(
  db: Db,
  userId: string,
  orgId: string | null,
): Promise<PermissionResolution> {
  const [membership, platformGrant] = await Promise.all([
    orgId ? getActiveMembership(db, userId, orgId) : Promise.resolve(null),
    getActivePlatformGrant(db, userId),
  ]);

  const viaMembership = expandPermissionsSync(
    membership ? { role: membership.role } : null,
    null,
  );
  const viaPlatform = expandPermissionsSync(
    null,
    platformGrant ? { role: platformGrant.role } : null,
  );

  return {
    all: Array.from(new Set<Permission>([...viaMembership, ...viaPlatform])),
    viaMembership,
    viaPlatform,
    membershipRole: membership?.role ?? null,
    platformRole: platformGrant?.role ?? null,
  };
}

/**
 * True when the user has the verb, but ONLY because of their platform
 * grant — i.e. they are acting as Straumvakt staff in someone else's
 * tenant, not as a member of it.
 *
 * It is a DIFFERENCE, not a membership test on viaPlatform. Writing
 * `viaPlatform.includes(verb)` would force a Straumvakt employee who is
 * also a genuine member of an org into a support context for their own
 * member actions. See doc 19 §3.7 failure mode 1 — that bug is only
 * detectable by a fixture holding BOTH an active membership granting the
 * verb AND an active platform grant.
 */
export function satisfiedOnlyByPlatformGrant(
  resolution: PermissionResolution,
  verb: Permission,
): boolean {
  return (
    resolution.all.includes(verb) && !resolution.viaMembership.includes(verb)
  );
}

/**
 * Resolve the user's effective permission set for a given org context.
 * orgId may be null when the route has no tenant context (e.g.
 * platform-only routes like /api/admin/orgs listing all orgs); in
 * that case only the PlatformGrant bundle is consulted.
 *
 * Returns Permission[] — deduped, with platform.tenant.* expanded into
 * the matching per-tenant verbs.
 *
 * Delegates to resolvePermissionsWithProvenance. Signature unchanged, so
 * both production callers (require-permission.ts:74, :126) and the three
 * test mocks that stub this function keep working untouched.
 */
export async function resolveEffectivePermissions(
  db: Db,
  userId: string,
  orgId: string | null,
): Promise<Permission[]> {
  return (await resolvePermissionsWithProvenance(db, userId, orgId)).all;
}

/**
 * Sync helper for tests + the require-permission middleware. Same
 * shape as resolveEffectivePermissions but takes pre-loaded rows
 * instead of hitting the DB.
 */
export function expandPermissionsSync(
  membership: { role: MembershipRole } | null,
  platformGrant: { role: PlatformRole } | null,
): Permission[] {
  const base = pureEffectivePermissions(
    membership ? { role: membership.role } : null,
    platformGrant ? { role: platformGrant.role } : null,
  );
  return expandPlatformTenantVerbs(base);
}
