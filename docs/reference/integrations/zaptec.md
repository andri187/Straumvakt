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

## 11. Sources

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

## 12. Companion artifacts

| File | Where | Purpose |
|---|---|---|
| `zaptec-test/zaptec-constants.json` | `E:\Claude\zaptec-test\` (scratch app) | Cached `/api/constants` response. Treat as read-only reference. |
| `zaptec-test/openapi.json` | `E:\Claude\zaptec-test\` (scratch app) | Cached OpenAPI v1 spec. |
| `zaptec-test/src/lib/zaptec.ts` | scratch app | Reference implementation of every endpoint listed in §3 + types. |
| `zaptec-test/src/lib/zaptec-state.ts` | scratch app | Authoritative ID → name → group map, plus operation-mode + network-type decoders. |
| `zaptec-test/src/lib/zaptec-enums.ts` | scratch app | SmartWarnings + Features bitmask decoders, comm-mode + uptime + cable-type formatters. |
| `zaptec-test/src/lib/ocpp.ts` | scratch app | OCPP types + the 38-key standard config catalogue + 28-message vocabulary + 15-action transport-tagged catalogue. |

The scratch app is the intended source of truth for the production Zaptec adapter; it has been reverse-engineered against live chargers and corrects several published mistakes (§10).
