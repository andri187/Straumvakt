// Brief descriptions for the Alfen API reference UI page. Mirrors the
// pattern from zaptec-info.ts and easee-info.ts but inverts ordering —
// onboarding leads, vendor identity follows. This reflects Alfen's
// structural difference: onboarding decisions are made before any code
// runs, so the reference must surface them first.
//
// Source of truth for the underlying material is
// docs/reference/integrations/alfen.md.

// ── Onboarding decision matrix (§1.1 of alfen.md) ─────────────────────

export type OnboardScenario = {
  scenario: string;
  ota: "yes" | "no" | "partial";
  path: string;
  leadTime: string;
};

export const ONBOARD_SCENARIOS: OnboardScenario[] = [
  {
    scenario: "Factory-fresh charger, no prior backoffice",
    ota: "no",
    path: "On-site ACE Service Installer",
    leadTime: "Hours + scheduling",
  },
  {
    scenario: "Factory-fresh + customer VPN to charger LAN",
    ota: "yes",
    path: "Remote ACE Service Installer over VPN",
    leadTime: "~30 min per charger",
  },
  {
    scenario: "Migration from another CPO, outgoing op cooperates",
    ota: "yes",
    path: "Outgoing op pushes ChangeConfiguration over OCPP",
    leadTime: "Hours-to-days (their schedule)",
  },
  {
    scenario: "Migration, no cooperation, no VPN",
    ota: "no",
    path: "On-site ACE Service Installer",
    leadTime: "Field tech visit",
  },
  {
    scenario: "Migration, no cooperation, with VPN",
    ota: "yes",
    path: "Remote ACE Service Installer over VPN",
    leadTime: "~30 min per charger",
  },
  {
    scenario: "Currently on Alfen ICU Connect",
    ota: "yes",
    path: "Asset owner asks Alfen to redirect via ICU Connect",
    leadTime: "Days (Alfen support flow)",
  },
];

// ── Onboarding playbook — Path A (on-site / VPN) ──────────────────────

export const PATH_A_STEPS: Array<{ step: string; info: string }> = [
  { step: "1. Connect ACE Service Installer", info: "Windows-only — physical LAN or VPN to the charger's network" },
  { step: "2. Authenticate", info: "Installer password set at commissioning" },
  { step: "3. Snapshot current config", info: "Save .dat file — rollback insurance" },
  { step: "4. Wait for idle", info: "Reboot during a session kills it; confirm Available status first" },
  { step: "5. Update OCPP settings", info: "BackofficeUrl, BackofficeUrlIdentity, BackofficeUrlPassword, OcppVersion" },
  { step: "6. Save and reboot", info: "ACE prompts; reboot can be triggered from ACE or front panel" },
  { step: "7. Verify dial-in", info: "BootNotification(Accepted) within ~60s on the new CSMS" },
];

// ── Onboarding playbook — Path B (outgoing operator cooperates) ───────

export const PATH_B_OCPP_CALLS: Array<{ message: string; payload: string }> = [
  {
    message: "ChangeConfiguration",
    payload: '{ "key": "BackofficeUrl", "value": "wss://straumvakt-ocpp.../ocpp/<id>" }',
  },
  {
    message: "ChangeConfiguration",
    payload: '{ "key": "BackofficeUrlIdentity", "value": "<id>" }',
  },
  {
    message: "ChangeConfiguration",
    payload: '{ "key": "BackofficeUrlPassword", "value": "<basic-auth>" }',
  },
  {
    message: "Reset",
    payload: '{ "type": "Hard" }',
  },
];

// ── Verification checklist (§1.8) ─────────────────────────────────────

export const VERIFY_CHECKLIST: Array<{ check: string; info: string }> = [
  { check: "BootNotification accepted", info: "Firmware, model, serial, ICCID match inventory" },
  { check: "Heartbeat cadence", info: "Arrives every HeartbeatInterval (default 300 s)" },
  { check: "StatusNotification per connector", info: "status=Available, errorCode=NoError" },
  { check: "MeterValues during a test session", info: "Energy.Active.Import.Register accumulates; OCMF receipt arrives at stop (Eichrecht models)" },
  { check: "Authorize round-trip", info: "Test RFID card returns idTagInfo.status=Accepted" },
  { check: "Multi-socket", info: "Repeat session test on connector 2 (Eve Double, Twin 4XL)" },
  { check: "Local Auth List version match", info: "Version on charger matches what Straumvakt last pushed" },
  { check: "Modbus TCP readable (if ALB licensed)", info: "Port 502, slave addresses 200/201" },
];

// ── Vendor identity ───────────────────────────────────────────────────

export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "Vendor name", info: "Dutch AC charger manufacturer (Almere) — Eve Single / Double Pro-line, Twin 4XL" },
  { label: "Cloud API base", info: "None — Alfen does not publish a Cloud REST API for third-party CPOs" },
  { label: "API style", info: "OCPP-primary; Modbus TCP optional (paid ALB license); ACE Service Installer for commissioning" },
  { label: "Hardware platform", info: "NG9xx (current) — AHP (Alfen Hardware Platform) is the successor track" },
  { label: "Firmware track", info: "NG9xx 7.x (7.3.0 latest as of 2026-04)" },
  { label: "OCPP versions", info: "1.5J, 1.6J, and 2.0.1 — one of few AC vendors shipping 2.0.1 in production" },
  { label: "Native data model", info: "Charger → Connector(s) — Eve Double Pro-line and Twin 4XL are multi-socket" },
  { label: "Credential scope", info: "none — OCPP-only adapter, no vendor API credentials to store" },
  { label: "OCMF support", info: "Yes on Eichrecht-certified models; embedded in StopTransaction.transactionData" },
];

// ── Integration paths ─────────────────────────────────────────────────

export const INTEGRATION_PATHS: Array<{ path: string; info: string }> = [
  {
    path: "OCPP 1.6J / 2.0.1 over WSS",
    info: "Primary — charger talks OCPP directly to operator's CSMS. No vendor cloud in the middle.",
  },
  {
    path: "ICU Connect",
    info: "Alfen's own subscription backoffice. Customer-facing, not a developer API. Third-party CPOs typically don't use it.",
  },
  {
    path: "Modbus TCP",
    info: "On-prem local-network access. Default port 502. Paid Active Load Balancing license required.",
  },
  {
    path: "ACE Service Installer",
    info: "Windows desktop tool used at commissioning. Requires LAN access + installer password. Not scriptable.",
  },
];

// ── OCPP-relevant config keys (Alfen-specific extensions) ─────────────

export const OCPP_CONFIG_KEYS: Array<{ key: string; rw: string; info: string }> = [
  { key: "BackofficeUrl", rw: "RW (RebootRequired)", info: "WebSocket URL the charger dials" },
  { key: "BackofficeUrlIdentity", rw: "RW (RebootRequired)", info: "Basic-Auth username (typically equals chargePointId)" },
  { key: "BackofficeUrlPassword", rw: "RW (RebootRequired)", info: "Basic-Auth password — write-only on read-back" },
  { key: "OcppVersion", rw: "RW (RebootRequired)", info: "1.6J / 1.5J / 2.0.1" },
  { key: "OcppMeasurands", rw: "RW", info: "Measurands sent in MeterValues (vendor extension over MeterValuesSampledData)" },
  { key: "WebSocketPingInterval", rw: "RW", info: "Default 60 s" },
  { key: "MaxCurrentSocket1", rw: "RW", info: "Per-socket hardware ceiling (A)" },
  { key: "MaxCurrentSocket2", rw: "RW", info: "Per-socket hardware ceiling (multi-socket only)" },
  { key: "ActiveLoadBalancingLicense", rw: "RO", info: "Activated / NotActivated — affects Modbus TCP availability" },
  { key: "MeterReadingFrequency", rw: "RW", info: "Internal meter read cadence — separate from MeterValueSampleInterval" },
  { key: "PlugAndChargeEnabled", rw: "RW", info: "Plug & Charge support (when firmware allows)" },
  { key: "RandomDelayMaxSeconds", rw: "RW", info: "Smart-charging anti-correlation jitter" },
  { key: "BootBackoffMin", rw: "RW", info: "Reconnect backoff minimum after CSMS loss" },
  { key: "BootBackoffMax", rw: "RW", info: "Reconnect backoff maximum after CSMS loss" },
  { key: "LocalListVersion", rw: "RO", info: "Mirror of OCPP LocalAuthListVersion" },
];

// ── Modbus TCP overview (light — defer to PDF for register addresses) ─

export const MODBUS_INFO: Array<{ label: string; info: string }> = [
  { label: "Activation", info: "Paid Active Load Balancing license + ACE Service Installer enable" },
  { label: "Firmware floor", info: "NG9xx 4.2.0 minimum, 6.4.0+ recommended" },
  { label: "Default port", info: "502 (TCP)" },
  { label: "Slave addresses", info: "200 = socket 1 · 201 = socket 2 (multi-socket only)" },
  { label: "Read scope (per socket)", info: "Per-phase voltages, currents, real/apparent/reactive power, energies, power factor, frequency, meter state, derived car-state" },
  { label: "Write scope (per socket)", info: "Max current cap (A) + valid time (TTL) + phase mode (1ph / 3ph)" },
  { label: "Polling cadence", info: "30 s default; 10 s on healthy hardware; sub-second unsupported" },
  { label: "Authoritative reference", info: "Modbus Slave TCP/IP — Implementation for Alfen NG9xx platform (PDF, knowledge.alfen.com)" },
];

// ── Adapter status ────────────────────────────────────────────────────

export const ADAPTER_STATUS = {
  state: "Not yet wired" as const,
  description:
    "No public Cloud API exists, so the Alfen 'adapter' is the OCPP gateway path itself (straumvakt-ocpp). When an Alfen customer enters scope, add a hardware.vendors row for slug=alfen with apiKind=none, register the chargers' OCPP identities, and the existing gateway carries the work. No new vendor-credentials scaffolding required.",
};
