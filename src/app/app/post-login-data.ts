import { visualFamilies, type VisualFamily, type VisualScreen } from "../visual/visual-data";
import { coreScreensByPersona } from "./core-product-data";

export type PostLoginRouteId = "admin" | "org" | "driver";

export type PostLoginPersona = {
  routeId: PostLoginRouteId;
  familyId: Extract<VisualFamily["id"], "admin" | "organisation" | "driver">;
  label: string;
  contextLabel: string;
  contextValue: string;
  account: string;
  defaultScreen: string;
  boundary: string;
};

export const postLoginPersonas: PostLoginPersona[] = [
  {
    routeId: "admin",
    familyId: "admin",
    label: "Straumvakt Admin",
    contextLabel: "Platform scope",
    contextValue: "All demo organisations",
    account: "demo-staff@straumvakt.test",
    defaultScreen: "overview",
    boundary: "Global operations are visible. Tenant mutation, impersonation and cloud controls are not.",
  },
  {
    routeId: "org",
    familyId: "organisation",
    label: "Organisation / CPO",
    contextLabel: "Organisation",
    contextValue: "Demo North Energy",
    account: "ops@north.test",
    defaultScreen: "overview",
    boundary: "Only this demo organisation is visible. Platform administration and other tenants are absent.",
  },
  {
    routeId: "driver",
    familyId: "driver",
    label: "Driver",
    contextLabel: "Personal context",
    contextValue: "Registered, no access",
    account: "demo-driver@straumvakt.test",
    defaultScreen: "no-access",
    boundary: "Only personal access and charging information is visible. Organisation controls are absent.",
  },
];

export function getPostLoginPersona(routeId: string): PostLoginPersona | undefined {
  return postLoginPersonas.find((persona) => persona.routeId === routeId);
}

export function getPostLoginFamily(persona: PostLoginPersona): VisualFamily {
  const family = visualFamilies.find((item) => item.id === persona.familyId)!;
  return { ...family, screens: [...family.screens, ...coreScreensByPersona[persona.routeId]] };
}

export function getPostLoginScreen(
  family: VisualFamily,
  requestedScreen?: string,
): VisualScreen | undefined {
  const screenId = requestedScreen ?? postLoginPersonas.find((persona) => persona.familyId === family.id)?.defaultScreen;
  return family.screens.find((screen) => screen.id === screenId);
}

export function postLoginHref(persona: PostLoginPersona, screenId?: string): string {
  return `/app/${persona.routeId}/${screenId ?? persona.defaultScreen}`;
}
