// Outbound-commands repository — write side of the outbox pattern.
//
// API Worker only enqueues. The dispatcher (still inside the Next.js
// monolith for now — see ADR 0013 phase plan) reads pending rows from
// the same Hyperdrive-backed Postgres and dispatches.
//
// Status starts at 'pending' with notBefore=now. Caller passes a
// caller-supplied correlationId so the row links back to its request.

import type { PrismaClient, Prisma } from "../generated/prisma/client";

export interface EnqueueCommand {
  orgId: string;
  identityId: string;
  controlDomain: string;
  routedTo: string;
  payload: Record<string, unknown>;
  correlationId: string;
  requestedBy?: string | null;
  notBefore?: Date;
}

export interface EnqueuedCommand {
  id: string;
  status: string;
}

export async function enqueueCommand(
  db: PrismaClient,
  cmd: EnqueueCommand,
): Promise<EnqueuedCommand> {
  const row = await db.outboundCommand.create({
    data: {
      orgId: cmd.orgId,
      identityId: cmd.identityId,
      controlDomain: cmd.controlDomain,
      routedTo: cmd.routedTo,
      payload: cmd.payload as Prisma.InputJsonValue,
      status: "pending",
      attempts: 0,
      notBefore: cmd.notBefore ?? new Date(),
      correlationId: cmd.correlationId,
      requestedBy: cmd.requestedBy ?? null,
    },
    select: { id: true, status: true },
  });
  return row;
}
