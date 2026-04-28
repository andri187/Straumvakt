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

## 10. Companion docs

This file references two shared protocol docs in this folder:

- [`ocpp-1.6j.md`](ocpp-1.6j.md) — the full OCPP 1.6J protocol reference (28 messages, 38 standard config keys, state machine, security profiles).
- [`ocmf.md`](ocmf.md) — OCMF signed-meter envelope reference. Easee does not emit OCMF natively as of 2026-04 (state in §1).

---

## 11. Full ChargerStreamData observation catalogue (signalR stream)

This is the complete `ChargerStreamData` enum from `pyeasee/const.py` (master branch). Each row: ID, name, description (verbatim from comment), and access claims (`A=Admin`, `P=Partner`, `U=User`).

> [!IMPORTANT]
> **All values are unverified against a live charger.** This table is the most-trusted machine-readable map publicly available, but Easee's official observation list is not published machine-readably. Confirm at first connection.

```
  ID  Name                                            Description                                                                       Claims
   1  state_selfTestResult                            OK or error codes [String]                                                        APU
   2  state_selfTestDetails                           JSON with details from self-test [String]                                         AP
   5  state_debugLog                                                                                                                    AP
  10  state_wifiEvent                                 WiFi event codes; needs telemetry debug                                            AP
  11  state_chargerOfflineReason                      Why charger is offline                                                            APU
  13  state_easeeLinkCommandResponse                  Response to EaseeLink command                                                     AP
  14  state_easeeLinkDataReceived                     Data received over EaseeLink                                                      AP
  15  config_localPreAuthorizeEnabled                 Preauthorize w/ whitelist enabled                                                 APU
  16  config_localAuthorizeOfflineEnabled             Allow offline charging for whitelisted RFID                                       APU
  17  config_allowOfflineTxForUnknownId               Allow offline charging for any RFID                                               APU
  18  config_erraticEVMaxToggles                      Max Charging↔Complete toggles before error                                        AP
  19  config_backplateType                            Readback on backplate type                                                        AP
  20  config_siteStructure                            Site Structure [boot]                                                             AP
  21  config_detectedPowerGridType                    Detected grid type per PowerGridType table [boot]                                 APU
  22  config_circuitMaxCurrentP1                      Circuit max current L1 [A]                                                        APU
  23  config_circuitMaxCurrentP2                      Circuit max current L2 [A]                                                        APU
  24  config_circuitMaxCurrentP3                      Circuit max current L3 [A]                                                        APU
  25  config_location                                 Coordinate                                                                        AP
  26  config_siteIDString                             Site ID string                                                                    AP
  27  config_siteIDNumeric                            Site ID numeric                                                                   AP
  28  config_rfidAuthTimeoutSec                       Backend auth-reply timeout                                                        AP
  30  state_lockCablePermanently                      Permanent type-2 cable lock                                                       APU
  31  config_isEnabled                                Charger enabled flag                                                              APU
  32  state_temperatureMonitorState                   OFF=0, MONITORING=-1, ACTIVE=1                                                    AP
  33  config_circuitSequenceNumber                    Charger sequence on circuit                                                       AP
  34  config_singlePhaseNumber                        Phase to use in 1-phase charging                                                  AP
  35  config_enable3PhasesDEPRECATED                  (DEPRECATED) Allow 3-phase charging                                               APU
  36  config_wiFiSSID                                 WiFi SSID                                                                         APU
  37  config_enableIdleCurrent                        Signal available current after EV done [event]                                    APU
  38  config_phaseMode                                1=Locked-1ph / 2=Auto / 3=Locked-3ph(Home)                                        APU
  39  config_forcedThreePhaseOnITWithGndFault         Force 3-phase on IT grid with ground fault                                        AP
  40  config_ledStripBrightness                       LED strip brightness 0-100%                                                       APU
  41  config_localAuthorizationRequired               Local RFID auth required                                                          APU
  42  config_authorizationRequired                    Auth required                                                                     APU
  43  config_remoteStartRequired                      Remote start required                                                             APU
  44  config_smartButtonEnabled                       Smart button enabled                                                              APU
  45  config_offlineChargingMode                      Behavior when offline                                                             APU
  46  state_ledMode                                   Charger LED mode                                                                  APU
  47  config_maxChargerCurrent                        Max current charger may offer (A) [persistent]                                    APU
  48  state_dynamicChargerCurrent                     Max current charger may offer (A) [volatile, DLB]                                 APU
  50  state_offlineMaxCircuitCurrentP1                Max circuit current P1 when offline                                               APU
  51  state_offlineMaxCircuitCurrentP2                Max circuit current P2 when offline                                               APU
  52  state_offlineMaxCircuitCurrentP3                Max circuit current P3 when offline                                               APU
  54  config_releaseCableAtPowerOff                   Release cable at power off                                                        AP
  56  config_listenToControlPulse                     Charger needs control pulse to be online                                          AP
  57  config_controlPulseRTT                          Control pulse round-trip time [ms]                                                AP
  62  schedule_chargingSchedule                       Charging schedule [JSON]                                                          APU
  65  config_pairedEqualizer                          Paired equalizer details                                                          AP
  68  state_wiFiAPEnabled                             WiFi AP enabled                                                                   APU
  69  state_pairedUserIDToken                         Observed token in RFID pairing mode                                               APU
  70  state_circuitTotalAllocatedPhaseConductorCurrentL1   Total current allocated to L1 (master only)                                  APU
  71  state_circuitTotalAllocatedPhaseConductorCurrentL2   Total current allocated to L2 (master only)                                  APU
  72  state_circuitTotalAllocatedPhaseConductorCurrentL3   Total current allocated to L3 (master only)                                  APU
  73  state_circuitTotalPhaseConductorCurrentL1       Sum of all chargers on circuit, L1 (master only)                                  APU
  74  state_circuitTotalPhaseConductorCurrentL2       Sum of all chargers on circuit, L2 (master only)                                  APU
  75  state_circuitTotalPhaseConductorCurrentL3       Sum of all chargers on circuit, L3 (master only)                                  APU
  76  state_numberOfCarsConnected                     Cars connected to circuit                                                         AP
  77  state_numberOfCarsCharging                      Cars currently charging                                                           AP
  78  state_numberOfCarsInQueue                       Cars in queue waiting for power                                                   AP
  79  state_numberOfCarsFullyCharged                  Cars that appear fully charged                                                    AP
  80  state_chargerFirmware                           Embedded software release id [boot]                                               APU
  81  state_ICCID                                     SIM ICCID                                                                         AP
  82  state_modemFwId                                 Modem firmware version                                                            AP
  83  state_OTAErrorCode                              OTA error code                                                                    AP
  84  state_mobileNetworkOperator                     Current mobile network operator                                                   AP
  89  state_rebootReason                              Reboot reason bitmask                                                             AP
  90  state_powerPCBVersion                           Power PCB hw version                                                              AP
  91  state_comPCBVersion                             Communication PCB hw version                                                      AP
  96  state_reasonForNoCurrent                        Why charger is idle (enum)                                                        APU
  97  state_loadBalancingNumberOfConnectedChargers    Chargers in load balance set (master only)                                        AP
  98  state_UDPNumOfConnectedNodes                    Slaves connected via UDP/WIFI                                                     AP
  99  state_localConnection                           Slaves only: 0=None, 1=Radio, 2=WIFI UDP, 3=Radio+WIFI UDP                        AP
 100  state_pilotMode                                 Pilot Mode Letter (A-F)                                                           AP
 101  state_carConnectedDEPRECATED                    (DEPRECATED) Car connection state                                                 AP
 102  state_smartCharging                             Smart-charging state from front button                                            APU
 103  state_cableLocked                               Cable lock state                                                                  APU
 104  state_cableRating                               Cable rating from PP resistor [A]                                                 APU
 105  state_pilotHigh                                 Pilot signal high [V] [debug]                                                     AP
 106  state_pilotLow                                  Pilot signal low [V] [debug]                                                      AP
 107  state_backPlateID                               Back-plate RFID of charger [boot]                                                 AP
 108  state_userIDTokenReversed                       User ID from RFID (NB! must reverse string)                                       AP
 109  state_chargerOpMode                             Operation mode per ChargerOpMode table                                            APU
 110  state_outputPhase                               Active output phases (bitmask)                                                    APU
 111  state_dynamicCircuitCurrentP1                   Live DLB cap on L1 [A]                                                            APU
 112  state_dynamicCircuitCurrentP2                   Live DLB cap on L2 [A]                                                            APU
 113  state_dynamicCircuitCurrentP3                   Live DLB cap on L3 [A]                                                            APU
 114  state_outputCurrent                             Available current signaled to car via pilot [A]                                   APU
 115  state_deratedCurrent                            Available current after derating [A]                                              APU
 116  state_deratingActive                            Limited by charger due to high temp                                               APU
 117  state_debugString                               Debug string                                                                      AP
 118  state_errorString                               Descriptive error string                                                          APU
 119  state_errorCode                                 Error code per error-code table                                                   APU
 120  state_totalPower                                Total power [kW][telemetry]                                                       APU
 121  state_sessionEnergy                             Session accumulated energy [kWh][telemetry]                                       APU
 122  state_energyPerHour                             Accumulated energy per hour [kWh]                                                 APU
 123  state_legacyEvStatus                            0=not legacy, 1=legacy detected, 2=reviving                                       AP
 124  state_lifetimeEnergy                            Lifetime accumulated energy [kWh]                                                 APU
 125  state_lifetimeRelaySwitches                     Lifetime relay switches                                                           AP
 126  state_lifetimeHours                             Total operation hours                                                             AP
 127  config_dynamicCurrentOfflineFallbackDEPRICATED  (DEPRECATED) Max circuit current when offline                                     AP
 128  state_userIDToken                               User ID token (corrected vs 108)                                                  AP
 129  state_ChargingSession                           Charging sessions JSON                                                            AP
 130  state_cellRSSI                                  Cellular signal [dBm]                                                             APU
 131  state_CellRAT                                   Cellular RAT per RAT table                                                        AP
 132  state_wiFiRSSI                                  WiFi signal [dBm]                                                                 APU
 133  config_cellAddress                              IP from cellular network [debug]                                                  AP
 134  config_wiFiAddress                              IP from WiFi network [debug]                                                      AP
 135  config_wiFiType                                 WiFi type letters [debug]                                                         AP
 136  state_localRSSI                                 Local radio signal [dBm]                                                          APU
 137  state_masterBackPlateID                         Master charger back-plate ID                                                      AP
 138  state_localTxPower                              Local radio TX power [dBm]                                                        AP
 139  state_localState                                Local radio state                                                                 AP
 140  state_foundWiFi                                 List of found WiFi SSID + RSSI                                                    APU
 141  state_chargerRAT                                0=cellular, 1=wifi                                                                APU
 142  state_cellularInterfaceErrorCount               Cellular IFC errors since boot                                                    AP
 143  state_cellularInterfaceResetCount               Cellular IFC resets since boot                                                    AP
 144  state_wifiInterfaceErrorCount                   WiFi IFC errors since boot                                                        AP
 145  state_wifiInterfaceResetCount                   WiFi IFC resets since boot                                                        AP
 146  config_localNodeType                            0-Unconfig / 1-Master / 2-Extender / 3-End                                        APU
 147  config_localRadioChannel                        Channel 0-11                                                                      APU
 148  config_localShortAddress                        Address on local radio                                                            APU
 149  config_localParentAddrOrNumOfNodes              If master: # slaves; if slave: parent addr                                        APU
 150  state_tempMax                                   Max temp across all sensors [C]                                                   APU
 151  state_tempAmbientPowerBoard                     Ambient on bottom of power board [C]                                              AP
 152  state_tempInputT2                               Temp at input T2 [C]                                                              AP
 153  state_tempInputT3                               Temp at input T3 [C]                                                              AP
 154  state_tempInputT4                               Temp at input T4 [C]                                                              AP
 155  state_tempInputT5                               Temp at input T5 [C]                                                              AP
 160  state_tempOutputN                               Temp at type-2 plug N [C]                                                         AP
 161  state_tempOutputL1                              Temp at type-2 plug L1 [C]                                                        AP
 162  state_tempOutputL2                              Temp at type-2 plug L2 [C]                                                        AP
 163  state_tempOutputL3                              Temp at type-2 plug L3 [C]                                                        AP
 164  state_tempRelayN                                Temp under N relay on ONE [C]                                                     AP
 165  state_tempRelayL                                Temp under L relay on ONE [C]                                                     AP
 166  state_tempAmbientPowerBoardTop                  Ambient on top of power board [C]                                                 AP
 170  state_tempAmbient                              Ambient on COM board [C]                                                           AP
 171  state_lightAmbient                             Ambient light from front [%][debug]                                                AP
 172  state_intRelHumidity                           Internal relative humidity [%]                                                     AP
 173  state_backPlateLocked                          Back plate confirmed locked                                                        AP
 174  state_currentMotor                             Cable lock motor current draw [debug]                                              AP
 175  state_backPlateHallSensor                      Raw hall-sensor value [mV]                                                         AP
 182  state_inCurrentT2                              Calculated input current T2 RMS [A][telemetry]                                     APU
 183  state_inCurrentT3                              Input current T3 RMS [A][telemetry]                                                APU
 184  state_inCurrentT4                              Input current T4 RMS [A][telemetry]                                                APU
 185  state_inCurrentT5                              Input current T5 RMS [A][telemetry]                                                APU
 190  state_inVoltageT1T2                            Input V RMS T1↔T2 [V][telemetry]                                                   APU
 191  state_inVoltageT1T3                            Input V RMS T1↔T3 [V][telemetry]                                                   APU
 192  state_inVoltageT1T4                            Input V RMS T1↔T4 [V][telemetry]                                                   APU
 193  state_inVoltageT1T5                            Input V RMS T1↔T5 [V][telemetry]                                                   APU
 194  state_inVoltageT2T3                            Input V RMS T2↔T3 [V][telemetry]                                                   APU
 195  state_inVoltageT2T4                            Input V RMS T2↔T4 [V][telemetry]                                                   APU
 196  state_inVoltageT2T5                            Input V RMS T2↔T5 [V][telemetry]                                                   APU
 197  state_inVoltageT3T4                            Input V RMS T3↔T4 [V][telemetry]                                                   APU
 198  state_inVoltageT3T5                            Input V RMS T3↔T5 [V][telemetry]                                                   APU
 199  state_inVoltageT4T5                            Input V RMS T4↔T5 [V][telemetry]                                                   APU
 200  state_nominalVoltage                           Nominal voltage setting (Easee One)                                                APU
 202  state_outVoltPin1to2                           Output V RMS type-2 pin 1↔2 [V][telemetry]                                         AP
 203  state_outVoltPin1to3                           Output V RMS type-2 pin 1↔3 [V][telemetry]                                         AP
 204  state_outVoltPin1to4                           Output V RMS type-2 pin 1↔4 [V][telemetry]                                         AP
 205  state_outVoltPin1to5                           Output V RMS type-2 pin 1↔5 [V][telemetry]                                         AP
 206  state_outVoltPin2_3                            Output V RMS type-2 pin 2↔3 [V]                                                    AP
 210  state_voltLevel33                              3.3 V level [V][telemetry]                                                         AP
 211  state_voltLevel5                               5 V level [V][telemetry]                                                           AP
 212  state_voltLevel12                              12 V level [V][telemetry]                                                          AP
 219  state_fatalErrorCode                           Fatal error code                                                                   APU
 220  state_LTERSRP                                  LTE RSRP [-144..-44 dBm]                                                           AP
 221  state_LTESINR                                  LTE SINR [-20..+30 dB]                                                             AP
 222  state_LTERSRQ                                  LTE RSRQ [-19..-3 dB]                                                              AP
 223  state_chargingSessionStart                     Charging session started [event]                                                   AP
 230  state_eqAvailableCurrentP1                     Available current for charging on P1 (Equalizer)                                   APU
 231  state_eqAvailableCurrentP2                     Available current for charging on P2 (Equalizer)                                   APU
 232  state_eqAvailableCurrentP3                     Available current for charging on P3 (Equalizer)                                   APU
 240  state_diagnosticsString                        Various diagnostics; needs DiagnosticsMode==256                                    AP
 241  config_wiFiMACAddress                          Device WiFi MAC                                                                    AP
 250  state_connectedToCloud                         Device is connected to AWS                                                         APU
 251  state_cloudDisconnectReason                    AWS DisconnectReason                                                               APU
```

---

## 12. Full EqualizerStreamData observation catalogue

The Easee Equalizer is a separate device class. It has its own SignalR observation stream with this enum:

```
  ID  Name                                            Description                                                                       Claims
   1  state_selfTestResult                            PASSED or error codes                                                             AP
   2  state_selfTestDetails                           JSON with self-test details                                                       AP
  13  state_easeeLinkCommandResponse                  Response to EaseeLink command                                                     AP
  14  state_easeeLinkDataReceived                     EaseeLink incoming data                                                           AP
  19  state_siteIDNumeric                             Site ID numeric                                                                   AP
  20  config_siteStructure                            Site Structure [boot]                                                             APU
  21  state_softwareRelease                           Embedded software release id [boot]                                               APU
  23  state_deviceMode                               Current device mode                                                                APU
  25  config_meterType                                Meter type                                                                        APU
  26  config_meterID                                  Meter identification                                                              APU
  27  state_OBISListIdentifier                        OBIS List version identifier                                                      AP
  29  config_gridType                                 0=Unknown, 1=TN, 2=IT                                                             APU
  30  config_numPhases                                Phase count                                                                       APU
  31  state_currentL1                                 L1 current [A]                                                                    APU
  32  state_currentL2                                 L2 current [A]                                                                    APU
  33  state_currentL3                                 L3 current [A]                                                                    APU
  34  state_voltageNL1                                N↔L1 voltage [V]                                                                  APU
  35  state_voltageNL2                                N↔L2 voltage [V]                                                                  APU
  36  state_voltageNL3                                N↔L3 voltage [V]                                                                  APU
  37  state_voltageL1L2                               L1↔L2 voltage [V]                                                                 APU
  38  state_voltageL1L3                               L1↔L3 voltage [V]                                                                 APU
  39  state_voltageL2L3                               L2↔L3 voltage [V]                                                                 APU
  40  state_activePowerImport                         Active import power [kW]                                                          APU
  41  state_activePowerExport                         Active export power [kW]                                                          APU
  42  state_reactivePowerImport                       Reactive import power [kVAR]                                                      APU
  43  state_reactivePowerExport                       Reactive export power [kVAR]                                                      APU
  44  state_maxPowerImport                            Max import power [event]                                                          APU
  45  state_cumulativeActivePowerImport               Cumulative active import [kWh]                                                    APU
  46  state_cumulativeActivePowerExport               Cumulative active export [kWh]                                                    APU
  47  state_cumulativeReactivePowerImport             Cumulative reactive import [kVARh]                                                APU
  48  state_cumulativeReactivePowerExport             Cumulative reactive export [kVARh]                                                APU
  49  state_clockAndDateMeter                         Clock + date from meter                                                           APU
  50  state_rcpi                                      Received Channel Power Indicator [dBm]                                            APU
  51  config_ssid                                     WiFi SSID                                                                         APU
  55  config_masterBackPlateID                        Master charger back-plate                                                         APU
  56  config_equalizerID                              Equalizer back-plate                                                              APU
  57  config_childReport                              Child config in Equalizer                                                         APU
  58  state_connectivityReport                        Child connectivity                                                                AP
  60  state_exceptionData                             Exception debug info [boot]                                                       AP
  61  state_bootReason                                (Re)boot reason [boot]                                                            AP
  64  state_highCurrentTransitions                    High-current transitions count [debug]                                            AP
  65  state_vCap                                      Capacitor voltage [V]                                                             AP
  66  state_vBusMin                                   Min bus voltage [V]                                                               AP
  67  state_vbusMax                                   Max bus voltage [V]                                                               AP
  68  state_internalTemperature                       Internal temperature [C]                                                          AP
  69  state_meterDataSnapshot                         Meter data snapshot                                                               AP
  70  state_localRSSI                                 Local radio signal [dBm]                                                          APU
  71  state_localTxPower                              Local radio TX power [dBm]                                                        AP
  72  state_localRadioChannel                         Local radio channel 0-11                                                          AP
  73  state_localShortAddress                         Address on local radio                                                            AP
  74  state_localNodeType                             0-Unconfig / 1-Coordinator / 2-Range Ext / 3-End / 4-Sleepy End                   AP
  75  state_localParentAddress                        Parent on local radio (0=master)                                                  AP
  80  config_circuitPhaseMapping                      EQ↔charger phase mapping                                                          AP
  81  state_phaseMappingReport                        Phase correlation report                                                          AP
  82  state_phaseLearningStatus                       Phase learning / load-balancing status                                            AP
  85  config_modbusConfiguration                      Complete Modbus config                                                            APU
  86  state_loadbalanceThrottle                       Throttle level [%]                                                                AP
  87  state_availableCurrentL1                        Available current L1 [A]                                                          APU
  88  state_availableCurrentL2                        Available current L2 [A]                                                          APU
  89  state_availableCurrentL3                        Available current L3 [A]                                                          APU
  90  state_meterErrors                               Meter errors                                                                      AP
  91  state_APMacAddress                              WiFi AP MAC                                                                       AP
  92  state_wifiReconnects                            WiFi reconnects                                                                   AP
 100  state_ledMode                                   Current LED pattern                                                               APU
 105  state_equalizedChargeCurrentL1                  Equalizer-controlled charge current L1 [A]                                        APU
 106  state_equalizedChargeCurrentL2                  Equalizer-controlled charge current L2 [A]                                        APU
 107  state_equalizedChargeCurrentL3                  Equalizer-controlled charge current L3 [A]                                        APU
 110  config_currentTransformerConfig                 Current Transformer Config                                                        APU
 111  state_meterEncryptionStatus                     Meter Encryption Status                                                           APU
 115  config_surplusCharging                          Surplus charging configuration                                                    APU
 120  state_connectedAmps                             Equalizer AMPs report                                                             APU
 250  state_connectedToCloud                          Device connected to AWS                                                           APU
 251  state_cloudDisconnectReason                     AWS DisconnectReason                                                              APU
```

> [!NOTE]
> Easee's cloud is **AWS** (StateId 250 explicitly says so), not Azure as Zaptec uses. SignalR runs on an AWS-hosted backend.

---

## 13. `DatatypesStreamData` — wire-format types

When SignalR pushes an observation, the payload includes a `dataType` integer. Decoder map (from pyeasee):

| ID | Name |
|---|---|
| 1 | Binary |
| 2 | Boolean |
| 3 | Double |
| 4 | Integer |
| 5 | Position |
| 6 | String |
| 7 | Statistics |

Position is a JSON `{lat, lng}` object. Statistics is a JSON object with multiple sub-fields.

---

## 14. Inferred `ChargerOpMode` values (StateId 109)

From cross-reference with `pyeasee/charger.py` and community Home Assistant integrations. **Unverified** against current firmware:

| Value | Name | Approximate OCPP `ConnectorStatus` |
|---|---|---|
| 0 | Offline | Unavailable |
| 1 | Disconnected | Available |
| 2 | AwaitingStart | Preparing |
| 3 | Charging | Charging |
| 4 | Completed | Finishing |
| 5 | Error | Faulted |
| 6 | ReadyToCharge | Preparing |
| 7 | AwaitingAuthentication | Preparing |
| 8 | DeAuthenticating | Finishing |

---

## 15. Inferred `reasonForNoCurrent` values (StateId 96)

Unverified — confirm at first probe. Community sources suggest:

| Value | Name |
|---|---|
| 0 | OK |
| 1 | MaxCircuitCurrentTooLow |
| 2 | MaxDynamicCircuitCurrentTooLow |
| 3 | MaxDynamicOfflineFallbackCircuitCurrentTooLow |
| 4 | CircuitFuseTooLow |
| 5 | WaitingInQueue |
| 6 | WaitingInFully |
| 50 | MaxChargerCurrentTooLow |
| 51 | MaxDynamicChargerCurrentTooLow |
| 52 | OfflineDuringRefuse |
| 53 | OfflineMonadicSession |
| 54 | DerratingTemperature |
| 55 | DerratingPlcAck |
| 56 | LimitedByCar |

---

## 16. SignalR handshake protocol — full sequence

Easee uses **Microsoft SignalR Core** over WebSocket. The handshake is multi-step:

### 16.1 Negotiate

```sh
TOKEN="<JWT from §2.1>"
curl -s -X POST "https://api.easee.com/hubs/chargers/negotiate?negotiateVersion=1" \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "negotiateVersion": 1,
  "connectionId": "<server-assigned>",
  "connectionToken": "<short-lived ws token>",
  "availableTransports": [
    { "transport": "WebSockets", "transferFormats": ["Text", "Binary"] },
    { "transport": "ServerSentEvents", "transferFormats": ["Text"] },
    { "transport": "LongPolling", "transferFormats": ["Text", "Binary"] }
  ]
}
```

### 16.2 Open WebSocket

```
wss://api.easee.com/hubs/chargers?id=<connectionToken>
```

The Bearer token goes either as a header (`Authorization: Bearer <jwt>`) or a query param (`access_token=<jwt>`).

### 16.3 Send protocol-handshake frame

Immediately after WS open, send (terminate with `0x1E` = ASCII record-separator):

```
{"protocol":"json","version":1}<0x1E>
```

(Use `messagepack` instead of `json` if a binary protocol is preferred and supported.)

### 16.4 Subscribe to a charger's stream

Invocation message — `Type 1 = Invocation`:

```json
{"type":1,"target":"SubscribeWithCurrentState","arguments":["<chargerId>",true]}<0x1E>
```

Server responds with a stream of messages — each is a `Type 1` invocation pushed from server to client:

```json
{"type":1,"target":"ProductUpdate","arguments":[{
  "Mid":"<chargerId>","DataType":3,"Id":120,
  "Value":7.234,"Timestamp":"2026-04-26T08:30:00Z"
}]}
```

`Id` is a `ChargerStreamData` enum value (§11). `DataType` is a `DatatypesStreamData` enum (§13). `Value` is the typed payload.

### 16.5 Keep-alive

SignalR Core automatically sends `Type 6 = Ping` frames every ~15 s. Client should respond with `Type 6` back; otherwise server drops after 30 s.

### 16.6 Unsubscribe / disconnect

```json
{"type":1,"target":"UnsubscribeFromCharger","arguments":["<chargerId>"]}<0x1E>
```

Or just close the WebSocket cleanly.

### 16.7 SignalR message-type indicators

| Type | Meaning |
|---|---|
| 1 | Invocation — `{type, invocationId?, target, arguments}` |
| 2 | StreamItem — for streaming methods |
| 3 | Completion — `{type, invocationId, result?, error?}` |
| 4 | StreamInvocation |
| 5 | CancelInvocation |
| 6 | Ping |
| 7 | Close — graceful shutdown |

### 16.8 Cloudflare Workers compatibility

The JSON SignalR protocol works fine over Workers' WebSocket (Hibernation API). MessagePack would require an additional lib. Bearer token can be sent as a query-param (`?access_token=…`) since Cloudflare Workers' `WebSocket` constructor doesn't accept arbitrary headers.

---

## 17. Worked end-to-end examples

### 17.1 Authenticate

```sh
curl -s -X POST https://api.easee.com/api/accounts/login \
  -H 'Content-Type: application/json' \
  -d '{"userName":"<email>","password":"<password>"}'
```

Response:
```jsonc
{
  "accessToken":"eyJhbGc...",
  "refreshToken":"...",
  "expiresIn":3600,
  "tokenType":"Bearer",
  "accessClaims":["Partner"]
}
```

### 17.2 Refresh

```sh
curl -s -X POST https://api.easee.com/api/accounts/refresh_token \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"accessToken\":\"$EXPIRED\",\"refreshToken\":\"$RT\"}"
```

### 17.3 List sites

```sh
curl -s "https://api.easee.com/api/sites" \
  -H "Authorization: Bearer $TOKEN"
```

### 17.4 List chargers under a site

```sh
SITE=<siteId>
curl -s "https://api.easee.com/api/sites/$SITE/circuits" \
  -H "Authorization: Bearer $TOKEN"
```

Returns circuits each with nested chargers.

### 17.5 Charger live state

```sh
CHARGER=<easeeChargerId>  # e.g. "EHX12345"
curl -s "https://api.easee.com/api/chargers/$CHARGER/state" \
  -H "Authorization: Bearer $TOKEN"
```

Response is a flat object with field names matching `ChargerStreamData` (no numeric IDs in the REST shape — that's SignalR-only):
```jsonc
{
  "smartCharging": false,
  "cableLocked": false,
  "chargerOpMode": 1,
  "totalPower": 0.0,
  "sessionEnergy": 0.0,
  "energyPerHour": 0.0,
  "wiFiRSSI": -65,
  "cellRSSI": -101,
  "lifetimeEnergy": 12345.678,
  "lifetimeRelaySwitches": 1247,
  "lifetimeHours": 8765,
  "outputCurrent": 0.0,
  "deratedCurrent": 0.0,
  "deratingActive": false,
  "voltage": 230.4,
  "inCurrentT2": 0.0,
  "inCurrentT3": 0.0,
  "inCurrentT4": 0.0,
  "inCurrentT5": 0.0,
  "outputPhase": 0,
  // ...many more...
}
```

### 17.6 Stop a session

```sh
curl -s -X POST "https://api.easee.com/api/chargers/$CHARGER/commands/stop_charging" \
  -H "Authorization: Bearer $TOKEN"
```

Response: `200 OK` empty body, or `{ "errorCode": <int>, "title": "..." }` on failure.

### 17.7 Start a session (RemoteStart equivalent)

```sh
curl -s -X POST "https://api.easee.com/api/chargers/$CHARGER/commands/start_charging" \
  -H "Authorization: Bearer $TOKEN"
```

### 17.8 Set dynamic current

```sh
curl -s -X POST "https://api.easee.com/api/chargers/$CHARGER/dynamic_current" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phase1":16,"phase2":16,"phase3":16,"timeToLive":300}'
```

The `timeToLive` (seconds) means "fall back to the configured max after this many seconds without a new write" — protects against orchestrator crashes leaving a charger throttled forever.

### 17.9 Get charger config

```sh
curl -s "https://api.easee.com/api/chargers/$CHARGER/config" \
  -H "Authorization: Bearer $TOKEN"
```

Returns all `config_*` fields from `ChargerStreamData` as a flat JSON object.

### 17.10 Charging session history

```sh
curl -s "https://api.easee.com/api/sessions/charger/$CHARGER" \
  -H "Authorization: Bearer $TOKEN"
```

Or for the live one:
```sh
curl -s "https://api.easee.com/api/chargers/$CHARGER/sessions/ongoing" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 18. Production-adapter checklist

### 18.1 Authentication
- [ ] JWT cached for ≤ 50 minutes (10-minute safety margin under the 1-hour TTL).
- [ ] Refresh proactively before expiry; do not wait for `401`.
- [ ] On `401`, attempt one refresh; on second `401` re-authenticate from username/password.
- [ ] Refresh-token rotation: persist the *latest* refresh token returned by `/refresh_token`, not the original (verify behavior at first connect).
- [ ] `accessClaims` array determines what endpoints work — check for `"Partner"` claim before using operator-only endpoints.

### 18.2 Pagination
- [ ] Easee's REST endpoints are NOT consistently paginated; some return arrays, some return single objects. Inspect each response shape per endpoint.
- [ ] When iterating sessions, use date-range parameters (`from`, `to`) rather than offset-based pagination.

### 18.3 Error envelope
- [ ] Easee error shape: `{ "errorCode": <int>, "title": "<msg>", "type": "<uri>", "status": <http-code>, "traceId": "..." }` — RFC 7807-ish.
- [ ] Common `errorCode` values (community-sourced, **unverified**):
  - `1` UnknownError
  - `2` Unauthorized
  - `3` Forbidden
  - `100` ChargerOffline
  - `101` ChargerInUse
  - `102` AlreadyAuthorized
  - `200` BadRequest
  - `300` NotFound
  - `400` UnknownDeviceFault

### 18.4 SignalR
- [ ] Implement keep-alive ping (Type 6) reply; otherwise the server disconnects after 30 s.
- [ ] On disconnect, call `negotiate` again — connectionToken is single-use and short-lived.
- [ ] Subscribe with `SubscribeWithCurrentState` (not `SubscribeWithoutCurrentState`) on first connect to get the full current snapshot followed by deltas.
- [ ] Buffer observations during reconnect window; the server does NOT replay missed messages.
- [ ] Track the last `Timestamp` seen per StateId; on reconnect, the snapshot may include older timestamps for stable values — ignore those.

### 18.5 State observation handling
- [ ] Decode `chargerOpMode` (StateId 109) using §14 enum.
- [ ] Decode `reasonForNoCurrent` (StateId 96) using §15 enum.
- [ ] `state_userIDTokenReversed` (108) requires byte-order reversal — see pyeasee `utils.py` `reverse_token_string()`. Prefer `state_userIDToken` (128) which is already corrected.
- [ ] Equalizer observations (§12) use a *separate* `EqualizerStreamData` enum — do not confuse IDs across charger / equalizer streams.

### 18.6 OCPP-derived state
- [ ] Easee supports both cloud-routed and box-level OCPP via the operator commissioning API.
- [ ] When using box-level (Native), Easee's REST API may stop reflecting some telemetry — confirm at first probe whether `state_chargerOpMode` keeps updating in box-level mode.

### 18.7 OCMF
- [ ] **Easee does NOT emit OCMF natively.** `state_lifetimeEnergy` (124) is a plain double. For billing-grade signed metering, the operator must enable Easee's Eichrecht add-on (separate license) — verify whether your fleet has it.

### 18.8 Idempotency
- [ ] All command endpoints (`/commands/start_charging`, `/dynamic_current`, etc.) are not idempotent. Use the V3 outbox pattern (`vendor:easee` scope, key `<chargerId>:<command>:<correlation-id>`).
- [ ] `/dynamic_current` has built-in TTL safety — set `timeToLive` to bound the blast radius of a stuck command.

### 18.9 Observability
- [ ] Tag every Easee HTTP/SignalR call with `vendor=easee`, `endpoint=<path-or-target>`, `siteId=<id>` for log grouping.
- [ ] SignalR connection lifetime is a key metric — track time-to-first-observation, observation rate, reconnect frequency.
- [ ] Track observation freshness per StateId — the SignalR stream can silently stop pushing one StateId without disconnecting the whole stream.

### 18.10 Secret hygiene
- [ ] Easee credentials live in Cloudflare secrets / 1Password.
- [ ] The JWT contains the user's accessClaims and ID — treat as PII; do not log.
- [ ] SignalR `connectionToken` from negotiate is short-lived but a session bearer — do not persist.

---

## 19. Reference TypeScript shapes

```ts
// ── Auth ────────────────────────────────────────────────────────────────
export type EaseeToken = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  accessClaims: Array<"User" | "Partner" | "Admin">;
};

// ── Site ────────────────────────────────────────────────────────────────
export type Site = {
  id: number;
  siteKey: string;
  name: string;
  levelOfAccess: number;
  address?: { street?: string; city?: string; zipCode?: string; country?: string; latitude?: number; longitude?: number };
  installerAlias?: string;
  useDynamicMaster?: boolean;
  contactInfo?: { installerName?: string; installerPhoneNumber?: string; ownerName?: string; ownerPhoneNumber?: string; companyName?: string; companyOrgNr?: string };
  ratedCurrent?: number;
  numCircuits?: number;
  cost?: { currencyId?: string; vat?: number; costPerKwh?: number; costPerKwhExcludeVat?: number };
};

// ── Circuit ─────────────────────────────────────────────────────────────
export type Circuit = {
  id: number;
  siteId: number;
  circuitPanelId?: number;
  panelName?: string;
  ratedCurrent: number;
  use3Phase?: boolean;
  parentCircuitId?: number;
  chargers: Charger[];
};

// ── Charger ─────────────────────────────────────────────────────────────
export type Charger = {
  id: string;       // e.g. "EHX12345"
  name: string;
  color?: number;
  createdOn: string;
  updatedOn: string;
  backPlate?: { id: string; masterBackPlateId?: string };
  levelOfAccess?: number;
  productCode?: number;
};

// ── State (REST snapshot, field-name keyed; SignalR uses numeric IDs) ───
export type ChargerState = {
  smartCharging?: boolean;
  cableLocked?: boolean;
  chargerOpMode?: number;        // §14
  reasonForNoCurrent?: number;   // §15
  totalPower?: number;           // kW
  sessionEnergy?: number;        // kWh
  energyPerHour?: number;
  wiFiRSSI?: number;
  cellRSSI?: number;
  localRSSI?: number;
  lifetimeEnergy?: number;       // kWh (NOT OCMF-signed by default)
  lifetimeRelaySwitches?: number;
  lifetimeHours?: number;
  outputCurrent?: number;
  deratedCurrent?: number;
  deratingActive?: boolean;
  voltage?: number;
  inCurrentT2?: number; inCurrentT3?: number; inCurrentT4?: number; inCurrentT5?: number;
  outputPhase?: number;
  cellRAT?: number;
  // ...80+ more fields...
};

// ── SignalR observation envelope ────────────────────────────────────────
export type SignalRObservation = {
  Mid: string;        // charger backplate id
  DataType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  Id: number;         // ChargerStreamData enum value
  Value: number | string | boolean | object;
  Timestamp: string;
};

// ── Error envelope (RFC 7807 style) ─────────────────────────────────────
export type EaseeError = {
  errorCode?: number;
  title?: string;
  type?: string;
  status?: number;
  traceId?: string;
};
```

---

## 20. Reference SignalR client skeleton

Cloudflare Workers-compatible (no MessagePack, JSON only):

```ts
async function connectEaseeSignalR(jwt: string): Promise<WebSocket> {
  // 1. Negotiate
  const neg = await fetch("https://api.easee.com/hubs/chargers/negotiate?negotiateVersion=1", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
  }).then((r) => r.json() as Promise<{ connectionToken: string }>);

  // 2. Open WS (token in query — Workers WebSocket can't set headers)
  const ws = new WebSocket(
    `wss://api.easee.com/hubs/chargers?id=${encodeURIComponent(neg.connectionToken)}&access_token=${encodeURIComponent(jwt)}`,
  );
  await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));

  // 3. Protocol handshake (record separator = 0x1E)
  ws.send(JSON.stringify({ protocol: "json", version: 1 }) + "");

  // 4. Subscribe
  ws.send(JSON.stringify({
    type: 1,
    target: "SubscribeWithCurrentState",
    arguments: ["EHX12345", true],
  }) + "");

  return ws;
}
```

Each incoming message is `<json><json>...` — split on `0x1E` and parse each chunk. Filter on `type === 1 && target === "ProductUpdate"` to get observations.

---

## 21. Sources

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

## 22. Companion artifacts

None on disk yet — first probe will produce:

| File | Where (planned) | Purpose |
|---|---|---|
| `easee-test/easee-stream-data.json` | scratch app (planned) | Cached `ChargerStreamData` enum dump after first SignalR frame |
| `easee-test/openapi-from-readme.json` | scratch app (planned) | Best-effort OpenAPI synthesis from ReadMe.io if available |
| `easee-test/src/lib/easee.ts` | scratch app (planned) | Reference implementation matching `zaptec-test/src/lib/zaptec.ts` shape |
| `easee-test/src/lib/easee-state.ts` | scratch app (planned) | Observation ID → name → group map |

When the first scratch app exists, update the §22 table here and migrate any verified findings out of §9 ("Open questions").
