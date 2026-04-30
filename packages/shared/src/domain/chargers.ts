export interface ChargerSummary {
  chargingStationId: string;
  evseId: string;
  connectorId: string;
  ocppIdentityId: string;
  identityString: string;
  orgDisplayName: string;
  siteDisplayName: string;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  connectorType: string;
  ocppVersion: string;
  createdAt: string;
}

export interface ChargerCreateResult extends ChargerSummary {
  /** OCPP Basic-Auth password — returned exactly once at creation. Operators must
   * copy it into the charger config; the server only stores its SHA-256 hash. */
  ocppPassword: string;
}

export interface ChargerConnector {
  id: string;
  connectorIndex: number;
  type: string;
  maxPowerKw: string | null;
  status: string;
  // OCPP 1.6 §4.9 StatusNotification mirror — populated by the
  // connector.status_updated projection. errorCode is null when the
  // last status was 'NoError' so the operator UI can branch on
  // `errorCode != null` to render an error pill.
  errorCode: string | null;
  vendorErrorCode: string | null;
  statusUpdatedAt: string | null;
}

export interface ChargerEvse {
  id: string;
  evseIndex: number;
  maxPowerKw: string | null;
  phaseCount: number | null;
  connectors: ChargerConnector[];
}

export interface ChargerOcppIdentity {
  id: string;
  identityString: string;
  ocppVersion: string;
}

export interface ChargerDetail {
  chargingStationId: string;
  orgId: string;
  orgDisplayName: string;
  siteId: string;
  siteDisplayName: string;
  installationId: string | null;
  installationDisplayName: string | null;
  circuitId: string | null;
  circuitDisplayName: string | null;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  /** Date column in DB, ISO string here. Null when never set. */
  warrantyExpires: string | null;
  // OCPP BootNotification profile (1.6 §6.2 / 2.0.1 §1.4) — auto-
  // populated by the charger.booted projection. Null until the
  // charger boots against our gateway at least once.
  chargeBoxSerialNumber: string | null;
  meterType: string | null;
  meterSerialNumber: string | null;
  iccid: string | null;
  imsi: string | null;
  // Operator-domain physical info (Sprint 3 enrichment) — edited
  // directly via the charger detail page.
  locationNote: string | null;
  mountingType: string | null;
  photoUrl: string | null;
  ipRating: string | null;
  breakerAmps: number | null;
  evses: ChargerEvse[];
  ocppIdentities: ChargerOcppIdentity[];
}

export interface EnqueuedCommand {
  commandId: string;
  status: string;
}
