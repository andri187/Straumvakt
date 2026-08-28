// Effective org scope for a request — the set of organizations whose rows
// the caller may see. This is the data-layer companion to requirePermission:
// requirePermission decides "may you call this verb"; resolveOrgScope decides
// "which tenants' rows the query may return". Repositories take an optional
// OrgScope and add a `where: { orgId: { in } }` predicate (or none for `all`).
//
// Tiers (see docs/architecture/TENANT_ISOLATION_AUDIT.md, P4 item 1):
//   - bootstrap admin / platform staff with platform.tenant.read → { all: true }
//     (cross-tenant by design — no filter).
//   - org member (e.g. host_admin) → { all: false, orgIds: [their active memberships] }.
//   - unknown / no userId → { all: false, orgIds: [] } (deny-all data).
//
// Today the admin routes are reachable only by bootstrap/platform sessions,
// so resolveOrgScope returns { all: true } and is a no-op. It activates as
// soon as host_admin (userId-bearing, org-membership) sessions can reach a
// route — at which point the data is row-scoped, not just verb-gated.

import { and, eq } from "drizzle-orm";
import { makeDrizzle } from "../drizzle";
import type { Env } from "../../bindings";
import { memberships } from "@straumvakt/shared/db/identity";
import type { SessionPayload } from "../admin-session";
import { resolvePermissionsWithProvenance } from "./effective-permissions";
import { isBootstrapSession, sessionUserId } from "./require-permission";

export type OrgScope = { all: true } | { all: false; orgIds: string[] };

/** True when the scope permits a row in `orgId`. `all` → always true. */
export function orgInScope(scope: OrgScope, orgId: string): boolean {
  return scope.all || scope.orgIds.includes(orgId);
}

/**
 * Resolve which orgs' rows the current session may read. Bootstrap and
 * platform-tenant-read grants get unrestricted `all`; everyone else is
 * narrowed to their active org memberships.
 */
export async function resolveOrgScope(
  env: Env,
  session: SessionPayload,
): Promise<OrgScope> {
  if (isBootstrapSession(session)) return { all: true };

  const userId = sessionUserId(session);
  if (!userId) return { all: false, orgIds: [] };

  // Own client, matching requirePermission. Taking an Env rather than a
  // client keeps the auth layer self-contained through the ORM change: the
  // eight routes that call this would otherwise each have had to hold a
  // Drizzle client alongside their Prisma one purely to answer "which orgs".
  const db = makeDrizzle(env);
  // Converged onto the shared provenance helper. This module used to
  // re-derive "is this platform-derived?" itself — getActivePlatformGrant
  // plus expandPermissionsSync(null, {role}) — which was a THIRD
  // definition of the same question alongside requirePermission and
  // assertPermission. Three definitions drift the first time a role
  // bundle changes, and this is the one gating rows.
  const resolution = await resolvePermissionsWithProvenance(db, userId, null);
  if (resolution.viaPlatform.includes("platform.tenant.read")) {
    // Deliberately unconditional today, and deliberately noisy. This is
    // the row gate: a support context enforced only in requirePermission
    // would gate the VERB and leave every tenant's rows readable. Doc 19
    // §3.2 — 18D named one seam; there are three.
    console.warn("[support-context] cross-tenant row scope granted", {
      userId,
      platformRole: resolution.platformRole,
    });
    return { all: true };
  }

  const rows = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")));
  return { all: false, orgIds: rows.map((m) => m.orgId) };
}
