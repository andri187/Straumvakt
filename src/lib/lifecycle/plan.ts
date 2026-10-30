// Pure transition planner. Given a request and the facts OBSERVED from durable
// evidence, it says what is due next and what state the request is in. It never
// performs an effect and never infers "stopped" from a command result.

import { MAX_STOP_ATTEMPTS, STOP_BACKOFF_MS, type LifecycleRequest, type LifecycleState, type SessionStep } from "./model";

export type ObservedSession = {
  transactionNo: number;
  transactionId: string;
  stoppedReceivedAt: Date | null;
  authorized: boolean;
  costingState: string;
  /** reconcile_flag === SUPERSEDED_FLAG and still no durable stop. */
  superseded?: boolean;
};

export type Observed = { sessions: ObservedSession[]; placementOpen: boolean };

export type Action =
  | { type: "request_stop"; transactionNo: number; transactionId: string }
  | { type: "close_placement" }
  | { type: "run_costing"; transactionId: string };

export type Plan = { state: LifecycleState; actions: Action[]; attention: string | null; sessions: SessionStep[] };

/** Settlement as a pure function of the costing consumer's durable state. */
export function settlementFor(authorized: boolean, costingState: string, supersededUnconfirmed = false): SessionStep["settlement"] {
  // No stop evidence exists, so there is nothing to price: hold it with the reason, never settle it and never call it zero.
  if (supersededUnconfirmed) return { state: "held", reason: "stop_unconfirmed_superseded" };
  if (!authorized || costingState === "excluded_unauthorized") return { state: "not_applicable", reason: "unauthorized_energy_is_evidence" };
  if (costingState === "costed") return { state: "settled", reason: null };
  if (costingState === "needed") return { state: "pending", reason: null };
  // A stopped, authorized session that was never queued for costing is a defect to show, not a wait to hide.
  if (costingState === "not_needed") return { state: "held", reason: "costing_not_queued" };
  return { state: "held", reason: costingState }; // blocked_energy | unresolved_access | unresolved_rates | unresolved_context
}

export function nextStopDue(step: SessionStep, now: Date): boolean {
  if (step.stop.attempts === 0 || !step.stop.lastAt) return true;
  const wait = STOP_BACKOFF_MS[Math.min(step.stop.attempts - 1, STOP_BACKOFF_MS.length - 1)]!;
  return now.getTime() - Date.parse(step.stop.lastAt) >= wait;
}

export function planNext(req: LifecycleRequest, seen: Observed, now: Date): Plan {
  if (req.state === "completed" || req.state === "cancelled") return { state: req.state, actions: [], attention: null, sessions: req.sessions };

  // Merge observation into the recorded steps. Sessions that appeared after the request began are
  // still covered: a start that slipped in before the block reached the engine must not be orphaned.
  const byNo = new Map(req.sessions.map((s) => [s.transactionNo, s]));
  const steps: SessionStep[] = seen.sessions.map((o) => {
    const prev = byNo.get(o.transactionNo);
    const base: SessionStep = prev ?? { transactionNo: o.transactionNo, transactionId: o.transactionId, stop: { attempts: 0, lastOutcome: null, lastAt: null, everAccepted: false }, stopConfirmedAt: null, settlement: { state: "pending", reason: null } };
    const unconfirmedSuperseded = !o.stoppedReceivedAt && o.superseded === true;
    return {
      ...base,
      stopConfirmedAt: o.stoppedReceivedAt ? (base.stopConfirmedAt ?? o.stoppedReceivedAt.toISOString()) : null,
      superseded: unconfirmedSuperseded,
      settlement: settlementFor(o.authorized, o.costingState, unconfirmedSuperseded),
    };
  });

  // Stop current sessions first; an older unconfirmed session remains a separate
  // blocker even if the charger may no longer accept commands for that ID.
  const open = steps.filter((s) => s.stopConfirmedAt === null && !s.superseded);
  const unconfirmed = steps.filter((s) => s.stopConfirmedAt === null && s.superseded);
  const actions: Action[] = [];
  let attention: string | null = null;

  if (open.length > 0) {
    for (const s of open) {
      if (s.stop.attempts >= MAX_STOP_ATTEMPTS && !s.stop.everAccepted) {
        attention = `Stop for transaction ${s.transactionNo} was not accepted after ${MAX_STOP_ATTEMPTS} attempts (last: ${s.stop.lastOutcome ?? "none"}). The session is NOT confirmed stopped.`;
      } else if (s.stop.attempts >= MAX_STOP_ATTEMPTS) {
        attention = `Stop for transaction ${s.transactionNo} was accepted but no StopTransaction arrived. The session is NOT confirmed stopped.`;
      } else if (nextStopDue(s, now)) actions.push({ type: "request_stop", transactionNo: s.transactionNo, transactionId: s.transactionId });
    }
    return { state: attention ? "needs_attention" : "stopping", actions: attention ? [] : actions, attention, sessions: steps };
  }

  if (unconfirmed.length > 0) return { state: "needs_attention", actions: [], attention: `Stop not confirmed for earlier transaction(s): ${unconfirmed.map((s) => s.transactionNo).join(", ")}. Removal and settlement remain pending.`, sessions: steps };

  if (seen.placementOpen) return { state: "closing", actions: [{ type: "close_placement" }], attention: null, sessions: steps };

  // Placement is closed. Settlement is tracked separately and visibly.
  const pending = steps.filter((s) => s.settlement.state === "pending");
  for (const s of pending) actions.push({ type: "run_costing", transactionId: s.transactionId });
  if (pending.length > 0) return { state: "settling", actions, attention: null, sessions: steps };
  return { state: "completed", actions: [], attention: null, sessions: steps };
}
