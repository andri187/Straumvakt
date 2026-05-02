// Wire shape of an Organization row as the API returns it. ADR 0014:
// Iceland-aligned (Fyrirtækjaskrá) field set, OCPI-aligned role
// taxonomy, slug + free-form addresses/contacts JSON dropped,
// mainContact references a User.

export type OrgStatus = "active" | "suspended" | "archived";

export type OrganizationRole =
  | "cpo"
  | "emsp"
  | "hub"
  | "nsp"
  | "site_host"
  | "service_contractor"
  | "installer"
  | "vendor"
  | "regulator"
  | "dso"
  | "tso"
  | "retailer"
  | "payment_processor";

export interface OrgAddress {
  street: string;
  postalCode: string;
  city: string;
}

export interface OrgMainContact {
  id: string;
  displayName: string | null;
  email: string;
}

export type OrgContactRole =
  | "main"
  | "billing"
  | "technical"
  | "support"
  | "emergency"
  | "other";

export interface OrgContact {
  role: OrgContactRole;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface OrgSummary {
  id: string;
  displayName: string;
  countryCode: string;
  status: OrgStatus;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  legalFormCode: string | null;
  vskNr: string | null;
  leiCode: string | null;
  defaultCurrency: string;
  postalAddress: OrgAddress | null;
  legalAddress: OrgAddress | null;
  municipalityCode: string | null;
  municipalityName: string | null;
  regulatorLicenceNo: string | null;
  notes: string | null;
  roles: OrganizationRole[];
  branding: unknown;
  mainContactUserId: string | null;
  mainContact: OrgMainContact | null;
  contacts: OrgContact[];
  createdAt: string;
  updatedAt: string;
}
