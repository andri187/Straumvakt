// Outbound-command dispatcher — queue-driven.
//
// This is the queue consumer's per-message handler. The producer
// (admin enqueue routes) writes a row to ocpp.outbound_commands AND
// publishes { commandId } to OUTBOUND_QUEUE. This handler:
//
//   1. Atomically "claims" the row via a single-row UPDATE...WHERE
//      status = 'pending'. If the row was already claimed (duplicate
//      delivery), already cancelled by an operator, or already acked,
//      claim returns no row and we ack the message.
//
//   2. Looks up the dispatch target by routedTo. No target → mark the
//      row failed, ack the message.
//
//   3. Calls target.dispatch(...). On ack → mark row 'acked' + ack
//      message. On permanent → mark 'failed' + ack message. On
//      retriable → throw, letting CF Queue redeliver (the queue's
//      max_retries + retry_delay carry the backoff).
//
//   4. The row's `attempts` counter grew at claim time; max-attempts
//      enforcement happens in markFailed when CF gives up (via DLQ).
//
// Compared to the monolith batch+cron tick, this is per-message — but
// the OCPP semantics (action map, gateway-503 = retriable, gateway-5xx
// = retriable, gateway-4xx = permanent) are unchanged.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type {
  ClaimedCommand,
  DispatchResult,
  TargetRegistry,
} from "./dispatch-targets";

type ClaimedRow = {
  id: string;
  orgId: string;
  identityId: string;
  controlDomain: string;
  routedTo: string;
  payload: Prisma.JsonValue;
  attempts: number;
  correlationId: string;
};

/**
 * Atomic single-row claim. Returns the row only if it was 'pending';
 * otherwise returns null (already taken, cancelled, acked, or failed).
 */
async function claimById(
  db: PrismaClient,
  commandId: string,
  crashRetryFloorSec: number,
): Promise<ClaimedCommand | null> {
  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE ocpp.outbound_commands
    SET
      attempts = outbound_commands.attempts + 1,
      last_attempt_at = NOW(),
      not_before = NOW() + make_interval(secs => ${crashRetryFloorSec})
    WHERE id = ${commandId}::uuid
      AND status = 'pending'
    RETURNING
      outbound_commands.id,
      outbound_commands.org_id            AS "orgId",
      outbound_commands.identity_id       AS "identityId",
      outbound_commands.control_domain    AS "controlDomain",
      outbound_commands.routed_to         AS "routedTo",
      outbound_commands.payload           AS "payload",
      outbound_commands.attempts          AS "attempts",
      outbound_commands.correlation_id    AS "correlationId"
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    orgId: r.orgId,
    identityId: r.identityId,
    controlDomain: r.controlDomain,
    routedTo: r.routedTo,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    correlationId: r.correlationId,
    attempts: r.attempts,
  };
}

async function markAcked(
  db: PrismaClient,
  commandId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db.outboundCommand.update({
    where: { id: commandId },
    data: {
      status: "acked",
      result: result as Prisma.InputJsonValue,
    },
  });
}

async function markFailed(
  db: PrismaClient,
  commandId: string,
  error: string,
): Promise<void> {
  await db.outboundCommand.update({
    where: { id: commandId },
    data: {
      status: "failed",
      result: { error } as Prisma.InputJsonValue,
    },
  });
}

export type ProcessOutcome =
  | { kind: "acked" }
  | { kind: "failed"; error: string }
  | { kind: "skipped"; reason: string }
  | { kind: "retry"; error: string };

/**
 * Process one queue message. Returns the outcome so the queue handler
 * can decide message.ack() vs message.retry().
 *
 * crashRetryFloorSec — seconds the row is un-eligible after the claim,
 * matching the monolith's safety net (default 30). Mostly redundant with
 * CF Queue's own retry_delay, but cheap insurance.
 */
export async function processCommand(
  db: PrismaClient,
  registry: TargetRegistry,
  commandId: string,
  opts: { crashRetryFloorSec?: number } = {},
): Promise<ProcessOutcome> {
  const claimed = await claimById(db, commandId, opts.crashRetryFloorSec ?? 30);
  if (!claimed) return { kind: "skipped", reason: "not_pending" };

  const target = registry.get(claimed.routedTo);
  if (!target) {
    await markFailed(db, claimed.id, `no target registered for ${claimed.routedTo}`);
    return { kind: "failed", error: `no_target:${claimed.routedTo}` };
  }

  let result: DispatchResult;
  try {
    result = await target.dispatch(claimed);
  } catch (err) {
    result = {
      kind: "retriable",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.kind === "ack") {
    await markAcked(db, claimed.id, result.result);
    return { kind: "acked" };
  }
  if (result.kind === "permanent") {
    await markFailed(db, claimed.id, result.error);
    return { kind: "failed", error: result.error };
  }
  // retriable — leave the row pending; CF Queue redelivers per its
  // retry policy. After max_retries, the message lands in DLQ; a DLQ
  // consumer (or a follow-up) would mark the row failed.
  return { kind: "retry", error: result.error };
}

/**
 * Sweeper — re-publish any stuck pending row whose not_before is in
 * the past. Catches the producer-publish-failed race (row written but
 * queue.send failed) and any DLQ'd messages whose row is still pending.
 *
 * Called from the scheduled handler (cron).
 */
export async function sweepStuckPending(
  db: PrismaClient,
  publish: (commandId: string) => Promise<void>,
  opts: { staleAfterSec?: number; batchLimit?: number } = {},
): Promise<{ republished: number }> {
  const staleAfterSec = opts.staleAfterSec ?? 60;
  const batchLimit = opts.batchLimit ?? 100;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ocpp.outbound_commands
    WHERE status = 'pending'
      AND not_before <= NOW() - make_interval(secs => ${staleAfterSec})
    ORDER BY not_before ASC
    LIMIT ${batchLimit}
  `;
  for (const r of rows) await publish(r.id);
  return { republished: rows.length };
}
