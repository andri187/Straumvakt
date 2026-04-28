/**
 * Outbox dispatcher — claims pending commands atomically, dispatches
 * via pluggable targets, persists results with retry/backoff.
 *
 * Concurrency — `FOR UPDATE SKIP LOCKED` on the inner SELECT is the
 * Postgres job-queue idiom. Concurrent dispatcher ticks never claim
 * the same row; a losing contender silently skips the locked row and
 * claims the next one. This is what makes "multiple dispatcher
 * workers" safe if we ever horizontally scale.
 *
 * Crash-resilience — the claim UPDATE increments `attempts` and sets
 * `notBefore = NOW() + CRASH_RETRY_FLOOR` atomically. If the process
 * dies between claim and result persistence, the row stays at status
 * 'pending' and becomes eligible again after the floor elapses. The
 * successful-ack and final-failure paths both overwrite this floor
 * in their own follow-up transactions.
 *
 * Retry policy — exponential backoff with cap:
 *   backoff_ms = min(BASE * 2^(attempts - 1), CAP)
 * After MAX_ATTEMPTS the command is marked `failed`.
 */
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  markAcked,
  markFailed,
  markRetriable,
} from "@/lib/repositories/outbound-commands";
import {
  type ClaimedCommand,
  type DispatchResult,
  type TargetRegistry,
  defaultRegistry,
} from "./dispatch-targets";

export interface DispatchTickOptions {
  /** Max commands claimed in one tick. Default: 16. */
  batchSize?: number;
  /** Seconds the row is un-eligible after claim, giving us breathing room if we crash mid-dispatch. Default: 30. */
  crashRetryFloorSec?: number;
  /** Base retry backoff in milliseconds. Default: 5000 (5s). */
  baseBackoffMs?: number;
  /** Cap retry backoff in milliseconds. Default: 300000 (5min). */
  capBackoffMs?: number;
  /** Commands that exceed this attempt count move to `failed`. Default: 10. */
  maxAttempts?: number;
  /** Target registry to dispatch through. Default: `defaultRegistry`. */
  registry?: TargetRegistry;
}

export interface TickSummary {
  claimed: number;
  acked: number;
  retried: number;
  failed: number;
  skipped: number; // commands whose `routedTo` had no registered target
}

/**
 * Pure — compute the next-attempt delay from an attempt counter.
 * Exposed so the retry policy can be unit-tested without the DB.
 */
export function computeRetryBackoffMs(
  attempts: number,
  baseMs: number,
  capMs: number,
): number {
  if (attempts < 1) return 0;
  const exp = Math.min(baseMs * 2 ** (attempts - 1), capMs);
  return Math.floor(exp);
}

/**
 * Claims pending commands and returns them for dispatch. Exposed for
 * test harnesses that want to exercise claim atomicity without the
 * dispatch half.
 */
export async function claimPending(
  db: PrismaClient,
  opts: Required<Pick<DispatchTickOptions, "batchSize" | "crashRetryFloorSec">>,
): Promise<ClaimedCommand[]> {
  const rows = await db.$queryRaw<ClaimedCommandRow[]>`
    UPDATE ocpp.outbound_commands
    SET
      attempts = outbound_commands.attempts + 1,
      last_attempt_at = NOW(),
      not_before = NOW() + make_interval(secs => ${opts.crashRetryFloorSec})
    FROM (
      SELECT id
      FROM ocpp.outbound_commands
      WHERE status = 'pending' AND not_before <= NOW()
      ORDER BY not_before ASC
      LIMIT ${opts.batchSize}
      FOR UPDATE SKIP LOCKED
    ) claim
    WHERE outbound_commands.id = claim.id
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
  return rows.map(rowToCommand);
}

type ClaimedCommandRow = {
  id: string;
  orgId: string;
  identityId: string;
  controlDomain: string;
  routedTo: string;
  payload: Prisma.JsonValue;
  attempts: number;
  correlationId: string;
};

function rowToCommand(r: ClaimedCommandRow): ClaimedCommand {
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

/**
 * One dispatcher tick. Cron Trigger calls this every 30s in 1.4;
 * tests call it directly. Safe to invoke concurrently — only one
 * tick per pending row thanks to FOR UPDATE SKIP LOCKED.
 */
export async function dispatchTick(
  db: PrismaClient,
  options: DispatchTickOptions = {},
): Promise<TickSummary> {
  const opts = {
    batchSize: options.batchSize ?? 16,
    crashRetryFloorSec: options.crashRetryFloorSec ?? 30,
    baseBackoffMs: options.baseBackoffMs ?? 5_000,
    capBackoffMs: options.capBackoffMs ?? 300_000,
    maxAttempts: options.maxAttempts ?? 10,
    registry: options.registry ?? defaultRegistry,
  };

  const claimed = await claimPending(db, opts);
  const summary: TickSummary = {
    claimed: claimed.length,
    acked: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  for (const cmd of claimed) {
    const target = opts.registry.get(cmd.routedTo);
    if (!target) {
      await db.$transaction(async (tx) => {
        await markFailed(tx, cmd.id, `no target registered for ${cmd.routedTo}`);
      });
      summary.failed += 1;
      summary.skipped += 1;
      continue;
    }

    let result: DispatchResult;
    try {
      result = await target.dispatch(cmd);
    } catch (err) {
      result = {
        kind: "retriable",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    await applyResult(db, cmd, result, opts);
    if (result.kind === "ack") summary.acked += 1;
    else if (result.kind === "retriable") summary.retried += 1;
    else summary.failed += 1;
  }

  return summary;
}

async function applyResult(
  db: PrismaClient,
  cmd: ClaimedCommand,
  result: DispatchResult,
  opts: Required<Omit<DispatchTickOptions, "registry">> & { registry: TargetRegistry },
): Promise<void> {
  if (result.kind === "ack") {
    await db.$transaction(async (tx) => markAcked(tx, cmd.id, result.result));
    return;
  }

  if (result.kind === "permanent") {
    await db.$transaction(async (tx) => markFailed(tx, cmd.id, result.error));
    return;
  }

  // retriable — check attempts ceiling, otherwise reschedule
  if (cmd.attempts >= opts.maxAttempts) {
    await db.$transaction(async (tx) =>
      markFailed(tx, cmd.id, `max attempts exceeded: ${result.error}`),
    );
    return;
  }

  const backoffMs = computeRetryBackoffMs(
    cmd.attempts,
    opts.baseBackoffMs,
    opts.capBackoffMs,
  );
  const next = new Date(Date.now() + backoffMs);
  await db.$transaction(async (tx) =>
    markRetriable(tx, cmd.id, next, result.error),
  );
}
