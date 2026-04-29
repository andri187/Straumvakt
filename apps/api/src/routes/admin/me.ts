// Session-introspection endpoint. The UI Worker's (app)/layout.tsx
// calls this with the session cookie forwarded; if the API Worker
// HMAC-verifies the cookie successfully, we return the session
// payload. If not, requireAdmin returns 401 and the UI Worker
// redirects the operator to /login.
//
// Owning auth verification on the API side means the UI Worker no
// longer needs AUTH_SECRET — we removed the two-secret coupling that
// made the cutover bounce silently when the secrets drifted.

import { Hono } from "hono";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import type { Env } from "../../bindings";

export const adminMe = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminMe.use("*", requireAdmin);

adminMe.get("/", (c) => {
  const session = c.get("session");
  return c.json({
    email: session.email,
    role: session.role,
  });
});
