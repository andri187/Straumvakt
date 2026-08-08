// Wire shape returned by POST /api/admin/zaptec/import.
//
// Identity-string is the Zaptec DeviceId (lowercased) — that's what
// Zaptec firmware actually sends in OCPP Basic-Auth. The OCPP
// password is installation-level (one value across all chargers in
// the installation) — the operator types it into the wizard, we
// hash it once, and apply the same hash to every OcppIdentity row.
// We don't echo the password back to the client.

export interface ZaptecImportedCharger {
  /** Internal SiteAsset id — same id used everywhere else for the charger. */
  chargingStationId: string;
  /** OcppIdentity row id (gateway DO key). */
  ocppIdentityId: string;
  /** Identity-string the charger presents (Zaptec DeviceId, lowercased). */
  identityString: string;
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
