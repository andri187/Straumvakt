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
  // ── VENDOR-API liveness ─────────────────────────────────────────────
  // `online` / `lastSeenAt` are written by the Zaptec status sync, NOT by
  // OCPP. They say "the vendor's API told us about this charger", which is
  // a different question from "this charger is talking to us".
  //
  // The distinction is not academic: between 2026-05-13 and 2026-08-04 the
  // entire Dalvegur fleet was disconnected from our OCPP gateway for three
  // months while these fields read "online for 6d 15h" throughout, because
  // the vendor poll kept succeeding. Nothing surfaced the outage.
  online: boolean;                       // status !== "offline" && lastSeenAt within 12 min
  onlineSinceAt: string | null;          // ISO; populated only when online=true
  lastSeenAt: string | null;             // ISO — vendor poll freshness
  // ── OCPP liveness ───────────────────────────────────────────────────
  // Derived from the newest actual protocol frame for this identity
  // (events.event_log ∪ events.protocol_log). This is the charger
  // genuinely speaking to us, and it is what the fleet view must show
  // separately from the vendor path above.
  ocppLastSeenAt: string | null;         // ISO; null = no frame in the lookback window
  ocppOnline: boolean;                   // a frame within the same 12-min window
  /** Installation.enforceAuthorize — Straumvakt's own gate on the OCPP
   *  Authorize path. Nothing currently writes it and no installation has
   *  ever had it set, so it is the column default rather than a decision.
   *  Kept visible precisely because that is worth knowing. */
  enforceAuthorize: boolean | null;
  // ── Vendor-side auth (Zaptec) — the settings that actually govern ───
  /** StateId 120 — whether the CHARGER sends OCPP Basic-Auth on the WSS
   *  upgrade. About the charger authenticating to our gateway, not about
   *  drivers. This is what the /sites tree toggle writes. */
  vendorAuthRequired: boolean | null;
  /** Who authorises the DRIVER. Raw integer, deliberately unmapped: the
   *  enum is documented two contradictory ways in our own code
   *  (lib/zaptec.ts:212 vs charger-technical-read.ts:156), and a wrong
   *  mapping would render an open charger as closed or the reverse. */
  vendorAuthenticationType: number | null;
  /** When the two above were last refreshed from the vendor. null means
   *  never synced — which is NOT the same as "no auth", and must not be
   *  rendered as though it were. */
  vendorAuthSeenAt: string | null;
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
  /** Sprint 9.9 — installation + circuit attached to the charger so
   *  the /chargers list can group rows hierarchically. Both nullable
   *  for orphan chargers that haven't been placed yet. */
  installationId: string | null;
  installationDisplayName: string | null;
  circuitId: string | null;
  circuitDisplayName: string | null;
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
