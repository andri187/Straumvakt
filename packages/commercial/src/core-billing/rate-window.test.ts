// Rate versioning and window selection — the contract.
//
// The scenario that drives all of this: a session crossing a rate change at
// midnight. Each policy is asserted on the SAME session so the commercial
// difference between them is visible as a number, not an argument.

import { describe, expect, it } from "vitest";
import {
  selectRateVersions,
  overlappingVersions,
  priceAllocationsMinor,
  CORE_V1_RATE_POLICY,
  type RateVersion,
} from "./rate-window";

const at = (iso: string) => new Date(iso);

/** 8.64 kr/kWh ex-VAT — the real AD1 shape from the tariff engine header. */
const OLD: RateVersion = {
  code: "AD1_v1",
  pricePerKwhMinor: 864n,
  effectiveFrom: at("2026-01-01T00:00:00Z"),
  effectiveUntil: at("2026-08-11T00:00:00Z"),
};
const NEW: RateVersion = {
  code: "AD1_v2",
  pricePerKwhMinor: 1000n, // 10.00 kr/kWh
  effectiveFrom: at("2026-08-11T00:00:00Z"),
  effectiveUntil: null, // open-ended, as persist.ts treats null
};

/** 23:40 → 00:20, 40 minutes, exactly half either side of midnight. */
const CROSSING = {
  startedAt: at("2026-08-10T23:40:00Z"),
  endedAt: at("2026-08-11T00:20:00Z"),
  energyKwh: 10,
};

describe("Core V1 default", () => {
  it("is start_rate", () => {
    expect(CORE_V1_RATE_POLICY).toBe("start_rate");
  });

  it("is what selectRateVersions uses when no policy is given", () => {
    const r = selectRateVersions([OLD, NEW], CROSSING);
    expect(r.policy).toBe("start_rate");
  });
});

describe("overlappingVersions", () => {
  it("finds both versions for a boundary-crossing session", () => {
    expect(overlappingVersions([OLD, NEW], CROSSING).map((v) => v.code))
      .toEqual(["AD1_v1", "AD1_v2"]);
  });

  it("finds one for a session wholly inside a version", () => {
    const inside = { startedAt: at("2026-08-10T10:00:00Z"), endedAt: at("2026-08-10T11:00:00Z") };
    expect(overlappingVersions([OLD, NEW], inside).map((v) => v.code)).toEqual(["AD1_v1"]);
  });

  it("returns them in chronological order regardless of input order", () => {
    expect(overlappingVersions([NEW, OLD], CROSSING).map((v) => v.code))
      .toEqual(["AD1_v1", "AD1_v2"]);
  });

  it("treats effectiveUntil as exclusive and effectiveFrom as inclusive", () => {
    // A session starting exactly at the boundary belongs to the NEW version.
    const atBoundary = { startedAt: at("2026-08-11T00:00:00Z"), endedAt: at("2026-08-11T00:30:00Z") };
    expect(overlappingVersions([OLD, NEW], atBoundary).map((v) => v.code)).toEqual(["AD1_v2"]);
  });

  it("handles an open-ended version far in the future", () => {
    const later = { startedAt: at("2027-05-05T00:00:00Z"), endedAt: at("2027-05-05T01:00:00Z") };
    expect(overlappingVersions([OLD, NEW], later).map((v) => v.code)).toEqual(["AD1_v2"]);
  });
});

describe("the same crossing session under each policy", () => {
  it("start_rate prices all 10 kWh at the OLD rate = 86.40 kr", () => {
    const r = selectRateVersions([OLD, NEW], CROSSING, "start_rate");
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]!.code).toBe("AD1_v1");
    expect(r.allocations[0]!.energyKwh).toBe(10);
    expect(priceAllocationsMinor(r.allocations)).toBe(8640n);
  });

  it("highest_rate prices all 10 kWh at the NEW rate = 100.00 kr", () => {
    const r = selectRateVersions([OLD, NEW], CROSSING, "highest_rate");
    expect(r.allocations[0]!.code).toBe("AD1_v2");
    expect(priceAllocationsMinor(r.allocations)).toBe(10_000n);
  });

  it("split_by_time halves the energy = 93.20 kr", () => {
    // 5 kWh × 8.64 + 5 kWh × 10.00 = 43.20 + 50.00
    const r = selectRateVersions([OLD, NEW], CROSSING, "split_by_time");
    expect(r.allocations).toHaveLength(2);
    expect(r.allocations[0]!.energyKwh).toBeCloseTo(5, 9);
    expect(r.allocations[1]!.energyKwh).toBeCloseTo(5, 9);
    expect(priceAllocationsMinor(r.allocations)).toBe(9320n);
  });

  it("the three policies differ by 13.60 kr on one 10 kWh session", () => {
    const price = (p: Parameters<typeof selectRateVersions>[2]) =>
      priceAllocationsMinor(selectRateVersions([OLD, NEW], CROSSING, p).allocations);
    expect(price("highest_rate") - price("start_rate")).toBe(1360n);
    // split sits between the two, as it must
    expect(price("split_by_time")).toBeGreaterThan(price("start_rate"));
    expect(price("split_by_time")).toBeLessThan(price("highest_rate"));
  });

  it("reports the boundary crossing under every policy", () => {
    for (const p of ["start_rate", "highest_rate", "split_by_time"] as const) {
      const r = selectRateVersions([OLD, NEW], CROSSING, p);
      expect(r.crossedBoundary).toBe(true);
      expect(r.overlappingCodes).toEqual(["AD1_v1", "AD1_v2"]);
    }
  });
});

describe("non-crossing sessions", () => {
  const inside = {
    startedAt: at("2026-08-10T10:00:00Z"),
    endedAt: at("2026-08-10T12:00:00Z"),
    energyKwh: 20,
  };

  it("give the same answer under all three policies", () => {
    const prices = (["start_rate", "highest_rate", "split_by_time"] as const).map((p) =>
      priceAllocationsMinor(selectRateVersions([OLD, NEW], inside, p).allocations),
    );
    expect(new Set(prices.map(String)).size).toBe(1);
    expect(prices[0]).toBe(17_280n); // 20 × 8.64
  });

  it("do not report a boundary crossing", () => {
    expect(selectRateVersions([OLD, NEW], inside).crossedBoundary).toBe(false);
    expect(selectRateVersions([OLD, NEW], inside).overlappingCodes).toEqual(["AD1_v1"]);
  });
});

describe("energy conservation", () => {
  it("split_by_time allocations sum exactly to the session energy", () => {
    for (const kwh of [0, 0.001, 7.351, 10, 63.499]) {
      const r = selectRateVersions([OLD, NEW], { ...CROSSING, energyKwh: kwh }, "split_by_time");
      expect(r.totalEnergyKwh).toBeCloseTo(kwh, 9);
    }
  });

  it("holds across an uneven three-version split", () => {
    const V3: RateVersion = {
      code: "AD1_v3",
      pricePerKwhMinor: 1200n,
      effectiveFrom: at("2026-08-11T00:10:00Z"),
      effectiveUntil: null,
    };
    const mid = { ...NEW, effectiveUntil: at("2026-08-11T00:10:00Z") };
    const r = selectRateVersions([OLD, mid, V3], CROSSING, "split_by_time");
    expect(r.allocations).toHaveLength(3);
    expect(r.totalEnergyKwh).toBeCloseTo(10, 9);
  });

  it("start_rate and highest_rate always allocate the whole session once", () => {
    for (const p of ["start_rate", "highest_rate"] as const) {
      const r = selectRateVersions([OLD, NEW], CROSSING, p);
      expect(r.allocations).toHaveLength(1);
      expect(r.totalEnergyKwh).toBe(10);
    }
  });
});

describe("edge cases", () => {
  it("prices a zero-energy session at zero under every policy", () => {
    for (const p of ["start_rate", "highest_rate", "split_by_time"] as const) {
      const r = selectRateVersions([OLD, NEW], { ...CROSSING, energyKwh: 0 }, p);
      expect(priceAllocationsMinor(r.allocations)).toBe(0n);
    }
  });

  // Double rounding, inherited deliberately from compute-session-cost.ts:
  // kWh → milli-kWh is half-up, and milli-minor → minor is half-up again.
  // A sub-aurar charge can therefore land on 1 aurar rather than 0. The
  // documented drift bound is "< 1 minor", and this is that bound being
  // reached — not a defect, but worth pinning so nobody 'fixes' it blind.
  it("rounds a half-milli-kWh session UP to one aurar", () => {
    // 0.0005 kWh → round(0.5) = 1 milli-kWh → (1×864 + 500)/1000 = 1 minor.
    const r = selectRateVersions([OLD, NEW], { ...CROSSING, energyKwh: 0.0005 }, "start_rate");
    expect(priceAllocationsMinor(r.allocations)).toBe(1n);
  });

  it("rounds just below half a milli-kWh down to zero", () => {
    // 0.0004 kWh → round(0.4) = 0 milli-kWh → (0 + 500)/1000 = 0 minor.
    const r = selectRateVersions([OLD, NEW], { ...CROSSING, energyKwh: 0.0004 }, "start_rate");
    expect(priceAllocationsMinor(r.allocations)).toBe(0n);
  });

  it("handles a zero-duration session", () => {
    const instant = {
      startedAt: at("2026-08-10T23:40:00Z"),
      endedAt: at("2026-08-10T23:40:00Z"),
      energyKwh: 1,
    };
    const r = selectRateVersions([OLD, NEW], instant, "split_by_time");
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]!.code).toBe("AD1_v1");
  });

  it("throws when no version covers the session at all", () => {
    const ancient = {
      startedAt: at("2020-01-01T00:00:00Z"),
      endedAt: at("2020-01-01T01:00:00Z"),
      energyKwh: 5,
    };
    expect(() => selectRateVersions([OLD, NEW], ancient)).toThrow(/no_applicable_rate_version/);
  });

  it("throws on a coverage gap at the session start rather than using a later rate", () => {
    // Session starts in a hole between two versions.
    const gapped: RateVersion[] = [
      { ...OLD, effectiveUntil: at("2026-08-10T20:00:00Z") },
      { ...NEW, effectiveFrom: at("2026-08-11T00:00:00Z") },
    ];
    expect(() => selectRateVersions(gapped, CROSSING))
      .toThrow(/no_rate_version_covers_session_start/);
  });

  it("throws when the session ends before it starts", () => {
    expect(() =>
      selectRateVersions([OLD, NEW], {
        startedAt: at("2026-08-11T00:20:00Z"),
        endedAt: at("2026-08-10T23:40:00Z"),
        energyKwh: 1,
      }),
    ).toThrow(/session_ended_before_it_started/);
  });

  it("rejects negative energy and negative prices", () => {
    expect(() => selectRateVersions([OLD, NEW], { ...CROSSING, energyKwh: -1 }))
      .toThrow(/energy_kwh_must_be_nonneg_finite/);
    expect(() => selectRateVersions([{ ...OLD, pricePerKwhMinor: -1n }], CROSSING))
      .toThrow(/negative_price_for_AD1_v1/);
  });

  it("prices a single open-ended version with no end date", () => {
    const only: RateVersion[] = [{ ...NEW, effectiveFrom: at("2020-01-01T00:00:00Z") }];
    const r = selectRateVersions(only, CROSSING);
    expect(r.crossedBoundary).toBe(false);
    expect(priceAllocationsMinor(r.allocations)).toBe(10_000n);
  });
});

describe("priceAllocationsMinor rounding", () => {
  it("matches compute-session-cost half-up at the milli-kWh boundary", () => {
    // 29.873 kWh × 8.64 = 258.10... → 25810 minor
    const r = selectRateVersions(
      [{ ...OLD, effectiveUntil: null }],
      { startedAt: at("2026-08-10T10:00:00Z"), endedAt: at("2026-08-10T11:00:00Z"), energyKwh: 29.873 },
    );
    expect(priceAllocationsMinor(r.allocations)).toBe(25_810n);
  });

  it("is exact for whole-kWh sessions", () => {
    const r = selectRateVersions(
      [{ ...OLD, effectiveUntil: null }],
      { startedAt: at("2026-08-10T10:00:00Z"), endedAt: at("2026-08-10T11:00:00Z"), energyKwh: 30 },
    );
    expect(priceAllocationsMinor(r.allocations)).toBe(25_920n); // 30 × 864
  });

  it("returns 0 for an empty allocation list", () => {
    expect(priceAllocationsMinor([])).toBe(0n);
  });
});
