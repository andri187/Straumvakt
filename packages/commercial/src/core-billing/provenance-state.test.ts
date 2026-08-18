// Ledger provenance state machine — the contract.
//
// The measured population on 2026-08-10 is the fixture set: 1,136 rows
// cdr/complete, 492 unlabelled, 9 ocpp/pending, 5 cdr/mismatch. The machine
// has to place all four correctly and make the fifth group impossible.

import { describe, expect, it } from "vitest";
import {
  applyProvenanceEvent,
  canTransition,
  isBillable,
  assertsCdrProvenance,
  requiresHuman,
  isAwaitingReconciliation,
  isAllowedInClosedPeriod,
  stateFromLegacyColumns,
  legacyColumnsFromState,
  PROVENANCE_STATES,
  type ProvenanceEvent,
  type ProvenanceState,
} from "./provenance-state";

const ALL_EVENTS: ProvenanceEvent[] = [
  "session_stopped_meter_resolved",
  "session_stopped_meter_unresolvable",
  "cdr_expected",
  "cdr_arrived_agrees",
  "cdr_arrived_disagrees",
  "cdr_window_expired",
  "correction_issued",
  "flagged_for_review",
  "review_cleared",
];

describe("the invariant the 5 mismatched rows exist to justify", () => {
  it("ONLY cdr_confirmed may assert CDR provenance", () => {
    const asserting = PROVENANCE_STATES.filter(assertsCdrProvenance);
    expect(asserting).toEqual(["cdr_confirmed"]);
  });

  it("cdr_mismatch is billable but must NOT claim CDR", () => {
    expect(isBillable("cdr_mismatch")).toBe(true);
    expect(assertsCdrProvenance("cdr_mismatch")).toBe(false);
  });

  it("a mismatched row's legacy label is no longer 'cdr'", () => {
    // This is the fix: a statement selecting verified_source='cdr' stops
    // picking these up.
    expect(legacyColumnsFromState("cdr_mismatch").verifiedSource).toBe("ocpp");
    expect(legacyColumnsFromState("cdr_mismatch").enrichmentStatus).toBe("mismatch");
  });

  it("no state both asserts CDR and carries a mismatch label", () => {
    for (const s of PROVENANCE_STATES) {
      const legacy = legacyColumnsFromState(s);
      if (legacy.verifiedSource === "cdr") {
        expect(assertsCdrProvenance(s)).toBe(true);
      }
    }
  });
});

describe("the four measured population groups map correctly", () => {
  it("1,136 rows cdr/complete => cdr_confirmed", () => {
    expect(stateFromLegacyColumns("cdr", "complete")).toBe("cdr_confirmed");
  });
  it("5 rows cdr/mismatch => cdr_mismatch", () => {
    expect(stateFromLegacyColumns("cdr", "mismatch")).toBe("cdr_mismatch");
  });
  it("9 rows ocpp/pending => cdr_pending", () => {
    expect(stateFromLegacyColumns("ocpp", "pending")).toBe("cdr_pending");
  });
  it("492 unlabelled rows => ocpp_derived, not held", () => {
    // They carry a settled OCPP figure. Holding 30% of the ledger for
    // manual review because a label is missing would be worse than the
    // problem.
    expect(stateFromLegacyColumns(null, null)).toBe("ocpp_derived");
    expect(isBillable("ocpp_derived")).toBe(true);
    expect(assertsCdrProvenance("ocpp_derived")).toBe(false);
  });

  it("an unrecognised combination is held, not guessed", () => {
    for (const [src, st] of [
      ["cdr", "pending"],
      ["amqp", "complete"],
      ["ocpp", "complete"],
      ["nonsense", "nonsense"],
      [null, "complete"],
    ] as const) {
      expect(stateFromLegacyColumns(src, st)).toBe("held_manual_review");
    }
  });

  it("round-trips every state through the legacy columns", () => {
    for (const s of PROVENANCE_STATES) {
      const legacy = legacyColumnsFromState(s);
      expect(legacy).toHaveProperty("verifiedSource");
      expect(legacy).toHaveProperty("enrichmentStatus");
    }
  });
});

describe("the happy path", () => {
  it("estimated -> ocpp_derived -> cdr_pending -> cdr_confirmed", () => {
    let s: ProvenanceState = "estimated";
    for (const e of ["session_stopped_meter_resolved", "cdr_expected", "cdr_arrived_agrees"] as const) {
      const r = applyProvenanceEvent(s, e);
      expect(r.ok).toBe(true);
      s = r.to;
    }
    expect(s).toBe("cdr_confirmed");
    expect(assertsCdrProvenance(s)).toBe(true);
    expect(isBillable(s)).toBe(true);
  });

  it("an unresolvable meter goes straight to manual review", () => {
    const r = applyProvenanceEvent("estimated", "session_stopped_meter_unresolvable");
    expect(r.to).toBe("held_manual_review");
    expect(isBillable(r.to)).toBe(false);
    expect(requiresHuman(r.to)).toBe(true);
  });

  it("a CDR that never arrives stops the row waiting", () => {
    // A row cannot sit pending forever — a statement generator would have
    // to guess about it.
    const r = applyProvenanceEvent("cdr_pending", "cdr_window_expired");
    expect(r.to).toBe("ocpp_derived");
    expect(isAwaitingReconciliation(r.to)).toBe(false);
    expect(isBillable(r.to)).toBe(true);
  });

  it("a disagreeing CDR lands in cdr_mismatch, not cdr_confirmed", () => {
    expect(applyProvenanceEvent("cdr_pending", "cdr_arrived_disagrees").to).toBe("cdr_mismatch");
    expect(applyProvenanceEvent("ocpp_derived", "cdr_arrived_disagrees").to).toBe("cdr_mismatch");
  });
});

describe("illegal transitions are refused, not thrown", () => {
  it("returns ok:false and leaves the state unchanged", () => {
    const r = applyProvenanceEvent("cdr_confirmed", "cdr_expected");
    expect(r.ok).toBe(false);
    expect(r.to).toBe("cdr_confirmed");
    expect(r.reason).toContain("not legal");
  });

  it("never throws for any state/event pair", () => {
    for (const s of PROVENANCE_STATES) {
      for (const e of ALL_EVENTS) {
        expect(() => applyProvenanceEvent(s, e)).not.toThrow();
      }
    }
  });

  it("canTransition agrees with applyProvenanceEvent everywhere", () => {
    for (const s of PROVENANCE_STATES) {
      for (const e of ALL_EVENTS) {
        expect(canTransition(s, e)).toBe(applyProvenanceEvent(s, e).ok);
      }
    }
  });

  it("a confirmed row cannot go back to pending", () => {
    expect(canTransition("cdr_confirmed", "cdr_expected")).toBe(false);
    expect(canTransition("cdr_confirmed", "cdr_window_expired")).toBe(false);
  });

  it("a mismatched row is NOT silently re-confirmed by a later poll", () => {
    // Once the feeds have disagreed, agreement is re-established by an
    // explicit correction, not by a quiet overwrite.
    expect(canTransition("cdr_mismatch", "cdr_arrived_agrees")).toBe(false);
    expect(canTransition("cdr_mismatch", "correction_issued")).toBe(true);
  });

  it("a session cannot be reconciled before it has stopped", () => {
    expect(canTransition("estimated", "cdr_arrived_agrees")).toBe(false);
    expect(canTransition("estimated", "cdr_expected")).toBe(false);
  });

  it("review_cleared only applies to a held row", () => {
    for (const s of PROVENANCE_STATES) {
      expect(canTransition(s, "review_cleared")).toBe(s === "held_manual_review");
    }
  });
});

describe("reachability and shape", () => {
  it("every state is reachable from estimated", () => {
    const seen = new Set<ProvenanceState>(["estimated"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of [...seen]) {
        for (const e of ALL_EVENTS) {
          const r = applyProvenanceEvent(s, e);
          if (r.ok && !seen.has(r.to)) {
            seen.add(r.to);
            changed = true;
          }
        }
      }
    }
    for (const s of PROVENANCE_STATES) expect(seen.has(s)).toBe(true);
  });

  it("every state can reach a billable state", () => {
    for (const start of PROVENANCE_STATES) {
      const seen = new Set<ProvenanceState>([start]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const s of [...seen]) {
          for (const e of ALL_EVENTS) {
            const r = applyProvenanceEvent(s, e);
            if (r.ok && !seen.has(r.to)) {
              seen.add(r.to);
              changed = true;
            }
          }
        }
      }
      expect([...seen].some(isBillable)).toBe(true);
    }
  });

  it("flagged_for_review is available from every non-held state", () => {
    for (const s of PROVENANCE_STATES) {
      if (s === "held_manual_review") continue;
      expect(canTransition(s, "flagged_for_review")).toBe(true);
    }
  });

  it("correction_issued is available from every settled state", () => {
    for (const s of PROVENANCE_STATES) {
      if (s === "estimated") continue;
      expect(canTransition(s, "correction_issued")).toBe(true);
    }
  });

  it("corrections compound rather than terminating", () => {
    expect(applyProvenanceEvent("corrected", "correction_issued").to).toBe("corrected");
  });
});

describe("billability", () => {
  it("excludes exactly estimated and held_manual_review", () => {
    const notBillable = PROVENANCE_STATES.filter((s) => !isBillable(s));
    expect(new Set(notBillable)).toEqual(new Set(["estimated", "held_manual_review"]));
  });

  it("requiresHuman is true for exactly one state", () => {
    expect(PROVENANCE_STATES.filter(requiresHuman)).toEqual(["held_manual_review"]);
  });

  it("isAwaitingReconciliation is true for exactly one state", () => {
    expect(PROVENANCE_STATES.filter(isAwaitingReconciliation)).toEqual(["cdr_pending"]);
  });

  it("a billable state is never simultaneously awaiting a human", () => {
    for (const s of PROVENANCE_STATES) {
      expect(isBillable(s) && requiresHuman(s)).toBe(false);
    }
  });
});

describe("closed periods accept corrections and nothing else", () => {
  it("only correction_issued is allowed", () => {
    const allowed = ALL_EVENTS.filter(isAllowedInClosedPeriod);
    expect(allowed).toEqual(["correction_issued"]);
  });

  it("a late CDR cannot restate a closed period", () => {
    // The exact scenario: the CDR poll window reaches 30 days back, into a
    // month already closed and invoiced.
    expect(isAllowedInClosedPeriod("cdr_arrived_agrees")).toBe(false);
    expect(isAllowedInClosedPeriod("cdr_arrived_disagrees")).toBe(false);
  });
});
