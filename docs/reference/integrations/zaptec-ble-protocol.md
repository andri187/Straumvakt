# Zaptec BLE local protocol (Pro / Go)

**Status:** Reverse-engineered 2026-08-02. **Undocumented by the vendor —
treat as unstable across firmware and app releases.**
**Source:** static analysis of the Zaptec Android app `com.zaptec.zapapp`
v0.1.0 (pulled from a device, decompiled with jadx). Not sniffed; no
traffic capture was needed.
**Verified against hardware:** Zaptec Pro `ZPR074002` (fw 3.3.4.5 / MCU 2.1.6.6),
2026-08-02 22:39-22:42 UTC, from a Galaxy S25 Ultra running the Straumvakt
driver app. Service UUID, all characteristic UUIDs, the PIN handshake and
`Reboot` were all confirmed. **The charger rebooted.**

## Why this exists

A Zaptec Pro that loses its IP lease drops off the network. Once it is
offline, **no cloud API can reach it** — `POST /api/chargers/{id}/sendCommand/102`
requires the charger to be online, which is precisely what it is not.
Zaptec's own app solves this over BLE, and
[documents it as a user feature](https://help.zaptec.com/hc/en-001/articles/17589073831825-Restart-your-Zaptec-charger-without-an-internet-connection-using-the-Zaptec-app).

This is the one capability a driver currently needs the Zaptec app for.
Reproducing it removes the last reason for a Straumvakt user to install
a vendor app.

## Legal footing

Reverse engineering for interoperability, on hardware the operator owns,
using a PIN the operator legitimately holds, to reproduce a feature the
vendor publicly documents. Permitted for interoperability purposes under
the EU Software Directive (2009/24/EC, Art. 6). Nothing here circumvents
an access control: the PIN is supplied by the operator, not defeated.

## Discovery

The charger advertises continuously with its serial in the BLE local
name — measured 37/37 advertisements over 5 s on ZPR074002, zero
nameless (2026-06-07 field test). Format: `"ZPR074002 2305"` — serial,
space, revision suffix. Match on the serial token.

## Service

```
10492c5a-deec-4577-a25a-6950c0b5fcd0
```

Read off the device — the app never names it. The charger exposes three
services: Generic Access (0x1800), Generic Attribute (0x1801), and this
one, which carries all 30 Zaptec characteristics the firmware implements.

## UUID scheme

All characteristics share one 128-bit base with the 16-bit id in the
last four hex digits:

```
10492c5a-deec-4577-a25a-6950c0b5XXXX
```

Derived from `od5.s(int)` in the app:
`new UUID(1173517946705429879L, (id & 0xFFFFFFFFL) - 6747965296109879296L)`.

## Value encoding

Every write is the value's **decimal string, UTF-8 encoded** — not a
binary integer. The app's helper chain is
`G(char, int)` → `String.valueOf(int)` → `H(char, String)` → UTF-8 bytes.

So rebooting writes the three ASCII bytes `31 30 32` (`"102"`), not
`0x66`.

## Sequence — PIN auth then command

1. Scan, match the serial in the advertised local name, connect.
2. **Write** the PIN as an ASCII string to `Auth` (`…fd00`).
   The PIN is 4 digits, factory-set, printed on the box, **and cannot be
   changed**. Straumvakt holds it per charger from the cloud API
   (`GET /api/chargers/{id}` → `Pin`).
3. **Read** `Auth` (`…fd00`) — returns a byte array; the app takes the
   **first byte** as the status.
4. **Write** the command's decimal string to `RunCommand` (`…fd03`).

**Brute-force protection:** wrong PINs disable the BLE interface for an
escalating period. Never retry blindly — a lockout on an already-offline
charger removes the last channel to it.

## Commands — `RunCommand` (`…fd03`)

| Command | Value | Notes |
|---|---|---|
| `Reboot` | `102` | Same id as the cloud API's `RestartCharger`. The one that matters here. |
| `UpdateFirmware` | `200` | |
| `StopChargingFinal` | `506` | |
| `StartCharging` | `507` | The 2022 teardown reported these two as never implemented charger-side. Unverified in current firmware. |
| `RunRcdTest` | `808` | |
| `ForceUnlock` | `950` | |

## Characteristics — all 52

| `AvailableWifiSSIDs` | 0xFCD1 | `10492c5a-deec-4577-a25a-6950c0b5fcd1` |
| `CommunicationMode` | 0xFCD2 | `10492c5a-deec-4577-a25a-6950c0b5fcd2` |
| `WifiSSID` | 0xFCD3 | `10492c5a-deec-4577-a25a-6950c0b5fcd3` |
| `WifiPSK` | 0xFCD4 | `10492c5a-deec-4577-a25a-6950c0b5fcd4` |
| `Connect` | 0xFCD5 | `10492c5a-deec-4577-a25a-6950c0b5fcd5` |
| `MID` | 0xFCD7 | `10492c5a-deec-4577-a25a-6950c0b5fcd7` |
| `Standalone` | 0xFCD9 | `10492c5a-deec-4577-a25a-6950c0b5fcd9` |
| `Authorization` | 0xFCDA | `10492c5a-deec-4577-a25a-6950c0b5fcda` |
| `Indicate` | 0xFCDB | `10492c5a-deec-4577-a25a-6950c0b5fcdb` |
| `ChargerOperationState` | 0xFCDC | `10492c5a-deec-4577-a25a-6950c0b5fcdc` |
| `OccupiedState` | 0xFCDD | `10492c5a-deec-4577-a25a-6950c0b5fcdd` |
| `AuthorizationResult` | 0xFCDE | `10492c5a-deec-4577-a25a-6950c0b5fcde` |
| `Location` | 0xFCDF | `10492c5a-deec-4577-a25a-6950c0b5fcdf` |
| `LedState` | 0xFCDF | `10492c5a-deec-4577-a25a-6950c0b5fcdf` |
| `TimeZone` | 0xFCE0 | `10492c5a-deec-4577-a25a-6950c0b5fce0` |
| `TimeSchedule` | 0xFCE1 | `10492c5a-deec-4577-a25a-6950c0b5fce1` |
| `MIDFieldTestMode` | 0xFCE2 | `10492c5a-deec-4577-a25a-6950c0b5fce2` |
| `AvailableCommunicationModes` | 0xFCE3 | `10492c5a-deec-4577-a25a-6950c0b5fce3` |
| `PairNfc` | 0xFCE4 | `10492c5a-deec-4577-a25a-6950c0b5fce4` |
| `MeterData` | 0xFCE7 | `10492c5a-deec-4577-a25a-6950c0b5fce7` |
| `MeterType` | 0xFCE8 | `10492c5a-deec-4577-a25a-6950c0b5fce8` |
| `MeterConfiguration` | 0xFCE9 | `10492c5a-deec-4577-a25a-6950c0b5fce9` |
| `Auth` | 0xFD00 | `10492c5a-deec-4577-a25a-6950c0b5fd00` |
| `AvailableWifiNetworks` | 0xFD01 | `10492c5a-deec-4577-a25a-6950c0b5fd01` |
| `NetworkStatus` | 0xFD02 | `10492c5a-deec-4577-a25a-6950c0b5fd02` |
| `RunCommand` | 0xFD03 | `10492c5a-deec-4577-a25a-6950c0b5fd03` |
| `StandaloneCurrent` | 0xFD04 | `10492c5a-deec-4577-a25a-6950c0b5fd04` |
| `NetworkType` | 0xFD05 | `10492c5a-deec-4577-a25a-6950c0b5fd05` |
| `StandalonePhase` | 0xFD06 | `10492c5a-deec-4577-a25a-6950c0b5fd06` |
| `GridTest` | 0xFD07 | `10492c5a-deec-4577-a25a-6950c0b5fd07` |
| `PermanentLock` | 0xFD08 | `10492c5a-deec-4577-a25a-6950c0b5fd08` |
| `HmiLedBrightness` | 0xFD09 | `10492c5a-deec-4577-a25a-6950c0b5fd09` |
| `PlcNmk` | 0xFD0A | `10492c5a-deec-4577-a25a-6950c0b5fd0a` |
| `PlcNpw` | 0xFD0B | `10492c5a-deec-4577-a25a-6950c0b5fd0b` |
| `PlcPair` | 0xFD0C | `10492c5a-deec-4577-a25a-6950c0b5fd0c` |
| `RcdFunctionTest` | 0xFD0D | `10492c5a-deec-4577-a25a-6950c0b5fd0d` |
| `FirmwareVersion` | 0xFE00 | `10492c5a-deec-4577-a25a-6950c0b5fe00` |
| `Warnings` | 0xFE01 | `10492c5a-deec-4577-a25a-6950c0b5fe01` |
| `Capabilities` | 0xFE02 | `10492c5a-deec-4577-a25a-6950c0b5fe02` |
| `MaxInstallationCurrentSwitch` | 0xFE06 | `10492c5a-deec-4577-a25a-6950c0b5fe06` |
| `MaxInstallationCurrentConfig` | 0xFE07 | `10492c5a-deec-4577-a25a-6950c0b5fe07` |
| `PhaseRotation` | 0xFE08 | `10492c5a-deec-4577-a25a-6950c0b5fe08` |
| `It3Optimization` | 0xFE09 | `10492c5a-deec-4577-a25a-6950c0b5fe09` |
| `MaxPhases` | 0xFE0A | `10492c5a-deec-4577-a25a-6950c0b5fe0a` |
| `Reset` | 0xFE0B | `10492c5a-deec-4577-a25a-6950c0b5fe0b` |
| `SessionController` | 0xFE10 | `10492c5a-deec-4577-a25a-6950c0b5fe10` |
| `OcppNativeURL` | 0xFE11 | `10492c5a-deec-4577-a25a-6950c0b5fe11` |
| `OcppNativeCBID` | 0xFE12 | `10492c5a-deec-4577-a25a-6950c0b5fe12` |
| `OcppNativeAuthorizationKey` | 0xFE13 | `10492c5a-deec-4577-a25a-6950c0b5fe13` |
| `OcppNativeAuthorizationKeyFromZaptec` | 0xFE14 | `10492c5a-deec-4577-a25a-6950c0b5fe14` |
| `OcppNativeSecurityProfile` | 0xFE15 | `10492c5a-deec-4577-a25a-6950c0b5fe15` |
| `OcppNativeConnected` | 0xFE16 | `10492c5a-deec-4577-a25a-6950c0b5fe16` |

## What this contradicts

The 2022 [mnemonic / Harrison Sand teardown](https://harrisonsand.com/posts/reverse-engineering-ev-charger/)
concluded the BLE interface was "limited, apart from reconfiguring the
device." That was true of the **command** set — only `Reboot` and
`UpdateFirmware` were implemented — but it undersells the
**characteristic** set. The 2026 app exposes 52 characteristics
including full WiFi provisioning, OCPP native configuration, current and
phase limits, NFC pairing, meter configuration and grid test.

Practical consequence: BLE is not merely an offline restart channel. It
is a full local configuration surface, and several of its characteristics
have **no cloud equivalent** — `WifiSSID` / `WifiPSK` / `NetworkStatus`
in particular, which are exactly what an IP-lease failure needs.

## Verified 2026-08-02 — results

| item | result |
|---|---|
| Service UUID | `10492c5a-deec-4577-a25a-6950c0b5fcd0` — confirmed by enumeration |
| Characteristic UUIDs | every derived UUID matched the device exactly |
| Characteristics present | **30** of the 52 the app knows about — the app carries the superset across models/firmware |
| `Auth` write | PIN as ASCII, `status=0` |
| `Auth` read | `[0x31]` = ASCII `"1"` = **authenticated**. A character, not a numeric flag — consistent with the string encoding throughout |
| `RunCommand` write | `"102"` accepted, `status=0` |
| Reboot | **charger rebooted** |
| Range | found at RSSI -19, connect-to-command in **~300 ms** |

### Confirming a reboot took effect

The charger re-reports its state ~95 s after the command. Two reliable
markers, both from the cloud API:

| observation | before | after |
|---|---|---|
| `820 UptimeVariscite` | 62.0303 | **0.0008** |
| `811 McuResetSource` | 22 | **1** |

`McuResetSource` is the better signal: it records *why* the MCU reset, so
a commanded reboot is distinguishable from a power cut or a watchdog.
Worth surfacing in the operator console — "restarted by <user> via BLE"
is a different event from "restarted itself".

Temperatures, humidity and RCD calibration also re-baseline, which is
normal for a power cycle and not a fault.

Characteristic properties observed (`0x2` read, `0x8` write, `0xa` both):
`Auth` is `0xa`, `RunCommand` is `0x8` (write-only), `WifiPSK` is `0x8`
(write-only — it will not read a password back).

## Build notes

`flutter_blue_plus` is already a dependency in the driver app and is
field-validated against this exact charger for scanning. Connect,
`discoverServices`, and characteristic read/write are standard in that
package on both Android and iOS, so no new dependency is required.

**The app must be foregrounded to scan.** Android silently drops BLE scan
results for background processes — the first probe run timed out at 45 s
with the process backgrounded, and found the charger in 0.5 s once the
activity was up. Any "restart my charger" flow has to run with the app
open, or from a foreground service.

**Fail gracefully.** This is an undocumented interface. Any firmware or
app release can change it. The app must degrade to "restart unavailable,
contact operator" rather than erroring, and the cloud path
(`sendCommand/102`) should always be tried first when the charger is
online — BLE is the fallback, not the default.
