/**
 * POST /api/admin/chargers/[ocppIdentityId]/remote-stop
 *
 * Enqueues a remote-stop command on the outbox (controlDomain =
 * `remote_stop`). The OCPP-side action name is resolved by the
 * dispatch target, not this route.
 *
 * Body: { transactionId: number }   — the OCPP transaction id from
 *                                      session-start. Operator console
 *                                      looks it up from the active
 *                                      ChargeSession row.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, unauthorized } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enqueueCommand } from "@/lib/repositories/outbound-commands";

const BodySchema = z.object({
  transactionId: z.number().int(),
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

  const identity = await prisma().ocppIdentity.findUnique({
    where: { id: ocppIdentityId },
    select: { id: true, orgId: true },
  });
  if (!identity) {
    return NextResponse.json({ error: "ocpp identity not found" }, { status: 404 });
  }

  const enqueued = await enqueueCommand({
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "remote_stop",
    routedTo: "ocpp",
    payload: { transactionId: parsed.data.transactionId },
    correlationId: randomUUID(),
    requestedBy: null,
  });

  return NextResponse.json(
    { commandId: enqueued.id, status: enqueued.status },
    { status: 202 },
  );
}
