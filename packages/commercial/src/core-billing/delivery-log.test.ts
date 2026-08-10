// Billing document delivery — the contract.

import { describe, expect, it } from "vitest";
import {
  classifyEmailResult,
  applyDeliveryAttempt,
  nextAttemptDelayMs,
  isDelivered,
  isTerminal,
  requiresOperatorAction,
  reportPeriodDelivery,
  canDeliverStatement,
  DELIVERY_TERMINAL_STATES,
  DEFAULT_MAX_DELIVERY_ATTEMPTS,
  type DeliveryState,
  type StatementDeliveryRow,
} from "./delivery-log";

describe("reading what email.ts actually returns", () => {
  it("treats an id-bearing success as an acknowledgement", () => {
    const o = classifyEmailResult({ ok: true, id: "re_abc123" });
    expect(o.kind).toBe("ack");
    expect(o).toMatchObject({ providerId: "re_abc123" });
  });

  it("refuses to call an id-less success delivered", () => {
    // Nothing to point at later when the customer says they never got it.
    expect(classifyEmailResult({ ok: true }).kind).toBe("permanent");
  });

  it("gives a missing binding its OWN kind, not success and not retriable", () => {
    // This is the fail-open hole: email.ts warns and returns ok:false when
    // RESEND_API_KEY is absent. For a statement that must never look like
    // either a delivery or an ordinary transient failure.
    const o = classifyEmailResult({ ok: false, reason: "binding_missing" });
    expect(o.kind).toBe("not_configured");
    expect(o.kind).not.toBe("ack");
    expect(o.kind).not.toBe("retriable");
  });

  it("retries a network throw (status 0)", () => {
    expect(classifyEmailResult({ ok: false, reason: "send_failed", status: 0 }).kind)
      .toBe("retriable");
  });

  it("retries when the provider gave no status at all", () => {
    expect(classifyEmailResult({ ok: false, reason: "send_failed" }).kind).toBe("retriable");
  });

  it("does not retry a 4xx — the message itself is the problem", () => {
    for (const status of [400, 403, 404, 422]) {
      expect(classifyEmailResult({ ok: false, reason: "send_failed", status }).kind)
        .toBe("permanent");
    }
  });

  it("DOES retry a 429, because backpressure is not rejection", () => {
    expect(classifyEmailResult({ ok: false, reason: "send_failed", status: 429 }).kind)
      .toBe("retriable");
  });

  it("retries a 5xx", () => {
    for (const status of [500, 502, 503]) {
      expect(classifyEmailResult({ ok: false, reason: "send_failed", status }).kind)
        .toBe("retriable");
    }
  });

  it("carries the provider error through for the operator to read", () => {
    const o = classifyEmailResult({
      ok: false, reason: "send_failed", status: 422, error: "invalid recipient",
    });
    expect(o).toMatchObject({ error: "invalid recipient", status: 422 });
  });
});

describe("backoff", () => {
  it("grows and then holds at the ceiling", () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(2)).toBe(300_000);
    expect(nextAttemptDelayMs(3)).toBe(1_500_000);
    expect(nextAttemptDelayMs(4)).toBe(7_200_000);
    expect(nextAttemptDelayMs(9)).toBe(7_200_000);
  });

  it("never returns a delay below the base", () => {
    for (let a = 1; a <= 8; a++) expect(nextAttemptDelayMs(a)).toBeGreaterThanOrEqual(60_000);
  });

  it("rejects a nonsense attempt number", () => {
    for (const a of [0, -1, 1.5, NaN]) {
      expect(() => nextAttemptDelayMs(a)).toThrow(/attempt_must_be_positive_integer/);
    }
  });
});

describe("what happens after an attempt", () => {
  const base = { state: "sending" as DeliveryState, attempts: 1 };

  it("an ack is terminal and needs nobody", () => {
    const d = applyDeliveryAttempt({
      ...base, outcome: { kind: "ack", providerId: "re_1" },
    });
    expect(d.nextState).toBe("sent");
    expect(d.retryInMs).toBeNull();
    expect(d.requiresOperatorAction).toBe(false);
  });

  it("a missing binding fails immediately and calls a human", () => {
    // It must NOT consume the retry budget: retrying a config error on a
    // timer turns a two-minute fix into an abandoned statement.
    const d = applyDeliveryAttempt({
      ...base, outcome: { kind: "not_configured", error: "RESEND_API_KEY missing" },
    });
    expect(d.nextState).toBe("failed");
    expect(d.retryInMs).toBeNull();
    expect(d.requiresOperatorAction).toBe(true);
    expect(d.reason).toContain("nothing was sent");
  });

  it("a permanent rejection stops on the first attempt", () => {
    const d = applyDeliveryAttempt({
      ...base, outcome: { kind: "permanent", error: "invalid recipient", status: 422 },
    });
    expect(d.nextState).toBe("failed");
    expect(d.requiresOperatorAction).toBe(true);
  });

  it("a retriable failure schedules the next attempt", () => {
    const d = applyDeliveryAttempt({
      ...base, outcome: { kind: "retriable", error: "boom", status: 503 },
    });
    expect(d.nextState).toBe("retrying");
    expect(d.retryInMs).toBe(60_000);
    expect(d.requiresOperatorAction).toBe(false);
    expect(d.reason).toContain(`of ${DEFAULT_MAX_DELIVERY_ATTEMPTS}`);
  });

  it("gives up at the attempt ceiling and calls a human", () => {
    const d = applyDeliveryAttempt({
      state: "retrying", attempts: DEFAULT_MAX_DELIVERY_ATTEMPTS,
      outcome: { kind: "retriable", error: "boom" },
    });
    expect(d.nextState).toBe("failed");
    expect(d.retryInMs).toBeNull();
    expect(d.requiresOperatorAction).toBe(true);
    expect(d.reason).toContain("gave up");
  });

  it("honours a caller-supplied ceiling", () => {
    const d = applyDeliveryAttempt({
      state: "retrying", attempts: 2, maxAttempts: 2,
      outcome: { kind: "retriable", error: "boom" },
    });
    expect(d.nextState).toBe("failed");
  });

  it("refuses to re-decide a terminal delivery", () => {
    for (const state of DELIVERY_TERMINAL_STATES) {
      expect(() =>
        applyDeliveryAttempt({ state, attempts: 1, outcome: { kind: "ack", providerId: "x" } }),
      ).toThrow(/delivery_already_terminal/);
    }
  });

  it("rejects an impossible attempt count", () => {
    for (const attempts of [0, -3, 2.5]) {
      expect(() =>
        applyDeliveryAttempt({ ...base, attempts, outcome: { kind: "ack", providerId: "x" } }),
      ).toThrow(/attempts_must_be_positive_integer/);
    }
  });

  it("an end-to-end retriable run reaches failed, never silently sent", () => {
    let state: DeliveryState = "sending";
    let attempts = 0;
    for (let i = 0; i < 20 && !isTerminal(state); i++) {
      attempts++;
      state = applyDeliveryAttempt({
        state, attempts, outcome: { kind: "retriable", error: "503" },
      }).nextState;
    }
    expect(state).toBe("failed");
    expect(attempts).toBe(DEFAULT_MAX_DELIVERY_ATTEMPTS);
    expect(isDelivered(state)).toBe(false);
  });
});

describe("only an acknowledgement counts as delivered", () => {
  it("is true for sent and false for everything else", () => {
    expect(isDelivered("sent")).toBe(true);
    for (const s of ["pending", "sending", "retrying", "failed", "abandoned"] as const) {
      expect(isDelivered(s)).toBe(false);
    }
  });

  it("abandoned is terminal but NOT delivered", () => {
    // A human giving up is a decision, not a delivery.
    expect(isTerminal("abandoned")).toBe(true);
    expect(isDelivered("abandoned")).toBe(false);
  });

  it("only failed calls an operator", () => {
    expect(requiresOperatorAction("failed")).toBe(true);
    for (const s of ["pending", "sending", "retrying", "sent", "abandoned"] as const) {
      expect(requiresOperatorAction(s)).toBe(false);
    }
  });
});

describe("period-level delivery reporting", () => {
  const rows: StatementDeliveryRow[] = [
    { statementId: "s1", recipient: "a@x.is", state: "sent" },
    { statementId: "s2", recipient: "b@x.is", state: "sent" },
    { statementId: "s3", recipient: "c@x.is", state: "failed" },
    { statementId: "s4", recipient: "d@x.is", state: "retrying" },
  ];

  it("names who did not get their statement, rather than returning a count", () => {
    const r = reportPeriodDelivery(rows);
    expect(r.total).toBe(4);
    expect(r.delivered).toBe(2);
    expect(r.outstanding.map((o) => o.recipient)).toEqual(["c@x.is", "d@x.is"]);
    expect(r.fullyDelivered).toBe(false);
  });

  it("separates 'still trying' from 'needs a human'", () => {
    expect(reportPeriodDelivery(rows).needingOperatorAction.map((o) => o.statementId))
      .toEqual(["s3"]);
  });

  it("is fully delivered only when every row acked", () => {
    expect(reportPeriodDelivery(rows.filter((r) => r.state === "sent")).fullyDelivered).toBe(true);
  });

  it("an empty period is vacuously fully delivered", () => {
    const r = reportPeriodDelivery([]);
    expect(r.fullyDelivered).toBe(true);
    expect(r.total).toBe(0);
  });

  it("does not count an abandoned statement as delivered", () => {
    const r = reportPeriodDelivery([
      { statementId: "s9", recipient: "e@x.is", state: "abandoned" },
    ]);
    expect(r.delivered).toBe(0);
    expect(r.fullyDelivered).toBe(false);
  });
});

describe("a statement is only sent from a closed period", () => {
  it("allows delivery once closed", () => {
    expect(canDeliverStatement("closed").allowed).toBe(true);
  });

  it("refuses while open, because the total can still move", () => {
    const r = canDeliverStatement("open");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("still change");
  });

  it("refuses mid-close", () => {
    expect(canDeliverStatement("closing").allowed).toBe(false);
  });
});
