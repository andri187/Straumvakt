export interface SiteSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  propertyId: string;
  propertyDisplayName: string;
  displayName: string;
  timezone: string;
  siteType: string;
  accessLevel: string;
  powerClass: string | null;
  provisioningStatus: string;
  dsoTariffId: string | null;
  usrfTariffId: string | null;
  usrfPremTariffId: string | null;
  xtrrfTariffId: string | null;
  spvivfTariffId: string | null;
  // Profile enrichment round 2 (Sprint 3).
  // openingHours is a freeform JSONB shape — the UI offers a 7-day
  // weekly editor, but the column accepts any JSON so vendor or
  // operator-specific extras (holidays, exceptions) can layer on
  // without a schema change.
  openingHours: unknown;
  accessNote: string | null;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
