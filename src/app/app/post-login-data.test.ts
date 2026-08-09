import { describe, expect, it } from "vitest";
import { visualFamilies } from "../visual/visual-data";
import {
  getPostLoginFamily,
  getPostLoginPersona,
  getPostLoginScreen,
  postLoginHref,
  postLoginPersonas,
} from "./post-login-data";

describe("post-login persona model", () => {
  it("offers exactly the three launch-review personas", () => {
    expect(postLoginPersonas.map((persona) => persona.routeId)).toEqual(["admin", "org", "driver"]);
  });

  it("keeps Service outside launch routes", () => {
    expect(postLoginPersonas.map((persona) => String(persona.familyId))).not.toContain("service");
  });

  it("uses reserved demo identities", () => {
    for (const persona of postLoginPersonas) expect(persona.account).toMatch(/\.test$/);
  });

  it("defines a visible scope boundary for every persona", () => {
    for (const persona of postLoginPersonas) expect(persona.boundary.length).toBeGreaterThan(60);
  });

  it("resolves every route to its intended visual family", () => {
    expect(getPostLoginPersona("admin")?.familyId).toBe("admin");
    expect(getPostLoginPersona("org")?.familyId).toBe("organisation");
    expect(getPostLoginPersona("driver")?.familyId).toBe("driver");
  });

  it("rejects unknown and future route identities", () => {
    expect(getPostLoginPersona("service")).toBeUndefined();
    expect(getPostLoginPersona("operator")).toBeUndefined();
  });

  for (const persona of postLoginPersonas) {
    describe(persona.label, () => {
      const family = getPostLoginFamily(persona);

      it("has a valid default screen", () => {
        expect(getPostLoginScreen(family)?.id).toBe(persona.defaultScreen);
      });

      it("builds a local application href", () => {
        expect(postLoginHref(persona)).toBe(`/app/${persona.routeId}/${persona.defaultScreen}`);
      });

      it("exposes every family screen through navigation", () => {
        for (const screen of family.screens) expect(getPostLoginScreen(family, screen.id)).toBe(screen);
      });

      it("does not resolve unknown screens", () => {
        expect(getPostLoginScreen(family, "not-a-screen")).toBeUndefined();
      });
    });
  }

  it("never represents zero as measured power", () => {
    const routeFamilies = visualFamilies.filter((family) => family.id !== "service");
    const text = routeFamilies.flatMap((family) => family.screens).flatMap((screen) => [
      ...screen.metrics.flatMap((metric) => [metric.label, metric.value, metric.detail]),
      ...screen.rows.flat(),
    ]).join(" ");
    expect(text).not.toMatch(/0(?:\.0)?\s*kW/i);
  });

  it("keeps agreement cost assignment disabled", () => {
    const organisation = visualFamilies.find((family) => family.id === "organisation")!;
    const agreement = organisation.screens.find((screen) => screen.id === "agreements")!;
    expect(agreement.action).toBe("Assign cost factor");
    expect(agreement.actionDisabled).toBe(true);
    expect(agreement.state).toBe("Read only");
  });

  it("keeps unsafe organisation invitations disabled", () => {
    const organisation = visualFamilies.find((family) => family.id === "organisation")!;
    const onboarding = organisation.screens.find((screen) => screen.id === "onboarding")!;
    expect(onboarding.actionDisabled).toBe(true);
    expect(onboarding.notice).toMatch(/No demo action submits/i);
  });

  it("keeps installation-code completion unavailable", () => {
    const driver = visualFamilies.find((family) => family.id === "driver")!;
    const installation = driver.screens.find((screen) => screen.id === "installation")!;
    expect(installation.actionDisabled).toBe(true);
    expect(installation.state).toBe("Unavailable");
    expect(installation.notice).toMatch(/cannot submit/i);
  });
});
