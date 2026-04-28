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
  createdAt: string;
  updatedAt: string;
}
