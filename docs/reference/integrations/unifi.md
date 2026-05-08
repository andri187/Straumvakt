# UniFi - Network hardware API reference

**Status:** reference data, not schema. **No live Straumvakt site probe yet** - content is from Ubiquiti's official UniFi API documentation and public Help Center material.
**Last verified:** 2026-05-07 against Ubiquiti Help Center and the UniFi Developer Portal.
**Primary use:**
1. Reference for using UniFi as site network infrastructure around Straumvakt charger deployments: gateways, switches, access points, client/device telemetry, and guest/captive-portal controls.
2. Reference for a future UniFi network adapter under the V3 hardware-catalog model. UniFi is **not** a charger control plane; it belongs with site infrastructure/controllers.
3. Cross-reference for field deployments where chargers sit behind UniFi gateways/switches/APs rather than Teltonika cellular routers.

> [!IMPORTANT]
> UniFi has multiple API surfaces. The cloud Site Manager API is good for fleet visibility; the local UniFi Network API is the control surface for devices, clients, Wi-Fi, firewall, VLAN/network config, and switch/AP actions. Do not assume a Site Manager API key can perform every local control operation.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Vendor | Ubiquiti Inc. |
| Hardware tier | Network infrastructure: gateways, switches, access points, UniFi OS consoles |
| Models in scope | Cloud Gateway / Dream Machine / CloudKey hosts, UniFi gateways, UniFi switches, UniFi APs |
| V3 schema class | Proposed: `Hardware / Network infrastructure` or `controller` until a dedicated network-device asset class exists |
| Charger protocol | None - UniFi does not implement OCPP |
| API style | Cloud Site Manager API + local per-application APIs |
| Credential scope | Site / host. Cloud API key is UI-account scoped; local API key is generated on the UniFi device/application |
| Distinctive value to Straumvakt | Answers "is the site network healthy?", "which charger MAC is online?", "is WAN down?", "can an installer reach the charger LAN?", and "which switch/AP port is the charger on?" |

---

## 2. API surfaces

| Surface | Base URL | Auth | Best fit |
|---|---|---|---|
| Site Manager API | `https://api.ui.com/v1/...` | `X-API-Key` from UI account / developer portal | Multi-site visibility, hosts, sites, devices, ISP metrics, SD-WAN state |
| Local UniFi Network API | Version-specific local base shown in app docs | Local API key generated inside UniFi Network | Detailed Network control: devices, clients, Wi-Fi, networks, firewall, vouchers, switch/AP actions |
| Product-specific local APIs | Local UniFi application endpoint | Application-specific API key | Access, Protect, Connect, Talk - only if that application is in scope |
| Legacy internal controller API | Controller web UI private endpoints | Session cookie / local account | Broad but undocumented. Avoid for production unless official API cannot cover a required operation |

Official Ubiquiti guidance: local Network API documentation is exposed inside each UniFi Network application under **Settings -> Control Plane -> Integrations**. This matters because the local endpoint catalogue is tied to the installed Network version.

---

## 3. Authentication

### 3.1 Site Manager API key

```bash
curl -X GET "https://api.ui.com/v1/sites?pageSize=10" \
  -H "Accept: application/json" \
  -H "X-API-Key: <ui-api-key>"
```

Use for cloud-level inventory and health. Store as an operator secret; the key inherits access from the UI account that created it.

### 3.2 Local Network API key

Generate locally in UniFi Network:

```
UniFi Network -> Settings -> Control Plane -> Integrations -> API Keys
```

Use for local or site-proxied operations. For airgapped/local-only deployments, this is the preferred integration path.

### 3.3 Implementation notes

- Treat cloud and local keys as separate credentials in Straumvakt. They have different trust boundaries and failure modes.
- Prefer read-only keys for monitoring jobs where possible.
- Do not log API keys, switch-port actions, client MAC addresses, or external WAN IPs in user-facing logs.
- Expect 429 responses from cloud endpoints; Site Manager responses include a `Retry-After` header on rate limit.

---

## 4. Site Manager API surface

Official v1 endpoints relevant to Straumvakt:

| Method / Path | Purpose | Straumvakt use |
|---|---|---|
| `GET /v1/hosts` | List UniFi hosts associated with the UI account | Inventory all sites a network operator manages |
| `GET /v1/hosts/{hostId}` | Host detail | Detect UniFi OS version, reported state, applications |
| `GET /v1/sites` | List UniFi Network sites | Map UniFi site IDs to Straumvakt properties/installations |
| `GET /v1/devices` | List UniFi devices | Gateways, switches, APs; detect offline infrastructure |
| `GET /v1/isp-metrics` | ISP metrics for all sites | WAN uptime, packet loss, latency baseline |
| `POST /v1/isp-metrics/query` | Query ISP metrics by parameters | Site health timeline for incident correlation |
| `GET /v1/sd-wan/configs` | SD-WAN configs | Future: managed site-to-site access |
| `GET /v1/sd-wan/configs/{id}` | SD-WAN config detail | Future topology mapping |
| `GET /v1/sd-wan/configs/{id}/status` | SD-WAN deployment/status | Installer remote-access readiness |

Use this layer for fleet health and NOC-style views, not for charger commands.

---

## 5. Local UniFi Network API surface

The official local Network API is the relevant control path for hardware at a specific site. Endpoint names and base path should be taken from the installed controller's Integrations page, but the capability groups are:

| Group | Capabilities | Straumvakt use |
|---|---|---|
| Sites | List/get sites | Resolve local `siteId` and label |
| Devices | List/get devices, restart, adopt, forget, locate, statistics, switch-port action | Find gateway/switch/AP health; blink/locate equipment during install; restart AP/switch when approved |
| Clients | List/get clients, block/unblock, reconnect, forget, execute action | Identify chargers by MAC/IP/hostname; disconnect stale clients; block unknown devices if a site is compromised |
| Networks | List/get/create/update/delete networks | Commission charger VLANs or installer VLANs |
| Wi-Fi | List/get/create/update/delete SSIDs | Temporary installer SSID; guest/captive portal networks |
| Firewall | Zones and rules | Restrict charger VLAN egress; allow OCPP/WSS; block inbound management |
| Vouchers / hotspot | List/get/create/delete vouchers | Installer guest access without sharing permanent Wi-Fi credentials |
| ACL / traffic / resources | Access lists, DPI categories, WAN interfaces, VPN resources | Policy reporting and network diagnostics |

---

## 6. Control actions and safety

UniFi can control network hardware, but Straumvakt should treat these as site-infrastructure actions:

| Action | Risk | Recommendation |
|---|---|---|
| Restart gateway/switch/AP | Can drop charger sessions and operator access | Require admin confirmation; log audit event |
| Switch-port action | Can isolate a charger or router | Confirm target by MAC + switch + port label before executing |
| Block client | Can disable a charger's connectivity | Only for explicit quarantine workflow |
| Change VLAN/network/firewall | Can strand chargers or installers | Stage as proposed config; apply during maintenance window |
| Create temporary SSID/voucher | Low if scoped | Good installer workflow; auto-expire |
| Adopt/forget device | High operational blast radius | Manual operator-only workflow |

---

## 7. Straumvakt integration model

UniFi should not be modelled as a charger vendor. Suggested mapping:

```text
Org
  -> Property
    -> Site
      -> Installation
        -> SiteAsset (Network controller / gateway / switch / AP)
        -> SiteAsset (Charger)
```

Recommended stored references:

| Straumvakt field | UniFi field |
|---|---|
| `site.metadata.unifiSiteId` | Site Manager `siteId` / local Network site id |
| `site.metadata.unifiHostId` | Site Manager `hostId` |
| `site_asset.vendorResourceId` | Device id / MAC |
| `site_asset.metadata.mac` | UniFi device/client MAC |
| `site_asset.metadata.switchPort` | Switch + port tuple for charger uplink |
| `vendor_credentials.scope` | `site` or `organization`, depending on cloud vs local key |

First useful production feature: read-only network health panel on Site / Installation pages:

- WAN uptime and latency from ISP metrics
- UniFi device online/offline state
- Charger MAC currently seen as a client
- Switch/AP association and last-seen time
- VLAN/network name for the charger

---

## 8. Example workflows

### 8.1 Cloud fleet inventory

```bash
curl -X GET "https://api.ui.com/v1/sites?pageSize=100" \
  -H "Accept: application/json" \
  -H "X-API-Key: <ui-api-key>"
```

Use to create/update the mapping from UniFi sites to Straumvakt sites.

### 8.2 Site WAN health

```bash
curl -X GET "https://api.ui.com/v1/isp-metrics" \
  -H "Accept: application/json" \
  -H "X-API-Key: <ui-api-key>"
```

Use to explain charger outages that are really WAN outages.

### 8.3 Local charger discovery by MAC

Pseudo-flow:

1. Call local Network API `clients.list(siteId)`.
2. Match by known charger MAC, hostname, or DHCP lease.
3. Persist `ip`, `mac`, `network`, `switch`, `port`, and `lastSeen`.
4. Show this in Technical Read before attempting charger-level diagnostics.

---

## 9. Production-adapter checklist

- [ ] Separate cloud Site Manager and local Network credentials.
- [ ] Store UniFi host/site/device IDs as external refs; do not overload charger vendor refs.
- [ ] Keep initial adapter read-only: hosts, sites, devices, clients, ISP metrics.
- [ ] Add write actions only behind explicit admin confirmation and audit logging.
- [ ] Normalize MAC addresses to lowercase colon form.
- [ ] Rate-limit cloud polling and honor `Retry-After`.
- [ ] Cache site/device inventory; poll client state more frequently only during Technical Read.
- [ ] Redact WAN IPs, API keys, client MACs, and voucher codes from user-facing logs.
- [ ] Add a "network outage" explanation path in charger incident triage.

---

## 10. Sources

- Ubiquiti Help Center - Getting Started with the Official UniFi API: `https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-UniFi-API`
- UniFi Developer Portal - Site Manager API v1.0: `https://developer.ui.com/site-manager-api/`
- UniFi Developer Portal - List Sites: `https://developer.ui.com/site-manager-api/listsites/`
- Ubiquiti Help Center - Choosing the Right UniFi Control Plane: `https://help.ui.com/hc/en-us/articles/30127033090071-Choosing-the-Right-UniFi-Control-Plane`
- Ubiquiti Help Center - UniFi Local Management: `https://help.ui.com/hc/en-us/articles/28457353760919-UniFi-Local-Management`
