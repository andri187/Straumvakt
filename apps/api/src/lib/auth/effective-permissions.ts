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
import { memberships, platformGrants } from "../../domains/identity/schema";
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
 * When a PlatformGrant carries `platform.tenant.read`, the user
 * effectively has every per-tenant *.read verb. Same for write
 * (read + write) and delete (read + write + delete).
 *
 * Caveat (see hierarchy-review note): this expansion includes
 * member.* — Straumvakt staff with platform.tenant.write can today
 * invite/remove members directly. The note proposes carving
 * member.* OUT in a future revision; Sprint 4.3 ships the simpler
 * full-expansion behaviour and re-checks at Sprint 4.4 / 4 retro.
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
      p.endsWith(".write") ||
      p === "member.invite" ||
      p === "member.remove" ||
      p === "billing.export" ||
      p === "charger.config" ||
      p === "charger.remote_start" ||
      p === "charger.remote_stop",
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

/**
 * Resolve the user's effective permission set for a given org context.
 * orgId may be null when the route has no tenant context (e.g.
 * platform-only routes like /api/admin/orgs listing all orgs); in
 * that case only the PlatformGrant bundle is consulted.
 *
 * Returns Permission[] — order-stable, deduped, with platform.tenant.*
 * expanded into the matching per-tenant verbs.
 */
export async function resolveEffectivePermissions(
  db: Db,
  userId: string,
  orgId: string | null,
): Promise<Permission[]> {
  const [membership, platformGrant] = await Promise.all([
    orgId ? getActiveMembership(db, userId, orgId) : Promise.resolve(null),
    getActivePlatformGrant(db, userId),
  ]);

  const base = pureEffectivePermissions(
    membership ? { role: membership.role } : null,
    platformGrant ? { role: platformGrant.role } : null,
  );

  return expandPlatformTenantVerbs(base);
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
