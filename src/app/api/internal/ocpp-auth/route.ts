/**
 * POST /api/internal/ocpp-auth
 *
 * Gateway-only endpoint — the OCPP gateway Worker calls this via
 * Cloudflare Service Binding on every WebSocket upgrade to verify the
 * charger's Basic-Auth credentials and resolve the OCPPIdentity UUID
 * the gateway will use as its Durable Object key.
 *
 * Gated by the same `OCPP_INGEST_SECRET` header the event-ingest
 * route uses (ADR 0004) — any request missing it is closed by default.
 *
 * Request body:
 *   { identityString: string, password: string }
 *
 * Response (200):
 *   { ok: true, identityId: UUID, orgId: UUID }
 *
 * Response (401 for wrong secret, 403 for wrong Basic-Auth):
 *   { ok: false, error: "..." }
 */
import { NextResponse } from "next/server";
import { verifyIngest } from "@/lib/ocpp/ingest-auth";
import { sha256Hex, hexEquals } from "@/lib/ocpp/internal-auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const authFail = verifyIngest(req);
  if (authFail) return authFail;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "malformed json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "body not object" }, { status: 400 });
  }
  const { identityString, password } = body as {
    identityString?: unknown;
    password?: unknown;
  };
  if (typeof identityString !== "string" || identityString.length === 0) {
    return NextResponse.json({ ok: false, error: "identityString required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ ok: false, error: "password required" }, { status: 400 });
  }

  const identity = await prisma().ocppIdentity.findFirst({
    where: { identityString },
    select: { id: true, orgId: true, authSecretHash: true, status: true },
  });

  if (!identity) {
    // Hash even on miss to avoid timing side-channel — same pattern
    // as password-check on a non-existent user.
    await sha256Hex(password);

    // Upsert into pending_discoveries so the operator sees this charger
    // in /chargers/pending. Best-effort — failure here doesn't change
    // the auth response. Identity-string is PK; concurrent attempts
    // from the same charger increment the counter atomically.
    try {
      await recordPendingDiscovery(identityString, req);
    } catch (err) {
      console.error("[ocpp-auth] pending_discoveries upsert failed", {
        identityString,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  // Legacy UI-Worker dual-mount (Sprint 4.5 cutover): apps/api is the
  // gateway's actual auth target now, so this branch is dead code in
  // production. Keep null-handling defensive in case anything still
  // routes here during a deploy-window blip.
  if (identity.authSecretHash === null) {
    return NextResponse.json(
      { ok: true, identityId: identity.id, orgId: identity.orgId },
      { status: 200 },
    );
  }
  const providedHash = await sha256Hex(password);
  if (!hexEquals(providedHash, identity.authSecretHash.toLowerCase())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  return NextResponse.json(
    { ok: true, identityId: identity.id, orgId: identity.orgId },
    { status: 200 },
  );
}

/**
 * Upsert into ocpp.pending_discoveries. Captured fields are the
 * minimum useful for an operator to triage: when first/last seen, how
 * many attempts, and the connecting peer. Payload-summary is left
 * null at the auth stage — the gateway can layer in BootNotification
 * details on a later fail if it wants.
 */
async function recordPendingDiscovery(
  identityString: string,
  req: Request,
): Promise<void> {
  // CF-Connecting-IP is set by Cloudflare on internal hops too; fall
  // back to x-real-ip / x-forwarded-for for compatibility.
  const remoteAddr =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    null;
  const userAgent = req.headers.get("user-agent");

  await prisma().pendingDiscovery.upsert({
    where: { identityString },
    create: {
      identityString,
      attemptCount: 1,
      remoteAddr: remoteAddr ? remoteAddr.slice(0, 64) : null,
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
    },
    update: {
      lastSeenAt: new Date(),
      attemptCount: { increment: 1 },
      remoteAddr: remoteAddr ? remoteAddr.slice(0, 64) : null,
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
    },
  });
}
