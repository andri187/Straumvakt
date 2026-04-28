// Brief one-line descriptions of Easee API surface, observation IDs,
// commands, and OCPP-related fields. Used by /reference/easee-api to
// render a documentation view (label → brief info) instead of dumping
// raw values.
//
// Source of truth for the catalogues themselves is
// docs/reference/integrations/easee.md and the unofficial pyeasee
// const.py. This file curates the human-readable descriptions.

// ── Vendor identity descriptions ─────────────────────────────────────
export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "Vendor name", info: "Norwegian AC charger manufacturer — Home / Charge / One / Up plus Equalizer meter" },
  { label: "Cloud API base", info: "REST front-door + SignalR push hub; AWS-hosted backend" },
  { label: "API style", info: "REST + JSON; JWT login (1 h TTL) with separate refresh-token endpoint" },
  { label: "Hardware models", info: "Home (residential), One (commercial), Charge (legacy), Equalizer (HAN-port meter)" },
  { label: "OCPP versions", info: "1.6J on Home / One by default; 2.0.1 on selected firmwares" },
  { label: "Native data model", info: "Site → Circuit → Charger — maps onto V3 hierarchy with Site → Installation alias" },
  { label: "Credential scope", info: "installation — one JWT (and refresh) per Easee Site, covers all chargers under it" },
];

// ── Endpoint groups — brief info per operation ────────────────────────
export type EndpointInfo = {
  group: string;
  basePath: string;
  operations: Array<{ method: string; suffix: string; info: string }>;
};

export const ENDPOINT_GROUPS: EndpointInfo[] = [
  {
    group: "Authentication",
    basePath: "/api/accounts",
    operations: [
      { method: "POST", suffix: "/login", info: "Username + password → 1 h JWT bearer + refresh token" },
      { method: "POST", suffix: "/refresh_token", info: "Rotate the JWT before expiry" },
      { method: "GET", suffix: "/profile", info: "Authenticated user profile + accessClaims" },
    ],
  },
  {
    group: "Sites",
    basePath: "/api/sites",
    operations: [
      { method: "GET", suffix: "", info: "Sites the account can see — name, address, ratedCurrent" },
      { method: "GET", suffix: "/{siteId}", info: "Site detail + circuits + chargers nested" },
    ],
  },
  {
    group: "Circuits",
    basePath: "/api/sites/{siteId}",
    operations: [
      { method: "GET", suffix: "/circuits", info: "Circuits at this site with rated current and phase config" },
      { method: "GET", suffix: "/circuits/{circuitId}", info: "Circuit detail — fuse rating, grid type, phases" },
      { method: "POST", suffix: "/circuits/{circuitId}/settings", info: "Update circuit settings (operator only)" },
    ],
  },
  {
    group: "Chargers",
    basePath: "/api/chargers",
    operations: [
      { method: "GET", suffix: "", info: "Chargers visible to the authenticated account" },
      { method: "GET", suffix: "/{chargerId}/details", info: "Hardware identity — firmware, serial, model" },
      { method: "GET", suffix: "/{chargerId}/state", info: "Live state snapshot — kW, A, V, opMode" },
      { method: "GET", suffix: "/{chargerId}/config", info: "Configurable settings (config_* observations)" },
      { method: "POST", suffix: "/{chargerId}/commands/start_charging", info: "RemoteStart equivalent" },
      { method: "POST", suffix: "/{chargerId}/commands/stop_charging", info: "RemoteStop equivalent" },
      { method: "POST", suffix: "/{chargerId}/commands/pause_charging", info: "Pause without ending the session" },
      { method: "POST", suffix: "/{chargerId}/commands/resume_charging", info: "Resume from pause" },
      { method: "POST", suffix: "/{chargerId}/commands/reboot", info: "Hard reboot" },
      { method: "POST", suffix: "/{chargerId}/commands/update_firmware", info: "Schedule firmware update" },
      { method: "POST", suffix: "/{chargerId}/dynamic_current", info: "Set per-phase current cap with TTL safeguard" },
      { method: "POST", suffix: "/{chargerId}/settings", info: "Update charger settings (max current, idle, etc.)" },
    ],
  },
  {
    group: "Sessions / CDRs",
    basePath: "/api/chargers",
    operations: [
      { method: "GET", suffix: "/{chargerId}/sessions/ongoing", info: "Currently active session if any" },
      { method: "GET", suffix: "/{chargerId}/sessions/{sessionId}", info: "Single session detail (energy, duration, cost)" },
      { method: "GET", suffix: "/{chargerId}/sessions/monthly", info: "Monthly aggregate per charger" },
    ],
  },
  {
    group: "Equalizer (smart-meter)",
    basePath: "/api/equalizers",
    operations: [
      { method: "GET", suffix: "", info: "Easee Equalizer devices linked to the account" },
      { method: "GET", suffix: "/{equalizerId}/state", info: "Grid import/export per phase — feeds DLB" },
    ],
  },
];

// ── Most-relevant ChargerStreamData observation IDs (signalR stream) ──
export const OBSERVATION_INFO: Record<number, { name: string; info: string }> = {
  // Operation
  31: { name: "config_isEnabled", info: "Bool — charger globally enabled" },
  38: { name: "config_phaseMode", info: "1=locked-1ph / 2=auto / 3=locked-3ph" },
  41: { name: "config_localAuthorizationRequired", info: "Bool — local RFID auth required" },
  42: { name: "config_authorizationRequired", info: "Bool — auth required for any session" },
  44: { name: "config_smartButtonEnabled", info: "Bool — front capacitive button active" },
  45: { name: "config_offlineChargingMode", info: "Behavior when cloud is unreachable" },
  47: { name: "config_maxChargerCurrent", info: "Persistent max current the charger may offer (A)" },
  48: { name: "state_dynamicChargerCurrent", info: "Volatile DLB-allocated current (A) — Zaptec analog: StateId 708" },
  96: { name: "state_reasonForNoCurrent", info: "Enum — why the charger isn't offering current right now" },
  100: { name: "state_pilotMode", info: "Pilot letter A–F per IEC 61851" },
  103: { name: "state_cableLocked", info: "Bool — cable lock motor engaged" },
  109: { name: "state_chargerOpMode", info: "Operation mode integer — analogous to Zaptec StateId 710" },
  110: { name: "state_outputPhase", info: "Bitmask of phases currently energized" },

  // Electrical (live)
  114: { name: "state_outputCurrent", info: "Current the charger is signaling to the car (A)" },
  115: { name: "state_deratedCurrent", info: "Current after thermal derating (A)" },
  116: { name: "state_deratingActive", info: "Bool — currently throttled by thermal limits" },
  120: { name: "state_totalPower", info: "Live import power (kW) — analog to Zaptec StateId 513" },
  111: { name: "state_dynamicCircuitCurrentP1", info: "Live DLB cap on phase 1" },
  112: { name: "state_dynamicCircuitCurrentP2", info: "Live DLB cap on phase 2" },
  113: { name: "state_dynamicCircuitCurrentP3", info: "Live DLB cap on phase 3" },
  22: { name: "config_circuitMaxCurrentP1", info: "Phase 1 circuit fuse rating" },
  23: { name: "config_circuitMaxCurrentP2", info: "Phase 2 circuit fuse rating" },
  24: { name: "config_circuitMaxCurrentP3", info: "Phase 3 circuit fuse rating" },

  // Energy / metering
  121: { name: "state_sessionEnergy", info: "Session-accumulated energy (kWh) — resets per session" },
  122: { name: "state_energyPerHour", info: "Energy delivered in the current hour (kWh)" },
  124: { name: "state_lifetimeEnergy", info: "Lifetime accumulated kWh — NOT OCMF-signed by default" },
  125: { name: "state_lifetimeRelaySwitches", info: "Lifetime relay switches — relay wear indicator" },
  126: { name: "state_lifetimeHours", info: "Total operation hours" },
  129: { name: "state_ChargingSession", info: "JSON of current session — analog to Zaptec StateId 723" },

  // Connectivity
  130: { name: "state_cellRSSI", info: "Cellular RSSI in dBm" },
  131: { name: "state_CellRAT", info: "Cellular radio access tech enum" },
  132: { name: "state_wiFiRSSI", info: "Wi-Fi RSSI in dBm" },
  141: { name: "state_chargerRAT", info: "0=cellular / 1=wifi — current radio in use" },
  81: { name: "state_ICCID", info: "SIM ICCID — only on cellular chargers" },
  220: { name: "state_LTERSRP", info: "LTE RSRP — reference signal received power" },
  221: { name: "state_LTESINR", info: "LTE SINR — signal-to-interference ratio" },

  // Site-level aggregate (master-only) — no Zaptec equivalent
  76: { name: "state_numberOfCarsConnected", info: "Cars connected to this circuit" },
  77: { name: "state_numberOfCarsCharging", info: "Cars currently charging" },
  78: { name: "state_numberOfCarsInQueue", info: "Cars in queue waiting for power" },
  79: { name: "state_numberOfCarsFullyCharged", info: "Cars that appear fully charged" },

  // Authentication
  15: { name: "config_localPreAuthorizeEnabled", info: "Pre-authorize via local list (OCPP key mirror)" },
  16: { name: "config_localAuthorizeOfflineEnabled", info: "Allow whitelisted offline charging (OCPP key mirror)" },
  17: { name: "config_allowOfflineTxForUnknownId", info: "Allow any tap when offline (OCPP key mirror)" },
  108: { name: "state_userIDTokenReversed", info: "RFID UID — NB byte-order reversed; prefer 128" },
  128: { name: "state_userIDToken", info: "RFID UID — corrected version of 108" },
  69: { name: "state_pairedUserIDToken", info: "Token observed during RFID pairing mode" },
  28: { name: "config_rfidAuthTimeoutSec", info: "Backend auth-reply timeout before falling back to offline rules" },

  // Diagnostics
  117: { name: "state_debugString", info: "Free-form debug string" },
  118: { name: "state_errorString", info: "Descriptive error message" },
  119: { name: "state_errorCode", info: "Numeric error code per error-code table" },
  219: { name: "state_fatalErrorCode", info: "Fatal error code — needs intervention" },
  89: { name: "state_rebootReason", info: "Bitmask of last-reboot reasons" },

  // Hardware identity
  80: { name: "state_chargerFirmware", info: "Embedded software release id (boot)" },
  90: { name: "state_powerPCBVersion", info: "Power PCB hardware version" },
  91: { name: "state_comPCBVersion", info: "Communication PCB hardware version" },
  107: { name: "state_backPlateID", info: "Charger back-plate RFID — serves as device identifier" },

  // Temperature (granular — richer than Zaptec)
  150: { name: "state_tempMax", info: "Maximum across all sensors (°C)" },
  151: { name: "state_tempAmbientPowerBoard", info: "Power board ambient (bottom)" },
  166: { name: "state_tempAmbientPowerBoardTop", info: "Power board ambient (top)" },
  170: { name: "state_tempAmbient", info: "COM board ambient" },
  172: { name: "state_intRelHumidity", info: "Internal relative humidity (%)" },
  160: { name: "state_tempOutputN", info: "Type-2 connector pin N temperature" },
  161: { name: "state_tempOutputL1", info: "Type-2 connector pin L1 temperature" },
  162: { name: "state_tempOutputL2", info: "Type-2 connector pin L2 temperature" },
  163: { name: "state_tempOutputL3", info: "Type-2 connector pin L3 temperature" },
  164: { name: "state_tempRelayN", info: "Temp under N relay (Easee One)" },
  165: { name: "state_tempRelayL", info: "Temp under L relay (Easee One)" },

  // Cloud
  250: { name: "state_connectedToCloud", info: "Bool — device is connected to AWS" },
  251: { name: "state_cloudDisconnectReason", info: "AWS DisconnectReason string" },
};

// ── OCPP-related concepts ────────────────────────────────────────────
export const OCPP_INFO: Array<{ label: string; info: string }> = [
  { label: "Default version", info: "OCPP 1.6J over TLS WebSocket on Easee Home / One — pre-2.0.1 transition" },
  { label: "2.0.1 readiness", info: "On selected firmwares; deferred behind ADR 0005 tag A" },
  { label: "Identity convention", info: "Charger serial as identityString — Straumvakt-generated auth_secret pushed via cloud API" },
  { label: "Heartbeat", info: "300 s default — overridable via ChangeConfiguration" },
  { label: "MeterValues cadence", info: "60 s during active session — Energy.Active.Import.Register is the canonical billing meter" },
  { label: "Vendor extensions", info: "DataTransfer with vendor-id com.easee — Equalizer-aware load-balancing payloads" },
];

// ── Adapter status info ───────────────────────────────────────────────
export const ADAPTER_STATUS = {
  state: "Not yet wired" as const,
  description:
    "Sprint 2.7 ships Zaptec first; Easee plugs into the same vendor-credentials scaffolding when an Easee site enters scope. Vendor an OpenAPI snapshot to public/easee/openapi.json (mirror of the Zaptec pattern) and the operations table below auto-renders.",
};
