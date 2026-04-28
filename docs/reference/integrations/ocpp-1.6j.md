# OCPP 1.6J — protocol reference (vendor-agnostic)

**Status:** reference data, not schema. Distilled from the OCPP 1.6 Edition 2 specification (Open Charge Alliance) and observed implementation behavior on Zaptec Pro and Easee Charge.
**Last verified:** 2026-04-26.
**Primary use:** shared protocol details that both [`zaptec.md`](zaptec.md) and [`easee.md`](easee.md) build on. Anywhere a vendor doc says "OCPP 1.6J" without further qualification, this file is what they mean.

> [!IMPORTANT]
> The **canonical specification document** is *OCPP 1.6 Edition 2 — JSON over WebSocket Implementation Guide* from the Open Charge Alliance (OCA). This file is a working reference, not a substitute. Implementers must read the official OCPP spec for binding semantics — particularly around state-machine timing, security, and message-flow obligations.

---

## 1. Transport

OCPP 1.6J is JSON-over-WebSocket. Each charge point opens **one** WebSocket connection to the CSMS:

```
wss://<csms-host>/<base-path>/<chargePointId>
```

- **Subprotocol header:** `Sec-WebSocket-Protocol: ocpp1.6` — required. The server must echo it. If it doesn't, the client closes.
- **Path tail = chargePointId.** This is the OCPP identity (e.g. `ZAP257533` for the Zaptec installation in our live test). It's the same string that appears as `chargeBoxId` in BootNotification.
- **Authentication:** HTTP Basic Auth in the upgrade request (configured per-CP, optional). Bearer / mTLS profiles are vendor extensions beyond 1.6J spec.
- **Ping / pong:** OCPP keeps the connection alive via WebSocket ping frames. Application-level `Heartbeat` is a separate, slower beat (interval set by the `HeartbeatInterval` config key, default 60 s).

## 2. Message framing — JSON-RPC over WebSocket

Every OCPP frame is a **single-element JSON array** with a leading message-type indicator (MTI):

| MTI | Meaning | Shape |
|---|---|---|
| `2` | CALL (request) | `[2, "<callId>", "<Action>", { …payload }]` |
| `3` | CALLRESULT (success response) | `[3, "<callId>", { …payload }]` |
| `4` | CALLERROR (error response) | `[4, "<callId>", "<errorCode>", "<errorDescription>", { …details }]` |

`<callId>` is a UUID-style string set by the *requester*; the responder echoes it. Charge points and the CSMS each maintain their own ID space.

### 2.1 CALLERROR codes (OCPP 1.6 spec § 4.2.3)

| Code | When to use |
|---|---|
| `NotImplemented` | Action is not implemented at all |
| `NotSupported` | Action recognized but not supported in this state |
| `InternalError` | Internal failure with no more specific code |
| `ProtocolError` | Payload doesn't conform to the spec |
| `SecurityError` | Authentication / authorization issue |
| `FormationViolation` | Payload syntactically wrong |
| `PropertyConstraintViolation` | A field's value violates spec constraints |
| `OccurenceConstraintViolation` | Cardinality violated (typo `Occurrence` is in the spec) |
| `TypeConstraintViolation` | Field has wrong type |
| `GenericError` | Catch-all |

### 2.2 Timeouts and retransmission

- **CALL → response:** the requester waits up to a configurable timeout (typical 30 s). If no CALLRESULT or CALLERROR arrives, the CALL is considered failed.
- **TransactionMessageAttempts** (config key) controls how many times the CP re-sends a transaction-related CALL on failure.
- **TransactionMessageRetryInterval** (config key) is the backoff between attempts.
- **WebSocketPingInterval** (config key) controls the WebSocket-level ping. Setting to `0` disables.

---

## 3. The 28 OCPP 1.6J actions

Direction column: `CP→CS` means the charge point initiates, `CS→CP` means the CSMS initiates.

### 3.1 CP→CS actions (charger reports to the central system)

| Action | When | Payload sketch |
|---|---|---|
| `Authorize` | Driver presents an idTag | `{ idTag }` → `{ idTagInfo }` |
| `BootNotification` | On boot or reconnect | `{ chargePointVendor, chargePointModel, chargePointSerialNumber?, chargeBoxSerialNumber?, firmwareVersion?, iccid?, imsi?, meterType?, meterSerialNumber? }` → `{ status: "Accepted"\|"Pending"\|"Rejected", currentTime, interval }` |
| `DataTransfer` | Vendor-specific exchange | `{ vendorId, messageId?, data? }` → `{ status: "Accepted"\|"Rejected"\|"UnknownMessageId"\|"UnknownVendorId", data? }` |
| `DiagnosticsStatusNotification` | Log upload status update | `{ status: "Idle"\|"Uploaded"\|"UploadFailed"\|"Uploading" }` |
| `FirmwareStatusNotification` | Firmware operation status | `{ status: "Downloaded"\|"DownloadFailed"\|"Downloading"\|"Idle"\|"InstallationFailed"\|"Installing"\|"Installed" }` |
| `Heartbeat` | Periodic keep-alive | `{}` → `{ currentTime }` |
| `MeterValues` | Periodic / event meter samples | `{ connectorId, transactionId?, meterValue: [{ timestamp, sampledValue: [{value, context?, format?, measurand?, phase?, location?, unit?}] }] }` |
| `StartTransaction` | Session begins | `{ connectorId, idTag, meterStart, reservationId?, timestamp }` → `{ idTagInfo, transactionId }` |
| `StatusNotification` | Connector state change | `{ connectorId, errorCode, status, info?, timestamp?, vendorId?, vendorErrorCode? }` |
| `StopTransaction` | Session ends | `{ idTag?, meterStop, timestamp, transactionId, reason?, transactionData? }` → `{ idTagInfo? }` |

### 3.2 CS→CP actions (central system commands the charger)

| Action | Effect | Payload sketch |
|---|---|---|
| `CancelReservation` | Drop a reservation | `{ reservationId }` → `{ status: "Accepted"\|"Rejected" }` |
| `ChangeAvailability` | Operate / suspend a connector or whole CP | `{ connectorId, type: "Inoperative"\|"Operative" }` → `{ status: "Accepted"\|"Rejected"\|"Scheduled" }` |
| `ChangeConfiguration` | Write one config key | `{ key, value }` → `{ status: "Accepted"\|"Rejected"\|"RebootRequired"\|"NotSupported" }` |
| `ClearCache` | Drop locally cached idTag decisions | `{}` → `{ status: "Accepted"\|"Rejected" }` |
| `ClearChargingProfile` | Remove a smart-charging profile | `{ id?, connectorId?, chargingProfilePurpose?, stackLevel? }` → `{ status: "Accepted"\|"Unknown" }` |
| `DataTransfer` | Vendor-specific exchange | (same shape as CP→CS) |
| `GetCompositeSchedule` | Compute resulting schedule from stacked profiles | `{ connectorId, duration, chargingRateUnit? }` → `{ status, connectorId?, scheduleStart?, chargingSchedule? }` |
| `GetConfiguration` | Read config keys | `{ key?: string[] }` → `{ configurationKey?: [{key, readonly, value?}], unknownKey?: string[] }` |
| `GetDiagnostics` | Request log upload | `{ location, retries?, retryInterval?, startTime?, stopTime? }` → `{ fileName? }` |
| `GetLocalListVersion` | Read local auth list version | `{}` → `{ listVersion }` |
| `RemoteStartTransaction` | Begin a session remotely | `{ connectorId?, idTag, chargingProfile? }` → `{ status: "Accepted"\|"Rejected" }` |
| `RemoteStopTransaction` | End a session remotely | `{ transactionId }` → `{ status: "Accepted"\|"Rejected" }` |
| `ReserveNow` | Reserve a connector for an idTag | `{ connectorId, expiryDate, idTag, parentIdTag?, reservationId }` → `{ status: "Accepted"\|"Faulted"\|"Occupied"\|"Rejected"\|"Unavailable" }` |
| `Reset` | Reboot the charger | `{ type: "Hard"\|"Soft" }` → `{ status: "Accepted"\|"Rejected" }` |
| `SendLocalList` | Push idTag whitelist update | `{ listVersion, localAuthorizationList?: [{idTag, idTagInfo?}], updateType: "Differential"\|"Full" }` → `{ status: "Accepted"\|"Failed"\|"NotSupported"\|"VersionMismatch" }` |
| `SetChargingProfile` | Apply a smart-charging schedule | `{ connectorId, csChargingProfiles: { chargingProfileId, transactionId?, stackLevel, chargingProfilePurpose, chargingProfileKind, recurrencyKind?, validFrom?, validTo?, chargingSchedule } }` → `{ status: "Accepted"\|"Rejected"\|"NotSupported" }` |
| `TriggerMessage` | Ask the CP to re-send a message | `{ requestedMessage: "BootNotification"\|"DiagnosticsStatusNotification"\|"FirmwareStatusNotification"\|"Heartbeat"\|"MeterValues"\|"StatusNotification", connectorId? }` → `{ status: "Accepted"\|"Rejected"\|"NotImplemented" }` |
| `UnlockConnector` | Release the cable lock motor | `{ connectorId }` → `{ status: "Unlocked"\|"UnlockFailed"\|"NotSupported" }` |
| `UpdateFirmware` | Schedule firmware download | `{ location, retrieveDate, retries?, retryInterval? }` → `{}` |

---

## 4. Connector status enumerations

### 4.1 `ConnectorStatus` (OCPP 1.6 § 4.9)

| Value | Meaning |
|---|---|
| `Available` | Idle, ready to accept a session |
| `Preparing` | Cable plugged, waiting for auth or for EV |
| `Charging` | Energy flowing |
| `SuspendedEVSE` | Charger paused (e.g. DLB throttling to zero, or operator pause) |
| `SuspendedEV` | EV asked to stop drawing |
| `Finishing` | Session ended, cable still locked / connected |
| `Reserved` | Reserved via `ReserveNow` |
| `Unavailable` | Operator marked Inoperative via `ChangeAvailability` |
| `Faulted` | Fault reported via `errorCode` |

### 4.2 `errorCode` (sent in `StatusNotification`)

| Code | Cause |
|---|---|
| `ConnectorLockFailure` | Cable lock motor failed |
| `EVCommunicationError` | CP↔EV pilot signal error |
| `GroundFailure` | RCD trip (ground/earth fault) |
| `HighTemperature` | Internal temp threshold exceeded |
| `InternalError` | Unspecified internal fault |
| `LocalListConflict` | Local auth list version conflict |
| `NoError` | No fault |
| `OtherError` | Unspecified |
| `OverCurrentFailure` | Overcurrent trip |
| `PowerMeterFailure` | E-meter fault |
| `PowerSwitchFailure` | Relay fault (often welded contacts) |
| `ReaderFailure` | RFID reader fault |
| `ResetFailure` | Reset attempt failed |
| `UnderVoltage` | Mains too low |
| `OverVoltage` | Mains too high |
| `WeakSignal` | Cellular / Wi-Fi signal too weak |

### 4.3 `idTagInfo` returned by `Authorize`, `StartTransaction`, `SendLocalList`

| Field | Type | Notes |
|---|---|---|
| `expiryDate` | datetime | When the idTag becomes invalid |
| `parentIdTag` | string | Group an idTag belongs to (vehicle fleet, family, etc.) |
| `status` | enum: `Accepted` / `Blocked` / `Expired` / `Invalid` / `ConcurrentTx` | Auth result |

---

## 5. Standard configuration keys (OCPP 1.6 Appendix B)

These are the **38 standard** keys every compliant CP must support (some can be read-only). Vendors add their own keys on top. Read via `GetConfiguration`, write via `ChangeConfiguration`. **All values transit as strings on the wire**, even when typed (boolean / integer / CSL).

### 5.1 Core profile

| Key | Type | Default (Zaptec Go/Go2) | Description |
|---|---|---|---|
| `AllowOfflineTxForUnknownId` | boolean | false | Allow tx for unknown idTag while offline |
| `AuthorizationCacheEnabled` | boolean | false | Cache CSMS auth decisions locally |
| `AuthorizeRemoteTxRequests` | boolean | true | Require Authorize for `RemoteStartTransaction` |
| `BlinkRepeat` | integer | — | LED blink count for visual confirms |
| `ClockAlignedDataInterval` | integer (s) | 0 | Wall-clock-aligned MeterValues period (`0` = off) |
| `ConnectionTimeOut` | integer (s) | — | Auth → plug-in window before timeout |
| `ConnectorPhaseRotation` | CSL | — | Phase rotation per connector, e.g. `0.RST,1.RST` |
| `ConnectorPhaseRotationMaxLength` | integer (RO) | — | Max length of `ConnectorPhaseRotation` |
| `GetConfigurationMaxKeys` | integer (RO) | — | Max keys per `GetConfiguration` request |
| `HeartbeatInterval` | integer (s) | 60 | Heartbeat period when no other traffic |
| `LightIntensity` | integer (%) | — | Indicator LED brightness |
| `LocalAuthorizeOffline` | boolean | true | Use local list when offline |
| `LocalPreAuthorize` | boolean | false | Skip Authorize when idTag is in local list |
| `MaxEnergyOnInvalidId` | integer (Wh) | — | Allow N Wh after invalid idTag detected |
| `MeterValuesAlignedData` | CSL | — | Measurands sampled on clock-align |
| `MeterValuesAlignedDataMaxLength` | integer (RO) | — | Max measurands in aligned MeterValues |
| `MeterValuesSampledData` | CSL | — | Measurands sampled per interval |
| `MeterValuesSampledDataMaxLength` | integer (RO) | — | Max measurands in sampled MeterValues |
| `MeterValueSampleInterval` | integer (s) | — | MeterValues sampling period (`0` = off) |
| `MinimumStatusDuration` | integer (s) | — | Debounce StatusNotification |
| `NumberOfConnectors` | integer (RO) | — | Physical connector count |
| `ResetRetries` | integer | — | Reset attempts before giving up |
| `StopTransactionOnEVSideDisconnect` | boolean | true | Stop tx when cable yanked |
| `StopTransactionOnInvalidId` | boolean | true | Stop tx when idTag becomes invalid |
| `StopTxnAlignedData` | CSL | — | Measurands in StopTransaction (aligned) |
| `StopTxnAlignedDataMaxLength` | integer (RO) | — | Max measurands aligned at stop |
| `StopTxnSampledData` | CSL | — | Measurands in StopTransaction (sampled) |
| `StopTxnSampledDataMaxLength` | integer (RO) | — | Max measurands sampled at stop |
| `SupportedFeatureProfiles` | CSL (RO) | — | Profiles implemented (`Core`, `FirmwareManagement`, `LocalAuthListManagement`, `Reservation`, `SmartCharging`, `RemoteTrigger`) |
| `SupportedFeatureProfilesMaxLength` | integer (RO) | — | Max profiles |
| `TransactionMessageAttempts` | integer | — | Max retries for transaction-related messages |
| `TransactionMessageRetryInterval` | integer (s) | — | Retry backoff |
| `UnlockConnectorOnEVSideDisconnect` | boolean | — | Auto-unlock when EV unplugged |
| `WebSocketPingInterval` | integer (s) | — | WS ping interval (`0` = off) |

### 5.2 LocalAuthListManagement profile

| Key | Type | Default | Description |
|---|---|---|---|
| `LocalAuthListEnabled` | boolean | true | Enable local auth list |
| `LocalAuthListMaxLength` | integer (RO) | 1024 | Max entries in local list |
| `SendLocalListMaxLength` | integer (RO) | 255 | Max entries per `SendLocalList` chunk |

### 5.3 Reservation profile

| Key | Type | Default | Description |
|---|---|---|---|
| `ReserveConnectorZeroSupported` | boolean (RO) | — | Whether connector 0 (whole CP) is reservable |

### 5.4 SmartCharging profile

| Key | Type | Default | Description |
|---|---|---|---|
| `ChargeProfileMaxStackLevel` | integer (RO) | — | Max stack level for charging profiles |
| `ChargingScheduleAllowedChargingRateUnit` | CSL (RO) | — | `A` and/or `W` |
| `ChargingScheduleMaxPeriods` | integer (RO) | — | Max periods per schedule |
| `ConnectorSwitch3to1PhaseSupported` | boolean (RO) | — | Auto 3→1 phase switching supported |
| `MaxChargingProfilesInstalled` | integer (RO) | — | Concurrent profiles |

---

## 6. Sampled MeterValues — measurand vocabulary (§ 5.1.5)

Each entry inside `MeterValues.meterValue[].sampledValue[]` carries a tuple of:

```
(value, context?, format?, measurand?, phase?, location?, unit?)
```

| Measurand | Unit | Notes |
|---|---|---|
| `Energy.Active.Export.Register` | Wh / kWh | Cumulative V2G — rare on AC |
| `Energy.Active.Import.Register` | Wh / kWh | **Cumulative grid import — the canonical billing meter** |
| `Energy.Reactive.Export.Register` | varh / kvarh | |
| `Energy.Reactive.Import.Register` | varh / kvarh | |
| `Energy.Active.Export.Interval` | Wh / kWh | Per-interval delta |
| `Energy.Active.Import.Interval` | Wh / kWh | Per-interval delta (session energy) |
| `Energy.Reactive.Export.Interval` | varh / kvarh | |
| `Energy.Reactive.Import.Interval` | varh / kvarh | |
| `Frequency` | Hz | Mains frequency |
| `Power.Active.Export` | W / kW | Live export |
| `Power.Active.Import` | W / kW | **Live import — the canonical "kW now"** |
| `Power.Factor` | (unitless) | cos φ |
| `Power.Offered` | W / kW | Charger's offer to the EV |
| `Power.Reactive.Export` | var / kvar | |
| `Power.Reactive.Import` | var / kvar | |
| `RPM` | RPM | Cooling fans (rare) |
| `SoC` | Percent | Only when EV reports state-of-charge |
| `Temperature` | Celsius / Fahrenheit | Internal sensor |
| `Voltage` | V | RMS |
| `Current.Export` | A | |
| `Current.Import` | A | **Live import — the canonical "A per phase"** |
| `Current.Offered` | A | Allocated current after DLB |

**`context`** values:
- `Interruption.Begin` / `Interruption.End` — supply interruption boundaries
- `Other`
- `Sample.Clock` — clock-aligned sample
- `Sample.Periodic` — interval-driven sample
- `Transaction.Begin` / `Transaction.End` — start / stop of session
- `Trigger` — response to `TriggerMessage`

**`format`** values:
- `Raw` — plain string number
- `SignedData` — OCMF / EDL40 / similar signed envelope (see [`ocmf.md`](ocmf.md))

**`phase`** values: `L1`, `L2`, `L3`, `N`, `L1-N`, `L2-N`, `L3-N`, `L1-L2`, `L2-L3`, `L3-L1`.

**`location`** values: `Cable`, `EV`, `Inlet`, `Outlet`, `Body`.

---

## 7. Charging profiles (smart charging)

A charging profile is a stack-level-prioritized schedule that limits available current or power. Three **purposes**:

| Purpose | Scope |
|---|---|
| `ChargePointMaxProfile` | Whole CP (operator-level cap) |
| `TxDefaultProfile` | Default for any new transaction on the CP |
| `TxProfile` | Active transaction only (overrides defaults) |

**Stack level**: higher number wins when profiles overlap. The composite is computed via `GetCompositeSchedule`.

Three **kinds**:

| Kind | Schedule reference |
|---|---|
| `Absolute` | `startSchedule` is a wall-clock timestamp |
| `Recurring` | `recurrencyKind = Daily \| Weekly` |
| `Relative` | Schedule is relative to start of current transaction |

A `chargingSchedule` carries `chargingRateUnit` (`A` or `W`) and a list of `period` entries: `{startPeriod (seconds offset), limit, numberPhases?}`.

---

## 8. State machine — typical session flow

```
                                 ┌─ TriggerMessage ─┐
CSMS                             │                  │
 │                               ▼                  │
 │   BootNotification ◀──────  CP boot              │
 │   ──── (Accepted) ─────▶                         │
 │                                                  │
 │   Heartbeat ◀── every HeartbeatInterval ──────────│
 │   ──── (currentTime) ─▶                          │
 │                                                  │
 │   StatusNotification ◀──── connector state change ─
 │   ──── (ack)        ─▶                           │
 │                                                  │
 │   Authorize ◀────── card tapped ─────             │
 │   ──── (idTagInfo)  ─▶                            │
 │                                                  │
 │   StartTransaction ◀──── session begins ─        │
 │   ──── (transactionId) ─▶                        │
 │                                                  │
 │   MeterValues ◀── every MeterValueSampleInterval ─│
 │   ──── (ack)  ─▶                                 │
 │                                                  │
 │   StopTransaction ◀── session ends ──            │
 │   ──── (idTagInfo?) ─▶                           │
 │                                                  │
 │   ─── RemoteStartTransaction ─▶                  │
 │   ◀── (Accepted)                                 │
 │                                                  │
 │   ─── ChangeConfiguration ──▶                    │
 │   ◀── (Accepted/RebootRequired)                  │
 │                                                  │
 │   ─── Reset(Hard) ─▶                             │
 │   ◀── (Accepted)                                 │
 │   (CP closes WS, reboots, reconnects with        │
 │    a new BootNotification)                       │
```

A connector's status follows: `Available → Preparing → Charging → SuspendedEV/SuspendedEVSE → Charging → Finishing → Available`. Edge cases (Reserved, Unavailable, Faulted) interrupt at any point.

---

## 9. Local Auth List — synchronization protocol

Goal: every charge point holds an up-to-date local copy of the operator's idTag whitelist so it can authorize taps without a CSMS round-trip (especially when offline).

### 9.1 Sync sequence

```
CSMS                                 CP
 │                                    │
 │   GetLocalListVersion ─────────▶   │
 │ ◀── { listVersion: 0 }              │
 │                                    │
 │   SendLocalList                    │
 │     { listVersion: 1,              │
 │       updateType: "Full",          │
 │       localAuthorizationList: [    │
 │         { idTag: "EE43C609263CC7", │
 │           idTagInfo: {             │
 │             status: "Accepted",    │
 │             expiryDate: "2027-..." │
 │           } }, ... ] } ─────────▶  │
 │ ◀── { status: "Accepted" }          │
 │                                    │
 │   ... later, append/replace ...    │
 │   SendLocalList                    │
 │     { listVersion: 2,              │
 │       updateType: "Differential",  │
 │       localAuthorizationList: [    │
 │         { idTag: "REVOKEDCARD",    │
 │           idTagInfo: {             │
 │             status: "Blocked"      │
 │           } } ] } ──────────────▶  │
 │ ◀── { status: "Accepted" }          │
```

### 9.2 Online vs offline behavior

| State | Config | Behavior |
|---|---|---|
| Online + `LocalPreAuthorize=false` (default) | — | Charger always sends `Authorize` to CSMS |
| Online + `LocalPreAuthorize=true` | — | Charger short-circuits via local list |
| Offline + `LocalAuthorizeOffline=true` (default) | — | Charger consults local list |
| Offline + `LocalAuthorizeOffline=true` + `AllowOfflineTxForUnknownId=true` | — | Unknown idTags allowed |
| Offline + `LocalAuthorizeOffline=true` + `AllowOfflineTxForUnknownId=false` (default) | — | Unknown idTags denied |
| Offline + `LocalAuthorizeOffline=false` | — | All taps denied while offline |

### 9.3 `idTagInfo.status` values

| Value | Effect |
|---|---|
| `Accepted` | Tap allowed |
| `Blocked` | Tap denied; user is on a blocklist |
| `Expired` | Tap denied; expiry date passed |
| `Invalid` | Tap denied; idTag not recognized |
| `ConcurrentTx` | Tap denied; idTag already has an active transaction elsewhere |

When `StopTransactionOnInvalidId=true`, the running tx is terminated when the CSMS later returns one of `Blocked` / `Expired` / `Invalid` for the active idTag.

---

## 10. Vendor extension points

Two mechanisms allow vendors to extend the protocol without breaking spec compliance:

### 10.1 `DataTransfer`

```jsonc
[2, "<callId>", "DataTransfer", {
  "vendorId": "<vendor-uri-or-name>",
  "messageId": "<vendor-defined-id>",
  "data": "<vendor-payload>"
}]
```

Used for vendor-proprietary commands and observations. Both Zaptec and Easee use `DataTransfer` for things outside the OCPP 1.6 vocabulary (e.g. `OcppTunnelMessage` on Zaptec, command 752).

### 10.2 Custom configuration keys

Any key returned by `GetConfiguration` that isn't in §5 is a vendor extension. Both Zaptec and Easee publish their full key catalogue in vendor docs (linked from the respective vendor reference files).

---

## 11. Security — OCPP 1.6 Security Whitepaper profiles

OCPP 1.6 itself is bare; the OCA published a Security Whitepaper defining three profiles:

| Profile | Auth | Channel security | Notes |
|---|---|---|---|
| 1 | HTTP Basic Auth | TLS 1.2+ | Most common in 2026; simplest deployment |
| 2 | TLS client certificate | TLS 1.2+ mutual | Requires PKI |
| 3 | TLS client certificate + Security profile 3 (CertificateSigned messages) | TLS 1.2+ mutual + cert signing | Highest assurance; rare in AC fleets |

Zaptec's `straumvakt-ocpp` worker uses Profile 1 (Bearer / SAS-style auth in the upgrade request).

---

## 12. Common pitfalls

1. **Subprotocol header is mandatory.** Servers that don't echo `Sec-WebSocket-Protocol: ocpp1.6` cause clients to disconnect with no useful error. Worker-side: always set the `Sec-WebSocket-Protocol` response header.
2. **`callId` must be a string.** Some implementations send integers; spec requires string. Use crypto-random values.
3. **`MeterValues` `value` is a string.** The numeric measurand is encoded as a string in JSON. Parsers must convert.
4. **`status` enums are case-sensitive.** `accepted` ≠ `Accepted`; the spec is PascalCase.
5. **`StopTransaction.transactionData` may carry large signed envelopes** (OCMF / EDL40). Don't truncate; some integrators have lost legally-required signed receipts to message-size limits.
6. **`HeartbeatInterval` reset on `BootNotification.Accepted`.** The CSMS's response includes the current interval, overriding the CP's prior config.
7. **`reservationId` on `StartTransaction`** correlates a session to a prior `ReserveNow`. If you orchestrate reservations, plumb this through.
8. **`ChangeConfiguration.RebootRequired`** is a real return code — the operator must `Reset(Hard)` after writing certain keys for the change to take effect. Document which keys need reboots in your runbook.
9. **`UnlockConnector` returns `UnlockFailed`** when the cable is currently energized — stop the transaction first.
10. **`ClearCache` is not idempotent in subtle ways**: the local list survives but the cache (different store) is wiped. Don't rely on it to revoke a single idTag.

---

## 13. References

- [OCPP 1.6 Specification (Open Charge Alliance)](https://www.openchargealliance.org/protocols/ocpp-16/) — canonical document.
- [OCPP 1.6 JSON Implementation Guide](https://www.openchargealliance.org/protocols/ocpp-16/) — JSON-RPC framing details.
- [OCPP 1.6 Security Whitepaper Edition 3](https://www.openchargealliance.org/protocols/ocpp-16/) — three security profiles.
- [Zaptec OCPP 1.6J overview](https://docs.zaptec.com/docs/ocpp16j) — vendor implementation notes.
- [Zaptec Go/Go2 supported config keys](https://docs.zaptec.com/docs/zaptec-go2-ocpp-16j-supported-configuration-keys) — Zaptec's per-key compliance list.
- [Easee OCPP commissioning for operators](https://developer.easee.com/docs/ocpp-commissioning-api) — Easee's OCPP setup flow.

When the OCA publishes OCPP 2.0.1 / 2.1 errata, this file should grow a `§14 OCPP 2.0.1 deltas` section rather than be replaced — V3 plans to support 2.0.1 in Phase 3 alongside continued 1.6J.
