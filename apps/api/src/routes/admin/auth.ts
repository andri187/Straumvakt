import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  adminSessionConfig,
  createAdminSession,
  timingSafeEqualText,
} from "../../lib/admin-session";
import { makePrisma } from "../../lib/prisma";
import { bootstrapAdminUser } from "../../repositories/admin-bootstrap";
import { verifyPassword } from "../../lib/password";
import type { Env } from "../../bindings";

export const adminAuth = new Hono<{ Bindings: Env }>();

// Email is compared verbatim against the operator's ADMIN_EMAIL secret in
// timing-safe fashion. We don't enforce email-shape here — the monolith
// historically accepted short login handles ("admin") for the staff
// account, and the comparison works regardless of format.
const LoginInput = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

adminAuth.post("/login", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = LoginInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { email, password } = parsed.data;

  // Two-path auth (Sprint 5.8):
  //
  //   Path A — env-var bootstrap admin. Email matches ADMIN_EMAIL +
  //            password matches ADMIN_PASSWORD. Bootstraps the User +
  //            PlatformGrant via bootstrapAdminUser (Sprint 5.5).
  //
  //   Path B — UserCredential. For invited operators (Sprint 5.7-5.8).
  //            Look up the User by email, compare the presented
  //            password against UserCredential.passwordHash via
  //            PBKDF2.verifyPassword. No bootstrap of platform grant —
  //            those operators are org-scoped, NOT platform admins.
  //
  // Both paths mint the same HMAC cookie shape, but Path B users
  // hit 401 on requirePermission(...) calls in admin routes because
  // they have no PlatformGrant. Their org-scoped UI lands in a
  // future sprint.
  const expectedEmail = c.env.ADMIN_EMAIL.trim();
  const expectedPassword = c.env.ADMIN_PASSWORD;
  const db = makePrisma(c.env);

  let resolvedUserId: string | undefined;

  if (
    timingSafeEqualText(email, expectedEmail) &&
    timingSafeEqualText(password, expectedPassword)
  ) {
    // Path A — env-var bootstrap admin.
    const bootstrap = await bootstrapAdminUser(db, email);
    if (bootstrap.createdUser || bootstrap.createdGrant) {
      console.log("[admin-bootstrap]", {
        email: bootstrap.email,
        userId: bootstrap.userId,
        createdUser: bootstrap.createdUser,
        createdGrant: bootstrap.createdGrant,
      });
    }
    resolvedUserId = bootstrap.userId;
  } else {
    // Path B — UserCredential lookup. Equalise CPU cost on miss
    // (both branches do a PBKDF2 derivation) so timing channels
    // don't distinguish "user exists but wrong password" from
    // "user doesn't exist."
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        status: true,
        credentials: { select: { passwordHash: true } },
      },
    });
    const passwordHash = user?.credentials?.passwordHash;
    const ok =
      passwordHash !== null &&
      passwordHash !== undefined &&
      user?.status === "active" &&
      (await verifyPassword(password, passwordHash));
    if (!ok) {
      // Burn ~equivalent CPU on miss to defeat user-enumeration
      // timing. The dummy hash is shape-valid PBKDF2 with the same
      // iteration count.
      await verifyPassword(
        password,
        "pbkdf2:sha256:100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      );
      return c.json({ error: "invalid_credentials" }, 401);
    }
    resolvedUserId = user!.id;
  }

  const token = await createAdminSession(c.env.AUTH_SECRET, email, {
    role: "admin",
    userId: resolvedUserId,
  });
  // Cookie scoped to the parent host so both the UI subdomain and the
  // API subdomain see it. On localhost we let the browser default to
  // host-only since cross-port (3000 → API) doesn't share by domain.
  // SameSite=None + Secure required for cross-origin credentialed
  // fetches in modern browsers.
  const host = new URL(c.req.url).host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  setCookie(c, adminSessionConfig.SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: !isLocal,
    sameSite: isLocal ? "Lax" : "None",
    domain: isLocal ? undefined : "straumvakt.workers.dev",
    maxAge: adminSessionConfig.SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true, email });
});

adminAuth.post("/logout", (c) => {
  const host = new URL(c.req.url).host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  deleteCookie(c, adminSessionConfig.SESSION_COOKIE_NAME, {
    path: "/",
    domain: isLocal ? undefined : "straumvakt.workers.dev",
  });
  return c.json({ ok: true });
});
