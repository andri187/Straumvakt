import { describe, expect, it } from "vitest";

import { isOverdue, isSettlementTerminal, reconcile } from "./reconciliation";
import type { PaymentEvent } from "./reconciliation";
import { SETTLEMENT_FIXTURES } from "./fixtures";

function ev(event: PaymentEvent["event"], amount = 0): PaymentEvent {
  return {
    orgId: "org-a",
    documentNumber: "SV-2026-000001",
    event,
    amount,
    at: "2026-08-10T00:00:00Z",
    railReference: null,
  };
}

describe("settlement fixtures", () => {
  it.each(SETTLEMENT_FIXTURES.map((f) => [f.name, f] as const))("%s", (_n, f) => {
    const view = reconcile(f.input);
    expect(view.state).toBe(f.expect.state);
    expect(view.outstanding).toBe(f.expect.outstanding);
    expect(isOverdue(view, f.input.dueDate, f.input.asOf)).toBe(f.expect.overdue);
  });
});

describe("settled requires exactness", () => {
  it("one króna short is not settled", () => {
    const v = reconcile({
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("payment_received", 247)],
    });
    expect(v.state).toBe("part_settled");
    expect(v.outstanding).toBe(1);
  });

  it("one króna over is not settled", () => {
    const v = reconcile({
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("payment_received", 249)],
    });
    expect(v.state).toBe("overpaid");
    expect(v.outstanding).toBe(-1);
  });

  it("a zero-total document is never settled by a zero payment", () => {
    const v = reconcile({ total: 0, dueDate: "2026-08-15", asOf: "2026-08-12", events: [] });
    expect(v.state).not.toBe("settled");
  });
});

describe("overdue is derived, never stored", () => {
  it("flips the moment the payment lands, with no sweep", () => {
    const unpaid = reconcile({
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("claim_created")],
    });
    expect(isOverdue(unpaid, "2026-08-15", "2026-08-20")).toBe(true);

    const paid = reconcile({
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("claim_created"), ev("payment_received", 248)],
    });
    expect(isOverdue(paid, "2026-08-15", "2026-08-20")).toBe(false);
  });

  it("a disputed claim is not overdue", () => {
    const v = reconcile({
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-09-30",
      events: [ev("claim_disputed")],
    });
    expect(isOverdue(v, "2026-08-15", "2026-09-30")).toBe(false);
  });

  it("a cancelled claim is not overdue", () => {
    const v = reconcile({
      total: 248,
      dueDate: "2026-08-15",
      asOf: "2026-09-30",
      events: [ev("claim_cancelled")],
    });
    expect(isOverdue(v, "2026-08-15", "2026-09-30")).toBe(false);
  });
});

describe("money folding is order-independent", () => {
  it("payments sum the same in any order", () => {
    const a = reconcile({
      total: 300,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("payment_received", 100), ev("payment_received", 50)],
    });
    const b = reconcile({
      total: 300,
      dueDate: "2026-08-15",
      asOf: "2026-08-12",
      events: [ev("payment_received", 50), ev("payment_received", 100)],
    });
    expect(a.paid).toBe(b.paid);
    expect(a.outstanding).toBe(b.outstanding);
  });

  it("a return subtracts whichever sign the rail supplied", () => {
    const neg = reconcile({
      total: 100,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("payment_received", 100), ev("payment_returned", -100)],
    });
    const pos = reconcile({
      total: 100,
      dueDate: "2026-08-15",
      asOf: "2026-08-20",
      events: [ev("payment_received", 100), ev("payment_returned", 100)],
    });
    expect(neg.paid).toBe(0);
    expect(pos.paid).toBe(0);
  });
});

describe("terminal states", () => {
  it("settled and cancelled are terminal; nothing else is", () => {
    expect(isSettlementTerminal("settled")).toBe(true);
    expect(isSettlementTerminal("cancelled")).toBe(true);
    expect(isSettlementTerminal("part_settled")).toBe(false);
    expect(isSettlementTerminal("overpaid")).toBe(false);
    expect(isSettlementTerminal("in_collection")).toBe(false);
  });
});
