// Session-introspection endpoint. The UI Worker's (app)/layout.tsx
// calls this with the session cookie forwarded; if the API Worker
// HMAC-verifies the cookie successfully, we return the session
// payload. If not, requireAdmin returns 401 and the UI Worker
// redirects the operator to /login.
//
// Owning auth verification on the API side means the UI Worker no
// longer needs AUTH_SECRET — we removed the two-secret coupling that
// made the cutover bounce silently when the secrets drifted.
//
// Sprint 9 (ADR 0027/0033) — extended to return the principal's
// PERSONA + org scope so the UI can route/gate per role:
//   operator   → platform staff / bootstrap (cross-tenant console)
//   host_admin → org member with the host_admin role (host portal)
//   member     → org member with some other role
//   none       → authenticated but no membership/grant
// Additive: email/role are unchanged, so the existing layout 200-check
// keeps working.

import { Hono } from "hono";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { makePrisma } from "../../lib/prisma";
import { isBootstrapSession, sessionUserId } from "../../lib/auth/require-permission";
import { getActivePlatformGrant } from "../../lib/auth/effective-permissions";
import type { Env } from "../../bindings";

export const adminMe = new Hono<{ Bindings: Env; Variables: AuthVars }>();

adminMe.use("*", requireAdmin);

adminMe.get("/", async (c) => {
  const session = c.get("session");
  const base = { email: session.email, role: session.role };

  // Bootstrap (env-var) admin or a session without a userId = platform operator.
  if (isBootstrapSession(session)) {
    return c.json({ ...base, userId: null, persona: "operator", isPlatform: true, orgs: [] });
  }
  const userId = sessionUserId(session);
  if (!userId) {
    return c.json({ ...base, userId: null, persona: "operator", isPlatform: true, orgs: [] });
  }

  const db = makePrisma(c.env);
  const [grant, memberships] = await Promise.all([
    getActivePlatformGrant(db, userId),
    db.membership.findMany({
      where: { userId, status: "active" },
      select: {
        orgId: true,
        role: true,
        organization: { select: { displayName: true, kind: true } },
      },
    }),
  ]);

  const isPlatform = !!grant;
  const orgs = memberships.map((m) => ({
    orgId: m.orgId,
    displayName: m.organization.displayName,
    kind: m.organization.kind,
    role: m.role,
  }));
  const persona = isPlatform
    ? "operator"
    : orgs.some((o) => o.role === "host_admin")
      ? "host_admin"
      : orgs.length > 0
        ? "member"
        : "none";

  return c.json({ ...base, userId, persona, isPlatform, orgs });
});
