// Hono middleware: requires a valid admin session cookie. Sets the
// session payload on c.var.session for downstream handlers.

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { adminSessionConfig, verifyAdminSession, type SessionPayload } from "./admin-session";
import type { Env } from "../bindings";

/**
 * How the caller came by the verb `requirePermission` just checked.
 *
 * Set by requirePermission/assertPermission; read by handlers that must
 * behave differently for Straumvakt staff acting in a customer's tenant
 * than for a member of that tenant. Optional because handlers behind
 * `requireAdmin` alone never have it, and because the bootstrap session
 * short-circuits before any resolution happens.
 */
export interface PermissionBasis {
  /**
   * The caller holds the verb ONLY through a platform grant — no
   * membership in the target org supplies it. With no org context at all
   * (a route that passes no orgIdParam), nothing can be membership-derived,
   * so this is true for every platform-grant holder.
   */
  platformDerived: boolean;
  platformRole: string | null;
  membershipRole: string | null;
}

export type AuthVars = {
  session: SessionPayload;
  permissionBasis?: PermissionBasis;
};

export async function requireAdmin(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
  next: Next,
) {
  const cookie = getCookie(c, adminSessionConfig.SESSION_COOKIE_NAME);
  const session = await verifyAdminSession(c.env.AUTH_SECRET, cookie);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
}
