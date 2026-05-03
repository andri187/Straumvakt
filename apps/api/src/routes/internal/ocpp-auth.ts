// Gateway → API Worker auth path.
//
// POST /api/internal/ocpp-auth — called by the OCPP gateway on every
// WebSocket upgrade to verify the charger's Basic-Auth credentials
// (or absence of them, on no-auth installations) and resolve the
// OcppIdentity UUID the gateway routes its Durable Object by.
// Invocation is via Cloudflare Service Binding (no public hop) plus
// the OCPP_INGEST_SECRET shared-secret header (ADR 0004) as belt-
// and-braces.
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
//   { identityString: string, password?: string }
//
// `password` is now optional — when an installation is on the no-auth
// path (every OcppIdentity row has a NULL auth_secret_hash), the
// gateway invokes this endpoint without credentials and we accept on
// identity match alone. When `password` IS provided AND the stored
// hash is non-null, we verify normally.
//
// Decision matrix:
//   identity not found              → 403 + pending_discovery upsert
//   stored hash NULL, no password   → 200 (no-auth flow)
//   stored hash NULL, password sent → 200 (presented but not required)
//   stored hash set, password sent  → 200 if match, 403 if mismatch
//   stored hash set, no password    → 403 (auth required, missing)
//
// Status codes:
//   200: { ok: true, identityId: UUID, orgId: UUID, authMode: "basic" | "none" }
//   400: malformed body
//   401: missing/bad ingest secret
//   403: identity unknown OR password mismatch OR password missing-but-required

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
  // password is now optional — null/undefined means "gateway received
  // no Basic Auth header." Empty string is also treated as not-provided.
  const providedPassword =
    typeof password === "string" && password.length > 0 ? password : null;

  const db = makePrisma(c.env);

  const identity = await db.ocppIdentity.findFirst({
    where: { identityString: { equals: identityString, mode: "insensitive" } },
    select: { id: true, orgId: true, authSecretHash: true, status: true },
  });

  if (!identity) {
    // Equalise CPU cost — hash even on miss so "user exists" vs
    // "wrong password" can't be distinguished by timing. Hashes the
    // empty string when the gateway sent no creds; still a constant-
    // cost no-op compared to the find.
    await sha256Hex(providedPassword ?? "");
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

  // No-auth installation — accept on identity match alone.
  if (identity.authSecretHash === null) {
    return c.json(
      { ok: true, identityId: identity.id, orgId: identity.orgId, authMode: "none" },
      200,
    );
  }

  // Auth required but the gateway sent nothing — reject. The gateway
  // 401's the charger and logs pending_discovery on its side.
  if (providedPassword === null) {
    return c.json({ ok: false, error: "auth_required" }, 403);
  }

  const providedHash = await sha256Hex(providedPassword);
  if (!hexEquals(providedHash, identity.authSecretHash.toLowerCase())) {
    return c.json({ ok: false, error: "unauthorized" }, 403);
  }

  return c.json(
    { ok: true, identityId: identity.id, orgId: identity.orgId, authMode: "basic" },
    200,
  );
});
