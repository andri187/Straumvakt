// Outbound-commands repository — write side of the outbox pattern.
//
// Producer flow:
//   1. Insert row into ocpp.outbound_commands (status=pending).
//   2. Publish { commandId } to OUTBOUND_QUEUE.
//
// The row is the source of truth for state and history; the queue
// message is just a notification ("wake up and process this id").
// Consumer side lives in src/lib/dispatcher.ts (processCommand).
//
// If queue.send throws, the row is still durable — the periodic
// sweeper (scheduled handler in src/index.ts) will re-publish stale
// pending rows.

import type { Queue } from "@cloudflare/workers-types";
import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { OutboundCommandMessage } from "../bindings";

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
  queue: Queue<OutboundCommandMessage>,
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
  // Best-effort publish. If this throws (queue back-pressure, transient
  // CF outage), the sweeper picks the row up later — no corruption.
  try {
    await queue.send({ commandId: row.id });
  } catch (err) {
    console.error("OUTBOUND_QUEUE.send failed", {
      commandId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return row;
}
