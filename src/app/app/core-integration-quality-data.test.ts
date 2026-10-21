import { describe, expect, it } from "vitest";
import { integrationBillingVariants, integrationScreensByPersona } from "./core-integration-quality-data";

describe("marathon billing integration fixtures", () => {
  it("adds eighty integration variants", () => expect(integrationBillingVariants).toHaveLength(80));
  it("uses unique fixture ids", () => expect(new Set(integrationBillingVariants.map((item) => item.id)).size).toBe(80));
  it("covers ten billing states", () => expect(new Set(integrationBillingVariants.map((item) => item.state)).size).toBe(10));
  for (const fixture of integrationBillingVariants) {
    it(`${fixture.id} remains a reserved demo identity`, () => expect(fixture.driver).toMatch(/^demo-integration-\d{2}@north\.test$/));
    it(`${fixture.id} carries explicit kWh provenance`, () => {
      expect(["Meter delta", "Per-session evidence held", "Unlabelled"]).toContain(fixture.kwhSource);
      if (fixture.kwhSource !== "Meter delta") expect(fixture.energyKwh).toBeNull();
      else expect(fixture.energyKwh).toBeGreaterThan(0);
    });
    it(`${fixture.id} carries explicit CDR status`, () => {
      expect(["Verified", "Pending", "Mismatch", "Unlabelled", "Corrected"]).toContain(fixture.cdrStatus);
      if (fixture.state === "CDR mismatch") expect(fixture.cdrStatus).toBe("Mismatch");
      if (fixture.state === "Provenance unlabelled") expect(fixture.cdrStatus).toBe("Unlabelled");
    });
    it(`${fixture.id} preserves rate and grace semantics`, () => {
      expect(fixture.rateVersion).toMatch(/^ISK-2026\.\d{2}-[A-D]$/);
      expect([0, 180, 240]).toContain(fixture.plugTimeGraceMinutes);
    });
    it(`${fixture.id} makes active-driver billing status explicit`, () => {
      expect(["Counted once", "Inactive", "Decision pending"]).toContain(fixture.accessBillingStatus);
    });
    it(`${fixture.id} never infers delivery from finality`, () => {
      expect(["Not ready", "Ready", "Logged", "Failed"]).toContain(fixture.deliveryStatus);
      if (fixture.state === "Delivery failed") expect(fixture.deliveryStatus).toBe("Failed");
    });
  }
});

describe("Admin and CPO integration risks", () => {
  const screens = [...integrationScreensByPersona.admin, ...integrationScreensByPersona.org];
  it("adds ten route states", () => expect(screens).toHaveLength(10));
  it("splits five Admin and five CPO states", () => {
    expect(integrationScreensByPersona.admin).toHaveLength(5);
    expect(integrationScreensByPersona.org).toHaveLength(5);
  });
  for (const screen of screens) {
    it(`${screen.id} has four readiness metrics`, () => expect(screen.metrics).toHaveLength(4));
    it(`${screen.id} has no enabled mutation`, () => expect(screen.action ? screen.actionDisabled : true).toBe(true));
    it(`${screen.id} keeps local provenance`, () => expect(screen.review.demo).toMatch(/local demo fixtures/i));
    it(`${screen.id} avoids false runtime proof`, () => expect(JSON.stringify(screen)).not.toMatch(/deployed and verified|permission granted|queue healthy|export supported/i));
    it(`${screen.id} has three evidence rows`, () => expect(screen.rows).toHaveLength(3));
    it(`${screen.id} has three integration checks`, () => expect(screen.queue).toHaveLength(3));
  }
});

describe("Driver integration states", () => {
  it("adds twelve Driver states", () => expect(integrationScreensByPersona.driver).toHaveLength(12));
  it("uses unique Driver route ids", () => expect(new Set(integrationScreensByPersona.driver.map((screen) => screen.id)).size).toBe(12));
  for (const screen of integrationScreensByPersona.driver) {
    it(`driver/${screen.id} has four statement or access metrics`, () => expect(screen.metrics).toHaveLength(4));
    it(`driver/${screen.id} has explicit boundary copy`, () => expect(screen.notice?.length).toBeGreaterThan(45));
    it(`driver/${screen.id} never claims payment or invoice issue`, () => expect(JSON.stringify(screen)).not.toMatch(/payment complete|invoice issued|paid successfully/i));
    it(`driver/${screen.id} has a review decision`, () => expect(screen.review.decision).toMatch(/Approve the contract/i));
    it(`driver/${screen.id} uses source-shaped local fixtures`, () => expect(screen.review.demo).toMatch(/integration.*local demo fixtures/i));
  }
});
