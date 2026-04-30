// Gateway → API Worker: log a charger that attempted to connect to
// our gateway WITHOUT valid OCPP Basic-Auth credentials. Mirrors the
// pending_discoveries upsert path the ocpp-auth route already does
// for the wrong-creds case — this catches the no-creds case so
// every connection attempt surfaces on /chargers/pending regardless
// of whether the charger is configured to send auth yet.
//
// Same shared-secret gating (OCPP_INGEST_SECRET) as ocpp-auth so the
// gateway is the only legitimate caller. Fire-and-forget from the
// gateway's perspective — we always 200 (or 401 on bad secret); the
// gateway translates the response into a 401 to the charger.

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { verifyIngest } from "../../lib/ocpp-internal-auth";
import { upsertPendingDiscovery } from "../../repositories/pending-discoveries";
import type { Env } from "../../bindings";

export const internalPendingDiscovery = new Hono<{ Bindings: Env }>();

internalPendingDiscovery.post("/", async (c) => {
  const fail = verifyIngest(c.req.raw, c.env.OCPP_INGEST_SECRET);
  if (fail) return fail;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "malformed json" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "body not object" }, 400);
  }
  const { identityString } = body as { identityString?: unknown };
  if (typeof identityString !== "string" || identityString.length === 0) {
    return c.json({ ok: false, error: "identityString required" }, 400);
  }

  const db = makePrisma(c.env);
  try {
    await upsertPendingDiscovery(db, {
      identityString,
      remoteAddr:
        c.req.header("cf-connecting-ip") ??
        c.req.header("x-real-ip") ??
        (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
        null,
      userAgent: c.req.header("user-agent") ?? null,
    });
  } catch (err) {
    console.error("[pending-discovery] upsert failed", {
      identityString,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "upsert_failed" }, 500);
  }

  return c.json({ ok: true });
});
