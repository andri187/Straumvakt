# Charger settings — UI design guide

**Audience:** the agent building the Straumvakt driver app.
**Status:** design guide, 2026-08-02. Grounded in hardware-verified
capability, not aspiration — see
[zaptec-ble-protocol.md](../reference/integrations/zaptec-ble-protocol.md).

---

## What this feature is for

A driver or host-admin standing at a charger can inspect and change its
settings from the Straumvakt app, **including when the charger is offline**
— which is when they need it most, and the one case that currently forces
them to install the vendor's app.

Two transports, one screen:

| transport | when | reach |
|---|---|---|
| **Cloud API** | charger online | full settings + 48 telemetry observations |
| **Local BLE** | always, within ~10 m | 34 characteristics incl. WiFi provisioning — **no cloud equivalent** |

The UI must never make the user choose a transport. It picks: cloud when
the charger is online, BLE when it isn't, and says which it used.

---

## The three screens

```
App menu
  └─ "Stöðvarstillingar" (Charger settings)
       └─ [1] Charger picker  — live BLE scan
            └─ [2] Settings overview  — grouped, capability-driven
                 └─ [3] Setting detail / edit  — one field, one decision
```

---

## Screen 1 — Charger picker

Live BLE scan. Sorted by signal strength, nearest first.

```
┌────────────────────────────────────────────┐
│ ←   Stöðvarstillingar                      │
├────────────────────────────────────────────┤
│  Leita að stöðvum í nágrenninu…    ⟳       │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ ▮▮▮▮  ZPR074002                  →   │  │
│  │       Dalvegur 10 · Á staðnum        │  │
│  │       ● Nettengd                      │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ▮▮▯▯  ZPR074015                  →   │  │
│  │       Dalvegur 10 · Nálægt            │  │
│  │       ○ Ónettengd · aðeins Bluetooth  │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ ▮▯▯▯  ZPR089331              🔒      │  │
│  │       Enginn aðgangur                 │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

**Rows show:** signal as a 4-bar proximity glyph (never raw dBm), serial,
site name from the backend, online state, access state.

**Proximity buckets** — calibrated on ZPR074002, 2026-06-07:

| bars | RSSI | meaning |
|---|---|---|
| ▮▮▮▮ | ≥ −35 | at the charger |
| ▮▮▮▯ | −36…−45 | within a metre |
| ▮▮▯▯ | −46…−60 | same bay |
| ▮▯▯▯ | < −60 | in range, not here |

**Show chargers the driver cannot access**, greyed with a lock — the
scanner already distinguishes this (`TapHit.hasAccess`). Hiding them
produces "why isn't my charger showing" support tickets; showing them with
an honest reason does not.

**Required states:**

- Bluetooth off → "Kveiktu á Bluetooth" + button that opens settings
- Permission denied → explain *why* it is needed, then re-request
- Scanning, nothing found after 10 s → "Engin stöð fannst. Farðu nær
  stöðinni." Keep scanning, do not give up.
- **Screen must stay foregrounded.** Android silently drops BLE scan
  results for backgrounded processes — measured: 45 s timeout backgrounded
  versus 0.5 s foregrounded. If the app is backgrounded, stop the scan and
  resume on return rather than showing a stale list.

---

## Screen 2 — Settings overview

**Render from what the device actually exposes.** After connecting, run
service discovery and build the screen from the characteristics present.
Do not hardcode a list — this firmware exposes 34 of the 52 the vendor's
app knows about, and other models and firmware expose different sets. A
hardcoded screen shows dead controls on half your fleet.

This is also the seam that makes the screen vendor-neutral: a capability
descriptor per charger model, one renderer.

```
┌────────────────────────────────────────────┐
│ ←   ZPR074002                              │
│     Dalvegur 10                            │
├────────────────────────────────────────────┤
│ ⓘ Tengt með Bluetooth · stöðin er ónettengd│
├────────────────────────────────────────────┤
│                                            │
│  STAÐA                                     │
│  Ástand              Tilbúin               │
│  Nettenging          Engin  ⚠              │
│  Hugbúnaður          3.3.4.5               │
│  Viðvaranir          Engar                 │
│                                            │
│  NETTENGING                          →     │
│  WiFi · ZPR-Dalvegur                       │
│                                            │
│  HLEÐSLA                             →     │
│  Hámarksstraumur 32 A · 1 fasi             │
│                                            │
│  VIÐMÓT                              →     │
│  Birta 10% · Ísland/Reykjavík              │
│                                            │
│  AÐGANGUR                            →     │
│  Auðkenningar krafist                      │
│                                            │
│  ─────────────────────────────────────     │
│                                            │
│  [ ⟲  Endurræsa stöð ]                     │
│                                            │
│  ▸ Ítarlegar aðgerðir                      │
│                                            │
└────────────────────────────────────────────┘
```

### Grouping

| Section | Characteristics | Notes |
|---|---|---|
| **Staða** (read-only) | `ChargerOperationState` `OccupiedState` `NetworkStatus` `Warnings` `FirmwareVersion` `MID` | Never editable. Top of screen — most visits are diagnostic. |
| **Nettenging** | `CommunicationMode` `WifiSSID` `WifiPSK` `AvailableWifiNetworks` `AvailableWifiSSIDs` `NetworkType` | **The reason this feature exists.** No cloud equivalent. |
| **Hleðsla** | `Standalone` `StandaloneCurrent` `StandalonePhase` `PermanentLock` | |
| **Viðmót** | `HmiLedBrightness` `LedState` `TimeZone` `TimeSchedule` | Safe. Good first thing to let a user touch. |
| **Aðgangur** | `Authorization` `AuthorizationResult` `PairNfc` | |
| **Aðgerðir** | `RunCommand` `GridTest` | Restart is the hero action — surface it, don't bury it. |
| **Ítarlegar** (collapsed) | `PlcNmk` `PlcNpw` `PlcPair` `MIDFieldTestMode` `UpdateFirmware` | Collapsed by default, host-admin only. |

`0xFCD8` is present on the device but absent from the vendor app's own
enum. Unknown purpose — **do not surface it.**

### The transport banner

Always visible, never dismissible:

- Cloud: `ⓘ Tengt í gegnum netið` — neutral
- BLE: `ⓘ Tengt með Bluetooth · stöðin er ónettengd` — amber, plus
  "Haltu símanum nálægt stöðinni" while the connection is live
- Lost: overlay the screen, don't silently show stale values

---

## Screen 3 — Setting detail

One field per screen. Write, confirm, verify by reading back.

**Write-only characteristics** (`WifiPSK`, props `0x8`) can never be read
back. Show `•••••••• (vistað)` and a *Breyta* action — never an empty box
implying no value is set.

**After every write, read back and show the result.** A GATT write
returning `status=0` means the stack accepted it, **not** that the charger
applied it. Verify or say you could not.

---

## Danger tiering

Three levels, visually distinct, non-negotiable:

**Safe** — LED brightness, time zone. Apply immediately, no confirmation,
undo available.

**Caution** — current limits, phase, cable lock, authorisation mode.
Confirm with a plain-language consequence: *"Stöðin hættir að hlaða
þangað til nýja stillingin tekur gildi."*

**Destructive** — WiFi credentials, communication mode, network type, PLC
keys, firmware, MID test mode. Require:
1. explicit typed or held confirmation,
2. a warning that says **exactly** what can go wrong —
   *"Ef þessi stilling er röng missir stöðin nettengingu og aðeins er hægt
   að laga hana á staðnum með Bluetooth."*,
3. host-admin privilege.

That warning is not hypothetical. Setting a wrong WiFi password over BLE
strands the charger — and the only recovery is standing next to it with
this app. Which is exactly why the feature exists, and exactly why it
needs the guardrail.

---

## Privileges

| Role | Sees | Can change |
|---|---|---|
| Driver with access | Staða, restart | nothing |
| Host-admin | everything except Ítarlegar | Safe + Caution |
| Operator / CPO | everything | everything |

The **PIN is never shown to the user and never stored on the device.**
The app fetches it from the Straumvakt backend at the moment of use. It is
factory-set and **cannot be rotated**, so releasing it is effectively
permanent — treat every fetch as an audited grant.

---

## Connection lifecycle

```
pick charger → connect → auth (PIN) → discover → render
                  │         │
                  │         └─ auth fails → "Rangt PIN" + STOP.
                  │            Never retry automatically: wrong PINs
                  │            disable the charger's Bluetooth for
                  │            escalating periods, and on an offline
                  │            charger that is the last channel.
                  └─ timeout → "Náði ekki sambandi. Farðu nær stöðinni."
```

Connect-to-rendered was measured at **~300 ms** on hardware, so a skeleton
loader is enough — no progress bar, no spinner theatre.

Hold the connection while the screen is open; drop it on exit. Do not
reconnect per field.

---

## Copy

All strings externalised for `is`/`en` from `driver.locale`. **Icelandic
is a launch blocker (P3.5), so no hardcoded English.**

Write for a driver in a car park in the rain: short, concrete, no jargon.
"Stöðin er ónettengd" not "OCPP disconnected". Never show a raw
characteristic UUID, a dBm value, or a status byte in the primary UI —
those belong behind a debug toggle.

---

## Do not

- **Do not hardcode the settings list.** Render from discovery.
- **Do not show a value you have not read back.**
- **Do not retry a failed PIN.**
- **Do not offer settings whose characteristic is absent** — hide, don't grey.
- **Do not let the restart button appear during an active session**
  without a warning naming the driver it would interrupt.
- **Do not build a Zaptec screen.** Build a capability renderer that a
  Zaptec descriptor happens to drive. The next brand is the point.

---

## Verified basis

Everything above rests on a hardware session against Zaptec Pro
`ZPR074002` (fw 3.3.4.5), 2026-08-02: service discovery enumerated 34
characteristics with their read/write properties, PIN auth returned
`'1'`, and a reboot was issued and confirmed (`UptimeVariscite`
62.03 → 0.0008, `McuResetSource` 22 → 1).

The protocol is **undocumented by the vendor**. Any firmware release may
change it. Every BLE path needs a graceful failure that degrades to
"stillingar ekki í boði" rather than an error state — and the cloud path
must always be preferred when the charger is online.
