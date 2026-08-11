import { describe, expect, it } from "vitest";
import {
  getPostLoginFamily,
  getPostLoginNavigationSections,
  postLoginPersonas,
} from "./post-login-data";
import { getMarketRouteContract } from "./market-route-contract";

const contracts = postLoginPersonas.flatMap((persona) => {
  const family = getPostLoginFamily(persona);
  const sections = getPostLoginNavigationSections(persona, family);
  return sections.flatMap((section) =>
    section.screenIds.map((id) => {
      const screen = family.screens.find((item) => item.id === id)!;
      return getMarketRouteContract(persona.routeId, screen, section.label);
    }),
  );
});

describe("market Core route contract", () => {
  it("covers all launch-review routes exactly once", () => {
    expect(contracts).toHaveLength(79);
    expect(new Set(contracts.map((contract) => contract.route)).size).toBe(79);
  });

  it("contains only Admin, Organisation and Driver personas", () => {
    expect(new Set(contracts.map((contract) => contract.persona))).toEqual(
      new Set(["admin", "org", "driver"]),
    );
    expect(
      contracts.some((contract) => contract.route.includes("service")),
    ).toBe(false);
  });

  it("labels every route as a local fixture", () => {
    for (const contract of contracts) {
      expect(contract.dataTruth).toBe("local-fixture");
      expect(contract.dataTruthLabel).toBe("Local fixture");
    }
  });

  it("never exposes an enabled visual command", () => {
    for (const contract of contracts) {
      expect(["read-only", "visual-action-disabled"]).toContain(
        contract.interaction,
      );
      if (contract.interaction === "visual-action-disabled") {
        expect(contract.interactionLabel).toBe("Action unavailable");
        expect(contract.backendDependency).toMatch(
          /permission.*persistence.*audit/i,
        );
      }
    }
  });

  it("classifies integration routes as review evidence", () => {
    const integration = contracts.filter((contract) =>
      contract.route.includes("/integration-"),
    );
    expect(integration.length).toBeGreaterThan(10);
    for (const contract of integration) {
      expect(contract.classification).toBe("evidence");
      expect(contract.honestyRisk).toBe("runtime-proof");
    }
  });

  it("keeps future decisions separate from Core", () => {
    expect(
      contracts.find((contract) => contract.route.endsWith("/compliance-later"))
        ?.classification,
    ).toBe("future");
    expect(
      contracts.find((contract) => contract.route.endsWith("/installation"))
        ?.classification,
    ).toBe("future");
  });

  it("does not confuse a blocked Core command with product classification", () => {
    expect(contracts.find((contract) => contract.route.endsWith("/monthly-statement"))?.classification).toBe("core");
    expect(contracts.find((contract) => contract.route.endsWith("/billing-material"))?.classification).toBe("core");
    expect(contracts.find((contract) => contract.route.endsWith("/rates"))?.classification).toBe("core");
  });

  it("makes money, telemetry, identity and delivery risks explicit", () => {
    const risks = new Set(contracts.map((contract) => contract.honestyRisk));
    expect(risks).toEqual(
      new Set([
        "money",
        "telemetry",
        "identity-access",
        "delivery",
        "runtime-proof",
      ]),
    );
  });

  it("contains no 0 kW claim in contract notes", () => {
    expect(JSON.stringify(contracts)).not.toMatch(/0(?:\.0)?\s*kW/i);
  });
});
