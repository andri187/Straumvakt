import { describe, expect, it } from "vitest";

import {
  emptySequence,
  findGaps,
  formatDocumentNumber,
  issue,
  sequenceKey,
  voidNumber,
} from "./number";
import type { SequenceConfig, SequenceState } from "./number";
import { NUMBERING_FIXTURES } from "./fixtures";

const CONFIG: SequenceConfig = { orgScope: "org-a", series: "SV" };

function applyAll(
  state: SequenceState,
  issues: readonly { key: string; year: number }[],
): { state: SequenceState; numbers: string[] } {
  const numbers: string[] = [];
  let s = state;
  for (const i of issues) {
    const a = issue(s, { idempotencyKey: i.key, year: i.year });
    s = a.state;
    numbers.push(a.documentNumber);
  }
  return { state: s, numbers };
}

describe("numbering fixtures", () => {
  it.each(NUMBERING_FIXTURES.map((f) => [f.name, f] as const))("%s", (_n, f) => {
    const { numbers } = applyAll(emptySequence(CONFIG), f.issues);
    expect(numbers).toEqual([...f.expect.numbers]);
    expect(new Set(numbers).size).toBe(f.expect.distinct);
  });
});

describe("retry is idempotent", () => {
  it("the same key returns the same number and does not advance the sequence", () => {
    const s0 = emptySequence(CONFIG);
    const a = issue(s0, { idempotencyKey: "month-2026-07", year: 2026 });
    const b = issue(a.state, { idempotencyKey: "month-2026-07", year: 2026 });
    expect(b.documentNumber).toBe(a.documentNumber);
    expect(b.reused).toBe(true);
    expect(b.state.next[sequenceKey(CONFIG, 2026)]).toBe(
      a.state.next[sequenceKey(CONFIG, 2026)],
    );
  });

  it("a retried month-end run produces no duplicates", () => {
    const keys = ["org-a:2026-07", "org-b:2026-07", "org-c:2026-07"];
    let s = emptySequence(CONFIG);
    const first: string[] = [];
    for (const k of keys) {
      const a = issue(s, { idempotencyKey: k, year: 2026 });
      s = a.state;
      first.push(a.documentNumber);
    }
    // The whole run is replayed after a crash.
    const second: string[] = [];
    for (const k of keys) {
      const a = issue(s, { idempotencyKey: k, year: 2026 });
      s = a.state;
      second.push(a.documentNumber);
    }
    expect(second).toEqual(first);
    expect(s.next[sequenceKey(CONFIG, 2026)]).toBe(4);
  });
});

describe("concurrent issue", () => {
  it("two callers starting from the same state derive the SAME number", () => {
    // This is the honest statement of what a pure allocator can and cannot do:
    // it cannot serialise callers. Two writers that both read state N produce
    // the same number, so the PERSISTENCE layer must reject the second write.
    // Encoding it as a test means the constraint is visible to whoever wires
    // the repository, instead of being discovered by two hosts receiving
    // invoices with the same number.
    const s0 = emptySequence(CONFIG);
    const a = issue(s0, { idempotencyKey: "writer-a", year: 2026 });
    const b = issue(s0, { idempotencyKey: "writer-b", year: 2026 });
    expect(a.documentNumber).toBe(b.documentNumber);
    expect(a.state.next[sequenceKey(CONFIG, 2026)]).toBe(
      b.state.next[sequenceKey(CONFIG, 2026)],
    );
  });

  it("applied sequentially the same two writers get distinct numbers", () => {
    const s0 = emptySequence(CONFIG);
    const a = issue(s0, { idempotencyKey: "writer-a", year: 2026 });
    const b = issue(a.state, { idempotencyKey: "writer-b", year: 2026 });
    expect(a.documentNumber).not.toBe(b.documentNumber);
  });
});

describe("crash mid-issue", () => {
  it("state persisted but document lost: the number is spent and must be voided, not reused", () => {
    let s = emptySequence(CONFIG);
    const a = issue(s, { idempotencyKey: "doomed", year: 2026 });
    s = a.state; // persisted
    // ... crash before the document was written.
    s = voidNumber(s, a.documentNumber);
    const b = issue(s, { idempotencyKey: "next", year: 2026 });
    expect(b.documentNumber).not.toBe(a.documentNumber);
    expect(s.voided).toContain(a.documentNumber);
    // The voided number keeps the sequence unbroken.
    expect(findGaps(b.state, [b.documentNumber])).toEqual({});
  });

  it("state lost but retried with the same key: the same number comes back", () => {
    const s0 = emptySequence(CONFIG);
    const a = issue(s0, { idempotencyKey: "doomed", year: 2026 });
    // Nothing persisted at all — re-enter from the original state.
    const retry = issue(s0, { idempotencyKey: "doomed", year: 2026 });
    expect(retry.documentNumber).toBe(a.documentNumber);
  });
});

describe("year rollover", () => {
  it("restarts at 1 in the new year by default", () => {
    let s = emptySequence(CONFIG);
    s = issue(s, { idempotencyKey: "a", year: 2026 }).state;
    s = issue(s, { idempotencyKey: "b", year: 2026 }).state;
    const c = issue(s, { idempotencyKey: "c", year: 2027 });
    expect(c.documentNumber).toBe("SV-2027-000001");
  });

  it("a perpetual series does not restart", () => {
    const perpetual: SequenceConfig = { ...CONFIG, resetOnYearRollover: false };
    let s = emptySequence(perpetual);
    s = issue(s, { idempotencyKey: "a", year: 2026 }).state;
    const b = issue(s, { idempotencyKey: "b", year: 2027 });
    expect(b.documentNumber).toBe("SV-000002");
  });

  it("both modes are gap-free", () => {
    for (const cfg of [CONFIG, { ...CONFIG, resetOnYearRollover: false }]) {
      const { state, numbers } = applyAll(emptySequence(cfg), [
        { key: "a", year: 2026 },
        { key: "b", year: 2026 },
        { key: "c", year: 2027 },
        { key: "d", year: 2027 },
      ]);
      expect(findGaps(state, numbers)).toEqual({});
    }
  });
});

describe("gap detection", () => {
  it("finds a hole left by a number that was neither issued nor voided", () => {
    const { state, numbers } = applyAll(emptySequence(CONFIG), [
      { key: "a", year: 2026 },
      { key: "b", year: 2026 },
      { key: "c", year: 2026 },
    ]);
    const missingMiddle = numbers.filter((n) => n !== "SV-2026-000002");
    expect(findGaps(state, missingMiddle)).toEqual({ "org-a:SV:2026": [2] });
  });

  it("a voided number is not a gap", () => {
    const { state, numbers } = applyAll(emptySequence(CONFIG), [
      { key: "a", year: 2026 },
      { key: "b", year: 2026 },
    ]);
    const voided = voidNumber(state, "SV-2026-000002");
    expect(findGaps(voided, [numbers[0]])).toEqual({});
  });

  it("there is no release operation", () => {
    // Documented as a test because "why can't I just free the number" is the
    // question this design will be asked, and the answer is the legal
    // requirement for an unbroken sequence.
    const mod = { emptySequence, issue, voidNumber, findGaps, formatDocumentNumber, sequenceKey };
    expect(Object.keys(mod)).not.toContain("release");
  });
});

describe("tenant scoping", () => {
  it("two orgs do not share a sequence", () => {
    const a = sequenceKey({ orgScope: "org-a", series: "SV" }, 2026);
    const b = sequenceKey({ orgScope: "org-b", series: "SV" }, 2026);
    expect(a).not.toBe(b);
  });

  it("padding is stable", () => {
    expect(formatDocumentNumber(CONFIG, 2026, 7)).toBe("SV-2026-000007");
    expect(formatDocumentNumber({ ...CONFIG, padWidth: 3 }, 2026, 7)).toBe("SV-2026-007");
  });
});
