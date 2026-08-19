// Replaying the transition log.
//
// The log is the record and the state is derived from it — FOCUS rule 4's
// shape applied to the lifecycle. No row stores the fine state, so no row can
// disagree with the history.

import { describe, expect, it } from "vitest";
import { replayTransitions } from "./period-repository";

describe("replayTransitions", () => {
  it("an empty log is not_opened — the ABSENCE of rows, not a row saying so", () => {
    expect(replayTransitions([])).toBe("not_opened");
  });

  it("takes the last transition's target as the current state", () => {
    expect(
      replayTransitions([{ toState: "open" }, { toState: "activity_sealed" }, { toState: "priced" }]),
    ).toBe("priced");
  });

  it("a closed period stays closed however long the log is", () => {
    expect(
      replayTransitions([
        { toState: "open" },
        { toState: "activity_sealed" },
        { toState: "priced" },
        { toState: "invoiced" },
        { toState: "closed" },
      ]),
    ).toBe("closed");
  });

  it("a single open is open", () => {
    expect(replayTransitions([{ toState: "open" }])).toBe("open");
  });
});
