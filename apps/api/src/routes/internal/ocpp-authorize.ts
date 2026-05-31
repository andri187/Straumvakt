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
// 200: { verdict, reason, userId?, idTokenId?, enforceAuthorize }
//      verdict ∈ Accepted | Blocked | Expired | Invalid
//      reason  is a stable enum value for observability
//      userId is set only when verdict === "Accepted"
//      enforceAuthorize comes from the Installation (Sprint 4 4.6).
//      The gateway honours the verdict only when this is true; when
//      false (default) it logs the verdict but always replies Accepted.
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
  /**
   * Per-installation auth-enforce gate (Sprint 4 milestone 4.6).
   * Defaults to false on resolve failure (orphan identity / Installation
   * row not found / DB column missing pre-migration) so the gateway
   * stays in shadow mode until the operator explicitly opts in.
   */
  enforceAuthorize: boolean;
}

export type AuthorizeReason =
  | "ok"
  | "unknown_id_tag"
  | "revoked"
  | "suspended"
  | "expired_status"
  | "expiry_passed"
  | "scope_mismatch"
  | "no_contract"
  | "no_billable_clauses"
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
 * Decision rules:
 *   1. IdToken not found → Invalid
 *   2. status='revoked' → Blocked
 *   3. status='suspended' → Blocked
 *   4. status='expired' → Expired
 *   5. status='active' but expiresAt < now → Expired
 *   6. status='active' AND expiry OK AND scopeInstallationId set:
 *        resolve identity's installation; mismatch → Invalid
 *        (don't leak that a token exists for another installation)
 *   7. All checks pass → Accepted with userId
 *
 * Always returns the enforceAuthorize flag (Sprint 4 4.6) for the
 * Installation the OCPP identity belongs to, defaulted to false when
 * the identity row is missing or unattached. The gateway DO uses the
 * flag to decide whether to honour the verdict.
 */
export async function resolveAuthorize(
  db: PrismaLike,
  input: { idTag: string; identityId: string; orgId: string },
): Promise<AuthorizeResult> {
  // Resolve the identity → installation chain ONCE up-front so we can
  // include enforceAuthorize on every response (including failure
  // paths). Defaulting to false keeps the gateway in shadow mode for
  // any identity that isn't yet wired up.
  const identity = await db.ocppIdentity.findUnique({
    where: { id: input.identityId },
    select: {
      chargingStation: {
        select: {
          installationId: true,
          installation: { select: { enforceAuthorize: true } },
        },
      },
    },
  });
  const installationId =
    identity?.chargingStation?.installationId ?? null;
  const enforceAuthorize =
    identity?.chargingStation?.installation?.enforceAuthorize ?? false;

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
    return { verdict: "Invalid", reason: "unknown_id_tag", enforceAuthorize };
  }

  switch (token.status) {
    case "revoked":
      return { verdict: "Blocked", reason: "revoked", idTokenId: token.id, enforceAuthorize };
    case "suspended":
      return { verdict: "Blocked", reason: "suspended", idTokenId: token.id, enforceAuthorize };
    case "expired":
      return { verdict: "Expired", reason: "expired_status", idTokenId: token.id, enforceAuthorize };
    case "active":
      break;
    default:
      // Defensive — the IdTokenStatus enum is closed today (active |
      // suspended | revoked | expired) but Prisma may add values
      // without us noticing. Don't accept on unknown status.
      return { verdict: "Invalid", reason: "unknown_status", idTokenId: token.id, enforceAuthorize };
  }

  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    return { verdict: "Expired", reason: "expiry_passed", idTokenId: token.id, enforceAuthorize };
  }

  if (token.scopeInstallationId) {
    if (!installationId || installationId !== token.scopeInstallationId) {
      return { verdict: "Invalid", reason: "scope_mismatch", idTokenId: token.id, enforceAuthorize };
    }
  }

  // ADR 0019 milestone A.11 — fold the agreement-membership check into
  // OCPP Authorize. A driver may charge at this installation only if
  // they hold an active DriverGroupMembership under an installation-type
  // Agreement anchored at the charger's installation.
  //
  // OCPP 1.6 has no richer status than Blocked, so 'no_contract' is the
  // internal reason; the wire-level verdict is Blocked. The richer
  // reason is for operator logs / debug page.
  //
  // Gated by the per-installation `enforceAuthorize` flag. While the
  // installation flag is off, the resolver does NOT compute a denial
  // for missing membership — A.11 is a new return path and the default
  // is "no enforcement" so committing this code changes nothing at any
  // installation. When an operator flips enforceAuthorize=true, A.11
  // activates alongside the existing token-status enforcement.
  //
  // We also only enforce when we have an installationId to check
  // against. A charger whose ocpp_identity has no installation chain
  // can't be resolved here; preserving Accept matches the existing
  // scope-check semantics.
  if (enforceAuthorize && installationId) {
    const now = new Date();
    const membership = await db.driverGroupMembership.findFirst({
      where: {
        userId: token.userId,
        driverGroup: {
          agreement: {
            agreementType: "installation",
            installationId,
            status: "active",
            effectiveFrom: { lte: now },
            OR: [
              { effectiveUntil: null },
              { effectiveUntil: { gt: now } },
            ],
          },
        },
      },
      // Surface the resolved agreement id so the clause-count gate below
      // can verify the agreement actually carries billable terms. Without
      // this, an empty-stub agreement (membership row exists but the
      // parent agreement has zero clauses) would Accept here and produce
      // a silent zero-cost invoice at session-stop. See GAP-2 orphan
      // investigation.
      select: {
        id: true,
        driverGroup: { select: { agreementId: true } },
      },
    });
    if (!membership) {
      return { verdict: "Blocked", reason: "no_contract", idTokenId: token.id, enforceAuthorize };
    }

    // GAP-2 — strengthen A.11: an agreement with zero clauses produces no
    // billing lines at session-stop ("silent zero-cost invoice"). Treat
    // it the same as "no contract" at the gate. The AgreementClause model
    // has no per-row activation column today (see prisma/schema.prisma);
    // presence of a row IS the active state, so a row count of 0 is the
    // correct condition.
    //
    // Reason `no_billable_clauses` is observability metadata only — the
    // wire-level verdict remains Blocked, same as `no_contract`. Default
    // behaviour (flag OFF) is unchanged because this whole branch is
    // gated by enforceAuthorize.
    const agreementId = membership.driverGroup.agreementId;
    const activeClauseCount = await db.agreementClause.count({
      where: { agreementId },
    });
    if (activeClauseCount === 0) {
      return {
        verdict: "Blocked",
        reason: "no_billable_clauses",
        idTokenId: token.id,
        enforceAuthorize,
      };
    }
  }

  return {
    verdict: "Accepted",
    reason: "ok",
    userId: token.userId,
    idTokenId: token.id,
    enforceAuthorize,
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
      select: {
        chargingStation: {
          select: {
            installationId: true;
            installation: { select: { enforceAuthorize: true } };
          };
        };
      };
    }) => Promise<{
      chargingStation: {
        installationId: string | null;
        installation: { enforceAuthorize: boolean } | null;
      } | null;
    } | null>;
  };
  driverGroupMembership: {
    findFirst: (args: {
      where: {
        userId: string;
        driverGroup: {
          agreement: Record<string, unknown>;
        };
      };
      select: {
        id: true;
        driverGroup: { select: { agreementId: true } };
      };
    }) => Promise<{
      id: string;
      driverGroup: { agreementId: string };
    } | null>;
  };
  agreementClause: {
    count: (args: {
      where: { agreementId: string };
    }) => Promise<number>;
  };
}
