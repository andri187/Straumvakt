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
  // Freeform JSONB. Zaptec/etc. imports drop vendor-specific extras
  // here (timezone, MaxCurrent, …). Read-only from the UI; operator
  // sees what was captured at import time.
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}
