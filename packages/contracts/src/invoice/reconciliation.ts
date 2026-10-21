// Reconciliation — what comes back from the collection rail, and what it means.
//
// ── WHY THIS IS BUILT BEFORE THE RAIL IS CHOSEN ─────────────────────────
//
// Every route in docs/notes/2026-08-18-collection-krofuhafi-decision.md §3
// returns the same event vocabulary — claim created, paid, part paid, overdue,
// disputed, cancelled, returned. Bank claim, service bureau and plain bank
// transfer differ in how RELIABLY they report those, not in which ones exist.
// So the state machine is route-independent and there is no reason to wait.
//
// ── THE THREE INVARIANTS ────────────────────────────────────────────────
//
// 1. `settled` requires payments to equal the total EXACTLY. Under- and
//    over-payment are distinct states, not rounding. An overpayment filed as
//    "settled" is money owed back to a customer that nobody knows about.
//
// 2. A payment can arrive against a cancelled claim. The rail is asynchronous;
//    a cancellation and a payment can cross in flight. The machine accepts the
//    fact and routes it, rather than rejecting reality for being untidy.
//
// 3. NOTHING HERE WRITES TO THE INVOICE DOCUMENT. FOCUS.md rule 4 — money is
//    derived from the record, never destructively. Payment state lives beside
//    the document, and `overdue` is DERIVED from the due date and the payments
//    rather than stored, because a stored overdue flag is stale the moment a
//    payment lands.

export const SETTLEMENT_STATES = [
  /** Document exists, not yet handed to the rail. */
  "issued",
  /** The rail accepted the claim. NOT payment. */
  "presented",
  /** The rail rejected it at creation. Correctable and re-presentable. */
  "presentation_failed",
  /** Some money received, not all. */
  "part_settled",
  /** Paid exactly. TERMINAL, good. */
  "settled",
  /** More money received than owed. Someone is owed a refund. */
  "overpaid",
  /** Counterparty disputes. Freezes dunning. */
  "disputed",
  /** Withdrawn by the originator. TERMINAL. The number stays spent. */
  "cancelled",
  /** A payment was reversed. Re-opens the balance. */
  "returned",
  /** Handed to secondary collection. */
  "in_collection",
] as const;

export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export const SETTLEMENT_TERMINAL: readonly SettlementState[] = ["settled", "cancelled"] as const;

/** What a rail can tell us. Names are rail-neutral on purpose. */
export const RAIL_EVENTS = [
  "claim_created",
  "claim_rejected",
  "payment_received",
  "payment_returned",
  "claim_cancelled",
  "claim_disputed",
  "dispute_resolved",
  "claim_escalated",
] as const;
export type RailEvent = (typeof RAIL_EVENTS)[number];

export interface PaymentEvent {
  /** Tenant scope. */
  orgId: string;
  documentNumber: string;
  event: RailEvent;
  /**
   * Integer minor units. Positive for a receipt, negative for a return.
   * Zero for non-monetary events.
   */
  amount: number;
  /** ISO 8601. */
  at: string;
  /**
   * The rail's own reference, when it returns one.
   *
   * Whether Straumvakt's reference survives the round trip is blocking
   * question Q7 in the collection packet. Until it is answered, matching may
   * have to fall back to (kennitala, amount, date), which is heuristic — so
   * this field is nullable rather than optimistically required.
   */
  railReference: string | null;
}

export interface SettlementView {
  state: SettlementState;
  /** Integer minor units still owed. Negative means overpaid. */
  outstanding: number;
  /** Sum of receipts less returns. */
  paid: number;
}

export interface ReconcileInput {
  /** Document gross, integer minor units. */
  total: number;
  /** ISO 8601 date. */
  dueDate: string;
  /** ISO 8601 date, "today" for the derivation. Passed in — never read from a clock here. */
  asOf: string;
  events: readonly PaymentEvent[];
}

/**
 * Fold the rail events into a settlement view.
 *
 * Pure and order-independent for money (sums), order-dependent for status
 * (later events win). Both are deliberate: a payment file replayed twice must
 * not double-count, which is the caller's job via event ids, but a re-sent
 * "cancelled" after a "created" must win, which is this function's job.
 */
export function reconcile(input: ReconcileInput): SettlementView {
  let paid = 0;
  let presented = false;
  let rejected = false;
  let cancelled = false;
  let disputed = false;
  let escalated = false;
  let returned = false;

  for (const e of input.events) {
    switch (e.event) {
      case "claim_created":
        presented = true;
        rejected = false;
        break;
      case "claim_rejected":
        rejected = true;
        presented = false;
        break;
      case "payment_received":
        paid += e.amount;
        break;
      case "payment_returned":
        // amount is negative by convention; guard against a caller that
        // supplies it positive, because getting this backwards silently turns
        // a reversal into a second payment.
        paid -= Math.abs(e.amount);
        returned = true;
        break;
      case "claim_cancelled":
        cancelled = true;
        break;
      case "claim_disputed":
        disputed = true;
        break;
      case "dispute_resolved":
        disputed = false;
        break;
      case "claim_escalated":
        escalated = true;
        break;
    }
  }

  const outstanding = input.total - paid;

  // Order matters. Exact settlement beats every other consideration except a
  // dispute over an already-settled amount, which is a refund conversation and
  // not a settlement state.
  let state: SettlementState;
  if (paid > input.total) state = "overpaid";
  else if (paid === input.total && input.total !== 0) state = "settled";
  else if (disputed) state = "disputed";
  else if (cancelled) state = "cancelled";
  else if (escalated) state = "in_collection";
  else if (returned && paid < input.total) state = "returned";
  else if (paid > 0) state = "part_settled";
  else if (rejected) state = "presentation_failed";
  else if (presented) state = "presented";
  else state = "issued";

  return { state, outstanding, paid };
}

/**
 * Derived, never stored.
 *
 * Overdue is a function of the due date and what has been paid. Storing it
 * creates a value that is wrong between the payment landing and the next
 * sweep, and "wrong for a few hours" is how a paid customer gets a reminder.
 */
export function isOverdue(view: SettlementView, dueDate: string, asOf: string): boolean {
  if (view.state === "settled" || view.state === "cancelled") return false;
  if (view.state === "disputed") return false;
  return asOf > dueDate && view.outstanding > 0;
}

export function isSettlementTerminal(s: SettlementState): boolean {
  return SETTLEMENT_TERMINAL.includes(s);
}
