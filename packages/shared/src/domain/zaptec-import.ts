// Wire shape returned by POST /api/admin/zaptec/import.
//
// Each charger gets a freshly-generated OCPP Basic-Auth password,
// returned exactly once. The operator must copy each one into the
// corresponding Zaptec charger config (re-flashing the WSS URL +
// auth) — Straumvakt only stores the hash.

export interface ZaptecImportedCharger {
  /** Internal SiteAsset id — same id used everywhere else for the charger. */
  chargingStationId: string;
  /** OcppIdentity row id (gateway DO key). */
  ocppIdentityId: string;
  /** Identity-string the charger must present (typically the Zaptec SerialNo). */
  identityString: string;
  /** Plaintext OCPP Basic-Auth password — first and only time it's ever shown. */
  ocppPassword: string;
  displayName: string;
  serialNo: string | null;
}

export interface ZaptecImportResult {
  orgId: string;
  propertyId: string;
  siteId: string;
  installationId: string;
  /** vendorInstallationRef — the Zaptec UUID we imported from. */
  zaptecInstallationId: string;
  chargers: ZaptecImportedCharger[];
}
