// The settlement snapshot — the contract.
//
// The headline tests here are the two that describe B1: a rate edited after
// the fact must not change a snapshot, and a session with no rate in force at
// its start must go to review rather than be priced with today's rate.

import { describe, expect, it } from "vitest";
import {
  buildSettlementSnapshot,
  coversSessionStart,
  DEFAULT_CDR_TOLERANCE_KWH,
  snapshotIsImmutableUnder,
  splitBetweenBearers,
  type RateComponentInput,
  type SettlementInput,
} from "./settlement";

const AT = (s: string) => new Date(s);

const DSO: RateComponentInput = {
  kind: "dso",
  rateVersionId: "dso-ad1-v3",
  pricePerKwhMinor: 864n,
  effectiveFrom: AT("2026-01-01T00:00:00Z"),
  effectiveUntil: null,
};
const RETAILER: RateComponentInput = {
  kind: "retailer",
  rateVersionId: "n1-repf-01-v7",
  pricePerKwhMinor: 883n,
  effectiveFrom: AT("2026-01-01T00:00:00Z"),
  effectiveUntil: null,
};

const base = (over: Partial<SettlementInput> = {}): SettlementInput => ({
  orgId: "org_alpha",
  sessionId: "sess_1",
  connectorId: "conn_1",
  driverId: "drv_1",
  startedAt: AT("2026-07-10T08:00:00Z"),
  stoppedAt: AT("2026-07-10T11:00:00Z"),
  meterStartWh: 1_000,
  meterStopWh: 31_000, // 30 kWh
  components: [DSO, RETAILER],
  vatRatePct: 24,
  provenance: "ocpp",
  pricedAt: AT("2026-08-01T00:00:00Z"),
  ...over,
});

describe("the canonical session prices correctly", () => {
  const s = buildSettlementSnapshot(base());

  it("resolves 30 kWh from the meter pair", () => {
    expect(s.energyWh).toBe(30_000);
    expect(s.meterStartWh).toBe(1_000);
    expect(s.meterStopWh).toBe(31_000);
  });

  it("prices both components ex-VAT", () => {
    expect(s.components.find((c) => c.kind === "dso")!.amountExVatMinor).toBe(25_920n);
    expect(s.components.find((c) => c.kind === "retailer")!.amountExVatMinor).toBe(26_490n);
    expect(s.amountExVatMinor).toBe(52_410n);
  });

  it("keeps the retailer component, which the live path discards", () => {
    expect(s.components.map((c) => c.kind)).toContain("retailer");
  });

  it("splits VAT out rather than discarding it", () => {
    expect(s.vatRatePct).toBe(24);
    expect(s.vatMinor).toBe(12_578n);
    expect(s.totalIncVatMinor).toBe(64_988n);
  });

  it("bills a whole-króna line", () => {
    expect(s.totalIsk).toBe(650n);
    expect(s.currency).toBe("ISK");
  });

  it("settles, and records why", () => {
    expect(s.status).toBe("settled");
    expect(s.reviewReasons).toEqual([]);
    expect(s.provenanceState).toBe("ocpp_derived");
  });

  it("always requires admin confirmation", () => {
    expect(s.billingApplicability).toBe("requires-admin-confirmation");
  });
});

describe("rate lock at session start — B1", () => {
  it("only uses a rate whose window covers session START", () => {
    expect(coversSessionStart(DSO, AT("2026-07-10T08:00:00Z"))).toBe(true);
    expect(
      coversSessionStart(
        { ...DSO, effectiveFrom: AT("2026-08-01T00:00:00Z") },
        AT("2026-07-10T08:00:00Z"),
      ),
    ).toBe(false);
  });

  it("treats effectiveUntil as EXCLUSIVE", () => {
    const closed = { ...DSO, effectiveUntil: AT("2026-07-10T08:00:00Z") };
    expect(coversSessionStart(closed, AT("2026-07-10T08:00:00Z"))).toBe(false);
    expect(coversSessionStart(closed, AT("2026-07-10T07:59:59Z"))).toBe(true);
  });

  it("IGNORES a rate that only became effective after the session started", () => {
    // The live path would price with this rate because it is current now.
    const future = { ...DSO, rateVersionId: "dso-ad1-v4", pricePerKwhMinor: 2_000n,
      effectiveFrom: AT("2026-08-01T00:00:00Z") };
    const s = buildSettlementSnapshot(base({ components: [future, RETAILER] }));
    expect(s.components.some((c) => c.rateVersionId === "dso-ad1-v4")).toBe(false);
    expect(s.components.find((c) => c.kind === "retailer")!.amountExVatMinor).toBe(26_490n);
  });

  it("goes to REVIEW when no rate was in force at session start", () => {
    const future = { ...DSO, effectiveFrom: AT("2026-08-01T00:00:00Z") };
    const s = buildSettlementSnapshot(base({ components: [future] }));
    expect(s.status).toBe("billing_review_required");
    expect(s.reviewReasons).toContain("no_rate_at_session_start");
  });

  it("goes to REVIEW when there are no rates at all", () => {
    const s = buildSettlementSnapshot(base({ components: [] }));
    expect(s.reviewReasons).toContain("no_rate_at_session_start");
  });

  it("records the rate version AND its window on the snapshot", () => {
    const s = buildSettlementSnapshot(base());
    const dso = s.components.find((c) => c.kind === "dso")!;
    expect(dso.rateVersionId).toBe("dso-ad1-v3");
    expect(dso.effectiveFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(dso.effectiveUntil).toBeNull();
  });

  it("a later price edit CANNOT change an existing snapshot", () => {
    const s = buildSettlementSnapshot(base());
    const before = s.totalIncVatMinor;
    const edited: RateComponentInput[] = [
      { ...DSO, pricePerKwhMinor: 9_999n },
      { ...RETAILER, pricePerKwhMinor: 9_999n },
    ];
    expect(snapshotIsImmutableUnder(s, edited)).toBe(true);
    expect(s.totalIncVatMinor).toBe(before);
    expect(s.totalIsk).toBe(650n);
  });

  it("names its selection policy, so the choice is auditable", () => {
    expect(buildSettlementSnapshot(base()).rateSelectionPolicy).toBe("start_rate");
  });
});

describe("meter semantics feed review, not silent zeros", () => {
  it("holds an unresolvable meter reading", () => {
    const s = buildSettlementSnapshot(base({ meterStopWh: null }));
    expect(s.status).toBe("billing_review_required");
    expect(s.energyWh).toBeNull();
    expect(s.reviewReasons.some((r) => r.startsWith("meter"))).toBe(true);
  });

  it("holds a backwards meter rather than billing a negative", () => {
    const s = buildSettlementSnapshot(base({ meterStartWh: 31_000, meterStopWh: 1_000 }));
    expect(s.status).toBe("billing_review_required");
    expect(s.totalIncVatMinor).toBe(0n);
  });

  it("treats a missing meterStart as zero, not as a fault", () => {
    const s = buildSettlementSnapshot(base({ meterStartWh: null, meterStopWh: 30_000 }));
    expect(s.energyWh).toBe(30_000);
    expect(s.status).toBe("settled");
  });

  it("holds an implausible reading", () => {
    const s = buildSettlementSnapshot(base({ meterStartWh: 0, meterStopWh: 900_000 }));
    expect(s.status).toBe("billing_review_required");
  });

  it("a held session bills nothing at all", () => {
    const s = buildSettlementSnapshot(base({ meterStopWh: null }));
    expect(s.totalIsk).toBe(0n);
  });
});

describe("CDR mismatch", () => {
  it("settles when the CDR agrees within tolerance", () => {
    const s = buildSettlementSnapshot(base({ cdrEnergyKwh: 30.02 }));
    expect(s.status).toBe("settled");
  });

  it("holds when the CDR disagrees beyond tolerance", () => {
    const s = buildSettlementSnapshot(base({ cdrEnergyKwh: 42 }));
    expect(s.status).toBe("billing_review_required");
    expect(s.reviewReasons).toContain("cdr_mismatch_beyond_tolerance");
  });

  it("uses the live 0.05 kWh tolerance by default", () => {
    expect(DEFAULT_CDR_TOLERANCE_KWH).toBe(0.05);
    expect(buildSettlementSnapshot(base({ cdrEnergyKwh: 30.04 })).status).toBe("settled");
    expect(buildSettlementSnapshot(base({ cdrEnergyKwh: 30.06 })).status).toBe(
      "billing_review_required",
    );
  });

  it("honours an explicit tolerance", () => {
    const s = buildSettlementSnapshot(base({ cdrEnergyKwh: 30.5, cdrToleranceKwh: 1 }));
    expect(s.status).toBe("settled");
  });

  it("marks a CDR-sourced settlement as cdr_confirmed", () => {
    const s = buildSettlementSnapshot(base({ provenance: "cdr", cdrEnergyKwh: 30 }));
    expect(s.provenanceState).toBe("cdr_confirmed");
  });

  it("ignores an absent CDR rather than treating it as disagreement", () => {
    expect(buildSettlementSnapshot(base({ cdrEnergyKwh: null })).status).toBe("settled");
    expect(buildSettlementSnapshot(base({ cdrEnergyKwh: NaN })).status).toBe("settled");
  });
});

describe("plug time joins the same snapshot", () => {
  it("adds the occupancy fee to the ex-VAT subtotal", () => {
    const s = buildSettlementSnapshot(base({ plugTimeFeeMinor: 5_000n, plugTimeSeconds: 3_600 }));
    expect(s.amountExVatMinor).toBe(57_410n);
    expect(s.plugTimeFeeMinor).toBe(5_000n);
    expect(s.plugTimeSeconds).toBe(3_600);
  });

  it("charges VAT on the occupancy fee too", () => {
    const s = buildSettlementSnapshot(base({ plugTimeFeeMinor: 5_000n }));
    expect(s.vatMinor).toBe(13_778n); // 57410 * 0.24 = 13778.4
  });

  it("defaults to no occupancy charge", () => {
    const s = buildSettlementSnapshot(base());
    expect(s.plugTimeFeeMinor).toBe(0n);
    expect(s.plugTimeSeconds).toBeNull();
  });
});

describe("impossible inputs produce review, never a silent number", () => {
  it("holds a session whose times are missing or reversed", () => {
    const s = buildSettlementSnapshot(base({ stoppedAt: AT("2026-07-10T07:00:00Z") }));
    expect(s.reviewReasons).toContain("missing_session_times");
    expect(s.status).toBe("billing_review_required");
  });

  it("honours an operator hold on an otherwise perfect session", () => {
    const s = buildSettlementSnapshot(base({ manualHold: true }));
    expect(s.status).toBe("billing_review_required");
    expect(s.reviewReasons).toContain("manual_hold");
  });

  it("collects EVERY reason, not just the first", () => {
    const s = buildSettlementSnapshot(base({ meterStopWh: null, components: [] }));
    expect(s.reviewReasons.length).toBeGreaterThanOrEqual(2);
    expect(s.reviewReasons).toContain("no_rate_at_session_start");
  });

  it("an unattributed session still settles, with no driver", () => {
    const s = buildSettlementSnapshot(base({ driverId: null }));
    expect(s.status).toBe("settled");
    expect(s.driverId).toBeNull();
  });
});

describe("splitting between bearers", () => {
  it("splits the total without losing aurar", () => {
    const s = buildSettlementSnapshot(base());
    const parts = splitBetweenBearers(s, [25_920n, 26_490n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(s.totalIncVatMinor);
  });
});

describe("determinism", () => {
  it("the same inputs produce the same snapshot", () => {
    expect(JSON.stringify(buildSettlementSnapshot(base()), bigintReplacer)).toBe(
      JSON.stringify(buildSettlementSnapshot(base()), bigintReplacer),
    );
  });

  it("pricedAt comes from the caller, never a clock", () => {
    const s = buildSettlementSnapshot(base({ pricedAt: AT("2027-01-01T00:00:00Z") }));
    expect(s.pricedAt).toBe("2027-01-01T00:00:00.000Z");
  });
});

function bigintReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
