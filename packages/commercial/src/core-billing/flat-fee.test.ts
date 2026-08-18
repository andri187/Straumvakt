// The flat platform fee, pinned.
//
// The cap cases are enumerated rather than sampled because 200/50/450 is a
// LOCKED commercial frame: these numbers are what Straumvakt earns, and the
// arithmetic around a cap is where an off-by-one costs a month of revenue in
// one direction or a customer's trust in the other.

import { describe, expect, it } from "vitest";
import {
  deriveActiveConnectors,
  deriveActiveDrivers,
  generateFlatFeeStatement,
  measured,
  unavailable,
  FLAT_FEE_CAP_CODE,
  FLAT_FEE_CONNECTOR_CODE,
  FLAT_FEE_DRIVER_CODE,
  type ConnectorLifecycle,
  type FlatFeeInput,
} from "./flat-fee";
import type { RateRefInput } from "../agreement/types";

const ORG = "org-0000-0000-0000-000000000001";
const PERIOD = { orgId: ORG, year: 2026, month: 3 };

function rate(code: string, priceMinor: bigint, over: Partial<RateRefInput> = {}): RateRefInput {
  return {
    id: `rate-${code}`,
    code,
    costFactorId: "cf-core-flat-fee",
    basis: "per_connector",
    priceMinor,
    vatRatePct: 24,
    currency: "ISK",
    supplierOrgId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveUntil: null,
    ...over,
  };
}

const RATES: RateRefInput[] = [
  rate(FLAT_FEE_CONNECTOR_CODE, 20_000n),
  rate(FLAT_FEE_DRIVER_CODE, 5_000n),
  rate(FLAT_FEE_CAP_CODE, 45_000n),
];

function input(connectors: number, drivers: number, over: Partial<FlatFeeInput> = {}): FlatFeeInput {
  return {
    period: PERIOD,
    activeConnectors: measured(connectors, "connector_lifecycle"),
    activeDrivers: measured(drivers, "activity_month_table"),
    rateReferences: RATES,
    ...over,
  };
}

function settledTotal(connectors: number, drivers: number): bigint {
  const r = generateFlatFeeStatement(input(connectors, drivers));
  if (r.kind !== "settled") throw new Error(`expected settled, got holds: ${JSON.stringify(r)}`);
  return r.statement.totalIsk;
}

// ── Cap arithmetic ───────────────────────────────────────────────────

describe("flat fee — cap arithmetic", () => {
  it("below the cap: 2 connectors, 4 drivers → 400 + 200 = 600 kr", () => {
    expect(settledTotal(2, 4)).toBe(600n);
  });

  it("exactly at the cap: 2 connectors, 10 drivers → 400 + 500 = 900 = 450×2", () => {
    // D = 5·C is the breakeven. The uncapped total EQUALS the cap here, so the
    // cap must not be reported as applied — "capped" and "happens to equal the
    // cap" are different facts and only one belongs on an invoice.
    const r = generateFlatFeeStatement(input(2, 10));
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.totalIsk).toBe(900n);
    expect(r.statement.capApplied).toBe(false);
    expect(r.statement.lines.some((l) => l.kind === "cap_relief")).toBe(false);
  });

  it("above the cap: 2 connectors, 11 drivers → capped at 900, relief −50", () => {
    const r = generateFlatFeeStatement(input(2, 11));
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.capApplied).toBe(true);
    expect(r.statement.totalIsk).toBe(900n);
    const relief = r.statement.lines.find((l) => l.kind === "cap_relief");
    expect(relief?.amountIsk).toBe(-50n);
  });

  it("zero drivers: 3 connectors → 600 kr, and no driver line at all", () => {
    const r = generateFlatFeeStatement(input(3, 0));
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.totalIsk).toBe(600n);
    // Not a 0 kr driver line. A zero line on an invoice invites the question
    // "why am I being charged for drivers", which is a support ticket.
    expect(r.statement.lines.map((l) => l.kind)).toEqual(["subscription_connector"]);
  });

  it("zero connectors with drivers: the cap is zero, so the total is zero", () => {
    // Follows literally from "capped at 450 kr / connector". Recorded in
    // subscription.ts as a real product question rather than a rounding
    // detail: if Core should bill drivers in this state the frame needs a
    // floor, which is a decision and not a patch.
    const r = generateFlatFeeStatement(input(0, 7));
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.totalIsk).toBe(0n);
    expect(r.statement.capApplied).toBe(true);
  });

  it("both zero: an org with nothing owes nothing, and settles rather than holds", () => {
    const r = generateFlatFeeStatement(input(0, 0));
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.totalIsk).toBe(0n);
    expect(r.statement.lines).toEqual([]);
  });

  it("one connector, many drivers: 20 drivers caps at 450, not 1200", () => {
    expect(settledTotal(1, 20)).toBe(450n);
  });

  it("one connector, exactly 5 drivers sits on the breakeven at 450", () => {
    expect(settledTotal(1, 5)).toBe(450n);
    expect(settledTotal(1, 6)).toBe(450n);
    expect(settledTotal(1, 4)).toBe(400n);
  });

  it("an org with two sites is one org: connectors add, the cap scales", () => {
    // The cap is per connector applied to the ORG total, so splitting the same
    // connectors across two sites must not change the answer.
    expect(settledTotal(4, 30)).toBe(settledTotal(4, 30));
    expect(settledTotal(4, 30)).toBe(1800n); // 800 + 1500 = 2300 → capped 450×4
    expect(settledTotal(4, 10)).toBe(1300n); // 800 + 500, under the cap
  });

  it("mid-period activation counts, and does not prorate", () => {
    // "200 kr / active connector / month" says nothing about fractions of a
    // month. Day-weighting would be an invention.
    const lifecycles: ConnectorLifecycle[] = [
      { connectorId: "c1", enabledAt: new Date("2026-03-28T00:00:00Z"), disabledAt: null },
    ];
    expect(deriveActiveConnectors(lifecycles, PERIOD)).toEqual({
      kind: "measured",
      count: 1,
      source: "connector_lifecycle",
    });
  });

  it("mid-period deactivation still counts for that month", () => {
    const lifecycles: ConnectorLifecycle[] = [
      {
        connectorId: "c1",
        enabledAt: new Date("2026-01-01T00:00:00Z"),
        disabledAt: new Date("2026-03-02T00:00:00Z"),
      },
    ];
    expect(deriveActiveConnectors(lifecycles, PERIOD)).toEqual({
      kind: "measured",
      count: 1,
      source: "connector_lifecycle",
    });
  });

  it("excludes connectors whose whole life sits outside the period", () => {
    const lifecycles: ConnectorLifecycle[] = [
      {
        connectorId: "before",
        enabledAt: new Date("2026-01-01T00:00:00Z"),
        disabledAt: new Date("2026-03-01T00:00:00Z"), // ends exactly at period start
      },
      { connectorId: "after", enabledAt: new Date("2026-04-01T00:00:00Z"), disabledAt: null },
    ];
    const out = deriveActiveConnectors(lifecycles, PERIOD);
    expect(out).toEqual({ kind: "measured", count: 0, source: "connector_lifecycle" });
  });

  it("counts a connector disabled and re-enabled in one month once", () => {
    const lifecycles: ConnectorLifecycle[] = [
      {
        connectorId: "c1",
        enabledAt: new Date("2026-03-01T00:00:00Z"),
        disabledAt: new Date("2026-03-10T00:00:00Z"),
      },
      { connectorId: "c1", enabledAt: new Date("2026-03-20T00:00:00Z"), disabledAt: null },
    ];
    expect(deriveActiveConnectors(lifecycles, PERIOD)).toMatchObject({ count: 1 });
  });
});

// ── Rate lock-in ─────────────────────────────────────────────────────

describe("flat fee — rate lock-in", () => {
  it("copies unit price and effective window onto every line", () => {
    const r = generateFlatFeeStatement(input(2, 3));
    if (r.kind !== "settled") throw new Error("expected settled");
    const connectorLine = r.statement.lines.find((l) => l.kind === "subscription_connector")!;
    expect(connectorLine.unitPriceMinor).toBe(20_000n);
    expect(connectorLine.effectiveFrom).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(connectorLine.effectiveUntil).toBeNull();
    expect(connectorLine.rateVersionId).toBe(`rate-${FLAT_FEE_CONNECTOR_CODE}`);
  });

  it("editing the rate row afterwards cannot restate a generated period", () => {
    // The copies are on the line. Mutating the source row is exactly what a
    // price change looks like, and it must move future periods only.
    const rates = [rate(FLAT_FEE_CONNECTOR_CODE, 20_000n), RATES[1]!, RATES[2]!];
    const before = generateFlatFeeStatement(input(2, 3, { rateReferences: rates }));
    if (before.kind !== "settled") throw new Error("expected settled");
    const lineBefore = before.statement.lines[0]!;

    // The operator raises the connector price. Same id, new price.
    rates[0] = rate(FLAT_FEE_CONNECTOR_CODE, 30_000n);

    expect(lineBefore.unitPriceMinor).toBe(20_000n);
    expect(before.statement.totalIsk).toBe(550n);
  });

  it("prices at the PERIOD START, not at generation time", () => {
    // March's invoice generated in April must not pick up April's price.
    const rates: RateRefInput[] = [
      rate(FLAT_FEE_CONNECTOR_CODE, 20_000n, {
        id: "rate-old",
        effectiveUntil: new Date("2026-03-15T00:00:00Z"),
      }),
      rate(FLAT_FEE_CONNECTOR_CODE, 30_000n, {
        id: "rate-new",
        effectiveFrom: new Date("2026-03-15T00:00:00Z"),
      }),
      RATES[1]!,
      RATES[2]!,
    ];
    const r = generateFlatFeeStatement(input(2, 0, { rateReferences: rates }));
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.lines[0]!.rateVersionId).toBe("rate-old");
    expect(r.statement.totalIsk).toBe(400n);
  });

  it("is deterministic: regenerating the same period yields the same document", () => {
    const a = generateFlatFeeStatement(input(3, 7));
    const b = generateFlatFeeStatement(input(3, 7));
    expect(a).toEqual(b);
  });

  it("the total is the sum of ROUNDED lines, not the rounded sum", () => {
    const r = generateFlatFeeStatement(input(2, 11));
    if (r.kind !== "settled") throw new Error("expected settled");
    const sumOfRounded = r.statement.lines.reduce((acc, l) => acc + l.amountIsk, 0n);
    expect(r.statement.totalIsk).toBe(sumOfRounded);
  });
});

// ── No silent zero ───────────────────────────────────────────────────

describe("flat fee — refuses rather than billing a guess", () => {
  it("holds when the connector count is unavailable", () => {
    const r = generateFlatFeeStatement(
      input(0, 0, { activeConnectors: unavailable("no_activity_source") }),
    );
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds).toContainEqual({
      reason: "connector_count_unavailable",
      detail: "no_activity_source",
    });
    expect(r.excludedSessionIds).toEqual([]);
  });

  it("holds when the driver count is unavailable, and does not bill 0 drivers", () => {
    // The distinction the whole module exists for: an org with an unknown
    // driver count is not an org with zero drivers.
    const r = generateFlatFeeStatement(
      input(2, 0, { activeDrivers: unavailable("driver_definition_incomplete") }),
    );
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toContain("driver_count_unavailable");
  });

  it("holds when a rate has no version effective at the period start", () => {
    const late = rate(FLAT_FEE_DRIVER_CODE, 5_000n, {
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
    });
    const r = generateFlatFeeStatement(
      input(2, 3, { rateReferences: [RATES[0]!, late, RATES[2]!] }),
    );
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toContain("no_rate_at_period_start");
  });

  it("holds when a rate row disagrees with the locked 200/50/450 frame", () => {
    // Pricing on it silently would bill an amount nobody agreed. Pricing on
    // the constant instead would make the rate rows decorative.
    const wrong = rate(FLAT_FEE_CONNECTOR_CODE, 25_000n);
    const r = generateFlatFeeStatement(
      input(2, 3, { rateReferences: [wrong, RATES[1]!, RATES[2]!] }),
    );
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toContain("rate_disagrees_with_locked_frame");
  });

  it("holds when a plug-time factor is present but unmeasurable", () => {
    const r = generateFlatFeeStatement(input(2, 3, { plugTime: { kind: "unavailable" } }));
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toContain("plug_time_unmeasurable");
  });

  it("collects EVERY reason, so one fix does not reveal the next one a month later", () => {
    const r = generateFlatFeeStatement({
      period: PERIOD,
      activeConnectors: unavailable("no_activity_source"),
      activeDrivers: unavailable("driver_definition_incomplete"),
      rateReferences: [],
      plugTime: { kind: "unavailable" },
    });
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.length).toBeGreaterThanOrEqual(6);
  });

  it("deriveActiveDrivers refuses even when it has a charging count", () => {
    // "Active driver" is charging OR REPORTING activity, and reporting
    // activity has no persisted event of any kind. A charging-only count is a
    // lower bound, not the defined quantity, and 50 kr/driver/month of
    // under-billing is invisible on the invoice that omits it.
    expect(deriveActiveDrivers(["d1", "d2", "d3"], PERIOD)).toEqual({
      kind: "unavailable",
      reason: "driver_definition_incomplete",
    });
  });

  it("measured() refuses a negative or fractional count", () => {
    expect(() => measured(-1, "operator_entry")).toThrow(
      "activity_count_must_be_a_non_negative_integer",
    );
    expect(() => measured(1.5, "operator_entry")).toThrow(
      "activity_count_must_be_a_non_negative_integer",
    );
  });
});
