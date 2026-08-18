// Dunning and invoice lifecycle.
//
// ── THE NON-OBVIOUS REQUIREMENT: DO NOT DUN TWICE ───────────────────────
//
// The Icelandic bank claim rail duns on its own. Banks offer "sjálfvirkar
// ítrekanir" (automatic reminders) and automatic escalation of overdue claims
// into "framhaldsinnheimta" (secondary collection), and a creditor can
// configure how many days past due that happens. (Landsbankinn
// innheimtuþjónusta; see docs/notes/2026-08-18-collection-krofuhafi-decision.md
// §1.4.)
//
// So if collection goes over the bank rail with reminders enabled, Straumvakt
// MUST NOT also send reminders. Two schedules against one claim is a
// customer-visible defect, and the customer is the one who notices.
//
// That is why `DunningMode` exists. In `externally_managed` the state machine
// still TRACKS state — you still need to know a claim is overdue — but emits
// no events. Tracking and emitting are different jobs and only one of them
// belongs to whoever owns the rail.
//
// ── WHY DUNNING IS SEPARATE FROM DELIVERY ───────────────────────────────
//
// delivery.ts answers "did the document reach the counterparty". This file
// answers "have they paid". They fail independently: an undelivered invoice
// must never be dunned (you are chasing someone for a document they never
// received), and a delivered invoice can go unpaid for reasons delivery knows
// nothing about.

export const DUNNING_STATES = [
  /** Issued, delivered, not yet due. */
  "not_due",
  /** Past due date, no reminder sent yet. */
  "due",
  "reminder_1",
  "reminder_2",
  /** Last contact before escalation. */
  "final_notice",
  /** Handed to the rail's secondary collection. Straumvakt stops chasing. TERMINAL for dunning. */
  "in_collection",
  /** Paid in full. TERMINAL. */
  "settled",
  /** Counterparty disputes it. FREEZES the schedule. */
  "disputed",
  /** Given up on, deliberately. TERMINAL. */
  "written_off",
] as const;

export type DunningState = (typeof DUNNING_STATES)[number];

export const DUNNING_TERMINAL: readonly DunningState[] = [
  "settled",
  "in_collection",
  "written_off",
] as const;

export type DunningMode =
  /** Straumvakt sends the reminders. */
  | "straumvakt_managed"
  /** The bank rail sends them. Track state, emit nothing. */
  | "externally_managed";

export type DunningEvent =
  | "invoice.due"
  | "invoice.reminder_1.send"
  | "invoice.reminder_2.send"
  | "invoice.final_notice.send"
  | "invoice.escalated"
  | "invoice.settled"
  | "invoice.disputed"
  | "invoice.dispute_resolved"
  | "invoice.written_off";

export interface DunningTransition {
  from: DunningState;
  to: DunningState;
  /** What causes it. */
  trigger: string;
  /** Emitted when mode is `straumvakt_managed`. Null means "state change only". */
  event: DunningEvent | null;
  /** True when a human must initiate it. */
  operatorOnly: boolean;
}

/**
 * The transition table.
 *
 * Note what has no arrow out of it under automation: `disputed` freezes.
 * A dispute is resolved by a person, and continuing to dun someone who has
 * raised a dispute is how a billing disagreement becomes a relationship
 * problem.
 */
export const DUNNING_TRANSITIONS: readonly DunningTransition[] = [
  { from: "not_due", to: "due", trigger: "due date reached", event: "invoice.due", operatorOnly: false },
  { from: "not_due", to: "settled", trigger: "paid early, in full", event: "invoice.settled", operatorOnly: false },
  { from: "not_due", to: "disputed", trigger: "counterparty disputes", event: "invoice.disputed", operatorOnly: false },

  { from: "due", to: "reminder_1", trigger: "grace elapsed", event: "invoice.reminder_1.send", operatorOnly: false },
  { from: "due", to: "settled", trigger: "paid in full", event: "invoice.settled", operatorOnly: false },
  { from: "due", to: "disputed", trigger: "counterparty disputes", event: "invoice.disputed", operatorOnly: false },

  { from: "reminder_1", to: "reminder_2", trigger: "interval elapsed", event: "invoice.reminder_2.send", operatorOnly: false },
  { from: "reminder_1", to: "settled", trigger: "paid in full", event: "invoice.settled", operatorOnly: false },
  { from: "reminder_1", to: "disputed", trigger: "counterparty disputes", event: "invoice.disputed", operatorOnly: false },

  { from: "reminder_2", to: "final_notice", trigger: "interval elapsed", event: "invoice.final_notice.send", operatorOnly: false },
  { from: "reminder_2", to: "settled", trigger: "paid in full", event: "invoice.settled", operatorOnly: false },
  { from: "reminder_2", to: "disputed", trigger: "counterparty disputes", event: "invoice.disputed", operatorOnly: false },

  { from: "final_notice", to: "in_collection", trigger: "escalation threshold", event: "invoice.escalated", operatorOnly: false },
  { from: "final_notice", to: "settled", trigger: "paid in full", event: "invoice.settled", operatorOnly: false },
  { from: "final_notice", to: "disputed", trigger: "counterparty disputes", event: "invoice.disputed", operatorOnly: false },
  { from: "final_notice", to: "written_off", trigger: "operator writes off", event: "invoice.written_off", operatorOnly: true },

  // Dispute exits are operator-driven, both of them.
  { from: "disputed", to: "due", trigger: "dispute rejected", event: "invoice.dispute_resolved", operatorOnly: true },
  { from: "disputed", to: "settled", trigger: "dispute settled by payment", event: "invoice.settled", operatorOnly: false },
  { from: "disputed", to: "written_off", trigger: "dispute upheld", event: "invoice.written_off", operatorOnly: true },
] as const;

export interface DunningSchedule {
  /** Days after due date before reminder 1. */
  graceDays: number;
  /** Days between reminders. */
  intervalDays: number;
  /** Days after final notice before escalation. */
  escalateAfterDays: number;
}

export const DEFAULT_DUNNING_SCHEDULE: DunningSchedule = {
  graceDays: 7,
  intervalDays: 14,
  escalateAfterDays: 30,
};

export function isDunningTerminal(s: DunningState): boolean {
  return DUNNING_TERMINAL.includes(s);
}

export function allowedDunningTransitions(from: DunningState): readonly DunningTransition[] {
  return DUNNING_TRANSITIONS.filter((t) => t.from === from);
}

export function canDun(from: DunningState, to: DunningState): boolean {
  return DUNNING_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/**
 * The events a transition emits, given the mode.
 *
 * Under `externally_managed` this is always empty — including for reminders,
 * which is the entire point. State still advances; nothing is sent.
 */
export function eventsFor(
  transition: DunningTransition,
  mode: DunningMode,
): readonly DunningEvent[] {
  if (mode === "externally_managed") return [];
  return transition.event ? [transition.event] : [];
}

/**
 * Guard: an invoice that was never delivered must not be dunned.
 *
 * Takes the delivery roll-up rather than a boolean so the caller cannot pass
 * `state !== "failed"` and accidentally include `unknown`.
 */
export function mayDun(deliveryState: string): boolean {
  return deliveryState === "delivered";
}
