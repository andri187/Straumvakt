// The fleet-wide decision, tested directly.
//
// This existed as one expression inside checkOcppSilence — `speaking === 0`
// — with no test and no way to reach it without a database. It was wrong,
// and it stayed wrong until a real outage on 2026-08-06 exposed it: twenty
// of twenty-one chargers past the silence threshold, and the escalation
// suppressed by a single identity that had emitted three frames in six
// hours.
//
// The numbers in "the 2026-08-06 shape" below are the measured ones.

import { describe, expect, it } from "vitest";
import { isFleetWide } from "./ocpp-silence-watch";

describe("isFleetWide", () => {
  it("is false when nothing is watched — no fleet, no fleet-wide outage", () => {
    expect(isFleetWide(0, 0)).toBe(false);
  });

  it("is true when literally nobody is speaking", () => {
    expect(isFleetWide(21, 0)).toBe(true);
    expect(isFleetWide(1, 0)).toBe(true);
  });

  it("is false when the fleet is healthy", () => {
    expect(isFleetWide(21, 21)).toBe(false);
    expect(isFleetWide(21, 20)).toBe(false);
    expect(isFleetWide(21, 11)).toBe(false);
  });

  it("the 2026-08-06 shape: 21 watched, 1 speaking — the case that was missed", () => {
    // 17 chargers dropped inside 53 seconds at 10:27 UTC; by 11:14 twenty of
    // twenty-one were past the threshold. The one still counted as speaking
    // sends roughly two frames an hour and had emitted one a minute earlier.
    // Under `speaking === 0` this returned false and no FLEET-WIDE line was
    // logged during the outage the detector exists to catch.
    expect(isFleetWide(21, 1)).toBe(true);
  });

  it("tolerates stragglers up to the ratio, and not past it", () => {
    expect(isFleetWide(21, 2)).toBe(true); // 9.5%
    expect(isFleetWide(21, 3)).toBe(false); // 14.3% — a pile of failures, not a path one
    expect(isFleetWide(20, 2)).toBe(true); // exactly 10%, inclusive
    expect(isFleetWide(10, 1)).toBe(true); // exactly 10%
    expect(isFleetWide(10, 2)).toBe(false); // 20%
  });

  it("degrades to speaking === 0 on a small fleet with no special case", () => {
    // The ratio does this on its own: one of three speaking is 33%, which is
    // correctly not a path failure. No minimum-fleet-size guard needed.
    expect(isFleetWide(3, 1)).toBe(false);
    expect(isFleetWide(2, 1)).toBe(false);
    expect(isFleetWide(1, 1)).toBe(false);
    expect(isFleetWide(3, 0)).toBe(true);
  });

  it("never reports fleet-wide while a majority still speaks", () => {
    // Property check across plausible fleet sizes — a guard against someone
    // later loosening the ratio into uselessness.
    for (let watched = 1; watched <= 200; watched++) {
      for (let speaking = Math.ceil(watched / 2); speaking <= watched; speaking++) {
        expect(
          isFleetWide(watched, speaking),
          `watched=${watched} speaking=${speaking} must not be fleet-wide`,
        ).toBe(false);
      }
    }
  });
});
