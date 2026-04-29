export interface InstallationSummary {
  id: string;
  orgId: string;
  orgDisplayName: string;
  siteId: string;
  siteDisplayName: string;
  displayName: string;
  vendorId: string | null;
  vendorSlug: string | null;
  vendorDisplayName: string | null;
  modelId: string | null;
  vendorInstallationRef: string | null;
  credentialsRef: string | null;
  credentialsStatus: string | null;
  onboardingStatus: string;
  retailerTariffId: string | null;
  createdAt: string;
  updatedAt: string;
}
