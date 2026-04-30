// Gateway → API Worker auth path.
//
// POST /api/internal/ocpp-auth — called by the OCPP gateway on every
// WebSocket upgrade to verify the charger's Basic-Auth credentials
// and resolve the OcppIdentity UUID the gateway routes its Durable
// Object by. Invocation is via Cloudflare Service Binding (no public
// hop) plus the OCPP_INGEST_SECRET shared-secret header (ADR 0004) as
// belt-and-braces.
//
// Identity-string match is **case-insensitive** — modern Zaptec
// firmware sends the deviceId lowercase, but the import pipeline
// stores whatever case the Zaptec API returns (typically uppercase).
// Without normalisation the two never match. Same applies to operator
// hand-typed identities. The pending_discoveries upsert key is also
// lowercased so retries from the same charger don't pile up under
// multiple cases.
//
// Request body:
//   { identityString: string, password: string }
// 200: { ok: true, identityId: UUID, orgId: UUID }
// 401: missing/bad ingest secret
// 403: identity unknown OR password mismatch (with pending upsert)

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { sha256Hex } from "../../lib/sha256";
import { hexEquals, verifyIngest } from "../../lib/ocpp-internal-auth";
import { upsertPendingDiscovery } from "../../repositories/pending-discoveries";
import type { Env } from "../../bindings";

export const internalOcppAuth = new Hono<{ Bindings: Env }>();

internalOcppAuth.post("/", async (c) => {
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
  const { identityString, password } = body as {
    identityString?: unknown;
    password?: unknown;
  };
  if (typeof identityString !== "string" || identityString.length === 0) {
    return c.json({ ok: false, error: "identityString required" }, 400);
  }
  if (typeof password !== "string" || password.length === 0) {
    return c.json({ ok: false, error: "password required" }, 400);
  }

  const db = makePrisma(c.env);

  // Case-insensitive lookup — matches whatever the operator typed in
  // /chargers/new or whatever case the Zaptec import landed.
  const identity = await db.ocppIdentity.findFirst({
    where: { identityString: { equals: identityString, mode: "insensitive" } },
    select: { id: true, orgId: true, authSecretHash: true, status: true },
  });

  if (!identity) {
    // Hash even on miss — equalises CPU cost to defeat timing
    // discrimination of "user exists" vs "wrong password."
    await sha256Hex(password);
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
      console.error("[ocpp-auth] pending_discoveries upsert failed", {
        identityString,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return c.json({ ok: false, error: "unauthorized" }, 403);
  }

  const providedHash = await sha256Hex(password);
  if (!hexEquals(providedHash, identity.authSecretHash.toLowerCase())) {
    return c.json({ ok: false, error: "unauthorized" }, 403);
  }

  return c.json(
    { ok: true, identityId: identity.id, orgId: identity.orgId },
    200,
  );
});
