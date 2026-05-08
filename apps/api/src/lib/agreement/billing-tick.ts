// Sprint 9 / ADR 0019 (2026-05-08) — automatic billing-line emission cron.
//
// Picks up finalized ChargeSession rows that have been enriched with a
// userId but don't yet have agreements.billing_lines, runs the resolver,
// inserts the result. Idempotent — resolveAndPersistForSession skips
// sessions that already have lines, so a double-tick is safe.
//
// Selection criteria (a session is eligible iff ALL of):
//   - status = 'completed'                  (finalized, not in-progress)
//   - userId IS NOT NULL                    (Zaptec enrichment ran)
//   - endedAt IS NOT NULL                   (defensive — should follow status)
//   - energyWh IS NOT NULL                  (defensive — needed for kWh basis)
//   - NOT EXISTS (agreementBillingLine WHERE session_id = sessions.id)
//   - endedAt > now() - 30 days             (recent window — older requires
//                                            manual backfill via the
//                                            POST /sessions/:id/resolve admin)
//
// Per-tick cap: BILLING_TICK_BATCH_SIZE (default 25). Bigger batches
// would risk spamming if a misconfigured agreement starts denying
// every session — the operator catches it within one batch.

import type { PrismaClient } from "../../generated/prisma/client";
import { resolveAndPersistForSession } from "./persist";

export type BillingTickResult = {
  scanned: number;
  emitted: number;
  alreadyExisted: number;
  denied: Record<string, number>;
  errors: Array<{ sessionId: string; message: string }>;
};

const DEFAULT_BATCH_SIZE = 25;
const RECENT_WINDOW_DAYS = 30;

export async function runAgreementsBillingTick(
  prisma: PrismaClient,
  opts: { batchSize?: number } = {}
): Promise<BillingTickResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoff = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.chargeSession.findMany({
    where: {
      status: "completed",
      userId: { not: null },
      endedAt: { gte: cutoff, not: null },
      energyWh: { not: null },
      agreementBillingLines: { none: {} },
    },
    select: { id: true },
    orderBy: { endedAt: "asc" }, // oldest-first so backlog drains predictably
    take: batchSize,
  });

  const result: BillingTickResult = {
    scanned: candidates.length,
    emitted: 0,
    alreadyExisted: 0,
    denied: {},
    errors: [],
  };

  for (const { id: sessionId } of candidates) {
    try {
      const r = await resolveAndPersistForSession(prisma, sessionId);
      if (!r.ok) {
        result.denied[r.reason] = (result.denied[r.reason] ?? 0) + 1;
        continue;
      }
      if (r.alreadyExisted) {
        result.alreadyExisted += 1;
        continue;
      }
      result.emitted += r.emitted;
    } catch (err) {
      result.errors.push({
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
