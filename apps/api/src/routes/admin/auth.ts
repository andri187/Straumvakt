import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  adminSessionConfig,
  createAdminSession,
  timingSafeEqualText,
} from "../../lib/admin-session";
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

  const expectedEmail = c.env.ADMIN_EMAIL.trim();
  const expectedPassword = c.env.ADMIN_PASSWORD;
  if (!timingSafeEqualText(email, expectedEmail) || !timingSafeEqualText(password, expectedPassword)) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  const token = await createAdminSession(c.env.AUTH_SECRET, email, "admin");
  setCookie(c, adminSessionConfig.SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: adminSessionConfig.SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true, email });
});

adminAuth.post("/logout", (c) => {
  deleteCookie(c, adminSessionConfig.SESSION_COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});
