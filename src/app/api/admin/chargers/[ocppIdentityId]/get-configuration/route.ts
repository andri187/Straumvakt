/**
 * POST /api/admin/chargers/[ocppIdentityId]/get-configuration
 *
 * Enqueues a GetConfiguration command. Empty body returns ALL
 * configuration keys the charger knows about; a specific `key` array
 * narrows the query.
 *
 * The charger's CallResult is persisted as an `ocpp.command_result`
 * event in the event log (via the gateway DO → main app /api/ocpp/events
 * path). Operator reads the result from there.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, unauthorized } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { enqueueCommand } from "@/lib/repositories/outbound-commands";

const BodySchema = z.object({
  key: z.array(z.string().min(1).max(50)).max(50).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ ocppIdentityId: string }> },
) {
  const session = await requireAdmin();
  if (!session) return unauthorized();

  const { ocppIdentityId } = await context.params;

  // Body is optional — empty body = query all keys.
  let raw: unknown = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "malformed json" }, { status: 400 });
    }
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

  const payload: Record<string, unknown> = {};
  if (parsed.data.key) payload.key = parsed.data.key;

  const enqueued = await enqueueCommand({
    orgId: identity.orgId,
    identityId: identity.id,
    controlDomain: "get_configuration",
    routedTo: "ocpp",
    payload,
    correlationId: randomUUID(),
    requestedBy: null,
  });

  return NextResponse.json(
    { commandId: enqueued.id, status: enqueued.status },
    { status: 202 },
  );
}
