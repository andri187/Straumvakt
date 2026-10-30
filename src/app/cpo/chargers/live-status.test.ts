import { describe, expect, it } from "vitest";
import { describeConnectors } from "./live-status";

const s = (connectors: Record<string, { status: string; errorCode: string }>) => ({ deviceId: "d", connectors: Object.fromEntries(Object.entries(connectors).map(([k, v]) => [k, { ...v, reportedAt: null }])), lastReportedAt: null, lastReceivedAt: "2026-10-30T00:00:00Z", seq: 1 });

describe("describeConnectors", () => {
  it("is null when the charger has reported nothing, so the page keeps saying it does not know", () => {
    expect(describeConnectors(null)).toBeNull();
    expect(describeConnectors(s({}))).toBeNull();
  });
  it("shows the status, with the error code only when there is one, and connector numbers only when there are several", () => {
    expect(describeConnectors(s({ "1": { status: "Charging", errorCode: "NoError" } }))).toBe("Charging");
    expect(describeConnectors(s({ "1": { status: "Faulted", errorCode: "GroundFailure" } }))).toBe("Faulted (GroundFailure)");
    expect(describeConnectors(s({ "2": { status: "Available", errorCode: "NoError" }, "1": { status: "Charging", errorCode: "NoError" } }))).toBe("Connector 1: Charging · Connector 2: Available");
  });
});
