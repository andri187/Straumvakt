// Sprint 9 / ADR 0019 (2026-05-08) — automatic billing-line emission cron.
//
// Picks up finalized ChargeSession rows that have been enriched with a
// userId but don't yet have agreements.billing_lines, runs the resolver,
// inserts the result. Idempotent — resolveAndPersistForSession skips
// sessions that already have lines, so a double-tick is safe.
//
// ─── STATUS 2026-08-04: this tick is a silent no-op ────────────────────
//
// Measured on staging (br-tiny-river-abgpqq37): agreements.billing_lines
// has 0 rows after ~2 months of firing every minute, because the
// eligibility predicate below currently matches 0 sessions. The binding
// constraint is `userId != null` — there is 1 driver_group_membership in
// the system, so essentially no session is ever attributable to a driver.
// Nothing is broken; there is simply no input.
//
// Two consequences worth knowing before you touch this:
//
//   1. This is NOT the ADR 0025 cutover. That ADR specifies a
//      per-installation `useAgreementsResolver` flag at session-stop;
//      no such flag exists in code. What runs instead is BOTH resolvers
//      concurrently and ungated — legacy prices every session at stop
//      into reports.session_ledger, this cron writes agreements
//      billing lines afterwards. That is shadow mode WITHOUT the
//      comparison ADR 0025 §Step 2 made a hard go-gate.
//
//   2. Because it has never emitted a row, this path has never been
//      exercised against real data. Green logs mean "scanned 0", not
//      "works". Do not read its silence as validation.
//
// See docs/adr/0025-…md §Verification (2026-08-04).
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
