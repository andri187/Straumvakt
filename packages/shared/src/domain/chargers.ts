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
  // Sprint 8.4.7 — list-view enrichment populated by the status-sync
  // cron from per-charger /state observations. All optional; legacy
  // chargers without a recent /state poll render em-dashes.
  firmwareVersion: string | null;        // StateId 911
  mainboardSwVersion: string | null;     // StateId 908
  smartBootloaderVersion: string | null; // StateId 912
  hardwareVersion: string | null;        // StateId 913
  lifetimeKwh: number | null;            // ChargingStation.lifetimeKwhCached
  status: string | null;                 // OcppIdentity.status (offline | available | charging | …)
  online: boolean;                       // status !== "offline" && lastSeenAt within 12 min
  onlineSinceAt: string | null;          // ISO; populated only when online=true
  lastSeenAt: string | null;             // ISO
  /** Sprint 9.7 — true when the vendor (Zaptec) no longer lists this
   *  charger in any credential's listChargers (Active=false / retired).
   *  null when we couldn't verify (no credential / Zaptec outage). */
  decommissioned: boolean | null;
  /** Sprint 9.8 — communication mode + signal strength cached on
   *  ChargingStation by the every-minute cron (extracted from /state
   *  StateId 150 + 809). Replaces the JSONB-only path so the list
   *  view sees fresh values for every charger without each operator
   *  first visiting /chargers/[id]. Both null when the charger
   *  doesn't report (PLC chargers report no signal; Native auth
   *  chargers may return nothing on /state). */
  commMode: string | null;     // "Wi-Fi" / "LTE" / "PLC" / "Ethernet" / "None"
  signalDbm: number | null;    // integer dBm magnitude (negative for real RF)
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
