// Gateway → API Worker: log a charger that attempted to connect to
// our gateway WITHOUT valid OCPP Basic-Auth credentials. Two paths:
//
//   1. Identity string MATCHES an existing OcppIdentity (case-
//      insensitive lookup): update OcppIdentity.last_seen_at on the
//      matching row and DO NOT touch pending_discoveries. The
//      operator's already onboarded this charger; the connection
//      attempt should enrich the existing record, not pollute the
//      pending list.
//
//   2. No matching OcppIdentity: upsert pending_discoveries as
//      before. These are truly unknown chargers that the operator
//      hasn't claimed yet.
//
// Same shared-secret gating (OCPP_INGEST_SECRET) as ocpp-auth so the
// gateway is the only legitimate caller. Always 200 (or 401 on bad
// secret); the gateway returns 401 to the charger regardless of
// which path we took here.

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
    // Path 1: identity already provisioned → enrich the existing row.
    // Match case-insensitive (Zaptec sends lowercase, DB has whatever
    // case the import landed). updateMany so multiple matches —
    // theoretically possible across orgs — all get refreshed.
    const matched = await db.ocppIdentity.updateMany({
      where: {
        identityString: { equals: identityString, mode: "insensitive" },
      },
      data: { lastSeenAt: new Date() },
    });
    if (matched.count > 0) {
      return c.json({ ok: true, enriched: matched.count });
    }

    // Path 2: truly unknown — upsert into the pending pool.
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

  return c.json({ ok: true, enriched: 0 });
});
