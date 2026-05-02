// Gateway → API Worker authorize path.
//
// POST /api/internal/ocpp-authorize — called by the OCPP gateway DO
// when a charger sends Authorize.req (RFID tap) or StartTransaction.req
// (which carries an idTag too). The API resolves the idTag against the
// IdToken table and returns a verdict. The gateway is responsible for
// translating the verdict into an OCPP idTagInfo response — for Sprint 3
// closure (shadow mode) the gateway always replies Accepted to the
// charger regardless, so customer charging keeps working while we
// observe what the verdict pipeline says.
//
// Invocation is via Cloudflare Service Binding (no public hop) plus the
// OCPP_INGEST_SECRET shared-secret header (ADR 0004), same as the
// existing /api/internal/ocpp-auth route.
//
// Request body:
//   { idTag: string, identityId: UUID, orgId: UUID }
// 200: { verdict, reason, userId?, idTokenId? }
//      verdict ∈ Accepted | Blocked | Expired | Invalid
//      reason  is a stable enum value for observability
//      userId is set only when verdict === "Accepted"
// 400: malformed body
// 401: missing/bad ingest secret

import { Hono } from "hono";
import { makePrisma } from "../../lib/prisma";
import { verifyIngest } from "../../lib/ocpp-internal-auth";
import type { Env } from "../../bindings";

export const internalOcppAuthorize = new Hono<{ Bindings: Env }>();

export type AuthorizeVerdict = "Accepted" | "Blocked" | "Expired" | "Invalid";

export interface AuthorizeResult {
  verdict: AuthorizeVerdict;
  reason: AuthorizeReason;
  userId?: string;
  idTokenId?: string;
}

export type AuthorizeReason =
  | "ok"
  | "unknown_id_tag"
  | "revoked"
  | "suspended"
  | "expired_status"
  | "expiry_passed"
  | "scope_mismatch"
  | "unknown_status";

internalOcppAuthorize.post("/", async (c) => {
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
  const { idTag, identityId, orgId } = body as {
    idTag?: unknown;
    identityId?: unknown;
    orgId?: unknown;
  };
  if (typeof idTag !== "string" || idTag.length === 0) {
    return c.json({ ok: false, error: "idTag required" }, 400);
  }
  if (typeof identityId !== "string" || identityId.length === 0) {
    return c.json({ ok: false, error: "identityId required" }, 400);
  }
  if (typeof orgId !== "string" || orgId.length === 0) {
    return c.json({ ok: false, error: "orgId required" }, 400);
  }

  const db = makePrisma(c.env);
  const result = await resolveAuthorize(db, { idTag, identityId, orgId });
  return c.json(result, 200);
});

/**
 * Pure resolver — exported separately so tests can drive it without
 * spinning up Hono. The Prisma client is injected so the same function
 * works against a real DB or a hand-rolled mock. Returns the OCPP-shaped
 * verdict the gateway needs.
 *
 * Decision rules (Sprint 3 closure scope):
 *   1. IdToken not found → Invalid
 *   2. status='revoked' → Blocked
 *   3. status='expired' → Expired
 *   4. status='conflict' or 'pending' → Invalid (don't leak why)
 *   5. status='active' but expiresAt < now → Expired
 *   6. status='active' AND expiry OK AND scopeInstallationId set:
 *        resolve identity's installation; mismatch → Invalid
 *        (don't leak that a token exists for another installation)
 *   7. All checks pass → Accepted with userId
 *
 * Sprint 4+ adds: contract-level checks (DriverContract status, payer
 * org status), per-installation enforceAuthorize flag (gateway listens
 * to the verdict only when set), live token-cache invalidation on
 * revoke. Out of scope here.
 */
export async function resolveAuthorize(
  db: PrismaLike,
  input: { idTag: string; identityId: string; orgId: string },
): Promise<AuthorizeResult> {
  const token = await db.idToken.findUnique({
    where: { value: input.idTag },
    select: {
      id: true,
      userId: true,
      status: true,
      expiresAt: true,
      scopeInstallationId: true,
    },
  });

  if (!token) {
    return { verdict: "Invalid", reason: "unknown_id_tag" };
  }

  switch (token.status) {
    case "revoked":
      return { verdict: "Blocked", reason: "revoked", idTokenId: token.id };
    case "suspended":
      return { verdict: "Blocked", reason: "suspended", idTokenId: token.id };
    case "expired":
      return { verdict: "Expired", reason: "expired_status", idTokenId: token.id };
    case "active":
      break;
    default:
      // Defensive — the IdTokenStatus enum is closed today (active |
      // suspended | revoked | expired) but Prisma may add values
      // without us noticing. Don't accept on unknown status.
      return { verdict: "Invalid", reason: "unknown_status", idTokenId: token.id };
  }

  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    return { verdict: "Expired", reason: "expiry_passed", idTokenId: token.id };
  }

  if (token.scopeInstallationId) {
    const identity = await db.ocppIdentity.findUnique({
      where: { id: input.identityId },
      select: { chargingStation: { select: { installationId: true } } },
    });
    const installationId = identity?.chargingStation?.installationId ?? null;
    if (!installationId || installationId !== token.scopeInstallationId) {
      return { verdict: "Invalid", reason: "scope_mismatch", idTokenId: token.id };
    }
  }

  return {
    verdict: "Accepted",
    reason: "ok",
    userId: token.userId,
    idTokenId: token.id,
  };
}

/**
 * Narrow Prisma surface this resolver actually uses. Lets tests pass a
 * hand-rolled mock without needing a fully-typed PrismaClient.
 */
export interface PrismaLike {
  idToken: {
    findUnique: (args: {
      where: { value: string };
      select: {
        id: true;
        userId: true;
        status: true;
        expiresAt: true;
        scopeInstallationId: true;
      };
    }) => Promise<{
      id: string;
      userId: string;
      status: string;
      expiresAt: Date | null;
      scopeInstallationId: string | null;
    } | null>;
  };
  ocppIdentity: {
    findUnique: (args: {
      where: { id: string };
      select: { chargingStation: { select: { installationId: true } } };
    }) => Promise<{
      chargingStation: { installationId: string | null } | null;
    } | null>;
  };
}
