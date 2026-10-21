// requirePermission middleware. Sits AFTER requireAdmin in the route
// chain (requireAdmin establishes c.get("session"); requirePermission
// reads it). Bootstrap-admin sessions today (single-user, env-var
// password) get a god-mode pass — Sprint 5's invite flow lands real
// multi-user sessions with userId attached, at which point the real
// resolveEffectivePermissions path takes over.
//
// Sprint 4 milestone 4.3.

import type { Context, MiddlewareHandler, Next } from "hono";
import { makeDrizzle } from "../drizzle";
import {
  resolvePermissionsWithProvenance,
  satisfiedOnlyByPlatformGrant,
  type expandPermissionsSync,
} from "./effective-permissions";
import type { Permission } from "./permissions";
import type { SessionPayload } from "../admin-session";
import type { Env } from "../../bindings";
import type { AuthVars } from "../auth-middleware";

// ─────────────────────────────────────────────────────────────────────
// Public middleware
// ─────────────────────────────────────────────────────────────────────

export interface RequirePermissionOptions {
  /**
   * Path param that carries the orgId. Common: "orgId" for routes like
   * /api/admin/orgs/:orgId/... When omitted, the verb is treated as
   * platform-only — the resolver runs without a Membership lookup.
   */
  orgIdParam?: string;
}

/**
 * Returns a Hono middleware that checks the session has the named
 * permission verb in the resolved effective set. 401 if no session
 * (shouldn't happen if requireAdmin runs first); 403 if authenticated
 * but lacking the verb.
 *
 * Bootstrap-admin behaviour (Sprint 4 → Sprint 5 transition): if the
 * session is the env-var bootstrap admin (no userId attached), the
 * middleware proceeds without a DB check. The bootstrap admin always
 * has god-mode until multi-user login lands.
 */
export function requirePermission(
  verb: Permission,
  options: RequirePermissionOptions = {},
): MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> {
  return async (c, next) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "unauthorized" }, 401);
    }

    if (isBootstrapSession(session)) {
      // Bootstrap admin gets god-mode. Sprint 5 invite flow flips this
      // off by introducing real userIds on every session payload.
      return next();
    }

    // Real multi-user path — resolve permissions from the DB.
    const userId = sessionUserId(session);
    if (!userId) {
      // Multi-user session shape but no userId attached — treat as
      // misconfigured session, deny.
      return c.json({ error: "forbidden", reason: "session_missing_user_id" }, 403);
    }

    const orgId = options.orgIdParam
      ? c.req.param(options.orgIdParam) ?? null
      : null;

    const db = makeDrizzle(c.env);
    const resolution = await resolvePermissionsWithProvenance(db, userId, orgId);

    if (!resolution.all.includes(verb)) {
      return c.json(
        {
          error: "forbidden",
          reason: "permission_missing",
          required: verb,
        },
        403,
      );
    }

    c.set("permissionBasis", {
      platformDerived: satisfiedOnlyByPlatformGrant(resolution, verb),
      platformRole: resolution.platformRole,
      membershipRole: resolution.membershipRole,
    });
    observeSupportContext(resolution, verb, userId, orgId, c.req.path);
    return next();
  };
}

// ─────────────────────────────────────────────────────────────────────
// Support context — SHADOW MODE
// ─────────────────────────────────────────────────────────────────────

/**
 * Error code the guard will return once it enforces. A distinct class
 * from `permission_missing`: the caller is not lacking access, they are
 * lacking a declared reason for using it. The frontend must not render
 * it with the generic forbidden copy — "you don't have access" would be
 * false, and staff will conclude their permissions are broken.
 */
export const SUPPORT_CONTEXT_REQUIRED = "support_context_required" as const;

/**
 * Records — and does not block — org-scoped actions a user could only
 * take because of a platform grant.
 *
 * Shadow first, on purpose. `bootstrapAdminUser` gives the operator
 * account a `super_user` grant and NO membership anywhere
 * (repositories/admin-bootstrap.ts:86-95), so on the day this enforces,
 * every routine org-scoped action by the day-to-day operator needs a
 * support context. That is correct by the specification and unusable in
 * practice until staff hold memberships in the orgs they administer.
 * Shadow mode turns that unknown blast radius into a measured one.
 *
 * It cannot enforce yet regardless: `support_contexts` does not exist in
 * any schema, so there is no context for a caller to open.
 *
 * Known gap, deliberately not papered over: this sits AFTER the bootstrap
 * early return above, so a validly-signed session with `sub:"admin"` and
 * no `userId` bypasses it — as it bypasses the permission check itself.
 * The login route no longer mints such cookies, but the branch honours
 * them.
 */
function observeSupportContext(
  resolution: Awaited<ReturnType<typeof resolvePermissionsWithProvenance>>,
  verb: Permission,
  userId: string,
  orgId: string | null,
  path: string,
): void {
  if (!orgId) return; // platform-scoped route; no tenant to act "on behalf of"
  if (!satisfiedOnlyByPlatformGrant(resolution, verb)) return; // acting as a member
  console.warn("[support-context] would require context", {
    userId,
    orgId,
    verb,
    path,
    platformRole: resolution.platformRole,
    membershipRole: resolution.membershipRole,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Inline helper for routes that resolve orgId via DB lookup
// ─────────────────────────────────────────────────────────────────────

/**
 * For routes whose orgId comes from a sub-resource lookup (e.g.
 * GET /api/admin/sites/:id needs to fetch the site to find its
 * orgId). Caller does the lookup itself, then calls this with the
 * resolved orgId. Throws an HTTPException-shaped Response on failure
 * — caller returns it.
 *
 * Returns null on success (i.e. permission granted, continue handling).
 * Returns a Response (401/403) on failure that the route immediately
 * returns to the client.
 */
export async function assertPermission(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
  verb: Permission,
  orgId: string | null,
): Promise<Response | null> {
  const session = c.get("session");
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (isBootstrapSession(session)) {
    return null;
  }
  const userId = sessionUserId(session);
  if (!userId) {
    return c.json(
      { error: "forbidden", reason: "session_missing_user_id" },
      403,
    );
  }
  const db = makeDrizzle(c.env);
  const resolution = await resolvePermissionsWithProvenance(db, userId, orgId);
  if (!resolution.all.includes(verb)) {
    return c.json(
      { error: "forbidden", reason: "permission_missing", required: verb },
      403,
    );
  }
  // Second seam. A guard added only to the requirePermission factory
  // leaves this one open, and it is live at
  // routes/admin/access-requests.ts:90 and :178.
  c.set("permissionBasis", {
    platformDerived: satisfiedOnlyByPlatformGrant(resolution, verb),
    platformRole: resolution.platformRole,
    membershipRole: resolution.membershipRole,
  });
  observeSupportContext(resolution, verb, userId, orgId, c.req.path);
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Session-shape helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Detects the bootstrap-admin session shape. Today's session payload
 * has `sub: "admin"` (literal string) and no userId — that's the
 * env-var bootstrap admin, single-user, god-mode. Sprint 5's invite
 * flow extends SessionPayload with a real userId; once that lands,
 * sessions with `sub === "admin"` AND no userId are still bootstrap.
 */
export function isBootstrapSession(session: SessionPayload): boolean {
  if (session.sub !== "admin") return false;
  // Multi-user sessions (future) will carry userId. Bootstrap doesn't.
  return sessionUserId(session) === null;
}

/**
 * Extracts userId from the session if present. Returns null for the
 * bootstrap admin (no userId field on today's SessionPayload).
 *
 * The cast lets the helper coexist with today's narrow SessionPayload
 * type without forcing a schema change. When Sprint 5 extends
 * SessionPayload, this helper updates to read the proper field.
 */
export function sessionUserId(session: SessionPayload): string | null {
  const maybe = (session as SessionPayload & { userId?: string }).userId;
  return typeof maybe === "string" && maybe.length > 0 ? maybe : null;
}

// Re-export for tests that want the sync expansion helper.
export type { expandPermissionsSync };
