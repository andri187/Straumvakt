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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
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
