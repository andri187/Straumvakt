// OCPP 1.6J reference data structures + standard config-key catalog +
// command catalog. None of this is wired to a live OCPP gateway — the
// scratch app has no CSMS connected, so all live data renders as empty.
// The shapes mirror what we'd get from a real OCPP gateway worker so the
// UI is ready when one is wired in.

// ── BootNotification (CP → CS, on boot/reconnect) ────────────────────────────
export type BootNotification = {
  chargePointVendor?: string;
  chargePointModel?: string;
  chargePointSerialNumber?: string;
  chargeBoxSerialNumber?: string;
  firmwareVersion?: string;
  iccid?: string;
  imsi?: string;
  meterType?: string;
  meterSerialNumber?: string;
  receivedAt?: string;
};

// ── StatusNotification per connector ─────────────────────────────────────────
// OCPP 1.6J § 4.9 — status enum
export type ConnectorStatus =
  | "Available"
  | "Preparing"
  | "Charging"
  | "SuspendedEVSE"
  | "SuspendedEV"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted";

// OCPP 1.6J § 4.9 — errorCode enum
export type ConnectorErrorCode =
  | "ConnectorLockFailure"
  | "EVCommunicationError"
  | "GroundFailure"
  | "HighTemperature"
  | "InternalError"
  | "LocalListConflict"
  | "NoError"
  | "OtherError"
  | "OverCurrentFailure"
  | "PowerMeterFailure"
  | "PowerSwitchFailure"
  | "ReaderFailure"
  | "ResetFailure"
  | "UnderVoltage"
  | "OverVoltage"
  | "WeakSignal";

export type ConnectorStatusEntry = {
  connectorId: number;
  status: ConnectorStatus;
  errorCode: ConnectorErrorCode;
  info?: string;
  vendorId?: string;
  vendorErrorCode?: string;
  receivedAt?: string;
};

// ── MeterValues (CP → CS) ────────────────────────────────────────────────────
// OCPP 1.6J § 5.1.5 — sampledValue.measurand enum
export type Measurand =
  | "Current.Export"
  | "Current.Import"
  | "Current.Offered"
  | "Energy.Active.Export.Register"
  | "Energy.Active.Import.Register"
  | "Energy.Reactive.Export.Register"
  | "Energy.Reactive.Import.Register"
  | "Energy.Active.Export.Interval"
  | "Energy.Active.Import.Interval"
  | "Frequency"
  | "Power.Active.Export"
  | "Power.Active.Import"
  | "Power.Factor"
  | "Power.Offered"
  | "Power.Reactive.Export"
  | "Power.Reactive.Import"
  | "RPM"
  | "SoC"
  | "Temperature"
  | "Voltage";

export type SampledValue = {
  value: string;
  context?: string; // "Sample.Periodic" | "Sample.Clock" | "Transaction.Begin" | "Transaction.End"
  format?: "Raw" | "SignedData";
  measurand?: Measurand;
  phase?: "L1" | "L2" | "L3" | "N" | "L1-N" | "L2-N" | "L3-N" | "L1-L2" | "L2-L3" | "L3-L1";
  location?: "Body" | "Cable" | "EV" | "Inlet" | "Outlet";
  unit?: string;
};

export type MeterValueEntry = {
  connectorId: number;
  transactionId?: number;
  timestamp?: string;
  sampledValue: SampledValue[];
};

// ── Configuration keys (OCPP 1.6J § 9 standard set) ─────────────────────────
// Read via GetConfiguration, written via ChangeConfiguration. Values are
// always strings on the wire even when typed (boolean/integer).

export type OcppConfigGroup =
  | "Core"
  | "Local Auth List"
  | "Reservation"
  | "Smart Charging"
  | "Firmware"
  | "Vendor";

export type OcppConfigKey = {
  key: string;
  group: OcppConfigGroup;
  type: "boolean" | "integer" | "csl" | "string"; // CSL = comma-separated list
  unit?: string;
  readonly?: boolean;
  description: string;
};

// OCPP 1.6J Appendix B — Standard Configuration Keys
export const OCPP_STANDARD_CONFIG_KEYS: OcppConfigKey[] = [
  // Core profile
  { key: "AllowOfflineTxForUnknownId", group: "Core", type: "boolean", description: "Allow offline txn for unknown idTag" },
  { key: "AuthorizationCacheEnabled", group: "Core", type: "boolean", description: "Enable cached authorization decisions" },
  { key: "AuthorizeRemoteTxRequests", group: "Core", type: "boolean", description: "Authorize required for RemoteStartTransaction" },
  { key: "BlinkRepeat", group: "Core", type: "integer", unit: "times", description: "LED blink count for visual confirms" },
  { key: "ClockAlignedDataInterval", group: "Core", type: "integer", unit: "s", description: "Wall-clock aligned MeterValues period (0=off)" },
  { key: "ConnectionTimeOut", group: "Core", type: "integer", unit: "s", description: "Auth → plug-in window before timeout" },
  { key: "ConnectorPhaseRotation", group: "Core", type: "csl", description: "Phase rotation per connector (e.g. 0.RST,1.RST)" },
  { key: "ConnectorPhaseRotationMaxLength", group: "Core", type: "integer", readonly: true, description: "Max length of ConnectorPhaseRotation" },
  { key: "GetConfigurationMaxKeys", group: "Core", type: "integer", readonly: true, description: "Max keys per GetConfiguration request" },
  { key: "HeartbeatInterval", group: "Core", type: "integer", unit: "s", description: "Heartbeat period when no other traffic" },
  { key: "LightIntensity", group: "Core", type: "integer", unit: "%", description: "Indicator LED brightness" },
  { key: "LocalAuthorizeOffline", group: "Core", type: "boolean", description: "Use local list when offline" },
  { key: "LocalPreAuthorize", group: "Core", type: "boolean", description: "Skip Authorize when idTag in local list" },
  { key: "MaxEnergyOnInvalidId", group: "Core", type: "integer", unit: "Wh", description: "Allow N Wh after invalid idTag detected" },
  { key: "MeterValuesAlignedData", group: "Core", type: "csl", description: "Measurands sampled on clock-align" },
  { key: "MeterValuesAlignedDataMaxLength", group: "Core", type: "integer", readonly: true, description: "Max measurands in aligned MeterValues" },
  { key: "MeterValuesSampledData", group: "Core", type: "csl", description: "Measurands sampled per interval" },
  { key: "MeterValuesSampledDataMaxLength", group: "Core", type: "integer", readonly: true, description: "Max measurands in sampled MeterValues" },
  { key: "MeterValueSampleInterval", group: "Core", type: "integer", unit: "s", description: "MeterValues sampling period (0=off)" },
  { key: "MinimumStatusDuration", group: "Core", type: "integer", unit: "s", description: "Debounce StatusNotification" },
  { key: "NumberOfConnectors", group: "Core", type: "integer", readonly: true, description: "Physical connector count" },
  { key: "ResetRetries", group: "Core", type: "integer", description: "Reset attempts before giving up" },
  { key: "StopTransactionOnEVSideDisconnect", group: "Core", type: "boolean", description: "Stop txn when cable yanked" },
  { key: "StopTransactionOnInvalidId", group: "Core", type: "boolean", description: "Stop txn when idTag becomes invalid" },
  { key: "StopTxnAlignedData", group: "Core", type: "csl", description: "Measurands in StopTransaction (aligned)" },
  { key: "StopTxnAlignedDataMaxLength", group: "Core", type: "integer", readonly: true, description: "Max measurands aligned at stop" },
  { key: "StopTxnSampledData", group: "Core", type: "csl", description: "Measurands in StopTransaction (sampled)" },
  { key: "StopTxnSampledDataMaxLength", group: "Core", type: "integer", readonly: true, description: "Max measurands sampled at stop" },
  { key: "SupportedFeatureProfiles", group: "Core", type: "csl", readonly: true, description: "Profiles implemented (Core, FirmwareManagement, ...)" },
  { key: "SupportedFeatureProfilesMaxLength", group: "Core", type: "integer", readonly: true, description: "Max profiles" },
  { key: "TransactionMessageAttempts", group: "Core", type: "integer", description: "Max retries for transaction-related messages" },
  { key: "TransactionMessageRetryInterval", group: "Core", type: "integer", unit: "s", description: "Retry backoff" },
  { key: "UnlockConnectorOnEVSideDisconnect", group: "Core", type: "boolean", description: "Auto-unlock when EV unplugged" },
  { key: "WebSocketPingInterval", group: "Core", type: "integer", unit: "s", description: "WS ping interval" },

  // Local Auth List
  { key: "LocalAuthListEnabled", group: "Local Auth List", type: "boolean", description: "Enable local auth list" },
  { key: "LocalAuthListMaxLength", group: "Local Auth List", type: "integer", readonly: true, description: "Max entries in local list" },
  { key: "SendLocalListMaxLength", group: "Local Auth List", type: "integer", readonly: true, description: "Max entries per SendLocalList" },

  // Reservation
  { key: "ReserveConnectorZeroSupported", group: "Reservation", type: "boolean", readonly: true, description: "Connector 0 reserve supported" },

  // Smart Charging
  { key: "ChargeProfileMaxStackLevel", group: "Smart Charging", type: "integer", readonly: true, description: "Max stack level for charging profiles" },
  { key: "ChargingScheduleAllowedChargingRateUnit", group: "Smart Charging", type: "csl", readonly: true, description: "A and/or W" },
  { key: "ChargingScheduleMaxPeriods", group: "Smart Charging", type: "integer", readonly: true, description: "Max periods per schedule" },
  { key: "ConnectorSwitch3to1PhaseSupported", group: "Smart Charging", type: "boolean", readonly: true, description: "Auto 3→1 phase switching supported" },
  { key: "MaxChargingProfilesInstalled", group: "Smart Charging", type: "integer", readonly: true, description: "Concurrent profiles" },

  // Firmware Management — defined elsewhere, no standard config keys per se
];

// ── Recent OCPP messages (timeline) ─────────────────────────────────────────
export type OcppMessageDirection = "in" | "out"; // CP→CS or CS→CP
export type OcppMessageEntry = {
  direction: OcppMessageDirection;
  action: string; // e.g. "BootNotification", "StatusNotification"
  timestamp: string;
  // OCPP correlation Id (UUID)
  callId?: string;
  // brief payload preview (first ~80 chars)
  preview?: string;
};

// ── Authorize log ───────────────────────────────────────────────────────────
export type AuthorizationStatus = "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx";
export type AuthorizationEntry = {
  idTag: string;
  status: AuthorizationStatus;
  expiryDate?: string;
  parentIdTag?: string;
  receivedAt: string;
};

// ── ChargingProfile ─────────────────────────────────────────────────────────
export type ChargingProfilePurpose =
  | "ChargePointMaxProfile"
  | "TxDefaultProfile"
  | "TxProfile";

export type ChargingProfileKind = "Absolute" | "Recurring" | "Relative";

export type ChargingProfile = {
  chargingProfileId: number;
  stackLevel: number;
  chargingProfilePurpose: ChargingProfilePurpose;
  chargingProfileKind: ChargingProfileKind;
  recurrencyKind?: "Daily" | "Weekly";
  validFrom?: string;
  validTo?: string;
  // Schedule periods
  startSchedule?: string;
  duration?: number;
  chargingRateUnit: "A" | "W";
  periods: { startPeriod: number; limit: number; numberPhases?: number }[];
};

// ── Unified action catalogue (research P5 — by effect not transport) ────────
// Each action lists the transports that can perform it. Technician picks a
// transport when both are available; OCPP is preferred (real-time).

export type Transport = "ocpp" | "api";

export type CommandAction = {
  key: string;
  label: string;
  helper: string;
  // Available transports for this action, in preference order
  transports: Array<{
    kind: Transport;
    // Wire descriptor — what would actually fire
    wire: string;
    // Whether this transport is currently available
    available: boolean;
    // Reason if unavailable
    unavailableReason?: string;
  }>;
  destructive?: boolean;
  category: "Session" | "Power" | "Diagnostics" | "Configuration";
};

// Note: OCPP transports always listed but `available: false` since no CSMS
// is wired. API-side availability is driven by Zaptec command rules.

export function buildActionCatalog({
  isCharging,
  isPaused,
  ocppConnected,
}: {
  isCharging: boolean;
  isPaused: boolean;
  ocppConnected: boolean;
}): CommandAction[] {
  const ocpp = (wire: string, ok = true): CommandAction["transports"][number] => ({
    kind: "ocpp",
    wire,
    available: ocppConnected && ok,
    unavailableReason: ocppConnected ? undefined : "OCPP gateway not connected",
  });

  return [
    {
      key: "start-session",
      label: "Start a session",
      helper: "Begin a new charging transaction on this connector.",
      transports: [
        ocpp("RemoteStartTransaction(connectorId, idTag)"),
      ],
      category: "Session",
    },
    {
      key: "stop-session",
      label: "Stop the active session",
      helper: "End the current transaction and release the cable.",
      destructive: true,
      transports: [
        ocpp("RemoteStopTransaction(transactionId)", isCharging),
        {
          kind: "api",
          wire: "POST /api/chargers/{id}/sendCommand/506",
          available: isCharging,
          unavailableReason: isCharging ? undefined : "No active session",
        },
      ],
      category: "Session",
    },
    {
      key: "resume-session",
      label: "Resume a paused session",
      helper: "Continue charging after a pause.",
      transports: [
        ocpp("ClearChargingProfile(stackLevel)", isPaused),
        {
          kind: "api",
          wire: "POST /api/chargers/{id}/sendCommand/507",
          available: isPaused,
          unavailableReason: isPaused ? undefined : "Charger is not paused",
        },
      ],
      category: "Session",
    },
    {
      key: "deauthorize",
      label: "Deauthorize and stop",
      helper: "Stop the session and revoke the authorization.",
      destructive: true,
      transports: [
        ocpp("RemoteStopTransaction(transactionId) + ClearCache"),
        {
          kind: "api",
          wire: "POST /api/chargers/{id}/sendCommand/10001",
          available: true,
        },
      ],
      category: "Session",
    },
    {
      key: "reboot",
      label: "Reboot the charger",
      helper: "Restart the controller. Active session will be interrupted.",
      destructive: true,
      transports: [
        ocpp('Reset({"type":"Hard"})'),
        {
          kind: "api",
          wire: "POST /api/chargers/{id}/sendCommand/102",
          available: true,
        },
      ],
      category: "Diagnostics",
    },
    {
      key: "soft-reset",
      label: "Soft reset",
      helper: "Restart the OCPP stack without rebooting the controller.",
      transports: [ocpp('Reset({"type":"Soft"})')],
      category: "Diagnostics",
    },
    {
      key: "take-offline",
      label: "Take charger offline",
      helper: "Mark the connector as Inoperative so it refuses sessions.",
      destructive: true,
      transports: [
        ocpp('ChangeAvailability({"type":"Inoperative"})'),
      ],
      category: "Configuration",
    },
    {
      key: "bring-online",
      label: "Bring charger online",
      helper: "Mark the connector as Operative.",
      transports: [
        ocpp('ChangeAvailability({"type":"Operative"})'),
      ],
      category: "Configuration",
    },
    {
      key: "unlock-connector",
      label: "Unlock connector",
      helper: "Release the cable lock. Use if the cable is stuck.",
      transports: [ocpp("UnlockConnector(connectorId)")],
      category: "Configuration",
    },
    {
      key: "trigger-status",
      label: "Trigger status update",
      helper: "Ask the charger to re-send a StatusNotification.",
      transports: [
        ocpp('TriggerMessage({"requestedMessage":"StatusNotification"})'),
      ],
      category: "Diagnostics",
    },
    {
      key: "trigger-meter",
      label: "Trigger meter values",
      helper: "Ask the charger to re-send MeterValues now.",
      transports: [
        ocpp('TriggerMessage({"requestedMessage":"MeterValues"})'),
      ],
      category: "Diagnostics",
    },
    {
      key: "get-config",
      label: "Read configuration",
      helper: "Pull all OCPP configuration keys from the charger.",
      transports: [ocpp("GetConfiguration([])")],
      category: "Configuration",
    },
    {
      key: "clear-cache",
      label: "Clear authorization cache",
      helper: "Drop locally cached idTag decisions on the charger.",
      transports: [ocpp("ClearCache()")],
      category: "Configuration",
    },
    {
      key: "firmware-upgrade",
      label: "Update firmware",
      helper: "Schedule a firmware upgrade.",
      destructive: true,
      transports: [
        ocpp("UpdateFirmware(location, retrieveDate)"),
        {
          kind: "api",
          wire: "POST /api/chargers/{id}/sendCommand/200",
          available: true,
        },
      ],
      category: "Diagnostics",
    },
    {
      key: "set-charging-profile",
      label: "Set charging profile",
      helper: "Apply a SmartCharging schedule (current limit / phases).",
      transports: [ocpp("SetChargingProfile(connectorId, csChargingProfiles)")],
      category: "Power",
    },
  ];
}
