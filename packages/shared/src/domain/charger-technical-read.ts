// Charger technical-read — vendor-side telemetry pulled live from
// the Zaptec API on each request. Joined with the charger's
// VendorResourceId (Zaptec UUID, stored on OcppIdentity) and the
// org's stored VendorCredential (decrypted server-side via KEK).
//
// Every field is optional — Zaptec API may be unreachable, the
// state endpoint may not yet have populated all observations, or
// the field may not apply to the device class. Callers render
// "—" for nulls.

export interface ChargerLivePhase {
  voltageV: number | null;
  currentA: number | null;
}

export interface ChargerTechnicalRead {
  /** True if Zaptec's data was reachable. False = render placeholders + show stale-data indicator. */
  fresh: boolean;
  /** ISO timestamp of when the data was fetched. */
  fetchedAt: string;

  // Compact pills (rendered above the operator command panel).
  signalDbm: number | null;       // StateId 809 — CommunicationSignalStrength
  communicationMode: string | null; // StateId 150 — Wi-Fi / 4G / Ethernet / PLC
  ocppConnected: boolean | null;    // StateId -3 — IsOcppConnected
  firmwareVersion: string | null;   // StateId 911 — SmartComputerSoftwareApplicationVersion
  networkType: string | null;       // StateId 715 — IT / TN (1-phase / 3-phase)
  internalTemperatureC: number | null; // StateId 201/202 — first available

  // Live electrical telemetry.
  chargerOperationMode: string | null; // StateId 710 — enum 0-6
  isOnline: boolean | null;            // StateId -2
  isEnabled: boolean | null;           // StateId 711
  totalChargePowerW: number | null;    // StateId 513
  totalChargeEnergySessionKWh: number | null; // StateId 553
  phases: [ChargerLivePhase, ChargerLivePhase, ChargerLivePhase];
  chargerMaxCurrentA: number | null;   // StateId 510
  chargeCurrentSetA: number | null;    // StateId 708 — DLB-allocated

  // Hardware identifiers.
  serialNo: string | null;
  deviceId: string | null;
  mid: string | null;                  // MID (982 calibration id)
  macMain: string | null;              // StateId 950
  macWifi: string | null;              // StateId 952
  lteIccid: string | null;             // StateId 962
  lteImsi: string | null;              // StateId 960

  // Uptime + last activity.
  uptimeHours: number | null;          // StateId 820 — UptimeVariscite (already in hours, decimal)

  // Vendor / property flags.
  propertyOcppUrl: string | null;
  propertyAuthenticationDisabled: boolean | null;
  isAuthorizationRequired: boolean | null;

  // OCPP-specific config + state. Mostly drawn from the per-charger
  // detail + state endpoints; surfaced together so the operator can
  // see the full OCPP stack at a glance on the charger profile.
  authenticationType: number | null;        // 0=None/Zaptec, 1=Vendor app, 2=OCPP cloud, 3=Native OCPP
  authenticationTypeLabel: string | null;   // Human label for authenticationType
  ocppDefaultIdTag: string | null;          // PropertyOcppDefaultIdTag — fallback for StartTransaction
  ocppCloudUrlVersion: number | null;       // 0=Legacy, 1=OCPP 1.6 compliant
  authListVersion: number | null;           // StateId 751 — Zaptec local auth list version
  routingId: string | null;                 // StateId 801 — DLB routing key
  installationId: string | null;            // StateId 800 — Zaptec installation UUID

  // Additional per-charger state observations exposed once for the
  // Technical Read page. All optional — Zaptec-side may not have
  // populated all 70+ observations yet.
  mainboardSwVersion: string | null;        // StateId 908
  smartBootloaderVersion: string | null;    // StateId 912
  hardwareVersion: string | null;           // StateId 913
  internalTempBC: number | null;            // StateId 202
  humidityPct: number | null;               // StateId 270
  lifetimeEnergyKWh: number | null;         // SignedMeterValueKwh from detail
  lteRoamingDisabled: boolean | null;       // StateId 753
  lteImei: string | null;                   // StateId 963
  lteMsisdn: string | null;                 // StateId 961
  macPlcGrid: string | null;                // StateId 951
  lastChargeCard: string | null;            // StateId 750 — `<UUID>;<card>;<group>` last seen
  pin: string | null;                       // detail.Pin — wallet PIN
  hasSessions: boolean | null;              // detail.HasSessions

  // Installation-level fields (separate Zaptec fetch). null when
  // the installation detail call fails or isn't attempted.
  installation: ChargerInstallationSnapshot | null;

  // Active warnings/notifications bitmask (decoded by the UI).
  warningsBitmask: number | null;      // StateId 803/804
}

export interface ChargerInstallationSnapshot {
  name: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  countryId: string | null;
  timeZoneIanaName: string | null;
  activeChargerCount: number | null;
  maxCurrent: number | null;
  availableCurrent: number | null;
  useLoadBalancing: boolean | null;
  isRequiredAuthentication: boolean | null;
  ocppCloudUrl: string | null;
  ocppCloudUrlVersion: number | null;
  routingId: string | null;
  messagingEnabled: boolean | null;
  active: boolean | null;
  createdOnDate: string | null;
}
