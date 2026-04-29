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

export interface ChargerEvse {
  id: string;
  evseIndex: number;
  maxPowerKw: string | null;
  phaseCount: number | null;
  connectors: { id: string; connectorIndex: number; type: string; maxPowerKw: string | null }[];
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
  evses: ChargerEvse[];
  ocppIdentities: ChargerOcppIdentity[];
}

export interface EnqueuedCommand {
  commandId: string;
  status: string;
}
