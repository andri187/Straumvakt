// The money wire contract, pinned.
//
// These tests exist because the defect they guard against was invisible: the
// number on the wire was always right, and only its NAME was wrong, so every
// test that asserted the number passed. The assertions below therefore always
// state both halves — the aurar that leave the API, and the krónur a driver
// must end up seeing — so that no future edit can satisfy one and break the
// other quietly.

import { describe, expect, it } from "vitest";
import { roundAurarToIsk } from "@straumvakt/commercial";
import { toWireAurar } from "./money-wire";

// (aurar stored, krónur displayed, what the case is for)
const CASES: Array<[bigint, bigint, string]> = [
  [0n, 0n, "a genuinely free session"],
  [1n, 0n, "one aur — rounds away, and must not become 1 kr"],
  [50n, 1n, "half a króna — half-up rounds to 1, not 0"],
  [99n, 1n, "just under a króna"],
  [100n, 1n, "exactly one króna: the value that makes the two units look alike"],
  [64988n, 650n, "the live defect's own figure — 649.88 kr, shown as 64,988 kr"],
  [45000n, 450n, "the 450 kr/connector cap boundary, exactly"],
  [45001n, 450n, "one aur above the cap boundary — still 450 kr"],
  [45050n, 451n, "half a króna above the cap — rounds up, so a cap test cannot pass by rounding"],
  [123456789n, 1234568n, "1,234,567.89 kr — large enough to exercise thousands separators"],
];

describe("toWireAurar", () => {
  it.each(CASES)("carries %s aurar unchanged (%s kr) — %s", (aurar, isk) => {
    const wire = toWireAurar(aurar);
    expect(wire).toBe(Number(aurar));
    expect(roundAurarToIsk(BigInt(wire!))).toBe(isk);
  });

  it("carries a negative adjustment, rounding away from zero", () => {
    // A credit note of −2.50 kr must round to −3 kr, not −2: a correction and
    // the line it corrects have to move by the same amount in opposite
    // directions, or the two disagree by 1 kr forever.
    expect(toWireAurar(-250n)).toBe(-250);
    expect(roundAurarToIsk(-250n)).toBe(-3n);
    expect(toWireAurar(-64988n)).toBe(-64988);
    expect(roundAurarToIsk(-64988n)).toBe(-650n);
  });

  it("maps absent to null, never to zero", () => {
    // A zero and an unknown look identical on an invoice. They must not look
    // identical on the wire.
    expect(toWireAurar(null)).toBeNull();
    expect(toWireAurar(undefined)).toBeNull();
    expect(toWireAurar(0n)).toBe(0);
  });

  it("accepts a plain number as well as a BigInt", () => {
    // Not every money column arrives as BigInt — the Drizzle ledger read and
    // the Prisma one disagree — so both must pass through the same door.
    expect(toWireAurar(64988)).toBe(64988);
    expect(toWireAurar(64988n)).toBe(64988);
  });

  it("refuses a non-integer amount rather than shipping a rounded one", () => {
    // A float in a money path means an aur was already lost upstream.
    expect(() => toWireAurar(649.88)).toThrow("money_wire_amount_not_a_safe_integer");
    expect(() => toWireAurar(0.5)).toThrow("money_wire_amount_not_a_safe_integer");
  });

  it("refuses an amount JSON cannot carry exactly", () => {
    // 2^53 aurar is ~90 trillion krónur — unreachable in business terms, and
    // exactly the shape of a corrupted BigInt. Silently truncating its low
    // digits would produce a plausible-looking wrong number.
    const beyondDouble = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() => toWireAurar(beyondDouble)).toThrow("money_wire_amount_not_a_safe_integer");
    expect(toWireAurar(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("agrees with the formula the Flutter client is required to use", () => {
    // The client's costLabel does `(c / 100).round()`. Dart's num.round()
    // rounds half AWAY FROM ZERO, which is what roundAurarToIsk does too — so
    // the two agree on negatives as well as positives. This test is the proof
    // of that claim, and it fails the day either side changes its rule.
    const dartRound = (aurar: number): number => {
      const q = aurar / 100;
      const r = q < 0 ? -Math.round(-q) : Math.round(q);
      // `+ 0` collapses IEEE-754 negative zero, which −1 aur produces here
      // (−Math.round(0.01) === −0). Dart's num.round() returns an int and
      // Dart ints have no negative zero, so the −0 is an artefact of modelling
      // Dart in JS, not a difference between the two rounding rules.
      return r + 0;
    };
    for (const [aurar, isk] of CASES) {
      expect(dartRound(toWireAurar(aurar)!)).toBe(Number(isk));
    }
    for (const aurar of [-250n, -64988n, -1n, -50n]) {
      expect(dartRound(toWireAurar(aurar)!)).toBe(Number(roundAurarToIsk(aurar)));
    }
  });
});
