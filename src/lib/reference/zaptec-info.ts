// Brief one-line descriptions of Zaptec API constants, observation IDs,
// commands, and OCPP-related fields. Used by /reference/zaptec-api to
// render a documentation view (label → brief info) instead of dumping
// raw values like the Technical Read tab does for live data.
//
// Source of truth for the catalogues themselves is
// docs/reference/integrations/zaptec.md plus the live /api/constants
// endpoint cached at public/zaptec/zaptec-constants.json. This file
// curates the human-readable descriptions.

// ── Top-level /api/constants keys ──────────────────────────────────────
export const CONSTANT_KEY_INFO: Record<string, string> = {
  Languages: "13 supported driver-UI translation locales",
  Countries: "Country UUIDs the portal recognizes (Iceland is one of them)",
  InstallationCategories: "4 categories — Community / Company / Private / Public",
  InstallationTypes: "Pro vs Smart — circuit/charger limits per type",
  UserRoles: "Bitmask of platform roles — User, Owner, Maintainer, Admin, Onboarding...",
  NetworkTypes: "5 grid types — IT vs TN, 1-phase vs 3-phase",
  ChargerOperationModes: "5 operation states — Disconnected, Requesting, Charging, Finished, Unknown",
  Phases: "Bitmask for L1 / L2 / L3 — used by ActivePhases / SetPhases / MaxPhases",
  WildcardGuid: "Sentinel UUID used as a 'any' filter on hierarchy endpoints",
  RegionalInfo: "Regional defaults (currency, tariff, locale) per country",
  MessageCodes: "6 envelope-level result codes — Success, Error, Information, Warning",
  ErrorCodes: "41 typed REST error codes — maps onto HTTP error envelope",
  Settings: "39 writable observation IDs the operator may change",
  Commands: "50 charger-side commands — restart, firmware, start/stop charging, etc.",
  Observations: "155 observation IDs — the full state-telemetry vocabulary",
  Schema: "Per-DeviceType observation/command catalogue (Smart vs Apollo)",
  ObjectTypes: "9 entity types — Installation, Circuit, Charger, User, Country...",
  Version: "Zaptec API version string",
  SmartWarnings: "35-flag bitmask — RCD / pilot / relay / temperature / e-meter faults",
  VarisciteWarnings: "3-flag bitmask — Variscite SoM-side faults",
  PhaseIdMap: "Internal pin-to-phase mapping for raw measurements",
  DeviceLogTypes: "15 log-event categories — OCPP frames, IoT commands, sessions, auth",
  Features: "13-flag bitmask — APM, EcoMode, Schedule, OCPP, SurplusMode...",
  InstallationTypeConstraints: "5 violation flags when an install spec exceeds its type",
  SessionCommitMetadata: "9-flag bitmask describing how a session was committed",
  InstallationUpdateStatusCodes: "Result codes from POST /installation/{id}/update",
  EntityTypes: "3 high-level entity types — Installation / Charger / Unknown",
  DeviceTypes: "9 device families — Smart, Portable, Apollo, Apm variants",
  InstallationAuthenticationType: "4 auth modes — Native / WebHooks / OCPP / OcppNative",
  EnergyPrices: "Reference energy prices per region",
  UserActionTypes: "Action types tracked in the user audit log",
  OcppCloudUrlVersions: "2 URL formats — Legacy vs OCPP 1.6-Compliant",
};

// ── Observation IDs — brief descriptions, grouped ─────────────────────
// Only the most-relevant IDs are described here; full 155-entry list lives
// in docs/reference/integrations/zaptec.md §13.1.
export const OBSERVATION_INFO: Record<number, { name: string; info: string }> = {
  // Synthetic / connection
  [-3]: { name: "IsOcppConnected", info: "Bool — protocol-level CSMS connection state" },
  [-2]: { name: "IsOnline", info: "Bool — device-cloud reachability (distinct from OCPP)" },
  [-1]: { name: "Pulse", info: "Heartbeat counter — increments per cloud ping" },

  // Capabilities
  100: { name: "Capabilities", info: "JSON — declared charger capability set" },
  110: { name: "ProductName", info: "String — vendor + model (e.g. ZAPTEC PRO)" },
  152: { name: "ProductCode", info: "Internal product code" },
  154: { name: "LockCableWhenConnected", info: "Bool — auto-lock cable when EV plugged" },

  // Electrical (live)
  501: { name: "VoltagePhase1", info: "RMS volts on L1" },
  502: { name: "VoltagePhase2", info: "RMS volts on L2" },
  503: { name: "VoltagePhase3", info: "RMS volts on L3" },
  507: { name: "CurrentPhase1", info: "RMS amps on L1" },
  508: { name: "CurrentPhase2", info: "RMS amps on L2" },
  509: { name: "CurrentPhase3", info: "RMS amps on L3" },
  510: { name: "ChargerMaxCurrent", info: "Hardware ceiling — max amps the charger can offer" },
  511: { name: "ChargerMinCurrent", info: "Hardware floor — typically 6 A" },
  512: { name: "ActivePhases", info: "Bitmask of phases currently energized" },
  513: { name: "TotalChargePower", info: "Live power draw in watts" },
  515: { name: "RcdCurrent", info: "Residual-current device reading in mA" },
  518: { name: "PowerFactor", info: "Live power factor — sanity check on the load" },
  519: { name: "SetPhases", info: "Bitmask of phases the controller intends to use" },
  520: { name: "MaxPhases", info: "Bitmask of phases the install permits" },

  // Metering
  553: { name: "TotalChargePowerSession", info: "kWh delivered this session — resets per tx" },
  554: { name: "SignedMeterValue", info: "OCMF-signed lifetime register snapshot" },
  555: { name: "SignedMeterValueInterval", info: "OCMF-signed interval slice" },

  // Operation
  701: { name: "ChargeDuration", info: "Seconds since session began" },
  708: { name: "ChargeCurrentSet", info: "Amps the DLB has allocated to this charger right now" },
  710: { name: "ChargerOperationMode", info: "Enum 0..6 — Unknown/Disconnected/Requesting/Charging/Finished" },
  711: { name: "IsEnabled", info: "Bool — operator-side enable flag (disables = OCPP Unavailable)" },
  712: { name: "IsStandAlone", info: "Bool — true if charger has no installation parent" },
  714: { name: "CableType", info: "Cable rated current in A — read from PP resistor" },
  715: { name: "NetworkType", info: "Enum 0..4 — IT-1ph / IT-3ph / TN-1ph / TN-3ph / Unknown" },
  716: { name: "DetectedCar", info: "Bool — vehicle currently presenting a CP signal" },
  718: { name: "FinalStopActive", info: "Bool — set after a 506 StopChargingFinal command" },
  720: { name: "TariffText", info: "Free-form tariff label shown on the charger UI" },
  721: { name: "SessionIdentifier", info: "UUID of the current session (empty when idle)" },
  722: { name: "ChargerCurrentUserUuid", info: "UUID of the authenticated driver" },
  723: { name: "CompletedSession", info: "JSON of the last completed session including OCMF receipt" },

  // Authentication
  120: { name: "AuthenticationRequired", info: "Bool — global auth-required toggle for this charger" },
  750: { name: "NewChargeCard", info: "UUID;CardNo;GroupName — most recent unrecognized tap" },
  751: { name: "AuthenticationListVersion", info: "Local-list version — bumped on each portal sync" },
  752: { name: "EnabledNfcTechnologies", info: "Bitmask of NFC standards the reader accepts" },

  // Diagnostics
  803: { name: "Notifications", info: "Active notification bitmask — decode against SmartWarnings" },
  804: { name: "Warnings", info: "Active warning bitmask — same vocabulary as Notifications" },
  809: { name: "CommunicationSignalStrength", info: "Cellular / Wi-Fi RSSI in dBm" },
  810: { name: "CloudConnectionStatus", info: "Enum — Disconnected / Connecting / Connected / Reconnecting" },
  820: { name: "UptimeVariscite", info: "Hours since last Variscite SoM boot" },
  821: { name: "UptimeMCU", info: "Hours since last MCU boot" },

  // OCPP Native
  861: { name: "OcppNativeUrl", info: "WS URL the charger talks OCPP to (only when AuthType=3)" },
  862: { name: "OcppNativeCbId", info: "Charge-box id used in BootNotification (Native mode)" },
  866: { name: "OcppNativeConnected", info: "Bool — Native-OCPP connection state" },

  // Versions
  908: { name: "SmartMainboardSwApp", info: "Mainboard application firmware version" },
  909: { name: "SmartMainboardSwBoot", info: "Mainboard bootloader version" },
  911: { name: "SmartComputerSwApp", info: "Variscite SoM application firmware (the 'firmware version')" },
  912: { name: "SmartComputerSwBoot", info: "Variscite SoM bootloader" },
  913: { name: "SmartComputerHwVersion", info: "Hardware revision string" },
  914: { name: "MIDLegallyRelevantSoftwareIdentifier", info: "MID firmware ID — required for billing-grade metering" },

  // Identifiers
  950: { name: "MacMain", info: "Main interface MAC" },
  951: { name: "MacPlcModuleGrid", info: "PLC grid-side MAC" },
  952: { name: "MacWiFi", info: "Wi-Fi adapter MAC" },
  953: { name: "MacPlcModuleEv", info: "PLC EV-side MAC" },
  962: { name: "LteIccid", info: "SIM ICCID — only on cellular chargers" },
  963: { name: "LteImei", info: "Cellular modem IMEI" },
  980: { name: "MIDCalibration", info: "MID calibration metadata" },
  981: { name: "MIDPublicKey", info: "ECDSA public key — verifies all OCMF signatures from this charger" },
  982: { name: "MIDCalibrationID", info: "MID calibration ID — tracks recalibration events" },
};

// ── Commands — brief descriptions ─────────────────────────────────────
export const COMMAND_INFO: Record<number, { name: string; info: string; destructive?: boolean }> = {
  102: { name: "RestartCharger", info: "Reboot the controller — interrupts active session", destructive: true },
  103: { name: "RestartMcu", info: "Reset the MCU only (engineering)", destructive: true },
  104: { name: "UpdateSettings", info: "Force re-read of pending settings" },
  200: { name: "UpgradeFirmware", info: "Schedule firmware download + install (~10 min outage)", destructive: true },
  261: { name: "ResetNotifications", info: "Clear active notification flags" },
  506: { name: "StopChargingFinal", info: "Pause/stop the active session — needs OperationMode=3", destructive: true },
  507: { name: "ResumeCharging", info: "Resume after a 506 — needs FinalStopActive=1" },
  708: { name: "UnlockConnector", info: "Release cable lock motor (use carefully when energized)" },
  751: { name: "SetAuthenticationList", info: "Push a new local-auth list version to the charger" },
  10001: { name: "DeauthorizeAndStop", info: "Stop session + revoke authorization", destructive: true },
};

// ── OCPP-related concepts (operator-relevant only) ────────────────────
export const OCPP_INFO: Array<{ label: string; info: string; mono?: boolean }> = [
  { label: "Default version", info: "OCPP 1.6J over TLS WebSocket — the bedrock for the V3 pilot" },
  { label: "2.0.1 readiness", info: "Available on selected Pro firmwares; admitted as a sibling translator post-pilot" },
  { label: "Identity convention", info: "Charger serial as the OCPP identityString — Basic-Auth secret pushed at onboarding" },
  { label: "Heartbeat", info: "300 s default — adjusted via ChangeConfiguration if the operator wants finer-grained monitoring" },
  { label: "MeterValues cadence", info: "60 s default during active session — Energy.Active.Import.Register is the canonical billing meter" },
  { label: "Vendor extensions", info: "DataTransfer with vendor-id com.zaptec — passed through raw_protocol retention" },
];

// ── Vendor identity descriptions ─────────────────────────────────────
export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "Vendor name", info: "Norwegian AC charger manufacturer — Pro / Go / Go 2 / Apollo families" },
  { label: "Cloud API base", info: "REST front-door behind nginx; OAuth password grant + bearer token" },
  { label: "API style", info: "REST + JSON; password grant returns 24 h bearer (refresh token also issued)" },
  { label: "Hardware models", info: "Pro (commercial), Go (residential), Apollo (next-gen), Sense (smart-meter)" },
  { label: "OCPP versions", info: "1.6J on Pro by default; 2.0.1 on selected firmwares" },
  { label: "Native data model", info: "Installation → Circuit → Charger — maps directly onto V3 hierarchy (ADR 0007)" },
  { label: "Credential scope", info: "installation — one OAuth token per Zaptec installation, covers every charger below" },
];
