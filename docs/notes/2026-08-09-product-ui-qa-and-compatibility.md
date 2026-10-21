# Product UI QA and compatibility

Date: 2026-08-09
Status: local implementation evidence; no beta or production mutation

## What Andri can test today

| Surface                  | Open                                                  | Test                                                                                   | Honest boundary                                                         |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Three-role preview       | `http://localhost:3012/local/product-preview`         | Switch between Straumvakt admin, organisation admin and Driver                         | Demo-only, local environment gate, no API calls                         |
| Staff readiness          | `/staff/overview/readiness` after local staff sign-in | Filter the source-derived workflow inventory by persona                                | Read-only; no contract can be changed here                              |
| Organisation chargers    | `/org/{slug}/chargers`                                | Inspect inventory and create an OCPP charger through the existing endpoint             | Creation needs a valid local session; password is one-time only         |
| Organisation drivers     | `/org/{slug}/drivers`                                 | Inspect memberships and approve or deny existing access requests                       | Does not invent access-code onboarding                                  |
| Organisation sessions    | `/org/{slug}/sessions`                                | Inspect current organisation session summaries                                         | Read-only                                                               |
| Organisation agreements  | `/org/{slug}/agreements`                              | Inspect memberships and the platform cost-factor catalogue                             | Assignment control is disabled because the mutation contract is absent  |
| Organisation invitations | `/org/{slug}/invite`                                  | Inspect the security-blocked state                                                     | Unsafe bearer invite consumption is not called                          |
| Driver app               | Debug APK in the mobile worktree build output         | Guest, unaffiliated, safe invitation redemption, refresh, concurrent-session selection | Installation code fields remain disabled until the join contract exists |

The preview is available only when `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`. Its fixtures use reserved `demo-*` identifiers and `.test` email addresses. The page imports no API client and makes no network request. A build or server without the environment flag returns no preview surface.

## Local run contract

```powershell
$env:STRAUMVAKT_LOCAL_PRODUCT_PREVIEW='1'
npm exec next dev -- --webpack -p 3012
```

Run from `E:\Claude\Straumvakt-onboarding-web`. Do not set beta or production API URLs for this preview. The current local server is intentionally on port `3012` because it was free when verified.

For mobile, run from `E:\Claude\Straumvakt-driver-access-ui\apps\mobile`:

```powershell
flutter test
flutter analyze
flutter build apk --debug
```

## Responsive QA checklist

- [x] Desktop preview at 1280 x 720: all three personas render without overlap.
- [x] Tablet at 1024 x 768: KPI grid, split tables and tab targets verified.
- [x] Narrow phone web at 390 x 844: persona tabs fit; operational tables scroll inside their own region.
- [x] Data tables have stable column labels and do not depend on hover.
- [x] Disabled controls have both visual and semantic disabled state.
- [x] Long identifiers use wrapping/overflow rules rather than resizing the layout.
- [x] Dense operational screens avoid nested cards and oversized headings.
- [ ] Test 200% browser zoom on every CPO route.
- [ ] Test Windows high-contrast mode on status, warning and disabled treatments.
- [ ] Test reduced-motion preference after motion is introduced; current surfaces are static.

## Accessibility checklist

- [x] Preview persona switcher uses `tablist` and selected tab semantics.
- [x] Native buttons and links are used for actions.
- [x] Disabled workflows are not focusable actions.
- [x] Tables expose headers and rows in the accessibility tree.
- [x] Status is not encoded by colour alone; every state has text.
- [x] Form labels remain visible; placeholders are not labels.
- [ ] Verify keyboard order on authenticated CPO pages with a real local session.
- [ ] Verify screen-reader announcement after approve, deny and charger-create mutations.
- [ ] Add focus restoration after modal confirmation once a modal pattern exists.
- [ ] Run automated axe coverage when a browser test harness is adopted.
- [ ] Validate Icelandic copy after the deferred translation review; English is canonical for now.

## Android compatibility matrix

Flutter owns `compileSdk`, `targetSdk` and `minSdk` through its generated version constants in `apps/mobile/android/app/build.gradle.kts`; this branch does not override them. Device behavior remains unclaimed until tested.

| Android | Representative device     | Build              | Widget tests       | Install/open         | BLE/NFC/hardware             | Status          |
| ------- | ------------------------- | ------------------ | ------------------ | -------------------- | ---------------------------- | --------------- |
| 11      | Small 360 dp handset      | Debug APK compiled | Shared suite green | Not run              | Not run                      | Planned         |
| 12      | Mid-range Samsung class   | Debug APK compiled | Shared suite green | Not run              | Not run                      | Planned         |
| 13      | 390-412 dp handset        | Debug APK compiled | Shared suite green | Not run              | Not run                      | Planned         |
| 14      | Current supported handset | Debug APK compiled | Shared suite green | Not run              | Not run                      | Planned         |
| 15      | Android Studio emulator   | Debug APK compiled | Shared suite green | Installed and opened | Out of scope without charger | Verified for UI |

The five-version matrix separates compilation, deterministic widget behavior, app installation and hardware behavior. Passing one column must never be reported as evidence for another.

## Workflow test script

1. Open the local preview and switch through all three personas.
2. Confirm every visible identifier begins with `demo-` or uses a `.test` address.
3. In Straumvakt admin, confirm organisation aggregate and audit trail say `Backend required`.
4. In organisation admin, confirm charger inventory is visible and visibility configuration is disabled.
5. In Driver, confirm invitation is available, installation code is disabled and two concurrent sessions are distinguishable.
6. Open the real CPO routes with a valid local account only; do not point the app at beta or production.
7. Confirm the invite screen cannot submit to `/api/public/invites/consume`.
8. In the Flutter app, confirm an unaffiliated driver can refresh and use an identity-bound invitation.
9. Confirm installation code/passphrase fields are disabled and cannot imply success.
10. Confirm null power and cost values render as unavailable rather than zero.

## Evidence

Screenshots are stored outside Git under `C:\Users\Andri\Documents\New project\evidence\product-to-market-2026-08-09`. Browser screenshots are generated from the local gated preview at 1280 x 720, 1024 x 768 and 390 x 844. Android 15 (API 35) was verified on `emulator-5554`; the normal APK SHA-256 is `31656338C1739264531F4B0301D0549062D1691093BB96AE239A5CAE1CFD2B04`. The guest capture uses the real entry point. Unaffiliated, safe-invitation and blocked-installation captures used a temporary local-only QA entry point; that file was deleted, the normal APK was rebuilt, and the normal APK was reinstalled before closeout.

## Hardening continuation evidence

Authenticated organisation routes now share loading, empty, error, metric, status and contract-gate components. One-time charger credentials are focused and announced, clipboard failure has a manual fallback, ambiguous create results are not automatically retried, driver denial requires a meaningful reason and restores focus, and session/agreement nulls remain truthful.

The staff readiness page filters by state, persona and text while explicitly excluding repository-health/work-view information. Support context says assistance is not impersonation; audit and onboarding aggregate controls remain disabled until canonical reads exist.

Accessibility advanced in twelve verified areas: consistent focus-visible treatment; busy and alert semantics; captioned/scoped tables; one-time credential announcements; decision focus restoration; dependency-labelled disabled controls; mobile semantic headings; mobile live outcomes; decorative-image exclusion; removal of negative display letter spacing; 200% browser captures; and 130% Android font-scale evidence.

### Updated Android matrix

| Android | Device | Install/open | Screen evidence | Large text | Crash buffer | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | No local device/AVD | Blocked | Not run | Not run | Not run | Only Pixel_8 API 35 AVD is installed |
| 12 / API 31 | Samsung SM-A217F, `R58NB07VBMY` | Passed | Guest captured | Widget matrix | Empty | Real-device UI only; no hardware claim |
| 13 | No local device/AVD | Blocked | Not run | Not run | Not run | No API 33 AVD or device |
| 14 | No local device/AVD | Blocked | Not run | Not run | Not run | No API 34 AVD or device |
| 15 / API 35 | Pixel_8 AVD, `emulator-5554` | Passed | Guest captured | 130% passed | Empty | Emulator UI regression verified |

Normal APK SHA-256: `0FB301C625C637794E3D3BC0FED6877B91D95A1F8377F54B3CA15247F3620934`. New evidence is under `C:\Users\Andri\Documents\New project\evidence\product-ui-hardening-2026-08-09`: 12 web groups plus Android 12, Android 15 and Android 15 large-text groups.

The full Flutter suite passes 58 tests and analysis reports no issues. Web focused guards pass 36 tests; the full web suite passes 699 tests with one skipped and one pre-existing `scripts/check-workspace-typecheck.test.mjs` loader syntax failure in this junction-backed worktree. Production build and root TypeScript pass.
