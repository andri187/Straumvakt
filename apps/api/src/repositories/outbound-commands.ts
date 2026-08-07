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
import type { Db } from "../lib/drizzle";
import { outboundCommands } from "@straumvakt/shared/db/protocol";
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

/**
 * Dual-client — see lib/audit.ts for why. Two callers on different port
 * schedules (routes/admin/chargers.ts is Drizzle as of 2026-08-07,
 * routes/public/driver.ts is not yet) and one insert between them.
 * Temporary; drop the Prisma branch when driver.ts ports.
 */
export async function enqueueCommand(
  db: PrismaClient | Db,
  queue: Queue<OutboundCommandMessage>,
  cmd: EnqueueCommand,
): Promise<EnqueuedCommand> {
  const values = {
    orgId: cmd.orgId,
    identityId: cmd.identityId,
    controlDomain: cmd.controlDomain,
    routedTo: cmd.routedTo,
    // `as const` matters: a shared object literal widens "pending" to string,
    // and both clients type this column as an enum.
    status: "pending" as const,
    attempts: 0,
    notBefore: cmd.notBefore ?? new Date(),
    correlationId: cmd.correlationId,
    requestedBy: cmd.requestedBy ?? null,
  };
  const row =
    typeof (db as Partial<Db>).insert === "function"
      ? (
          await (db as Db)
            .insert(outboundCommands)
            .values({ ...values, payload: cmd.payload })
            .returning({ id: outboundCommands.id, status: outboundCommands.status })
        )[0]!
      : await (db as PrismaClient).outboundCommand.create({
          data: { ...values, payload: cmd.payload as Prisma.InputJsonValue },
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
