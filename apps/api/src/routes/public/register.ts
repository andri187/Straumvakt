// register.ts — driver self-registration endpoint.
//
// Sprint 9 / ENROLL-1 / ADR 0022 (2026-05-31 addendum).
//
// Route:
//   POST /api/public/register
//
// Public — no auth gate. Rate-limited by the shared
// ADMIN_LOGIN_RATE_LIMITER binding (we don't yet have a separate
// register-rate-limit binding; the shared bucket is over-conservative
// but safe). When the binding is missing (dev), the middleware fails
// open with a warn — same behaviour as the admin-login route.
//
// Body schema (Zod) — see RegisterBody below.
//
// Returns:
//   201 { user: {...}, email: { sent, id, reason } }
//   400 { error: "validation", issues }
//   409 { error: "email_taken" | "kennitala_taken" }
//
// Behaviour delegated to repositories/registration.ts — Rule 7 keeps
// the route thin (parse + gate + format). Origin-derived baseUrl
// mirrors org-invites.ts's buildInviteUrl pattern so emailed links
// point at the same origin the recipient browsed from.

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { rateLimit } from "../../lib/rate-limit";
import { registerDriver } from "../../repositories/registration";
import type { Env } from "../../bindings";

export const publicRegister = new Hono<{ Bindings: Env }>();

// E.164 phone is "+<countryCode><number>" up to ~15 digits. Looser
// regex here — we accept anything that starts with + followed by 6–15
// digits to cover Icelandic, EEA, and roaming numbers without
// blowing up on edge cases. The driver app can tighten client-side.
const E164 = /^\+[1-9]\d{6,14}$/;

const RegisterBody = z
  .object({
    email: z.string().email().max(200),
    password: z.string().min(8).max(200),
    kennitala: z.string().regex(/^\d{10}$/, "kennitala_must_be_10_digits"),
    displayName: z.string().min(1).max(200),
    phone: z.string().regex(E164).max(20).optional(),
    acceptedTos: z.boolean().refine((v) => v === true, {
      message: "tos_must_be_accepted",
    }),
    acceptedPrivacy: z.boolean().refine((v) => v === true, {
      message: "privacy_must_be_accepted",
    }),
    acceptedMarketing: z.boolean().optional(),
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

publicRegister.post(
  "/",
  rateLimit({
    keyBy: "email_or_ip",
    limit: 5,
    windowSec: 60,
    bindingName: "ADMIN_LOGIN_RATE_LIMITER",
  }),
  async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    const parsed = RegisterBody.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "validation", issues: parsed.error.issues },
        400,
      );
    }

    const db = makePrisma(c.env);
    const result = await registerDriver(db, c.env, {
      email: parsed.data.email,
      password: parsed.data.password,
      kennitala: parsed.data.kennitala,
      displayName: parsed.data.displayName,
      phone: parsed.data.phone,
      acceptedTos: parsed.data.acceptedTos,
      acceptedPrivacy: parsed.data.acceptedPrivacy,
      acceptedMarketing: parsed.data.acceptedMarketing,
      baseUrl: buildBaseUrl(c),
    });

    if (!result.ok) {
      return c.json({ error: result.reason }, 409);
    }

    return c.json(
      {
        user: result.user,
        email: result.email,
      },
      201,
    );
  },
);
