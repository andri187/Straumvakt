import { describe, expect, it } from "vitest";
import { backendContractScreensByPersona, billingTrustStatementVariants } from "./core-backend-contract-data";

describe("billing trust fixtures", () => {
  it("adds fifty statement variants beyond the original fixture set", () => {
    expect(billingTrustStatementVariants).toHaveLength(50);
  });
  it("uses unique reserved fixture ids", () => {
    expect(new Set(billingTrustStatementVariants.map((item) => item.id)).size).toBe(50);
  });
  it("covers every required trust state", () => {
    expect(new Set(billingTrustStatementVariants.map((item) => item.state))).toEqual(new Set([
      "Statement final", "Statement draft", "Meter verification held", "CDR authority pending", "CDR corrected",
      "Adjustment present", "Export ready", "Export blocked", "Delivery logged", "Delivery failed",
    ]));
  });

  for (const fixture of billingTrustStatementVariants) {
    it(`${fixture.id} is an isolated demo identity`, () => {
      expect(fixture.driver).toMatch(/^demo-trust-\d{2}@north\.test$/);
    });
    it(`${fixture.id} carries explicit meter authority`, () => {
      expect(["Verified meter delta", "Verification held", "Unavailable"]).toContain(fixture.energyAuthority);
      if (fixture.energyAuthority === "Verified meter delta") {
        expect(fixture.meterStart).not.toBeNull();
        expect(fixture.meterStop).not.toBeNull();
        expect(fixture.energyKwh).toBe((fixture.meterStop ?? 0) - (fixture.meterStart ?? 0));
      } else {
        expect(fixture.energyKwh).toBeNull();
      }
    });
    it(`${fixture.id} carries explicit CDR authority`, () => {
      expect(["Verified CDR", "Pending source check", "Corrected CDR"]).toContain(fixture.cdrAuthority);
      if (fixture.state === "CDR authority pending") expect(fixture.cdrAuthority).toBe("Pending source check");
      if (fixture.state === "CDR corrected") expect(fixture.cdrAuthority).toBe("Corrected CDR");
    });
    it(`${fixture.id} preserves an immutable-looking rate version`, () => {
      expect(fixture.rateVersion).toMatch(/^ISK-2026\.\d{2}-[A-D]$/);
      expect(fixture.sessions).toBeGreaterThan(0);
    });
    it(`${fixture.id} uses additive adjustments only for correction states`, () => {
      if (fixture.adjustmentIsk !== 0) expect(["Adjustment present", "CDR corrected"]).toContain(fixture.state);
      expect(Number.isInteger(fixture.adjustmentIsk)).toBe(true);
    });
  }
});

describe("Driver trust route states", () => {
  it("adds ten distinct Driver statement states", () => {
    expect(backendContractScreensByPersona.driver).toHaveLength(10);
    expect(new Set(backendContractScreensByPersona.driver.map((screen) => screen.id)).size).toBe(10);
  });
  for (const screen of backendContractScreensByPersona.driver) {
    it(`driver/${screen.id} has four trust measures`, () => expect(screen.metrics).toHaveLength(4));
    it(`driver/${screen.id} has evidence rows and queue`, () => {
      expect(screen.rows).toHaveLength(3);
      expect(screen.queue).toHaveLength(3);
    });
    it(`driver/${screen.id} declares local fixture provenance`, () => {
      expect(screen.review.demo).toMatch(/local demo fixtures/i);
    });
    it(`driver/${screen.id} does not claim payment or invoice completion`, () => {
      expect(JSON.stringify(screen)).not.toMatch(/payment complete|invoice issued|bank connected|paid successfully/i);
    });
  }
});

describe("Admin and CPO readiness states", () => {
  const operational = [...backendContractScreensByPersona.admin, ...backendContractScreensByPersona.org];
  it("adds eight operational gate views", () => expect(operational).toHaveLength(8));
  it("keeps the persona split explicit", () => {
    expect(backendContractScreensByPersona.admin).toHaveLength(4);
    expect(backendContractScreensByPersona.org).toHaveLength(4);
  });
  for (const screen of operational) {
    it(`${screen.id} has four readiness measures`, () => expect(screen.metrics).toHaveLength(4));
    it(`${screen.id} has a backend boundary notice`, () => expect(screen.notice?.length).toBeGreaterThan(35));
    it(`${screen.id} has no enabled mutation action`, () => {
      expect(screen.action ? screen.actionDisabled : true).toBe(true);
    });
    it(`${screen.id} keeps its decision explicit`, () => expect(screen.review.decision).toMatch(/Approve the evidence contract/i));
    it(`${screen.id} avoids false readiness language`, () => {
      expect(JSON.stringify(screen)).not.toMatch(/fully implemented|production ready|bank supported|permission granted/i);
    });
  }
});
