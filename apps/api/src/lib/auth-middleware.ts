// Hono middleware: requires a valid admin session cookie. Sets the
// session payload on c.var.session for downstream handlers.

import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { adminSessionConfig, verifyAdminSession, type SessionPayload } from "./admin-session";
import type { Env } from "../bindings";

export type AuthVars = { session: SessionPayload };

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
