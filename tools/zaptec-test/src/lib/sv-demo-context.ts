// Demo Straumvakt context. In production, CPO + ChargerHost come from the
// Prisma tables (tenancy.organizations + hosts.charger_hosts). This scratch
// workspace has no DB, so we hard-assign plausible values per Zaptec
// installation ID and mark the source as "demo" in the UI.

export type DemoCpo = {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
};

export type DemoChargerHost = {
  id: string;
  displayName: string;
  type: "standard" | "workplace" | "mdu" | "hotel" | "fleet" | "retail";
  // what the tenant tells drivers about this host
  tagline?: string;
  supportEmail?: string;
  supportPhone?: string;
};

export const DEMO_CPO: DemoCpo = {
  id: "demo-org-straumvakt",
  slug: "straumvakt",
  displayName: "Straumvakt",
  countryCode: "IS",
};

// Keyed by Zaptec installation Id (the UUIDs we see from /api/installation).
// Fallback below handles unknown installations so the UI never empties.
export const DEMO_CHARGER_HOSTS_BY_INSTALLATION: Record<string, DemoChargerHost> = {
  "7d722149-3c5f-4488-8bf2-e660503e11e9": {
    id: "demo-host-dalvegur",
    displayName: "Dalvegur húsfélag",
    type: "mdu",
    tagline: "Residents-only charging at Dalvegur 10–14",
    supportEmail: "stjorn@dalvegur.is",
    supportPhone: "+354 555 0100",
  },
  "fccccfac-b2c5-4273-9fd9-1e4ca64de8d6": {
    id: "demo-host-dalvegur-legacy",
    displayName: "Dalvegur húsfélag",
    type: "mdu",
    tagline: "Guest parking charger",
    supportEmail: "stjorn@dalvegur.is",
    supportPhone: "+354 555 0100",
  },
};

const FALLBACK_HOST: DemoChargerHost = {
  id: "demo-host-unassigned",
  displayName: "Pending Straumvakt onboarding",
  type: "standard",
  tagline: "Charger host not yet mapped in Straumvakt",
};

export function hostForInstallation(
  installationId: string | undefined,
): DemoChargerHost {
  if (!installationId) return FALLBACK_HOST;
  return DEMO_CHARGER_HOSTS_BY_INSTALLATION[installationId] ?? FALLBACK_HOST;
}

// Friendly label for ChargerHost type (matches prisma enum hosts.HostType)
export function hostTypeLabel(t: DemoChargerHost["type"]): string {
  switch (t) {
    case "workplace":
      return "Workplace";
    case "mdu":
      return "Residential (MDU)";
    case "hotel":
      return "Hotel";
    case "fleet":
      return "Fleet";
    case "retail":
      return "Retail";
    default:
      return "Standard";
  }
}
