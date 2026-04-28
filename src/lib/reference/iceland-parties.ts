import catalogue from "../../../docs/reference/iceland-energy-parties.json";

// Loader for docs/reference/iceland-energy-parties.json — read by the
// Reference > Electricity / Public Charging / Rental Service subsection
// pages. The catalogue is the single source of truth for party identity,
// kennitala, contacts, and tariff_source while a future migration seeds
// energy.parties + energy.tariff_catalogue.
//
// JSON is imported as a module so webpack bundles it into the worker —
// Cloudflare Workers have no fs.readFile of arbitrary paths and the docs/
// directory is not part of the deployed bundle.

export type IcelandRole =
  | "retailer"
  | "dso"
  | "tso"
  | "producer"
  | "public_charging"
  | "home_charging"
  | "aggregator";

export type TariffItem = {
  code: string | null;
  display_name: string;
  applies_to?: string | null;
  unit?: string | null;
  price_no_vat?: string | null;
  price_with_vat?: string | null;
  vat_pct?: number | null;
  ev_category?: string | null;
  default_visible?: boolean | null;
};

export type Party = {
  slug: string;
  trade_name: string;
  legal_name: string;
  legal_form?: string | null;
  kennitala?: string | null;
  vsk_nr?: string | null;
  lei_code?: string | null;
  country_code: string;
  default_currency?: string | null;
  status: string;
  merged_into_slug?: string | null;
  roles: IcelandRole[];
  service_area?: {
    regions?: string[];
    description?: string;
  } | null;
  addresses?: {
    registered?: {
      street?: string;
      postal_code?: string;
      municipality?: string;
      country_code?: string;
    };
  } | null;
  contacts?: {
    phone_main?: string;
    email_main?: string;
    website?: string;
  } | null;
  branding?: {
    rail_class?: string;
    logo_url?: string;
    primary_color?: string;
  } | null;
  tariff_source?: {
    url?: string;
    format?: string;
    tariff_version?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
    verified_on?: string | null;
  } | null;
  tariff_items?: TariffItem[];
  notes?: string | null;
};

export type Catalogue = {
  meta: {
    title?: string;
    last_verified_on?: string;
    role_legend?: Record<string, string>;
    ev_category_legend?: Record<string, string>;
  };
  parties: Party[];
};

export function loadCatalogue(): Catalogue | null {
  return catalogue as Catalogue;
}

export function filterByRole(parties: Party[], role: IcelandRole): Party[] {
  return parties
    .filter((p) => (p.roles ?? []).includes(role) && p.status !== "merged")
    .sort((a, b) => a.trade_name.localeCompare(b.trade_name, "is"));
}
