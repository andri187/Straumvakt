/**
 * Outbound-commands repository — the write side of the outbox pattern.
 *
 * Commands are enqueued here by API handlers (e.g. the operator-console
 * remote-start route) and later picked up by the dispatcher (see
 * `src/lib/ocpp/dispatcher.ts`).
 *
 * Status machine:
 *
 *   pending ──► (dispatch attempt) ──► acked        (target ACK'd)
 *      │                            └► failed       (permanent error, or max attempts)
 *      │                            └► pending      (retriable error, backed off)
 *      │
 *      └► cancelled                                   (operator aborts before dispatch)
 *
 * Crash-resilience invariant: the dispatcher never moves status to
 * 'acked' or 'failed' until it has a final result from the target.
 * A crash between claim and result leaves the row at 'pending' with
 * `notBefore` set to a retry floor by the claim, so the next tick
 * picks it up after a breathing window.
 */
import type { CommandStatus, Prisma } from "straumvakt-prisma-cf-client/client";
import { withOrgContext } from "./_context";

export interface EnqueueCommand {
  orgId: string;
  identityId: string;
  controlDomain: string;
  routedTo: string;
  payload: Record<string, unknown>;
  /** Caller-supplied trace id so the command is linkable to the originating request. */
  correlationId: string;
  /** User id of the operator that triggered this command, when applicable. */
  requestedBy?: string | null;
  /** Delay first attempt — defaults to now (eligible immediately). */
  notBefore?: Date;
}

export interface EnqueuedCommand {
  id: string;
  status: CommandStatus;
}

export async function enqueueCommand(cmd: EnqueueCommand): Promise<EnqueuedCommand> {
  return withOrgContext(cmd.orgId, async ({ db }) => {
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
  });
}

/**
 * Transition a command from pending → cancelled before any dispatch has
 * succeeded. Idempotent: cancelling a non-pending command is a no-op.
 */
export async function cancelCommand(orgId: string, commandId: string): Promise<void> {
  await withOrgContext(orgId, async ({ db, requireOrg }) => {
    await db.outboundCommand.updateMany({
      where: requireOrg({ id: commandId, status: "pending" }),
      data: { status: "cancelled" },
    });
  });
}

/** Called by the dispatcher when a target ACKs the command. */
export async function markAcked(
  tx: Prisma.TransactionClient,
  commandId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await tx.outboundCommand.update({
    where: { id: commandId },
    data: {
      status: "acked",
      result: result as Prisma.InputJsonValue,
    },
  });
}

/** Called by the dispatcher on a permanent failure or attempts-exhausted. */
export async function markFailed(
  tx: Prisma.TransactionClient,
  commandId: string,
  error: string,
): Promise<void> {
  await tx.outboundCommand.update({
    where: { id: commandId },
    data: {
      status: "failed",
      result: { error } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Retriable failure — row stays pending, notBefore pushed out by the
 * caller-computed backoff. attempts was already incremented during
 * claim so this write does not touch it.
 */
export async function markRetriable(
  tx: Prisma.TransactionClient,
  commandId: string,
  nextNotBefore: Date,
  error: string,
): Promise<void> {
  await tx.outboundCommand.update({
    where: { id: commandId },
    data: {
      status: "pending",
      notBefore: nextNotBefore,
      result: { error, retriable: true } as Prisma.InputJsonValue,
    },
  });
}
