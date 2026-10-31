// Bounded, independent recovery of work that was committed but not finished.
//
// A stop that was committed but whose "cost it now" hint was lost, and a removal that is waiting on a stop that has since
// arrived, must not need a person to open a page. This pass finds both from DURABLE state and calls the SAME functions the
// fast paths use (`costPending`, `progressRemoval`). It adds no money logic, no state table, no queue and no timer.
//
// Bounds, all explicit and all reported:
//   - at most `costing` costing attempts in TOTAL: the sweep and any costing a lifecycle step triggers draw from one budget;
//   - at most `lifecycle` requests attempted, at most `stepsPerRequest` consecutive steps for one of them;
//   - a cooperative wall-time `budgetMs`, checked BETWEEN operations. It cannot cancel a database or RPC call that is
//     already running, and it does not abandon one: an attempt that started finishes, so `overran` can be true.
// Nothing here loops until empty. Backlog beyond the bounds waits for the next pass and is reported as `limitReached`.
//
// The report carries counts and timings only: no identifiers, payloads, SQL errors or amounts.

import { costPending, type CostingReport, type CostingStore } from "@/lib/costing/service";
import { progressRemoval, selectDueRemovals, type Deps, type LifecycleStore, type StopPort } from "@/lib/lifecycle/service";

export const RECOVERY_LIMITS = { costing: 20, lifecycle: 5, stepsPerRequest: 3, budgetMs: 20_000, scanLimit: 100 } as const;
export type RecoveryLimits = { -readonly [K in keyof typeof RECOVERY_LIMITS]: number };

export type RecoveryPorts = {
  costing: CostingStore;
  /** null = lifecycle recovery is not wired; reported as `supported: false`, never as an empty success. */
  lifecycle: LifecycleStore | null;
  /** null = no stop command path. Requests that need a stop are skipped, never counted as attempts and never marked failed. */
  stop: StopPort | null;
  now?: () => Date;
  /** Budget clock in ms. Injectable for tests. */
  nowMs?: () => number;
};

export type RecoveryReason = "not_enabled" | "database_not_configured" | "database_error";

export type RecoveryReport = {
  status: "ran" | "disabled" | "unavailable";
  reason: RecoveryReason | null;
  budgetMs: number;
  elapsedMs: number;
  /** The deadline stopped work before it was finished. */
  budgetExhausted: boolean;
  /** Elapsed time exceeded the budget (an operation that had already started ran past it). */
  overran: boolean;
  costing: {
    /** Attempts made (a claimed row, successful or not). */
    attempted: number;
    processed: number;
    costed: number;
    /** Processed rows that ended in a named unresolved state: held visibly, never priced as zero. */
    held: number;
    failed: number;
    /** Lifecycle-triggered costing skipped because the shared costing budget was spent. */
    deferredForBudget: number;
    /** More costing work may remain than this pass was allowed to do. */
    limitReached: boolean;
  };
  lifecycle: {
    supported: boolean;
    scanned: number;
    scanTruncated: boolean;
    due: number;
    attempted: number;
    steps: number;
    advanced: number;
    completed: number;
    attention: number;
    failed: number;
    stopUnavailableSkipped: number;
    deferredForBudget: number;
    limitReached: boolean;
    /** Stopped early after consecutive failures (treated as the database being unavailable). */
    aborted: boolean;
  };
};

export function emptyReport(budgetMs: number = RECOVERY_LIMITS.budgetMs): RecoveryReport {
  return {
    status: "ran", reason: null, budgetMs, elapsedMs: 0, budgetExhausted: false, overran: false,
    costing: { attempted: 0, processed: 0, costed: 0, held: 0, failed: 0, deferredForBudget: 0, limitReached: false },
    lifecycle: { supported: false, scanned: 0, scanTruncated: false, due: 0, attempted: 0, steps: 0, advanced: 0, completed: 0, attention: 0, failed: 0, stopUnavailableSkipped: 0, deferredForBudget: 0, limitReached: false, aborted: false },
  };
}

export const disabledReport = (): RecoveryReport => ({ ...emptyReport(), status: "disabled", reason: "not_enabled" });
export const unavailableReport = (reason: Exclude<RecoveryReason, "not_enabled">): RecoveryReport => ({ ...emptyReport(), status: "unavailable", reason });

function addCosting(into: RecoveryReport["costing"], c: CostingReport): void {
  into.attempted += c.processed + c.failed;
  into.processed += c.processed;
  into.costed += c.costed;
  into.held += Object.values(c.unresolved).reduce((a, b) => a + b, 0);
  into.failed += c.failed;
}

export async function runRecovery(ports: RecoveryPorts, overrides: Partial<RecoveryLimits> = {}): Promise<RecoveryReport> {
  const L: RecoveryLimits = { ...RECOVERY_LIMITS, ...overrides };
  const now = ports.now ?? (() => new Date());
  const clock = ports.nowMs ?? (() => Date.now());
  const started = clock();
  const expired = () => clock() - started >= L.budgetMs;
  const report = emptyReport(L.budgetMs);
  const finish = (): RecoveryReport => {
    report.elapsedMs = Math.max(0, clock() - started);
    report.overran = report.elapsedMs > L.budgetMs;
    return report;
  };
  const unavailable = (): RecoveryReport => { report.status = "unavailable"; report.reason = "database_error"; return finish(); };

  // 1. Independent costing sweep: rows the fast path missed. `needed` is durable state, so a lost hint costs nothing.
  try {
    const c = await costPending(ports.costing, { limit: L.costing, now, shouldStop: expired });
    addCosting(report.costing, c);
    if (c.limitReached) report.costing.limitReached = true;
    if (c.deadlineReached) report.budgetExhausted = true;
    if (c.unavailable) return unavailable(); // database down: stop now, no retry loop; everything stays `needed`
  } catch {
    return unavailable();
  }
  let costingLeft = Math.max(0, L.costing - report.costing.attempted);
  let costingUnavailable = false;

  // 2. Lifecycle: pending removals whose next step is now possible.
  if (!ports.lifecycle) return finish();
  if (expired()) { report.budgetExhausted = true; return finish(); }

  const deps: Deps = {
    store: ports.lifecycle,
    stop: ports.stop,
    // The SAME budget as the sweep: lifecycle steps cannot multiply the costing cap.
    costing: {
      async runFor(transactionId) {
        if (costingUnavailable) return; // progressRemoval can request costing for multiple sessions in one step
        if (costingLeft <= 0 || expired()) { report.costing.deferredForBudget++; if (costingLeft <= 0) report.costing.limitReached = true; return; }
        costingLeft--;
        const c = await costPending(ports.costing, { limit: 1, onlyId: transactionId, now, shouldStop: expired });
        addCosting(report.costing, c);
        if (c.deadlineReached) report.budgetExhausted = true;
        if (c.unavailable) costingUnavailable = true;
      },
    },
    authorise: () => false, // this pass can only PROGRESS an existing request; it can never request, cancel or return
    now,
  };

  let selection;
  try {
    selection = await selectDueRemovals(deps, { scanLimit: L.scanLimit, maxDue: L.lifecycle });
  } catch {
    return unavailable();
  }
  const lc = report.lifecycle;
  lc.supported = selection.supported;
  lc.scanned = selection.scanned;
  lc.scanTruncated = selection.scanTruncated;
  lc.due = selection.due.length;
  if (lc.due >= L.lifecycle && selection.scanTruncated) lc.limitReached = true;
  if (!selection.supported) return finish();

  let consecutiveFailures = 0;
  for (const due of selection.due) {
    if (lc.attempted >= L.lifecycle) { lc.limitReached = true; break; }
    if (expired()) { report.budgetExhausted = true; break; }
    // Without a stop path a planned stop would be recorded as an "unavailable" attempt and burn the request's attempts
    // without sending anything. Leave it untouched for a pass that has the path.
    if (due.needsStop && !ports.stop) { lc.stopUnavailableSkipped++; continue; }
    if (due.onlyCosting && costingLeft <= 0) { lc.deferredForBudget++; continue; }

    lc.attempted++;
    let version = due.version;
    let previous = due.state;
    let advancedHere = false;
    let final = due.state;
    for (let step = 0; step < L.stepsPerRequest; step++) {
      if (step > 0 && expired()) { report.budgetExhausted = true; break; }
      let result;
      try {
        result = await progressRemoval(deps, due.requestId);
        consecutiveFailures = 0;
      } catch {
        lc.failed++;
        if (costingUnavailable) return unavailable();
        consecutiveFailures++;
        break;
      }
      lc.steps++;
      if (costingUnavailable) return unavailable();
      if (!result.ok) break;
      final = result.value.state;
      if (result.value.version > version) { advancedHere = true; version = result.value.version; }
      // Take another step only when this one moved the request into a state whose next step needs no new evidence.
      // A stop just sent (stopping) or a request waiting for evidence (needs_attention) ends here; a no-op ends here.
      if (final === previous || (final !== "closing" && final !== "settling")) break;
      previous = final;
    }
    if (advancedHere) lc.advanced++;
    if (final === "completed") lc.completed++;
    if (final === "needs_attention") lc.attention++;
    if (consecutiveFailures >= 2) { lc.aborted = true; return unavailable(); }
  }
  return finish();
}
