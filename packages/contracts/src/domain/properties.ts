export interface PropertySummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  displayName: string;
  locationType: string | null;
  address: unknown;
  latitude: string | null;
  longitude: string | null;
  provisioningStatus: string;
  createdAt: string;
  updatedAt: string;
}
