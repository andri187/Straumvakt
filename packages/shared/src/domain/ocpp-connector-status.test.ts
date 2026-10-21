// The connector status vocabulary, pinned to OCPP's spelling.
//
// The tests that matter are the ones that fail if someone "tidies" the
// vocabulary: a lowercase normalisation, a merge of the two Suspended values,
// or a mapping of the not-observed sentinel onto `Unavailable`. Each of those
// looks like an improvement and each loses information that cannot be
// reconstructed.

import { describe, expect, it } from "vitest";
import {
  OCPP_CONNECTOR_STATUSES,
  STATUS_NOT_OBSERVED,
  isServiceable,
  parseConnectorStatus,
  readConnectorStatus,
} from "./ocpp-connector-status";

const AT = new Date("2026-03-05T10:00:00Z");

describe("the vocabulary is OCPP's", () => {
  it("is exactly the nine values of OCPP 1.6 §4.9, in the spec's order", () => {
    expect(OCPP_CONNECTOR_STATUSES).toEqual([
      "Available",
      "Preparing",
      "Charging",
      "SuspendedEV",
      "SuspendedEVSE",
      "Finishing",
      "Reserved",
      "Unavailable",
      "Faulted",
    ]);
  });

  it("keeps SuspendedEV and SuspendedEVSE apart", () => {
    // "the car stopped it" vs "we stopped it" — the distinction a driver
    // support call turns on, and the first casualty of any house enum.
    expect(parseConnectorStatus("SuspendedEV")).toBe("SuspendedEV");
    expect(parseConnectorStatus("SuspendedEVSE")).toBe("SuspendedEVSE");
    expect(parseConnectorStatus("SuspendedEV")).not.toBe(parseConnectorStatus("SuspendedEVSE"));
  });

  it("is case-sensitive — an off-spec charger is refused, not absorbed", () => {
    // Accepting `charging` means the stored value is no longer the protocol's,
    // which is the thing item 11 asks us not to do. Refusing makes the
    // deviation visible in a log rather than invisible in the data.
    expect(parseConnectorStatus("charging")).toBeNull();
    expect(parseConnectorStatus("CHARGING")).toBeNull();
    expect(parseConnectorStatus("suspendedev")).toBeNull();
  });

  it("refuses values that are not in the vocabulary at all", () => {
    for (const bad of ["", "idle", "busy", "offline", "Occupied", "unknown"]) {
      expect(parseConnectorStatus(bad)).toBeNull();
    }
    expect(parseConnectorStatus(null)).toBeNull();
    expect(parseConnectorStatus(undefined)).toBeNull();
  });
});

describe("the not-observed sentinel is not a protocol value", () => {
  it("is `unknown`, and it is NOT `Unavailable`", () => {
    // The sharper temptation: OCPP HAS a status called `Unavailable`, so
    // writing it for a connector we have never heard from looks like
    // reporting rather than inventing. It is a different claim — `Unavailable`
    // means the charger told us it is out of service.
    expect(STATUS_NOT_OBSERVED).toBe("unknown");
    expect(OCPP_CONNECTOR_STATUSES).not.toContain(STATUS_NOT_OBSERVED);
    expect(readConnectorStatus(STATUS_NOT_OBSERVED, AT)).toEqual({
      kind: "unavailable",
      reason: "never_reported",
    });
  });

  it("reads a real status as observed, with its timestamp", () => {
    expect(readConnectorStatus("Charging", AT)).toEqual({
      kind: "observed",
      status: "Charging",
      at: AT,
    });
  });

  it("separates `never_reported` from `unrecognised_value`", () => {
    // The first is normal on a new install. The second is a bug — something
    // wrote a value that is not in the vocabulary — and collapsing them hides
    // it.
    expect(readConnectorStatus(null, AT)).toMatchObject({ reason: "never_reported" });
    expect(readConnectorStatus("", AT)).toMatchObject({ reason: "never_reported" });
    expect(readConnectorStatus("idle", AT)).toMatchObject({ reason: "unrecognised_value" });
  });

  it("a status with no timestamp is not evidence of a moment", () => {
    expect(readConnectorStatus("Charging", null)).toMatchObject({
      kind: "unavailable",
      reason: "unrecognised_value",
    });
    expect(readConnectorStatus("Charging", new Date("nope"))).toMatchObject({
      kind: "unavailable",
    });
  });
});

describe("isServiceable is an OPERATIONS question, not a billing one", () => {
  it("is false only for Unavailable and Faulted", () => {
    expect(OCPP_CONNECTOR_STATUSES.filter((s) => !isServiceable(s))).toEqual([
      "Unavailable",
      "Faulted",
    ]);
  });

  it("says nothing about whether a connector was billable", () => {
    // A charger that was Faulted when someone ran the query was still on site
    // all month. Billing counts placements overlapping the period (ADR 0054
    // decision 5) and does not consult status at all — which is why these live
    // in different modules and why this test exists to say so.
    expect(isServiceable("Faulted")).toBe(false);
    expect(isServiceable("Charging")).toBe(true);
    expect(isServiceable("Available")).toBe(true);
  });
});
