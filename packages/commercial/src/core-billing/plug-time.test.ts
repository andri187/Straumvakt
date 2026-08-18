// Plug-time fee — the contract.
//
// Iceland is UTC+0 year-round with no daylight saving, so every instant here
// is plain UTC and no session can gain or lose an hour to a clock change.
// That is a real simplification and it is asserted rather than assumed.

import { describe, expect, it } from "vitest";
import {
  computePlugTimeFee,
  plugTimeChargeableFrom,
  type PlugTimeRule,
} from "./plug-time";

const at = (iso: string) => new Date(iso);
const kr = (n: number) => BigInt(n) * 100n;

/** 10 kr per minute after 60 minutes, anchored at charging end. */
const RULE: PlugTimeRule = {
  graceMinutes: 60,
  feePerMinuteMinor: kr(10),
};

describe("computePlugTimeFee — grace period", () => {
  it("charges nothing when the car leaves inside the grace period", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T06:45:00Z") },
      RULE,
    );
    expect(r.billableMinutes).toBe(0);
    expect(r.amountExVatMinor).toBe(0n);
    expect(r.lineItems).toHaveLength(0);
  });

  it("charges nothing at exactly the grace boundary", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T07:00:00Z") },
      RULE,
    );
    expect(r.occupiedMinutes).toBe(60);
    expect(r.billableMinutes).toBe(0);
    expect(r.amountExVatMinor).toBe(0n);
  });

  it("charges from the first whole minute past grace", () => {
    // 61 minutes occupied, 60 free, 1 billable × 10 kr.
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T07:01:00Z") },
      RULE,
    );
    expect(r.billableMinutes).toBe(1);
    expect(r.amountExVatMinor).toBe(kr(10));
  });

  it("charges a realistic overnight overstay", () => {
    // Charging ends 02:00, unplugged 08:30 = 390 min, 60 free, 330 × 10 kr.
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T02:00:00Z"), unpluggedAt: at("2026-08-10T08:30:00Z") },
      RULE,
    );
    expect(r.occupiedMinutes).toBe(390);
    expect(r.billableMinutes).toBe(330);
    expect(r.amountExVatMinor).toBe(kr(3300));
  });

  it("a zero grace period bills from the first minute", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T06:05:00Z") },
      { ...RULE, graceMinutes: 0 },
    );
    expect(r.billableMinutes).toBe(5);
    expect(r.amountExVatMinor).toBe(kr(50));
  });
});

describe("computePlugTimeFee — the anchor decision", () => {
  const session = {
    pluggedInAt: at("2026-08-10T22:00:00Z"),
    chargingEndedAt: at("2026-08-11T02:00:00Z"),
    unpluggedAt: at("2026-08-11T07:00:00Z"),
  };

  it("charging_end bills only the idle tail", () => {
    // Idle 02:00→07:00 = 300 min, 60 free, 240 billable.
    const r = computePlugTimeFee(session, RULE);
    expect(r.anchor).toBe("charging_end");
    expect(r.billableMinutes).toBe(240);
    expect(r.amountExVatMinor).toBe(kr(2400));
  });

  it("plug_in bills the whole occupancy including active charging", () => {
    // 22:00→07:00 = 540 min, 60 free, 480 billable — twice the fee for the
    // same behaviour. This is why charging_end is the Core default.
    const r = computePlugTimeFee(session, { ...RULE, anchor: "plug_in" });
    expect(r.anchor).toBe("plug_in");
    expect(r.billableMinutes).toBe(480);
    expect(r.amountExVatMinor).toBe(kr(4800));
  });

  it("an all-night active charge costs nothing under charging_end", () => {
    // Plugged in 22:00, still charging when unplugged at 07:00.
    const r = computePlugTimeFee(
      {
        pluggedInAt: at("2026-08-10T22:00:00Z"),
        chargingEndedAt: at("2026-08-11T07:00:00Z"),
        unpluggedAt: at("2026-08-11T07:00:00Z"),
      },
      RULE,
    );
    expect(r.amountExVatMinor).toBe(0n);
  });

  it("requires the timestamp its anchor depends on", () => {
    expect(() =>
      computePlugTimeFee({ chargingEndedAt: null, unpluggedAt: at("2026-08-10T07:00:00Z") }, RULE),
    ).toThrow(/charging_ended_at_must_be_a_valid_date/);
    expect(() =>
      computePlugTimeFee(
        { pluggedInAt: null, unpluggedAt: at("2026-08-10T07:00:00Z") },
        { ...RULE, anchor: "plug_in" },
      ),
    ).toThrow(/plugged_in_at_must_be_a_valid_date/);
  });
});

describe("computePlugTimeFee — partial minutes", () => {
  const partial = {
    chargingEndedAt: at("2026-08-10T06:00:00Z"),
    unpluggedAt: at("2026-08-10T07:01:30Z"), // 61.5 min → 1.5 billable
  };

  it("rounds down by default — no charge for a part-minute", () => {
    expect(computePlugTimeFee(partial, RULE).billableMinutes).toBe(1);
  });

  it("rounds up when asked", () => {
    expect(computePlugTimeFee(partial, { ...RULE, rounding: "up" }).billableMinutes).toBe(2);
  });

  it("rounds to nearest when asked", () => {
    expect(computePlugTimeFee(partial, { ...RULE, rounding: "nearest" }).billableMinutes).toBe(2);
  });

  it("one second past grace is free under the default", () => {
    // The support-ticket case: rounding up would bill a full minute here.
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T07:00:01Z") },
      RULE,
    );
    expect(r.billableMinutes).toBe(0);
    expect(r.amountExVatMinor).toBe(0n);
  });

  it("one second past grace costs a full minute when rounding up", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T07:00:01Z") },
      { ...RULE, rounding: "up" },
    );
    expect(r.billableMinutes).toBe(1);
  });
});

describe("computePlugTimeFee — cap", () => {
  const long = {
    chargingEndedAt: at("2026-08-10T02:00:00Z"),
    unpluggedAt: at("2026-08-12T02:00:00Z"), // 2 days
  };

  it("caps a multi-day overstay", () => {
    // 2880 min occupied, 60 free, 2820 × 10 kr = 28,200 kr uncapped.
    const r = computePlugTimeFee(long, { ...RULE, maxFeeMinor: kr(5000) });
    expect(r.uncappedFeeMinor).toBe(kr(28_200));
    expect(r.capApplied).toBe(true);
    expect(r.amountExVatMinor).toBe(kr(5000));
  });

  it("emits the cap as a visible negative line summing to the total", () => {
    const r = computePlugTimeFee(long, { ...RULE, maxFeeMinor: kr(5000) });
    const sum = r.lineItems.reduce((a, l) => a + l.amountMinor, 0n);
    expect(sum).toBe(r.amountExVatMinor);
    expect(r.lineItems.some((l) => l.kind === "plug_time_cap_relief")).toBe(true);
  });

  it("does not engage below the cap", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T08:00:00Z") },
      { ...RULE, maxFeeMinor: kr(5000) },
    );
    expect(r.capApplied).toBe(false);
    expect(r.amountExVatMinor).toBe(kr(600)); // 60 billable × 10
  });

  it("a zero cap means the fee is disabled, not unbounded", () => {
    const r = computePlugTimeFee(long, { ...RULE, maxFeeMinor: 0n });
    expect(r.amountExVatMinor).toBe(0n);
    expect(r.capApplied).toBe(true);
  });
});

describe("computePlugTimeFee — invalid input", () => {
  it("rejects an unplug before the anchor rather than billing zero", () => {
    expect(() =>
      computePlugTimeFee(
        { chargingEndedAt: at("2026-08-10T08:00:00Z"), unpluggedAt: at("2026-08-10T06:00:00Z") },
        RULE,
      ),
    ).toThrow(/unplugged_before_anchor/);
  });

  it("rejects a negative rate, negative grace and negative cap", () => {
    const s = { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: at("2026-08-10T08:00:00Z") };
    expect(() => computePlugTimeFee(s, { ...RULE, feePerMinuteMinor: -1n }))
      .toThrow(/fee_per_minute_must_be_nonneg/);
    expect(() => computePlugTimeFee(s, { ...RULE, graceMinutes: -5 }))
      .toThrow(/grace_minutes_must_be_nonneg_finite/);
    expect(() => computePlugTimeFee(s, { ...RULE, maxFeeMinor: -100n }))
      .toThrow(/max_fee_must_be_nonneg/);
  });

  it("rejects an invalid date", () => {
    expect(() =>
      computePlugTimeFee(
        { chargingEndedAt: at("2026-08-10T06:00:00Z"), unpluggedAt: new Date("nonsense") },
        RULE,
      ),
    ).toThrow(/unplugged_at_must_be_a_valid_date/);
  });

  it("a zero rate produces no fee and no line", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T02:00:00Z"), unpluggedAt: at("2026-08-10T08:00:00Z") },
      { ...RULE, feePerMinuteMinor: 0n },
    );
    expect(r.billableMinutes).toBe(300);
    expect(r.amountExVatMinor).toBe(0n);
    expect(r.lineItems).toHaveLength(0);
  });
});

describe("Iceland / UTC+0", () => {
  it("has no daylight-saving discontinuity across the European DST switch", () => {
    // Late March, when most of Europe springs forward. Iceland does not.
    // 6 hours elapsed must be 6 hours billed, not 5 or 7.
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-03-29T00:00:00Z"), unpluggedAt: at("2026-03-29T06:00:00Z") },
      { ...RULE, graceMinutes: 0 },
    );
    expect(r.billableMinutes).toBe(360);
  });

  it("bills a session spanning midnight as one continuous period", () => {
    const r = computePlugTimeFee(
      { chargingEndedAt: at("2026-08-10T23:30:00Z"), unpluggedAt: at("2026-08-11T00:30:00Z") },
      { ...RULE, graceMinutes: 0 },
    );
    expect(r.billableMinutes).toBe(60);
  });
});

describe("plugTimeChargeableFrom", () => {
  it("reports when the fee starts, for the driver app", () => {
    const from = plugTimeChargeableFrom(
      { chargingEndedAt: at("2026-08-10T06:00:00Z") },
      { graceMinutes: 60 },
    );
    expect(from?.toISOString()).toBe("2026-08-10T07:00:00.000Z");
  });

  it("follows the anchor", () => {
    const from = plugTimeChargeableFrom(
      { pluggedInAt: at("2026-08-10T22:00:00Z"), chargingEndedAt: at("2026-08-11T02:00:00Z") },
      { graceMinutes: 30, anchor: "plug_in" },
    );
    expect(from?.toISOString()).toBe("2026-08-10T22:30:00.000Z");
  });

  it("returns null when the anchor timestamp is missing", () => {
    expect(plugTimeChargeableFrom({ chargingEndedAt: null }, { graceMinutes: 60 })).toBeNull();
  });
});
