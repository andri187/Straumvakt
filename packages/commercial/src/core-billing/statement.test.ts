// Statements — the contract.

import { describe, expect, it } from "vitest";
import {
  buildDriverStatement,
  buildOrgStatement,
  canGenerateStatement,
  statementExcludesReviewSessions,
  statementIdentity,
  statementTotalIsConsistent,
} from "./statement";
import { buildSettlementSnapshot, type SettlementInput } from "./settlement";
import { buildCorrectionLine } from "./period-close";

const AT = (s: string) => new Date(s);
const PERIOD = { orgId: "org_alpha", year: 2026, month: 7 };

const snap = (over: Partial<SettlementInput> = {}) =>
  buildSettlementSnapshot({
    orgId: "org_alpha",
    sessionId: "sess_1",
    connectorId: "conn_1",
    driverId: "drv_1",
    startedAt: AT("2026-07-10T08:00:00Z"),
    stoppedAt: AT("2026-07-10T11:00:00Z"),
    meterStartWh: 1_000,
    meterStopWh: 31_000,
    components: [
      { kind: "dso", rateVersionId: "dso-v3", pricePerKwhMinor: 864n,
        effectiveFrom: AT("2026-01-01T00:00:00Z"), effectiveUntil: null },
      { kind: "retailer", rateVersionId: "n1-v7", pricePerKwhMinor: 883n,
        effectiveFrom: AT("2026-01-01T00:00:00Z"), effectiveUntil: null },
    ],
    vatRatePct: 24,
    provenance: "ocpp",
    pricedAt: AT("2026-08-01T00:00:00Z"),
    ...over,
  });

const GEN = AT("2026-08-01T09:00:00Z");

describe("driver statement", () => {
  it("bills one settled session as one line", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1", snapshots: [snap()], generatedAt: GEN,
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]!.kind).toBe("session_energy");
    expect(doc.lines[0]!.amountIsk).toBe(650n);
    expect(doc.totalIsk).toBe(650n);
  });

  it("the total equals the sum of the printed lines", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ sessionId: "a" }), snap({ sessionId: "b" }), snap({ sessionId: "c" })],
      generatedAt: GEN,
    });
    expect(doc.totalIsk).toBe(1_950n);
    expect(statementTotalIsConsistent(doc)).toBe(true);
  });

  it("EXCLUDES a session held for review, and names it", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ sessionId: "ok" }), snap({ sessionId: "held", meterStopWh: null })],
      generatedAt: GEN,
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.excludedSessionIds).toEqual(["held"]);
    expect(statementExcludesReviewSessions(doc)).toBe(true);
  });

  it("never prices a held session at zero and hides it", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ sessionId: "held", meterStopWh: null })],
      generatedAt: GEN,
    });
    expect(doc.lines).toHaveLength(0);
    expect(doc.excludedSessionIds).toContain("held");
    expect(doc.totalIsk).toBe(0n);
  });

  it("splits plug time into its own line without creating or losing VAT", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ plugTimeFeeMinor: 5_000n, plugTimeSeconds: 3_600 })],
      generatedAt: GEN,
    });
    expect(doc.lines.map((l) => l.kind)).toEqual(["session_energy", "plug_time"]);
    const s = snap({ plugTimeFeeMinor: 5_000n, plugTimeSeconds: 3_600 });
    const sumMinor = doc.lines.reduce((a, l) => a + l.amountMinor, 0n);
    expect(sumMinor).toBe(s.totalIncVatMinor);
  });

  it("carries corrections as their own lines", () => {
    const correction = buildCorrectionLine({
      originalAmountMinor: 65_000n, correctedAmountMinor: 60_000n, reason: "meter_fault",
    });
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1", snapshots: [snap()],
      corrections: [correction], generatedAt: GEN,
    });
    expect(doc.lines.some((l) => l.kind === "correction")).toBe(true);
    expect(doc.totalIsk).toBe(650n - 50n);
  });

  it("records the period window it covers", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1", snapshots: [snap()], generatedAt: GEN,
    });
    expect(doc.periodStart).toBe("2026-07-01T00:00:00.000Z");
    expect(doc.periodEnd).toBe("2026-08-01T00:00:00.000Z");
  });

  it("always requires admin confirmation", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1", snapshots: [snap()], generatedAt: GEN,
    });
    expect(doc.billingApplicability).toBe("requires-admin-confirmation");
  });
});

describe("cross-tenant: one org cannot bleed into another", () => {
  it("drops a snapshot belonging to a different org", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ sessionId: "mine" }), snap({ sessionId: "theirs", orgId: "org_beta" })],
      generatedAt: GEN,
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]!.sessionId).toBe("mine");
    expect(doc.totalIsk).toBe(650n);
  });

  it("does not even list another org's session as excluded", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ sessionId: "theirs", orgId: "org_beta", meterStopWh: null })],
      generatedAt: GEN,
    });
    expect(doc.excludedSessionIds).toEqual([]);
  });

  it("drops another driver's session from a driver statement", () => {
    const doc = buildDriverStatement({
      period: PERIOD, driverId: "drv_1",
      snapshots: [snap({ sessionId: "other", driverId: "drv_2" })],
      generatedAt: GEN,
    });
    expect(doc.lines).toHaveLength(0);
  });

  it("an org statement ignores another org's sessions", () => {
    const doc = buildOrgStatement({
      period: PERIOD, activeConnectors: 1, activeDrivers: 1,
      snapshots: [snap({ orgId: "org_beta" })], generatedAt: GEN,
    });
    expect(doc.sessionCount).toBe(0);
  });
});

describe("organisation statement carries the Core subscription", () => {
  it("prices 200 + 50 for one connector and one driver", () => {
    const doc = buildOrgStatement({
      period: PERIOD, activeConnectors: 1, activeDrivers: 1,
      snapshots: [snap()], generatedAt: GEN,
    });
    expect(doc.totalIsk).toBe(250n);
    expect(doc.subscription.capApplied).toBe(false);
  });

  it("shows the 450 kr cap as a VISIBLE line, not a silent reduction", () => {
    const doc = buildOrgStatement({
      period: PERIOD, activeConnectors: 1, activeDrivers: 40,
      snapshots: [], generatedAt: GEN,
    });
    expect(doc.lines.some((l) => l.kind === "cap_relief")).toBe(true);
    expect(doc.totalIsk).toBe(450n);
    expect(doc.subscription.capApplied).toBe(true);
  });

  it("keeps the total equal to the sum of its lines under the cap", () => {
    const doc = buildOrgStatement({
      period: PERIOD, activeConnectors: 20, activeDrivers: 200,
      snapshots: [], generatedAt: GEN,
    });
    expect(statementTotalIsConsistent(doc)).toBe(true);
    expect(doc.totalIsk).toBe(9_000n); // 20 * 450
  });

  it("bills nothing for an org with no connectors, and SHOWS why", () => {
    // The cap is 450 x 0 = 0, so the driver charge is fully relieved. The
    // subscription module emits both the charge and the relief rather than
    // suppressing them, which is the better behaviour: a customer can see
    // why they owe nothing instead of finding an unexplained blank.
    const doc = buildOrgStatement({
      period: PERIOD, activeConnectors: 0, activeDrivers: 30,
      snapshots: [], generatedAt: GEN,
    });
    expect(doc.totalIsk).toBe(0n);
    expect(doc.lines.map((l) => l.kind)).toEqual(["subscription_driver", "cap_relief"]);
    expect(statementTotalIsConsistent(doc)).toBe(true);
  });

  it("summarises the period's energy and session count", () => {
    const doc = buildOrgStatement({
      period: PERIOD, activeConnectors: 2, activeDrivers: 3,
      snapshots: [snap({ sessionId: "a" }), snap({ sessionId: "b" })], generatedAt: GEN,
    });
    expect(doc.sessionCount).toBe(2);
    expect(doc.totalEnergyKwh).toBeCloseTo(60, 6);
  });
});

describe("deterministic identity and idempotent generation", () => {
  it("the same inputs give the same statement id", () => {
    const a = statementIdentity(PERIOD, "driver", "drv_1", ["s1", "s2"]);
    const b = statementIdentity(PERIOD, "driver", "drv_1", ["s2", "s1"]);
    expect(a).toBe(b); // order must not matter
  });

  it("different content gives a different id", () => {
    expect(statementIdentity(PERIOD, "driver", "drv_1", ["s1"])).not.toBe(
      statementIdentity(PERIOD, "driver", "drv_1", ["s1", "s2"]),
    );
  });

  it("different recipients and periods do not collide", () => {
    expect(statementIdentity(PERIOD, "driver", "drv_1", [])).not.toBe(
      statementIdentity(PERIOD, "driver", "drv_2", []),
    );
    expect(statementIdentity(PERIOD, "driver", "drv_1", [])).not.toBe(
      statementIdentity({ ...PERIOD, month: 8 }, "driver", "drv_1", []),
    );
    expect(statementIdentity(PERIOD, "driver", "x", [])).not.toBe(
      statementIdentity(PERIOD, "organisation", "x", []),
    );
  });

  it("encodes the period in the id, so it is readable", () => {
    expect(statementIdentity(PERIOD, "driver", "drv_1", [])).toMatch(/^stmt_202607_driver_[0-9a-f]{8}$/);
  });

  it("regenerating the same document is an idempotent replay", () => {
    const id = statementIdentity(PERIOD, "driver", "drv_1", ["s1"]);
    const r = canGenerateStatement("closed", id, id);
    expect(r.allowed).toBe(true);
    expect(r.idempotentReplay).toBe(true);
  });

  it("REFUSES to supersede an existing statement with different content", () => {
    const r = canGenerateStatement("closed", "stmt_old", "stmt_new");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("already_generated_with_different_content");
  });

  it("refuses to generate from a period that is not closed", () => {
    expect(canGenerateStatement("open", null, "x").allowed).toBe(false);
    expect(canGenerateStatement("open", null, "x").reason).toBe("period_not_closed");
    expect(canGenerateStatement("closing", null, "x").allowed).toBe(false);
  });

  it("allows a first generation from a closed period", () => {
    const r = canGenerateStatement("closed", null, "x");
    expect(r.allowed).toBe(true);
    expect(r.idempotentReplay).toBe(false);
  });
});

describe("no mutation of a closed period", () => {
  it("a correction is an additive line, leaving the original untouched", () => {
    const c = buildCorrectionLine({
      originalAmountMinor: 65_000n, correctedAmountMinor: 60_000n, reason: "cdr_mismatch_resolved",
    });
    expect(c.amountMinor).toBe(-5_000n);
    expect(c.originalAmountMinor).toBe(65_000n);
  });

  it("the corrected statement re-totals without editing the prior document", () => {
    const original = buildDriverStatement({
      period: PERIOD, driverId: "drv_1", snapshots: [snap()], generatedAt: GEN,
    });
    const corrected = buildDriverStatement({
      period: PERIOD, driverId: "drv_1", snapshots: [snap()],
      corrections: [buildCorrectionLine({
        originalAmountMinor: 65_000n, correctedAmountMinor: 60_000n, reason: "meter_fault",
      })],
      generatedAt: GEN,
    });
    expect(original.totalIsk).toBe(650n);
    expect(corrected.totalIsk).toBe(600n);
    expect(original.lines).toHaveLength(1); // unchanged
  });
});
