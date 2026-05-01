# Teltonika RUT — 4G/5G router integration reference

**Status:** reference data, not schema. **No live device probes yet** — content is from Teltonika's developer portal, the RutOS wiki, and the RMS API documentation. Mark anywhere this file states a value as *(unverified)* before relying on it operationally.
**Last verified:** 2026-04-30 against developers.teltonika-networks.com / wiki.teltonika-networks.com / developers.rms.teltonika-networks.com.
**V3 schema class:** **`Hardware / 4G modems`** — `HardwareVendorKind = modem`, `HardwareModel.kind = modem`, asset class extends `assets.site_assets` via `assets.modems` (per `prisma/schema.prisma`). Distinct from `Hardware / Chargers` (`charger_ac` / `charger_dc`) — Zaptec / Easee / Alfen are charger vendors; Teltonika is a modem vendor.
**Primary use:**
1. Reference for **deploying Teltonika RUT routers as the cellular backhaul** between Straumvakt-managed chargers and the cloud, at sites without wired internet.
2. Reference for the future Teltonika adapter — local JSON-RPC API for per-router status + RMS Cloud API for fleet visibility.
3. VPN concentrator for remote ACE Service Installer / Easee Connect / installer-tool access into the site network during charger commissioning + maintenance.

> [!IMPORTANT]
> Teltonika RUT is **`Hardware / 4G modems`**, not `Hardware / Chargers`. It does not implement OCPP. The reference exists because the modem is often the only path that gets a charger online at greenfield sites — and the same modem is the VPN endpoint that lets Straumvakt installers reach the charger LAN remotely. Onboarding decisions (e.g. Alfen onboarding §1) repeatedly reference "VPN to charger LAN" — that VPN typically lives on a Teltonika RUT.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Vendor | Teltonika Networks (Lithuanian — Vilnius / Kaunas) |
| Hardware tier | Industrial cellular routers (4G LTE, 4G+, 5G) |
| Models in scope | RUT240 / RUT241 (entry), RUT360 (LTE Cat 6), RUT901 / RUT951 / RUT955 (4-port industrial), RUTX09 / RUTX11 (dual-SIM), RUTX50 / RUTM50 (5G), RUT956 (TS port for Modbus serial passthrough) |
| Operating system | **RutOS** — OpenWrt-based Linux fork, vendor-maintained |
| Local management | Web UI (HTTPS), SSH (when enabled), JSON-RPC over `/ubus` |
| Cloud management | **RMS** (Remote Management System) — Teltonika SaaS, paid per-device subscription |
| Modbus support | RUT955 / RUT956 / select industrial models — Modbus TCP slave + Modbus serial gateway |
| TR-069 support | Most RUT9xx + RUTX series |
| Distinctive features | Dual-SIM failover, MultiWAN (Cellular + Ethernet + Wi-Fi), built-in OpenVPN/WireGuard/IPsec/L2TP/GRE, SMS API, GPS (RUT955 / RUTX series), DI/DO + 1-Wire (industrial models), event-driven SMS / email / RMS notifications |
| V3 `HardwareVendorKind` | **`modem`** (not `charger_ac` / `charger_dc`) |
| V3 `SiteAssetKind` | **`modem`** — extends `assets.site_assets` via `assets.modems` |
| V3 `credential_scope` | n/a — modem is infrastructure, not a vendor-managed-cloud-fronted charger. Operator credentials (RMS PAT, per-router admin) are stored alongside the asset, not at an installation row. |

---

## 2. Why Straumvakt cares about Teltonika

Three distinct CPMS scenarios:

### 2.1 Cellular backhaul for chargers without wired internet

Greenfield sites — temporary depots, MDU parking lots, retail forecourts — frequently have no fixed WAN. A Teltonika RUT with a 4G SIM provides:
- Internet for the charger's OCPP WebSocket
- DHCP for the charger's LAN (typically 192.168.1.0/24 with the charger at .100)
- NAT + firewall (the charger should never be directly addressable from the cell side)
- Optional MultiWAN failover when a wired connection becomes available later

### 2.2 VPN concentrator for installer / operator remote access

The recurring problem in Alfen onboarding (`alfen.md` §1.2, §1.6): you need ACE Service Installer connected to the charger's LAN, but the LAN sits behind a router with no public IP. Solution: site has a Teltonika RUT with **OpenVPN or WireGuard** running, and the asset owner adds the installer to the VPN. Now the installer's laptop can run ACE Service Installer remotely as if on-site.

This pattern also applies to:
- Easee Connect installer tool for legacy Easee Charge units
- Modbus TCP polling of an Alfen charger from the operator's worker (port 502)
- Direct charger console access for diagnostics

### 2.3 Site monitoring + fleet visibility

The router is the source of truth for "is this site even online" before the charger-level question matters. Polling the router's signal strength, modem RAT (LTE / 5G), data usage, uptime, and reboot history tells the operator:
- Is the cellular link degraded? (low RSSI, RAT downgraded from 5G to LTE)
- Has the modem rebooted? (uptime reset)
- How much data is being used per month? (cost forecasting + anomaly detection)
- Is the SIM about to be capped? (data-quota alerts)

When a charger goes offline, the first question is "is the router still reachable?" — Teltonika's RMS or local JSON-RPC answers it directly.

---

## 3. Authentication

### 3.1 Local JSON-RPC — per-router

Used when the router is reachable on a LAN or VPN that Straumvakt's worker can dial.

**Login endpoint:**

```
POST http://<router-ip>/ubus
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "call",
  "params": [
    "00000000000000000000000000000000",
    "session",
    "login",
    { "username": "admin", "password": "<router-password>" }
  ]
}
```

The first param is a sentinel zero-token used only on the login call itself. Response carries a session ID:

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [0, { "ubus_rpc_session": "a74c8e07646f0da2bfddce35bf3de1f3", "timeout": 300, ... }]
}
```

Subsequent calls put the session ID in the same first-param slot:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "call",
  "params": [
    "a74c8e07646f0da2bfddce35bf3de1f3",
    "file", "exec",
    { "command": "gsmctl", "params": ["-q"] }
  ]
}
```

**Quirks:**
- **JSON-RPC must be enabled** on the router. Default is enabled but operators sometimes disable it. Check via WebUI: System → Administration → Access Control → Enable JSON RPC.
- **Session timeout default 300 s** of inactivity. For continuous polling, just keep using the session and the timer resets.
- **HTTPS strongly recommended for Cellular WAN reachability.** The default WebUI is HTTPS on port 443; JSON-RPC follows the same listener.
- **Default password is `admin01` on factory-fresh devices** — must be changed on first login. Refuse to onboard a router that still uses defaults.

### 3.2 RMS — cloud, fleet-level

Used when Straumvakt wants to read across the entire router fleet without LAN access.

**API base:** `https://rms.teltonika-networks.com/api/`
**Documentation:** `https://developers.rms.teltonika-networks.com/`
**Auth:** Personal Access Tokens (PATs) — Bearer header.

Setup steps:
1. Account holder enables 2FA on RMS account (mandatory before PAT issuance).
2. Account → Security → enable 2FA.
3. Account → API → Access tokens → "Add new access token". Name + scopes. Save the token securely — shown once.
4. Use as `Authorization: Bearer <pat>` header on all calls.

**Scopes** select fine-grained permissions: `devices.read`, `devices.write`, `connect.create`, `tasks.execute`, etc. Principle of least privilege — Straumvakt's read-only fleet poller should hold only the read scopes.

### 3.3 Hybrid model — recommendation

For a CPMS deployment:

- **Per-site configuration:** local JSON-RPC over the site VPN. Faster, no external dependency. Use for one-off diagnostics and the initial deployment.
- **Fleet visibility:** RMS API. Single token, single endpoint, all sites at once.
- **Don't use both for the same data plane** — pick one source of truth per concern, otherwise you'll end up reconciling drift.

---

## 4. Local JSON-RPC API surface

### 4.1 Object structure

RutOS exposes the underlying ubus (OpenWrt's IPC bus) over JSON-RPC. The shape is:

```
params: [
  "<session-token>",
  "<object>",      // namespace, e.g. "system", "network.interface", "modem"
  "<method>",      // e.g. "info", "status", "reboot"
  { ...args }      // method-specific arguments
]
```

### 4.2 Useful objects + methods

| Object | Method | Returns |
|---|---|---|
| `session` | `login` | Session token (only call without auth) |
| `session` | `logout` | Invalidates the session |
| `system` | `info` | uptime, load, memory, kernel version, hostname |
| `system` | `board` | model, serial, firmware version, hardware revision |
| `system` | `reboot` | Reboot the router (destructive — confirm first) |
| `network.interface.<name>` | `status` | IP address, gateway, DNS, link state |
| `network.device` | `status` | Per-interface stats (rx/tx bytes, packets, errors) |
| `dhcp` | `ipv4leases` | Current LAN DHCP leases (find chargers by MAC) |
| `mobiled.modem` | `info` | ICCID, IMEI, IMSI, model, firmware |
| `mobiled.signal` | `info` | RSSI, RSRP, RSRQ, SINR, RAT (LTE / 5G), band |
| `mobiled.network` | `info` | Connection state, operator, MCC/MNC, cell ID |
| `mobiled.sim` | `info` | SIM state, ICCID, IMSI |
| `mobiled.data_usage` | `info` | Monthly data usage counter |
| `vpn.openvpn` / `vpn.wireguard` / `vpn.ipsec` | `status` | Per-tunnel state |
| `gps` | `info` | Latitude, longitude, altitude (RUT955 / RUTX series) |
| `sms` | `send` | Send SMS (`{number, text}`) |
| `sms` | `inbox` | Received SMS list |
| `firewall` | `status` | Active rules + counters |
| `file` | `exec` | Run an arbitrary shell command (e.g. `gsmctl -q` for queue diagnostics). **Powerful — restrict in production.** |

### 4.3 UCI configuration access

Most config is stored in OpenWrt UCI (Unified Configuration Interface). Read/write via `uci` ubus calls:

```jsonc
// Read all sections of the network config
params: ["<token>", "uci", "get", { "config": "network" }]

// Write a value
params: ["<token>", "uci", "set", {
  "config": "network",
  "section": "lan",
  "values": { "ipaddr": "192.168.10.1" }
}]

// Commit pending changes
params: ["<token>", "uci", "commit", { "config": "network" }]
```

Configs of CPMS interest:
- `network` — interfaces, WAN failover, DHCP
- `firewall` — port forwards (e.g. forward charger's web UI through the router)
- `mobiled` — cellular settings, APN
- `openvpn` / `wireguard` — VPN tunnels
- `dropbear` — SSH access control
- `system` — hostname, NTP servers, timezone
- `tlt_admin` — Teltonika-specific admin panel settings

---

## 5. RMS Cloud API

### 5.1 Endpoints used by a CPMS

Documented at `https://developers.rms.teltonika-networks.com/`. The most relevant for fleet visibility:

| Method · Path | Purpose |
|---|---|
| `GET /api/devices` | Paginated list of all devices in the account, with status, model, firmware, last-seen, signal |
| `GET /api/devices/{id}` | Single device detail |
| `GET /api/devices/{id}/data-usage` | Monthly cellular data usage |
| `GET /api/devices/{id}/sim` | SIM info — ICCID, IMSI, operator, RAT, signal |
| `GET /api/devices/{id}/location` | Last known GPS location |
| `POST /api/devices/{id}/tasks/reboot` | Schedule a reboot |
| `POST /api/devices/{id}/tasks/firmware-update` | Schedule firmware update |
| `POST /api/connect/sessions` | Generate an RMS Connect link — temporary public URL for tunneled access into the device's LAN (one-shot installer access path) |
| `GET /api/credits` | Account RMS credit balance — Connect sessions + automation tasks consume credits |

### 5.2 RMS Connect — the killer feature for installers

`POST /api/connect/sessions` mints a **time-bound public URL** that proxies into the LAN behind a Teltonika router. An installer can paste it into ACE Service Installer / Easee Connect / a browser without touching VPN config. Costs RMS credits per session.

This is the "no VPN, no on-site visit" path for Alfen onboarding when a Teltonika RUT is at the site (`alfen.md` §1.1 row 5). Sessions are typically valid for a few minutes to a few hours and can be scoped to specific ports (e.g. only port 80 / 443 / 502 for ACE / Modbus).

### 5.3 Pricing reality check

RMS has free + paid tiers. Free tier is heavily limited (1 device, limited features); paid is per-device per-month plus credits for tasks. For a CPMS with 100+ routers this is meaningful OpEx — budget accordingly. RMS Connect sessions consume credits per minute.

---

## 6. Modbus TCP (RUT955 / RUT956 / select industrial models)

Some Teltonika models expose their own Modbus TCP slave on port 502 reporting router internals (signal strength, uptime, modem temp, etc.). Different from the Modbus exposed by Alfen chargers — this is the *router's* Modbus, not the charger's.

Useful for SCADA-style integration where Modbus is already the lingua franca on-site. Less useful for cloud-CPMS (JSON-RPC and RMS cover the same ground more cleanly).

---

## 7. VPN deployment patterns

### 7.1 Site-to-site OpenVPN / WireGuard

Each site's Teltonika dials home to a Straumvakt-operated VPN concentrator (a Cloudflare Tunnel endpoint, a managed VPN appliance, or a peer Teltonika at HQ). The concentrator gives Straumvakt installers and ops staff routable access to every charger LAN on a private subnet.

Concrete topology:

```
Charger(s) at site
   192.168.10.0/24                          ── OCPP traffic ──────────►
        │                                                              │
   ┌────▼────┐                                                         │
   │  RUT955 │────────────── wireguard ──────────► concentrator ─►  Straumvakt
   │ (site)  │                tunnel               (cloud)            CSMS
   └─────────┘                                          │
        │                                               │
   wg0  10.42.X.1                                       │
                                              installer  │ ssh, ace, modbus
                                                laptop ──┘
```

### 7.2 RMS Connect (no VPN)

Operationally lighter — no VPN setup required, sessions are minted on-demand. Cost: RMS credits per minute. Good for irregular installer access; bad for continuous ops monitoring.

### 7.3 Direct port-forward (NOT recommended)

Some sites are tempted to port-forward the charger's web UI from the cellular WAN to make it "easy to access". **Don't.** SIM-side public IPs are scanned constantly; this is how charger fleets get compromised. If exposure is needed, do it through RMS Connect (token-bound, time-limited) or VPN (mutual auth).

---

## 8. Recommended baseline configuration

When Straumvakt sells a CPMS deployment that includes Teltonika RUT hardware, the routers should ship with this baseline pre-configured (whether via RMS bulk config, Teltonika-side factory image, or a first-boot setup script):

| Setting | Value | Reason |
|---|---|---|
| Default password | **changed** to a per-device random secret | Refuse to operate routers with the factory default `admin01` |
| WebUI access from WAN | disabled | Reduces public-internet attack surface |
| SSH access from WAN | disabled | Same |
| JSON-RPC from WAN | disabled | Same — keep RPC LAN/VPN-only |
| Default firewall input rules | drop all from cellular WAN | Only VPN tunnels and explicit forwards allowed in |
| OpenVPN / WireGuard | enabled, dialing the operator's concentrator | Provides the installer + monitoring path |
| Cellular APN | per SIM operator | |
| MultiWAN failover | wired primary, cellular backup (when wired exists) | Cost optimization |
| Mobile data-usage notifications | enabled, threshold = 80% of plan | Avoid overage surprises |
| NTP server | `pool.ntp.org` or local NTP | OCMF timestamps need accurate clocks |
| Timezone | site timezone (Iceland: `Atlantic/Reykjavik`) | Local logs read sensibly |
| RMS connection | enabled, claimed under operator account | Single-pane fleet visibility |
| Auto-firmware-update | **disabled** for production | Operator schedules updates explicitly |
| Logging | rsyslog → operator log sink (when network allows) | Centralized router event log |

---

## 9. Security considerations

- **Factory default credentials are a recurring incident class in industrial routers.** Validate before commissioning that `admin01` (RUT9xx) / `admin01` (RUTX) are no longer accepted. Some firmware versions enforce this on first WAN connect; older ones don't.
- **TR-069 / CWMP** is on by default on some firmware. If unused, disable — it's a remote-config protocol with a long history of vulnerabilities.
- **JSON-RPC `file.exec`** is a remote shell. Treat the JSON-RPC session token as equivalent to root-on-the-router; never log it, never persist beyond the immediate use.
- **SMS API** exposes the router's outbound SMS — billable, abusable. Keep restricted to operator scopes only.
- **OpenWrt CVE feed** applies to RutOS too, with vendor-specific fixes shipped via firmware. Track Teltonika firmware advisories.
- **RMS Connect tokens** are time-bound but high-privilege. Treat as session credentials; never paste into a public chat or commit to a repo.
- **Firmware verification.** RutOS firmware images are signed; always verify the signature before flashing. RMS handles this automatically; manual flashes via WebUI / TFTP need explicit verification.

---

## 10. Live findings

None yet — populate after the first deployed Teltonika RUT enters production scope. Expected items to verify:

- Exact JSON-RPC namespace names per RutOS major version (some renames between 6.x and 7.x)
- RMS Connect minimum session duration and rate limits
- Stability of `mobiled.signal` polling at sub-30 s cadence
- TR-069 default state on current factory firmware
- Whether `file.exec` is gated by a separate ACL on newer RutOS
- Modbus TCP slave port + register layout on RUT956 (does it match RUT955?)

---

## 11. Companion docs

- [`alfen.md`](alfen.md) — references Teltonika as the "VPN to charger LAN" path repeatedly.
- [`zaptec.md`](zaptec.md), [`easee.md`](easee.md) — chargers that may be deployed behind a Teltonika at sites without wired internet.
- [`ocpp-1.6j.md`](ocpp-1.6j.md), [`ocmf.md`](ocmf.md) — protocol references for what flows over the Teltonika's cellular link to the CSMS.

---

## 12. Sources

- [Teltonika Networks Web API portal](https://developers.teltonika-networks.com/) — local API documentation hub.
- [RutOS API overview](https://www.teltonika-networks.com/newsroom/rutos-api-the-key-to-remote-control-and-flexible-customization) — official feature announcement.
- [Monitoring via JSON-RPC (Linux)](https://wiki.teltonika-networks.com/view/Monitoring_via_JSON-RPC_linux_RutOS) — login flow + curl examples.
- [Monitoring via JSON-RPC (Windows)](https://wiki.teltonika-networks.com/view/Monitoring_via_JSON-RPC_windows_RutOS) — same content, PowerShell examples.
- [RMS API documentation](https://developers.rms.teltonika-networks.com/) — Cloud API reference.
- [RMS Authentication](https://developers.rms.teltonika-networks.com/pages/authentication.html) — Personal Access Token flow.
- [RMS API wiki overview](https://wiki.teltonika-networks.com/view/RMS_API) — community-maintained overview.
- [Generate RMS Connect link API example](https://wiki.teltonika-networks.com/view/Generate_RMS_Connect_link_API_example) — Connect-session minting.
- [RMS API Credits](https://wiki.teltonika-networks.com/view/RMS_API_Credits) — credit consumption model.
- [Teltonika Community Forum](https://community.teltonika.lt/) — implementation-detail clarifications.

---

## 13. Companion artifacts

None on disk yet. Planned:

| File | Where (planned) | Purpose |
|---|---|---|
| `teltonika-test/src/lib/rutos.ts` | scratch app (planned) | Reference implementation of JSON-RPC login + status reads |
| `teltonika-test/src/lib/rms.ts` | scratch app (planned) | Reference RMS API client (PAT-bearer, GET /devices, RMS Connect minting) |
| `straumvakt/src/lib/vendors/teltonika/` | production Straumvakt (planned) | Adapter module under `assets.modems` per V3 §4 polymorphic SiteAsset |
