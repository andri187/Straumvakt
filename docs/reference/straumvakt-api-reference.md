# Straumvakt API reference

**Status:** implementation reference, not an external contract.
**Last reviewed:** 2026-05-02 against `apps/api/src`, `prisma/schema.prisma`, and `docs/reference/integrations/*`.
**Purpose:** one practical map of the Straumvakt API surface and the upstream APIs it wraps for Zaptec, Easee, Teltonika, and Shelly-class controller assets.

Straumvakt is the operating layer above OCPP, vendor clouds, and site infrastructure. Its API is intentionally domain-first: users operate organizations, sites, installations, chargers, credentials, and OCPP commands; vendor details stay behind adapters and reference documents.

---

## 1. System boundaries

| Boundary | Owner | Transport | Used for |
|---|---|---|---|
| Admin API | `apps/api` Hono Worker | HTTPS JSON | Operator UI, onboarding, asset CRUD, vendor credential management |
| Internal API | `apps/api` Hono Worker | HTTPS JSON with shared secret | OCPP gateway authorization and pending-discovery reporting |
| OCPP Gateway | `gateway` Worker + Durable Objects | WebSocket OCPP 1.6J | Charger protocol sessions and server-initiated OCPP calls |
| Vendor APIs | Zaptec, Easee, Teltonika, future Shelly | HTTPS / AMQP / SignalR / JSON-RPC | Discovery, telemetry mirrors, vendor-specific commands, router/controller monitoring |

The production rule is simple: callers should use Straumvakt domain endpoints. Direct vendor calls belong inside adapters or diagnostics.

---

## 2. Authentication model

### 2.1 Admin API

Admin routes are mounted under `/api/admin/*` and guarded by `requireAdmin`.

Current login flow:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/login` | Creates an admin session cookie |
| `POST` | `/api/admin/logout` | Clears the admin session |
| `GET` | `/api/admin/me` | Returns the verified admin session |

Session verification is cookie-based. The Next app forwards the admin cookie when server-rendered pages call the API worker.

### 2.2 Internal API

Internal routes are not user-facing. They use a shared Worker secret header:

```
x-straumvakt-ingest: <OCPP_INGEST_SECRET>
```

Use this only for gateway-to-API calls. Do not expose it to browsers, vendor integrations, or mobile clients.

### 2.3 Vendor credentials

Vendor portal credentials live in `hardware.vendor_credentials`. Passwords are AES-GCM encrypted with `OCPP_CRED_KEK`; plaintext is accepted only at write time and never returned.

Credential scope is driven by `hardware.models.credential_scope`:

| Scope | Meaning | Examples |
|---|---|---|
| `installation` | One credential set covers a vendor-managed AC installation | Zaptec, Easee |
| `identity` | Credential is tied to a specific OCPP identity or DC charger | Future DC adapters |
| `none` | No vendor credential; OCPP-only or infrastructure-only | Generic OCPP, many Alfen deployments |

---

## 3. Core admin endpoints

### 3.1 Organizations

Mounted at `/api/admin/orgs`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/orgs` | List organizations |
| `POST` | `/api/admin/orgs` | Create organization |
| `GET` | `/api/admin/orgs/:id` | Organization detail |
| `PATCH` | `/api/admin/orgs/:id` | Update organization |
| `POST` | `/api/admin/orgs/:id/archive` | Archive organization |
| `GET` | `/api/admin/orgs/:id/sites` | Sites owned by organization |
| `GET` | `/api/admin/orgs/:id/installations` | Installations owned by organization |
| `GET` | `/api/admin/orgs/:id/properties` | Properties owned by organization |
| `GET` | `/api/admin/orgs/:id/users` | Users in organization |
| `GET` | `/api/admin/orgs/:id/memberships` | Memberships |
| `POST` | `/api/admin/orgs/:id/memberships` | Add membership |
| `GET` | `/api/admin/orgs/:id/contracts` | Contracts |
| `GET` | `/api/admin/orgs/:id/family-groups` | Family groups |

### 3.2 Properties, sites, installations, circuits

| Resource | Base path | Supported operations |
|---|---|---|
| Properties | `/api/admin/properties` | list, create, get, patch, delete |
| Sites | `/api/admin/sites` | list, create, get, patch, delete, move |
| Installations | `/api/admin/installations` | list, create, get, patch, delete |
| Circuits | `/api/admin/circuits` | list, create, get, patch, delete |

Additional site paths:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/sites/tree` | Operator-facing site tree |
| `GET` | `/api/admin/sites/:siteId/circuits` | Circuits at site |
| `GET` | `/api/admin/sites/:siteId/installations` | Installations at site |
| `POST` | `/api/admin/sites/:siteId/move` | Move site in tenant hierarchy |

### 3.3 Users and memberships

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/users` | List users |
| `POST` | `/api/admin/users` | Create user |
| `GET` | `/api/admin/users/:id` | User detail |
| `PATCH` | `/api/admin/users/:id` | Update user |
| `PATCH` | `/api/admin/memberships/:orgId/:userId` | Update membership |
| `DELETE` | `/api/admin/memberships/:orgId/:userId` | Remove membership |
| `GET` | `/api/admin/groups` | Vendor/user groups |

---

## 4. Charger and OCPP endpoints

Mounted at `/api/admin/chargers`.

### 4.1 Charger CRUD

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/chargers` | List charging stations |
| `POST` | `/api/admin/chargers` | Create charging station, EVSE, connector, and OCPP identity chain |
| `GET` | `/api/admin/chargers/:id` | Charging station detail |
| `PATCH` | `/api/admin/chargers/:id` | Update charging station |
| `DELETE` | `/api/admin/chargers/:id` | Delete the site asset chain |
| `GET` | `/api/admin/chargers/:id/technical-read` | Slow live vendor-side telemetry read, currently Zaptec-backed |

Create responses include a one-time OCPP password note. Straumvakt stores only the hash; the password cannot be retrieved later.

### 4.2 OCPP outbound commands

These endpoints are addressed by `ocppIdentityId`, not by charging-station id. They write an `ocpp.outbound_commands` row, publish to `OUTBOUND_QUEUE`, and return `202`.

| Method | Path | Domain action | OCPP action |
|---|---|---|---|
| `POST` | `/api/admin/chargers/:ocppIdentityId/remote-start` | Start session | `RemoteStartTransaction` |
| `POST` | `/api/admin/chargers/:ocppIdentityId/remote-stop` | Stop session | `RemoteStopTransaction` |
| `POST` | `/api/admin/chargers/:ocppIdentityId/get-configuration` | Read config keys | `GetConfiguration` |
| `POST` | `/api/admin/chargers/:ocppIdentityId/change-configuration` | Write config key | `ChangeConfiguration` |

Request bodies:

```jsonc
// remote-start
{ "connectorId": "<connector uuid>", "idTag": "<driver/card/backend idTag>" }

// remote-stop
{ "transactionId": 1234 }

// get-configuration; body optional
{ "key": ["LocalAuthListEnabled", "AuthorizeRemoteTxRequests"] }

// change-configuration
{ "key": "LocalPreAuthorize", "value": "false" }
```

Response shape:

```json
{ "commandId": "<uuid>", "status": "pending" }
```

---

## 5. Vendor credential endpoints

### 5.1 Platform-wide

Mounted at `/api/admin/vendor-credentials`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/vendor-credentials` | List all stored credentials |
| `GET` | `/api/admin/vendor-credentials/:id` | Credential summary |
| `PATCH` | `/api/admin/vendor-credentials/:id` | Update password, status, notes |
| `DELETE` | `/api/admin/vendor-credentials/:id` | Delete credential |
| `GET` | `/api/admin/vendor-credentials/:id/manage-tree` | Compare vendor tree with Straumvakt DB |
| `POST` | `/api/admin/vendor-credentials/:id/apply` | Apply selected vendor chargers/import management changes |
| `POST` | `/api/admin/vendor-credentials/:id/move` | Move credential to another organization |

### 5.2 Organization-scoped

Mounted at `/api/admin/orgs/:orgId/vendor-credentials`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/orgs/:orgId/vendor-credentials` | List credentials owned by one org |
| `POST` | `/api/admin/orgs/:orgId/vendor-credentials` | Store a credential for a vendor slug |

Create body:

```json
{
  "vendorSlug": "zaptec",
  "username": "operator@example.com",
  "password": "secret",
  "notes": "Dalvegur pilot"
}
```

---

## 6. Zaptec-specific admin endpoints

Mounted at `/api/admin/zaptec`.

| Method | Path | Purpose | Side effects |
|---|---|---|---|
| `POST` | `/api/admin/zaptec/discover` | Exchange portal credentials, list installations, fetch hierarchy | None |
| `POST` | `/api/admin/zaptec/import` | Import one Zaptec installation into Straumvakt | Creates installation, chargers, EVSEs, connectors, OCPP identities |
| `POST` | `/api/admin/zaptec/inspect` | Compare vendor-side OCPP config with DB expectations | None |
| `POST` | `/api/admin/zaptec/probe-users` | Diagnostic probe of Zaptec user/group endpoints | None |
| `POST` | `/api/admin/zaptec/bulk-auth` | Toggle Zaptec `AuthenticationRequired` over a site/installation/circuit/charger scope | Writes Zaptec charger config |

Zaptec upstream reference: [`integrations/zaptec.md`](integrations/zaptec.md).

Key upstream endpoints used by the adapter:

| Zaptec endpoint | Straumvakt use |
|---|---|
| `POST /oauth/token` | Portal credential exchange |
| `GET /api/installation` | Discover installations |
| `GET /api/installation/{id}/hierarchy` | Circuit and charger tree |
| `GET /api/chargers?InstallationId=...` | Charger list and online flags |
| `GET /api/chargers/{id}` | Detail, OCPP URL/password fields, OCMF lifetime meter |
| `GET /api/chargers/{id}/state` | Technical Read telemetry |
| `POST /api/chargers/{id}/update` | Bulk auth/config writes |
| `POST /api/chargers/{id}/sendCommand/{commandId}` | Vendor-native commands |
| `GET /api/constants` | Authoritative Zaptec enums |

Important Zaptec behavior:

- Zaptec `AuthenticationType = 2` means cloud-routed OCPP; `3` means native OCPP.
- In OCPP modes, Zaptec app/RFID portal auth is bypassed for charging; Straumvakt/CSMS owns authorization.
- `installation.OcppCloudUrl` supplies the OCPP charge-box identity path tail.
- `StateId -3` mirrors OCPP connection state; raw frames and configuration remain CSMS-side.

---

## 7. Easee reference mapping

There is not yet an Easee production route set in `apps/api`, but the API shape is documented for the future adapter.

Easee upstream reference: [`integrations/easee.md`](integrations/easee.md).

| Easee endpoint | Straumvakt domain mapping |
|---|---|
| `POST /api/accounts/login` | Store/use installation-scoped credential |
| `POST /api/accounts/refresh_token` | Refresh short-lived JWT |
| `GET /api/sites` | Discover installations |
| `GET /api/sites/{siteId}/circuits` | Import circuits and chargers |
| `GET /api/chargers/{id}/state` | Technical Read telemetry |
| `POST /api/chargers/{id}/commands/start_charging` | `start-session` / OCPP `RemoteStartTransaction` equivalent |
| `POST /api/chargers/{id}/commands/stop_charging` | `stop-session` / OCPP `RemoteStopTransaction` equivalent |
| `POST /api/chargers/{id}/commands/reboot` | Reset/reboot |
| `POST /api/chargers/{id}/dynamic_current` | Load-management write |
| `GET /api/equalizers/{id}/state` | Site meter / DLB input |

Important Easee behavior to preserve in the adapter:

- Easee "Site" maps to `properties.installations`.
- Token TTL is about one hour; refresh handling matters.
- SignalR is the real-time path.
- Easee Equalizer should become a `meter` site asset, not a charger.
- Several details remain unverified until a live Easee probe is run.

---

## 8. Teltonika reference mapping

Teltonika is not a charger vendor. It is a `modem` / site infrastructure integration used for cellular backhaul, VPN, and remote access.

Teltonika upstream reference: [`integrations/teltonika-rut.md`](integrations/teltonika-rut.md).

| Teltonika API | Straumvakt domain mapping |
|---|---|
| Local JSON-RPC `session.login` on `/ubus` | Per-router operator access over LAN/VPN |
| Local JSON-RPC `system.info`, `system.board` | Modem health/detail |
| Local JSON-RPC `mobiled.signal`, `mobiled.network`, `mobiled.sim` | Signal quality, RAT, SIM identifiers |
| Local JSON-RPC `dhcp.ipv4leases` | Find chargers on the LAN |
| Local JSON-RPC `vpn.*.status` | Installer/ops access health |
| RMS `GET /api/devices` | Fleet-wide modem list |
| RMS `GET /api/devices/{id}/data-usage` | SIM cost/anomaly monitoring |
| RMS `POST /api/connect/sessions` | Temporary installer access into site LAN |

Straumvakt schema mapping:

| Table/model | Fields |
|---|---|
| `properties.site_assets` | `kind = modem`, display name, metadata |
| `assets.modems` | `imei`, `carrier`, `iccid`, `lastSeenAt` |
| `hardware.vendors` | `slug = "teltonika"`, `kind = modem` |
| `hardware.models` | RUT/RUTX/RUTM model profiles |

Operational rule: use Teltonika to answer "is the site online?" before debugging charger OCPP or vendor-cloud state.

---

## 9. Shelly-class controller mapping

Shelly upstream reference: [`integrations/shelly.md`](integrations/shelly.md).

The schema already has a controller asset class for Shelly-style monitoring and switching devices.

Current Straumvakt schema mapping:

| Table/model | Fields |
|---|---|
| `properties.site_assets` | `kind = controller` |
| `assets.controllers` | `vendor`, `deviceId`, `endpointUrl`, `capabilities`, `lastSeenAt` |
| `hardware.vendors` | Planned `slug = "shelly"`, `kind = controller` or `multi` |
| `hardware.models` | Per-device capability template |

Expected API concerns for the future Shelly adapter:

| Concern | Straumvakt mapping |
|---|---|
| Device identity | `assets.controllers.deviceId` |
| Local URL or cloud URL | `assets.controllers.endpointUrl` |
| Relay/input/power-meter capabilities | `assets.controllers.capabilities` |
| Last successful poll/webhook | `assets.controllers.lastSeenAt` |
| Site-level action | Domain command routed to controller, not to OCPP |

Do not add direct Shelly calls to the UI. Add a controller adapter behind the Straumvakt API, then expose controller status/actions as domain operations.

---

## 10. Internal gateway endpoints

Mounted under `/api/internal`.

| Method | Path | Caller | Purpose |
|---|---|---|---|
| `POST` | `/api/internal/ocpp-auth` | OCPP gateway | Validate OCPP Basic Auth and resolve identity |
| `POST` | `/api/internal/pending-discovery` | OCPP gateway | Record unknown charger identity for operator claim flow |

The gateway also posts inbound OCPP event envelopes to `/api/ocpp/events` in the main app path in older/current transition notes. The target architecture is to mount queue-backed inbound OCPP ingest in the API worker.

---

## 11. Domain objects and vendor alignment

| Straumvakt entity | Meaning | Vendor examples |
|---|---|---|
| `Organization` | Tenant / operator / party | CPO, site host, vendor org |
| `Property` | Physical property grouping | Building, depot, retail site group |
| `Site` | Operating location | Parking lot, garage, depot |
| `Installation` | Vendor-managed AC grouping | Zaptec Installation, Easee Site |
| `Circuit` | Load-balancing/electrical group | Zaptec Circuit, Easee Circuit |
| `SiteAsset` | Polymorphic physical thing at a site | charger, meter, modem, controller |
| `ChargingStation` | Physical charger asset | Zaptec Pro, Easee Charge, Alfen Eve |
| `EVSE` | EVSE unit inside a station | OCPP 2.0.1 native, one per connector for 1.6 |
| `Connector` | Physical connector | Type 2 / CCS2 |
| `OcppIdentity` | Control endpoint identity | Zaptec OCPP path tail, generic charge-box id |
| `VendorAssetRef` | Vendor resource pointer | Zaptec charger UUID, future Easee serial/id |
| `CapabilityProfile` | Observed/declared capabilities by control plane | OCPP, Zaptec REST, Easee REST |
| `ControlRoutingPolicy` | Which plane handles each command | Prefer OCPP, fallback vendor API |

---

## 12. Error and response conventions

Current route code uses compact JSON errors:

| Error | Typical status | Meaning |
|---|---|---|
| `validation` | `400` | Zod input validation failed |
| `not_found` | `404` | Requested local row missing |
| `invalid_credentials` | `401` | Vendor/admin credentials rejected |
| `already_exists` | `409` | Unique constraint conflict |
| `zaptec_unreachable` | `502` | Upstream vendor unavailable |
| `zaptec_auth_failed` | `502` | Stored credential failed upstream auth |
| `kek_unavailable` | `500` | Worker missing credential encryption key |

Long-running control actions should return `202` with `{ commandId, status }` and be correlated through command/event logs, not block waiting for charger completion.

---

## 13. Adapter design rules

1. Keep the Straumvakt API domain-first. Avoid leaking vendor path names into UI contracts except in diagnostics.
2. Store vendor credentials only through `vendor_credentials`; never store plaintext.
3. Treat OCPP identity as a control attachment, not as the physical charger.
4. Route commands by capability: OCPP when available, vendor API when the charger is vendor-managed and OCPP cannot express the action, controller API for site controllers.
5. Normalize telemetry into site assets, EVSEs, connectors, sessions, meter values, and observations. Keep raw vendor payloads in metadata/audit only when useful.
6. Mark unverified vendor behavior until confirmed against live hardware.
7. Use Teltonika/site connectivity state before declaring a charger or vendor API incident.
8. Add Shelly as a controller adapter, not as a charger adapter.

---

## 14. Source references

- [`integrations/README.md`](integrations/README.md) - vendor integration catalogue and shared adapter shape.
- [`integrations/zaptec.md`](integrations/zaptec.md) - live Zaptec REST/OCPP reference.
- [`integrations/easee.md`](integrations/easee.md) - Easee REST/SignalR/OCPP reference.
- [`integrations/teltonika-rut.md`](integrations/teltonika-rut.md) - Teltonika local JSON-RPC and RMS reference.
- [`integrations/shelly.md`](integrations/shelly.md) - Shelly local RPC, webhooks, MQTT, and cloud-control reference.
- [`integrations/ocpp-1.6j.md`](integrations/ocpp-1.6j.md) - OCPP 1.6J protocol reference.
- [`integrations/ocmf.md`](integrations/ocmf.md) - signed metering reference.
- `apps/api/src/index.ts` - mounted Hono routes.
- `apps/api/src/routes/admin/*` - admin endpoint implementations.
- `apps/api/src/routes/internal/*` - gateway/internal endpoint implementations.
- `prisma/schema.prisma` - canonical V3 domain/schema mapping.
