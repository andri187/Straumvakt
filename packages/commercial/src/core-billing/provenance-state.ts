// Ledger provenance state machine — pure functions, no I/O.
//
// `cdr-provenance.ts` answers "may this row claim CDR provenance?" for one
// row at one instant. This module answers the larger question: what states
// can a ledger row be in, which transitions are legal, and which states may
// be billed.
//
// ─── Why a state machine and not a boolean ─────────────────────────
//
// The measured population has four shapes and none of them is a boolean:
//
//   cdr / complete   1,136 rows   CDR arrived and agrees
//   (null) / (null)    492 rows   priced, never reconciled, no label
//   ocpp / pending       9 rows   priced from OCPP, CDR still expected
//   cdr / mismatch       5 rows   CDR arrived and DISAGREES, label kept
//
// Two columns (`verified_source`, `enrichment_status`) encode this today,
// with no constraint linking them, which is how the 5 mismatched rows came
// to assert CDR provenance while carrying an OCPP figure.
//
// ─── The invariant that matters ────────────────────────────────────
//
// Only `cdr_confirmed` returns true from `assertsCdrProvenance`. That is
// the whole point: `cdr_mismatch` is a distinct state precisely so a
// statement generator cannot select it by asking for "cdr".
//
// ─── Corrections, not mutations ────────────────────────────────────
//
// Core issues correction lines, not refunds, and never restates a billed
// figure in place. `corrected` therefore does not replace the amount — it
// records that a compensating line exists. That is also what makes period
// close safe: a closed period accepts `correction_issued` and nothing else.

export type ProvenanceState =
  | "estimated"
  | "ocpp_derived"
  | "cdr_pending"
  | "cdr_confirmed"
  | "cdr_mismatch"
  | "corrected"
  | "held_manual_review";

export const PROVENANCE_STATES: readonly ProvenanceState[] = [
  "estimated",
  "ocpp_derived",
  "cdr_pending",
  "cdr_confirmed",
  "cdr_mismatch",
  "corrected",
  "held_manual_review",
] as const;

export type ProvenanceEvent =
  | "session_stopped_meter_resolved"
  | "session_stopped_meter_unresolvable"
  | "cdr_expected"
  | "cdr_arrived_agrees"
  | "cdr_arrived_disagrees"
  | "cdr_window_expired"
  | "correction_issued"
  | "flagged_for_review"
  | "review_cleared";

/** Legal transitions. Anything absent is illegal by construction. */
const TRANSITIONS: Record<
  ProvenanceState,
  Partial<Record<ProvenanceEvent, ProvenanceState>>
> = {
  estimated: {
    session_stopped_meter_resolved: "ocpp_derived",
    session_stopped_meter_unresolvable: "held_manual_review",
    flagged_for_review: "held_manual_review",
  },
  ocpp_derived: {
    cdr_expected: "cdr_pending",
    cdr_arrived_agrees: "cdr_confirmed",
    cdr_arrived_disagrees: "cdr_mismatch",
    correction_issued: "corrected",
    flagged_for_review: "held_manual_review",
  },
  cdr_pending: {
    cdr_arrived_agrees: "cdr_confirmed",
    cdr_arrived_disagrees: "cdr_mismatch",
    // The poll window closes without a CDR. The row keeps its OCPP figure
    // and stops waiting — a row cannot sit "pending" forever, because a
    // pending row is one a statement generator has to guess about.
    cdr_window_expired: "ocpp_derived",
    correction_issued: "corrected",
    flagged_for_review: "held_manual_review",
  },
  cdr_confirmed: {
    // A confirmed row can still be corrected later — a dispute, or a meter
    // fault found afterwards. It cannot go back to pending.
    correction_issued: "corrected",
    flagged_for_review: "held_manual_review",
  },
  cdr_mismatch: {
    correction_issued: "corrected",
    flagged_for_review: "held_manual_review",
    // Deliberately NOT reachable back to cdr_confirmed by a bare "agrees"
    // event: once the feeds have disagreed, agreement is re-established by
    // an explicit correction, not by a later poll quietly overwriting it.
  },
  corrected: {
    // Corrections compound. A second correction is a second line.
    correction_issued: "corrected",
    flagged_for_review: "held_manual_review",
  },
  held_manual_review: {
    review_cleared: "ocpp_derived",
    correction_issued: "corrected",
  },
};

export interface TransitionResult {
  ok: boolean;
  from: ProvenanceState;
  to: ProvenanceState;
  event: ProvenanceEvent;
  reason: string;
}

/** Is this transition legal? Pure lookup, no side effects. */
export function canTransition(
  from: ProvenanceState,
  event: ProvenanceEvent,
): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/**
 * Apply an event. Illegal transitions return `ok: false` and leave the
 * state unchanged rather than throwing — the caller is a queue consumer,
 * and an illegal transition is data to record, not a message to retry.
 */
export function applyProvenanceEvent(
  from: ProvenanceState,
  event: ProvenanceEvent,
): TransitionResult {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    return {
      ok: false,
      from,
      to: from,
      event,
      reason: `'${event}' is not legal from '${from}'.`,
    };
  }
  return { ok: true, from, to, event, reason: `'${from}' -> '${to}' on '${event}'.` };
}

/**
 * May a row in this state appear on a statement at all?
 *
 * `estimated` is excluded because it is a live figure, and
 * `held_manual_review` because a human has not cleared it. Everything else
 * carries a settled number — including `cdr_mismatch`, which bills the
 * OCPP figure honestly rather than not billing at all.
 */
export function isBillable(state: ProvenanceState): boolean {
  return state !== "estimated" && state !== "held_manual_review";
}

/**
 * May a row in this state tell a customer the figure was confirmed against
 * the operator's authoritative record?
 *
 * Exactly one state may. This is the function the 5 mismatched rows exist
 * to justify.
 */
export function assertsCdrProvenance(state: ProvenanceState): boolean {
  return state === "cdr_confirmed";
}

/** Does this state need a human before the row can be billed? */
export function requiresHuman(state: ProvenanceState): boolean {
  return state === "held_manual_review";
}

/** Is the row still waiting for an external feed? */
export function isAwaitingReconciliation(state: ProvenanceState): boolean {
  return state === "cdr_pending";
}

/**
 * Map the two legacy columns onto a state.
 *
 * The four combinations below are the ones actually present on 2026-08-10.
 * Anything else becomes `held_manual_review`: an unrecognised combination
 * is not something to guess about on a customer's statement.
 */
export function stateFromLegacyColumns(
  verifiedSource: string | null | undefined,
  enrichmentStatus: string | null | undefined,
): ProvenanceState {
  const src = verifiedSource ?? null;
  const st = enrichmentStatus ?? null;
  if (src === "cdr" && st === "complete") return "cdr_confirmed";
  if (src === "cdr" && st === "mismatch") return "cdr_mismatch";
  if (src === "ocpp" && st === "pending") return "cdr_pending";
  // 492 rows: priced by the webhook path, never reconciled, no label at all.
  if (src === null && st === null) return "ocpp_derived";
  return "held_manual_review";
}

/** The legacy columns a state should be written back as, during migration. */
export function legacyColumnsFromState(state: ProvenanceState): {
  verifiedSource: string | null;
  enrichmentStatus: string | null;
} {
  switch (state) {
    case "cdr_confirmed":
      return { verifiedSource: "cdr", enrichmentStatus: "complete" };
    case "cdr_mismatch":
      // The label IS the fix: no longer 'cdr'. A statement selecting
      // verified_source='cdr' stops picking these up.
      return { verifiedSource: "ocpp", enrichmentStatus: "mismatch" };
    case "cdr_pending":
      return { verifiedSource: "ocpp", enrichmentStatus: "pending" };
    case "ocpp_derived":
      return { verifiedSource: "ocpp", enrichmentStatus: "unreconciled" };
    case "corrected":
      return { verifiedSource: "ocpp", enrichmentStatus: "corrected" };
    case "held_manual_review":
      return { verifiedSource: null, enrichmentStatus: "held" };
    case "estimated":
      return { verifiedSource: null, enrichmentStatus: null };
  }
}

/**
 * Which events a CLOSED billing period still accepts.
 *
 * A closed period is closed. The only thing that may still happen to it is
 * a correction line, which is additive and leaves the original figure
 * intact — which is why Core issues corrections rather than refunds.
 */
export function isAllowedInClosedPeriod(event: ProvenanceEvent): boolean {
  return event === "correction_issued";
}
