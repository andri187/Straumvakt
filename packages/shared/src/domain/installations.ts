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
  // Sprint 4 4.6 — per-installation OCPP-Authorize enforce gate.
  // When true, the gateway honours verdicts from the API authorize
  // handler. When false (default), gateway logs but always replies
  // Accepted (shadow mode).
  enforceAuthorize: boolean;
  // Freeform JSONB. Zaptec/etc. imports drop vendor-specific extras
  // here (timezone, MaxCurrent, …). Read-only from the UI; operator
  // sees what was captured at import time.
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}
