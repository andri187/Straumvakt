import { describe, expect, it } from "vitest";
import {
  demoValueIsReserved,
  displayUnknown,
  formatCost,
  formatEnergyKwh,
  formatPowerKw,
  normalizeStatus,
  previewFixtureIsReserved,
  statusTone,
  validDenialReason,
} from "./product-ui-guards";

describe("truthful product formatting", () => {
  it("does not turn an absent string into an empty cell", () => {
    expect(displayUnknown(null)).toBe("Unavailable");
  });
  it("preserves a known string", () => {
    expect(displayUnknown(" Zaptec Pro ")).toBe("Zaptec Pro");
  });
  it("does not turn absent energy into zero", () => {
    expect(formatEnergyKwh(null)).toBe("Not reported");
  });
  it("formats known energy", () => {
    expect(formatEnergyKwh(12.375)).toBe("12.375 kWh");
  });
  it("does not turn absent power into zero", () => {
    expect(formatPowerKw(null)).toBe("Unavailable");
  });
  it("formats measured power", () => {
    expect(formatPowerKw(7.14)).toBe("7.1 kW");
  });
  it("labels absent cost pending", () => {
    expect(formatCost(null)).toBe("Pending");
  });
  it("preserves a server-provided cost label", () => {
    expect(formatCost("1,240 kr")).toBe("1,240 kr");
  });
  it("normalizes machine status text", () => {
    expect(normalizeStatus("suspended_evse")).toBe("suspended evse");
  });
});

describe("status and action guards", () => {
  it.each([
    ["online", "ok"],
    ["pending", "warning"],
    ["faulted", "danger"],
    ["offline", "mut"],
  ] as const)("maps %s to %s", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("rejects an empty denial reason", () => {
    expect(validDenialReason("  ")).toBe(false);
  });
  it("rejects a one-character denial reason", () => {
    expect(validDenialReason("x")).toBe(false);
  });
  it("accepts a concise denial reason", () => {
    expect(validDenialReason("Not assigned to this installation")).toBe(true);
  });
  it("rejects a denial reason above the server limit", () => {
    expect(validDenialReason("x".repeat(501))).toBe(false);
  });
});

describe("preview fixture boundary", () => {
  it("accepts demo identifiers", () => {
    expect(demoValueIsReserved("demo-driver-001")).toBe(true);
  });
  it("accepts reserved test email domains", () => {
    expect(demoValueIsReserved("driver@north.test")).toBe(true);
  });
  it("rejects a non-reserved identity", () => {
    expect(demoValueIsReserved("customer@example.com")).toBe(false);
  });
  it("validates nested reserved fixtures", () => {
    expect(
      previewFixtureIsReserved({
        id: "demo-org-1",
        contact: "operator@north.test",
        rows: [{ id: "demo-cp-1" }],
      }),
    ).toBe(true);
  });
  it("rejects nested live-looking email data", () => {
    expect(previewFixtureIsReserved({ email: "person@example.com" })).toBe(false);
  });
});
