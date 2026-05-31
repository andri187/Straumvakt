// password-reset.ts — driver self-service password reset endpoints.
//
// Sprint 9 / ENROLL-1.
//
// Routes:
//   POST /api/public/password-reset                    — initiate
//   POST /api/public/password-reset/confirm/:token     — set new password
//
// Initiate is anti-enumeration: it ALWAYS returns 200 / { ok: true }
// regardless of whether the email matches a known user. The repository
// silently no-ops when the email is unknown.
//
// Confirm verifies the token, hashes the new password, upserts the
// UserCredential, and marks the token consumed. All in one tx via the
// repo so a hash success + credential write failure can't leave a
// half-applied state.
//
// Both endpoints are rate-limited by the shared ADMIN_LOGIN_RATE_LIMITER
// binding. When the binding is missing (dev), the middleware fails
// open with a warn — same behaviour as the admin-login route.

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { rateLimit } from "../../lib/rate-limit";
import {
  initiatePasswordReset,
  confirmPasswordReset,
} from "../../repositories/registration";
import type { Env } from "../../bindings";

export const publicPasswordReset = new Hono<{ Bindings: Env }>();

const InitiateBody = z
  .object({
    email: z.string().email().max(200),
  })
  .strict();

const ConfirmBody = z
  .object({
    newPassword: z.string().min(8).max(200),
  })
  .strict();

function buildBaseUrl(c: {
  req: { header: (k: string) => string | undefined };
}): string {
  const origin = c.req.header("origin") ?? c.req.header("referer");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      // fall through
    }
  }
  return "https://hlada-staging.straumvakt.workers.dev";
}

publicPasswordReset.post(
  "/",
  rateLimit({
    keyBy: "email_or_ip",
    limit: 5,
    windowSec: 60,
    bindingName: "ADMIN_LOGIN_RATE_LIMITER",
  }),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = InitiateBody.safeParse(raw);
    if (!parsed.success) {
      // Even on a malformed body we keep the surface area small to
      // avoid leaking which fields exist — return 400 with the issues
      // but don't reveal anything about user state.
      return c.json(
        { error: "validation", issues: parsed.error.issues },
        400,
      );
    }
    const db = makePrisma(c.env);
    await initiatePasswordReset(db, c.env, {
      email: parsed.data.email,
      baseUrl: buildBaseUrl(c),
    });
    // Always 200/ok regardless of whether the email was known.
    return c.json({ ok: true });
  },
);

publicPasswordReset.post(
  "/confirm/:token",
  rateLimit({
    keyBy: "ip",
    limit: 5,
    windowSec: 60,
    bindingName: "ADMIN_LOGIN_RATE_LIMITER",
  }),
  async (c) => {
    const token = c.req.param("token");
    if (!token || token.length < 8 || token.length > 256) {
      return c.json({ error: "invalid_or_expired" }, 404);
    }
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = ConfirmBody.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation", issues: parsed.error.issues },
        400,
      );
    }
    const db = makePrisma(c.env);
    const result = await confirmPasswordReset(db, token, parsed.data.newPassword);
    if (!result.ok) {
      return c.json({ error: result.reason }, 404);
    }
    return c.json({ ok: true });
  },
);
