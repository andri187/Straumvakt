import type { StateObservation } from "./zaptec";

// ── Authoritative Observation ID map ──────────────────────────────────────
// Source: GET https://api.zaptec.com/api/constants (Observations object,
// pivoted from { name: id } to { id: name }). 155 entries total.
// Do not guess IDs — always cross-check against /api/constants.

export const StateId = {
  // synthetic / connection
  AuthorizationCache: -100,
  IsOcppConnected: -3,
  IsOnline: -2,
  Pulse: -1,

  // capabilities + config
  Capabilities: 100,
  ProductName: 110,
  AuthenticationRequired: 120,
  CommunicationMode: 150,
  ProductCode: 152,
  HmiBrightness: 153,
  LockCableWhenConnected: 154,

  // environment
  TemperatureInternal5: 201,
  TemperatureInternal6: 202,
  Humidity: 270,

  // electrical (live telemetry)
  VoltagePhase1: 501,
  VoltagePhase2: 502,
  VoltagePhase3: 503,
  CurrentPhase1: 507,
  CurrentPhase2: 508,
  CurrentPhase3: 509,
  ChargerMaxCurrent: 510,
  ChargerMinCurrent: 511,
  ActivePhases: 512,
  TotalChargePower: 513,
  RcdCurrent: 515,
  PowerFactor: 518,
  SetPhases: 519,
  MaxPhases: 520,

  // metering / session
  TotalChargePowerSession: 553,
  SignedMeterValue: 554,
  SignedMeterValueInterval: 555,
  SessionEnergyExportActive: 560,
  SessionEnergyImportActive: 562,

  // operation
  ChargeDuration: 701,
  ChargeMode: 702,
  ChargeCurrentSet: 708,
  ChargerOperationMode: 710,
  IsEnabled: 711,
  IsStandAlone: 712,
  CableType: 714,
  NetworkType: 715,
  DetectedCar: 716,
  FinalStopActive: 718,
  AuthorizationTimeout: 719,
  TariffText: 720,
  SessionIdentifier: 721,
  ChargerCurrentUserUuid: 722,
  CompletedSession: 723,
  AuthenticationListVersion: 751,

  // network / cloud
  InstallationId: 800,
  RoutingId: 801,
  Notifications: 803,
  Warnings: 804,
  DiagnosticsMode: 805,
  InternalDiagnosticsLog: 807,
  DiagnosticsString: 808,
  CommunicationSignalStrength: 809,
  CloudConnectionStatus: 810,
  UptimeVariscite: 820,
  UptimeMCU: 821,

  // versions
  SmartMainboardSwApp: 908,
  SmartMainboardSwBoot: 909,
  SmartComputerSwApp: 911,
  SmartComputerSwBoot: 912,
  SmartComputerHwVersion: 913,

  // identity (MAC/LTE)
  MacMain: 950,
  MacWiFi: 952,
  LteIccid: 962,
  LteImei: 963,

  // OCPP native
  OcppNativeUrl: 861,
  OcppNativeCbId: 862,
  OcppNativeConnected: 866,
} as const;

// ── Full id → name index (authoritative, from /api/constants) ─────────────
// Keep in sync with https://api.zaptec.com/api/constants `Observations`.
export const ObservationNames: Record<number, string> = {
  [-100]: "AuthorizationCache",
  [-3]: "IsOcppConnected",
  [-2]: "IsOnline",
  [-1]: "Pulse",
  0: "Unknown",
  1: "OfflineMode",
  100: "Capabilities",
  110: "ProductName",
  111: "ArenaId",
  120: "AuthenticationRequired",
  130: "PaymentActive",
  131: "PaymentCurrency",
  132: "PaymentSessionUnitPrice",
  133: "PaymentEnergyUnitPrice",
  134: "PaymentTimeUnitPrice",
  150: "CommunicationMode",
  151: "PermanentCableLock",
  152: "ProductCode",
  153: "HmiBrightness",
  154: "LockCableWhenConnected",
  155: "SoftStartDisabled",
  156: "FirmwareApiHost",
  157: "DpsAssignedIotHub",
  158: "DpsScopeId",
  159: "IoTHubOverride",
  170: "MIDBlinkEnabled",
  180: "ProductionTesterEnabled",
  181: "ProductionTestStationOverride",
  201: "TemperatureInternal5",
  202: "TemperatureInternal6",
  203: "TemperatureInternalLimit",
  205: "TemperaturePowerBoard",
  241: "TemperatureInternalMaxLimit",
  270: "Humidity",
  280: "TamperCover",
  501: "VoltagePhase1",
  502: "VoltagePhase2",
  503: "VoltagePhase3",
  507: "CurrentPhase1",
  508: "CurrentPhase2",
  509: "CurrentPhase3",
  510: "ChargerMaxCurrent",
  511: "ChargerMinCurrent",
  512: "ActivePhases",
  513: "TotalChargePower",
  515: "RcdCurrent",
  517: "Internal12vCurrent",
  518: "PowerFactor",
  519: "SetPhases",
  520: "MaxPhases",
  522: "ChargerOfflinePhase",
  523: "ChargerOfflineCurrent",
  540: "RcdCalibration",
  541: "RcdCalibrationNoise",
  542: "ManualRcdTest",
  553: "TotalChargePowerSession",
  554: "SignedMeterValue",
  555: "SignedMeterValueInterval",
  560: "SessionEnergyCountExportActive",
  561: "SessionEnergyCountExportReactive",
  562: "SessionEnergyCountImportActive",
  563: "SessionEnergyCountImportReactive",
  570: "SoftStartTime",
  701: "ChargeDuration",
  702: "ChargeMode",
  703: "ChargePilotLevelInstant",
  704: "ChargePilotLevelAverage",
  706: "PilotVsProximityTime",
  708: "ChargeCurrentSet",
  710: "ChargerOperationMode",
  711: "IsEnabled",
  712: "IsStandAlone",
  713: "ChargerCurrentUserUuidDeprecated",
  714: "CableType",
  715: "NetworkType",
  716: "DetectedCar",
  717: "GridTestResult",
  718: "FinalStopActive",
  719: "AuthorizationTimeout",
  720: "TariffText",
  721: "SessionIdentifier",
  722: "ChargerCurrentUserUuid",
  723: "CompletedSession",
  724: "PlugAndChargeAuthorizeRequest",
  725: "RejectedUserUuid",
  750: "NewChargeCard",
  751: "AuthenticationListVersion",
  752: "EnabledNfcTechnologies",
  753: "LteRoamingDisabled",
  760: "Location",
  761: "TimeZone",
  762: "TimeSchedule",
  763: "NextScheduleEvent",
  764: "MaxStartDelay",
  800: "InstallationId",
  801: "RoutingId",
  803: "Notifications",
  804: "Warnings",
  805: "DiagnosticsMode",
  807: "InternalDiagnosticsLog",
  808: "DiagnosticsString",
  809: "CommunicationSignalStrength",
  810: "CloudConnectionStatus",
  811: "McuResetSource",
  812: "McuRxErrors",
  813: "McuToVariscitePacketErrors",
  814: "VarisciteToMcuPacketErrors",
  816: "MIDFaultFlags",
  817: "RelayWeldedFlags",
  820: "UptimeVariscite",
  821: "UptimeMCU",
  823: "CertificateVersion",
  830: "SecurityLog",
  850: "CarSessionLog",
  851: "CommunicationModeConfigurationInconsistency",
  852: "RawPilotMonitor",
  853: "IT3PhaseDiagnosticsLog",
  854: "PilotTestResults",
  855: "UnconditionalNfcDetectionIndication",
  856: "EnableLteDetailedSignalStrength",
  857: "EnableLocalNetworkMaintenance",
  860: "SessionController",
  861: "OcppNativeUrl",
  862: "OcppNativeCbId",
  866: "OcppNativeConnected",
  867: "OcppTunnelCall",
  868: "OcppNativeZaptecLoadBalancingEnabled",
  869: "OcppNativeOnePhaseChargingPhase",
  899: "EmcTestCounter",
  900: "ProductionTestResults",
  901: "PostProductionTestResults",
  908: "SmartMainboardSoftwareApplicationVersion",
  909: "SmartMainboardSoftwareBootloaderVersion",
  911: "SmartComputerSoftwareApplicationVersion",
  912: "SmartComputerSoftwareBootloaderVersion",
  913: "SmartComputerHardwareVersion",
  914: "MIDLegallyRelevantSoftwareIdentifier",
  920: "PlcPibVersionGrid",
  921: "PlcPibVersionEV",
  930: "AppliedImageUpdates",
  931: "FailedImageUpdates",
  950: "MacMain",
  951: "MacPlcModuleGrid",
  952: "MacWiFi",
  953: "MacPlcModuleEv",
  960: "LteImsi",
  961: "LteMsisdn",
  962: "LteIccid",
  963: "LteImei",
  964: "LteVersion",
  965: "LteDetailedSignalStrength",
  970: "ProductionTestStationNumber",
  980: "MIDCalibration",
  981: "MIDPublicKey",
  982: "MIDCalibrationID",
};

export type StateGroup =
  | "Operation"
  | "Connectivity"
  | "Electrical"
  | "Session"
  | "Metering"
  | "Versions"
  | "Environment"
  | "Diagnostics"
  | "Other";

const GROUPS: Array<{ test: (id: number) => boolean; group: StateGroup }> = [
  { test: (id) => id >= 501 && id <= 523, group: "Electrical" },
  { test: (id) => id >= 550 && id <= 570, group: "Metering" },
  { test: (id) => id >= 700 && id <= 725 || id === 708, group: "Operation" },
  { test: (id) => id >= 750 && id <= 770, group: "Operation" },
  { test: (id) => id === -2 || id === -3 || id === 809 || id === 810, group: "Connectivity" },
  { test: (id) => id >= 860 && id <= 869, group: "Connectivity" },
  { test: (id) => id === 201 || id === 202 || id === 203 || id === 270 || id === 205 || id === 241, group: "Environment" },
  { test: (id) => id >= 908 && id <= 965, group: "Versions" },
  { test: (id) => id >= 800 && id <= 899, group: "Diagnostics" },
];

export function describeStateId(id: number): { label: string; group: StateGroup } {
  const label = ObservationNames[id] ?? `StateId ${id}`;
  for (const g of GROUPS) if (g.test(id)) return { label, group: g.group };
  return { label, group: "Other" };
}

// ── ChargerOperationMode (710) — from /api/constants ChargerOperationModes ──
export type OperationModeLabel =
  | "Unknown"
  | "Disconnected"
  | "Connected_Requesting"
  | "Connected_Charging"
  | "Connected_Finished"
  | "Connected_RequestingLimited";

export function operationModeLabel(v: string | undefined): OperationModeLabel {
  switch (v) {
    case "1":
      return "Disconnected";
    case "2":
      return "Connected_Requesting";
    case "3":
      return "Connected_Charging";
    case "5":
      return "Connected_Finished";
    case "6":
      return "Connected_RequestingLimited";
    default:
      return "Unknown";
  }
}

// Plain-language version of the operation mode (for call center).
export function operationModeFriendly(v: string | undefined): {
  headline: string;
  short: string;
  tone: "green" | "blue" | "amber" | "grey";
} {
  switch (v) {
    case "1":
      return { headline: "Idle — ready to charge", short: "Idle", tone: "green" };
    case "2":
      return {
        headline: "Cable connected, waiting for authorization",
        short: "Waiting for auth",
        tone: "blue",
      };
    case "3":
      return { headline: "Charging", short: "Charging", tone: "green" };
    case "5":
      return { headline: "Session finished — cable still plugged in", short: "Finished", tone: "amber" };
    case "6":
      return {
        headline: "Waiting — power is limited right now",
        short: "Load-balanced wait",
        tone: "amber",
      };
    default:
      return { headline: "Status unknown", short: "Unknown", tone: "grey" };
  }
}

// ── Session state machine (derived from multiple observations) ─────────────
export type SessionPhase = "plug" | "auth" | "charge" | "finish";

export function sessionPhaseFromOpMode(v: string | undefined): SessionPhase | null {
  switch (v) {
    case "1":
      return null; // no session
    case "2":
      return "auth";
    case "3":
      return "charge";
    case "5":
      return "finish";
    case "6":
      return "auth"; // waiting for power allocation
    default:
      return null;
  }
}

// ── NetworkType (715) ──────────────────────────────────────────────────────
export function networkTypeLabel(v: string | undefined): string {
  switch (v) {
    case "1":
      return "IT · 1-phase";
    case "2":
      return "IT · 3-phase";
    case "3":
      return "TN · 1-phase";
    case "4":
      return "TN · 3-phase";
    default:
      return "Unknown";
  }
}

export function stateMap(state: StateObservation[]): Map<number, StateObservation> {
  const m = new Map<number, StateObservation>();
  for (const s of state) m.set(s.StateId, s);
  return m;
}

export function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
