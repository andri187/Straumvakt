import { describe, expect, it } from "vitest";

import {
  DUNNING_STATES,
  DUNNING_TRANSITIONS,
  allowedDunningTransitions,
  canDun,
  eventsFor,
  isDunningTerminal,
  mayDun,
} from "./dunning";
import type { DunningState } from "./dunning";

describe("the transition table", () => {
  it("covers every state as a source or names it terminal", () => {
    for (const s of DUNNING_STATES) {
      const out = allowedDunningTransitions(s);
      if (isDunningTerminal(s)) expect(out).toEqual([]);
      else expect(out.length).toBeGreaterThan(0);
    }
  });

  it("only names known states", () => {
    for (const t of DUNNING_TRANSITIONS) {
      expect(DUNNING_STATES).toContain(t.from);
      expect(DUNNING_STATES).toContain(t.to);
    }
  });

  it("walks the normal escalation path", () => {
    const path: DunningState[] = [
      "not_due",
      "due",
      "reminder_1",
      "reminder_2",
      "final_notice",
      "in_collection",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canDun(path[i], path[i + 1])).toBe(true);
    }
  });

  it("allows settlement from every non-terminal state", () => {
    for (const s of DUNNING_STATES) {
      if (isDunningTerminal(s)) continue;
      expect(canDun(s, "settled")).toBe(true);
    }
  });

  it("cannot skip straight from due to collection", () => {
    expect(canDun("due", "in_collection")).toBe(false);
  });
});

describe("a dispute freezes the schedule", () => {
  it("has no automatic escalation out of disputed", () => {
    const out = allowedDunningTransitions("disputed");
    const automatic = out.filter((t) => !t.operatorOnly);
    // The only non-operator exit is the counterparty paying.
    expect(automatic.map((t) => t.to)).toEqual(["settled"]);
  });

  it("cannot advance from disputed to a reminder", () => {
    expect(canDun("disputed", "reminder_1")).toBe(false);
    expect(canDun("disputed", "final_notice")).toBe(false);
  });
});

describe("externally managed mode emits nothing", () => {
  it("emits no event for any transition", () => {
    for (const t of DUNNING_TRANSITIONS) {
      expect(eventsFor(t, "externally_managed")).toEqual([]);
    }
  });

  it("straumvakt-managed mode does emit", () => {
    const withEvent = DUNNING_TRANSITIONS.filter((t) => t.event !== null);
    expect(withEvent.length).toBeGreaterThan(0);
    for (const t of withEvent) {
      expect(eventsFor(t, "straumvakt_managed")).toEqual([t.event]);
    }
  });

  it("state still advances under external management — tracking is not emitting", () => {
    // The bank duns; Straumvakt must still know the claim is at final notice.
    expect(canDun("reminder_2", "final_notice")).toBe(true);
    const t = DUNNING_TRANSITIONS.find((x) => x.from === "reminder_2" && x.to === "final_notice")!;
    expect(eventsFor(t, "externally_managed")).toEqual([]);
    expect(t.event).toBe("invoice.final_notice.send");
  });
});

describe("an undelivered invoice is never dunned", () => {
  it("only a delivered document may be dunned", () => {
    expect(mayDun("delivered")).toBe(true);
  });

  it("unknown delivery does not permit dunning", () => {
    expect(mayDun("unknown")).toBe(false);
  });

  it("no other delivery state permits dunning", () => {
    for (const s of ["pending", "attempting", "failed_retryable", "failed_permanent", "abandoned"]) {
      expect(mayDun(s)).toBe(false);
    }
  });
});
