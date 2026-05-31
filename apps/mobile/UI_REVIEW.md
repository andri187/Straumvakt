# UI review — CPMS mock app vs reality

A walkthrough of the existing 3,449-line `lib/main.dart` mockup at
`E:\Claude\CPMS\mobile-app`, mapped against what the Straumvakt
backend actually exposes to drivers today (Phase 1 = login + me +
chargers; Phase 2/3/4 pending).

## Keep — already shipped in `apps/mobile`

| From the mock | Why keep |
|---|---|
| `_BrandPalette` (`midnight / deepNavy / surface / border / mint / cyan / blue / muted`) | Exact colours, copied to `theme/palette.dart`. |
| `_LogoMark`, `_LogoWordmark` widgets | Copied to `theme/logo.dart` with the same fallback gradient. |
| Brand assets (`straumvakt_logo_mark.png`, `straumvakt_logo_full.png`, `straumvakt_hero_image.png`) | Copied verbatim into `assets/images/`. |
| Dark Material 3 theme with mint accents on filled buttons | Embedded in `AppTheme.dark()`. |

## Change — concept exists in mock but maps wrong

### 1. "Primary charger" → list of chargers grouped by location

**Mock:** `_AppTruth.primaryCharger = 'N1 742'` — single static value, used everywhere.

**Reality:** N1 driver has access to ~30 chargers across one installation today (Dalvegur 10-14), and the agreement model is built for many installations / driver groups. There's no concept of "primary."

**Done in new app:** `home.dart` renders all chargers from
`/api/driver/chargers`, grouped under a `locationName` heading. No
"primary" concept.

**If you want a favourite/last-used:** that's a UI-state decision (local preference per user) — easy follow-up, not a backend change.

---

### 2. Charger dropdown → status-aware tappable cards

**Mock:** `_ChargerDropdown` lets you pick from a fixed list.

**Reality:** the OpenAPI `/chargers` returns `status: ConnectorStatus` per row (`Available / Charging / Faulted / …`), and only `Available` chargers can be started. A dropdown hides that state.

**Done in new app:** `_ChargerCard` shows the status pill inline. Faulted/Unavailable cards are visible but visually de-emphasised (greyed icon). Phase 3 wires up the tap → start session.

---

### 3. Plate widget (`_NumberPlate`, `_IcelandPlateMark`) → vehicle identity from Autocharge

**Mock:** the home screen prominently shows a giant Iceland plate with `_AppTruth.primaryPlate = 'N1 742'`. Beautiful work — but it presupposes the driver telling the app their plate number.

**Reality:** ADR 0021 (Autocharge) captures vehicle identity automatically:

- Link layer — EV PLC MAC + OUI vendor lookup (Tesla, VW, BMW, …)
- Application layer — OCMF identity / EVCCID

Plate number is **never** captured by the OCPP/AMQP path. Showing a plate that the driver typed in is fiction.

**Recommendation:** drop the plate widget. When Phase 2 surfaces a "current session" with `evPlcMacOuiVendor`, render *that* in the same prominent slot — "Charging your Tesla / your VW / your unknown vehicle". That's an honest signal driven by what we actually see.

---

### 4. SOC bar (`_SocBar`, `_SocPainter`) → not until SOC reporting lands

**Mock:** animated state-of-charge ring on the home screen.

**Reality:** SOC is *not* a reliable signal in OCPP 1.6. Some chargers report it via a non-standard MeterValue measurand; most don't. The 2026-05-09 ADR addendum explicitly chose **idle-time fee** as the SOC-cap proxy precisely because we can't trust SOC.

**Recommendation:** drop the SOC bar from Phase 1 home. If a future Phase 2 session-detail surfaces SOC where the charger reports it, gate it behind `if (sample.stateOfChargePct != null)` and hide the widget when we don't have data, rather than showing 0% or animating fake numbers.

---

### 5. ON / Isorka brand variants

**Mock:** `assets/images/on_hero_image.png`, `isorka_hero_image.png` + branched code paths.

**Reality:** ON and Isorka are external CPOs / mobility providers in Iceland. Straumvakt's pilot is a single CPO (N1) running on N1's own chargers. There's no roaming, no OCPI partner, no need for partner branding.

**Recommendation:** drop until/unless we sign a real roaming partner. The hero image slider (`_HeroImageSlider`) is overhead for a use-case that doesn't exist yet. Keep the assets in storage; reactivating is a feature flag.

## Drop — solves a problem we don't have

| Mock widget / screen | Why drop |
|---|---|
| `_StagingShowcaseShell` + `_PhonePreviewFrame` | Desktop showcase wrapper for snapshots. The new app runs on actual devices; no need for a fake phone frame. |
| `_PreparingChargeCard` + `_PreparingChargeIllustration` + `_PreparingChargePainter` (~600 lines) | Pre-flight inspection animation. Real pre-flight = OCPP `Preparing` status from the connector. Phase 3 / 4 will surface that as a thin status pill, not a multi-second animation. |
| `_PlateInspectionSticker` | Iceland skoðunarmiði (vehicle inspection sticker) — driver-app territory only if we have inspection data, which we don't. |
| `_RfidTokenWizardScreen` | Drivers don't mint their own tokens (ADR 0006). Tokens are admin-issued. Wrong audience. |
| `_RichProfileScreen` + `_LinkedRfidToken` synthetic class | Profile UI tied to fake fixture data. Replace with a thin profile screen reading `/api/driver/me` when the operator wants it. |
| `_CdrMonthTotalRow` + `_CdrRow` | Session history rows with hardcoded data. Bring back when `/sessions/history` ships in Phase 2. |
| `LoginScreen` (mock) | Has a fake "sign in" button that just navigates. Replaced with a real form that calls the API. |

## New things the mock doesn't show — worth designing

These come from Straumvakt features that landed during the agreements
sprint and aren't reflected in the mock at all:

1. **Multi-installation list.** When N1's drivers have access at >1 site (Krónan, Festi, Klettás all showed up as candidate Drivers in our DB), the home will need search / sort / filter, not just a flat list. Current Phase 1 design groups by location, scales to ~5 locations comfortably.

2. **Vehicle identity callout.** Once Phase 2 lands, the home should show "**Last seen vehicle: VW EV PLC MAC `XX:XX:…`**" if Autocharge has captured one. This is the killer UX feature — drivers stop caring about RFID once their car is recognised automatically. (Don't ship before the data path is verified.)

3. **Agreement context strip.** Drivers might charge under multiple agreements (employee + personal). The home could show a thin "Charging at Dalvegur covered by *N1 Driver Pilot*" caption, sourced from the agreement chain. Cheap to add; defers until Phase 2 reveals which agreement is *active* per session.

4. **Empty-state UX for new drivers.** Driver added but no DriverGroup membership yet → today's API returns `chargers: []`. The new app shows a clean empty state explaining "Reach out to your operator to get added to a driver group." That's correct; the mock had no equivalent.

5. **Offline behaviour.** Mobile networks are unreliable. The new app uses `RefreshIndicator` and shows a clear error state on network failure. The mock had no offline handling because everything was static.

## Suggested rollout order

1. ✅ **Phase 1** (this PR) — login, profile-on-home-header, chargers list
2. **Phase 2** — `/sessions/current` polling, vehicle-identity callout, session history
3. **Phase 3** — start/stop session via `RemoteStartTransaction` dispatch
4. **Phase 4** — SSE for live charging, push notifications

After Phase 2, decide whether to bring back any of the dropped widgets.
The plate widget specifically is worth re-evaluating once we know
whether Iceland drivers find OUI-vendor-name ("Charging your Tesla")
more or less compelling than a plate number they typed in.
