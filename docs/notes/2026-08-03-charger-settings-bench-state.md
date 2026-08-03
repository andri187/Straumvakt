# Charger settings over BLE — bench state, 2026-08-03

Where we stopped, so tomorrow starts from facts rather than from re-reading
the transcript. Hardware: Zaptec Pro **ZPR074002**, fw **3.3.4.5**, S25
Ultra (`R5CY213LG2V`) over USB debugging.

Build/install used all evening:

```
flutter build apk --debug --dart-define=BENCH_PIN=2305
adb install -r build/app/outputs/flutter-apk/app-debug.apk
adb logcat -s flutter:*     # tags: [zaptec-ble], [charger-settings]
```

## What the hardware told us

A debug-only sweep now reads **every** characteristic the charger exposes
(`_sweep()` in `apps/mobile/lib/screens/charger_settings.dart`), not just
the ones the settings descriptor covers. Results are captured in the
session log; the headline findings that changed code:

- **34 characteristics exposed.** The "34" in the source header had only
  ever been counted through a truncated pipe; it is now confirmed by
  enumeration. `0xFCD8` is exposed, write-only, and **absent from the
  vendor app's own enum** — purpose unknown.
- **`0xFE01 Warnings` reads back EMPTY**, not `"0"`. A charger visibly
  showing a warning reported nothing here. Empty is not "no faults" and
  must not render as if it were.
- **The Wi-Fi list is `0xFCD1`** (`Siminn25ECC1 || Vodafone-966Y`), not
  `0xFD01`, which returns nothing. The picker was reading the wrong
  characteristic.
- **`CommunicationMode` answers `Wifi`** — a name. The descriptor gated
  the Wi-Fi rows on `== "0"`, so they were hidden outright.
- **`StandaloneCurrent` is decimal** (`32.0`), so writing `16` may be the
  wrong type.
- `0xFD05 NetworkType` = `TN_3`; `0xFD06 StandalonePhase` = `1`;
  `0xFD0A PlcNMK` returns a **binary key** — never render or log it.

**NOT yet recorded in
`docs/reference/integrations/zaptec-ble-protocol.md`.** Deliberately held
back: this charger exposes 34 of the 52 ids the vendor app knows, so the
remaining 18 — and whatever enumerations they carry — are unseen. Writing
a table that reads as complete from a single model on a single firmware
would be the wrong artefact. Fold it in once a second charger or firmware
has been swept.

## What changed in the app

`apps/mobile/lib/` — analyzer clean, built and installed on the S25.

- **Writes are verified by read-back.** `_writeField` writes, settles
  60 ms, re-reads, and compares (numerically where both sides parse).
  Alternate encodings are tried in order; numeric fields automatically get
  their decimal and integer spellings. If nothing lands, the driver is
  told the charger refused and what it still reads. It no longer reports
  success on an unconfirmed write — that is what made the lock-cable
  toggle and the phase switch look like they worked.
- **Faults surface above the fold.** Status was rendered *inside*
  collapsed Advanced, so a faulted charger showed nothing unless the
  driver knew to expand it. `CapabilityGroup.pinned` now hoists it.
  `decodeWarnings()` decodes the bitmask against Zaptec's own
  `SmartWarnings` constants into named faults, with unnamed bits still
  reported. `ResolvedField.display` passes an empty read to the field's
  formatter instead of short-circuiting to an em-dash.
- **UI lag was ours.** Every write re-read all ~12 characteristics
  serially; GATT does not pipeline, so that was 1–2 s of frozen UI on top
  of the write attempts. A write now re-reads only the field it touched;
  the full re-read is pull-to-refresh.
- **Maximum current** is a snapped slider over `0, 6, 7 … 32` A — nothing
  between 0 and 6 — plus a tappable number pad that rounds to the nearest
  legal stop.
- **Light brightness** is snapped and named ("Bright · 75%"), with end
  icons and captions.
- **Grid test** stays visible but disabled with a reason whenever
  `ChargerOperationState != 1`, via the new declarative
  `CapabilityField.requiresState`.
- Per-`Choice` danger override, so LTE no longer carries a warning that is
  untrue for it.

## Open, in priority order

1. **No setting write has ever been confirmed on hardware.** Reads, PIN
   auth and `RunCommand(102)` reboot are the only verified operations.
   Standalone-off and Maximum-current were being tested when we stopped —
   **the log capture came back empty, so there is no result yet.** First
   thing tomorrow: reproduce with logging and read the
   `wrote "x" → read "y"` lines.
2. **Faults over BLE appear impossible on this firmware.** If that holds,
   fault state must come from the operator side (cloud observation 804 /
   `StatusNotification` errorCode) — a backend path, not a BLE one.
3. `0xFCE3 AvailableCommunicationModes` returns something multi-line that
   we have not decoded; the comm-mode picker still falls back to the fixed
   list.
4. `bleAdvertisingId` is null fleet-wide, which breaks BLE matching for
   **both** tap-and-auth and settings. ADR 0024's serial-prefix fix never
   landed in `ble/scanner.dart`.
5. Backend, Rule 5, unbuilt: PIN-release endpoint (written, not deployed)
   and the advanced-grant endpoint. The `kDebugMode` PIN/grant/guard
   bypasses come out when those land.
6. Self-destruct on driver inactivity — deferred by the operator.
