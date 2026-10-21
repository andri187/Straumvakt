import {
  visualFamilies,
  type VisualFamily,
  type VisualScreen,
} from "../visual/visual-data";
import { coreScreensByPersona } from "./core-product-data";
import type { PostLoginRouteId } from "./post-login-types";

export type { PostLoginRouteId } from "./post-login-types";

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

export type PostLoginNavigationSection = {
  id: string;
  label: string;
  screenIds: string[];
  collapsed?: boolean;
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
    boundary:
      "Global operations are visible. Tenant mutation, impersonation and cloud controls are not.",
  },
  {
    routeId: "org",
    familyId: "organisation",
    label: "Organisation / CPO",
    contextLabel: "Organisation",
    contextValue: "Demo North Energy",
    account: "ops@north.test",
    defaultScreen: "overview",
    boundary:
      "Only this demo organisation is visible. Platform administration and other tenants are absent.",
  },
  {
    routeId: "driver",
    familyId: "driver",
    label: "Driver",
    contextLabel: "Personal context",
    contextValue: "Registered, no access",
    account: "demo-driver@straumvakt.test",
    defaultScreen: "no-access",
    boundary:
      "Only personal access and charging information is visible. Organisation controls are absent.",
  },
];

export function getPostLoginPersona(
  routeId: string,
): PostLoginPersona | undefined {
  return postLoginPersonas.find((persona) => persona.routeId === routeId);
}

export function getPostLoginFamily(persona: PostLoginPersona): VisualFamily {
  const family = visualFamilies.find((item) => item.id === persona.familyId)!;
  return {
    ...family,
    screens: [...family.screens, ...coreScreensByPersona[persona.routeId]],
  };
}

export function getPostLoginScreen(
  family: VisualFamily,
  requestedScreen?: string,
): VisualScreen | undefined {
  const screenId =
    requestedScreen ??
    postLoginPersonas.find((persona) => persona.familyId === family.id)
      ?.defaultScreen;
  return family.screens.find((screen) => screen.id === screenId);
}

export function postLoginHref(
  persona: PostLoginPersona,
  screenId?: string,
): string {
  return `/app/${persona.routeId}/${screenId ?? persona.defaultScreen}`;
}

const navigationSections: Record<
  PostLoginRouteId,
  PostLoginNavigationSection[]
> = {
  admin: [
    {
      id: "operate",
      label: "Operate",
      screenIds: ["overview", "organisations", "fleet", "tasks"],
    },
    {
      id: "commercial",
      label: "Core commercial",
      screenIds: ["core-product", "core-pricing", "standard-telemetry"],
    },
    {
      id: "readiness",
      label: "Readiness",
      screenIds: [
        "support",
        "risks",
        "activity",
        "readiness",
        "core-readiness",
        "billing-trust",
      ],
    },
    {
      id: "evidence",
      label: "Verification evidence",
      screenIds: [],
      collapsed: true,
    },
  ],
  org: [
    {
      id: "operate",
      label: "Operate",
      screenIds: [
        "overview",
        "chargers",
        "sites",
        "drivers",
        "access",
        "sessions",
      ],
    },
    {
      id: "commercial",
      label: "Pricing and billing",
      screenIds: [
        "agreements",
        "core-pricing",
        "rates",
        "billing-material",
        "delivery-log",
        "monthly-reporting",
      ],
    },
    {
      id: "setup",
      label: "Access and setup",
      screenIds: ["access-groups", "settings", "onboarding"],
    },
    {
      id: "evidence",
      label: "Readiness and evidence",
      screenIds: [],
      collapsed: true,
    },
  ],
  driver: [
    {
      id: "charge",
      label: "Charging",
      screenIds: [
        "no-access",
        "access",
        "installation",
        "chargers",
        "active",
        "history",
      ],
    },
    {
      id: "statement",
      label: "Costs and statements",
      screenIds: ["monthly-statement", "cost-trust", "report-ready"],
    },
    {
      id: "account",
      label: "Account",
      screenIds: ["guest", "account", "help"],
    },
    {
      id: "evidence",
      label: "Statement and support states",
      screenIds: [],
      collapsed: true,
    },
  ],
};

export function getPostLoginNavigationSections(
  persona: PostLoginPersona,
  family: VisualFamily,
): PostLoginNavigationSection[] {
  const configured = navigationSections[persona.routeId];
  const knownIds = new Set(family.screens.map((screen) => screen.id));
  const assigned = new Set(configured.flatMap((section) => section.screenIds));

  return configured
    .map((section) => ({
      ...section,
      screenIds:
        section.screenIds.length > 0
          ? section.screenIds.filter((id) => knownIds.has(id))
          : family.screens
              .filter((screen) => !assigned.has(screen.id))
              .map((screen) => screen.id),
    }))
    .filter((section) => section.screenIds.length > 0);
}
