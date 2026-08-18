// Meter-energy resolution — the contract.
//
// The battery exists because the existing OCPP projection tests cannot
// catch a cumulative-register charger: every fixture in
// apps/api/src/lib/ocpp/projections.test.ts uses meterStart 0 (:814) or
// omits it, so `meterStop` and `meterStop - meterStart` are the same
// number in every one of them. The cases below are chosen so the two
// expressions DISAGREE.

import { describe, expect, it } from "vitest";
import {
  resolveMeterEnergy,
  sessionEnergyWh,
  describeHold,
  DEFAULT_MAX_PLAUSIBLE_WH,
  DEFAULT_CUMULATIVE_START_THRESHOLD_WH,
  type BillingHoldReason,
} from "./meter-energy";

const kWh = (n: number) => n * 1000;

describe("the case the existing suite cannot catch", () => {
  it("a cumulative register bills the delta, not the register", () => {
    // Charger's lifetime register reads 4,000 kWh at start, 4,010 at stop.
    // The session is 10 kWh. Reading meterStop alone bills 4,010 kWh —
    // 401x the true figure.
    const r = resolveMeterEnergy({
      reading: { meterStartWh: kWh(4000), meterStopWh: kWh(4010) },
      maxPlausibleWh: kWh(150),
    });
    expect(r.energyWh).toBe(kWh(10));
    expect(r.mode).toBe("cumulative");
    expect(r.billable).toBe(true);
  });

  it("gives the SAME answer as the old expression for a per-session charger", () => {
    // This is why the bug is invisible today: with start 0 the two agree.
    const reading = { meterStartWh: 0, meterStopWh: kWh(10) };
    expect(resolveMeterEnergy({ reading }).energyWh).toBe(reading.meterStopWh);
    expect(sessionEnergyWh(reading)).toBe(reading.meterStopWh);
  });

  it("and the same answer when meterStart is absent entirely", () => {
    const reading = { meterStopWh: kWh(10) };
    expect(sessionEnergyWh(reading)).toBe(kWh(10));
    expect(resolveMeterEnergy({ reading }).energyWh).toBe(kWh(10));
  });
});

describe("resolveMeterEnergy — the required matrix", () => {
  it("meterStart 0, meterStop 10 kWh => 10 kWh, per_session", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: 0, meterStopWh: kWh(10) } });
    expect(r.energyWh).toBe(kWh(10));
    expect(r.mode).toBe("per_session");
    expect(r.billable).toBe(true);
  });

  it("meterStart 100 kWh, meterStop 110 kWh => 10 kWh, cumulative", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: kWh(100), meterStopWh: kWh(110) } });
    expect(r.energyWh).toBe(kWh(10));
    expect(r.mode).toBe("cumulative");
    expect(r.billable).toBe(true);
  });

  it("meterStart 100 kWh, meterStop 100 kWh => 0 kWh, still billable", () => {
    // A plugged-in car that drew nothing is a real, zero-cost session.
    const r = resolveMeterEnergy({ reading: { meterStartWh: kWh(100), meterStopWh: kWh(100) } });
    expect(r.energyWh).toBe(0);
    expect(r.billable).toBe(true);
    expect(r.anomaly).toBe("none");
  });

  it("meterStop lower than meterStart => hold, no energy", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: kWh(110), meterStopWh: kWh(100) } });
    expect(r.billable).toBe(false);
    expect(r.holdReason).toBe("meter_stop_before_start");
    expect(r.energyWh).toBeNull();
  });

  it("missing meterStart => treated as zero, mode unknown", () => {
    const r = resolveMeterEnergy({ reading: { meterStopWh: kWh(7) } });
    expect(r.energyWh).toBe(kWh(7));
    expect(r.mode).toBe("unknown");
    expect(r.evidence.startAssumedZero).toBe(true);
    expect(r.billable).toBe(true);
  });

  it("missing meterStop => hold, NOT zero", () => {
    // Billing zero would turn a lost StopTransaction into a free charge.
    const r = resolveMeterEnergy({ reading: { meterStartWh: 0 } });
    expect(r.billable).toBe(false);
    expect(r.holdReason).toBe("meter_stop_missing");
    expect(r.energyWh).toBeNull();
  });

  it("both readings missing => hold on the stop", () => {
    const r = resolveMeterEnergy({ reading: {} });
    expect(r.holdReason).toBe("meter_stop_missing");
  });
});

describe("mode inference", () => {
  it("start below the threshold is per_session", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: DEFAULT_CUMULATIVE_START_THRESHOLD_WH - 1, meterStopWh: kWh(5) },
    });
    expect(r.mode).toBe("per_session");
  });

  it("start at the threshold is cumulative", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: DEFAULT_CUMULATIVE_START_THRESHOLD_WH, meterStopWh: kWh(5) },
    });
    expect(r.mode).toBe("cumulative");
  });

  it("a small non-zero start is still per_session, not an anomaly", () => {
    // Some chargers report a few Wh of standby draw before the session.
    const r = resolveMeterEnergy({ reading: { meterStartWh: 18, meterStopWh: kWh(9) } });
    expect(r.mode).toBe("per_session");
    expect(r.energyWh).toBe(kWh(9) - 18);
    expect(r.billable).toBe(true);
  });

  it("the threshold is configurable", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: 500, meterStopWh: kWh(5) },
      cumulativeStartThresholdWh: 100,
    });
    expect(r.mode).toBe("cumulative");
  });
});

describe("plausibility guard — the cumulative register with a lost start", () => {
  it("holds a session above the ceiling", () => {
    // The dangerous case: cumulative charger, StartTransaction missed, so
    // subtraction cannot help. The ceiling is the only thing left.
    const r = resolveMeterEnergy({ reading: { meterStopWh: kWh(4010) } });
    expect(r.billable).toBe(false);
    expect(r.holdReason).toBe("meter_energy_implausible");
    // The number is still reported so an operator can see what arrived.
    expect(r.energyWh).toBe(kWh(4010));
  });

  it("allows the largest session actually observed on this fleet", () => {
    // 79.478 kWh, measured max across 1,655 sessions on 2026-08-10.
    const r = resolveMeterEnergy({ reading: { meterStartWh: 0, meterStopWh: 79_478 } });
    expect(r.billable).toBe(true);
  });

  it("sits at roughly double the observed maximum", () => {
    expect(DEFAULT_MAX_PLAUSIBLE_WH).toBe(150_000);
    expect(DEFAULT_MAX_PLAUSIBLE_WH).toBeGreaterThan(79_478 * 1.5);
  });

  it("holds exactly above the ceiling and allows exactly at it", () => {
    const at = resolveMeterEnergy({ reading: { meterStopWh: DEFAULT_MAX_PLAUSIBLE_WH } });
    const over = resolveMeterEnergy({ reading: { meterStopWh: DEFAULT_MAX_PLAUSIBLE_WH + 1 } });
    expect(at.billable).toBe(true);
    expect(over.billable).toBe(false);
  });

  it("the ceiling is configurable per site", () => {
    // A DC site would set this much higher.
    const r = resolveMeterEnergy({
      reading: { meterStopWh: kWh(300) },
      maxPlausibleWh: kWh(400),
    });
    expect(r.billable).toBe(true);
  });

  it("a cumulative charger WITH its start reading is never held by the ceiling", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: kWh(9_000), meterStopWh: kWh(9_012) },
    });
    expect(r.energyWh).toBe(kWh(12));
    expect(r.billable).toBe(true);
  });
});

describe("duration cross-check", () => {
  it("holds energy reported against zero elapsed time", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: 0, meterStopWh: kWh(10) },
      durationSeconds: 0,
    });
    expect(r.holdReason).toBe("meter_energy_without_duration");
    expect(r.billable).toBe(false);
  });

  it("allows zero energy with zero duration", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: 0, meterStopWh: 0 },
      durationSeconds: 0,
    });
    expect(r.billable).toBe(true);
  });

  it("ignores the check when no duration is supplied", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: 0, meterStopWh: kWh(10) } });
    expect(r.billable).toBe(true);
  });

  it("allows a normal session", () => {
    const r = resolveMeterEnergy({
      reading: { meterStartWh: 0, meterStopWh: kWh(10) },
      durationSeconds: 3600,
    });
    expect(r.billable).toBe(true);
  });
});

describe("malformed input never throws", () => {
  // These arrive from a queue consumer. Throwing retries the message
  // forever instead of surfacing the bad data.
  const bad: Array<[string, unknown]> = [
    ["NaN stop", { meterStopWh: NaN }],
    ["Infinity stop", { meterStopWh: Infinity }],
    ["null stop", { meterStopWh: null }],
    ["undefined stop", { meterStopWh: undefined }],
    ["NaN start", { meterStartWh: NaN, meterStopWh: 1000 }],
    ["Infinity start", { meterStartWh: Infinity, meterStopWh: 1000 }],
  ];
  for (const [name, reading] of bad) {
    it(`survives ${name}`, () => {
      expect(() => resolveMeterEnergy({ reading: reading as never })).not.toThrow();
    });
  }

  it("treats a non-finite start as absent rather than poisoning the maths", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: NaN, meterStopWh: kWh(5) } });
    expect(r.energyWh).toBe(kWh(5));
    expect(r.evidence.startAssumedZero).toBe(true);
  });

  it("treats a non-finite stop as missing", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: 0, meterStopWh: NaN } });
    expect(r.holdReason).toBe("meter_stop_missing");
  });

  it("never returns a negative energy", () => {
    for (const [s, e] of [[100, 50], [kWh(9), kWh(1)], [1, 0]]) {
      const r = resolveMeterEnergy({ reading: { meterStartWh: s, meterStopWh: e } });
      expect(r.energyWh === null || r.energyWh >= 0).toBe(true);
    }
  });
});

describe("sessionEnergyWh — the narrow, drop-in form", () => {
  it("is identical to meterStop for every shape on the deployed fleet", () => {
    // Fleet is per-session: start is 0 or absent. Proven by measurement.
    for (const stop of [0, 18, 9_852, 36_946, 79_478]) {
      expect(sessionEnergyWh({ meterStartWh: 0, meterStopWh: stop })).toBe(stop);
      expect(sessionEnergyWh({ meterStopWh: stop })).toBe(stop);
    }
  });

  it("diverges from meterStop exactly when a start reading exists", () => {
    expect(sessionEnergyWh({ meterStartWh: kWh(4000), meterStopWh: kWh(4010) })).toBe(kWh(10));
  });

  it("returns null on a missing stop so the caller leaves energy unchanged", () => {
    expect(sessionEnergyWh({ meterStartWh: 0 })).toBeNull();
    expect(sessionEnergyWh({})).toBeNull();
  });

  it("returns null rather than a negative on a backwards register", () => {
    expect(sessionEnergyWh({ meterStartWh: 200, meterStopWh: 100 })).toBeNull();
  });
});

describe("hold reasons are explainable", () => {
  const reasons: BillingHoldReason[] = [
    "meter_stop_missing",
    "meter_stop_before_start",
    "meter_energy_implausible",
    "meter_energy_without_duration",
  ];

  it("every reason has driver-facing copy", () => {
    for (const r of reasons) {
      const text = describeHold(r);
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/\.$/);
    }
  });

  it("the copy never leaks an internal column name", () => {
    for (const r of reasons) {
      expect(describeHold(r)).not.toMatch(/meter_stop_wh|energy_wh|session_ledger|_id\b/);
    }
  });

  it("a held resolution always carries both the reason and the flag", () => {
    const held = resolveMeterEnergy({ reading: { meterStartWh: 500, meterStopWh: 100 } });
    expect(held.billable).toBe(false);
    expect(held.holdReason).not.toBeNull();
    expect(held.anomaly).toBe(held.holdReason);
  });

  it("a billable resolution carries no reason", () => {
    const ok = resolveMeterEnergy({ reading: { meterStartWh: 0, meterStopWh: 1000 } });
    expect(ok.billable).toBe(true);
    expect(ok.holdReason).toBeNull();
    expect(ok.anomaly).toBe("none");
  });
});

describe("evidence is complete enough to settle a dispute", () => {
  it("records both readings as received", () => {
    const r = resolveMeterEnergy({ reading: { meterStartWh: 123, meterStopWh: 456 } });
    expect(r.evidence.meterStartWh).toBe(123);
    expect(r.evidence.meterStopWh).toBe(456);
    expect(r.evidence.startAssumedZero).toBe(false);
  });

  it("records the ceiling that was applied", () => {
    const r = resolveMeterEnergy({ reading: { meterStopWh: 1000 }, maxPlausibleWh: 12_345 });
    expect(r.evidence.maxPlausibleWh).toBe(12_345);
  });

  it("distinguishes an absent start from a zero start", () => {
    expect(resolveMeterEnergy({ reading: { meterStopWh: 1 } }).evidence.startAssumedZero).toBe(true);
    expect(
      resolveMeterEnergy({ reading: { meterStartWh: 0, meterStopWh: 1 } }).evidence.startAssumedZero,
    ).toBe(false);
  });
});
