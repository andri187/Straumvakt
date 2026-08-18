// Billing period close and correction lines — pure functions, no I/O.
//
// ─── What exists today ─────────────────────────────────────────────
//
// Nothing. `reports.billing_period_summary` was DROPPED
// (`20260807120000_drop_never_used_tables`), `commercial.prisma` declares
// an orphan `InvoiceStatus` enum referenced by no model, and
// `AgreementBillingLine.billableEventType` reserves `'manual_adjustment'`
// in a comment with no writer. There is no invoice, statement, period,
// close, adjustment or delivery model in any schema.
//
// So this module is the calculation and rule core for something greenfield,
// not a wrapper over existing behaviour.
//
// ─── Why close matters more here than usual ────────────────────────
//
// The Zaptec CDR poll window defaults to **30 days back**
// (`zaptec-session-sync.ts:79`). Without a lock, a CDR arriving on the 5th
// of the month can silently restate a session in a month already invoiced.
// Close is what makes a statement mean something.
//
// ─── Corrections, not refunds, not mutations ───────────────────────
//
// Core issues correction lines. A correction is ADDITIVE: the original
// figure stays exactly as invoiced and a compensating line carries the
// difference, with a reason. That is what lets a closed period stay closed
// while still being correctable, and it is why `applyCorrection` returns a
// new line rather than a new total.
//
// Money conventions follow compute-session-cost.ts: BigInt minor units
// (1/100 króna), half-up rounding. Iceland is UTC+0 with no DST, so a
// billing month is an unambiguous half-open UTC interval.

export type PeriodState = "open" | "closing" | "closed";

export type CloseBlocker =
  | "sessions_awaiting_reconciliation"
  | "sessions_held_for_review"
  | "sessions_still_estimated"
  | "period_not_yet_ended";

export interface BillingPeriodRef {
  orgId: string;
  /** Calendar year, UTC. */
  year: number;
  /** 1-12, UTC. */
  month: number;
}

export interface PeriodCloseInput {
  period: BillingPeriodRef;
  state: PeriodState;
  /** Counts by provenance state across the period's ledger rows. */
  counts: {
    estimated: number;
    awaitingReconciliation: number;
    heldForReview: number;
    billable: number;
  };
  /** Now, for the "period must have ended" check. */
  asOf: Date;
}

export interface PeriodCloseCheck {
  canClose: boolean;
  blockers: CloseBlocker[];
  /** Rows that would appear on the statement if closed now. */
  billableRows: number;
  explanation: string;
}

/** Half-open UTC interval [start, end) for a billing month. */
export function periodBounds(period: BillingPeriodRef): { start: Date; end: Date } {
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new Error("month_must_be_1_to_12");
  }
  if (!Number.isInteger(period.year)) throw new Error("year_must_be_an_integer");
  const start = new Date(Date.UTC(period.year, period.month - 1, 1));
  const end = new Date(Date.UTC(period.year, period.month, 1));
  return { start, end };
}

/** Does an instant fall inside the period? Start inclusive, end exclusive. */
export function periodContains(period: BillingPeriodRef, at: Date): boolean {
  const { start, end } = periodBounds(period);
  const t = at.getTime();
  return t >= start.getTime() && t < end.getTime();
}

/**
 * May this period be closed?
 *
 * Deliberately strict about `estimated` and `held_manual_review`: closing a
 * period that still contains a live figure or an unreviewed hold produces a
 * statement someone will have to retract. `cdr_pending` also blocks —
 * closing while a CDR is still expected is how a late CDR ends up wanting
 * to restate a closed month.
 */
export function checkPeriodClose(input: PeriodCloseInput): PeriodCloseCheck {
  const blockers: CloseBlocker[] = [];
  const { end } = periodBounds(input.period);

  if (input.asOf.getTime() < end.getTime()) blockers.push("period_not_yet_ended");
  if (input.counts.estimated > 0) blockers.push("sessions_still_estimated");
  if (input.counts.awaitingReconciliation > 0) blockers.push("sessions_awaiting_reconciliation");
  if (input.counts.heldForReview > 0) blockers.push("sessions_held_for_review");

  const canClose = input.state === "open" && blockers.length === 0;
  return {
    canClose,
    blockers,
    billableRows: input.counts.billable,
    explanation: canClose
      ? `Period ${input.period.year}-${String(input.period.month).padStart(2, "0")} may be closed with ${input.counts.billable} billable rows.`
      : blockers.length > 0
        ? `Blocked by: ${blockers.join(", ")}.`
        : `Period is already '${input.state}'.`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Correction lines
// ─────────────────────────────────────────────────────────────────────

export type CorrectionReason =
  | "cdr_mismatch_resolved"
  | "meter_fault"
  | "tariff_misapplied"
  | "duplicate_session"
  | "customer_dispute"
  | "operator_goodwill";

export interface CorrectionInput {
  /** The line being corrected. Never modified. */
  originalAmountMinor: bigint;
  /** What the amount should have been. */
  correctedAmountMinor: bigint;
  reason: CorrectionReason;
  /** Free text for the statement. Required for goodwill and disputes. */
  note?: string;
}

export interface CorrectionLine {
  kind: "correction";
  reason: CorrectionReason;
  /** Signed: negative reduces the customer's bill. */
  amountMinor: bigint;
  originalAmountMinor: bigint;
  correctedAmountMinor: bigint;
  note: string | null;
  displayName: string;
}

/**
 * Build a correction line.
 *
 * Returns a line whose amount is the DIFFERENCE, so the original invoice
 * total plus every correction equals the corrected total. The original is
 * returned untouched in the line for audit — a customer comparing two
 * statements can see both numbers.
 *
 * Throws only when the correction would be a no-op, because emitting a
 * zero-value correction line puts a confusing entry on a statement and
 * implies something changed when nothing did.
 */
export function buildCorrectionLine(input: CorrectionInput): CorrectionLine {
  const delta = input.correctedAmountMinor - input.originalAmountMinor;
  if (delta === 0n) throw new Error("correction_would_be_zero");
  if (
    (input.reason === "operator_goodwill" || input.reason === "customer_dispute") &&
    !input.note?.trim()
  ) {
    // These two are discretionary. A discretionary adjustment with no
    // stated reason is indistinguishable from an error later.
    throw new Error("correction_note_required_for_discretionary_reason");
  }
  return {
    kind: "correction",
    reason: input.reason,
    amountMinor: delta,
    originalAmountMinor: input.originalAmountMinor,
    correctedAmountMinor: input.correctedAmountMinor,
    note: input.note?.trim() || null,
    displayName: correctionDisplayName(input.reason, delta),
  };
}

function correctionDisplayName(reason: CorrectionReason, delta: bigint): string {
  const direction = delta < 0n ? "Credit" : "Additional charge";
  switch (reason) {
    case "cdr_mismatch_resolved":
      return `${direction} — meter record reconciled`;
    case "meter_fault":
      return `${direction} — meter fault`;
    case "tariff_misapplied":
      return `${direction} — tariff correction`;
    case "duplicate_session":
      return `${direction} — duplicate session removed`;
    case "customer_dispute":
      return `${direction} — dispute resolved`;
    case "operator_goodwill":
      return `${direction} — goodwill adjustment`;
  }
}

/**
 * The invoiced total after applying corrections. The original is never
 * restated; this is a derived view.
 */
export function totalWithCorrections(
  originalTotalMinor: bigint,
  corrections: readonly CorrectionLine[],
): bigint {
  return corrections.reduce((sum, c) => sum + c.amountMinor, originalTotalMinor);
}

// ─────────────────────────────────────────────────────────────────────
// Regenerate vs resend
// ─────────────────────────────────────────────────────────────────────

export type StatementAction = "regenerate" | "resend" | "refuse";

/**
 * A closed statement is immutable. Asking to "regenerate" one is almost
 * always a request to re-deliver it, and quietly regenerating would produce
 * a document that differs from the one the customer already has.
 *
 * Open periods regenerate freely. Closed periods resend the stored
 * document, and only a correction changes what it says.
 */
export function statementAction(
  periodState: PeriodState,
  request: "regenerate" | "resend",
): { action: StatementAction; reason: string } {
  if (periodState === "closed") {
    return request === "resend"
      ? { action: "resend", reason: "Closed period — re-delivering the stored statement." }
      : {
          action: "refuse",
          reason:
            "Closed period — the statement is immutable. Issue a correction line, then resend.",
        };
  }
  if (periodState === "closing") {
    return { action: "refuse", reason: "Period is closing — wait for the close to settle." };
  }
  return request === "resend"
    ? { action: "refuse", reason: "Open period — nothing has been issued to resend." }
    : { action: "regenerate", reason: "Open period — statement regenerated from current data." };
}
