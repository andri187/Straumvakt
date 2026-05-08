// Brief descriptions for the UniFi API reference UI page.
// Source of truth for the fuller material is docs/reference/integrations/unifi.md.

export const ADAPTER_STATUS = {
  state: "Research reference" as const,
  description:
    "UniFi is network infrastructure, not a charger vendor. The first Straumvakt adapter should be read-only: map UniFi hosts/sites/devices/clients to Straumvakt sites, explain charger outages caused by WAN/LAN issues, and defer write actions until explicit operator workflows exist.",
};

export const VENDOR_INFO: Array<{ label: string; info: string }> = [
  {
    label: "Vendor",
    info: "Ubiquiti Inc. - UniFi gateways, switches, access points, and UniFi OS hosts",
  },
  {
    label: "Hardware tier",
    info: "Network infrastructure around charger sites; not OCPP hardware",
  },
  {
    label: "Models in scope",
    info: "Cloud Gateway / Dream Machine / CloudKey hosts, UniFi gateways, UniFi switches, UniFi APs",
  },
  {
    label: "V3 class",
    info: "Proposed Hardware / Network infrastructure, or controller until a dedicated network-device asset class exists",
  },
  {
    label: "Credential scope",
    info: "Cloud API key is UI-account scoped; local API key is generated per UniFi Network application/site",
  },
  {
    label: "Straumvakt value",
    info: "WAN health, switch/AP status, charger MAC discovery, VLAN/firewall context, temporary installer access",
  },
];

export const API_SURFACES: Array<{
  surface: string;
  base: string;
  auth: string;
  use: string;
}> = [
  {
    surface: "Site Manager API",
    base: "https://api.ui.com/v1",
    auth: "X-API-Key",
    use: "Cloud inventory and health across hosts, sites, devices, ISP metrics, and SD-WAN state",
  },
  {
    surface: "Local Network API",
    base: "UniFi Network -> Settings -> Control Plane -> Integrations",
    auth: "Local API key",
    use: "Detailed site control: devices, clients, networks, Wi-Fi, firewall, vouchers, switch/AP actions",
  },
  {
    surface: "Product APIs",
    base: "Local UniFi application endpoints",
    auth: "Application API key",
    use: "Access / Protect / Connect / Talk, only when those applications enter scope",
  },
  {
    surface: "Legacy internal API",
    base: "Controller private endpoints",
    auth: "Session cookie",
    use: "Avoid for production unless an official endpoint cannot cover a required operation",
  },
];

export const SITE_MANAGER_ENDPOINTS: Array<{
  method: string;
  path: string;
  info: string;
}> = [
  {
    method: "GET",
    path: "/v1/hosts",
    info: "List UniFi hosts associated with the UI account",
  },
  {
    method: "GET",
    path: "/v1/hosts/{hostId}",
    info: "Host detail, reported state, UniFi OS/application version context",
  },
  {
    method: "GET",
    path: "/v1/sites",
    info: "List UniFi Network sites, with metadata and statistics",
  },
  {
    method: "GET",
    path: "/v1/devices",
    info: "List UniFi devices managed by accessible hosts",
  },
  {
    method: "GET",
    path: "/v1/isp-metrics",
    info: "WAN/ISP metrics for site health correlation",
  },
  {
    method: "POST",
    path: "/v1/isp-metrics/query",
    info: "Parameterized metrics query for outage timelines",
  },
  { method: "GET", path: "/v1/sd-wan/configs", info: "List SD-WAN configs" },
  {
    method: "GET",
    path: "/v1/sd-wan/configs/{id}/status",
    info: "SD-WAN deployment and tunnel status",
  },
];

export const LOCAL_NETWORK_GROUPS: Array<{
  group: string;
  capabilities: string;
  use: string;
}> = [
  {
    group: "Sites",
    capabilities: "List/get sites",
    use: "Resolve local site id and labels",
  },
  {
    group: "Devices",
    capabilities:
      "List/get, restart, adopt, forget, locate, statistics, switch-port action",
    use: "Gateway/switch/AP health; locate gear during install",
  },
  {
    group: "Clients",
    capabilities: "List/get, block/unblock, reconnect, forget",
    use: "Identify chargers by MAC/IP/hostname and last-seen state",
  },
  {
    group: "Networks",
    capabilities: "List/get/create/update/delete networks",
    use: "Commission charger VLANs or installer VLANs",
  },
  {
    group: "Wi-Fi",
    capabilities: "List/get/create/update/delete SSIDs",
    use: "Temporary installer SSID or guest/captive portal network",
  },
  {
    group: "Firewall",
    capabilities: "Zones and rules",
    use: "Restrict charger VLAN egress and management access",
  },
  {
    group: "Vouchers",
    capabilities: "List/get/create/delete vouchers",
    use: "Installer guest access without permanent Wi-Fi sharing",
  },
  {
    group: "Resources",
    capabilities: "WAN interfaces, VPN resources, DPI categories",
    use: "Diagnostics and policy reporting",
  },
];

export const CONTROL_SAFETY: Array<{
  action: string;
  risk: string;
  recommendation: string;
}> = [
  {
    action: "Restart gateway/switch/AP",
    risk: "Drops site connectivity or charger sessions",
    recommendation: "Require admin confirmation and audit event",
  },
  {
    action: "Switch-port action",
    risk: "Can isolate a charger or router",
    recommendation: "Confirm target by MAC, switch, and port label",
  },
  {
    action: "Block client",
    risk: "Can disable charger connectivity",
    recommendation: "Reserve for explicit quarantine workflow",
  },
  {
    action: "Change VLAN/firewall",
    risk: "Can strand chargers or installers",
    recommendation: "Stage change; apply in maintenance window",
  },
  {
    action: "Create voucher/SSID",
    risk: "Low if scoped and expiring",
    recommendation: "Good installer workflow; auto-expire",
  },
];

export const STRAUMVAKT_MAPPING: Array<{ field: string; unifi: string }> = [
  {
    field: "site.metadata.unifiSiteId",
    unifi: "Site Manager siteId / local Network site id",
  },
  { field: "site.metadata.unifiHostId", unifi: "Site Manager hostId" },
  { field: "site_asset.vendorResourceId", unifi: "Device id or MAC address" },
  { field: "site_asset.metadata.mac", unifi: "UniFi device/client MAC" },
  {
    field: "site_asset.metadata.switchPort",
    unifi: "Switch + port tuple for charger uplink",
  },
  {
    field: "vendor_credentials.scope",
    unifi: "site or organization, depending on cloud vs local key",
  },
];
