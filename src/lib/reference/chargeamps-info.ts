// Brief descriptions for the Charge Amps API reference UI page.
// Mirrors the pattern from zaptec-info.ts / easee-info.ts but reflects
// Charge Amps' positioning: Swedish AC vendor, EAPI public-Swagger-documented,
// partner portal flips OCPP URL OTA, OCPP 1.6J only.
//
// Source of truth for the underlying material is
// docs/reference/integrations/chargeamps.md.

// ── Vendor identity ───────────────────────────────────────────────────

export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "V3 schema class", info: "Hardware / Chargers — HardwareVendorKind=charger_ac, SiteAssetKind=charger" },
  { label: "Legal name", info: "Charge Amps AB" },
  { label: "Country / HQ", info: "Sweden — Solna / Stockholm region" },
  { label: "Founded", info: "2012 by Fredrik Jonsson; cloud service since 2016" },
  { label: "Hardware tier", info: "Residential + light commercial AC (no DC product line)" },
  { label: "Geographic focus", info: "Nordics + EU; sales across ~15 markets, ~120 employees in 7 countries" },
  { label: "Ownership", info: "Acquired (or to be acquired) by NaaS Technology Inc. — announced August 2023" },
  { label: "OCPP version", info: "1.6J only — no 2.0.1 yet" },
  { label: "Connector standard", info: "Type 2 only (AC), with Schuko auxiliary outlet on Halo" },
  { label: "Cold-climate suitability", info: "Halo cable rated to -25 °C; Aura -30 °C to +45 °C — fine for Iceland" },
  { label: "Distinctive features", info: "Made-in-Sweden, recycled-aluminium enclosures, design by Joachim Nordwall (ex-Koenigsegg)" },
  { label: "Credential scope (V3)", info: "installation — partner-issued EAPI key + service-account email/password" },
];

// ── Models in scope ───────────────────────────────────────────────────

export const MODELS: Array<{ model: string; power: string; connector: string; mid: string; rcd: string; info: string }> = [
  { model: "Halo (residential flagship)", power: "3.7 / 7.4 / 11 kW (1P or 3P, 6–32 A)", connector: "Fixed Type 2 5.5 m or 7.5 m + Schuko aux", mid: "Unverified", rcd: "Type A + DC residual", info: "IP66/IK10. Schuko is local-logic only — NOT a separate OCPP connectorId. Don't bill via OCPP CDRs" },
  { model: "Aura (commercial dual)", power: "2 × 22 kW (3P 32 A per socket)", connector: "2 × Type 2 socket (BYO cable)", mid: "Yes — per socket", rcd: "Type A + integrated DC fault per socket", info: "connectorId 1 + 2 under OCPP. Some early-FW reports of connectorId 2 transaction issues — require recent FW" },
  { model: "Dawn (commercial pillar)", power: "≤ 22 kW (3P 32 A)", connector: "Single Type 2 socket", mid: "Yes", rcd: "Type B (full DC fault)", info: "IP54/IK10. Wall or floor-pillar mount" },
  { model: "Dawn Professional DE", power: "≤ 22 kW", connector: "Type 2", mid: "Yes", rcd: "Type B", info: "Fully Eichrecht-certified — implies OCMF, transport unverified" },
  { model: "Alpha (legacy)", power: "—", connector: "—", mid: "—", rcd: "—", info: "Older model; not part of OCPP migration. Treat as unsupported unless customer brings one" },
  { model: "Luna (emerging)", power: "—", connector: "—", mid: "—", rcd: "—", info: "Newer; appears in OCPP community discussions. Sensors not fully populated by integrators yet" },
];

// ── Cloud surfaces ────────────────────────────────────────────────────

export const CLOUD_SURFACES: Array<{ surface: string; info: string }> = [
  { surface: "Charge Amps Cloud — end user", info: "https://my.charge.space/ — drivers / charger owners" },
  { surface: "Charge Amps Cloud — admin", info: "https://my.charge.space/admin/ — site / fleet admins" },
  { surface: "Charge Amps Cloud — partner", info: "https://my.charge.space/partner/ — CPO / installer (CPMS integrators)" },
  { surface: "Marketing / overview", info: "https://www.chargeamps.com/cloud/" },
  { surface: "Knowledge base", info: "https://support-se.zendesk.com/hc/en-us/" },
  { surface: "Mobile apps", info: '"Charge Amps" / "My Charge Space" — iOS + Android' },
  { surface: "Become a Partner", info: "https://www.chargeamps.com/become-a-partner/ — self-signup, ~24 h working approval" },
];

// ── REST API — the EAPI ───────────────────────────────────────────────

export const EAPI_FACTS: Array<{ label: string; info: string }> = [
  { label: "Base URL", info: "https://eapi.charge.space" },
  { label: "Path prefix", info: "/api/v5/... (current; v4 paths exist historically)" },
  { label: "Swagger UI", info: "https://eapi.charge.space/swagger" },
  { label: "Auth — secret 1", info: "apiKey — issued by Charge Amps Support to a partner; sent as request header on every call" },
  { label: "Auth — secret 2", info: "Service account email + password — typically a partner-org account" },
  { label: "Token", info: "JWT, valid 120 min. Decoded client-side without verification; treat as opaque, read exp only" },
  { label: "Refresh", info: "POST /api/v5/auth/refreshToken with current token + refreshToken; refresh ~30 s before exp" },
  { label: "On 401", info: "Clear token and full re-login from scratch (not just refresh)" },
  { label: "Push channel", info: "None — EAPI publishes no webhook / SignalR / WebSocket subscription endpoint. Polling only" },
  { label: "Pagination", info: "chargingsessions uses startTime/endTime window filtering; no documented cursor pagination" },
  { label: "Sandbox", info: "None — partners test against production with their apiKey + a test charger or virtual charge point" },
];

// ── EAPI v5 endpoints ─────────────────────────────────────────────────

export const EAPI_ENDPOINTS: Array<{ method: string; path: string; info: string }> = [
  { method: "POST", path: "/api/v5/auth/login", info: "Initial login (apiKey header + email/password body) → JWT + refreshToken" },
  { method: "POST", path: "/api/v5/auth/refreshToken", info: "Refresh JWT" },
  { method: "GET", path: "/api/v5/chargepoints/owned", info: "List all chargepoints owned by the authenticated principal" },
  { method: "GET", path: "/api/v5/chargepoints/{id}/status", info: "Real-time status of a chargepoint and its connectors" },
  { method: "GET", path: "/api/v5/chargepoints/{id}/settings", info: "Chargepoint-level settings (dimmer, downlight)" },
  { method: "PUT", path: "/api/v5/chargepoints/{id}/settings", info: "Update chargepoint-level settings" },
  { method: "GET", path: "/api/v5/chargepoints/{id}/connectors/{connectorId}/settings", info: "Connector-level settings (mode, RFID lock, cable lock, max current)" },
  { method: "PUT", path: "/api/v5/chargepoints/{id}/connectors/{connectorId}/settings", info: "Update connector settings" },
  { method: "PUT", path: "/api/v5/chargepoints/{id}/connectors/{connectorId}/remotestart", info: "Remote start (with optional StartAuth body for RFID context)" },
  { method: "PUT", path: "/api/v5/chargepoints/{id}/connectors/{connectorId}/remotestop", info: "Remote stop" },
  { method: "GET", path: "/api/v5/chargepoints/{id}/chargingsessions", info: "Sessions list — supports startTime / endTime query parameters" },
  { method: "GET", path: "/api/v5/chargepoints/{id}/chargingsessions/{sessionId}", info: "Single session detail" },
  { method: "PUT", path: "/api/v5/chargepoints/{id}/reboot", info: "Reboot the charge point" },
];

// ── OCPP support ──────────────────────────────────────────────────────

export const OCPP_FACTS: Array<{ label: string; info: string }> = [
  { label: "Version", info: "OCPP 1.6J across Halo, Aura, Dawn — no 2.0.1 yet" },
  { label: "Migration story", info: "During 2024 Charge Amps moved its fleet from proprietary 'CAPI' to OCPP 1.6J via firmware OTA. CAPI-only chargers must be upgraded by Charge Amps Support before they can speak OCPP" },
  { label: "Configurable backend URL — local", info: "Wi-Fi hotspot at 192.168.250.1 with the supplied PIN" },
  { label: "Configurable backend URL — OTA", info: "Yes via partner portal at my.charge.space/partner/ — the differentiator" },
  { label: "Charger ID", info: "OCPP chargePointId = device serial" },
  { label: "Authorization key", info: "OCPP AuthorizationKey = the per-charger password exposed in the EAPI ChargePoint.password field" },
  { label: "Firmware floor", info: "OCPP support requires firmware ≥ 158; Halo fw184+ recommended (connection watchdog, ISO15118 BCB wakeup)" },
  { label: "CAPI ↔ OCPP", info: "Mutually exclusive — Halo cannot maintain simultaneous Cloud and OCPP. Customers lose the Charge Amps app's live-control features when moving to Straumvakt" },
];

// ── Onboarding — partner cloud → Straumvakt (OTA) ─────────────────────

export const ONBOARD_STEPS: Array<{ step: string; info: string }> = [
  { step: "1. Partner registration", info: "Self-register at my.charge.space/partner/ — approval up to 24 working hours" },
  { step: "2. EAPI apiKey (optional)", info: "Apply separately via Charge Amps Support if Straumvakt wants programmatic fleet metadata" },
  { step: "3. Charger provisioning by installer", info: "Commission, join Wi-Fi or 4G, register under an Admin organisation in Charge Amps Cloud" },
  { step: "4. Bulk import (optional)", info: "Admins can upload a CSV of chargers in the Admin interface" },
  { step: "5. OCPP cutover (OTA)", info: "Partner / Admin flips the charger's OCPP URL to Straumvakt's wss:// — Charge Amps pushes config OTA, charger reboots and reconnects" },
  { step: "6. Verify reconnection", info: "Charger goes offline briefly and reappears automatically — no on-site visit required" },
  { step: "7. Firmware update path", info: "Partners can trigger firmware upgrades via Partner Portal — keep Halo on fw184+" },
];

// ── End-user authentication ───────────────────────────────────────────

export const END_USER_AUTH: Array<{ mode: string; info: string }> = [
  { mode: "RFID (MIFARE Type A 13.56 MHz)", info: "Built-in on Halo, Aura, Dawn. Aura RF reader 31 dBm" },
  { mode: "Cards/tags managed via", info: "Charge Amps Cloud (Admin UI) when on CAPI; CSMS (Straumvakt) when on OCPP — idTag flows in Authorize / StartTransaction" },
  { mode: "Mobile app start/stop", info: "Charge Amps / My Charge Space — becomes a viewer once a third-party CPMS is in front via OCPP" },
  { mode: "Plug & Charge", info: "Halo fw184 added ISO 15118 BCB-wakeup; full ISO 15118 PnC unverified (1.6J doesn't carry it natively)" },
  { mode: "App-based start without RFID", info: "Yes via EAPI remotestart — accepts a StartAuth body to inject an RFID-equivalent identifier for traceability" },
];

// ── Local interface ───────────────────────────────────────────────────

export const LOCAL_INTERFACE: Array<{ interfaceLabel: string; info: string }> = [
  { interfaceLabel: "Local web UI", info: "Wi-Fi hotspot mode (HALO-<serial> SSID) → browser to 192.168.250.1 → PIN from supplied letter. Used for first-time Wi-Fi join and OCPP URL config" },
  { interfaceLabel: "Modbus TCP", info: "Unverified — no public Modbus register map. evcc lists Charge Amps via Cloud REST API, not Modbus TCP" },
  { interfaceLabel: "Service / installer", info: "Same local web UI + partner portal. No separate installer-only port like Alfen's service connector" },
  { interfaceLabel: "Sidecar — Amp Guard / Power Guard", info: "Separate dynamic-load-management module for household current limiting. Configured through Charge Amps Cloud — relevant if customer wants DLM that survives the OCPP cutover" },
];

// ── OCMF / Eichrecht ──────────────────────────────────────────────────

export const OCMF_FACTS: Array<{ model: string; mid: string; ocmf: string }> = [
  { model: "Halo", mid: "Unverified (not on public product page)", ocmf: "No" },
  { model: "Aura", mid: "Yes — MID per socket", ocmf: "No" },
  { model: "Dawn (standard)", mid: "Yes — MID", ocmf: "No" },
  { model: "Dawn Professional DE", mid: "Yes — MID", ocmf: "Fully Eichrecht-certified — transport unverified" },
];

// ── Quirks / known issues ─────────────────────────────────────────────

export const QUIRKS: Array<{ quirk: string; info: string }> = [
  { quirk: "CAPI vs OCPP mutual exclusion", info: "Once moved to OCPP, the Charge Amps Cloud connection drops. Customers lose the Charge Amps app's live-control features. Document this in onboarding" },
  { quirk: "Halo Schuko is NOT a 2nd OCPP connector", info: "Local-logic only; yields to Type 2 when an EV is plugged in. Don't bill Schuko energy via OCPP CDRs" },
  { quirk: "Aura early-firmware connector-2 transaction issues", info: "Some early-firmware reports of connectorId 2 not transacting correctly — require recent firmware before commissioning" },
  { quirk: "Halo OCPP connection stability", info: "Older firmware dropped OCPP socket every ~2 min. fw184 added connection watchdog. Insist on fw184+ for Halo deployments" },
  { quirk: "Remote start with rfidLock=true", info: "If RemoteStartTransaction sent without matching idTag, charging is 'accepted but paused'. Either disable RFID lock pre-OCPP, or always include a valid idTag" },
  { quirk: "Stop transaction quirks", info: "CSMS-issued stop sometimes not honoured. Build a fallback: ChangeConfiguration MaxCurrent=0 → if not honoured, EAPI remotestop" },
  { quirk: "JWT 120-min lifetime", info: "Refresh ~30 s before exp. On 401, full re-login (not just refresh) is the correct recovery" },
  { quirk: "Pagination by time window", info: "chargingsessions uses startTime/endTime; for large historical pulls, page by time window" },
  { quirk: "No sandbox", info: "Partners test against production. Use a test charger or virtual charge point" },
  { quirk: "NaaS ownership change (2023)", info: "Roadmap stewardship has shifted; check that the OCPP 1.6J → 2.0.1 roadmap and partner portal stability remain priorities at contract time" },
];

// ── Adapter status ────────────────────────────────────────────────────

export const ADAPTER_STATUS = {
  state: "Not yet wired" as const,
  description:
    "Charge Amps is the easiest of the Nordic AC vendors to onboard. The EAPI is real, public-Swagger-documented (eapi.charge.space/swagger), and the partner portal can flip a charger's OCPP backend URL OTA — Iceland customers can move from Charge Amps Cloud to Straumvakt without an installer site visit. Use OCPP 1.6J as the realtime path; use the EAPI as a side-channel for fleet/admin operations (listing chargers, reading historical sessions, remote start/stop fallback). The EAPI publishes no realtime push; do not poll for live state.",
};
