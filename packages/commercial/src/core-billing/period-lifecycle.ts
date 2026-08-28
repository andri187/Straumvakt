// The billing period's lifecycle — what has happened to a month, and what may
// happen next.
//
// ── WHY THIS EXISTS: PREFLIGHT DELTA 9.8 ────────────────────────────────
//
// `billing.billing_periods` was created by migration 0002 and has never had a
// writer. So nothing anywhere records that the activity aggregation ran for a
// period, and `ActivitySourcePort`'s adapter had to take `activityJobHasRun`
// as a **parameter from its caller** — with `false` as the only honest
// default, which means every period holds.
//
// A boolean a caller hands in is not a fact about the period; it is a fact
// about the caller's confidence. This module replaces it with a fact about the
// period: `activityJobHasRun` is now "the state is at or past
// activity_sealed", derived, and impossible to assert without a recorded
// transition that says who sealed it and when.
//
// ── THE STATE SET, AND WHY THESE ────────────────────────────────────────
//
// The requirement was to distinguish: not-yet-opened, open-and-accepting,
// activity-complete, priced, invoiced, closed. Six conditions. They are NOT
// six equally-shaped states, and treating them as such is the mistake worth
// avoiding:
//
//   not_opened      is the ABSENCE of a row, not a row saying "nothing yet".
//                   Writing a row to record that nothing has happened invents
//                   a fact and gives an operator something to reason about
//                   that does not exist. It is representable here so callers
//                   can name it, and it is never persisted.
//
//   open            accepting activity rows. The only state in which the
//                   activity aggregation may write.
//
//   activity_sealed the aggregation has RUN TO COMPLETION for this period and
//                   no further activity will be accepted. This is the state
//                   delta 9.8 needed and 0002's three-value enum could not
//                   express. It is deliberately distinct from "activity rows
//                   exist": rows existing proves something ran, not that it
//                   finished, and that difference is the whole of 9.8.
//
//   priced          the feeder produced a SETTLED statement. A period whose
//                   pricing HELD does not reach this state — it stays
//                   activity_sealed with its hold reasons recorded, so that
//                   "we tried and refused" is visible rather than looking like
//                   "we have not tried". Holding is the expected outcome today
//                   until the active-driver question is answered.
//
//   invoiced        a document number has been allocated and issued. The first
//                   irreversible step: a spent number cannot be reused,
//                   because Icelandic law requires an unbroken sequence.
//
//   closed          terminal, and immutable. FOCUS rule 4 — money is derived
//                   from the record and never rewritten.
//
// ── WHY NOT EXTEND THE POSTGRES ENUM ────────────────────────────────────
//
// `billing."PeriodState"` is `open | closing | closed`. Widening it means
// `ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction block and
// cannot be undone. The finer lifecycle instead lives in an append-only
// transition log (migration 0003, CREATE-only), and `coarseStateOf` below maps
// the fine state onto the existing three so the enum column stays meaningful
// to every reader that already understands it.
//
// The two cannot drift because the coarse value is COMPUTED from the fine one
// rather than stored independently — asserted by test over every fine state.
//
// ── REOPENING IS DELIBERATELY NOT IMPLEMENTED ───────────────────────────
//
// `billing_periods` carries `reopened_at`, `reopened_by_user_id` and
// `reopen_reason`, so the schema contemplates it. This module does not, and
// those columns stay null.
//
// Reopening is the one transition that can restate settled money, which FOCUS
// rule 4 forbids — and the legitimate need it would serve is already covered
// without touching a closed period: `StatementLineKind` carries `correction`,
// and a correction is an ADDITIVE next-period line, so the original figure
// stays exactly as invoiced. Implementing reopen would add the one door
// through which a closed month can change, to solve a problem that already
// has a door.

import { periodBounds, type BillingPeriodRef, type PeriodState } from "./period-close";

/** The fine-grained lifecycle. `not_opened` is never persisted — see header. */
export const PERIOD_LIFECYCLE_STATES = [
  "not_opened",
  "open",
  "activity_sealed",
  "priced",
  "invoiced",
  "closed",
] as const;
export type PeriodLifecycleState = (typeof PERIOD_LIFECYCLE_STATES)[number];

/** What happened. Every transition is caused by exactly one of these. */
export const PERIOD_EVENTS = [
  "open_period",
  "seal_activity",
  "record_pricing_settled",
  "issue_invoice",
  "close_period",
] as const;
export type PeriodEvent = (typeof PERIOD_EVENTS)[number];

/** Why a transition was refused. Every refusal is named; none is a bare false. */
export type PeriodTransitionRefusal =
  /** The event is not legal from the current state. */
  | "illegal_transition"
  /** Opening a month that has not finished. */
  | "period_not_yet_ended"
  /** The period is closed. Closed is terminal and immutable. */
  | "period_closed"
  /** An actor is required for this transition and none was supplied. */
  | "actor_required";

export type PeriodTransition =
  | { kind: "applied"; from: PeriodLifecycleState; to: PeriodLifecycleState }
  /** The event has already taken effect. Idempotent no-op, NOT an error. */
  | { kind: "noop"; state: PeriodLifecycleState; reason: "already_in_state" }
  | { kind: "refused"; state: PeriodLifecycleState; reason: PeriodTransitionRefusal };

/**
 * The legal moves.
 *
 * `activity_sealed -> closed` and `priced -> closed` both exist because a
 * period can legitimately end without an invoice: an org with nothing
 * billable, or a statement whose total is zero. Forcing it through `invoiced`
 * would consume a document number for a document nobody should receive, and a
 * spent number is a hole in a sequence that must not have one.
 */
const LEGAL: Readonly<
  Record<PeriodLifecycleState, Readonly<Partial<Record<PeriodEvent, PeriodLifecycleState>>>>
> = {
  not_opened: { open_period: "open" },
  open: { seal_activity: "activity_sealed" },
  activity_sealed: { record_pricing_settled: "priced", close_period: "closed" },
  priced: { issue_invoice: "invoiced", close_period: "closed" },
  invoiced: { close_period: "closed" },
  closed: {},
};

/** The state each event leaves behind, for the idempotent no-op check. */
const EVENT_TARGET: Readonly<Record<PeriodEvent, PeriodLifecycleState>> = {
  open_period: "open",
  seal_activity: "activity_sealed",
  record_pricing_settled: "priced",
  issue_invoice: "invoiced",
  close_period: "closed",
};

const ORDER: Readonly<Record<PeriodLifecycleState, number>> = {
  not_opened: 0,
  open: 1,
  activity_sealed: 2,
  priced: 3,
  invoiced: 4,
  closed: 5,
};

export interface TransitionInput {
  state: PeriodLifecycleState;
  event: PeriodEvent;
  period: BillingPeriodRef;
  /** Now. Drives the "the month must have ended" check on open_period. */
  asOf: Date;
  /** Who is doing this. Required for every transition a human or job causes. */
  actorUserId?: string | null;
}

/**
 * Apply an event to a state.
 *
 * Pure, total, and the only place a period's state may change shape. The
 * repository persists what this returns; it decides nothing.
 */
export function applyPeriodEvent(input: TransitionInput): PeriodTransition {
  const { state, event } = input;

  // Closed first, and separately from `illegal_transition`, because "you may
  // not do that from here" and "this month is finished" are different facts,
  // and an operator needs to be told which one they hit.
  if (state === "closed") {
    return event === "close_period"
      ? { kind: "noop", state, reason: "already_in_state" }
      : { kind: "refused", state, reason: "period_closed" };
  }

  // Idempotency: re-running a step that already took effect is a no-op that
  // returns the existing state. Not an error — a retried month-end job must be
  // safe, and an error here would hide the real ones.
  if (EVENT_TARGET[event] === state) {
    return { kind: "noop", state, reason: "already_in_state" };
  }

  const to = LEGAL[state][event];
  if (!to) return { kind: "refused", state, reason: "illegal_transition" };

  if (event === "open_period") {
    const { end } = periodBounds(input.period);
    if (input.asOf.getTime() < end.getTime()) {
      // Opening a month that is still running would let the activity job seal
      // a period that has not finished producing activity.
      return { kind: "refused", state, reason: "period_not_yet_ended" };
    }
  }

  // Every transition is a human or a job acting on the org's money, and the
  // audit row has nowhere to record an actor of `null`.
  if (!input.actorUserId?.trim()) {
    return { kind: "refused", state, reason: "actor_required" };
  }

  return { kind: "applied", from: state, to };
}

/**
 * Delta 9.8, answered.
 *
 * `activityJobHasRun` was a parameter callers passed to
 * `makeActivitySourcePort`. It is now this: a derived property of the period's
 * recorded state, which cannot be asserted without a transition that says who
 * sealed the activity and when.
 */
export function activityJobHasRun(state: PeriodLifecycleState): boolean {
  return ORDER[state] >= ORDER.activity_sealed;
}

/** May the activity aggregation write rows for this period? */
export function acceptsActivity(state: PeriodLifecycleState): boolean {
  return state === "open";
}

/** May the feeder price this period? */
export function acceptsPricing(state: PeriodLifecycleState): boolean {
  return state === "activity_sealed";
}

/** May a document number be allocated and issued for this period? */
export function acceptsIssue(state: PeriodLifecycleState): boolean {
  return state === "priced";
}

/** Terminal and immutable. */
export function isClosed(state: PeriodLifecycleState): boolean {
  return state === "closed";
}

/**
 * The fine state as the coarse Postgres enum sees it.
 *
 * Computed, never stored alongside — that is what stops the two from
 * disagreeing. `activity_sealed`, `priced` and `invoiced` are all "closing" to
 * the enum: the month has stopped accepting activity and is working toward
 * close.
 */
export function coarseStateOf(state: PeriodLifecycleState): PeriodState {
  switch (state) {
    case "not_opened":
    case "open":
      return "open";
    case "activity_sealed":
    case "priced":
    case "invoiced":
      return "closing";
    case "closed":
      return "closed";
  }
}
