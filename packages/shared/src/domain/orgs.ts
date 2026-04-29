// Wire shape of an Organization row as the API returns it. The web app
// imports this to type its fetches; the API imports it to type its
// responses. Identical at compile time, no runtime cost.

export type OrgStatus = "active" | "suspended" | "archived";

export type OrganizationRole =
  | "csms_provider"
  | "operator"
  | "service_contractor"
  | "installer"
  | "vendor"
  | "asset_owner"
  | "payer"
  | "beneficiary"
  | "customer"
  | "retailer"
  | "dso"
  | "tso"
  | "producer"
  | "aggregator"
  | "public_charging"
  | "home_charging"
  | "emsp"
  | "roaming_hub"
  | "payment_processor"
  | "insurance_provider"
  | "regulator";

export interface OrgSummary {
  id: string;
  slug: string;
  displayName: string;
  countryCode: string;
  status: OrgStatus;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  vskNr: string | null;
  leiCode: string | null;
  defaultCurrency: string;
  regulatorLicenceNo: string | null;
  notes: string | null;
  roles: OrganizationRole[];
  addresses: unknown;
  contacts: unknown;
  branding: unknown;
  createdAt: string;
  updatedAt: string;
}
