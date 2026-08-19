// The feeder, wired to a source.
//
// The assertion that matters most is the first one: a period with no activity
// rows HOLDS. Everything else in this file is arithmetic; that one is the
// difference between an honest refusal and a 0 kr invoice sent to an org that
// owes money.

import { describe, expect, it } from "vitest";
import {
  countFromRows,
  generateFlatFeeStatementFromSource,
  type ActivitySourcePort,
} from "./activity-source";
import {
  FLAT_FEE_CAP_CODE,
  FLAT_FEE_CONNECTOR_CODE,
  FLAT_FEE_DRIVER_CODE,
  measured,
  unavailable,
  type CountEvidence,
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

/** A port that answers with whatever evidence the test hands it. */
function portOf(connectors: CountEvidence, drivers: CountEvidence): ActivitySourcePort {
  return {
    connectorCount: async () => connectors,
    driverCount: async () => drivers,
  };
}

/** A port backed by row counts, exercising the absent-is-unknown rule. */
function portFromRows(connectorRows: number, driverRows: number, jobHasRun = true): ActivitySourcePort {
  const ev = (n: number) =>
    countFromRows(n, { periodState: jobHasRun ? "activity_sealed" : "open", source: "activity_month_table" });
  return { connectorCount: async () => ev(connectorRows), driverCount: async () => ev(driverRows) };
}

const base = { period: PERIOD, rateReferences: RATES };

async function totalFromRows(connectorRows: number, driverRows: number): Promise<bigint> {
  const r = await generateFlatFeeStatementFromSource(portFromRows(connectorRows, driverRows), base);
  if (r.kind !== "settled") throw new Error(`expected settled, got ${JSON.stringify(r)}`);
  return r.statement.totalIsk;
}

// ── The hold ─────────────────────────────────────────────────────────

describe("a period with no activity rows HOLDS", () => {
  it("holds when the connector table has no rows for the period", async () => {
    // Not a 0 kr invoice. reports.connector_activity_month has no row for a
    // connector nobody could evidence, so "no rows" means "we do not know".
    const r = await generateFlatFeeStatementFromSource(portFromRows(0, 3), base);
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toContain("connector_count_unavailable");
    expect(r.holds.find((h) => h.reason === "connector_count_unavailable")?.detail).toBe(
      "no_activity_source",
    );
  });

  it("holds when the driver table has no rows for the period", async () => {
    const r = await generateFlatFeeStatementFromSource(portFromRows(4, 0), base);
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toContain("driver_count_unavailable");
  });

  it("holds when the activity job has not run, even if rows would be non-zero", async () => {
    // The two zeroes are different facts. An org with genuinely no connectors
    // and an org whose aggregation never ran must not produce the same invoice.
    const r = await generateFlatFeeStatementFromSource(portFromRows(9, 9, false), base);
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.map((h) => h.reason)).toEqual(
      expect.arrayContaining(["connector_count_unavailable", "driver_count_unavailable"]),
    );
  });

  it("holds, and reports EVERY reason, so one fix does not reveal the next a month later", async () => {
    const r = await generateFlatFeeStatementFromSource(
      portOf(unavailable("no_activity_source"), unavailable("driver_definition_incomplete")),
      { period: PERIOD, rateReferences: [], plugTime: { kind: "unavailable" } },
    );
    expect(r.kind).toBe("held");
    if (r.kind !== "held") return;
    expect(r.holds.length).toBeGreaterThanOrEqual(6);
    expect(r.excludedSessionIds).toEqual([]);
  });

  it("never produces a settled statement with a zero total from an empty source", async () => {
    // The property, asserted directly rather than inferred from the cases above.
    for (const [c, d] of [
      [0, 0],
      [0, 5],
      [5, 0],
    ] as const) {
      const r = await generateFlatFeeStatementFromSource(portFromRows(c, d), base);
      expect(r.kind).toBe("held");
    }
  });
});

describe("countFromRows — the absent-is-unknown rule, in one place", () => {
  it("zero rows is unavailable, never measured zero", () => {
    expect(countFromRows(0, { periodState: "activity_sealed", source: "activity_month_table" })).toEqual({
      kind: "unavailable",
      reason: "no_activity_source",
    });
  });

  it("a period whose activity is not sealed is unavailable regardless of the count", () => {
    expect(countFromRows(7, { periodState: "open", source: "activity_month_table" })).toEqual({
      kind: "unavailable",
      reason: "no_activity_source",
    });
  });

  it("a real count is measured, and carries its source", () => {
    expect(countFromRows(7, { periodState: "activity_sealed", source: "activity_month_table" })).toEqual({
      kind: "measured",
      count: 7,
      source: "activity_month_table",
    });
  });
});

// ── Cap arithmetic, end to end from activity rows ────────────────────

describe("cap arithmetic from activity rows, not hand-passed counts", () => {
  it("below the cap: 2 connector rows, 4 driver rows -> 600 kr", async () => {
    expect(await totalFromRows(2, 4)).toBe(600n);
  });

  it("exactly at the cap: 2 connectors, 10 drivers -> 900 kr, and capApplied is FALSE", async () => {
    const r = await generateFlatFeeStatementFromSource(portFromRows(2, 10), base);
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.totalIsk).toBe(900n);
    // "capped" and "happens to equal the cap" are different facts and only one
    // belongs on an invoice.
    expect(r.statement.capApplied).toBe(false);
    expect(r.statement.lines.some((l) => l.kind === "cap_relief")).toBe(false);
  });

  it("above the cap: 2 connectors, 11 drivers -> capped 900, relief -50", async () => {
    const r = await generateFlatFeeStatementFromSource(portFromRows(2, 11), base);
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.capApplied).toBe(true);
    expect(r.statement.totalIsk).toBe(900n);
    expect(r.statement.lines.find((l) => l.kind === "cap_relief")?.amountIsk).toBe(-50n);
  });

  it("zero drivers: the source says unknown, so it HOLDS rather than billing connectors alone", async () => {
    // Worth stating explicitly: with rows-based evidence there is no such thing
    // as "zero active drivers" — there is only "no driver rows", which is
    // unknown. An org with connectors and no drivers cannot be billed until
    // somebody says which of the two it is.
    const r = await generateFlatFeeStatementFromSource(portFromRows(3, 0), base);
    expect(r.kind).toBe("held");
  });

  it("zero drivers stated explicitly as measured(0) DOES bill connectors alone", async () => {
    // The counterpart: when a caller can genuinely assert zero, the feeder
    // prices it. 3 × 200 = 600 kr, no driver line at all.
    const r = await generateFlatFeeStatementFromSource(
      portOf(measured(3, "activity_month_table"), measured(0, "activity_month_table")),
      base,
    );
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.totalIsk).toBe(600n);
    expect(r.statement.lines.map((l) => l.kind)).toEqual(["subscription_connector"]);
  });

  it("many drivers on one connector: 20 drivers caps at 450, not 1200", async () => {
    expect(await totalFromRows(1, 20)).toBe(450n);
  });

  it("the breakeven sits at five drivers per connector", async () => {
    expect(await totalFromRows(1, 4)).toBe(400n);
    expect(await totalFromRows(1, 5)).toBe(450n);
    expect(await totalFromRows(1, 6)).toBe(450n);
  });
});

// ── Rate lock-in, through the port ───────────────────────────────────

describe("rate lock-in survives the wiring", () => {
  it("copies unit price and effective window onto the lines", async () => {
    const r = await generateFlatFeeStatementFromSource(portFromRows(2, 3), base);
    if (r.kind !== "settled") throw new Error("expected settled");
    const line = r.statement.lines.find((l) => l.kind === "subscription_connector")!;
    expect(line.unitPriceMinor).toBe(20_000n);
    expect(line.effectiveFrom).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(line.effectiveUntil).toBeNull();
    expect(line.rateVersionId).toBe(`rate-${FLAT_FEE_CONNECTOR_CODE}`);
  });

  it("editing the rate row afterwards cannot restate a generated period", async () => {
    const rates = [rate(FLAT_FEE_CONNECTOR_CODE, 20_000n), RATES[1]!, RATES[2]!];
    const before = await generateFlatFeeStatementFromSource(portFromRows(2, 3), {
      period: PERIOD,
      rateReferences: rates,
    });
    if (before.kind !== "settled") throw new Error("expected settled");
    const lineBefore = before.statement.lines[0]!;

    rates[0] = rate(FLAT_FEE_CONNECTOR_CODE, 30_000n); // the operator raises the price

    expect(lineBefore.unitPriceMinor).toBe(20_000n);
    expect(before.statement.totalIsk).toBe(550n);
  });

  it("prices at the PERIOD START, not at generation time", async () => {
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
    const r = await generateFlatFeeStatementFromSource(
      portOf(measured(2, "activity_month_table"), measured(0, "activity_month_table")),
      { period: PERIOD, rateReferences: rates },
    );
    if (r.kind !== "settled") throw new Error("expected settled");
    expect(r.statement.lines[0]!.rateVersionId).toBe("rate-old");
    expect(r.statement.totalIsk).toBe(400n);
  });

  it("is deterministic: the same source and rates produce the same statement", async () => {
    const a = await generateFlatFeeStatementFromSource(portFromRows(3, 7), base);
    const b = await generateFlatFeeStatementFromSource(portFromRows(3, 7), base);
    expect(a).toEqual(b);
  });
});

describe("the port is asked for the period it was given", () => {
  it("rejects an impossible month before spending a query", async () => {
    let asked = 0;
    const counting: ActivitySourcePort = {
      connectorCount: async () => {
        asked += 1;
        return measured(1, "activity_month_table");
      },
      driverCount: async () => {
        asked += 1;
        return measured(1, "activity_month_table");
      },
    };
    await expect(
      generateFlatFeeStatementFromSource(counting, {
        period: { orgId: ORG, year: 2026, month: 13 },
        rateReferences: RATES,
      }),
    ).rejects.toThrow("month_must_be_1_to_12");
    expect(asked).toBe(0);
  });
});
