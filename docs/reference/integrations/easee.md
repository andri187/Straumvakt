# Easee — API + OCPP integration reference

**Status:** reference data, not schema. **No live charger probes yet** — content is from public docs, the unofficial `pyeasee` library, and Easee's developer portal navigation. Treat anywhere it disagrees with first-hand observation as suspect.
**Last verified:** 2026-04-26 against `developer.easee.com`.
**Primary use:**
1. Reference for the future Easee adapter (V3 hardware-catalog `credential_scope = installation` — same shape as Zaptec).
2. Cross-vendor parity check against [`zaptec.md`](zaptec.md). The two AC vendors share enough surface area that a single adapter framework with vendor strategies is feasible.
3. Pre-flight reading before connecting to a real Easee fleet.

> [!IMPORTANT]
> No Easee charger has been probed for this doc. **Anywhere this file states a value or behavior, it is sourced from documentation or a community library** — never live observation. Mark with `(unverified)` when you transcribe values into operational code, and verify with a real charger before committing.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Vendor | Easee AS (Norway) |
| Hardware tier | AC chargers + home energy meter (Equalizer) |
| Models in scope | Easee Home, Easee Charge, Easee One, Easee Up |
| Cloud backend | Microsoft Azure (SignalR for push, REST front-door at `api.easee.com`) |
| OCPP support | 1.6J cloud-routed and box-level |
| `credential_scope` (per V3 §10) | **`installation`** — Easee's "Site" maps to our `properties.installations` row |
| API style | JWT REST + SignalR (WebSocket) push |

Easee uses **Site** at the same level Zaptec uses **Installation**. Both contain Circuits and Chargers. The V3 schema models both as `properties.installations`; vendor-specific subtype is recorded in `properties.installations.metadata`.

---

## 2. Authentication

### 2.1 Endpoint

```
POST https://api.easee.com/api/accounts/login
Content-Type: application/json

{
  "userName": "<email or +countrycode-phone>",
  "password": "<portal password>"
}
```

Response:
```jsonc
{
  "accessToken": "<JWT>",
  "refreshToken": "<token>",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "accessClaims": ["Partner"]   // or ["User"], ["Admin"]
}
```

Token TTL: **1 hour** (much shorter than Zaptec's ~24 h). A separate refresh-token endpoint is documented:

```
POST https://api.easee.com/api/accounts/refresh_token
{ "accessToken": "<expired>", "refreshToken": "<rt>" }
```

### 2.2 Account types — drives integration shape

Per Easee's developer docs:

| Account type | What it can do | Use in Straumvakt |
|---|---|---|
| **Home / Small Business** | Control privately owned chargers via the public API. Cannot monetize on users. | Demo / scratch only |
| **Operator (Partner / CPO)** | Multi-site. Manages chargers by serial number. Can be offered to multiple site owners. | Production adapter |

The V3 adapter must use a Partner-claim account (`accessClaims: ["Partner"]`) — the User-claim API has a hard "no monetisation" restriction in Easee's terms.

### 2.3 Quirks (unverified — to confirm at first probe)

1. **userName accepts both email and `+<country>-<phone>`** — depending on how the operator account was created.
2. **Bearer-token format is JWT** with claims; the integration may want to inspect `accessClaims` to detect privilege downgrade.
3. **Refresh-token rotation:** unclear from docs whether refreshing returns a new refresh token or rotates the existing one — verify on first connection and document here.

---

## 3. REST API surface

Documented endpoint groups on `https://developer.easee.com/`:

| Group | Notes |
|---|---|
| Authentication | `/api/accounts/login`, `/api/accounts/refresh_token`, profile lookup |
| Command and Control | Per-charger imperative commands (start/stop/reboot/...) |
| Smart Charging | Charging profiles (analogous to OCPP SetChargingProfile) |
| Observations / Measurands | State observation reads + historical |
| OCPP | Cloud-routed and box-level commissioning |
| AMQP / SignalR | Real-time push |
| Charger Management | Current limits, scheduling, load balancing, settings, firmware |
| Equalizer | Easee's home-energy-meter add-on |

### 3.1 Sample paths (from public docs + pyeasee)

| Method · Path | Purpose |
|---|---|
| `POST /api/accounts/login` | Auth — see §2 |
| `POST /api/accounts/refresh_token` | Refresh JWT |
| `GET /api/accounts/profile` | Authenticated user's profile |
| `GET /api/sites` | List sites the user can see |
| `GET /api/sites/{siteId}` | Site detail |
| `GET /api/sites/{siteId}/circuits` | Circuits + chargers under the site |
| `GET /api/chargers` | List chargers across sites |
| `GET /api/chargers/{id}` | Charger config |
| `GET /api/chargers/{id}/state` | Live state — analog to Zaptec `GET /api/chargers/{id}/state` |
| `GET /api/chargers/{id}/details` | Hardware identity (firmware, MAC, etc.) |
| `GET /api/chargers/{id}/sessions/ongoing` | Currently active session |
| `GET /api/chargers/{id}/sessions/{sessionId}` | Session detail |
| `POST /api/chargers/{id}/commands/start_charging` | RemoteStart equivalent |
| `POST /api/chargers/{id}/commands/stop_charging` | RemoteStop equivalent |
| `POST /api/chargers/{id}/commands/reboot` | Reboot |
| `POST /api/chargers/{id}/commands/pause_charging` | Pause |
| `POST /api/chargers/{id}/commands/resume_charging` | Resume |
| `POST /api/chargers/{id}/commands/update_firmware` | Firmware upgrade |
| `POST /api/chargers/{id}/settings` | Write settings |
| `POST /api/chargers/{id}/dynamic_current` | Set dynamic current per phase |
| `GET /api/chargers/{id}/lifetime_energy` | Cumulative kWh |
| `GET /api/equalizers/{id}/state` | Easee Equalizer (energy meter) state |

> [!NOTE]
> Easee uses **descriptive REST paths** (`commands/start_charging`) instead of Zaptec's numeric command IDs (`sendCommand/506`). Cleaner for humans, slightly more verbose on the wire. Adapter design should map both to the same domain action ("start session", "stop session", etc.).

### 3.2 No public OpenAPI spec

Unlike Zaptec (`/swagger/v1/swagger.json`), Easee does not publish a machine-readable OpenAPI spec. The developer portal is built on ReadMe.io. The most accurate machine-readable map is the unofficial [`pyeasee/const.py`](https://github.com/nordicopen/pyeasee/blob/master/pyeasee/const.py) — verified against the SignalR observation stream.

---

## 4. State observations

The single enum **`ChargerStreamData`** in `pyeasee/const.py` carries ~180 observation IDs in three families: `state_*`, `config_*`, `schedule_*`. The list below is a curated subset most relevant to the Straumvakt adapter — for the full list, dump `const.py`.

### 4.1 Operation
| ID | Name | Notes |
|---|---|---|
| 109 | `state_chargerOpMode` | Operation mode integer (Zaptec analog: StateId 710) |
| 110 | `state_outputPhase` | Active output phases bitmask |
| 100 | `state_pilotMode` | CP pilot letter (A–F) |
| 96 | `state_reasonForNoCurrent` | **Enum explaining "why is the charger idle"** — Zaptec has no direct analog |
| 31 | `config_isEnabled` | Charger globally enabled |
| 38 | `config_phaseMode` | 1=locked-1ph, 2=auto, 3=locked-3ph |
| 42 | `config_authorizationRequired` | Auth required |
| 41 | `config_localAuthorizationRequired` | Local RFID required |
| 44 | `config_smartButtonEnabled` | Capacitive button on the front |
| 45 | `config_offlineChargingMode` | Behavior when offline |

### 4.2 Electrical (live)
| ID | Name | Unit |
|---|---|---|
| 47 | `config_maxChargerCurrent` | A (persistent max) |
| 48 | `state_dynamicChargerCurrent` | A (volatile DLB allocation — Zaptec analog: 708) |
| 114 | `state_outputCurrent` | A (signaled to car via pilot) |
| 115 | `state_deratedCurrent` | A (after derating) |
| 116 | `state_deratingActive` | bool |
| 22 / 23 / 24 | `config_circuitMaxCurrentP1/P2/P3` | A (per-phase circuit fuse) |
| 50 / 51 / 52 | `state_offlineMaxCircuitCurrentP1/P2/P3` | A (offline fallback) |
| 70 / 71 / 72 | `state_circuitTotalAllocatedPhaseConductorCurrentL1/L2/L3` | A (DLB allocation, master-only) |
| 73 / 74 / 75 | `state_circuitTotalPhaseConductorCurrentL1/L2/L3` | A (actual current sum, master-only) |
| 111 / 112 / 113 | `state_dynamicCircuitCurrentP1/P2/P3` | A (live DLB cap) |
| 120 | `state_totalPower` | kW (Zaptec analog: 513 in W) |

### 4.3 Energy / metering
| ID | Name | Unit | Notes |
|---|---|---|---|
| 121 | `state_sessionEnergy` | kWh | Resets per session |
| 122 | `state_energyPerHour` | kWh/h | |
| 124 | `state_lifetimeEnergy` | kWh | **Not OCMF-signed by default** — billing-grade signed metering is an Easee feature add-on |
| 125 | `state_lifetimeRelaySwitches` | count | Relay wear |
| 126 | `state_lifetimeHours` | hours | Total operation time |
| 129 | `state_ChargingSession` | JSON | Embedded session blob (analog to Zaptec 723) |

### 4.4 Connectivity
| ID | Name |
|---|---|
| 130 | `state_cellRSSI` (dBm) |
| 131 | `state_CellRAT` (radio access tech enum) |
| 132 | `state_wiFiRSSI` (dBm) |
| 81 | `state_ICCID` |
| 82 | `state_modemFwId` |
| 84 | `state_mobileNetworkOperator` |
| 141 | `state_chargerRAT` (0=cellular, 1=wifi) |
| 134 | `config_wiFiAddress` |
| 133 | `config_cellAddress` |
| 36 | `config_wiFiSSID` |

### 4.5 Site-level fleet stats (master-only) — **no Zaptec equivalent**
| ID | Name |
|---|---|
| 76 | `state_numberOfCarsConnected` |
| 77 | `state_numberOfCarsCharging` |
| 78 | `state_numberOfCarsInQueue` |
| 79 | `state_numberOfCarsFullyCharged` |
| 97 | `state_loadBalancingNumberOfConnectedChargers` |

These are interesting — Easee exposes per-site aggregate counters that Zaptec leaves you to compute. The Straumvakt adapter may keep them as `Site.metadata` projections.

### 4.6 Authentication
| ID | Name |
|---|---|
| 15 | `config_localPreAuthorizeEnabled` (OCPP `LocalPreAuthorize` mirror) |
| 16 | `config_localAuthorizeOfflineEnabled` (OCPP `LocalAuthorizeOffline` mirror) |
| 17 | `config_allowOfflineTxForUnknownId` (OCPP `AllowOfflineTxForUnknownId` mirror) |
| 28 | `config_rfidAuthTimeoutSec` |
| 30 | `state_lockCablePermanently` |
| 69 | `state_pairedUserIDToken` (recently presented card during pairing) |
| 108 | `state_userIDTokenReversed` (live tap; **note the byte-order quirk** — pyeasee comments mark this string as needing reversal) |
| 128 | `state_userIDToken` (corrected version) |

### 4.7 Diagnostics
| ID | Name |
|---|---|
| 117 | `state_debugString` |
| 118 | `state_errorString` |
| 119 | `state_errorCode` (errorCode enum) |
| 32 | `state_temperatureMonitorState` |
| 89 | `state_rebootReason` (bitmask) |
| 142–145 | cellular / wifi interface error & reset counters |

### 4.8 Hardware identity
| ID | Name |
|---|---|
| 80 | `state_chargerFirmware` |
| 90 | `state_powerPCBVersion` |
| 91 | `state_comPCBVersion` |
| 107 | `state_backPlateID` (charger's RFID UID; analog to `DeviceId`) |
| 137 | `state_masterBackPlateID` (master charger ID for the circuit) |

### 4.9 Temperature (granular — **richer than Zaptec**)
| ID | Name |
|---|---|
| 150 | `state_tempMax` |
| 151 | `state_tempAmbientPowerBoard` |
| 152–155 | `state_tempInputT2..T5` |
| 160–163 | `state_tempOutputN, L1, L2, L3` (Type-2 connector pin temps) |
| 164 | `state_tempRelayN` |
| 165 | `state_tempRelayL` |
| 166 | `state_tempAmbientPowerBoardTop` |
| 170 | `state_tempAmbient` (COM board) |
| 172 | `state_intRelHumidity` |

Easee instruments per-pin temperature on the connector itself, which Zaptec does not. Useful for early-warning of cable / contact wear.

### 4.10 Equalizer (energy meter, separate device)

Easee's Equalizer is a HAN-port-or-CT-clamp meter that reports grid import/export. It plugs into the same Site as the chargers and feeds DLB. State observations come on a different SignalR channel; treated as a separate `assets.meter` row in V3.

---

## 5. Commands

| Action | Easee | Domain action | Zaptec equivalent |
|---|---|---|---|
| Start session | `POST /api/chargers/{id}/commands/start_charging` | start-session | _(no API equivalent — only OCPP RemoteStart)_ |
| Stop session | `POST /api/chargers/{id}/commands/stop_charging` | stop-session | `sendCommand/506` |
| Pause session | `POST /api/chargers/{id}/commands/pause_charging` | pause-session | `sendCommand/506` |
| Resume session | `POST /api/chargers/{id}/commands/resume_charging` | resume-session | `sendCommand/507` |
| Reboot | `POST /api/chargers/{id}/commands/reboot` | reboot | `sendCommand/102` |
| Update firmware | `POST /api/chargers/{id}/commands/update_firmware` | firmware-upgrade | `sendCommand/200` |
| Set dynamic current | `POST /api/chargers/{id}/dynamic_current` | set-current-cap | _(via charger settings)_ |
| Override schedule | _(in Smart Charging group)_ | override-schedule | _(via SetChargingProfile over OCPP)_ |

Easee documents `start_charging` as a real-time path — Zaptec doesn't have a REST analog (you have to RemoteStart over OCPP). That makes Easee's REST surface slightly **more powerful for lifecycle control**.

---

## 6. Real-time push — SignalR

Easee uses Microsoft SignalR (WebSocket-based) for the observation stream. Connection details vary by account type:

```
wss://api.easee.com/hubs/chargers
Authorization: Bearer <accessToken>
```

The hub broadcasts JSON messages of the form:
```json
{
  "id": <int observation id>,
  "value": <typed payload>,
  "valueText": "<string form>",
  "timestamp": "<ISO 8601>",
  "dataType": <int>,
  "mid": "<charger backplate id>"
}
```

This is **conceptually parallel to Zaptec's Service Bus AMQP topic** — the difference is the transport (SignalR / WebSocket vs AMQP 1.0). Both use Azure on the backend; both are server-side push for observation deltas.

### 6.1 Adapter implication

A Cloudflare Worker can speak SignalR (the SignalR JSON protocol over WebSocket is straightforward; the binary `MessagePack` variant requires a polyfill). Compare this with Zaptec's AMQP 1.0, which is harder to implement on Workers — Zaptec also exposes a `messagingConnectionDetails` per-installation, while Easee uses one global hub gated by JWT claims.

---

## 7. OCPP integration

Both cloud-routed and box-level (native) OCPP 1.6J are supported. Two relevant doc pages:

- [Commissioning for operators (CPOs)](https://developer.easee.com/docs/ocpp-commissioning-api) — operator endpoints to set the CSMS URL on a whole site at once.
- [Commissioning for users](https://developer.easee.com/docs/ocpp-commissioning-easee-users) — user-side flow, more limited.

The operator commissioning API exposes endpoints like:

| Method · Path | Purpose |
|---|---|
| `POST /api/operators/{id}/sites/{siteId}/connection-configuration` | Set CSMS URL + auth on the whole site |
| `POST /api/operators/{id}/chargers/{chargerId}/connection-configuration` | Override per charger |
| `GET /api/operators/{id}/connection-configuration` | List saved configs |

Once configured, the charger talks OCPP 1.6J directly to the CSMS (box-level) or via Easee's relay (cloud-routed). The local auth list semantics match Zaptec — same OCPP keys (`LocalAuthListEnabled`, `LocalAuthorizeOffline`, `LocalPreAuthorize`, `AuthorizationCacheEnabled`, `AllowOfflineTxForUnknownId`, `StopTransactionOnInvalidId`).

### 7.1 Local auth list

Per Easee's own state observations:
- StateId 41 `config_localAuthorizationRequired` — turns on local RFID enforcement
- StateId 16 `config_localAuthorizeOfflineEnabled` — defaults to `true` per OCPP profile
- StateId 17 `config_allowOfflineTxForUnknownId` — defaults to `false`
- StateId 28 `config_rfidAuthTimeoutSec` — backend timeout before falling through to offline rules

The list is synced from the operator portal (Native mode) or via OCPP `SendLocalList` (box-level mode), same pattern as Zaptec. Persisted on the charger's backplate.

---

## 8. Comparison cheat-sheet

| Concern | Zaptec | Easee |
|---|---|---|
| **Auth** | OAuth password, ~24 h JWT, `scope=openid` mandatory | JWT-style login, 1 h JWT, separate refresh-token endpoint |
| **API style** | Numeric command IDs (`sendCommand/{id}`) | Descriptive REST paths (`/commands/start_charging`) |
| **OpenAPI spec** | Public (`/swagger/v1/swagger.json`) | Not published; portal is ReadMe.io |
| **Enum catalogue** | `/api/constants` (one document) | Scattered; rely on `pyeasee/const.py` |
| **State observation count** | ~155 | ~180 |
| **Real-time push** | Azure Service Bus AMQP, per-installation topic | Microsoft SignalR, global hub |
| **Lifetime kWh signing** | OCMF in StateId 554 (free) | Add-on feature; not signed by default |
| **Site-level aggregate counters** | none | rich (cars connected/charging/queued/finished) |
| **Per-pin connector temperatures** | Internal sensors only | Per L1/L2/L3/N output pin temperatures |
| **Energy meter add-on** | none (uses HAN port directly) | **Equalizer** as a separate device class |
| **Local auth list** | OCPP-standard keys + Native portal sync | OCPP-standard keys + Native portal sync |
| **Numeric → label drift** | `CommunicationMode` returns either form | unverified |
| **Hierarchy** | Org → ChargerHost → Property → Site → **Installation** → Circuit → Charger | Org → Operator → **Site** → Circuit → Charger |
| **`credential_scope`** | `installation` | `installation` (mapped from Easee Site) |

---

## 9. Open questions to resolve at first connection

These are the items this doc lists as "(unverified)" and which should be checked against a real Easee charger before committing the production adapter:

1. **Refresh-token rotation behavior** — does refreshing return a new RT or rotate in place?
2. **Whether SignalR over MessagePack is required** or whether the JSON protocol is enough on Workers.
3. **Exact `SignalR` hub name** under operator-claim accounts — docs hint at multiple hubs (`/hubs/chargers`, possibly `/hubs/equalizers`).
4. **Whether `ChargerStreamData` IDs returned over SignalR match `pyeasee` 1:1** for the firmware versions Straumvakt is targeting.
5. **OCMF-equivalent signed-metering availability** — confirm whether the Easee Pro/Backplate-2 firmware supports OCMF-format reads, or whether billing-grade signing is purely cloud-side.
6. **Rate limiting on `/api/accounts/login`** — Zaptec's nginx returns 503 under load; Easee's behavior unknown.
7. **`config_authorizationRequired` (42) vs `config_localAuthorizationRequired` (41)** — confirm precedence: which one wins when both are set?
8. **`numberOfCars*` aggregate fields** — confirm they're populated reliably and whether they're worth surfacing as `properties.installations.metadata` projections.
9. **Equalizer pairing** — does the operator API expose Equalizer endpoints under `/api/equalizers/{id}` for non-owner accounts, or is it owner-only?

---

## 10. Sources

- [Easee Developer Platform](https://developer.easee.com/) — primary docs.
- [Easee Authentication](https://developer.easee.com/docs/authentication-1)
- [Easee account_authenticate API reference](https://developer.easee.com/reference/account_authenticate)
- [Easee Command and Control](https://developer.easee.com/docs/api-command-and-control)
- [Easee Smart Charging](https://developer.easee.com/docs/api-smart-charging)
- [Easee OCPP Commissioning for Operators](https://developer.easee.com/docs/ocpp-commissioning-api)
- [Easee OCPP Commissioning for Users](https://developer.easee.com/docs/ocpp-commissioning-easee-users)
- [Easee Settings](https://developer.easee.com/docs/settings)
- [Easee Integrations overview](https://developer.easee.com/docs/integrations)
- [pyeasee — observation IDs catalogue](https://github.com/nordicopen/pyeasee/blob/master/pyeasee/const.py)
- [Easee Integrations partner page](https://easee.com/en/integrations/)

---

## 11. Companion artifacts

None on disk yet — first probe will produce:

| File | Where (planned) | Purpose |
|---|---|---|
| `easee-test/easee-stream-data.json` | scratch app (planned) | Cached `ChargerStreamData` enum dump after first SignalR frame |
| `easee-test/openapi-from-readme.json` | scratch app (planned) | Best-effort OpenAPI synthesis from ReadMe.io if available |
| `easee-test/src/lib/easee.ts` | scratch app (planned) | Reference implementation matching `zaptec-test/src/lib/zaptec.ts` shape |
| `easee-test/src/lib/easee-state.ts` | scratch app (planned) | Observation ID → name → group map |

When the first scratch app exists, update the §11 table here and migrate any verified findings out of §9 ("Open questions").
