// Sprint 9 / ADR 0019 (2026-05-08) — manual session-resolution endpoint.
//
//   POST /api/admin/agreements/sessions/:sessionId/resolve
//
// Triggers resolveAndPersistForSession against a real ChargeSession and
// writes agreements.billing_lines. Idempotent — a second call against
// the same session returns alreadyExisted=true and writes nothing.
//
// Intended use:
//   - Operator-driven testing during pilot bring-up.
//   - Backfill of pre-existing finalized sessions that haven't been
//     resolved yet.
//
// Auto-triggered resolution (cron after user-enrichment) is a separate
// follow-up sprint.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { requireAdmin, type AuthVars } from "../../lib/auth-middleware";
import { resolveAndPersistForSession } from "../../lib/agreement/persist";
import type { Env } from "../../bindings";

export const adminAgreementsResolve = new Hono<{ Bindings: Env; Variables: AuthVars }>();
adminAgreementsResolve.use("*", requireAdmin);

adminAgreementsResolve.post("/:sessionId/resolve", async (c) => {
  const sessionId = c.req.param("sessionId");
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(sessionId)) {
    return c.json({ ok: false, error: "invalid_session_id" }, 400);
  }

  const prisma = makePrisma(c.env);
  const result = await resolveAndPersistForSession(prisma, sessionId);

  if (!result.ok) {
    return c.json({ ok: false, reason: result.reason }, 422);
  }

  if (result.alreadyExisted) {
    return c.json({
      ok: true,
      sessionId,
      alreadyExisted: true,
      emitted: 0,
      message: "Session already has billing_lines. No change.",
    });
  }

  return c.json({
    ok: true,
    sessionId,
    alreadyExisted: false,
    emitted: result.emitted,
    factorCodes: Array.from(new Set(result.lines.map((l) => l.factorCode))),
  });
});
