/**
 * POST /api/admin/chargers/[ocppIdentityId]/remote-start
 *
 * Enqueues a remote-start command on the outbox (controlDomain =
 * `remote_start`). The dispatcher (Sprint 1.3) picks it up on the
 * next tick and hands it to the target named in `routedTo`. For 1.3
 * that's always `'ocpp'` via the stub target; a routing resolver
 * picks vendor paths in Sprint 2.
 *
 * Auth — under `/api/admin/*`, the existing middleware already
 * gates this with the admin session cookie. Defense-in-depth: we also
 * call `requireAdmin()` inside the handler so a middleware regression
 * can't expose the route. The OCPP-side translation to protocol
 * vocabulary is the gateway's job, not this route's.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, unauthorized } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enqueueCommand } from "@/lib/repositories/outbound-commands";

const BodySchema = z.object({
  connectorId: z.uuid(),
  idTag: z.string().max(20).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ ocppIdentityId: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();

  const { ocppIdentityId } = await context.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  // Load the OCPP identity so we can attach the right orgId and refuse
  // up-front if the identity doesn't exist. The connector-belongs-to-
  // identity check happens here too — cheap guard against obvious
  // operator mistakes.
  const identity = await prisma().ocppIdentity.findUnique({
    where: { id: ocppIdentityId },
    select: {
      id: true,
      orgId: true,
      chargingStationId: true,
    },
  });
  if (!identity) {
    return NextResponse.json({ error: "ocpp identity not found" }, { status: 404 });
  }
  // Connector now anchors on EVSE not OcppIdentity (ADR 0012). Verify the
  // requested connector is on the same charging station as this identity.
  const connector = await prisma().connector.findFirst({
    where: {
      id: parsed.data.connectorId,
      evse: { chargingStationId: identity.chargingStationId },
    },
    select: { id: true },
  });
  if (!connector) {
    return NextResponse.json(
      { error: "connector does not belong to this ocpp identity" },
      { status: 400 },
    );
  }

  const enqueued = await enqueueCommand({
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "remote_start",
    routedTo: "ocpp", // hardcoded in 1.3; Sprint 2 routing resolver picks vendor paths
    payload: {
      connectorId: parsed.data.connectorId,
      idTag: parsed.data.idTag,
    },
    correlationId: randomUUID(),
    requestedBy: null, // admin session does not carry a user id in this sprint
  });

  return NextResponse.json(
    { commandId: enqueued.id, status: enqueued.status },
    { status: 202 },
  );
}
