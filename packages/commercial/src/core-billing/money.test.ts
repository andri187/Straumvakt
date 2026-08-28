// The money contract — the rules a statement is judged by.

import { describe, expect, it } from "vitest";
import {
  AURAR_PER_ISK,
  apportionAurar,
  formatAurar,
  formatIsk,
  iskToAurar,
  roundAurarToIsk,
  roundingDriftIsk,
  sumRoundedLinesIsk,
  vatOnAurar,
} from "./money";

describe("rounding aurar to a billed ISK line", () => {
  it("rounds half UP at the boundary", () => {
    expect(roundAurarToIsk(2150n)).toBe(22n);
    expect(roundAurarToIsk(2149n)).toBe(21n);
    expect(roundAurarToIsk(2250n)).toBe(23n);
  });

  it("rounds the canonical 30 kWh session", () => {
    // 30 kWh on Veitur AD1 (864) + N1 (883) ex-VAT, 24% VAT = 64988 aurar.
    expect(roundAurarToIsk(64_988n)).toBe(650n);
  });

  it("leaves an exact króna alone", () => {
    expect(roundAurarToIsk(0n)).toBe(0n);
    expect(roundAurarToIsk(100n)).toBe(1n);
    expect(roundAurarToIsk(45_000n)).toBe(450n);
  });

  it("rounds a CREDIT away from zero, symmetrically", () => {
    // A correction of -250 aurar must not become -2 kr while +250 becomes +3.
    expect(roundAurarToIsk(-250n)).toBe(-3n);
    expect(roundAurarToIsk(250n)).toBe(3n);
    expect(roundAurarToIsk(-2149n)).toBe(-21n);
  });

  it("refuses a non-BigInt, rather than coercing a float", () => {
    // @ts-expect-error deliberately wrong — the runtime guard is the subject
    expect(() => roundAurarToIsk(21.5)).toThrow(/must_be_bigint/);
    // @ts-expect-error deliberately wrong
    expect(() => roundAurarToIsk("2150")).toThrow(/must_be_bigint/);
  });

  it("round-trips whole krónur exactly", () => {
    for (const isk of [0n, 1n, 650n, -75n]) {
      expect(roundAurarToIsk(iskToAurar(isk))).toBe(isk);
    }
    expect(AURAR_PER_ISK).toBe(100n);
  });
});

describe("a statement total is the sum of ROUNDED lines", () => {
  it("sums rounded lines, not the rounded sum", () => {
    // 649.88 + 216.63 + 21.66 kr. Rounded lines: 650 + 217 + 22 = 889.
    // The forbidden alternative rounds 88817 aurar to 888. The 1 kr gap IS
    // the assertion.
    const lines = [64_988n, 21_663n, 2_166n];
    const correct = sumRoundedLinesIsk(lines.map(roundAurarToIsk));
    expect(correct).toBe(889n);
    expect(roundAurarToIsk(64_988n + 21_663n + 2_166n)).toBe(888n);
    expect(correct).not.toBe(888n);
  });

  it("reports the drift, so a fixture cannot pass by coincidence", () => {
    expect(roundingDriftIsk([64_988n, 21_663n, 2_166n])).toBe(1n);
    // A fixture where both methods agree proves nothing; drift 0 says so.
    expect(roundingDriftIsk([10_000n, 20_000n])).toBe(0n);
  });

  it("an empty statement totals zero", () => {
    expect(sumRoundedLinesIsk([])).toBe(0n);
  });

  it("refuses unrounded input at the type and runtime boundary", () => {
    // @ts-expect-error deliberately wrong
    expect(() => sumRoundedLinesIsk([650, 217])).toThrow(/must_be_bigint/);
  });

  it("handles credits inside a total", () => {
    expect(sumRoundedLinesIsk([650n, -75n, 22n])).toBe(597n);
  });
});

describe("VAT", () => {
  it("computes 24% half-up", () => {
    // 52410 ex-VAT * 0.24 = 12578.4 -> 12578
    expect(vatOnAurar(52_410n, 24)).toBe(12_578n);
  });

  it("rounds .5 up", () => {
    expect(vatOnAurar(1_000n, 24.05)).toBe(241n); // 240.5 -> 241
  });

  it("handles a zero base and a zero rate", () => {
    expect(vatOnAurar(0n, 24)).toBe(0n);
    expect(vatOnAurar(52_410n, 0)).toBe(0n);
  });

  it("keeps a credit negative", () => {
    expect(vatOnAurar(-52_410n, 24)).toBe(-12_578n);
  });

  it("rejects a nonsense rate", () => {
    expect(() => vatOnAurar(100n, -1)).toThrow(/non_negative/);
    expect(() => vatOnAurar(100n, NaN)).toThrow(/non_negative/);
  });
});

describe("apportioning without losing aurar", () => {
  it("splits exactly, with no lost or invented aurar", () => {
    const parts = apportionAurar(100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
  });

  it("gives leftovers to the largest remainders", () => {
    const parts = apportionAurar(10n, [7n, 2n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(10n);
    expect(parts).toEqual([7n, 2n, 1n]);
  });

  it("splits a real session between two bearers exactly", () => {
    const parts = apportionAurar(64_988n, [25_920n, 26_490n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(64_988n);
  });

  it("preserves the sum for a credit", () => {
    const parts = apportionAurar(-100n, [1n, 1n, 1n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(-100n);
  });

  it("rejects impossible weights", () => {
    expect(() => apportionAurar(100n, [0n, 0n])).toThrow(/must_not_all_be_zero/);
    expect(() => apportionAurar(100n, [-1n, 2n])).toThrow(/non_negative/);
    expect(apportionAurar(100n, [])).toEqual([]);
  });
});

describe("formatting says which unit it is", () => {
  it("renders aurar with two decimals, for display only", () => {
    expect(formatAurar(64_988n)).toBe("649.88 kr.");
    expect(formatAurar(5n)).toBe("0.05 kr.");
    expect(formatAurar(-250n)).toBe("-2.50 kr.");
  });

  it("renders a billed line as whole krónur", () => {
    expect(formatIsk(650n)).toBe("650 kr.");
    expect(formatIsk(-75n)).toBe("-75 kr.");
  });
});
