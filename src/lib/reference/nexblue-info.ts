// Brief descriptions for the NexBlue API reference UI page.
// Mirrors the pattern from zaptec-info.ts / easee-info.ts / alfen-info.ts but
// reflects NexBlue's positioning: Nordic+UK AC residential vendor, OCPP-primary,
// cloud REST API exists but undocumented publicly.
//
// Source of truth for the underlying material is
// docs/reference/integrations/nexblue.md.

// ── Vendor identity ───────────────────────────────────────────────────

export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "V3 schema class", info: "Hardware / Chargers — HardwareVendorKind=charger_ac, SiteAssetKind=charger" },
  { label: "Vendor name", info: "Nordic + UK AC charger maker (NexBlue AS Norway, AB Sweden, Ltd UK, NL office)" },
  { label: "Founded", info: "2021 (per company marketing — unverified against registry)" },
  { label: "Hardware tier", info: "Residential + light commercial / destination AC" },
  { label: "Geographic focus", info: "UK, Norway, Sweden, Netherlands; ISK currency in supported set so Iceland is in scope at the API level" },
  { label: "OCPP versions", info: "1.6J and 2.0.1 — both shipping in firmware ≥ 1.1.2" },
  { label: "Cloud REST API", info: "Public OpenAPI 3.0.2 at prod-management.nexblue.com/swagger/dist/index.html — see nexblue-openapi.json companion" },
  { label: "Distinctive features", info: '"Local OCPP" — client runs on charger, no NexBlue gateway in path. Always-on connectivity (Eth + Wi-Fi + 4G eSIM). iF Design Award 2024' },
  { label: "Connector standard", info: "Type 2 only — no DC/CCS chargers in the lineup" },
  { label: "Credential scope (V3)", info: "installation once a partner OAuth2 client is provisioned; per-customer installer login as fallback" },
];

// ── Models in scope ───────────────────────────────────────────────────

export const MODELS: Array<{ model: string; phase: string; mid: string; ocmf: string; iso15118: string; info: string }> = [
  { model: "Point", phase: "1-ph ≤ 7.4 kW", mid: "?", ocmf: "?", iso15118: "No", info: "Residential, UK focus (legacy)" },
  { model: "Point 2", phase: "1-ph ≤ 7.4 kW", mid: "Yes", ocmf: "?", iso15118: "Ready", info: "IP54/IK10, PEN fault detection, RDC-DD 6 mA DC" },
  { model: "Edge", phase: "1- or 3-ph ≤ 22 kW", mid: "No", ocmf: "No", iso15118: "No", info: "Entry tier; original Edge has no Ethernet" },
  { model: "Edge 2", phase: "1- or 3-ph ≤ 22 kW", mid: "No", ocmf: "No", iso15118: "Hardware-ready", info: "Adds Ethernet RJ45; remote 1p↔3p phase switch via cloud API" },
  { model: "Edge Max", phase: "1- or 3-ph ≤ 22 kW", mid: "Yes (Class B ±1%)", ocmf: "?", iso15118: "Ready (V2G + PnC)", info: "OLED display; small-site billing-grade tier" },
  { model: "Delta", phase: "1- or 3-ph ≤ 22 kW", mid: "?", ocmf: "?", iso15118: "V2G ready", info: "" },
  { model: "Delta Max", phase: "1- or 3-ph 1.4–22 kW", mid: "Yes (Class B)", ocmf: "?", iso15118: "Ready (V2G + PnC)", info: "Display, premium tier" },
];

// ── Cloud surfaces ────────────────────────────────────────────────────

export const CLOUD_SURFACES: Array<{ surface: string; info: string }> = [
  { surface: "Partner Portal (web)", info: "partner.nexblue.com — installer / fleet operator console" },
  { surface: "Partner App (iOS + Android)", info: "Installer BLE/Wi-Fi commissioning + OCPP URL change" },
  { surface: "myNexBlue App (iOS + Android)", info: "End-user start/stop, Customized OCPP platform setting" },
  { surface: "User Portal (web)", info: "Linked from nexblue.com/pages/nexblue-user-portal — subdomain unverified" },
  { surface: "Help Center", info: "nexblue.com/apps/hc/... — RFID, eSIM, troubleshooting, commissioning" },
  { surface: "Integration guides", info: "nexblue.com/pages/integration-guide — per-CPMS recipes (E-Flux, Monta, Fuuse, Wevo, generic OCPP)" },
];

// ── REST API — public OpenAPI 3.0.2 ───────────────────────────────────

export const REST_API_FACTS: Array<{ label: string; info: string }> = [
  { label: "Public OpenAPI", info: "Yes — 3.0.2 at prod-management.nexblue.com/swagger/dist/index.html. Snapshot in docs/reference/integrations/nexblue-openapi.json" },
  { label: "Base URL", info: "https://api.nexblue.com/third_party (all paths under /openapi/...)" },
  { label: "Auth — OAuth2", info: "authorization_code flow (no PKCE) at /openapi/oauth2/authorize + /openapi/oauth2/token. Grants: authorization_code, refresh_token, client_credentials" },
  { label: "Auth — username/password", info: "POST /openapi/account/login with { username, password, account_type } (0=end_user, 1=installer) → access_token + refresh_token" },
  { label: "Token transport", info: "Authorization header (declared as apiKey in the spec, NOT bearer — case-sensitive)" },
  { label: "Token lifetime", info: "access_token 3600 s default · refresh_token 30 days" },
  { label: "Endpoint count", info: "14 across 6 tags: oauth2_endpoint, account, charger, charger commands, charger sessions, energy reporting" },
  { label: "Charger state enum", info: "0=idle, 1=connected, 2=charging, 3=finished, 4=error, 5=lb_waiting, 6=delay_waiting, 7=ev_waiting" },
  { label: "Push channel", info: "None — no webhooks, no SSE, no WebSocket subscription. Clients poll /cmd/status + /sessions/charger/{id}" },
  { label: "OCPP URL — read", info: "Yes via ChargerDetail.ocpp_data when device_operator_type=3 (OCPP)" },
  { label: "OCPP URL — write", info: "NOT exposed in the OpenAPI — remains a Partner App / myNexBlue App action" },
  { label: "Operator-tag enum", info: "33 known partner CPMSs (Monta, Wevo, Fuuse, Spirii, eMabler, ...). CustomOCPP=4 catch-all for unenumerated partners" },
  { label: "Currency support", info: "12 currencies including ISK (Iceland), DKK, NOK, GBP, SEK, EUR, USD — direct relevance to Straumvakt" },
];

// ── REST API endpoints ────────────────────────────────────────────────

export const REST_API_ENDPOINTS: Array<{ method: string; path: string; tag: string; info: string }> = [
  { method: "GET",    path: "/openapi/oauth2/authorize",                            tag: "oauth2_endpoint",   info: "OAuth2 authorize endpoint (no PKCE)" },
  { method: "POST",   path: "/openapi/oauth2/token",                                tag: "oauth2_endpoint",   info: "OAuth2 token exchange — auth_code / refresh / client_credentials" },
  { method: "POST",   path: "/openapi/account/login",                               tag: "account",           info: "Username/password login (end_user or installer)" },
  { method: "POST",   path: "/openapi/account/refresh_token",                       tag: "account",           info: "Refresh access token" },
  { method: "GET",    path: "/openapi/chargers",                                    tag: "charger",           info: "List chargers the principal can use" },
  { method: "GET",    path: "/openapi/chargers/{charger_id}",                       tag: "charger",           info: "Charger detail — serial, role, place, circuit, online, product, OCPP data" },
  { method: "GET",    path: "/openapi/chargers/{charger_id}/cmd/status",            tag: "charger commands",  info: "Current status + configuration" },
  { method: "POST",   path: "/openapi/chargers/{charger_id}/cmd/start_charging",    tag: "charger commands",  info: "Start a charging session as the current user" },
  { method: "POST",   path: "/openapi/chargers/{charger_id}/cmd/stop_charging",     tag: "charger commands",  info: "Stop the charging session" },
  { method: "POST",   path: "/openapi/chargers/{charger_id}/cmd/set_current_limit", tag: "charger commands",  info: "Set the current limit" },
  { method: "GET",    path: "/openapi/chargers/{charger_id}/cmd/schedule",          tag: "charger commands",  info: "Get schedule details" },
  { method: "PUT",    path: "/openapi/chargers/{charger_id}/cmd/schedule",          tag: "charger commands",  info: "Add / update a schedule item" },
  { method: "DELETE", path: "/openapi/chargers/{charger_id}/cmd/schedule",          tag: "charger commands",  info: "Delete a schedule item" },
  { method: "PUT",    path: "/openapi/chargers/{charger_id}/cmd/schedule/config",   tag: "charger commands",  info: "Update schedule configuration" },
  { method: "GET",    path: "/openapi/sessions/charger/{charger_id}",               tag: "charger sessions",  info: "Chargelogs — Installer/Owner all sessions; invited users see only their own" },
  { method: "GET",    path: "/openapi/measurement/chargers/{charger_id}",           tag: "energy reporting",  info: "Aggregated kWh consumption (hourly / daily granularity)" },
];

// ── REST API — gaps relative to a partner-CPMS shape ──────────────────

export const REST_API_GAPS: Array<{ missing: string; info: string }> = [
  { missing: "POST /openapi/places", info: "No way to create a Place via API — must be done through Partner App on-site commissioning" },
  { missing: "POST /openapi/circuits", info: "Same — circuit topology is set during commissioning" },
  { missing: "User invitation / role assignment", info: "No /users or /places/{id}/users. Owner adds users via the Partner Portal / app" },
  { missing: "RFID list management", info: "Not in the OpenAPI. RFID is managed in the app; under OCPP, delegated to CSMS via Authorize" },
  { missing: "Set OCPP backend URL", info: "Not exposed as a write endpoint — readable only via ChargerDetail.ocpp_data" },
  { missing: "Webhook subscription", info: "None. Clients poll /cmd/status and /sessions/charger/{id}" },
  { missing: "Fleet metrics across chargers", info: "Energy reporting is per-charger only — Straumvakt aggregates client-side" },
];

// ── OCPP — primary path ───────────────────────────────────────────────

export const OCPP_FACTS: Array<{ label: string; info: string }> = [
  { label: "Versions", info: "1.6J and 2.0.1 — first-class on every current model" },
  { label: "Transport", info: "WebSocket (WS / WSS)" },
  { label: "Topology", info: 'Charger → operator CSMS direct, no NexBlue gateway in path ("Local OCPP")' },
  { label: "Backend URL configurability", info: "Yes, OTA via myNexBlue App or Partner App" },
  { label: "OCPP auth", info: "Basic-Auth username + password (key) — exact field names unverified" },
  { label: "Charger firmware floor", info: "≥ 1.1.2" },
  { label: "Partner App floor", info: "≥ 3.3.1" },
  { label: "myNexBlue App floor", info: "≥ 3.2.0" },
  { label: "Activation UI label", info: '"Customized OCPP platform" once activated' },
];

// ── Onboarding — two-step ─────────────────────────────────────────────

export const ONBOARD_STEPS: Array<{ step: string; info: string }> = [
  { step: "Step 1.1 — Installer scans QR / enters PIN", info: "Partner App; PIN comes from the install manual sticker" },
  { step: "Step 1.2 — BLE/Wi-Fi pairing", info: "Local pairing on-site" },
  { step: "Step 1.3 — Attach to customer Wi-Fi", info: "Or defer to the eSIM 4G fallback" },
  { step: "Step 1.4 — Set phase rotation", info: "1p / 3p mode" },
  { step: "Step 1.5 — Register in Partner Portal", info: "Charger appears under customer's location" },
  { step: "Step 2.1 — Open 'Install OCPP' in app", info: "Installer in Partner App OR end-user in myNexBlue" },
  { step: "Step 2.2 — Enter Straumvakt wss URL + ID + auth key", info: "Copy-paste from operator wizard" },
  { step: "Step 2.3 — Save → charger reconnects", info: "Within seconds, no electrician revisit required" },
];

// ── End-user authentication ───────────────────────────────────────────

export const END_USER_AUTH: Array<{ mode: string; info: string }> = [
  { mode: "RFID (ISO/IEC 14443)", info: "Yes — admin and guest card classes, one card shipped per unit" },
  { mode: "Mobile NFC", info: "Yes (compatible 14443 emulation)" },
  { mode: "myNexBlue app start/stop", info: "Yes (cloud-relayed)" },
  { mode: "Plug-and-Charge (ISO 15118-2)", info: "'Hardware ready' on Edge 2, Edge Max, Delta, Delta Max — Monta claims it works on Edge today; validate per firmware" },
  { mode: "ISO 15118-20 (V2G)", info: "Marketed as future, not certified" },
  { mode: "Free-vend / no-auth", info: "Unverified, probably configurable in commissioning" },
];

// ── Local interface ───────────────────────────────────────────────────

export const LOCAL_INTERFACE: Array<{ interfaceLabel: string; info: string }> = [
  { interfaceLabel: "Modbus TCP / RTU", info: "Unverified — no public Nexblue Modbus document surfaced" },
  { interfaceLabel: "Local web UI", info: "Unverified — no screenshots indexed; configuration is via the mobile apps" },
  { interfaceLabel: "Service tech BLE", info: "Yes — via Partner App; pulls PIN from Portal if lost" },
  { interfaceLabel: "External CT clamp", info: "Yes — for load balancing on the mains feed" },
  { interfaceLabel: "Smart-meter input", info: "Pairs with Zen Smart Meter P1 (Dutch P1 port) — proprietary EMS signal, not Modbus" },
  { interfaceLabel: "Nexus RF (sub-GHz)", info: "Proprietary, undocumented; possibly cluster load-balancing" },
];

// ── Adapter status ────────────────────────────────────────────────────

export const ADAPTER_STATUS = {
  state: "Not yet wired" as const,
  description:
    "NexBlue publishes a public OpenAPI 3.0.2 at prod-management.nexblue.com/swagger/dist (snapshot in nexblue-openapi.json). The shape is end-user / installer / owner — 14 endpoints across login, charger detail, charger commands, sessions (chargelogs), and energy aggregation. There are NO endpoints to create a Place, register users, manage RFID, or write the OCPP backend URL — those remain Partner App actions. The integration path Straumvakt should commit to is OCPP 1.6J / 2.0.1 as the live channel, with the public REST as a side-channel for chargelog ingest, energy reconciliation, and remote start/stop. Onboarding is two-step: on-site BLE/Wi-Fi commissioning by a trained installer, then OTA OCPP-URL flip from the customer's phone.",
};
