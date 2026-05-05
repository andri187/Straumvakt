// Sprint 9 — claim-check trigger endpoint.
//
// Called by the Fly-hosted Zaptec consumer when an AMQP event
// arrives that suggests a session may have changed on charger X.
// We don't trust AMQP message bodies to carry full session data;
// instead we use the AMQP message as a "go look now" signal and
// fetch the authoritative payload from /api/chargehistory with
// DetailLevel=1.
//
// Authentication: shared OCPP_INGEST_SECRET (same secret the OCPP
// gateway uses for /api/internal/ocpp-events). One header,
// constant-time-compared.
//
// Body shape:
//   { chargerId: string,                  // Zaptec internal UUID
//     fromHint?: string,                  // ISO; defaults to 1h ago
//     toHint?: string }                   // ISO; defaults to now
//
// On receipt:
//   1. Look up the active Zaptec credential.
//   2. unsealAndAuth → access token.
//   3. Run syncZaptecSessions filtered to this chargerId + window.
//      Idempotent on imported_cdr_refs; previously-imported sessions
//      are skipped, new ones land enriched.
//   4. Return aggregate counts.
//
// Why not extend the existing /api/admin/vendor-credentials/:id/sync-sessions
// route: that one is admin-cookie-gated and operator-driven.
// This is service-to-service, secret-gated, narrow scope. Different
// trust model + different latency profile (we want sub-second).

import { Hono } from "hono";
import { z } from "zod";
import { makePrisma } from "../../lib/prisma";
import { verifyIngest } from "../../lib/ocpp-internal-auth";
import { unsealAndAuth } from "../../repositories/credential-management";
import { syncZaptecSessions } from "../../repositories/zaptec-session-sync";
import type { Env } from "../../bindings";

export const internalZaptecTriggerSync = new Hono<{ Bindings: Env }>();

const TriggerInput = z
  .object({
    chargerId: z.string().uuid(),
    fromHint: z.string().datetime().optional(),
    toHint: z.string().datetime().optional(),
  })
  .strict();

internalZaptecTriggerSync.post("/", async (c) => {
  const fail = verifyIngest(c.req.raw, c.env.OCPP_INGEST_SECRET);
  if (fail) return fail;

  const raw = (await c.req.json().catch(() => null)) as unknown;
  const parsed = TriggerInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "validation", issues: parsed.error.issues }, 400);
  }
  const { chargerId, fromHint, toHint } = parsed.data;

  if (!c.env.OCPP_CRED_KEK) {
    return c.json({ error: "kek_unavailable" }, 500);
  }

  const db = makePrisma(c.env);

  // Find a Zaptec credential that can see this charger. Today's
  // pilot only has one Zaptec credential — pick it. When we run
  // multiple, we'd map chargerId → credential via OcppIdentity
  // joins; deferred to that scale.
  const cred = await db.vendorCredential.findFirst({
    where: { status: "active", vendor: { slug: "zaptec" } },
    select: { id: true },
  });
  if (!cred) return c.json({ error: "no_zaptec_credential" }, 503);

  let auth;
  try {
    auth = await unsealAndAuth(db, c.env.OCPP_CRED_KEK, cred.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 502);
  }

  const from = fromHint ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const to = toHint ?? new Date().toISOString();

  try {
    const result = await syncZaptecSessions(db, {
      accessToken: auth.accessToken,
      chargerId,
      from,
      to,
    });
    return c.json({
      ok: true,
      chargerId,
      from,
      to,
      zaptecCount: result.zaptecCount,
      importedCount: result.imported.length,
      skippedCount: result.skipped.length,
      errorCount: result.errors.length,
      imported: result.imported,
      errors: result.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("zaptec_chargehistory_fetch_failed")) {
      return c.json({ error: msg }, 502);
    }
    return c.json({ error: msg }, 500);
  }
});
