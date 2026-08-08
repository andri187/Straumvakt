// ADR 0026 §6 — going-public RFQ inbox.
//
// Public /apply submissions land in tenancy.host_applications; the
// operator works them in the /applications inbox and converts a "won"
// row into a host org (ADR 0027). Runtime-free UI/domain shapes shared
// between the operator console and the API worker.

export type HostApplicationStatus =
  | "new"
  | "in_review"
  | "offered"
  | "won"
  | "lost";

// Mirrors tenancy.OrganizationKind — the two host types in scope per
// ADR 0026 §1.
export type HostApplicationSiteType = "multi_dwelling" | "company";

export interface HostApplicationSite {
  address: string;
  estimatedChargers: number;
  estimatedDrivers: number;
}

export interface HostApplicationSummary {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  kennitala: string | null;
  siteType: HostApplicationSiteType;
  sites: HostApplicationSite[];
  description: string | null;
  status: HostApplicationStatus;
  convertedOrgId: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
