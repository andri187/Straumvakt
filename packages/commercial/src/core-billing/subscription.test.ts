// Core subscription pricing — the contract.
//
// The frame is locked, so these tests are the specification: 200 kr per
// active connector, 50 kr per active driver, capped at 450 kr per connector.
// Every expected value below is hand-computed in the comment beside it, so a
// failure tells you which arithmetic changed rather than just that a number
// moved.

import { describe, expect, it } from "vitest";
import {
  computeCoreSubscription,
  driversUntilCapBinds,
  effectivePricePerConnectorMinor,
  CORE_CONNECTOR_PRICE_MINOR,
  CORE_DRIVER_PRICE_MINOR,
  CORE_CONNECTOR_CAP_MINOR,
  CORE_CAP_BREAKEVEN_DRIVERS_PER_CONNECTOR,
} from "./subscription";

const kr = (n: number) => BigInt(n) * 100n;

describe("Core price constants", () => {
  it("are the locked frame, in minor units", () => {
    expect(CORE_CONNECTOR_PRICE_MINOR).toBe(kr(200));
    expect(CORE_DRIVER_PRICE_MINOR).toBe(kr(50));
    expect(CORE_CONNECTOR_CAP_MINOR).toBe(kr(450));
  });

  it("breakeven is (450-200)/50 = 5 drivers per connector", () => {
    expect(CORE_CAP_BREAKEVEN_DRIVERS_PER_CONNECTOR).toBe(5);
    expect(
      (CORE_CONNECTOR_CAP_MINOR - CORE_CONNECTOR_PRICE_MINOR) /
        CORE_DRIVER_PRICE_MINOR,
    ).toBe(5n);
  });

  it("every constant is a whole number of krónur", () => {
    for (const c of [
      CORE_CONNECTOR_PRICE_MINOR,
      CORE_DRIVER_PRICE_MINOR,
      CORE_CONNECTOR_CAP_MINOR,
    ]) {
      expect(c % 100n).toBe(0n);
    }
  });
});

describe("computeCoreSubscription — uncapped", () => {
  it("one connector, no drivers = 200 kr", () => {
    const r = computeCoreSubscription({ activeConnectors: 1, activeDrivers: 0 });
    expect(r.subtotalExVatMinor).toBe(kr(200));
    expect(r.capApplied).toBe(false);
    expect(r.lineItems).toHaveLength(1);
  });

  it("one connector, one driver = 250 kr", () => {
    // 200 + 50
    const r = computeCoreSubscription({ activeConnectors: 1, activeDrivers: 1 });
    expect(r.subtotalExVatMinor).toBe(kr(250));
    expect(r.capApplied).toBe(false);
  });

  it("a 20-space MDU with 25 drivers = 5,250 kr", () => {
    // 20×200 + 25×50 = 4000 + 1250. Cap is 20×450 = 9000, far above.
    const r = computeCoreSubscription({ activeConnectors: 20, activeDrivers: 25 });
    expect(r.uncappedSubtotalMinor).toBe(kr(5250));
    expect(r.subtotalExVatMinor).toBe(kr(5250));
    expect(r.capApplied).toBe(false);
  });

  it("splits the total into connector and driver components", () => {
    const r = computeCoreSubscription({ activeConnectors: 3, activeDrivers: 4 });
    expect(r.connectorComponentMinor).toBe(kr(600)); // 3×200
    expect(r.driverComponentMinor).toBe(kr(200)); // 4×50
    expect(r.uncappedSubtotalMinor).toBe(kr(800));
  });
});

describe("computeCoreSubscription — the cap", () => {
  it("does NOT bind at exactly 5 drivers per connector", () => {
    // 200 + 5×50 = 450, exactly the cap. Equal is not "reduced".
    const r = computeCoreSubscription({ activeConnectors: 1, activeDrivers: 5 });
    expect(r.uncappedSubtotalMinor).toBe(kr(450));
    expect(r.capMinor).toBe(kr(450));
    expect(r.capApplied).toBe(false);
    expect(r.capReliefMinor).toBe(0n);
    expect(r.subtotalExVatMinor).toBe(kr(450));
  });

  it("binds at 6 drivers on one connector", () => {
    // 200 + 300 = 500, capped to 450, relief 50.
    const r = computeCoreSubscription({ activeConnectors: 1, activeDrivers: 6 });
    expect(r.uncappedSubtotalMinor).toBe(kr(500));
    expect(r.capApplied).toBe(true);
    expect(r.capReliefMinor).toBe(kr(50));
    expect(r.subtotalExVatMinor).toBe(kr(450));
  });

  it("a shared workplace charger with 40 drivers is capped hard", () => {
    // 2 connectors, 40 drivers: 400 + 2000 = 2400 uncapped; cap 900.
    const r = computeCoreSubscription({ activeConnectors: 2, activeDrivers: 40 });
    expect(r.uncappedSubtotalMinor).toBe(kr(2400));
    expect(r.capMinor).toBe(kr(900));
    expect(r.subtotalExVatMinor).toBe(kr(900));
    expect(r.capReliefMinor).toBe(kr(1500));
  });

  it("emits the cap as a visible negative line, not a silent reduction", () => {
    const r = computeCoreSubscription({ activeConnectors: 1, activeDrivers: 10 });
    const relief = r.lineItems.find((l) => l.kind === "connector_cap_relief");
    expect(relief).toBeDefined();
    expect(relief!.amountMinor).toBeLessThan(0n);
    // Lines must sum to the subtotal — the invariant that makes the
    // breakdown printable on a statement.
    const sum = r.lineItems.reduce((a, l) => a + l.amountMinor, 0n);
    expect(sum).toBe(r.subtotalExVatMinor);
  });

  it("line items always sum to the subtotal, capped or not", () => {
    for (const c of [0, 1, 3, 20, 137]) {
      for (const d of [0, 1, 5, 6, 100]) {
        const r = computeCoreSubscription({ activeConnectors: c, activeDrivers: d });
        const sum = r.lineItems.reduce((a, l) => a + l.amountMinor, 0n);
        expect(sum).toBe(r.subtotalExVatMinor);
      }
    }
  });

  it("the total never exceeds 450 kr per connector, for any driver count", () => {
    for (const c of [1, 2, 7, 50]) {
      for (const d of [0, 1, 5, 6, 50, 5000]) {
        const r = computeCoreSubscription({ activeConnectors: c, activeDrivers: d });
        expect(r.subtotalExVatMinor).toBeLessThanOrEqual(BigInt(c) * kr(450));
      }
    }
  });

  it("the total is never below 200 kr per connector", () => {
    // The connector component alone is a floor, since the cap (450) is
    // above the per-connector price (200) and drivers only add.
    for (const c of [1, 4, 30]) {
      for (const d of [0, 3, 999]) {
        const r = computeCoreSubscription({ activeConnectors: c, activeDrivers: d });
        expect(r.subtotalExVatMinor).toBeGreaterThanOrEqual(BigInt(c) * kr(200));
      }
    }
  });
});

describe("computeCoreSubscription — degenerate and edge cases", () => {
  // A real product question, not a rounding detail. With zero connectors the
  // cap is zero, so drivers alone bill nothing. Pinned so that changing it
  // is a deliberate act.
  it("zero connectors bills nothing even with many drivers (cap = 0)", () => {
    const r = computeCoreSubscription({ activeConnectors: 0, activeDrivers: 40 });
    expect(r.uncappedSubtotalMinor).toBe(kr(2000));
    expect(r.capMinor).toBe(0n);
    expect(r.capApplied).toBe(true);
    expect(r.subtotalExVatMinor).toBe(0n);
  });

  it("an empty organisation bills nothing and emits no lines", () => {
    const r = computeCoreSubscription({ activeConnectors: 0, activeDrivers: 0 });
    expect(r.subtotalExVatMinor).toBe(0n);
    expect(r.lineItems).toHaveLength(0);
    expect(r.capApplied).toBe(false);
  });

  it("omits a zero-quantity line rather than printing 0 kr", () => {
    const r = computeCoreSubscription({ activeConnectors: 4, activeDrivers: 0 });
    expect(r.lineItems.map((l) => l.kind)).toEqual(["connector_subscription"]);
  });

  it("stays exact at a scale BigInt is needed for", () => {
    // 1,000,000 connectors — well past any real fleet, but the point is
    // that the arithmetic is integer and cannot drift.
    const r = computeCoreSubscription({
      activeConnectors: 1_000_000,
      activeDrivers: 10_000_000,
    });
    expect(r.uncappedSubtotalMinor).toBe(kr(200_000_000) + kr(500_000_000));
    expect(r.subtotalExVatMinor).toBe(kr(450_000_000));
  });

  it("rejects negative, fractional and non-finite counts", () => {
    expect(() => computeCoreSubscription({ activeConnectors: -1, activeDrivers: 0 }))
      .toThrow(/active_connectors_must_be_nonneg_integer/);
    expect(() => computeCoreSubscription({ activeConnectors: 0, activeDrivers: -3 }))
      .toThrow(/active_drivers_must_be_nonneg_integer/);
    expect(() => computeCoreSubscription({ activeConnectors: 1.5, activeDrivers: 0 }))
      .toThrow(/must_be_nonneg_integer/);
    expect(() => computeCoreSubscription({ activeConnectors: NaN, activeDrivers: 0 }))
      .toThrow(/must_be_nonneg_integer/);
    expect(() => computeCoreSubscription({ activeConnectors: 1, activeDrivers: Infinity }))
      .toThrow(/must_be_nonneg_integer/);
  });

  it("produces no fractional krónur — every amount is a whole króna", () => {
    for (const c of [1, 7, 23]) {
      for (const d of [0, 1, 13, 60]) {
        const r = computeCoreSubscription({ activeConnectors: c, activeDrivers: d });
        expect(r.subtotalExVatMinor % 100n).toBe(0n);
      }
    }
  });
});

describe("driversUntilCapBinds", () => {
  it("is 5 for one connector with no drivers", () => {
    expect(driversUntilCapBinds(1, 0)).toBe(5);
  });

  it("counts down as drivers are added", () => {
    expect(driversUntilCapBinds(1, 3)).toBe(2);
    expect(driversUntilCapBinds(1, 5)).toBe(0);
  });

  it("is 0 once the cap already binds", () => {
    expect(driversUntilCapBinds(1, 9)).toBe(0);
    expect(driversUntilCapBinds(2, 100)).toBe(0);
  });

  it("scales with connectors", () => {
    expect(driversUntilCapBinds(10, 0)).toBe(50);
    expect(driversUntilCapBinds(10, 20)).toBe(30);
  });

  it("agrees with computeCoreSubscription at the boundary it reports", () => {
    for (const c of [1, 3, 12]) {
      const headroom = driversUntilCapBinds(c, 0);
      const at = computeCoreSubscription({ activeConnectors: c, activeDrivers: headroom });
      const past = computeCoreSubscription({ activeConnectors: c, activeDrivers: headroom + 1 });
      expect(at.capApplied).toBe(false);
      expect(past.capApplied).toBe(true);
    }
  });

  it("is 0 with no connectors", () => {
    expect(driversUntilCapBinds(0, 0)).toBe(0);
  });
});

describe("effectivePricePerConnectorMinor", () => {
  it("is 200 kr with no drivers", () => {
    const r = computeCoreSubscription({ activeConnectors: 5, activeDrivers: 0 });
    expect(effectivePricePerConnectorMinor(r)).toBe(kr(200));
  });

  it("is exactly the 450 kr ceiling when capped", () => {
    const r = computeCoreSubscription({ activeConnectors: 3, activeDrivers: 200 });
    expect(effectivePricePerConnectorMinor(r)).toBe(kr(450));
  });

  it("lands between the floor and the ceiling otherwise", () => {
    const r = computeCoreSubscription({ activeConnectors: 4, activeDrivers: 6 });
    const eff = effectivePricePerConnectorMinor(r);
    expect(eff).toBeGreaterThan(kr(200));
    expect(eff).toBeLessThan(kr(450));
  });

  it("returns 0 for an org with no connectors instead of dividing by zero", () => {
    const r = computeCoreSubscription({ activeConnectors: 0, activeDrivers: 3 });
    expect(effectivePricePerConnectorMinor(r)).toBe(0n);
  });
});
