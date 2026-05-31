// email-verification.ts — driver self-registration email-verify endpoint.
//
// Sprint 9 / ENROLL-1 / ADR 0022 (2026-05-31 addendum).
//
// Routes:
//   GET  /api/public/verify-email/:token   — primary (link click from email)
//   POST /api/public/verify-email/:token   — alias for tooling / CSRF-strict clients
//
// Both share the same handler. The link in the email is a GET (mail
// clients only follow GET safely); a POST alias means automated tests
// and CSRF-locked browser tooling can drive the same flow without
// crafting headers. Same idempotency guarantees apply to both (the
// underlying repo uses an atomic claim).
//
// Outcome shape from the repo flows into the response:
//   { verified: true, accessGranted: <bool>, ... }
// "accessGranted=true" only when policy='auto_join' AND a default
// driver group exists. Every other policy path returns
// accessGranted=false; the request body still tells the caller WHY
// (kind='no_match' | 'disabled' | 'request_pending' | 'auto_join_no_default_group'
// | 'request_no_installation') so the UI can render the right message.

import { Hono, type Context } from "hono";
import { makePrisma } from "../../lib/prisma";
import { consumeEmailVerification } from "../../repositories/registration";
import type { Env } from "../../bindings";

export const publicEmailVerification = new Hono<{ Bindings: Env }>();

async function handleVerify(c: Context<{ Bindings: Env }>) {
  const token = c.req.param("token");
  if (!token || token.length < 8 || token.length > 256) {
    return c.json({ error: "invalid_or_expired" }, 404);
  }
  const db = makePrisma(c.env);
  const result = await consumeEmailVerification(db, token);
  if (!result.ok) {
    return c.json({ error: result.reason }, 404);
  }

  switch (result.accessOutcome.kind) {
    case "auto_join_granted":
      return c.json({
        verified: true,
        accessGranted: true,
        membershipId: result.accessOutcome.membershipId,
        driverGroupId: result.accessOutcome.driverGroupId,
        accessRequestId: null,
        user: result.user,
      });
    case "request_pending":
      return c.json({
        verified: true,
        accessGranted: false,
        accessRequestId: result.accessOutcome.accessRequestId,
        user: result.user,
      });
    case "no_match":
    case "disabled":
    case "auto_join_no_default_group":
    case "request_no_installation":
      return c.json({
        verified: true,
        accessGranted: false,
        accessRequestId: null,
        outcome: result.accessOutcome.kind,
        user: result.user,
      });
  }
}

publicEmailVerification.get("/:token", async (c) => handleVerify(c));
publicEmailVerification.post("/:token", async (c) => handleVerify(c));
