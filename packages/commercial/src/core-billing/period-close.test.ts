// Billing period close and correction lines — the contract.

import { describe, expect, it } from "vitest";
import {
  periodBounds,
  periodContains,
  checkPeriodClose,
  buildCorrectionLine,
  totalWithCorrections,
  statementAction,
  type PeriodCloseInput,
} from "./period-close";

const kr = (n: number) => BigInt(n) * 100n;
const PERIOD = { orgId: "org_alpha", year: 2026, month: 7 };

const clean: PeriodCloseInput = {
  period: PERIOD,
  state: "open",
  counts: { estimated: 0, awaitingReconciliation: 0, heldForReview: 0, billable: 120 },
  asOf: new Date("2026-08-01T00:00:00Z"),
};

describe("period bounds — Iceland is UTC+0, no DST", () => {
  it("is a half-open UTC month", () => {
    const { start, end } = periodBounds(PERIOD);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rolls the year at December", () => {
    expect(periodBounds({ orgId: "o", year: 2026, month: 12 }).end.toISOString())
      .toBe("2027-01-01T00:00:00.000Z");
  });

  it("handles February in a leap year", () => {
    const { start, end } = periodBounds({ orgId: "o", year: 2028, month: 2 });
    expect(end.getTime() - start.getTime()).toBe(29 * 86_400_000);
  });

  it("start is inclusive and end exclusive", () => {
    expect(periodContains(PERIOD, new Date("2026-07-01T00:00:00Z"))).toBe(true);
    expect(periodContains(PERIOD, new Date("2026-07-31T23:59:59.999Z"))).toBe(true);
    expect(periodContains(PERIOD, new Date("2026-08-01T00:00:00Z"))).toBe(false);
    expect(periodContains(PERIOD, new Date("2026-06-30T23:59:59.999Z"))).toBe(false);
  });

  it("has no DST discontinuity across the European switch", () => {
    const { start, end } = periodBounds({ orgId: "o", year: 2026, month: 3 });
    expect(end.getTime() - start.getTime()).toBe(31 * 86_400_000);
  });

  it("rejects an impossible month", () => {
    for (const m of [0, 13, 1.5, NaN]) {
      expect(() => periodBounds({ orgId: "o", year: 2026, month: m })).toThrow(/month_must_be/);
    }
  });
});

describe("close gating", () => {
  it("closes a clean, ended period", () => {
    const r = checkPeriodClose(clean);
    expect(r.canClose).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.billableRows).toBe(120);
  });

  it("refuses before the period has ended", () => {
    const r = checkPeriodClose({ ...clean, asOf: new Date("2026-07-20T00:00:00Z") });
    expect(r.canClose).toBe(false);
    expect(r.blockers).toContain("period_not_yet_ended");
  });

  it("refuses while a session is still estimated", () => {
    const r = checkPeriodClose({ ...clean, counts: { ...clean.counts, estimated: 1 } });
    expect(r.blockers).toContain("sessions_still_estimated");
  });

  it("refuses while a CDR is still expected", () => {
    // Closing here is how a late CDR ends up wanting to restate a closed
    // month — the poll window reaches 30 days back.
    const r = checkPeriodClose({ ...clean, counts: { ...clean.counts, awaitingReconciliation: 9 } });
    expect(r.blockers).toContain("sessions_awaiting_reconciliation");
  });

  it("refuses while a row is held for review", () => {
    const r = checkPeriodClose({ ...clean, counts: { ...clean.counts, heldForReview: 1 } });
    expect(r.blockers).toContain("sessions_held_for_review");
  });

  it("reports every blocker at once, not just the first", () => {
    const r = checkPeriodClose({
      ...clean,
      asOf: new Date("2026-07-10T00:00:00Z"),
      counts: { estimated: 2, awaitingReconciliation: 3, heldForReview: 4, billable: 5 },
    });
    expect(r.blockers).toHaveLength(4);
    expect(r.explanation).toContain("Blocked by");
  });

  it("refuses to close an already-closed period", () => {
    const r = checkPeriodClose({ ...clean, state: "closed" });
    expect(r.canClose).toBe(false);
    expect(r.explanation).toContain("already");
  });

  it("refuses while closing is in flight", () => {
    expect(checkPeriodClose({ ...clean, state: "closing" }).canClose).toBe(false);
  });

  it("allows a period with zero billable rows to close", () => {
    // An org with no charging in the month still closes; it just has an
    // empty statement.
    const r = checkPeriodClose({ ...clean, counts: { ...clean.counts, billable: 0 } });
    expect(r.canClose).toBe(true);
  });
});

describe("correction lines are additive, never mutations", () => {
  it("carries the difference, not the new total", () => {
    const c = buildCorrectionLine({
      originalAmountMinor: kr(1000),
      correctedAmountMinor: kr(850),
      reason: "cdr_mismatch_resolved",
    });
    expect(c.amountMinor).toBe(-kr(150));
    expect(c.originalAmountMinor).toBe(kr(1000));
    expect(c.correctedAmountMinor).toBe(kr(850));
  });

  it("keeps both figures so two statements can be compared", () => {
    const c = buildCorrectionLine({
      originalAmountMinor: kr(500),
      correctedAmountMinor: kr(600),
      reason: "tariff_misapplied",
    });
    expect(c.originalAmountMinor).toBe(kr(500));
    expect(c.correctedAmountMinor).toBe(kr(600));
    expect(c.amountMinor).toBe(kr(100));
  });

  it("labels a reduction as a credit and an increase as a charge", () => {
    const credit = buildCorrectionLine({
      originalAmountMinor: kr(100), correctedAmountMinor: kr(50), reason: "meter_fault",
    });
    const charge = buildCorrectionLine({
      originalAmountMinor: kr(50), correctedAmountMinor: kr(100), reason: "meter_fault",
    });
    expect(credit.displayName).toContain("Credit");
    expect(charge.displayName).toContain("Additional charge");
  });

  it("refuses a zero-value correction", () => {
    expect(() =>
      buildCorrectionLine({
        originalAmountMinor: kr(100), correctedAmountMinor: kr(100), reason: "meter_fault",
      }),
    ).toThrow(/correction_would_be_zero/);
  });

  it("requires a note for discretionary reasons", () => {
    for (const reason of ["operator_goodwill", "customer_dispute"] as const) {
      expect(() =>
        buildCorrectionLine({
          originalAmountMinor: kr(100), correctedAmountMinor: kr(0), reason,
        }),
      ).toThrow(/note_required/);
      expect(() =>
        buildCorrectionLine({
          originalAmountMinor: kr(100), correctedAmountMinor: kr(0), reason, note: "  ",
        }),
      ).toThrow(/note_required/);
    }
  });

  it("does not require a note for a mechanical reason", () => {
    expect(() =>
      buildCorrectionLine({
        originalAmountMinor: kr(100), correctedAmountMinor: kr(90), reason: "duplicate_session",
      }),
    ).not.toThrow();
  });

  it("corrections compound, and the original total never changes", () => {
    const original = kr(1000);
    const cs = [
      buildCorrectionLine({ originalAmountMinor: original, correctedAmountMinor: kr(900), reason: "meter_fault" }),
      buildCorrectionLine({ originalAmountMinor: kr(900), correctedAmountMinor: kr(950), reason: "tariff_misapplied" }),
    ];
    expect(totalWithCorrections(original, cs)).toBe(kr(950));
    expect(cs[0]!.originalAmountMinor).toBe(original);
  });

  it("an empty correction list leaves the total untouched", () => {
    expect(totalWithCorrections(kr(777), [])).toBe(kr(777));
  });

  it("trims a note and stores null when blank is allowed", () => {
    const c = buildCorrectionLine({
      originalAmountMinor: kr(100), correctedAmountMinor: kr(90),
      reason: "meter_fault", note: "  faulty CT clamp  ",
    });
    expect(c.note).toBe("faulty CT clamp");
  });
});

describe("regenerate vs resend", () => {
  it("regenerates freely while open", () => {
    expect(statementAction("open", "regenerate").action).toBe("regenerate");
  });

  it("has nothing to resend while open", () => {
    expect(statementAction("open", "resend").action).toBe("refuse");
  });

  it("resends the stored document when closed", () => {
    expect(statementAction("closed", "resend").action).toBe("resend");
  });

  it("REFUSES to regenerate a closed statement", () => {
    // Quietly regenerating would produce a document that differs from the
    // one the customer already holds.
    const r = statementAction("closed", "regenerate");
    expect(r.action).toBe("refuse");
    expect(r.reason).toContain("correction");
  });

  it("refuses everything mid-close", () => {
    expect(statementAction("closing", "regenerate").action).toBe("refuse");
    expect(statementAction("closing", "resend").action).toBe("refuse");
  });
});
