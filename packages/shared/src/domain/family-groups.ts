// FamilyGroup summary as returned by /api/admin/orgs/:id/family-groups.
// FamilyGroups model multi-driver households where one driver pays
// for several drivers' charging. Used as the v1 stand-in for the
// broader "driver groups" concept until Zaptec UserGroup import lands.

export interface FamilyGroupSummary {
  id: string;
  orgId: string;
  displayName: string;
  primaryUserId: string;
  primaryUserDisplayName: string | null;
  primaryUserEmail: string;
  memberCount: number;
  createdAt: string;
}
