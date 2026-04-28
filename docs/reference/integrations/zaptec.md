# Zaptec — API + OCPP integration reference

**Status:** reference data, not schema. Notes from observed live behavior on a Zaptec Pro fleet (Dalvegur 10–14, Iceland, 20 chargers, ~3 years in service).
**Last verified:** 2026-04-26 against Zaptec's public REST API (`api.zaptec.com`) and `straumvakt-ocpp.straumvakt.workers.dev` (the Sprint 1.5 Straumvakt CSMS gateway).
**Primary use:**
1. Source of truth for the **Technical Read tab** in the Straumvakt admin UI, which iframes `zaptec-test/` (running on port 3100, embedded mode via `?embedded=1`) — this doc captures what that scratch app reaches and how.
2. Reference for building the production Zaptec adapter under the V3 hardware-catalog `credential_scope = installation` model (`properties.installations` + `assets.chargers`).
3. Cross-vendor parity check against the Easee adapter (see [`easee.md`](easee.md)).

> [!IMPORTANT]
> Several published Zaptec sources disagree about which numeric `StateId` carries which observation. **The authoritative list is the live `/api/constants` endpoint.** This doc reflects what that endpoint actually returns; previous guesses (e.g. voltage at 719–721) have been corrected after probing real chargers — see §10.

---

## 1. Vendor profile

| Field | Value |
|---|---|
| Vendor | Zaptec AS (Norway) |
| Hardware tier | AC chargers |
| Models in scope | Zaptec Pro, Zaptec Go, Zaptec Go 2, Apollo |
| Cloud backend | Microsoft Azure (Service Bus AMQP for push, REST front-door at `api.zaptec.com` behind nginx) |
| OCPP support | 1.6J (cloud-routed and box-level / native) |
| `credential_scope` (per V3 §10) | **`installation`** — one OAuth credential set per `properties.installations` row covers every charger below |
| API style | OAuth-password REST + Service Bus AMQP push |

---

## 2. Authentication

### 2.1 Endpoint

```
POST https://api.zaptec.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password
username=<portal email>
password=<portal password>
scope=openid
```

Response:
```json
{
  "access_token": "<JWT>",
  "token_type": "bearer",
  "expires_in": 86399,
  "refresh_token": "<token>"
}
```

Bearer token valid ~24 h. There is no separate refresh endpoint we need to call inside that window; the integration just re-runs the password grant when the token approaches expiry.

### 2.2 Quirks observed against real credentials

1. **`scope=openid` is required.** Omitting it returns `400 invalid_grant` even with correct credentials.
2. **The `not_found` suffix on `invalid_grant`** means the username is not a recognized Zaptec account — distinct from a wrong password (which returns a different error string).
3. **`#` in passwords must be quoted in `.env` files.** Next.js's `@next/env` loader (dotenv) strips characters after a bare `#` in unquoted values, breaking auth silently. Always wrap passwords with `#` or other shell-special characters in double quotes:
   ```
   ZAPTEC_PASSWORD="Turtles#187"
   ```
4. **Aggressive rate limit on `/oauth/token`.** Hammering the endpoint in a tight loop returns `503 Service Temporarily Unavailable` from nginx with no `Retry-After`. Cache the bearer token; do not request a fresh one per call.

### 2.3 Credential scope

Per V3 architecture §5, the Zaptec adapter binds **one credential set per `properties.installations` row**. The credential covers every charger below that installation. Do not create per-charger Zaptec credentials.

---

## 3. REST API surface

The complete public OpenAPI spec is at `https://api.zaptec.com/swagger/v1/swagger.json` (~200 KB JSON). It documents **17 paths** — list below in invocation order for a typical fleet read. All require `Authorization: Bearer <token>`.

| Method · Path | Purpose | Notes |
|---|---|---|
| `GET /api/installation` | List installations the auth user can see | Paginated; `Pages` / `Data` envelope |
| `GET /api/installation/{id}` | Installation detail | 50+ fields, including `OcppCloudUrl`, `MessagingEnabled`, network type, fuse, feature bitmask |
| `GET /api/installation/{id}/hierarchy` | Circuit + charger tree | Returns `{Id, Name, Circuits: [{Id, Name, MaxCurrent, IsActive, Chargers: [{Id, Name, DeviceId, ...}]}]}` |
| `GET /api/installation/{id}/messagingConnectionDetails` | Service Bus credentials | **Returns a SAS token in `Password` — never display** |
| `POST /api/installation/{id}/update` | Write installation config | Destructive; gated behind operator auth |
| `GET /api/chargers` | Paginated charger list | Query params: `InstallationId`, `Roles`, `DeviceType`, `NameFilter`, `PageSize`, `PageIndex`, `IncludeDisabled`, `Exclude`, `SortProperty`, `SortDescending` |
| `GET /api/chargers/{id}` | Charger detail | Includes `SignedMeterValueKwh` (lifetime OCMF), `SignedMeterValue` (the OCMF blob), firmware, PIN, owner UUID, circuit ID |
| `GET /api/chargers/{id}/state` | State observations | Array of `{ChargerId, StateId, Timestamp, ValueAsString}`. ~80 observations on a live charger |
| `POST /api/chargers/{id}/sendCommand/{commandId}` | Charger command | See §7 |
| `POST /api/chargers/{id}/update` | Write charger config | Destructive |
| `GET /api/chargerFirmware/installation/{id}` | Firmware status per charger in the installation | Each entry: `{ChargerId, DeviceId, IsOnline, CurrentVersion, AvailableVersion, DeviceType, IsUpToDate}` |
| `GET /api/chargehistory` | Paginated session history | Filter by `ChargerId` or `InstallationId`. Each entry: `{Id, ChargerId, DeviceId, DeviceName, StartDateTime, EndDateTime, Energy, ChargerFirmwareVersion, SignedSession (full OCMF), ExternalId, ExternallyEnded}` |
| `GET, POST /api/chargehistory/installationreport` | Aggregate energy report | Heavier; not used by Technical Read |
| `GET /api/session/{id}` | Single session detail | Already embedded in chargehistory |
| `POST /api/session/{id}/priority` | Set load-balancing priority | |
| `GET /api/constants` | All Zaptec enums (Observations, Commands, Warnings, Features, ...) | **The authoritative reference.** ~35 KB JSON. Pull once, cache. Loaded into `zaptec-test/zaptec-constants.json` |

**Endpoints used by the Technical Read tab today** (every page render in the iframe):
- `/api/installation` (once for the picker)
- `/api/installation/{id}` (selected installation detail)
- `/api/installation/{id}/hierarchy` (circuit tree)
- `/api/installation/{id}/messagingConnectionDetails` (real-time push card)
- `/api/chargers?InstallationId=…` (picker dropdown rows)
- `/api/chargers/{id}` (charger detail card)
- `/api/chargers/{id}/state` (every 5 s for sparklines, plus once on render)
- `/api/chargehistory?ChargerId=…&PageSize=10` (charge history table)
- `/api/chargerFirmware/installation/{id}` (firmware fleet card)

---

## 4. Constants endpoint — `/api/constants`

Single GET with no auth required for the enum portion. Top-level keys observed:

```
Languages          Countries          InstallationCategories
InstallationTypes  UserRoles          NetworkTypes
ChargerOperationModes Phases          WildcardGuid
RegionalInfo       MessageCodes       ErrorCodes
Settings           Commands           Observations
Schema             ObjectTypes        Version
SmartWarnings      VarisciteWarnings  PhaseIdMap
DeviceLogTypes     Features           InstallationTypeConstraints
SessionCommitMetadata  InstallationUpdateStatusCodes  EntityTypes
DeviceTypes        InstallationAuthenticationType
EnergyPrices       UserActionTypes    OcppCloudUrlVersions
```

Use this as the source of every label, every bitmask flag, every operation-mode integer. Treat as read-only and cache for the lifetime of the worker.

---

## 5. State observations (155 IDs)

`Observations` in `/api/constants` is a `{ name: id }` map. **Inverted (id → name) gives the authoritative ID catalogue.** Below is the abridged list grouped by category — the full 155-entry table is in `zaptec-test/zaptec-constants.json`. **Negative IDs are synthetic / connection observations** that don't come from the charger directly.

### 5.1 Synthetic / connection
| ID | Name |
|---|---|
| -100 | AuthorizationCache |
| -3 | IsOcppConnected |
| -2 | IsOnline |
| -1 | Pulse |

### 5.2 Operation
| ID | Name | Type |
|---|---|---|
| 100 | Capabilities | JSON blob |
| 110 | ProductName | string ("ZAPTEC PRO") |
| 152 | ProductCode | string |
| 154 | LockCableWhenConnected | bool |
| 151 | PermanentCableLock | bool |
| 701 | ChargeDuration | seconds |
| 702 | ChargeMode | enum |
| 708 | ChargeCurrentSet | A (DLB-allocated) |
| 710 | **ChargerOperationMode** | enum 0–6 (see §5.7) |
| 711 | IsEnabled | bool |
| 712 | IsStandAlone | bool |
| 714 | CableType | A (proximity-resistor reading) |
| 715 | NetworkType | enum 0–4 (see §5.8) |
| 716 | DetectedCar | bool |
| 718 | FinalStopActive | bool |
| 720 | TariffText | string |
| 721 | SessionIdentifier | UUID |
| 722 | ChargerCurrentUserUuid | UUID |
| 723 | **CompletedSession** | full session JSON with embedded OCMF |
| 762 | TimeSchedule | JSON |
| 763 | NextScheduleEvent | timestamp |
| 764 | MaxStartDelay | seconds |

### 5.3 Electrical (live telemetry)
| ID | Name | Unit |
|---|---|---|
| 501 / 502 / 503 | **VoltagePhase1 / 2 / 3** | V |
| 507 / 508 / 509 | **CurrentPhase1 / 2 / 3** | A |
| 510 | ChargerMaxCurrent | A |
| 511 | ChargerMinCurrent | A |
| 512 | ActivePhases | bitmask (1=L1, 2=L2, 4=L3, 7=All) |
| 513 | TotalChargePower | W |
| 515 | RcdCurrent | mA (RCD residual) |
| 517 | Internal12vCurrent | mA |
| 518 | PowerFactor | dimensionless |
| 519 | SetPhases | bitmask |
| 520 | MaxPhases | bitmask |
| 522 | ChargerOfflinePhase | bitmask |
| 523 | ChargerOfflineCurrent | A |
| 540–542 | RCD calibration / test | various |

### 5.4 Metering
| ID | Name | Unit | Notes |
|---|---|---|---|
| 553 | TotalChargePowerSession | kWh | Resets per session |
| 554 | **SignedMeterValue** | OCMF blob | `OCMF\|{json with RD: [{TM, RV, RU, ...}]}\|signature` |
| 555 | SignedMeterValueInterval | OCMF blob | Per-15-min sample |
| 560 / 561 | SessionEnergyExport (Active / Reactive) | Wh / varh | V2G — Pro doesn't support |
| 562 / 563 | SessionEnergyImport (Active / Reactive) | Wh / varh | |

### 5.5 Connectivity & cloud
| ID | Name |
|---|---|
| 150 | CommunicationMode (returns numeric **or** label; decoder must accept both — see §10.2) |
| 803 | Notifications (bitmask — decoded against `SmartWarnings` + `VarisciteWarnings`) |
| 804 | Warnings (same bitmask vocabulary) |
| 805 | DiagnosticsMode |
| 807 | InternalDiagnosticsLog |
| 808 | DiagnosticsString |
| 809 | CommunicationSignalStrength (dBm) |
| 810 | CloudConnectionStatus |
| 820 | UptimeVariscite (**hours**, decimal — not ms; see §10.3) |
| 821 | UptimeMCU (hours) |
| 753 | LteRoamingDisabled |
| 861 / 862 / 866 / 867 / 868 / 869 | OcppNative* (only populated when `AuthenticationType=3` Native OCPP) |

### 5.6 Authentication
| ID | Name |
|---|---|
| 120 | AuthenticationRequired |
| 750 | NewChargeCard (`<UUID>;<card-number>;<group-name>`) |
| 751 | AuthenticationListVersion (Native list version, 0 = none synced) |
| 752 | EnabledNfcTechnologies |
| 706 | PilotVsProximityTime |

### 5.7 `ChargerOperationMode` (StateId 710) — enum

| Value | Label | OCPP `ConnectorStatus` (approximate) |
|---|---|---|
| 0 | Unknown | Faulted |
| 1 | Disconnected | Available |
| 2 | Connected_Requesting | Preparing |
| 3 | Connected_Charging | Charging |
| 5 | Connected_Finished | Finishing |
| 6 | Connected_RequestingLimited | SuspendedEVSE (DLB throttling) |

Note: there is no `4` — Zaptec skips it. `IsEnabled = 0` overrides everything to OCPP `Unavailable`.

### 5.8 `NetworkType` (StateId 715) — enum

| Value | Label |
|---|---|
| 0 | Unknown |
| 1 | IT · 1-phase |
| 2 | IT · 3-phase |
| 3 | TN · 1-phase |
| 4 | TN · 3-phase (typical for Iceland — observed) |

### 5.9 Versions

| ID | Name |
|---|---|
| 908 | SmartMainboardSoftwareApplicationVersion |
| 909 | SmartMainboardSoftwareBootloaderVersion |
| 911 | SmartComputerSoftwareApplicationVersion (= "firmware version") |
| 912 | SmartComputerSoftwareBootloaderVersion |
| 913 | SmartComputerHardwareVersion (`"Image 6.0, Linux 4.9.88-mx6ul+gde60a7a"`) |
| 914 | MIDLegallyRelevantSoftwareIdentifier |

### 5.10 Identifiers

| ID | Name |
|---|---|
| 950 | MacMain |
| 951 | MacPlcModuleGrid |
| 952 | MacWiFi |
| 953 | MacPlcModuleEv |
| 960 | LteImsi |
| 961 | LteMsisdn |
| 962 | LteIccid |
| 963 | LteImei |
| 964 | LteVersion |
| 965 | LteDetailedSignalStrength |
| 980 | MIDCalibration |
| 981 | MIDPublicKey (used to verify OCMF signatures) |
| 982 | MIDCalibrationID |

---

## 6. Bitmasks

### 6.1 `SmartWarnings` (32 bits)

Lights up in `Notifications` (803) and `Warnings` (804). Decoded by AND-ing the integer against each flag. Higher bits go into `bigint` territory.

| Bit | Flag | Severity (suggested triage) |
|---|---|---|
| 1 | WARNING_HUMIDITY | medium |
| 2 | WARNING_TEMPERATURE | medium |
| 4 | WARNING_TEMPERATURE_ERROR | high |
| 8 | WARNING_EMETER_NO_RESPONSE | high |
| 16 | WARNING_MAX_SESSION_RESTART | medium |
| 32 | WARNING_CHARGE_OVERCURRENT | high |
| 64 | WARNING_PILOT_STATE | high |
| 128 | WARNING_RELAY_WELDED | **high — STOP USING** |
| 256 | WARNING_PILOT_LOW_LEVEL | medium |
| 512 | WARNING_FPGA_COM_TIMEOUT | high |
| 1024 | WARNING_REBOOT | low |
| 2048 | WARNING_DISABLED | medium |
| 4096 | WARNING_RCD_AC | high |
| 8192 | WARNING_RCD_DC | high |
| 16384 | WARNING_RCD_PEAK | high |
| 65536 | WARNING_RCD_TEST_AC | high |
| 131072 | WARNING_RCD_TEST_DC | high |
| 262144 | WARNING_RCD_FAILURE | high |
| 524288 | WARNING_RCD_TEST_TIMEOUT | high |
| 1048576 | WARNING_FPGA_VERSION | medium |
| 2097152 | WARNING_FPGA_UNEXPECTED_RELAY | high |
| 4194304 | WARNING_FPGA_CHARGING_RESET | high |
| 8388608 | WARNING_PILOT_NO_PROXIMITY | medium |
| 16777216 | WARNING_EMETER_ALARM | high |
| 33554432 | WARNING_EMETER_LINK | high |
| 67108864 | WARNING_NO_VOLTAGE_L1 | high |
| 134217728 | WARNING_NO_VOLTAGE_L2_L3 | high |
| 268435456 | WARNING_FPGA_WATCHDOG | high |
| 536870912 | WARNING_EMETER_CAL | high |
| 1073741824 | WARNING_MID | high |

`WARNING_RCD = 1011712` is a convenience constant (OR of all RCD bits).

### 6.2 `VarisciteWarnings` (Linux SoM-side faults)

| Bit | Flag |
|---|---|
| 1 | WARNING_MCU_BOOTLOADER |
| 2 | WARNING_FPGA_INIT_FAILED |
| 4 | WARNING_VARISCITE_ILLEGAL_PHASE |

### 6.3 `Features` (installation-level capability bitmask)

Surfaced as `installation.AvailableFeatures` (what the installation type permits) and `installation.EnabledFeatures` (what's actually on).

| Bit | Flag | Meaning |
|---|---|---|
| 1 | Api_MessageSubscription | Real-time push (Service Bus) available |
| 2 | Authentication_Internal | Built-in driver auth |
| 4 | PowerManagement_Apm | Active Power Management (DLB) |
| 8 | PowerManagement_EcoMode | Off-peak charging |
| 16 | PowerManagement_Schedule | Charging schedules |
| 32 | PowerManagement_Apm_PowerLimit | DLB power limit |
| 64 | Connectivity_4G | Cellular |
| 128 | Authentication_Ocpp | OCPP authorization (cloud-routed) |
| 256 | PowerManagement_Apm_Tariff_PowerLimit | Tariff-aware power limit |
| 512 | Authentication_OcppNative | Native OCPP auth (no Zaptec involvement) |
| 65536 | PowerManagement_Apm_Tic | TIC HAN-port DLB (FR market) |
| 131072 | PowerManagement_Apm_SurplusMode | PV surplus charging |

`InstallationTypes`:
- Pro · `Id=0` · default features = 183 (decimal)
- Smart · `Id=1` · default features = 471 · max 1 circuit · max 32 A · max 3 chargers

---

## 7. Commands

`POST /api/chargers/{id}/sendCommand/{commandId}` — body is empty. Commands operate on the *active session* unless noted.

| Command ID | Name | Effect | Pre-condition |
|---|---|---|---|
| 102 | RestartCharger | Reboot the controller (interrupts active session) | none |
| 103 | RestartMcu | Reset just the MCU | engineering |
| 104 | UpdateSettings | Force re-read of settings | none |
| 200 | UpgradeFirmware | Download + install latest firmware | charger online; takes ~10 min |
| 506 | StopChargingFinal | Pause the active session | requires `OperationMode = 3 (Charging)`; firmware > 3.2 on Pro |
| 507 | ResumeCharging | Resume from paused state | requires `OperationMode = 5 + FinalStopActive = 1`; firmware > 3.2 on Pro |
| 10001 | DeauthorizeAndStop | Stop the session and revoke the authorization | caller must prevent new sessions until it completes |

Other Zaptec command IDs in `/api/constants` (`Commands`) exist (e.g. 261 `ResetNotifications`, 262 `ResetComWarnings`, 320–324 PLC config, 501–505 internal, 700 `RequestSignedMIDEventLog`, 708 `UnlockConnector`, 901 `RunPostProductionTest`, 951 `RunPilotTest`) but the seven above are the user-facing operator commands.

---

## 8. OCPP integration

### 8.1 The four authentication paths (installation-level toggle)

`installation.AuthenticationType`:

| Value | Path | Auth source | Notes |
|---|---|---|---|
| 0 | Native | Zaptec cloud | Uses local AuthList synced from portal |
| 1 | Webhooks | Custom HTTP callback | External per-tap webhook |
| 2 | **OCPP cloud-routed** | Zaptec cloud → CSMS via OCPP 1.6J | What Dalvegur 10–14 uses today |
| 3 | OCPP Native | Charger ↔ CSMS direct (bypasses Zaptec cloud) | Populates `OcppNativeUrl` (StateId 861) |

In modes 2 and 3, **Zaptec cloud-based authentication methods (Zaptec App, RFID tags registered in the Portal) are bypassed for charging operations.** The CSMS owns auth.

### 8.2 OCPP cloud URL

`installation.OcppCloudUrl` is the canonical CSMS endpoint. **As of 2026-04-26 on Dalvegur 10–14 this is:**

```
wss://straumvakt-ocpp.straumvakt.workers.dev/ocpp/ZAP257533
```

Previously (before Sprint 1.5) the same field returned `wss://beta.connect.longship.io/<tenant>/ZAP257533` — Longship was the upstream OCPP relay for Zaptec's Pro fleet. Switching `OcppCloudUrl` to the Straumvakt worker is what lets Sprint 1.5's Technical Read tab observe a live OCPP session against our own CSMS.

The path tail (`ZAP257533`) is the **OCPP charge-box identifier** (one per installation; chargers within the installation share it). Stored separately as `installation.OcppCloudUrlVersion` (currently `1`).

### 8.3 Local Auth List (OCPP 1.6J Appendix B keys)

Documented defaults from the Zaptec Go/Go2 OCPP 1.6J supported keys (Pro publishes a separate but overlapping list — see official source in §11):

| Key | Default | Read-only | Mandatory |
|---|---|---|---|
| LocalAuthListEnabled | true | no | yes |
| LocalAuthorizeOffline | true | no | yes |
| LocalPreAuthorize | false | no | yes |
| AuthorizationCacheEnabled | false | no | no |
| AllowOfflineTxForUnknownId | false | no | no |
| AuthorizeRemoteTxRequests | true | no | yes |
| StopTransactionOnInvalidId | true | no | yes |
| LocalAuthListMaxLength | 1024 | yes | yes |
| SendLocalListMaxLength | 255 | yes | yes |

Behaviour:
- **Online + `LocalPreAuthorize=false` (default):** charger sends `Authorize` to the CSMS for every tap.
- **Online + `LocalPreAuthorize=true`:** charger short-circuits if the idTag is in the local list.
- **Offline + `LocalAuthorizeOffline=true` (default):** charger consults the local list.
- **Offline + `AllowOfflineTxForUnknownId=false` (default):** unknown idTags are denied. Flip to `true` to allow opportunistic charging during outages.

The Native-mode equivalent of `SendLocalList` is the Zaptec Portal's user-group → "Allowed users" list, propagated via Zaptec's own protocol; `AuthenticationListVersion` (StateId 751) is the local mirror version.

### 8.4 What's reachable via Zaptec REST vs only via the CSMS path

| OCPP concept | REST mirror | CSMS-only |
|---|---|---|
| Connection state | `IsOcppConnected` (-3) | — |
| BootNotification fields | Charger detail fields + StateId 911/912/913 | raw timestamp |
| StatusNotification | Derived from `ChargerOperationMode` (710) + `IsEnabled` (711) | per-event log |
| MeterValues | Voltage 501–503, Current 507–509, Power 513, Energy 553/554, PF 518, Temp 201/202 | Frequency, SoC, RPM, V2G energies |
| Heartbeat | UptimeVariscite (820) + last observation timestamp | per-message log |
| Authorize | NewChargeCard (750), AuthListVersion (751) | per-Authorize log |
| ChangeConfiguration / GetConfiguration | — | full local config dump |
| SetChargingProfile / ClearChargingProfile | — | active profile list |
| TriggerMessage | — | one-off invocations |
| RemoteStartTransaction / RemoteStopTransaction / Reset / UnlockConnector / ChangeAvailability | partial via `sendCommand/{id}` | full OCPP semantics |

Practical implication for the Technical Read tab: **three of seven OCPP cards (Connection, Connector Status, MeterValues) render real data via the REST mirror**; the other four (Configuration, Authorization log, Recent messages, Charging profiles) need an endpoint exposed by the Straumvakt CSMS worker.

---

## 9. Real-time push — Azure Service Bus

`GET /api/installation/{id}/messagingConnectionDetails` returns:

```jsonc
{
  "Type": 0,                 // unknown enum — observed = 0
  "Host": "zap-p-installations-sbus.servicebus.windows.net",
  "Port": 5671,              // AMQP 1.0 over TLS
  "UseSSL": true,
  "Username": "installation_<installation-uuid>",
  "Password": "<SAS shared-access signature — short-lived>",  // SECRET
  "Topic": "installation_<installation-uuid>",
  "Subscription": "default"
}
```

**The Password field is a Service Bus SAS — never display it client-side.** Fetch + use server-side only. Tokens are rotated; re-call the endpoint when a connection drops.

`MessagingEnabled` on the installation must be `true` for the channel to be provisioned.

---

## 10. Live findings — corrections vs published / community guesses

These corrections were made after probing real Zaptec Pro chargers in the Dalvegur 10–14 installation. **Anywhere community sources (e.g. evcc, Home Assistant Zaptec) disagree, prefer `/api/constants` over the community map.**

### 10.1 StateId corrections

| ID | Wrong (in some community maps) | Correct (from `/api/constants`) |
|---|---|---|
| 501 / 502 / 503 | _(not used)_ | **VoltagePhase1 / 2 / 3** ← we had these at 719/720/721 |
| 554 | _(unused)_ | **SignedMeterValue (OCMF)** ← we had this at 708 |
| 708 | (some maps: SignedMeterValue) | **ChargeCurrentSet** (DLB-allocated current in A) |
| 711 | (some maps: IsOnline) | **IsEnabled** ← `IsOnline` is the synthetic StateId `-2` |
| 715 | (some maps: SmartComputerSoftwareApplicationVersion) | **NetworkType** ← firmware app version is 911 |
| 721 | (some maps: VoltagePhase3) | **SessionIdentifier** (UUID) |
| 722 | _(unused)_ | **ChargerCurrentUserUuid** |
| -2, -3 | _(implied "not real")_ | **IsOnline / IsOcppConnected** — real synthetic IDs the API emits |

### 10.2 `CommunicationMode` (StateId 150) returns mixed types

Different chargers / firmware versions return either:
- A numeric code (`"0"`, `"1"`, `"2"`, `"3"`, `"4"` for None / Wi-Fi / LTE / PLC / Ethernet), **or**
- The literal label (`"PLC"`, `"Wi-Fi"`, etc.)

A robust decoder must accept both. Festi 5 returned `"PLC"` on 2026-04-26.

### 10.3 Uptime is in **hours**, not milliseconds

`UptimeVariscite` (820) and `UptimeMCU` (821) return decimal hours since boot (e.g. `95.0512` = 95 h 3 m). Earlier integration code that treated them as milliseconds produced near-zero values and was silently wrong.

### 10.4 OCPP URL form changed mid-session

The `installation.OcppCloudUrl` for the same installation transitioned from a Longship-relayed URL to the Straumvakt CSMS worker URL between 2026-04-22 and 2026-04-26. The integration must therefore **read this field every session** rather than caching it on installation discovery.

### 10.5 "OCPP not connected" is a section state, not a page state

Even when `IsOcppConnected = 1` (protocol up), the *raw OCPP frames* live in the CSMS worker, not in the Zaptec REST API. UI must split the OCPP section by what's reachable: live for Connection / Connector Status / MeterValues (REST mirrors), placeholder skeletons for Configuration / Authorization log / Recent messages / Charging profiles (need worker endpoint).

### 10.6 OCMF is the bridge

The signed meter envelope (StateId 554, plus the `SignedSession` field on every chargehistory entry) is **the same byte-for-byte object whether observed via Zaptec REST or via the OCPP `StopTransaction.transactionData`.** The MID public key (StateId 981) verifies it independently of either path. This is the audit-quality receipt for billing.

### 10.7 Session content shape

`StateId 723 CompletedSession` (and equivalently each `chargehistory` entry's `SignedSession`) is the OCMF blob. Decoded shape:

```
OCMF|<json>|<signature>
       └─ {
            FV: "1.0",
            GI: "ZAPTEC PRO",         // gateway identification
            GS: "ZCS032822",          // gateway serial = device id
            GV: "3.2.2.0",            // firmware
            PG: "T1",                 // pagination tag
            RD: [                     // reading data
              { TM: "ts R", TX: "B|T|E", RV: "<kWh>", RI: "1-0:1.8.0", RU: "kWh", RT: "AC", ST: "G" },
              ...
            ]
          }
```
- `TM` timestamps use comma decimal separators (`2026-04-24T12:35:49,183+00:00 R`); normalize to dot before parsing.
- `TX = "B"` (begin), `"T"` (interval tick, every 15 min), `"E"` (end).
- `RV` is cumulative kWh from the lifetime register, not a delta. Compute interval kWh as `RV[n] - RV[n-1]`.

---

## 11. Companion docs

This file references two shared protocol docs in this folder:

- [`ocpp-1.6j.md`](ocpp-1.6j.md) — the full OCPP 1.6J protocol reference (28 messages, 38 standard config keys, state machine, security profiles). Anywhere this file says "OCPP 1.6J" without further qualification, that doc is what's meant.
- [`ocmf.md`](ocmf.md) — the OCMF signed-meter envelope reference. Required to parse and verify `SignedMeterValue` (StateId 554), `SignedMeterValueInterval` (555), and `SignedSession` inside completed sessions.

---

## 12. Sources

- [Zaptec Developer Docs](https://docs.zaptec.com/) — primary docs portal.
- [Zaptec OpenAPI spec](https://api.zaptec.com/swagger/v1/swagger.json) — authoritative endpoint list.
- [Zaptec Constants endpoint](https://api.zaptec.com/api/constants) — authoritative enum list.
- [OCPP 1.6J reference](https://docs.zaptec.com/docs/ocpp16j) — Zaptec's OCPP profile.
- [Zaptec Go and Go2 OCPP 1.6J supported configuration keys](https://docs.zaptec.com/docs/zaptec-go2-ocpp-16j-supported-configuration-keys) — Local Auth defaults.
- [Configuring an OCPP server (cloud)](https://docs.zaptec.com/docs/configuring-your-installation-to-an-ocpp-server) — `OcppCloudUrl` semantics.
- [Managing access and authentication for Zaptec Pro](https://help.zaptec.com/hc/en-001/articles/360020482958) — RFID + AuthList overview.
- [Integrating with Zaptec charging systems (PDF)](https://zaptec.objects.frb.io/assets/PDFs/Integrating-with-Zaptec-charging-systems.pdf) — older but comprehensive integration guide.
- [evcc Zaptec adapter](https://pkg.go.dev/github.com/evcc-io/evcc/charger/zaptec) — community StateId map (cross-check, not always accurate).
- [Home Assistant zaptec custom component](https://github.com/custom-components/zaptec) — community OAuth + state implementation.
- Live probes against `7d722149-3c5f-4488-8bf2-e660503e11e9` (Dalvegur 10–14, Iceland) — 2026-04-22 to 2026-04-26.

---

## 13. Full enum reference (embedded — no companion file required)

These tables mirror `https://api.zaptec.com/api/constants` verbatim as of 2026-04-26. **The constants file should be re-pulled and this section regenerated whenever Zaptec ships a new firmware track.** For a machine-readable copy, `zaptec-test/zaptec-constants.json` carries the same data.

### 13.1 Complete observation catalogue (155 entries)

```
   -100  AuthorizationCache                  -3  IsOcppConnected
     -2  IsOnline                            -1  Pulse
      0  Unknown                              1  OfflineMode
    100  Capabilities                       110  ProductName
    111  ArenaId                            120  AuthenticationRequired
    130  PaymentActive                      131  PaymentCurrency
    132  PaymentSessionUnitPrice            133  PaymentEnergyUnitPrice
    134  PaymentTimeUnitPrice               150  CommunicationMode
    151  PermanentCableLock                 152  ProductCode
    153  HmiBrightness                      154  LockCableWhenConnected
    155  SoftStartDisabled                  156  FirmwareApiHost
    157  DpsAssignedIotHub                  158  DpsScopeId
    159  IoTHubOverride                     170  MIDBlinkEnabled
    180  ProductionTesterEnabled            181  ProductionTestStationOverride
    201  TemperatureInternal5               202  TemperatureInternal6
    203  TemperatureInternalLimit           205  TemperaturePowerBoard
    241  TemperatureInternalMaxLimit        270  Humidity
    280  TamperCover                        501  VoltagePhase1
    502  VoltagePhase2                      503  VoltagePhase3
    507  CurrentPhase1                      508  CurrentPhase2
    509  CurrentPhase3                      510  ChargerMaxCurrent
    511  ChargerMinCurrent                  512  ActivePhases
    513  TotalChargePower                   515  RcdCurrent
    517  Internal12vCurrent                 518  PowerFactor
    519  SetPhases                          520  MaxPhases
    522  ChargerOfflinePhase                523  ChargerOfflineCurrent
    540  RcdCalibration                     541  RcdCalibrationNoise
    542  ManualRcdTest                      553  TotalChargePowerSession
    554  SignedMeterValue                   555  SignedMeterValueInterval
    560  SessionEnergyCountExportActive     561  SessionEnergyCountExportReactive
    562  SessionEnergyCountImportActive     563  SessionEnergyCountImportReactive
    570  SoftStartTime                      701  ChargeDuration
    702  ChargeMode                         703  ChargePilotLevelInstant
    704  ChargePilotLevelAverage            706  PilotVsProximityTime
    708  ChargeCurrentSet                   710  ChargerOperationMode
    711  IsEnabled                          712  IsStandAlone
    713  ChargerCurrentUserUuidDeprecated   714  CableType
    715  NetworkType                        716  DetectedCar
    717  GridTestResult                     718  FinalStopActive
    719  AuthorizationTimeout               720  TariffText
    721  SessionIdentifier                  722  ChargerCurrentUserUuid
    723  CompletedSession                   724  PlugAndChargeAuthorizeRequest
    725  RejectedUserUuid                   750  NewChargeCard
    751  AuthenticationListVersion          752  EnabledNfcTechnologies
    753  LteRoamingDisabled                 760  Location
    761  TimeZone                           762  TimeSchedule
    763  NextScheduleEvent                  764  MaxStartDelay
    800  InstallationId                     801  RoutingId
    803  Notifications                      804  Warnings
    805  DiagnosticsMode                    807  InternalDiagnosticsLog
    808  DiagnosticsString                  809  CommunicationSignalStrength
    810  CloudConnectionStatus              811  McuResetSource
    812  McuRxErrors                        813  McuToVariscitePacketErrors
    814  VarisciteToMcuPacketErrors         816  MIDFaultFlags
    817  RelayWeldedFlags                   820  UptimeVariscite
    821  UptimeMCU                          823  CertificateVersion
    830  SecurityLog                        850  CarSessionLog
    851  CommunicationModeConfigurationInconsistency
    852  RawPilotMonitor                    853  IT3PhaseDiagnosticsLog
    854  PilotTestResults                   855  UnconditionalNfcDetectionIndication
    856  EnableLteDetailedSignalStrength    857  EnableLocalNetworkMaintenance
    860  SessionController                  861  OcppNativeUrl
    862  OcppNativeCbId                     866  OcppNativeConnected
    867  OcppTunnelCall                     868  OcppNativeZaptecLoadBalancingEnabled
    869  OcppNativeOnePhaseChargingPhase    899  EmcTestCounter
    900  ProductionTestResults              901  PostProductionTestResults
    908  SmartMainboardSoftwareApplicationVersion
    909  SmartMainboardSoftwareBootloaderVersion
    911  SmartComputerSoftwareApplicationVersion
    912  SmartComputerSoftwareBootloaderVersion
    913  SmartComputerHardwareVersion       914  MIDLegallyRelevantSoftwareIdentifier
    920  PlcPibVersionGrid                  921  PlcPibVersionEV
    930  AppliedImageUpdates                931  FailedImageUpdates
    950  MacMain                            951  MacPlcModuleGrid
    952  MacWiFi                            953  MacPlcModuleEv
    960  LteImsi                            961  LteMsisdn
    962  LteIccid                           963  LteImei
    964  LteVersion                         965  LteDetailedSignalStrength
    970  ProductionTestStationNumber        980  MIDCalibration
    981  MIDPublicKey                       982  MIDCalibrationID
```

### 13.2 Complete commands catalogue (50 entries)

```
      0  Unknown                              1  InChargePingReply
      2  OfflineModeOverride                102  RestartCharger
    103  RestartMcu                         104  UpdateSettings
    105  RestartNtp                         106  ExitAppWithCode
    107  RestartApplication                 108  ReprovisionIotHub
    109  ReprovisionDps                     200  UpgradeFirmware
    201  UpgradeFirmwareForced              260  ResetComErrors
    261  ResetNotifications                 262  ResetComWarnings
    300  LocalSettings                      320  SetPlcNpw
    321  SetPlcCCoMode                      322  SetPlcNmk
    323  SetRemotePlcNmk                    324  SetRemotePlcNpw
    501  StartCharging                      502  StopCharging
    503  ReportChargingState                504  SetSessionId
    505  SetUserUuid                        506  StopChargingFinal
    507  ResumeCharging                     601  ShowGranted
    602  ShowDenied                         603  IndicateAppConnect
    700  RequestSignedMIDEventLog           708  UnlockConnector
    750  ConfirmChargeCardAdded             751  SetAuthenticationList
    752  OcppTunnelMessage                  800  Debug
    801  GetPlcTopology                     802  ResetPlc
    803  RemoteCommand                      804  RunGridTest
    805  ClearObservationCache              901  RunPostProductionTest
    902  GetFirmwareVersion                 950  DumpPilotCounter
    951  RunPilotTest                     10000  CombinedMin
  10001  DeauthorizeAndStop               10999  CombinedMax
```

`CombinedMin` / `CombinedMax` define the range reserved for "combined" commands — `DeauthorizeAndStop` (10001) is the only one defined today, but vendors can ship more in this range without conflicting with low-numbered IDs.

### 13.3 `ChargerOperationMode` (StateId 710)

```json
{ "Unknown": 0, "Disconnected": 1, "Connected_Requesting": 2,
  "Connected_Charging": 3, "Connected_Finished": 5 }
```

Note: `4` is reserved / unused. `6 = Connected_RequestingLimited` exists in the wild (DLB throttling) but is not in the Constants enum — assume it as an extension.

### 13.4 `Phases` (used by StateId 512 / 519 / 520)

```json
{ "None": 0, "Phase_1": 1, "Phase_2": 2, "Phase_3": 4, "All": 7 }
```

Bitmask: `value & 1` ⇒ L1, `value & 2` ⇒ L2, `value & 4` ⇒ L3.

### 13.5 `NetworkTypes` (StateId 715)

```json
{ "Unknown": 0, "IT_1_Phase": 1, "IT_3_Phase": 2,
  "TN_1_Phase": 3, "TN_3_Phase": 4 }
```

### 13.6 `DeviceTypes`

```json
{ "Unknown": 0, "Smart": 1, "Portable": 2, "HomeApm": 3,
  "Apollo": 4, "OtherApm": 5, "GenericApm": 6,
  "HanApm": 7, "TicApm": 8 }
```

`Smart` is the Zaptec Pro family. `Apollo` is Zaptec Go / Go 2.

### 13.7 `InstallationTypes`

```json
{
  "Pro":   { "Id": 0, "Name": "Pro",   "DefaultFeatures": 183,                                "DefaultRoute": "default" },
  "Smart": { "Id": 1, "Name": "Smart", "MaxCircuits": 1, "MaxCircuitCurrent": 32, "MaxChargers": 3, "DefaultFeatures": 471, "DefaultRoute": "default" }
}
```

### 13.8 `InstallationCategories`

```json
[
  { "Id": "5c624162-e595-4167-a8bb-8b33a1487b62", "Category": "Community_Installation_Category" },
  { "Id": "c43d09c7-b734-4319-af16-9e8fac37d7ec", "Category": "Company_Installation_Category" },
  { "Id": "d72d6374-7f73-4df5-8056-60635b177421", "Category": "Private_Installation_Category" },
  { "Id": "08814e5f-bd84-45cd-9e0e-d225c8d675e1", "Category": "Public_Installation_Category" }
]
```

Dalvegur 10–14 is `Company_Installation_Category` (`c43d09c7-...`).

### 13.9 `InstallationAuthenticationType`

```json
{ "Native": 0, "WebHooks": 1, "Ocpp": 2, "OcppNative": 3 }
```

### 13.10 `Features` (installation `AvailableFeatures` / `EnabledFeatures` bitmask)

```json
{
  "None": 0,
  "Api_MessageSubscription": 1,
  "Authentication_Internal": 2,
  "PowerManagement_Apm": 4,
  "PowerManagement_EcoMode": 8,
  "PowerManagement_Schedule": 16,
  "PowerManagement_Apm_PowerLimit": 32,
  "Connectivity_4G": 64,
  "Authentication_Ocpp": 128,
  "PowerManagement_Apm_Tariff_PowerLimit": 256,
  "Authentication_OcppNative": 512,
  "PowerManagement_Apm_Tic": 65536,
  "PowerManagement_Apm_SurplusMode": 131072
}
```

Default `Pro` install gets `183 = 1+2+4+16+32+128` = MessageSubscription + Internal Auth + APM + Schedule + APM Power Limit + OCPP Auth.

### 13.11 `SmartWarnings` (full bitmask)

```json
{
  "WARNING_OK": 0,
  "WARNING_HUMIDITY": 1,
  "WARNING_TEMPERATURE": 2,
  "WARNING_TEMPERATURE_ERROR": 4,
  "WARNING_EMETER_NO_RESPONSE": 8,
  "WARNING_MAX_SESSION_RESTART": 16,
  "WARNING_CHARGE_OVERCURRENT": 32,
  "WARNING_PILOT_STATE": 64,
  "WARNING_RELAY_WELDED": 128,
  "WARNING_PILOT_LOW_LEVEL": 256,
  "WARNING_FPGA_COM_TIMEOUT": 512,
  "WARNING_REBOOT": 1024,
  "WARNING_DISABLED": 2048,
  "WARNING_RCD_AC": 4096,
  "WARNING_RCD_DC": 8192,
  "WARNING_RCD_PEAK": 16384,
  "WARNING_RCD_TEST_AC": 65536,
  "WARNING_RCD_TEST_DC": 131072,
  "WARNING_RCD_FAILURE": 262144,
  "WARNING_RCD_TEST_TIMEOUT": 524288,
  "WARNING_RCD": 1011712,
  "WARNING_FPGA_VERSION": 1048576,
  "WARNING_FPGA_UNEXPECTED_RELAY": 2097152,
  "WARNING_FPGA_CHARGING_RESET": 4194304,
  "WARNING_PILOT_NO_PROXIMITY": 8388608,
  "WARNING_EMETER_ALARM": 16777216,
  "WARNING_EMETER_LINK": 33554432,
  "WARNING_NO_VOLTAGE_L1": 67108864,
  "WARNING_NO_VOLTAGE_L2_L3": 134217728,
  "WARNING_FPGA_WATCHDOG": 268435456,
  "WARNING_EMETER_CAL": 536870912,
  "WARNING_MID": 1073741824,
  "WARNING_VARISCITE": 2147483648,
  "WARNING_MCU_BOOTLOADER": 4294967296,
  "WARNING_FPGA_INIT_FAILED": 8589934592,
  "WARNING_VARISCITE_ILLEGAL_PHASE": 17179869184
}
```

`WARNING_RCD = 1011712` is a convenience constant (OR of `RCD_AC | RCD_DC | RCD_PEAK | RCD_TEST_AC | RCD_TEST_DC | RCD_FAILURE | RCD_TEST_TIMEOUT`).

> [!IMPORTANT]
> The high bits (`WARNING_VARISCITE` = 2^31, `WARNING_MCU_BOOTLOADER` = 2^32, `WARNING_FPGA_INIT_FAILED` = 2^33, `WARNING_VARISCITE_ILLEGAL_PHASE` = 2^34) **exceed JavaScript's safe-integer range** (2^53 is fine but bitwise operators on `Number` are 32-bit). Decode with `BigInt`:
> ```ts
> const value = BigInt(raw);  // raw is the ValueAsString from StateId 803/804
> for (const [name, bit] of Object.entries(SmartWarnings)) {
>   if (bit !== 0 && (value & BigInt(bit)) !== 0n) yield name;
> }
> ```

### 13.12 `VarisciteWarnings`

```json
{ "WARNING_MCU_BOOTLOADER": 1, "WARNING_FPGA_INIT_FAILED": 2,
  "WARNING_VARISCITE_ILLEGAL_PHASE": 4 }
```

These overlap with `SmartWarnings` at the top end — when decoding, prefer the SmartWarnings name when both match.

### 13.13 `ErrorCodes` (HTTP error envelope `code`)

```json
{
  "Unknown": 500, "MissingRequiredData": 503, "UnknownSetting": 504,
  "OperationFailedForUnknownReasons": 505, "NotApplicableForUser": 506,
  "UnknownUser": 507, "RfidTokenInUse": 508, "SignUpTooManyRequests": 509,
  "EmailInUse": 510, "CellPhoneInUse": 511, "UnknownObject": 512,
  "InvalidPassword": 513, "IncorrectPassword": 514,
  "UserActivationLinkExpired": 515, "LinkRequestExpired": 516,
  "ChargerDeviceIdExists": 517, "UnknownDeviceId": 518,
  "UnknownCommand": 519, "ErrorCommunicatingWithDevice": 520,
  "StringIsNotAWellFormedVersion": 521, "FirmwareVersionExists": 522,
  "FirmwareFileExists": 523, "CreateConflict": 524,
  "DeviceFirmwareNotConfigured": 525, "FeatureNotEnabled": 526,
  "NotSupported": 527, "DeviceCommandRejected": 528,
  "InvalidFormat": 529, "MailSendFailed": 530, "ConcurrencyError": 531,
  "ConfigurationError": 532, "Forbidden": 533,
  "InstallationTypeViolation": 534, "PaymentFailed": 535,
  "PaymentAuthorizationRequired": 536,
  "OperationFailedActiveSubscriptions": 537,
  "OperationFailedDueToChargerState": 538,
  "InstallationConstraintViolation": 539, "UnknownInstallationId": 540,
  "UnknownEnergySensorId": 541,
  "UnauthorizedToPerformOcppNativeChanges": 542
}
```

### 13.14 `MessageCodes`

```json
{ "Success": 0, "Error": 1, "Information": 2, "Warning": 3,
  "KnownErrors": 500, "UnknownObject": 501 }
```

### 13.15 `UserRoles` (bitmask, used in `CurrentUserRoles` field on installation/charger)

```json
{ "None": 0, "User": 1, "Owner": 2, "Maintainer": 4, "Administrator": 8,
  "Any": 15, "Onboarding": 16, "DeviceAdministrator": 32,
  "PartnerAdministrator": 64, "Technical": 128, "InternalData": 256 }
```

`Any = 15` is `User | Owner | Maintainer | Administrator`.

### 13.16 `Settings` map (writable observation IDs)

A subset of observations is writable via `POST /api/installation/{id}/update` or `POST /api/chargers/{id}/update`. The full list (39 entries):

```
AuthenticationRequired = 120     PaymentActive = 130
PaymentCurrency = 131            PaymentSessionUnitPrice = 132
PaymentEnergyUnitPrice = 133     PaymentTimeUnitPrice = 134
CommunicationMode = 150          PermanentCableLock = 151
HmiBrightness = 153              LockCableWhenConnected = 154
SoftStartDisabled = 155          MIDBlinkEnabled = 170
CurrentInMaximum = 510           CurrentInMinimum = 511
MaxPhases = 520                  DefaultOfflinePhase = 522
DefaultOfflineCurrent = 523      SignedMeterValueInterval = 555
IsEnabled = 711                  Standalone = 712
NetworkType = 715                AuthorizationTimeout = 719
TariffText = 720                 EnabledNfcTechnologies = 752
LteRoamingDisabled = 753         InstallationId = 800
RoutingId = 801                  ChargePointName = 802
DiagnosticsMode = 805            DisableBLEChargePointName = 806
```

### 13.17 `DeviceLogTypes`

```json
{
  "OcppIn": 0, "OcppOut": 1, "OcppError": 2, "OcppConnected": 3,
  "OcppConnectionFailed": 4, "OcppClientClose": 5,
  "IotCommandExecuted": 6, "IotCommandFailed": 7,
  "IotCloudSettingUpdated": 8, "SessionCommit": 9,
  "OfflineSessionCommit": 10, "AuthorizationRequest": 11,
  "AuthorizationSuccess": 12, "AuthorizationError": 13,
  "AuthorizationFailed": 14
}
```

### 13.18 `SessionCommitMetadata` (bitmask on `chargehistory.CommitMetadata`)

```json
{ "None": 0, "Online": 1, "Offline": 2, "ReliableClock": 4,
  "StoppedByRFID": 8, "Signed": 16, "Void": 32, "Aborted": 64,
  "OcppNative": 128 }
```

`CommitMetadata = 5` (observed on Festi 5's last session) decodes to `Online | ReliableClock` — session was committed while online with a synchronised clock.

### 13.19 `OcppCloudUrlVersions`

```json
{ "Legacy": 0, "Ocpp16Compliant": 1 }
```

### 13.20 `ObjectTypes`

```json
{ "Unknown": 0, "Installation": 1, "Circuit": 2, "Charger": 3,
  "User": 4, "UserGroup": 5, "InactiveUser": 6, "InvitedUser": 7,
  "Country": 8 }
```

### 13.21 `EntityTypes`

```json
{ "Unknown": 0, "Installation": 1, "Charger": 2 }
```

---

## 14. Worked end-to-end examples

All examples assume `ZAPTEC_USERNAME` and `ZAPTEC_PASSWORD` are set in the environment. Bearer tokens are stripped to `…`.

### 14.1 Authenticate

```sh
curl -s -X POST https://api.zaptec.com/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=password" \
  --data-urlencode "username=$ZAPTEC_USERNAME" \
  --data-urlencode "password=$ZAPTEC_PASSWORD" \
  --data-urlencode "scope=openid"
```

Response:
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "token_type": "bearer",
  "expires_in": 86399,
  "refresh_token": "…"
}
```

### 14.2 List installations

```sh
TOKEN="<access_token from 14.1>"
curl -s https://api.zaptec.com/api/installation \
  -H "Authorization: Bearer $TOKEN"
```

Response (envelope):
```jsonc
{
  "Pages": 1,
  "Data": [
    { "Id": "7d722149-3c5f-4488-8bf2-e660503e11e9",
      "Name": "Dalvegur 10 - 14",
      "Address": "Dalvegur 8 - 12",
      "City": "Kópavogur", "ZipCode": "200",
      "ActiveChargerCount": 20,
      "MaxCurrent": 100, "AvailableCurrent": 70,
      "OcppCloudUrl": "wss://straumvakt-ocpp.straumvakt.workers.dev/ocpp/ZAP257533",
      "MessagingEnabled": true,
      "AuthenticationType": 2,
      "NetworkType": 4,
      "AvailableFeatures": 183, "EnabledFeatures": 0,
      // ...50+ more fields...
    },
    { "Id": "fccccfac-b2c5-4273-9fd9-1e4ca64de8d6", "Name": "Dalvegur" }
  ]
}
```

### 14.3 List chargers in an installation

```sh
INST=7d722149-3c5f-4488-8bf2-e660503e11e9
curl -s "https://api.zaptec.com/api/chargers?InstallationId=$INST&PageSize=100" \
  -H "Authorization: Bearer $TOKEN"
```

Same envelope: `{ Pages, Data: [...] }`. Pagination params:

| Param | Default | Notes |
|---|---|---|
| `PageSize` | server default ≈ 50 | Max ~100 reliably |
| `PageIndex` | 0 | Zero-based |
| `SortProperty` | server default | E.g. `Name`, `CreatedOnDate` |
| `SortDescending` | false | Boolean |
| `IncludeDisabled` | false | |
| `NameFilter` | — | Server-side substring filter |
| `Roles` | — | Bitmask filter against `UserRoles` |
| `DeviceType` | — | Filter against `DeviceTypes` enum |
| `InstallationType` | — | `0 = Pro`, `1 = Smart` |
| `Exclude` | — | Array of charger UUIDs to exclude |

### 14.4 Read live state observations

```sh
CHARGER=03278fc6-ab76-47af-9ccc-b84e90e07284
curl -s "https://api.zaptec.com/api/chargers/$CHARGER/state" \
  -H "Authorization: Bearer $TOKEN"
```

Response is a flat array (no `Data` wrapper):
```json
[
  { "ChargerId": "03278fc6-…", "StateId": -3,
    "Timestamp": "2026-04-23T11:42:08.44", "ValueAsString": "1" },
  { "ChargerId": "03278fc6-…", "StateId": 501,
    "Timestamp": "2026-04-24T16:21:07.907", "ValueAsString": "0.6278" },
  // ...80 entries...
]
```

### 14.5 Charger detail

```sh
curl -s "https://api.zaptec.com/api/chargers/$CHARGER" \
  -H "Authorization: Bearer $TOKEN"
```

Returns ~30 fields including `SignedMeterValueKwh`, `SignedMeterValue` (the OCMF blob), `PropertyOcppUrl`, `PropertyAuthenticationDisabled`, `IsAuthorizationRequired`, `Pin`, `CircuitId`, `HasSessions`. **`OcppInitialChargePointPassword` may be present on this response — never display or log.**

### 14.6 Stop a session (OCPP-equivalent RemoteStopTransaction via REST)

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "https://api.zaptec.com/api/chargers/$CHARGER/sendCommand/506"
```

Body is empty. Response is empty `200 OK` on success, or `4xx` with an `ErrorCodes` envelope on failure.

### 14.7 Charge history (last 10 sessions for one charger)

```sh
curl -s "https://api.zaptec.com/api/chargehistory?ChargerId=$CHARGER&PageSize=10&SortProperty=StartDateTime&SortDescending=true" \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```jsonc
{
  "Pages": 438,
  "Data": [
    {
      "Id": "67ddc10b-9d7b-4cf7-ad3c-7424819997af",
      "ChargerId": "03278fc6-…", "DeviceId": "ZCS032822", "DeviceName": "Festi 5",
      "StartDateTime": "2026-04-24T12:35:49.197",
      "EndDateTime": "2026-04-24T16:21:07.057",
      "CommitEndDateTime": "2026-04-24T16:21:07.057",
      "Energy": 11.903,
      "CommitMetadata": 5,
      "ExternalId": "1410145234",
      "ExternallyEnded": true,
      "ChargerFirmwareVersion": { "Major": 3, "Minor": 2, "Build": 2, "Revision": 0,
                                   "MajorRevision": 0, "MinorRevision": 0 },
      "SignedSession": "OCMF|{\"FV\":\"1.0\",\"GI\":\"ZAPTEC PRO\",…}|<sig>"
    }
  ]
}
```

### 14.8 Firmware fleet status

```sh
curl -s "https://api.zaptec.com/api/chargerFirmware/installation/$INST" \
  -H "Authorization: Bearer $TOKEN"
```

Response is a flat array, one entry per charger:
```json
[
  { "ChargerId": "…", "DeviceId": "ZCS029369", "IsOnline": true,
    "CurrentVersion": "3.2.2.0", "AvailableVersion": "3.2.2.0",
    "DeviceType": 1, "IsUpToDate": true }
]
```

### 14.9 Real-time push credentials

```sh
curl -s "https://api.zaptec.com/api/installation/$INST/messagingConnectionDetails" \
  -H "Authorization: Bearer $TOKEN"
```

Response (**Password is a SAS token — server-side only**):
```json
{
  "Type": 0, "Host": "zap-p-installations-sbus.servicebus.windows.net",
  "Port": 5671, "UseSSL": true,
  "Username": "installation_<uuid>", "Password": "<SAS>",
  "Topic": "installation_<uuid>", "Subscription": "default"
}
```

---

## 15. Real-time push — Service Bus AMQP subscription details

The credentials returned in §14.9 plug into Azure Service Bus AMQP 1.0:

| Field | Use |
|---|---|
| Host | TLS endpoint `<host>:5671` |
| Username | SAS key name (e.g. `installation_<uuid>`) |
| Password | SAS token (URL-encoded, time-bound) |
| Topic | Subscription source path |
| Subscription | Per-subscriber path under the topic |

Subscriber pseudocode (using `rhea` or `azure-service-bus-amqp`):

```ts
const conn = createAmqpConnection({
  hostname: details.Host,
  port: details.Port,
  transport: "tls",
  username: details.Username,
  password: details.Password,
});
const receiver = conn.createReceiver({
  source: `${details.Topic}/Subscriptions/${details.Subscription}`,
});
receiver.on("message", (m) => {
  // m.body is JSON: { ChargerId, StateId, Timestamp, ValueAsString }
  // — same shape as one entry from /api/chargers/{id}/state
});
```

**Token rotation:** SAS tokens expire (typically 1–4 hours). Re-call `/messagingConnectionDetails` and reconnect when:
- The connection drops with `amqp:link:detach-forced`, OR
- 80% of the token's `expiresOn` has elapsed (parse the `se=` query param of the SAS).

---

## 16. Production-adapter checklist

Before turning a Zaptec adapter loose against a real fleet:

### 16.1 Authentication
- [ ] Bearer token cached in-process for ≥ 23 h; refresh proactively at the 23 h mark.
- [ ] On `401 Unauthorized`, re-run the password grant exactly once before bubbling the error.
- [ ] On `503 Service Temporarily Unavailable`, exponential backoff starting at 5 s, max 5 minutes, max 6 attempts.
- [ ] Log a structured event when `503` happens (it indicates rate-limiting upstream, not a hard error).

### 16.2 Pagination
- [ ] Always set explicit `PageSize` (don't rely on server default).
- [ ] Drive iteration by `Pages`; do not assume `TotalCount` is populated.
- [ ] When page count > 100, use `Exclude` rather than re-fetching to deduplicate.

### 16.3 Error envelope
- [ ] Parse JSON body even on `4xx`; the `ErrorCodes` enum (§13.13) maps to specific recovery paths:
  - `533 Forbidden` → user lacks role; surface to operator
  - `538 OperationFailedDueToChargerState` → retry after `StatusNotification` change
  - `534 InstallationTypeViolation` / `539 InstallationConstraintViolation` → schema validation failure; do not retry
  - `540 UnknownInstallationId` → bad reference; re-fetch installations list
  - `542 UnauthorizedToPerformOcppNativeChanges` → check `installation.AuthenticationType` first

### 16.4 State observation handling
- [ ] **Decode `Notifications` (803) and `Warnings` (804) with `BigInt`** — values exceed 2^32 (§13.11).
- [ ] Accept `CommunicationMode` (150) as either numeric or label form (§10.2).
- [ ] `UptimeVariscite` / `UptimeMCU` are decimal **hours** — multiply by 3600 to get seconds, do not multiply by 1000 (§10.3).
- [ ] `ValueAsString` may be empty `""` or absent — do not coerce empty to `0`; treat as "no reading".

### 16.5 OCPP-derived state
- [ ] Treat `IsOcppConnected` (-3) as the source of truth for "is the protocol up". `IsOnline` (-2) is the device-cloud reachability — they can disagree (e.g. if the OCPP gateway is down but the Zaptec reporting channel is up).
- [ ] **Re-read `OcppCloudUrl` every session** — it can change between sessions (see §10.4).
- [ ] When `AuthenticationType = 3` (OcppNative), expect `OcppNativeUrl` (861), `OcppNativeCbId` (862), and `OcppNativeConnected` (866) to be populated; if they're missing, the charger hasn't completed the OcppNative provisioning step.

### 16.6 OCMF
- [ ] Verify every `SignedMeterValue` and `SignedSession` against `MIDPublicKey` (981) — see [`ocmf.md`](ocmf.md) §6.
- [ ] Cache the public key per-charger in `assets.charger.metadata`; re-fetch only on firmware update or `MIDCalibration` change.
- [ ] **Never bill against an unsigned reading.** If verification fails, write to event log and escalate.

### 16.7 Idempotency
- [ ] All write endpoints (`POST /update`, `sendCommand/{id}`) are not idempotent. Wrap in an outbox pattern: persist the intent, dispatch with retries, mark complete on success.
- [ ] Use the V3 `events.idempotency_keys` table (scope = `vendor:zaptec`, key = `<charger>:<commandId>:<correlation-id>`).

### 16.8 Observability
- [ ] Tag every Zaptec HTTP call with `vendor=zaptec`, `endpoint=<path>`, `installationId=<id>` for log-aggregation grouping.
- [ ] Track p50/p95 latency per endpoint; Zaptec's `/state` is reliably ~400 ms, `/chargehistory` ~600 ms, `/oauth/token` ~200 ms. Significant deviation = upstream incident.
- [ ] Emit `vendors.adapter_health` rows on a 1-min window with error rate + p95.
- [ ] Run nightly contract tests (`vendors.contract_tests`) against `/api/constants` — alert if the enum diff is non-empty (Zaptec ships breaking changes here).

### 16.9 Secret hygiene
- [ ] Zaptec credentials live in Cloudflare secrets / 1Password; never in `wrangler.jsonc`, never in repo.
- [ ] **`OcppInitialChargePointPassword` is in the API response envelope** — strip before logging or storing.
- [ ] Service Bus `Password` (SAS) is short-lived; do not persist beyond the live worker invocation.
- [ ] `MIDPublicKey` is non-secret but `MIDPrivateKey` is **never** exposed by the API — it lives only in the meter's HSM.

---

## 17. Reference TypeScript shapes

Drop into `src/lib/vendors/zaptec/types.ts`:

```ts
// ── Auth ────────────────────────────────────────────────────────────────
export type ZaptecToken = {
  access_token: string;
  refresh_token?: string;
  token_type: "bearer";
  expires_in: number;
};

// ── Installation ────────────────────────────────────────────────────────
export type Installation = {
  Id: string;
  Name?: string;
  Address?: string;
  City?: string;
  ZipCode?: string;
  CountryId?: string;
  ActiveChargerCount?: number;
  MaxCurrent?: number;
  AvailableCurrent?: number;
  AvailableCurrentPhase1?: number;
  AvailableCurrentPhase2?: number;
  AvailableCurrentPhase3?: number;
  AvailableCurrentMode?: number;
  AvailableCurrentScheduleWeekendActive?: boolean;
  ThreeToOnePhaseSwitchCurrent?: number;
  DefaultThreeToOneSwitchCurrent?: number;
  InstallationType?: 0 | 1;
  InstallationCategory?: string;
  InstallationCategoryId?: string;
  UseLoadBalancing?: boolean;
  IsRequiredAuthentication?: boolean;
  Latitude?: number;
  Longitude?: number;
  NetworkType?: 0 | 1 | 2 | 3 | 4;
  Active?: boolean;
  AuthenticationType?: 0 | 1 | 2 | 3;
  MessagingEnabled?: boolean;
  RoutingId?: string;
  OcppCloudUrl?: string;
  OcppCloudUrlVersion?: 0 | 1;
  OcppInitialChargePointPassword?: string; // SECRET — strip
  TimeZoneName?: string;
  TimeZoneIanaName?: string;
  AvailableFeatures?: number;
  EnabledFeatures?: number;
  Feature_PowerManagement_EcoMode_DepartureTime?: number;
  Feature_PowerManagement_EcoMode_MinEnergy?: number;
  Feature_PowerManagement_EcoMode_DeliveryArea?: number;
  PropertyMainFuseCurrent?: number;
  PropertyOcppDefaultIdTag?: string;
  PropertyEnergySensorUniqueId?: string;
  PropertyEnergySensorRippleEnabled?: boolean;
  PropertyEnergySensorRippleNumBits?: number;
  PropertyFirmwareAutomaticUpdates?: boolean;
  PropertyOfflineModeAllowAnonymous?: boolean;
  PropertyIsMinimumPowerOfflineMode?: boolean;
  PropertySessionMaxStopCount?: number;
  AvailableInternetAccessPLC?: boolean;
  AvailableInternetAccessWiFi?: boolean;
  SurplusMode?: { Active?: boolean };
  CreatedOnDate?: string;
  UpdatedOn?: string;
};

// ── Charger ─────────────────────────────────────────────────────────────
export type Charger = {
  Id: string;
  Name: string;
  SerialNo?: string;
  DeviceId?: string;
  MID?: string;
  IsOnline?: boolean;
  Active?: boolean;
  DeviceType?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  CircuitId?: string;
  InstallationId?: string;
  InstallationName?: string;
  AuthenticationType?: 0 | 1 | 2 | 3;
  IsAuthorizationRequired?: boolean;
  PropertyAuthenticationDisabled?: boolean;
  PropertyOcppUrl?: string;
  PropertyOcppDefaultIdTag?: string;
  PropertyOfflinePhaseOverride?: number;
  PropertyPinOfflinePhase?: boolean;
  Pin?: string;
  HasSessions?: boolean;
  OperatingMode?: number;
  SignedMeterValueKwh?: number;
  SignedMeterValue?: string; // OCMF envelope (lifetime)
  CurrentUserRoles?: number;
  CreatedOnDate?: string;
  UpdatedOn?: string;
};

// ── State observation ───────────────────────────────────────────────────
export type StateObservation = {
  ChargerId: string;
  StateId: number;
  Timestamp?: string;
  ValueAsString?: string;
};

// ── Hierarchy (installation/{id}/hierarchy) ─────────────────────────────
export type HierarchyCharger = {
  Id: string;
  Name?: string;
  DeviceId?: string;
  SerialNo?: string;
  MID?: string;
  Active?: boolean;
  DeviceType?: number;
};
export type HierarchyCircuit = {
  Id: string;
  Name?: string;
  MaxCurrent?: number;
  IsActive?: boolean;
  InstallationId: string;
  InstallationName?: string;
  Chargers?: HierarchyCharger[];
};
export type Hierarchy = {
  Id: string;
  Name?: string;
  NetworkType?: number;
  Circuits?: HierarchyCircuit[];
};

// ── Charge history ──────────────────────────────────────────────────────
export type ChargeHistoryEntry = {
  Id: string;
  ChargerId: string;
  DeviceId?: string;
  DeviceName?: string;
  StartDateTime: string;
  EndDateTime?: string;
  CommitEndDateTime?: string;
  Energy: number;        // kWh
  CommitMetadata?: number; // bitmask, see §13.18
  ExternalId?: string;
  ExternallyEnded?: boolean;
  ChargerFirmwareVersion?: {
    Major: number; Minor: number; Build: number; Revision: number;
    MajorRevision: number; MinorRevision: number;
  };
  SignedSession?: string;  // OCMF envelope (T<n> pagination)
};

// ── Firmware ────────────────────────────────────────────────────────────
export type ChargerFirmwareEntry = {
  ChargerId: string;
  DeviceId?: string;
  IsOnline?: boolean;
  CurrentVersion?: string;
  AvailableVersion?: string;
  DeviceType?: number;
  IsUpToDate?: boolean;
};

// ── Messaging ───────────────────────────────────────────────────────────
export type MessagingConnectionDetails = {
  Type: number;
  Host: string;
  Port: number;
  UseSSL: boolean;
  Username: string;
  Password: string;  // SAS — SECRET
  Topic: string;
  Subscription: string;
};

// ── Error envelope ──────────────────────────────────────────────────────
export type ZaptecError = {
  code?: number;        // matches ErrorCodes enum (§13.13)
  message?: string;
  details?: unknown;
};
```

---

## 18. Reference paginated-fetch helper

```ts
async function* listPaginated<T>(
  fetchPage: (page: number) => Promise<{ Pages: number; Data: T[] }>,
): AsyncGenerator<T> {
  let page = 0;
  while (true) {
    const res = await fetchPage(page);
    for (const item of res.Data) yield item;
    if (++page >= res.Pages) return;
  }
}

// Usage:
for await (const session of listPaginated((p) =>
  fetch(`/api/chargehistory?ChargerId=${id}&PageIndex=${p}&PageSize=100`)
    .then((r) => r.json())
)) {
  await persistSession(session);
}
```

