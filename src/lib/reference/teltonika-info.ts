// Brief descriptions for the Teltonika RUT API reference UI page.
// Mirrors the pattern from zaptec-info.ts / easee-info.ts / alfen-info.ts
// but reflects Teltonika's role as connectivity infrastructure (cellular
// routers / VPN concentrators), not chargers.
//
// Source of truth for the underlying material is
// docs/reference/integrations/teltonika-rut.md.

// ── Vendor identity ───────────────────────────────────────────────────

export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  { label: "V3 schema class", info: "Hardware / 4G modems — HardwareVendorKind=modem, SiteAssetKind=modem (extends assets.site_assets via assets.modems). Distinct from Hardware / Chargers." },
  { label: "Vendor name", info: "Lithuanian industrial-router manufacturer (Vilnius / Kaunas)" },
  { label: "Hardware tier", info: "Industrial cellular routers — 4G LTE / 4G+ / 5G" },
  { label: "Models in scope", info: "RUT240 / RUT241 (entry), RUT360 (LTE Cat 6), RUT901 / RUT955 (industrial 4-port), RUTX09 / RUTX11 (dual-SIM), RUTX50 / RUTM50 (5G)" },
  { label: "Operating system", info: "RutOS — OpenWrt-based Linux fork, vendor-maintained" },
  { label: "Local management", info: "Web UI (HTTPS), SSH (when enabled), JSON-RPC over /ubus" },
  { label: "Cloud management", info: "RMS (Remote Management System) — Teltonika SaaS, paid per-device subscription" },
  { label: "Modbus support", info: "RUT955 / RUT956 / select industrial models — Modbus TCP slave + serial gateway" },
  { label: "Distinctive features", info: "Dual-SIM failover, MultiWAN, OpenVPN/WireGuard/IPsec/L2TP/GRE built-in, SMS API, GPS (RUT955 / RUTX), DI/DO + 1-Wire (industrial)" },
];

// ── Why a CPMS cares ──────────────────────────────────────────────────

export const CPMS_USE_CASES: Array<{ label: string; info: string }> = [
  {
    label: "Cellular backhaul",
    info: "Greenfield sites without wired internet — Teltonika RUT provides the path the charger's OCPP WebSocket dials over",
  },
  {
    label: "VPN concentrator for installer access",
    info: "ACE Service Installer / Easee Connect / charger UI access for remote commissioning — see alfen.md §1.1 row 5 + §1.6",
  },
  {
    label: "Site monitoring",
    info: "Is the site even online? Signal strength, modem RAT (LTE / 5G), data usage, uptime — answered by router-level polling before charger-level questions matter",
  },
  {
    label: "Modbus passthrough (industrial models)",
    info: "RUT955 / RUT956 expose Modbus TCP slave for SCADA-style integration — separate from chargers' own Modbus",
  },
];

// ── Authentication options ────────────────────────────────────────────

export const AUTH_OPTIONS: Array<{ label: string; info: string }> = [
  {
    label: "Local JSON-RPC — per router",
    info: "POST /ubus with sentinel zero-token + username/password. Returns ubus_rpc_session token (300 s timeout). Use over LAN or VPN.",
  },
  {
    label: "RMS PAT — fleet-wide",
    info: "Personal Access Token from RMS account → Authorization: Bearer header. Requires 2FA-enabled RMS account.",
  },
  {
    label: "Hybrid recommendation",
    info: "Local JSON-RPC for site-specific configuration; RMS API for fleet visibility. Don't mix sources for the same data plane.",
  },
];

// ── Local JSON-RPC namespaces ─────────────────────────────────────────

export const LOCAL_API_OBJECTS: Array<{ object: string; method: string; info: string }> = [
  { object: "session", method: "login", info: "Returns ubus_rpc_session token (only call without auth)" },
  { object: "session", method: "logout", info: "Invalidates the session" },
  { object: "system", method: "info", info: "Uptime, load, memory, kernel version, hostname" },
  { object: "system", method: "board", info: "Model, serial, firmware version, hardware revision" },
  { object: "system", method: "reboot", info: "Reboot the router (destructive — confirm first)" },
  { object: "network.interface.<name>", method: "status", info: "IP address, gateway, DNS, link state per interface" },
  { object: "network.device", method: "status", info: "Per-interface stats (rx/tx bytes, packets, errors)" },
  { object: "dhcp", method: "ipv4leases", info: "Active LAN DHCP leases — find chargers by MAC" },
  { object: "mobiled.modem", method: "info", info: "Modem ICCID, IMEI, IMSI, model, firmware" },
  { object: "mobiled.signal", method: "info", info: "RSSI, RSRP, RSRQ, SINR, RAT (LTE / 5G), band" },
  { object: "mobiled.network", method: "info", info: "Connection state, operator, MCC/MNC, cell ID" },
  { object: "mobiled.sim", method: "info", info: "SIM state, ICCID, IMSI" },
  { object: "mobiled.data_usage", method: "info", info: "Monthly data-usage counter" },
  { object: "vpn.openvpn / wireguard / ipsec", method: "status", info: "Per-tunnel state" },
  { object: "gps", method: "info", info: "Latitude, longitude, altitude (RUT955 / RUTX series)" },
  { object: "sms", method: "send", info: "Send SMS (number + text)" },
  { object: "sms", method: "inbox", info: "Received SMS list" },
  { object: "firewall", method: "status", info: "Active rules + counters" },
  { object: "uci", method: "get / set / commit", info: "Read or write config sections (network / firewall / mobiled / openvpn / etc.)" },
  { object: "file", method: "exec", info: "Run an arbitrary shell command — equivalent to root. Restrict in production." },
];

// ── RMS API endpoints ─────────────────────────────────────────────────

export const RMS_ENDPOINTS: Array<{ method: string; path: string; info: string }> = [
  { method: "GET", path: "/api/devices", info: "Paginated list of all devices in the account" },
  { method: "GET", path: "/api/devices/{id}", info: "Single device detail — status, firmware, last-seen, signal" },
  { method: "GET", path: "/api/devices/{id}/data-usage", info: "Monthly cellular data usage" },
  { method: "GET", path: "/api/devices/{id}/sim", info: "SIM info — ICCID, IMSI, operator, RAT, signal" },
  { method: "GET", path: "/api/devices/{id}/location", info: "Last known GPS location" },
  { method: "POST", path: "/api/devices/{id}/tasks/reboot", info: "Schedule a reboot" },
  { method: "POST", path: "/api/devices/{id}/tasks/firmware-update", info: "Schedule firmware update" },
  { method: "POST", path: "/api/connect/sessions", info: "Mint an RMS Connect session — temporary public URL into the device's LAN" },
  { method: "GET", path: "/api/credits", info: "Account RMS credit balance — Connect sessions + tasks consume credits" },
];

// ── Deployment patterns ───────────────────────────────────────────────

export const DEPLOYMENT_PATTERNS: Array<{ pattern: string; info: string }> = [
  {
    pattern: "Site-to-site OpenVPN / WireGuard",
    info: "Each Teltonika dials the operator's VPN concentrator → continuous routable access to charger LANs from Straumvakt's worker + installer laptops",
  },
  {
    pattern: "RMS Connect (no VPN)",
    info: "Mint time-bound public URL on demand → installer pastes into ACE Service Installer / Easee Connect. Costs RMS credits per minute.",
  },
  {
    pattern: "Direct port-forward",
    info: "NOT recommended — SIM-side public IPs are scanned constantly. Use VPN or RMS Connect instead.",
  },
];

// ── Baseline configuration ────────────────────────────────────────────

export const BASELINE_CONFIG: Array<{ setting: string; info: string }> = [
  { setting: "Default password", info: "Changed to per-device random secret. Refuse routers with factory default admin01" },
  { setting: "WebUI access from WAN", info: "Disabled — reduces public-internet attack surface" },
  { setting: "SSH access from WAN", info: "Disabled — same" },
  { setting: "JSON-RPC from WAN", info: "Disabled — keep RPC LAN/VPN-only" },
  { setting: "Default firewall input", info: "Drop all from cellular WAN; only VPN tunnels and explicit forwards allowed in" },
  { setting: "OpenVPN / WireGuard", info: "Enabled, dialing the operator's concentrator — provides installer + monitoring path" },
  { setting: "MultiWAN failover", info: "Wired primary, cellular backup (when wired exists) — cost optimization" },
  { setting: "Mobile data-usage notifications", info: "Enabled, threshold 80% of plan — avoid overage surprises" },
  { setting: "NTP server", info: "pool.ntp.org or local NTP — OCMF timestamps need accurate clocks" },
  { setting: "Timezone", info: "Site timezone (Iceland: Atlantic/Reykjavik) — local logs read sensibly" },
  { setting: "RMS connection", info: "Enabled, claimed under operator account — single-pane fleet visibility" },
  { setting: "Auto-firmware-update", info: "Disabled for production — operator schedules updates explicitly" },
];

// ── Security considerations ───────────────────────────────────────────

export const SECURITY_NOTES: Array<{ topic: string; info: string }> = [
  { topic: "Factory default credentials", info: "admin01 is a recurring incident class. Validate factory defaults are no longer accepted before commissioning." },
  { topic: "TR-069 / CWMP", info: "On by default on some firmware. Disable if unused — long history of vulnerabilities." },
  { topic: "JSON-RPC file.exec", info: "Remote shell. Treat session token as root-on-router; never log it; never persist beyond immediate use." },
  { topic: "SMS API", info: "Outbound SMS — billable, abusable. Restrict to operator scopes only." },
  { topic: "OpenWrt CVE feed", info: "Applies to RutOS too. Track Teltonika firmware advisories." },
  { topic: "RMS Connect tokens", info: "Time-bound but high-privilege. Treat as session credentials; never paste publicly or commit." },
  { topic: "Firmware verification", info: "RutOS images are signed. RMS handles automatically; manual flashes need explicit signature verification." },
];

// ── Adapter status ────────────────────────────────────────────────────

export const ADAPTER_STATUS = {
  state: "Not yet wired" as const,
  description:
    "Teltonika is connectivity infrastructure, not a charger asset class. Maps to assets.modems in the V3 polymorphic SiteAsset model. The 'adapter' has two surfaces: per-router JSON-RPC (over the site VPN) for configuration + diagnostics, and the RMS Cloud API for fleet visibility. No production code yet — first deployment with a Teltonika router triggers the adapter implementation.",
};
