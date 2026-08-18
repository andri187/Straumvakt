// Per-org landing template — tenant resolution + parameterisation.
//
// This is the single place the org landing pages are parameterised from.
// Everything a tenant can vary (URL slug, accent colour, logo, wordmark,
// tagline, which sections exist) lives in OrgTenantProfile; the pages under
// src/app/org/[slug]/ read it and never hard-code an organisation.
//
// Two sources feed a profile, in priority order:
//
//   1. The Organization row itself, via GET /api/admin/orgs/:orgId. Only
//      fields that actually exist on `model Organization`
//      (prisma/schema/identity.prisma) are used — displayName, legalName,
//      kennitala, kind, roles, countryCode and the free-form `branding`
//      JSONB. Nothing is invented. The `branding` shape read here is the
//      one already populated across the org table today:
//        { logo_url?: "logos/n1.png",
//          rail_class?: "cpo" | "retailer" | "dso" | "multi",
//          contacts?: { website?, email_main?, phone_main? } }
//      `logo_url` is stored relative to docs/reference/ (see
//      docs/reference/iceland-energy-parties.md); the same logo files are
//      mirrored under public/reference/, so the web path is "/reference/"
//      + logo_url.
//
//   2. TENANT_REGISTRY below — optional per-tenant overrides for the things
//      the database has no column for (a pretty URL slug, brand colour,
//      marketing tagline, section selection). Adding a second tenant means
//      adding one entry here; an org with NO entry still gets a complete,
//      working landing page off its own row, with a slug derived from its
//      display name.
//
// Organization has no slug column (it was dropped — kennitala is the
// canonical disambiguator, see the model's own comment), which is exactly
// why the slug lives in this registry rather than being read from the DB.

import type { AppLanguage } from "@/lib/i18n";

// ─────────────────────────────────────────────────────────────────────────
// Org shape — the subset of GET /api/admin/orgs/:orgId this template reads.
// Mirrors OrgSummary in packages/shared/src/domain/orgs.ts; kept local so
// the web app doesn't take a build-time dependency on apps/api.
// ─────────────────────────────────────────────────────────────────────────

export type OrgAddress = {
  street: string | null;
  postalCode: string | null;
  city: string | null;
} | null;

export type OrgContact = {
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export type OrgSummary = {
  id: string;
  displayName: string;
  countryCode: string | null;
  status: string;
  kind: string | null;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  vskNr: string | null;
  defaultCurrency: string | null;
  postalAddress: OrgAddress;
  legalAddress: OrgAddress;
  municipalityName: string | null;
  roles: string[];
  branding: unknown;
  mainContact: { id: string; displayName: string | null; email: string } | null;
  contacts: OrgContact[];
};

/** The `branding` JSONB, after defensive narrowing. */
export type OrgBranding = {
  logoUrl: string | null;
  railClass: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Template parameters
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sections the landing template knows how to render or link to. "overview"
 * is the landing page itself and is always present; "profile" is the org
 * record page. The rest are the areas the parked host console covered
 * (archive/straumvakt-org-console-2026-08-08/app/host/) and are surfaced as
 * announced-but-not-built cards until they are rebuilt on this template.
 */
export type OrgSectionKey =
  | "overview"
  | "profile"
  | "chargers"
  | "drivers"
  | "invite"
  | "sessions"
  | "agreements";

export type OrgSection = {
  key: OrgSectionKey;
  /** Relative to /org/[slug]. Empty string = the landing page itself. */
  path: string;
  built: boolean;
};

export type OrgAccent = {
  /** Solid brand colour — buttons, active states, the hero rule. */
  base: string;
  /** Readable text colour on top of `base`. */
  on: string;
  /** Low-alpha tint of `base` for washes, borders and halos. */
  soft: string;
};

export type OrgTenantProfile = {
  /** URL key: /org/{slug}. */
  slug: string;
  /** Large name in the header. Defaults to Organization.displayName. */
  wordmark: string;
  /** Web path to the org's logo, or null to fall back to a monogram. */
  logoSrc: string | null;
  /** Two-letter monogram used when there is no logo. */
  monogram: string;
  accent: OrgAccent;
  tagline: Record<AppLanguage, string>;
  sections: OrgSection[];
  /** Narrowed Organization.branding, for pages that want the raw contacts. */
  branding: OrgBranding;
};

/** What a registry entry may override. Everything is optional. */
type TenantOverride = {
  slug: string;
  /**
   * How to recognise the org. kennitala is authoritative (unique on
   * Organization); displayName is the fallback used before the full org
   * row has been fetched — /api/admin/me returns displayName but not
   * kennitala.
   *
   * Set BOTH. displayName is what lets slugForOrgName() map a URL back to
   * the right membership for someone who is host_admin of more than one
   * org, before any org row has been loaded. With kennitala alone such a
   * caller resolves to their first membership and then gets redirected to
   * its canonical slug — correct, but not the org they asked for.
   */
  match: { kennitala?: string; displayName?: string };
  wordmark?: string;
  logoSrc?: string;
  accent?: Partial<OrgAccent>;
  tagline?: Partial<Record<AppLanguage, string>>;
  /** Restrict/reorder the section list. Omit to keep the default set. */
  sections?: OrgSectionKey[];
};

// ─────────────────────────────────────────────────────────────────────────
// The registry — one entry per tenant that wants more than the defaults.
// ─────────────────────────────────────────────────────────────────────────

const TENANT_REGISTRY: TenantOverride[] = [
  {
    // N1 ehf — kt. 4110033370, kind=company, roles={cpo,site_host}.
    // First tenant on the template. Its logo and contact block come from
    // the org row's own `branding` JSONB; only the slug, brand red and
    // tagline are overridden here.
    slug: "n1",
    match: { kennitala: "4110033370", displayName: "N1 ehf" },
    accent: { base: "#E4002B", on: "#FFFFFF", soft: "rgba(228, 0, 43, 0.16)" },
    tagline: {
      is: "Hleðslunet N1 — yfirlit, ökumenn og notkun á einum stað.",
      en: "The N1 charging network — network, drivers and usage in one place.",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────

/** Straumvakt's own brand blue — the accent any tenant gets for free. */
const DEFAULT_ACCENT: OrgAccent = {
  base: "#2BB6E8",
  on: "#070B16",
  soft: "rgba(43, 182, 232, 0.16)",
};

const DEFAULT_SECTIONS: OrgSectionKey[] = [
  "overview",
  "profile",
  "chargers",
  "drivers",
  "invite",
  "sessions",
  "agreements",
];

/** Sections that have a real page today. Everything else renders as "soon". */
const BUILT_SECTIONS: ReadonlySet<OrgSectionKey> = new Set<OrgSectionKey>([
  "overview",
  "profile",
]);

const SECTION_PATHS: Record<OrgSectionKey, string> = {
  overview: "",
  profile: "/profile",
  chargers: "/chargers",
  drivers: "/drivers",
  invite: "/invite",
  sessions: "/sessions",
  agreements: "/agreements",
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * URL-safe slug from a display name. Used for any org without a registry
 * entry, so a brand-new tenant is reachable the moment it has a
 * host_admin — "Bílorka (e1)" → "bilorka-e1".
 */
export function orgSlugFromName(displayName: string): string {
  const folded = displayName
    .normalize("NFD")
    // Strip the combining marks NFD just separated out (a-acute, o-umlaut).
    .replace(/[̀-ͯ]/g, "")
    // Icelandic letters NFD does not decompose.
    .replace(/ð/gi, "d") // eth
    .replace(/þ/gi, "th") // thorn
    .replace(/æ/gi, "ae"); // ae-ligature
  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "org";
}

function monogramFor(displayName: string): string {
  const words = displayName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Defensive read of the free-form `branding` JSONB. */
export function readOrgBranding(value: unknown): OrgBranding {
  const empty: OrgBranding = {
    logoUrl: null,
    railClass: null,
    website: null,
    email: null,
    phone: null,
  };
  if (!value || typeof value !== "object") return empty;
  const b = value as Record<string, unknown>;
  const rawContacts =
    b.contacts && typeof b.contacts === "object"
      ? (b.contacts as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  return {
    logoUrl: str(b.logo_url),
    railClass: str(b.rail_class),
    website: str(rawContacts.website),
    email: str(rawContacts.email_main),
    phone: str(rawContacts.phone_main),
  };
}

/**
 * `branding.logo_url` is stored relative to docs/reference/ (the reference
 * catalogue's convention). The same files are served from public/reference/,
 * so a relative value maps onto /reference/<value>. Absolute URLs and
 * already-rooted paths are passed through.
 */
function logoWebPath(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  if (logoUrl.startsWith("/")) return logoUrl;
  return `/reference/${logoUrl}`;
}

function overrideFor(match: {
  kennitala?: string | null;
  displayName?: string | null;
}): TenantOverride | null {
  if (match.kennitala) {
    const byKt = TENANT_REGISTRY.find(
      (t) => t.match.kennitala === match.kennitala,
    );
    if (byKt) return byKt;
  }
  if (match.displayName) {
    const byName = TENANT_REGISTRY.find(
      (t) => t.match.displayName === match.displayName,
    );
    if (byName) return byName;
  }
  return null;
}

/**
 * The slug an org resolves to, computable from just its display name —
 * i.e. from what GET /api/admin/me already returns, with no second fetch.
 * Used to pick between several host_admin memberships before any org row
 * has been loaded.
 */
export function slugForOrgName(displayName: string): string {
  const override = overrideFor({ displayName });
  return override ? override.slug : orgSlugFromName(displayName);
}

/**
 * Default tagline for an org with no registry entry — built from `kind`
 * and the rail class already recorded in `branding`, so it says something
 * true rather than something generic.
 */
function defaultTagline(
  org: OrgSummary,
  branding: OrgBranding,
): Record<AppLanguage, string> {
  if (org.kind === "multi_dwelling") {
    return {
      is: "Hleðsla húsfélagsins — stöðvar, íbúar og notkun á einum stað.",
      en: "Your building's charging — stations, residents and usage in one place.",
    };
  }
  if (org.kind === "company" || branding.railClass === "cpo") {
    return {
      is: "Hleðslunetið þitt — yfirlit, ökumenn og notkun á einum stað.",
      en: "Your charging network — overview, drivers and usage in one place.",
    };
  }
  return {
    is: "Yfirlit yfir hleðslu á vegum fyrirtækisins.",
    en: "An overview of charging run by your organisation.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the full template parameters for an organisation. Every field has
 * a sensible value derived from the org row alone; the registry only
 * refines it. This is what makes the template reusable — no caller ever
 * needs to know which tenant it is rendering.
 */
export function resolveOrgTenant(org: OrgSummary): OrgTenantProfile {
  const branding = readOrgBranding(org.branding);
  const override = overrideFor({
    kennitala: org.kennitala,
    displayName: org.displayName,
  });

  const keys = override?.sections ?? DEFAULT_SECTIONS;
  const sections: OrgSection[] = keys.map((key) => ({
    key,
    path: SECTION_PATHS[key],
    built: BUILT_SECTIONS.has(key),
  }));

  return {
    slug: override?.slug ?? orgSlugFromName(org.displayName),
    wordmark: override?.wordmark ?? org.displayName,
    logoSrc: override?.logoSrc ?? logoWebPath(branding.logoUrl),
    monogram: monogramFor(org.displayName),
    accent: { ...DEFAULT_ACCENT, ...(override?.accent ?? {}) },
    tagline: {
      ...defaultTagline(org, branding),
      ...(override?.tagline ?? {}),
    },
    sections,
    branding,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Display labels — shared by the landing page and the profile page.
// ─────────────────────────────────────────────────────────────────────────

export function orgKindLabel(
  kind: string | null,
  language: AppLanguage,
): string {
  if (kind === "company") return language === "is" ? "Fyrirtæki" : "Company";
  if (kind === "multi_dwelling") {
    return language === "is" ? "Fjölbýli · Húsfélag" : "Multi-dwelling · HOA";
  }
  return language === "is" ? "Hýsill" : "Host";
}

export function orgSectionLabel(
  key: OrgSectionKey,
  language: AppLanguage,
): { title: string; blurb: string } {
  const labels: Record<
    OrgSectionKey,
    { is: [string, string]; en: [string, string] }
  > = {
    overview: {
      is: ["Yfirlit", "Staðan á hleðslunetinu í dag."],
      en: ["Overview", "How the charging network is doing today."],
    },
    profile: {
      is: ["Fyrirtækið", "Skráning, kennitala, heimilisfang og tengiliðir."],
      en: ["Organisation", "Registration, ID, address and contacts."],
    },
    chargers: {
      is: ["Hleðslustöðvar", "Allar stöðvar, tenging og staðsetning."],
      en: ["Chargers", "Every station, its connection and location."],
    },
    drivers: {
      is: ["Ökumenn", "Hverjir hafa aðgang að netinu þínu."],
      en: ["Drivers", "Who has access to your network."],
    },
    invite: {
      is: ["Bjóða ökumanni", "Senda einnota boðskóða í aðgangshóp."],
      en: ["Invite a driver", "Issue a single-use code into an access group."],
    },
    sessions: {
      is: ["Hleðslur", "Saga hleðslna, orka og staða."],
      en: ["Sessions", "Charging history, energy and status."],
    },
    agreements: {
      is: ["Samningar", "Samningar og verðskrá sem gilda um netið."],
      en: ["Agreements", "The agreements and pricing that govern the network."],
    },
  };
  const [title, blurb] = labels[key][language];
  return { title, blurb };
}
