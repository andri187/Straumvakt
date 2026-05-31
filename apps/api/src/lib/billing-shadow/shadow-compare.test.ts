// Sprint 9 — cutover step CO-3 — shadow comparator tests.
//
// Pure unit tests with a mock new-resolver. No Prisma, no DB. The whole
// point of the injection-based design in shadow-compare.ts is that
// these tests stay isolated.

import { describe, expect, it } from "vitest";
import {
  absBig,
  emptyHistogram,
  shadowCompare,
  tallyResult,
  type ShadowComparisonResult,
} from "./shadow-compare";

const SESSION_ID = "00000000-0000-0000-0000-0000000000aa";

const ok = (value: bigint) => () => Promise.resolve<bigint | null>(value);
const nullResolver = () => Promise.resolve<bigint | null>(null);
const throwResolver = (msg: string) => () =>
  Promise.reject(new Error(msg)) as Promise<bigint | null>;

describe("absBig", () => {
  it("returns positive for negative input", () => {
    expect(absBig(-7n)).toBe(7n);
  });
  it("returns zero for zero", () => {
    expect(absBig(0n)).toBe(0n);
  });
  it("returns positive for positive input", () => {
    expect(absBig(42n)).toBe(42n);
  });
  it("handles very large values without precision loss", () => {
    const big = 9_000_000_000_000_000_000n; // > Number.MAX_SAFE_INTEGER
    expect(absBig(-big)).toBe(big);
  });
});

describe("shadowCompare — match", () => {
  it("classifies exact equality as match", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 12_345n,
      getNewCost: ok(12_345n),
    });
    expect(result).toEqual<ShadowComparisonResult>({
      kind: "match",
      sessionId: SESSION_ID,
      cost: 12_345n,
    });
  });

  it("treats zero == zero as match (not failed)", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 0n,
      getNewCost: ok(0n),
    });
    expect(result.kind).toBe("match");
    if (result.kind === "match") expect(result.cost).toBe(0n);
  });

  it("handles very large equal values without precision loss", async () => {
    const huge = 9_999_999_999_999n;
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: huge,
      getNewCost: ok(huge),
    });
    expect(result.kind).toBe("match");
  });
});

describe("shadowCompare — match_within_1_aurar", () => {
  it("classifies +1 minor diff as within-1-aurar", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 1_000n,
      getNewCost: ok(1_001n),
    });
    expect(result).toEqual<ShadowComparisonResult>({
      kind: "match_within_1_aurar",
      sessionId: SESSION_ID,
      legacy: 1_000n,
      newCost: 1_001n,
      delta: 1n,
    });
  });

  it("classifies -1 minor diff as within-1-aurar with negative delta", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 1_000n,
      getNewCost: ok(999n),
    });
    expect(result).toEqual<ShadowComparisonResult>({
      kind: "match_within_1_aurar",
      sessionId: SESSION_ID,
      legacy: 1_000n,
      newCost: 999n,
      delta: -1n,
    });
  });
});

describe("shadowCompare — mismatch", () => {
  it("classifies a +100 minor diff (1 króna) as mismatch", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 50_000n,
      getNewCost: ok(50_100n),
    });
    expect(result).toEqual<ShadowComparisonResult>({
      kind: "mismatch",
      sessionId: SESSION_ID,
      legacy: 50_000n,
      newCost: 50_100n,
      delta: 100n,
    });
  });

  it("classifies a -100 minor diff (1 króna) as mismatch with negative delta", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 50_000n,
      getNewCost: ok(49_900n),
    });
    expect(result.kind).toBe("mismatch");
    if (result.kind === "mismatch") {
      expect(result.delta).toBe(-100n);
      expect(result.legacy).toBe(50_000n);
      expect(result.newCost).toBe(49_900n);
    }
  });

  it("classifies a 2-minor diff as mismatch (just above the 1-aurar band)", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 1_000n,
      getNewCost: ok(1_002n),
    });
    expect(result.kind).toBe("mismatch");
    if (result.kind === "mismatch") expect(result.delta).toBe(2n);
  });
});

describe("shadowCompare — new_resolver_failed", () => {
  it("catches a thrown Error and classifies as new_resolver_failed", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 7_777n,
      getNewCost: throwResolver("no_membership"),
    });
    expect(result).toEqual<ShadowComparisonResult>({
      kind: "new_resolver_failed",
      sessionId: SESSION_ID,
      legacy: 7_777n,
      error: "no_membership",
    });
  });

  it("catches a thrown non-Error value and stringifies it", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 100n,
      getNewCost: () => Promise.reject("string_error") as Promise<bigint | null>,
    });
    expect(result.kind).toBe("new_resolver_failed");
    if (result.kind === "new_resolver_failed") {
      expect(result.error).toBe("string_error");
    }
  });

  it("classifies a null return as new_resolver_failed (resolver couldn't price)", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 500n,
      getNewCost: nullResolver,
    });
    expect(result).toEqual<ShadowComparisonResult>({
      kind: "new_resolver_failed",
      sessionId: SESSION_ID,
      legacy: 500n,
      error: "new_resolver_returned_null",
    });
  });

  it("preserves legacy cost in the failure payload (so the script can still tally totals)", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 12_345_678n,
      getNewCost: throwResolver("boom"),
    });
    expect(result.kind).toBe("new_resolver_failed");
    if (result.kind === "new_resolver_failed") {
      expect(result.legacy).toBe(12_345_678n);
    }
  });
});

describe("shadowCompare — BigInt edge cases", () => {
  it("0n vs 0n is match, not failed", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 0n,
      getNewCost: ok(0n),
    });
    expect(result.kind).toBe("match");
  });

  it("0n vs 1n is within-1-aurar", async () => {
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: 0n,
      getNewCost: ok(1n),
    });
    expect(result.kind).toBe("match_within_1_aurar");
  });

  it("very large equal values keep their exact value in the result", async () => {
    const huge = 1_234_567_890_123_456_789n;
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: huge,
      getNewCost: ok(huge),
    });
    expect(result.kind).toBe("match");
    if (result.kind === "match") expect(result.cost).toBe(huge);
  });

  it("very large unequal values produce exact bigint delta", async () => {
    const legacy = 1_234_567_890_123_456_789n;
    const fresh = 1_234_567_890_123_456_999n;
    const result = await shadowCompare({
      sessionId: SESSION_ID,
      legacyCostMinor: legacy,
      getNewCost: ok(fresh),
    });
    expect(result.kind).toBe("mismatch");
    if (result.kind === "mismatch") {
      expect(result.delta).toBe(210n);
    }
  });
});

describe("tallyResult + histogram", () => {
  it("empty histogram starts at zero", () => {
    const h = emptyHistogram();
    expect(h).toEqual({
      match: 0,
      matchWithin1Aurar: 0,
      mismatch: 0,
      newResolverFailed: 0,
      total: 0,
    });
  });

  it("tallies one of each kind correctly", () => {
    let h = emptyHistogram();
    h = tallyResult(h, { kind: "match", sessionId: SESSION_ID, cost: 1n });
    h = tallyResult(h, {
      kind: "match_within_1_aurar",
      sessionId: SESSION_ID,
      legacy: 1n,
      newCost: 2n,
      delta: 1n,
    });
    h = tallyResult(h, {
      kind: "mismatch",
      sessionId: SESSION_ID,
      legacy: 100n,
      newCost: 200n,
      delta: 100n,
    });
    h = tallyResult(h, {
      kind: "new_resolver_failed",
      sessionId: SESSION_ID,
      legacy: 0n,
      error: "x",
    });
    expect(h).toEqual({
      match: 1,
      matchWithin1Aurar: 1,
      mismatch: 1,
      newResolverFailed: 1,
      total: 4,
    });
  });

  it("is pure — does not mutate the input histogram", () => {
    const h = emptyHistogram();
    tallyResult(h, { kind: "match", sessionId: SESSION_ID, cost: 1n });
    expect(h.total).toBe(0);
    expect(h.match).toBe(0);
  });
});
