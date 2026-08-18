import { describe, expect, it } from "vitest";

import {
  ALLOWED_TRANSITIONS,
  AUTOMATIC_TRANSITIONS,
  DEFAULT_RETRY_POLICY,
  DELIVERY_STATES,
  backoffSeconds,
  canTransition,
  canTransitionAutomatically,
  documentDeliveryState,
  isDelivered,
  isTerminal,
  mayAttemptAgain,
  requiresOperator,
} from "./delivery";
import type { DeliveryState } from "./delivery";
import { DELIVERY_FIXTURES } from "./fixtures";

describe("delivery fixtures", () => {
  it.each(DELIVERY_FIXTURES.map((f) => [f.name, f] as const))("%s", (_n, f) => {
    const rolled = documentDeliveryState(f.entries);
    expect(rolled).toBe(f.expect.documentState);
    expect(isDelivered(rolled)).toBe(f.expect.delivered);
    expect(requiresOperator(rolled)).toBe(f.expect.requiresOperator);
    if (f.entries.length > 0) {
      expect(mayAttemptAgain(f.entries[0])).toBe(f.expect.mayRetry);
    }
  });
});

describe("the delivered / unknown / failed distinction survives end to end", () => {
  it("only `delivered` is delivered", () => {
    for (const s of DELIVERY_STATES) {
      expect(isDelivered(s)).toBe(s === "delivered");
    }
  });

  it("unknown is neither delivered nor failed", () => {
    expect(isDelivered("unknown")).toBe(false);
    expect(isTerminal("unknown")).toBe(false);
    expect(requiresOperator("unknown")).toBe(true);
  });

  it("the three outcomes roll up distinctly at document level", () => {
    const base = {
      orgId: "o",
      documentNumber: "SV-2026-000001",
      channel: "email_pdf" as const,
      attempts: [],
      deliveredAt: null,
    };
    expect(documentDeliveryState([{ ...base, state: "delivered", deliveredAt: "x" }])).toBe(
      "delivered",
    );
    expect(documentDeliveryState([{ ...base, state: "unknown" }])).toBe("unknown");
    expect(documentDeliveryState([{ ...base, state: "failed_permanent" }])).toBe(
      "failed_permanent",
    );
  });

  it("an unknown channel poisons the roll-up rather than being ignored", () => {
    const base = {
      orgId: "o",
      documentNumber: "SV-2026-000001",
      attempts: [],
      deliveredAt: null,
    };
    const rolled = documentDeliveryState([
      { ...base, channel: "email_pdf", state: "failed_permanent" },
      { ...base, channel: "peppol", state: "unknown" },
    ]);
    expect(rolled).toBe("unknown");
    expect(isDelivered(rolled)).toBe(false);
  });

  it("no attempt at all is unknown, never delivered", () => {
    expect(documentDeliveryState([])).toBe("unknown");
    expect(isDelivered(documentDeliveryState([]))).toBe(false);
  });
});

describe("fail-closed: unknown never auto-retries into duplicate delivery", () => {
  it("has no automatic transitions out of unknown", () => {
    expect(AUTOMATIC_TRANSITIONS.unknown).toEqual([]);
  });

  it("cannot automatically go from unknown to attempting", () => {
    expect(canTransitionAutomatically("unknown", "attempting")).toBe(false);
  });

  it("cannot automatically go from unknown to delivered", () => {
    expect(canTransitionAutomatically("unknown", "delivered")).toBe(false);
  });

  it("mayAttemptAgain is false for unknown regardless of attempt count", () => {
    for (const n of [0, 1, 2, 4]) {
      expect(
        mayAttemptAgain({
          state: "unknown",
          attempts: Array.from({ length: n }, (_, i) => ({
            attempt: i + 1,
            state: "unknown" as DeliveryState,
            at: "2026-08-01T00:00:00Z",
          })),
        }),
      ).toBe(false);
    }
  });

  it("an operator CAN resolve unknown, in both directions", () => {
    expect(canTransition("unknown", "delivered")).toBe(true);
    expect(canTransition("unknown", "abandoned")).toBe(true);
    expect(canTransition("unknown", "attempting")).toBe(false);
  });

  it("every automatic transition is also an allowed transition", () => {
    for (const [from, tos] of Object.entries(AUTOMATIC_TRANSITIONS)) {
      for (const to of tos) {
        expect(canTransition(from as DeliveryState, to)).toBe(true);
      }
    }
  });
});

describe("terminal states", () => {
  it("have no outgoing transitions", () => {
    for (const s of DELIVERY_STATES) {
      if (isTerminal(s)) expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("are never retried", () => {
    for (const s of DELIVERY_STATES) {
      if (isTerminal(s)) expect(mayAttemptAgain({ state: s, attempts: [] })).toBe(false);
    }
  });
});

describe("retry policy", () => {
  it("backs off deterministically", () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(180);
    expect(backoffSeconds(3)).toBe(540);
    expect(backoffSeconds(4)).toBe(1620);
  });

  it("is capped", () => {
    expect(backoffSeconds(10)).toBe(DEFAULT_RETRY_POLICY.maxDelaySeconds);
  });

  it("stops at the attempt budget", () => {
    const attempts = Array.from({ length: DEFAULT_RETRY_POLICY.maxAttempts }, (_, i) => ({
      attempt: i + 1,
      state: "failed_retryable" as DeliveryState,
      at: "2026-08-01T00:00:00Z",
    }));
    expect(mayAttemptAgain({ state: "failed_retryable", attempts })).toBe(false);
    expect(mayAttemptAgain({ state: "failed_retryable", attempts: attempts.slice(0, 2) })).toBe(
      true,
    );
  });
});
