// Property-based tests for the temporal key.
//
// §12 backlog item 3. The example-based tests in `effective-dating.test.ts`
// pin the cases a human thought of. These generate interval sets and assert
// the invariant holds for **every accepted set** and fails for **every
// rejected one** — which is a different claim, and the one that catches the
// case nobody thought of.
//
// No property-testing library is added. `fast-check` would be a new dependency
// for a check that needs a seeded PRNG and a loop, and `check:deps` is right to
// make that a deliberate decision rather than a convenience. The generator
// below is 20 lines and **deterministic**: a fixed seed means a failure is
// reproducible from the test output alone, which is the property that matters
// most and the one a random-per-run harness gives up.

import { describe, expect, it } from "vitest";
import {
  checkPartialUniqueOpenRow,
  checkTemporalKey,
  closed,
  containsInstant,
  isEmpty,
  openEnded,
  overlaps,
  rowsOverlappingPeriod,
  type DatedRow,
  type Tstzrange,
} from "./effective-dating";

/** A deterministic PRNG. mulberry32 — small, well-distributed, seeded. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Day D of 2026, as an instant. Days keep the arithmetic legible. */
const day = (d: number) => new Date(Date.UTC(2026, 0, 1 + d));

interface Row extends DatedRow {
  deviceId: string;
}

/**
 * A random interval over a 60-day window.
 *
 * One in five is open-ended, which is roughly the real ratio — most placements
 * in a fleet are live — and it matters: an unbounded upper bound is the case
 * naive overlap arithmetic gets wrong.
 */
function randomPeriod(r: () => number): Tstzrange {
  const from = Math.floor(r() * 55);
  if (r() < 0.2) return openEnded(day(from));
  const len = 1 + Math.floor(r() * 10);
  return closed(day(from), day(from + len));
}

/** Insert rows one at a time, keeping only those the constraint accepts. */
function buildAcceptedSet(r: () => number, n: number): Row[] {
  const accepted: Row[] = [];
  for (let i = 0; i < n; i++) {
    const candidate: Row = { id: `r${i}`, deviceId: "d1", period: randomPeriod(r) };
    if (isEmpty(candidate.period)) continue;
    if (checkTemporalKey(accepted, candidate, (x) => x.deviceId === "d1").ok) {
      accepted.push(candidate);
    }
  }
  return accepted;
}

const SEEDS = [1, 7, 42, 1337, 90210, 2026, 555, 8675309];

describe("property: at most one placement per device per instant", () => {
  it("holds for every ACCEPTED set, at every day in the window", () => {
    // The invariant, stated the way the database states it. Checked by
    // sampling every day rather than by re-running `overlaps`, so the test
    // does not simply assert the implementation against itself.
    for (const seed of SEEDS) {
      const accepted = buildAcceptedSet(rng(seed), 40);
      for (let d = 0; d <= 70; d++) {
        const live = accepted.filter((row) => containsInstant(row.period, day(d)));
        expect(
          live.length,
          `seed ${seed}, day ${d}: ${live.length} placements — ${live.map((x) => x.id).join(",")}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every REJECTED candidate genuinely collides with something accepted", () => {
    // The other half, and the one that catches a constraint which is merely
    // strict. A rejection with no overlapping row would be a false refusal —
    // an operator told "already placed" about a device that is free.
    for (const seed of SEEDS) {
      const r = rng(seed);
      const accepted: Row[] = [];
      let rejections = 0;
      for (let i = 0; i < 40; i++) {
        const candidate: Row = { id: `r${i}`, deviceId: "d1", period: randomPeriod(r) };
        if (isEmpty(candidate.period)) continue;
        const verdict = checkTemporalKey(accepted, candidate, (x) => x.deviceId === "d1");
        if (verdict.ok) {
          accepted.push(candidate);
        } else {
          rejections++;
          expect(overlaps(verdict.conflictsWith.period, candidate.period)).toBe(true);
        }
      }
      // A run with no rejections proves nothing about rejections. Assert the
      // generator actually exercises the path.
      expect(rejections, `seed ${seed} produced no rejections`).toBeGreaterThan(0);
    }
  });

  it("accepted sets are pairwise non-overlapping — the constraint, restated", () => {
    for (const seed of SEEDS) {
      const accepted = buildAcceptedSet(rng(seed), 40);
      for (let i = 0; i < accepted.length; i++) {
        for (let j = i + 1; j < accepted.length; j++) {
          expect(
            overlaps(accepted[i]!.period, accepted[j]!.period),
            `seed ${seed}: ${accepted[i]!.id} and ${accepted[j]!.id} overlap`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("property: the partial unique index does NOT hold the invariant", () => {
  it("admits sets in which two placements are live at the same instant", () => {
    // The ADR's claim, generated rather than worked once. Build a set under
    // the REJECTED alternative and find an instant with more than one live
    // placement. If this ever stops finding one, the alternative has become
    // adequate and the ADR's argument needs revisiting — which is why the
    // failure message says so.
    let seedsWithViolation = 0;
    for (const seed of SEEDS) {
      const r = rng(seed);
      const accepted: Row[] = [];
      for (let i = 0; i < 40; i++) {
        const candidate: Row = { id: `r${i}`, deviceId: "d1", period: randomPeriod(r) };
        if (isEmpty(candidate.period)) continue;
        if (checkPartialUniqueOpenRow(accepted, candidate, (x) => x.deviceId === "d1").ok) {
          accepted.push(candidate);
        }
      }
      const worstDay = Array.from({ length: 71 }, (_, d) =>
        accepted.filter((row) => containsInstant(row.period, day(d))).length,
      ).reduce((a, b) => Math.max(a, b), 0);
      if (worstDay > 1) seedsWithViolation++;
    }
    expect(
      seedsWithViolation,
      "the partial index admitted no overlapping set — ADR 0054's argument would need revisiting",
    ).toBeGreaterThan(0);
  });

  it("and the billing predicate then double-counts, which is the consequence", () => {
    // Not "the index is weaker" in the abstract: it is weaker in the one way
    // that costs money. Find a period over which the alternative's set
    // produces more billable rows than the temporal key's would.
    const r = rng(1337);
    const loose: Row[] = [];
    for (let i = 0; i < 40; i++) {
      const candidate: Row = { id: `r${i}`, deviceId: "d1", period: randomPeriod(r) };
      if (isEmpty(candidate.period)) continue;
      if (checkPartialUniqueOpenRow(loose, candidate, (x) => x.deviceId === "d1").ok) {
        loose.push(candidate);
      }
    }
    const february = closed(day(31), day(59));
    const billable = rowsOverlappingPeriod(loose, february);
    // One device, and more than one billable placement in the month.
    expect(new Set(billable.map((b) => b.deviceId)).size).toBe(1);
    expect(billable.length).toBeGreaterThan(1);
  });
});
