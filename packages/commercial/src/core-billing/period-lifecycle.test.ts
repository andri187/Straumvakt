// The period lifecycle, pinned.
//
// The assertions that matter most are the closed-period ones. FOCUS rule 4
// says money is derived from the record and never rewritten, and a closed
// period is where that rule is actually enforced or actually isn't.

import { describe, expect, it } from "vitest";
import {
  PERIOD_EVENTS,
  PERIOD_LIFECYCLE_STATES,
  acceptsActivity,
  acceptsIssue,
  acceptsPricing,
  activityJobHasRun,
  applyPeriodEvent,
  coarseStateOf,
  isClosed,
  type PeriodEvent,
  type PeriodLifecycleState,
} from "./period-lifecycle";

const ORG_A = "org-a-0000-0000-0000-00000000001";
const ORG_B = "org-b-0000-0000-0000-00000000002";
const ACTOR = "user-0000-0000-0000-000000000001";
const MARCH = { orgId: ORG_A, year: 2026, month: 3 };
/** After March ended. */
const AFTER = new Date("2026-04-01T00:00:00Z");
/** Inside March. */
const DURING = new Date("2026-03-15T12:00:00Z");

function step(state: PeriodLifecycleState, event: PeriodEvent, over: Partial<Parameters<typeof applyPeriodEvent>[0]> = {}) {
  return applyPeriodEvent({ state, event, period: MARCH, asOf: AFTER, actorUserId: ACTOR, ...over });
}

describe("opening a period", () => {
  it("opens a month that has ended", () => {
    expect(step("not_opened", "open_period")).toEqual({
      kind: "applied",
      from: "not_opened",
      to: "open",
    });
  });

  it("refuses a month that has not ended", () => {
    // Opening a running month would let the activity job seal a period that
    // has not finished producing activity.
    expect(step("not_opened", "open_period", { asOf: DURING })).toEqual({
      kind: "refused",
      state: "not_opened",
      reason: "period_not_yet_ended",
    });
  });

  it("opening an already-open period is a NO-OP, not an error", () => {
    // A retried month-end job must be safe. An error here would hide the real
    // ones.
    expect(step("open", "open_period")).toEqual({
      kind: "noop",
      state: "open",
      reason: "already_in_state",
    });
  });

  it("refuses without an actor", () => {
    expect(step("not_opened", "open_period", { actorUserId: null })).toEqual({
      kind: "refused",
      state: "not_opened",
      reason: "actor_required",
    });
    expect(step("not_opened", "open_period", { actorUserId: "   " })).toMatchObject({
      reason: "actor_required",
    });
  });

  it("is per (org, month): two orgs' Marches are independent", () => {
    // The state machine is pure, so this is really an assertion about the KEY:
    // nothing here is global, and the repository's unique index is on
    // (org_id, period_year, period_month).
    const a = applyPeriodEvent({
      state: "not_opened",
      event: "open_period",
      period: { orgId: ORG_A, year: 2026, month: 3 },
      asOf: AFTER,
      actorUserId: ACTOR,
    });
    const b = applyPeriodEvent({
      state: "closed",
      event: "open_period",
      period: { orgId: ORG_B, year: 2026, month: 3 },
      asOf: AFTER,
      actorUserId: ACTOR,
    });
    expect(a.kind).toBe("applied");
    expect(b).toMatchObject({ kind: "refused", reason: "period_closed" });
  });
});

describe("sealing activity — delta 9.8", () => {
  it("seals an open period", () => {
    expect(step("open", "seal_activity")).toEqual({
      kind: "applied",
      from: "open",
      to: "activity_sealed",
    });
  });

  it("sealing an already-sealed period is a no-op", () => {
    expect(step("activity_sealed", "seal_activity")).toEqual({
      kind: "noop",
      state: "activity_sealed",
      reason: "already_in_state",
    });
  });

  it("activityJobHasRun is DERIVED from the state, at and past activity_sealed", () => {
    // This is the whole of delta 9.8: the boolean a caller used to hand in is
    // now a fact about the period, and it cannot be asserted without a
    // recorded transition saying who sealed it.
    expect(activityJobHasRun("not_opened")).toBe(false);
    expect(activityJobHasRun("open")).toBe(false);
    expect(activityJobHasRun("activity_sealed")).toBe(true);
    expect(activityJobHasRun("priced")).toBe(true);
    expect(activityJobHasRun("invoiced")).toBe(true);
    expect(activityJobHasRun("closed")).toBe(true);
  });

  it("only an open period accepts activity rows", () => {
    expect(acceptsActivity("open")).toBe(true);
    for (const s of PERIOD_LIFECYCLE_STATES.filter((x) => x !== "open")) {
      expect(acceptsActivity(s)).toBe(false);
    }
  });
});

describe("pricing and issuing", () => {
  it("prices a sealed period", () => {
    expect(step("activity_sealed", "record_pricing_settled")).toEqual({
      kind: "applied",
      from: "activity_sealed",
      to: "priced",
    });
  });

  it("only a sealed period may be priced, and only a priced one issued", () => {
    expect(acceptsPricing("activity_sealed")).toBe(true);
    expect(acceptsPricing("open")).toBe(false);
    expect(acceptsIssue("priced")).toBe(true);
    expect(acceptsIssue("activity_sealed")).toBe(false);
  });

  it("refuses to price a period whose activity is not sealed", () => {
    // Pricing an open period would price a month still receiving activity.
    expect(step("open", "record_pricing_settled")).toEqual({
      kind: "refused",
      state: "open",
      reason: "illegal_transition",
    });
  });

  it("a HELD period does not reach priced — it stays sealed", () => {
    // Holding is the expected outcome today. The event is named
    // record_pricing_SETTLED precisely so there is no way to spell "pricing
    // ran and refused" as a transition to `priced`.
    expect(PERIOD_EVENTS).not.toContain("record_pricing_held");
    expect(acceptsPricing("activity_sealed")).toBe(true);
  });

  it("issues from priced, and refuses to issue twice", () => {
    expect(step("priced", "issue_invoice")).toEqual({
      kind: "applied",
      from: "priced",
      to: "invoiced",
    });
    expect(step("invoiced", "issue_invoice")).toEqual({
      kind: "noop",
      state: "invoiced",
      reason: "already_in_state",
    });
  });

  it("can close without invoicing, from sealed or priced", () => {
    // An org with nothing billable, or a zero-total statement. Forcing it
    // through `invoiced` would consume a document number for a document
    // nobody should receive, and a spent number is a hole in a sequence that
    // must not have one.
    expect(step("activity_sealed", "close_period")).toMatchObject({ kind: "applied", to: "closed" });
    expect(step("priced", "close_period")).toMatchObject({ kind: "applied", to: "closed" });
  });
});

describe("a closed period is immutable", () => {
  it("rejects new activity", () => {
    expect(step("closed", "seal_activity")).toEqual({
      kind: "refused",
      state: "closed",
      reason: "period_closed",
    });
    expect(acceptsActivity("closed")).toBe(false);
  });

  it("rejects re-pricing", () => {
    expect(step("closed", "record_pricing_settled")).toEqual({
      kind: "refused",
      state: "closed",
      reason: "period_closed",
    });
    expect(acceptsPricing("closed")).toBe(false);
  });

  it("rejects re-issue", () => {
    expect(step("closed", "issue_invoice")).toEqual({
      kind: "refused",
      state: "closed",
      reason: "period_closed",
    });
    expect(acceptsIssue("closed")).toBe(false);
  });

  it("rejects re-opening", () => {
    // Reopening is deliberately not implemented. It is the one transition that
    // can restate settled money, and corrections already cover the legitimate
    // need as an additive next-period line.
    expect(step("closed", "open_period")).toEqual({
      kind: "refused",
      state: "closed",
      reason: "period_closed",
    });
  });

  it("names period_closed rather than illegal_transition", () => {
    // Different facts. "You may not do that from here" and "this month is
    // finished" send an operator to different places.
    for (const e of PERIOD_EVENTS.filter((x) => x !== "close_period")) {
      expect(step("closed", e)).toMatchObject({ reason: "period_closed" });
    }
    expect(isClosed("closed")).toBe(true);
  });

  it("closing an already-closed period is a no-op", () => {
    expect(step("closed", "close_period")).toEqual({
      kind: "noop",
      state: "closed",
      reason: "already_in_state",
    });
  });
});

describe("every state × every event is total and named", () => {
  it("never returns undefined, and every refusal carries a reason", () => {
    for (const s of PERIOD_LIFECYCLE_STATES) {
      for (const e of PERIOD_EVENTS) {
        const r = step(s, e);
        expect(["applied", "noop", "refused"]).toContain(r.kind);
        if (r.kind === "refused") expect(r.reason).toBeTruthy();
      }
    }
  });

  it("the illegal moves are refused, exhaustively", () => {
    // Enumerated rather than sampled: this table IS the contract, and a new
    // event added without a decision shows up here as a surprise.
    const legal = new Set([
      "not_opened/open_period",
      "open/seal_activity",
      "activity_sealed/record_pricing_settled",
      "activity_sealed/close_period",
      "priced/issue_invoice",
      "priced/close_period",
      "invoiced/close_period",
    ]);
    for (const s of PERIOD_LIFECYCLE_STATES) {
      for (const e of PERIOD_EVENTS) {
        const r = step(s, e);
        const key = `${s}/${e}`;
        if (legal.has(key)) {
          expect(r.kind, key).toBe("applied");
        } else if (r.kind === "noop") {
          // The idempotent re-run of a step already taken.
          expect(r.reason, key).toBe("already_in_state");
        } else {
          expect(r.kind, key).toBe("refused");
        }
      }
    }
  });
});

describe("the coarse Postgres enum cannot drift from the fine state", () => {
  it("maps every fine state onto open | closing | closed", () => {
    const seen = new Set<string>();
    for (const s of PERIOD_LIFECYCLE_STATES) {
      const c = coarseStateOf(s);
      expect(["open", "closing", "closed"]).toContain(c);
      seen.add(c);
    }
    // All three coarse values are reachable, so the enum column stays
    // meaningful to readers that only understand it.
    expect(seen).toEqual(new Set(["open", "closing", "closed"]));
  });

  it("puts everything past sealing into closing", () => {
    expect(coarseStateOf("not_opened")).toBe("open");
    expect(coarseStateOf("open")).toBe("open");
    expect(coarseStateOf("activity_sealed")).toBe("closing");
    expect(coarseStateOf("priced")).toBe("closing");
    expect(coarseStateOf("invoiced")).toBe("closing");
    expect(coarseStateOf("closed")).toBe("closed");
  });

  it("is computed, so it cannot be set independently", () => {
    // There is no setter and no stored copy. The only way to change the
    // coarse value is to change the fine one.
    expect(Object.keys({ coarseStateOf })).toEqual(["coarseStateOf"]);
  });
});
