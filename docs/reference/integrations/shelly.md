# Shelly — controller API integration reference

**Status:** reference data, not schema. **No live device probes yet** — content is from Shelly's official technical documentation and product documentation. Mark implementation details as `(unverified)` until tested against a real site controller.
**Last verified:** 2026-05-02 against Shelly Technical Documentation (`shelly-api-docs.shelly.cloud`) and Shelly Pro 4PM product documentation.
**V3 schema class:** **`Hardware / Controllers`** — `HardwareVendorKind = controller` or `multi`, `HardwareModel.kind = controller`, asset class extends `assets.site_assets` via `assets.controllers`.
**Primary use:**
1. Reference for Shelly-class onsite monitoring and switching devices used around charger sites.
2. Reference for the future Straumvakt controller adapter, especially Shelly Pro 4PM as a DIN-rail four-channel relay with per-channel power metering.
3. Cross-check for site-level control that is not charger/OCPP control.

> [!IMPORTANT]
> Shelly is **not a charger vendor** and does not implement OCPP for charger sessions. In Straumvakt it belongs to the controller/site-infrastructure lane: auxiliary relays, contactors, inputs, lightweight power metering, and local automation around a charging installation.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Vendor | Shelly / Shelly Group |
| Hardware tier | Smart relays, DIN-rail relays, power meters, inputs, controllers |
| Models in immediate scope | Shelly Pro 4PM, Shelly Pro 3EM, Shelly Plus/Pro relay devices |
| Reference model | **Shelly Pro 4PM** — four output channels, four power meters, LAN/Wi-Fi capable |
| Local API | Shelly Gen2+ JSON-RPC 2.0 over HTTP `/rpc`, WebSocket, MQTT RPC |
| Cloud API | Shelly Cloud Control API |
| Push/event paths | Webhooks, MQTT notifications, outbound WebSocket |
| Straumvakt asset kind | `SiteAssetKind = controller` |
| V3 `credential_scope` | `none` by default for LAN/VPN-local devices; cloud tokens may be stored as operator-side credentials when cloud control is used |

---

## 2. Why Straumvakt cares about Shelly

Shelly-class devices fill the gap between charger control and building/site control.

| Use case | Why it matters |
|---|---|
| Auxiliary contactor / relay control | Switch feeder-side or peripheral circuits that are not exposed through OCPP. |
| Site safety interlock | Read inputs from external controls and reflect them into charger availability or alerts. |
| Lightweight metering | Pro/PM devices expose active power and energy counters per channel, useful for site diagnostics. |
| Installer diagnostics | Local RPC over a Teltonika VPN gives operators direct device status without cloud dependency. |
| Event-driven automation | Webhooks/MQTT can notify Straumvakt when a relay, input, or measured power changes. |

Operational boundary: a Shelly action should never masquerade as `RemoteStartTransaction`. It is a site/controller command routed through a controller adapter.

---

## 3. Device and schema mapping

### 3.1 Straumvakt tables

| Straumvakt model | Mapping |
|---|---|
| `properties.site_assets` | One row with `kind = controller`, site/org ownership, display name, metadata |
| `assets.controllers` | `vendor = "shelly"`, `deviceId`, `endpointUrl`, `capabilities`, `lastSeenAt` |
| `hardware.vendors` | `slug = "shelly"`, `kind = controller` or `multi`, `apiKind = none` unless using cloud credentials |
| `hardware.models` | Model profiles such as `shelly-pro-4pm` with switch/input/meter channel counts |
| `assets.capability_profiles` | Optional observed capabilities by control plane, e.g. `shelly_rpc` |
| `assets.control_routing_policies` | Optional policy for commands that should route to controller instead of OCPP/vendor charger API |

### 3.2 Suggested `assets.controllers.capabilities`

```jsonc
{
  "api": "shelly-gen2-rpc",
  "model": "Shelly Pro 4PM",
  "channels": {
    "switch": 4,
    "input": 4,
    "meteredSwitch": 4
  },
  "transports": ["http_rpc", "websocket_rpc", "mqtt", "webhook"],
  "commands": ["get_status", "set_switch", "toggle_switch", "reset_energy_counters"],
  "telemetry": ["output", "active_power_w", "voltage_v", "current_a", "energy_wh", "temperature"]
}
```

---

## 4. Authentication and access

### 4.1 Local LAN / VPN

Shelly Gen2+ devices expose JSON-RPC methods locally. For Straumvakt, the preferred operational path is:

1. Device sits on the site LAN.
2. Site LAN is reachable through a Teltonika VPN, RMS Connect session, or equivalent private access path.
3. Straumvakt controller adapter calls local RPC over HTTP or WebSocket.

Recommended storage:

| Value | Store where |
|---|---|
| Device LAN URL | `assets.controllers.endpointUrl` |
| Device id | `assets.controllers.deviceId` |
| Model/capabilities | `assets.controllers.capabilities` |
| Credentials, if enabled | secret store reference; avoid plaintext in `metadata` |

### 4.2 Shelly Cloud Control API

Shelly Cloud Control API is available for devices registered to a Shelly Cloud account. The official docs require:

- Active Shelly Cloud account.
- Devices included in the account/app.
- Authorization cloud key generated in the app.
- The account's server URI from the same cloud-key page.

The cloud docs note a one-call-per-second API limit. Treat cloud control as a convenience and remote fallback, not as the high-frequency telemetry path.

### 4.3 Recommendation

Use local RPC over the site VPN for production site controllers. Use Shelly Cloud only when:

- The site network is not reachable.
- A customer already operates devices through Shelly Cloud.
- Rate limits are acceptable for the workflow.

---

## 5. Local Gen2+ RPC protocol

Shelly Gen2+ devices use JSON-RPC 2.0. The local HTTP endpoint is:

```
POST http://<device-ip>/rpc
Content-Type: application/json
```

Request shape:

```json
{
  "id": 1,
  "method": "Shelly.GetStatus",
  "params": {}
}
```

The RPC method namespace identifies the component or service:

| Namespace | Purpose |
|---|---|
| `Shelly` | Device-wide status, config, method discovery, reboot/update/factory operations |
| `Switch` | Relay/switch outputs with optional power metering |
| `Input` | Physical input state |
| `Sys` | System/runtime status |
| `WiFi` / `Eth` | Network configuration/status |
| `MQTT` | MQTT connection configuration/status |
| `Webhook` | Device-originated HTTP callbacks |
| `Script` | Device-side scripts |

Common HTTP convenience form:

```
GET http://<device-ip>/rpc/Shelly.GetStatus
GET http://<device-ip>/rpc/Switch.GetStatus?id=0
```

---

## 6. Device-wide RPC methods

| Method | Purpose | Straumvakt use |
|---|---|---|
| `Shelly.GetStatus` | Return status for all components | Main poll endpoint |
| `Shelly.GetConfig` | Return config for all components | Initial inventory / diagnostics |
| `Shelly.ListMethods` | List methods allowed for current channel/user | Capability discovery |
| `Shelly.GetDeviceInfo` | Device identity/build info | Provisioning, model verification |
| `Shelly.Reboot` | Reboot device | Operator action, destructive |
| `Shelly.CheckForUpdate` | Check firmware availability | Maintenance card |
| `Shelly.Update` | Trigger firmware update | Maintenance action, destructive |

Suggested poll flow:

1. `Shelly.GetDeviceInfo`
2. `Shelly.ListMethods`
3. `Shelly.GetConfig`
4. `Shelly.GetStatus`
5. Store discovered channel counts and capabilities.

---

## 7. Switch component

Shelly `Switch` controls relay outputs. Devices with power metering expose extra electrical telemetry on switch status.

### 7.1 Methods

| Method | Params | Purpose |
|---|---|---|
| `Switch.GetStatus` | `{ "id": 0 }` | Read one switch channel |
| `Switch.GetConfig` | `{ "id": 0 }` | Read channel config |
| `Switch.SetConfig` | `{ "id": 0, "config": { ... } }` | Write channel config |
| `Switch.Set` | `{ "id": 0, "on": true, "toggle_after": 10 }` | Turn output on/off, optional auto-revert |
| `Switch.Toggle` | `{ "id": 0 }` | Toggle output |
| `Switch.ResetCounters` | `{ "id": 0 }` | Reset energy counters where supported |

### 7.2 Example: read channel

```json
{
  "id": 1,
  "method": "Switch.GetStatus",
  "params": { "id": 0 }
}
```

Fields to normalize:

| Shelly field | Unit | Straumvakt mapping |
|---|---|---|
| `id` | - | controller channel index |
| `output` | bool | channel state |
| `source` | string | command source / audit context |
| `apower` | W | instantaneous active power |
| `voltage` | V | channel supply voltage |
| `current` | A | channel current |
| `aenergy.total` | Wh or device-reported unit | cumulative active energy |
| `temperature.tC` | Celsius | device/channel thermal telemetry |

### 7.3 Example: switch output

```json
{
  "id": 2,
  "method": "Switch.Set",
  "params": {
    "id": 0,
    "on": true,
    "toggle_after": 30
  }
}
```

Use `toggle_after` for temporary service actions where a relay should automatically revert.

### 7.4 Safety rule

Relay writes can cut power. Gate all `Switch.Set`, `Switch.Toggle`, and firmware-update calls behind explicit operator permissions and audit logging.

---

## 8. Pro 4PM reference profile

Shelly Pro 4PM is the first useful Straumvakt controller profile because it is DIN-rail mounted, LAN-capable, and provides four metered outputs.

Official component list for Shelly Pro 4PM includes:

| Component/service | Count / note |
|---|---|
| System | 1 |
| Wi-Fi | 1 |
| Ethernet | 1 |
| Bluetooth Low Energy | 1 |
| Cloud | 1 |
| MQTT | 1 |
| Outbound WebSocket | 1 |
| Input | 4 instances, `input:0` through `input:3` |
| Switch | 4 instances, `switch:0` through `switch:3` |
| Script | Up to 10 instances |
| UI | Screen/brightness config |
| Virtual/BTHome/KNX | Present in current docs for newer firmware lines |

Suggested `hardware.models.profile`:

```jsonc
{
  "model": "Shelly Pro 4PM",
  "mounting": "DIN rail",
  "network": ["ethernet", "wifi"],
  "components": {
    "switch": 4,
    "input": 4,
    "script": 10
  },
  "metering": {
    "per_switch": true,
    "active_power": true,
    "energy_counter": true
  },
  "transports": ["http_rpc", "websocket_rpc", "mqtt", "webhook", "cloud"]
}
```

---

## 9. Events and push

### 9.1 Webhooks

Shelly Webhook service sends HTTP requests when configured events fire. A webhook is associated with:

| Field | Meaning |
|---|---|
| `event` | Event name, e.g. `switch.on`, `switch.off`, `switch.active_power_change` |
| `cid` | Component instance id |
| `urls` | Destination URLs |
| `enable` | Whether hook is active |
| `ssl_ca` | TLS CA behavior |

For Straumvakt, webhooks should land on a future internal endpoint such as:

```
POST /api/internal/controllers/shelly/events
x-straumvakt-ingest: <shared secret or per-device token>
```

Do not accept unauthenticated public webhooks.

### 9.2 MQTT

Shelly MQTT supports:

- RPC over MQTT.
- RPC notifications.
- Component status notifications.
- Component control commands.

Switch command topic pattern:

```
<topic_prefix>/command/switch:<id>
```

Status topic pattern:

```
<topic_prefix>/status/switch:<id>
```

Accepted switch commands include `status_update`, `on`, `off`, and `toggle`, with optional timer syntax for on/off commands.

### 9.3 Outbound WebSocket

Shelly Gen2+ devices also support persistent RPC channels such as WebSocket. Treat this as a good fit for local LAN/VPN live updates when polling is too slow and MQTT is not deployed.

---

## 10. Cloud Control API

The cloud API is a remote-control surface for devices registered in Shelly Cloud. Straumvakt should model it as a secondary control plane.

Known official constraints:

| Concern | Behavior |
|---|---|
| Account | Requires active Shelly Cloud account |
| Device membership | Device must be included in the account/app |
| Auth | Authorization cloud key, or OAuth for supported flows |
| Server URI | Account-specific cloud host must be known |
| Rate limit | Current docs state one API call per second |

Use cases:

- Read device status when the site VPN is unavailable.
- Execute rare operator commands.
- Bootstrap customer-owned devices already connected to Shelly Cloud.

Avoid:

- High-frequency metering through cloud.
- Safety-critical switching that depends on cloud reachability.
- Storing cloud keys in plaintext or UI-accessible config.

---

## 11. Proposed Straumvakt API shape

No implementation exists yet. Suggested domain endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/controllers` | List controller site assets |
| `POST` | `/api/admin/controllers` | Create controller asset |
| `GET` | `/api/admin/controllers/:id` | Controller detail |
| `PATCH` | `/api/admin/controllers/:id` | Update endpoint/capabilities/status |
| `DELETE` | `/api/admin/controllers/:id` | Remove controller asset |
| `GET` | `/api/admin/controllers/:id/technical-read` | Live `Shelly.GetStatus` + config summary |
| `POST` | `/api/admin/controllers/:id/channels/:channelId/switch` | Set a relay output |
| `POST` | `/api/admin/controllers/:id/channels/:channelId/toggle` | Toggle relay output |
| `POST` | `/api/admin/controllers/:id/channels/:channelId/reset-counters` | Reset switch energy counters |
| `POST` | `/api/admin/controllers/:id/reboot` | Reboot controller |

Command response should match OCPP command style:

```json
{ "commandId": "<uuid>", "status": "pending" }
```

For direct local RPC commands that complete immediately, still write an audit event and return the observed result.

---

## 12. Adapter behavior

### 12.1 Discovery

1. Read `endpointUrl`.
2. Call `Shelly.GetDeviceInfo`.
3. Call `Shelly.ListMethods`.
4. Call `Shelly.GetConfig`.
5. Call `Shelly.GetStatus`.
6. Derive channel counts from `switch:<id>` and `input:<id>` keys.
7. Persist `deviceId`, model, firmware, and capabilities.

### 12.2 Polling

Recommended low-volume polling:

| Cadence | Call | Use |
|---|---|---|
| 30-60 s | `Shelly.GetStatus` | Controller online, channel output, power |
| 5-15 min | `Shelly.GetConfig` | Config drift |
| Daily | `Shelly.CheckForUpdate` | Maintenance |

Use webhooks/MQTT/WebSocket for faster event-driven operation.

### 12.3 Command idempotency

Use an idempotency key for relay commands:

```
scope = "vendor:shelly"
key = "<controllerId>:switch:<channelId>:<desiredState>:<correlationId>"
```

Before sending a write, read current state if the action is not explicitly a toggle. Prefer `Switch.Set` with desired `on` value over `Switch.Toggle` for repeatability.

---

## 13. Security considerations

- Do not expose Shelly device HTTP interfaces directly to the public internet.
- Prefer LAN/VPN access via Teltonika or another private site access path.
- Treat relay writes as potentially destructive.
- Do not log local credentials, cloud authorization keys, webhook secrets, or full callback URLs with embedded tokens.
- If using webhooks, require a per-device token or signed payload pattern at the Straumvakt ingest endpoint.
- Do not use `ssl_ca = "*"` for production webhooks except as a temporary commissioning workaround.
- Keep firmware update and reboot actions admin-only.
- Store cloud keys in a secret store, not in `assets.controllers.metadata`.

---

## 14. Live findings

None yet. First live probe should verify:

- Pro 4PM current firmware `Shelly.GetStatus` shape.
- Exact units for `aenergy.total` on Pro 4PM firmware in the field.
- Auth behavior when local RPC authentication is enabled.
- Whether Ethernet-only deployments still expose all expected RPC namespaces.
- Webhook delivery retry behavior and timeout.
- Cloud API host discovery and rate-limit behavior for the account type used by Straumvakt.
- How Pro 4PM V1 vs V2 differ in component list or payload fields.

---

## 15. Companion docs

- [`teltonika-rut.md`](teltonika-rut.md) — recommended private access path for site LAN devices.
- [`ocpp-1.6j.md`](ocpp-1.6j.md) — charger protocol boundary; Shelly is outside this boundary.
- [`zaptec.md`](zaptec.md), [`easee.md`](easee.md), [`alfen.md`](alfen.md) — charger vendors that may coexist with Shelly controllers at a site.

---

## 16. Sources

- [Shelly Gen2+ RPC Protocol](https://shelly-api-docs.shelly.cloud/gen2/General/RPCProtocol/)
- [Shelly component/service overview](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/)
- [Shelly service methods](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Shelly/)
- [Shelly Switch component](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/)
- [Shelly Webhook service](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Webhook/)
- [Shelly MQTT service](https://shelly-api-docs.shelly.cloud/gen2/0.14/ComponentsAndServices/Mqtt/)
- [Shelly Cloud Control API](https://shelly-api-docs.shelly.cloud/cloud-control-api/)
- [Shelly Pro 4PM technical documentation](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen2/ShellyPro4PM/)
