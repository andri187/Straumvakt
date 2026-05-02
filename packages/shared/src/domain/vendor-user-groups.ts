// Mirror of vendor-side user groups (Zaptec UserGroups).
// Populated by the user-import sync engine (deferred Sprint 5+).
// The Groups tab surfaces these alongside FamilyGroups so operators
// see all user-groupings in one place.

export interface VendorUserGroupSummary {
  id: string;
  vendorSlug: string;
  vendorGroupId: string;
  installationId: string;
  installationDisplayName: string;
  orgId: string;
  orgDisplayName: string;
  name: string;
  memberCount: number;
  lastSyncedAt: string;
  createdAt: string;
}
