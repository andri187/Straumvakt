// Durable, idempotent, retryable costing consumer.
//
// One transaction row per database transaction:
//   claim (lock the row, skipping rows another consumer holds)
//   -> load facts -> decide (pure) -> write lines + mark outcome, all committed together.
// So the outcome is exactly one of: costed with lines, or an explicit unresolved
// state with a reason, or (on any failure) NOTHING changed and the row is still
// `needed`. A second or concurrent run finds the row no longer `needed`, or
// locked, and does nothing: lines can never be doubled.
//
// The physical transaction is already complete and committed before this runs;
// a costing failure, a missing rate or an outage cannot undo or hide it.
// A deterministic exception is counted per row and, after MAX_ATTEMPTS, parked
// as `unresolved_context` so one poison row can never starve the rest.
//
// No timer here. `costPending` is invoked explicitly (after a stop, best-effort,
// by a deliberate operator/service call, and by the bounded recovery pass in
// ocpp-engine/recovery.ts when that is enabled); its work per call is bounded.

import type { BillingLineDraft } from "@straumvakt/commercial/agreement/types";
import { decideCosting, type CostingOutcome, type CostingTxFacts, type PlacementFacts } from "./cost-session";
import { reviveSnapshot } from "./terms-snapshot";

export const MAX_COSTING_ATTEMPTS = 5;
export const DEFAULT_COSTING_BATCH = 20;

export interface CostingTxPort {
  /** Lock one `needed` row (FOR UPDATE SKIP LOCKED) and return it with its attempt count, or null. */
  claimOne(onlyId?: string): Promise<{ tx: CostingTxFacts; attempts: number } | null>;
  placement(placementId: string): Promise<PlacementFacts | null>;
  /** True if any billing line already exists for this session identity (defence in depth beside the state guard). */
  linesExist(sessionId: string): Promise<boolean>;
  writeLines(input: { sessionId: string; agreementId: string; workplaceOrgId: string | null; lines: BillingLineDraft[] }): Promise<void>;
  mark(id: string, state: CostingOutcome["state"], detail: Record<string, unknown>, at: Date): Promise<void>;
}

export interface CostingStore {
  run<T>(fn: (tx: CostingTxPort) => Promise<T>): Promise<T>;
  /** Separate transaction: record a failed attempt, parking the row once attempts are exhausted. */
  recordFailure(id: string, message: string, at: Date): Promise<void>;
}

/**
 * The three optional flags are present ONLY when true, so existing consumers and assertions see the same shape as before.
 *   limitReached     every allowed attempt was used and the last one still found work: more may remain.
 *   deadlineReached  `shouldStop` asked the run to stop before the limit (cooperative: an attempt already started finishes).
 *   unavailable      a claim or failure-recording operation failed; the run stops without starting another attempt.
 */
export type CostingReport = { processed: number; costed: number; unresolved: Record<string, number>; failed: number; limitReached?: true; deadlineReached?: true; unavailable?: true };

export async function costPending(store: CostingStore, opts: { limit?: number; now?: () => Date; onlyId?: string; shouldStop?: () => boolean } = {}): Promise<CostingReport> {
  const limit = opts.limit ?? DEFAULT_COSTING_BATCH;
  const now = opts.now ?? (() => new Date());
  const report: CostingReport = { processed: 0, costed: 0, unresolved: {}, failed: 0 };
  let ended = false; // true when the loop ended for a reason other than using every allowed attempt

  for (let i = 0; i < limit; i++) {
    // Cooperative deadline, checked only BETWEEN attempts: it never abandons a transaction that is already running.
    if (opts.shouldStop?.()) { report.deadlineReached = true; ended = true; break; }
    let claimedId: string | null = null;
    try {
      const done = await store.run(async (tx) => {
        const claim = await tx.claimOne(opts.onlyId);
        if (!claim) return null;
        claimedId = claim.tx.id;
        const t = claim.tx;
        const placement = await tx.placement(t.placementId);
        // Terms come ONLY from the immutable snapshot captured at start. A missing, unreadable or tampered snapshot is an
        // explicit unresolved state; the mutable term tables are never consulted as a fallback.
        const terms = t.authorized ? await reviveSnapshot(t.terms) : null;
        let outcome: CostingOutcome;
        if (terms && !terms.ok) outcome = { state: "unresolved_context", detail: { reason: terms.reason === "not_captured" ? "terms_not_captured" : `terms_snapshot_${terms.reason}` } };
        else if (terms && terms.status === "missing") outcome = { state: "unresolved_context", detail: { reason: "terms_not_captured", why: terms.reason, termsSha256: terms.sha256 } };
        else {
          outcome = decideCosting(t, placement, terms ? terms.facts : null);
          if (terms) outcome = { ...outcome, detail: { ...outcome.detail, termsSha256: terms.sha256, termsAt: terms.at.toISOString() } } as CostingOutcome;
        }
        if (outcome.state === "costed") {
          // The state guard already prevents a second run; this refuses to add lines if a foreign writer got there first.
          if (await tx.linesExist(t.id)) throw new Error("billing lines already exist for this session identity");
          await tx.writeLines({ sessionId: t.id, agreementId: outcome.agreementId, workplaceOrgId: outcome.workplaceOrgId, lines: outcome.lines });
        }
        await tx.mark(t.id, outcome.state, outcome.detail, now());
        return outcome.state;
      });
      if (done === null) { ended = true; break; } // nothing left to claim
      report.processed++;
      if (done === "costed") report.costed++;
      else report.unresolved[done] = (report.unresolved[done] ?? 0) + 1;
      if (opts.onlyId) { ended = true; break; }
    } catch (e) {
      report.failed++;
      if (claimedId) {
        try {
          await store.recordFailure(claimedId, e instanceof Error ? e.message : String(e), now());
        } catch {
          // Without a durable retry count, retrying the same row can consume the whole batch without parking it.
          report.unavailable = true;
          ended = true;
          break;
        }
      }
      else { report.unavailable = true; ended = true; break; } // could not even claim (database down): stop; everything stays `needed`
    }
  }
  if (!ended && limit > 0) report.limitReached = true;
  return report;
}
