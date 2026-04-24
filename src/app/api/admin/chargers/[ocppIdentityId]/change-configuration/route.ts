/**
 * POST /api/admin/chargers/[ocppIdentityId]/change-configuration
 *
 * Enqueues a ChangeConfiguration command. Charger replies with
 * `{status: "Accepted" | "Rejected" | "RebootRequired" | "NotSupported"}`
 * which lands as an `ocpp.command_result` event in the log.
 *
 * Body: { key: string, value: string }   — OCPP 1.6 configuration key
 *                                           and new value. See OCPP
 *                                           1.6 spec §9 for the
 *                                           vendor-supported key list.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, unauthorized } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enqueueCommand } from "@/lib/repositories/outbound-commands";

const BodySchema = z.object({
  key: z.string().min(1).max(50),
  value: z.string().max(500),
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
    controlDomain: "change_configuration",
    routedTo: "ocpp",
    payload: { key: parsed.data.key, value: parsed.data.value },
    correlationId: randomUUID(),
    requestedBy: null,
  });

  return NextResponse.json(
    { commandId: enqueued.id, status: enqueued.status },
    { status: 202 },
  );
}
