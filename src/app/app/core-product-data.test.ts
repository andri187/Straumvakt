import { describe, expect, it } from "vitest";
import {
  ACTIVE_CONNECTOR_DEFINITION,
  ACTIVE_DRIVER_DEFINITION,
  calculateCoreMonthlyPrice,
  CORE_ACTIVE_DRIVER_RATE_ISK,
  CORE_CAP_PER_CONNECTOR_ISK,
  CORE_CONNECTOR_RATE_ISK,
  CORE_MARKET,
  coreBillingPeriods,
  coreOrganisations,
  coreRateConfigurations,
  coreScreensByPersona,
  driverStatementVariants,
  formatIsk,
  getCoreDetail,
} from "./core-product-data";

describe("locked Core pricing", () => {
  it("uses 200 kr per active connector", () => expect(CORE_CONNECTOR_RATE_ISK).toBe(200));
  it("uses 50 kr per active driver", () => expect(CORE_ACTIVE_DRIVER_RATE_ISK).toBe(50));
  it("caps at 450 kr per connector", () => expect(CORE_CAP_PER_CONNECTOR_ISK).toBe(450));
  it("states the Iceland-only market", () => expect(CORE_MARKET).toBe("Iceland only / UTC+0"));
  it("labels connector semantics as proposed and backend-gated", () => {
    expect(ACTIVE_CONNECTOR_DEFINITION).toMatch(/Proposed billing rule/);
    expect(ACTIVE_CONNECTOR_DEFINITION).toMatch(/backend-gated/);
  });
  it("labels driver semantics as proposed and de-duplicated", () => {
    expect(ACTIVE_DRIVER_DEFINITION).toMatch(/unique driver/);
    expect(ACTIVE_DRIVER_DEFINITION).toMatch(/counted once/);
    expect(ACTIVE_DRIVER_DEFINITION).toMatch(/backend-gated/);
  });
  it("calculates Demo North and applies the cap", () => {
    expect(calculateCoreMonthlyPrice(24, 146)).toEqual({
      connectorChargeIsk: 4800, driverChargeIsk: 7300, uncappedIsk: 12100,
      capIsk: 10800, totalIsk: 10800, capApplied: true,
    });
  });
  it("does not apply the cap below the envelope", () => {
    expect(calculateCoreMonthlyPrice(10, 8).totalIsk).toBe(2400);
    expect(calculateCoreMonthlyPrice(10, 8).capApplied).toBe(false);
  });
  it("formats Icelandic-labelled ISK without decimals", () => expect(formatIsk(10800)).toBe("10.800 kr"));
  it("rejects negative connector counts", () => expect(() => calculateCoreMonthlyPrice(-1, 2)).toThrow());
  it("rejects negative driver counts", () => expect(() => calculateCoreMonthlyPrice(1, -2)).toThrow());
  it("rejects fractional billing counts", () => expect(() => calculateCoreMonthlyPrice(1.2, 3)).toThrow());

  const scenarios = [
    [0, 0], [1, 0], [1, 1], [1, 5], [2, 2], [2, 12], [4, 8], [4, 40], [8, 14], [8, 70],
    [10, 67], [12, 93], [16, 119], [20, 41], [22, 83], [24, 146], [32, 88], [42, 74], [52, 97], [64, 204],
  ] as const;
  for (const [connectors, drivers] of scenarios) {
    it(`keeps ${connectors} connectors and ${drivers} drivers inside the cap`, () => {
      const price = calculateCoreMonthlyPrice(connectors, drivers);
      expect(price.connectorChargeIsk).toBe(connectors * 200);
      expect(price.driverChargeIsk).toBe(drivers * 50);
      expect(price.totalIsk).toBe(Math.min(price.uncappedIsk, connectors * 450));
      expect(price.totalIsk).toBeLessThanOrEqual(price.capIsk);
    });
  }
});

describe("Core organisation fixtures", () => {
  it("contains sixteen organisations", () => expect(coreOrganisations).toHaveLength(16));
  it("uses unique fixture ids", () => expect(new Set(coreOrganisations.map((org) => org.id)).size).toBe(16));
  for (const organisation of coreOrganisations) {
    it(`${organisation.id} has billable integer counts`, () => {
      expect(Number.isInteger(organisation.activeConnectors)).toBe(true);
      expect(Number.isInteger(organisation.activeDrivers)).toBe(true);
      expect(organisation.activeConnectors).toBeGreaterThan(0);
      expect(organisation.activeDrivers).toBeGreaterThanOrEqual(0);
    });
    it(`${organisation.id} has a bounded reproducible price`, () => {
      const price = calculateCoreMonthlyPrice(organisation.activeConnectors, organisation.activeDrivers);
      expect(price.totalIsk).toBeLessThanOrEqual(organisation.activeConnectors * 450);
      expect(formatIsk(price.totalIsk)).toMatch(/ kr$/);
    });
    it(`${organisation.id} remains obviously synthetic`, () => expect(organisation.name).toMatch(/^Demo /));
  }
});

describe("Core rate fixtures", () => {
  it("contains eight versioned rate configurations", () => expect(coreRateConfigurations).toHaveLength(8));
  it("uses unique rate versions", () => expect(new Set(coreRateConfigurations.map((rate) => rate.version)).size).toBe(8));
  for (const rate of coreRateConfigurations) {
    it(`${rate.version} has an explicit UTC effective date`, () => expect(rate.effectiveFrom).toMatch(/UTC$/));
    it(`${rate.version} keeps all four cost controls visible`, () => {
      expect(rate.networkRate).not.toBe("");
      expect(rate.retailerRate).not.toBe("");
      expect(rate.cpoMargin).not.toBe("");
      expect(rate.plugTimeFee).not.toBe("");
    });
    it(`${rate.version} has a grace policy`, () => expect(rate.gracePeriod).not.toBe(""));
  }
});

describe("Core billing period fixtures", () => {
  it("contains eight monthly periods", () => expect(coreBillingPeriods).toHaveLength(8));
  for (const period of coreBillingPeriods) {
    it(`${period.id} is CDR-backed`, () => expect(period.cdrCount).toBeGreaterThan(0));
    it(`${period.id} has statement material`, () => expect(period.driverStatements).toBeGreaterThan(0));
    it(`${period.id} has an explicit delivery state`, () => expect(period.delivery.length).toBeGreaterThan(5));
  }
});

describe("Driver statement variants", () => {
  it("contains 32 statement variants", () => expect(driverStatementVariants).toHaveLength(32));
  it("uses unique statement ids", () => expect(new Set(driverStatementVariants.map((statement) => statement.id)).size).toBe(32));
  for (const statement of driverStatementVariants) {
    it(`${statement.id} uses a reserved fixture identity`, () => expect(statement.driver).toMatch(/@north\.test$/));
    it(`${statement.id} contains CDR-derived usage shape`, () => {
      expect(statement.sessions).toBeGreaterThan(0);
      expect(statement.energyKwh).toBeGreaterThan(0);
      expect(statement.energyIsk).toBeGreaterThan(0);
    });
  }
});

describe("Core route screens", () => {
  it("adds four Admin, six CPO, and three Driver views", () => {
    expect(coreScreensByPersona.admin).toHaveLength(4);
    expect(coreScreensByPersona.org).toHaveLength(6);
    expect(coreScreensByPersona.driver).toHaveLength(3);
  });
  for (const routeId of ["admin", "org", "driver"] as const) {
    for (const screen of coreScreensByPersona[routeId]) {
      it(`${routeId}/${screen.id} has a complete local visual contract`, () => {
        expect(screen.metrics).toHaveLength(4);
        expect(screen.columns.length).toBeGreaterThanOrEqual(5);
        expect(screen.rows.length).toBeGreaterThanOrEqual(3);
        expect(screen.queue).toHaveLength(3);
        expect(screen.review.demo).toMatch(/local demo fixtures/i);
      });
      it(`${routeId}/${screen.id} exposes a Core detail band`, () => {
        const detail = getCoreDetail(routeId, screen.id);
        expect(detail?.items).toHaveLength(4);
        expect(detail?.summary).toMatch(/local demo fixtures/i);
      });
      it(`${routeId}/${screen.id} never claims a live payment`, () => {
        const text = JSON.stringify(screen);
        expect(text).not.toMatch(/payment complete|paid successfully|bank connected/i);
      });
    }
  }
});
