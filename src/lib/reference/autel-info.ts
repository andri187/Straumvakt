// Brief descriptions for the Autel Energy API reference UI page.
// Mirrors the pattern from zaptec-info.ts / easee-info.ts / alfen-info.ts but
// reflects Autel's positioning: full-ladder vendor (residential AC up to 480 kW DC),
// formal certifications strong, public REST API absent, BLE-only OCPP URL change.
//
// Source of truth for the underlying material is
// docs/reference/integrations/autel.md.

// ── Vendor identity ───────────────────────────────────────────────────

export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "V3 schema class", info: "Hardware / Chargers — HardwareVendorKind=charger_ac for AC line, charger_dc for DC HiPower / DH480" },
  { label: "Parent", info: "Autel Intelligent Technology Corp. (Shenzhen, founded 2004; diagnostic-tool brand)" },
  { label: "EV branch", info: "Autel Digital Power / 'Autel Energy' — launched 2021" },
  { label: "Operating EU entity", info: "Autel Energy Europe (Munich, Landsberger Straße 408)" },
  { label: "US factory", info: "Greensboro, NC — acquired May 2023, ~5,000 DC fast units/year" },
  { label: "Hardware tier", info: "Full ladder — residential AC, commercial AC, DC fast, DC HiPower (480 kW per dispenser, 640 kW system)" },
  { label: "OCPP versions", info: "1.6J line-wide; 2.0.1 cert on DH480 + CSMS; 2.0.1 firmware-dependent on AC line" },
  { label: "ISO 15118 PnC", info: "Hubject EVSE CHECK certified (Feb 2024, starting with DC Compact)" },
  { label: "Distinctive features", info: "80 A / 19.2 kW single-port AC · 2×19.2 kW dual-port AC Ultra · Energy Cube load algorithm · CCS1+NACS dual-cable HiPower" },
  { label: "Security history", info: "Pwn2Own Automotive 2024 CVEs (BLE auth bypass, stack overflows). Patched ≥ v1.35 — verify firmware at every onboarding" },
];

// ── AC models ─────────────────────────────────────────────────────────

export const AC_MODELS: Array<{ model: string; region: string; power: string; ocpp: string; mid: string; pnc: string; info: string }> = [
  { model: "MaxiCharger AC Lite (Home)", region: "NA", power: "12 kW", ocpp: "1.6J", mid: "?", pnc: "?", info: "1-ph 6–50 A · J1772/NACS · Wi-Fi/BT/Eth · 25 ft cable" },
  { model: "MaxiCharger AC Compact", region: "EU", power: "7.4 / 11 / 22 kW", ocpp: "1.6J (2.0.1 upgradeable)", mid: "Yes (LCD variants)", pnc: "?", info: "Type 2 socket · RCD AC 30 mA + DC 6 mA · IP65" },
  { model: "MaxiCharger AC Wallbox", region: "EU", power: "7 / 11 / 22 kW", ocpp: "1.6J (2.0.1 newer FW)", mid: "?", pnc: "?", info: "Type 2 socket / 5 m tethered · 8-unit shared-energy group · PV Hybrid" },
  { model: "MaxiCharger AC Pro", region: "NA + global", power: "19.2 kW (80 A)", ocpp: "1.6J + 2.0.1", mid: "?", pnc: "Yes", info: "J1772 · NEMA 4X · 7\" touchscreen · in-body cable holster" },
  { model: "MaxiCharger AC Ultra", region: "NA", power: "2 × 19.2 kW", ocpp: "1.6 + 2.0.1", mid: "?", pnc: "Yes", info: "2 × J1772 · 8\" HD ad-screen · NEMA 3R · -40 °F to +131 °F" },
  { model: "MaxiCharger AC Single (Nayax)", region: "NA", power: "19.2 kW", ocpp: "1.6 + 2.0.1", mid: "?", pnc: "Yes", info: "J1772 / NACS · Nayax payment terminal · 100k unit rollout Jan 2026" },
];

// ── DC models ─────────────────────────────────────────────────────────

export const DC_MODELS: Array<{ model: string; power: string; connectors: string; ocpp: string; pnc: string; info: string }> = [
  { model: "MaxiCharger DC Compact", power: "40 kW (NA) / ≤ 47 kW (EU)", connectors: "2×CCS1, CCS1+CHAdeMO, or CCS2 (EU)", ocpp: "1.6J (2.0.1 upgradeable)", pnc: "Yes — first Hubject EVSE CHECK cert (Feb 2024)", info: "21.5\" LCD · 4G/Wi-Fi/Eth · 3-ph 480 V · pedestal or mobile" },
  { model: "MaxiCharger DC Fast", power: "60 / 120 / 180 / 240 kW", connectors: "2×CCS1 (NA) or 2×CCS2 (EU)", ocpp: "1.6J + 2.0.1", pnc: "Yes", info: "NA built at Greensboro plant" },
  { model: "MaxiCharger DH480 / DC HiPower", power: "320 kW base, 480 kW per dispenser, 640 kW system", connectors: "CCS1 + NACS (NA), CCS2 (EU), 650 A liquid-cooled", ocpp: "1.6J + 2.0.1 (DNV cert OCA.0201.0069.CS)", pnc: "Yes", info: "Energy Cube load algo · 4-8 vehicles simultaneous · site-level network hot backup" },
];

// ── Cloud surfaces ────────────────────────────────────────────────────

export const CLOUD_SURFACES: Array<{ surface: string; info: string }> = [
  { surface: "Autel Charge Cloud — EU operator portal", info: "https://eucloud.autelenergy.com/" },
  { surface: "Autel Charge Cloud — US operator portal", info: "https://uscloud.autelenergy.com/login" },
  { surface: "Autel Charge Cloud — APAC", info: "Unverified — likely a separate cn/asia subdomain" },
  { surface: "Autel Charge mobile app", info: "End users (drivers) — iOS app id 1578454464" },
  { surface: "Autel Config mobile app", info: "Installers (BLE commissioning) — iOS app id 1607007731" },
  { surface: "Operator registration (NA)", info: "https://autelenergy.us/pages/register" },
  { surface: "Operator registration (EU)", info: "https://autelenergy.eu/pages/register-for-an-autel-charge-cloud-account" },
];

// ── REST API — partner-gated, undocumented ────────────────────────────

export const REST_API_FACTS: Array<{ label: string; info: string }> = [
  { label: "Public OpenAPI / Swagger", info: "None — no publicly-hosted developer portal for the EV charging product" },
  { label: "Github 'AutelSDK' org", info: "Drone SDK only (Autel Robotics) — NOT chargers; do not confuse" },
  { label: "Partner integration model", info: "Autel publishes integration partnerships (ChargeLab, AMPECO, Monta, EVmatch, Hubject) rather than a public API" },
  { label: "Realistic integration layer", info: "OCPP-direct (charger ↔ third-party CSMS), not via cloud REST" },
  { label: "Partner contact", info: "EVSales@Autel.com + 'Become A Partner' CTA on autelenergy.us" },
  { label: "Auth scheme", info: "Operator portal is web-form email + password — partner API surface unverified" },
  { label: "Push channel", info: "None documented" },
  { label: "Webhooks", info: "None documented" },
];

// ── OCPP support ──────────────────────────────────────────────────────

export const OCPP_FACTS: Array<{ label: string; info: string }> = [
  { label: "DH480 — charger ↔ CSMS 2.0.1", info: "DNV cert OCA.0201.0069.CS · Edition 3 FINAL 2024-05-06 + Errata 2024-11" },
  { label: "DH480 — 1.6J", info: "Standard fallback" },
  { label: "Autel CSMS itself", info: "OCA OCPP 2.0.1 cert June 2024 · Core + Advanced Security profiles" },
  { label: "AC Pro / Ultra / Single, DC Compact, Fast", info: "2.0.1 'compliant' / 'upgradeable' — firmware-dependent, no per-charger cert" },
  { label: "AC Lite, AC Compact, AC Wallbox", info: "1.6J standard; 2.0.1 firmware-dependent" },
  { label: "Configurable backend URL", info: "Yes — but ONLY via Autel Config app over BLE proximity" },
  { label: "Default backend", info: "Autel Charge Cloud (regional eucloud / uscloud subdomains)" },
  { label: "Remote OTA URL change", info: "Not supported — no Autel-cloud-side push to change OCPP backend. Hard structural difference vs Charge Amps and NexBlue" },
];

// ── OCPP integration quirks ───────────────────────────────────────────

export const OCPP_QUIRKS: Array<{ quirk: string; info: string }> = [
  { quirk: "ChangeConfiguration ignored on some FW", info: "lbbrhzn/ocpp#1019 — workaround: use SetChargingProfile instead of raw config keys" },
  { quirk: "Hardcoded MeterValueSampleInterval", info: "Some EU Wallbox FW reports a hardcoded sample interval. Plan around it; don't expect the standard config key to take effect" },
  { quirk: "BLE-only commissioning", info: "No web UI on AC models — OCPP URL changes require BLE proximity" },
  { quirk: "Pwn2Own 2024 CVEs", info: "CVE-2024-23957/-23958/-23959/-23967 — require firmware ≥ v1.35" },
];

// ── Onboarding — BLE-on-site only ─────────────────────────────────────

export const ONBOARD_STEPS: Array<{ step: string; info: string }> = [
  { step: "1. Power up + electrical commissioning", info: "Standard pre-OCPP setup" },
  { step: "2. Install Autel Config app", info: "Separate from end-user Autel Charge app" },
  { step: "3. Scan QR / enter serial + PIN", info: "From the install-manual sticker" },
  { step: "4. Connect via BLE; configure backhaul", info: "Wi-Fi or Ethernet for Internet" },
  { step: "5. Settings → OCPP Server → enter Straumvakt URL", info: "wss://... + auth credentials if required" },
  { step: "6. Reboot", info: "Charger boots straight into Straumvakt" },
  { step: "7. End-user Autel Charge app stops working", info: "Drivers must use Straumvakt's app/RFID instead" },
];

// ── End-user authentication ───────────────────────────────────────────

export const END_USER_AUTH: Array<{ mode: string; info: string }> = [
  { mode: "RFID (ISO/IEC 14443)", info: "Yes — built-in on Wallbox, AC Pro, AC Ultra, AC Single, all DC. DES challenge-response. Local whitelist of 5 cards on Autel cloud; under OCPP delegated to CSMS via Authorize" },
  { mode: "Autel Charge app start/stop", info: "Yes when on Autel cloud — gone once moved to Straumvakt" },
  { mode: "ISO 15118-2 Plug & Charge", info: "Yes — Hubject EVSE CHECK certified (DC Compact, DC Fast, DH480, AC Pro, AC Ultra, AC Single). AC Lite home unverified (likely no)" },
  { mode: "Nayax credit-card terminal", info: "Yes on AC Single (Jan 2026 NA rollout); fallback for app-free payments" },
  { mode: "Free-vend / no-auth", info: "Unverified" },
];

// ── Local interface ───────────────────────────────────────────────────

export const LOCAL_INTERFACE: Array<{ interfaceLabel: string; info: string }> = [
  { interfaceLabel: "Modbus TCP — DC Compact, DC Fast", info: "Yes, configurable via local service portal" },
  { interfaceLabel: "Modbus RTU (RS-485) — DC Compact, DC Fast", info: "Yes" },
  { interfaceLabel: "Modbus TCP — AC Ultra", info: "Yes, via maintenance menu" },
  { interfaceLabel: "Modbus — AC Wallbox / Compact / Lite", info: "Unverified — public docs do not document Modbus on residential AC" },
  { interfaceLabel: "Local web UI — DC line", info: "Partial — service portal / maintenance menu on LCD or via service connection" },
  { interfaceLabel: "Local web UI — AC line", info: "None published — config only via Autel Config / BLE" },
  { interfaceLabel: "Service installer", info: "Autel Config app over BLE (canonical service interface line-wide)" },
  { interfaceLabel: "Backhaul options", info: "Ethernet, Wi-Fi, optional 4G (SIM, APN settable in Autel Config)" },
];

// ── OCMF / Eichrecht ──────────────────────────────────────────────────

export const OCMF_FACTS: Array<{ label: string; info: string }> = [
  { label: "MID meter — AC Compact (LCD)", info: "Confirmed ±1% Class B" },
  { label: "MID meter — other EU AC SKUs", info: "Unverified per-SKU; likely present on commercial-grade units" },
  { label: "Eichrecht / OCMF signed values", info: "No public claim by Autel — not on Eichrecht-certified vendor lists. Treat as absent" },
  { label: "Iceland implication", info: "Acceptable — Eichrecht is not a regulatory requirement in Iceland" },
  { label: "DE/AT resale", info: "Request a per-model + per-firmware Eichrecht conformity certificate before quoting legal-for-trade billing" },
];

// ── Pricing / commercial ──────────────────────────────────────────────

export const PRICING_FACTS: Array<{ aspect: string; info: string }> = [
  { aspect: "Autel Charge Cloud (NA)", info: "1-year subscription license cards (Lite / Silver / Pro). Entry around $29.99 USD/year/charger; full breakdown not public" },
  { aspect: "Autel Charge Cloud (EU)", info: "Account-based after partner registration — no public price list" },
  { aspect: "OCPP feature gating", info: "No paid OCPP add-on — OCPP is included in firmware. The paid product is the cloud, not the protocol" },
  { aspect: "Hardware (NA retail snapshot)", info: "AC Lite 50 A J1772 ≈ $455–569 · AC Ultra dual-port commercial in the high four figures · DC line dealer-quoted" },
  { aspect: "OCPI version", info: "Not published. Plan to roam via Hubject" },
];

// ── Adapter status ────────────────────────────────────────────────────

export const ADAPTER_STATUS = {
  state: "Not yet wired" as const,
  description:
    "Autel is the only fully-laddered AC + DC vendor in the catalogue and has the strongest formal-certification story (DNV OCPP 2.0.1 cert on DH480, OCA OCPP 2.0.1 cert on the CSMS, Hubject Plug & Charge ecosystem). The integration path Straumvakt should commit to is OCPP-direct — there is no documented Autel cloud REST API for third-party CPMS, and the only OTA OCPP-URL change requires the Autel Config app over BLE with a phone in physical proximity to the charger. Plan a non-zero installer cost into every Autel onboarding quote.",
};
