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
  /** True if Zaptec's data was reachable on THIS request. False = the
   *  fields below either come from the cache (when cachedAt is set)
   *  or are placeholders (when both fresh and cachedAt are null/false). */
  fresh: boolean;
  /** ISO timestamp of when the data was fetched (regardless of fresh). */
  fetchedAt: string;
  /** When fresh=false and the panel is rendering from
   *  ChargingStation.lastTelemetryRead, this is the observed-at
   *  timestamp of that cached read. Lets the UI render
   *  "stale, last seen Xm ago" instead of em-dashes. */
  cachedAt?: string | null;

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
  // Auth-list metadata that the charger exposes alongside the version
  // counter. The list contents themselves are not readable (neither
  // OCPP `GetLocalListVersion` nor the Zaptec REST surface returns the
  // roster) — these are the per-tap event mirrors plus the reader
  // capability flags. Source of truth for the roster remains the CSMS.
  currentUserUuid: string | null;           // StateId 722 — UUID currently authorized for the active session
  lastRejectedUserUuid: string | null;      // StateId 725 — UUID of the most recently rejected card
  enabledNfcTechnologies: string | null;    // StateId 752 — bitmask/label of enabled NFC stacks
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
  // detail.DeviceType — Zaptec product line (0=Unknown, 1=Smart,
  // 2=Portable, 3=HomeApm, 4=Apollo, 5=OtherApm, 6=GenericApm,
  // 7=HanApm, 8=TicApm). Used as model fallback when our DB model
  // column is null (8.4.10).
  deviceTypeLabel: string | null;

  // Installation-level fields (separate Zaptec fetch). null when
  // the installation detail call fails or isn't attempted.
  installation: ChargerInstallationSnapshot | null;

  // Active warnings/notifications bitmask (decoded by the UI).
  warningsBitmask: number | null;      // StateId 803/804

  // CSMS-side local auth roster for this charger's installation.
  // The roster ON the charger is unreadable (OCPP 1.6J only exposes
  // GetLocalListVersion; Zaptec REST has no contents endpoint), so we
  // surface what Straumvakt's IdToken table believes the list should
  // be. Today (pre-SendLocalList wiring) this is informational only —
  // edits to the IdToken table do not propagate to the charger.
  localAuthRoster: LocalAuthRoster | null;
}

export type LocalAuthRosterNote =
  /** Charger has no installationId on the Straumvakt side. */
  | "no_installation"
  /** Installation is configured for AuthenticationType=0 (Native) — Zaptec
   *  Portal owns the list and our IdToken table doesn't reflect it. */
  | "native_zaptec_managed"
  /** Roster is the IdToken table view; what we'd push if SendLocalList
   *  were wired. */
  | "show_csms_roster";

export interface LocalAuthRoster {
  installationId: string | null;
  note: LocalAuthRosterNote;
  /** Total entries returned (regardless of effective status). */
  count: number;
  /** Of those, how many would actually be Accepted by ocpp-authorize. */
  effectiveCount: number;
  /** Mirrored from authListVersion (StateId 751) for the badge. */
  chargerListVersion: number | null;
  /** Reserved for when SendLocalList wiring lands — version Straumvakt
   *  last pushed. Always null in the read-only Half A. */
  pushedListVersion: number | null;
  entries: LocalAuthRosterEntry[];
}

export type LocalAuthRosterScope = "installation" | "global";

/** Mirrors the verdicts in ocpp-authorize.ts so the operator sees what
 *  would happen at tap time, not just the raw IdToken status. */
export type LocalAuthEffectiveVerdict =
  | "would_authorize"
  | "blocked_revoked"
  | "blocked_suspended"
  | "blocked_no_contract"
  | "expired";

export interface LocalAuthRosterEntry {
  id: string;
  value: string;                     // canonical OCPP idTag
  kind: string;                      // IdTokenKind enum literal
  label: string | null;
  status: string;                    // IdTokenStatus enum literal
  expiresAt: string | null;
  lastUsedAt: string | null;
  scope: LocalAuthRosterScope;       // 'installation' = scoped here, 'global' = scope is null
  userId: string;
  userDisplay: string;               // displayName ?? email
  effectiveVerdict: LocalAuthEffectiveVerdict;
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
