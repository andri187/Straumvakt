// Vendor-credential management — the operator-facing view of "what
// chargers does this credential give us access to, and which of them
// are imported into our DB right now". Drives the /onboard/credentials/
// :id/manage page where the operator picks chargers to add or remove.
//
// Tree shape mirrors the /sites tree (Installation → Circuit → Charger)
// but each row carries an `imported` flag so the UI can pre-check the
// boxes for the operator's current selection.

export interface CredentialChargerNode {
  /** Zaptec internal UUID — the join key against OcppIdentity.vendor_resource_id. */
  zaptecId: string;
  /** Hardware DeviceId (e.g. ZPR042645). What our import uses for serial + identityString. */
  deviceId: string | null;
  /** Operator-editable Zaptec SerialNo field (often a display name). */
  serialNo: string | null;
  /** Friendly name (Zaptec Name). */
  name: string;
  /** Active = enabled in Zaptec installation; false = decommissioned via portal. */
  active: boolean;
  /** Live IsOnline from Zaptec bulk list. */
  isOnline: boolean;
  /** True when an OcppIdentity row in our DB matches this Zaptec UUID. */
  imported: boolean;
  /** Our charging_station_id when imported, null otherwise. */
  chargingStationId: string | null;
  /**
   * Lifetime kWh from Zaptec per-charger detail's SignedMeterValueKwh
   * (the OCMF-signed cumulative meter reading). Null when the field is
   * absent — typically because Zaptec hasn't observed a session yet, or
   * the charger has been replaced and the meter was zeroed.
   */
  lifetimeEnergyKWh: number | null;
}

export interface CredentialCircuitNode {
  zaptecId: string;
  name: string;
  maxCurrent: number | null;
  chargers: CredentialChargerNode[];
}

export interface CredentialInstallationNode {
  zaptecId: string;
  name: string;
  /** True when an Installation row in our DB has vendor_installation_ref = this Zaptec UUID. */
  imported: boolean;
  /** Our installation_id when imported. Required for the manage flow's "add charger" path. */
  installationId: string | null;
  circuits: CredentialCircuitNode[];
}

export interface CredentialManageTree {
  credentialId: string;
  credentialUsername: string;
  /**
   * Sorted: imported installations first (operator can manage these),
   * then unimported (read-only — operator must use the wizard to
   * onboard a fresh installation).
   */
  installations: CredentialInstallationNode[];
}

export interface CredentialApplyResult {
  added: number;
  removed: number;
  /** Per-charger failures with a human-readable reason. */
  failed: { zaptecId: string; reason: string }[];
  /** Reasons for chargers that were skipped (not failed) — e.g. orphan installation. */
  skipped: { zaptecId: string; reason: string }[];
}
