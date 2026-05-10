# Straumvakt driver app (Flutter)

Driver-facing mobile app, talks to `/api/driver/*` on the deployed
Straumvakt API Worker.

> **Heritage:** brand colors, logo widgets and visual assets copied
> from `E:\Claude\CPMS\mobile-app` (the staging-showcase mockup).
> The mockup remains as a UI-design reference; this is the real
> production-shaped app.

## Setup

1. Generate platform scaffolding (one-time, after clone):

   ```powershell
   cd apps/mobile
   flutter create . --platforms=android,ios,web --org=is.straumvakt
   ```

2. Install deps:

   ```powershell
   flutter pub get
   ```

3. Run on a connected Android device / emulator:

   ```powershell
   flutter run
   ```

   Or build a debug APK:

   ```powershell
   flutter build apk --debug
   ```

## API base URL

Pinned to staging in `lib/api/client.dart`:

```dart
static const defaultBaseUrl =
    'https://hlada-api-staging.straumvakt.workers.dev';
```

Swap for production when that URL exists. No localhost fallback.

## Test login

```
email:    n1@n1.is
password: 12345678          (pilot only — rotate before non-pilot use)
```

Login → see ~30 chargers under "Dalvegur 10 - 14".

## Phase status

| Phase | Routes | Done |
|---|---|---|
| 1 | `/login`, `/me`, `/chargers` | ✅ |
| 2 | `/sessions/current`, `/sessions/history` | ⏳ |
| 3 | `/start-session`, `/stop-session` | ⏳ |
| 4 | `/live` (SSE) + push notifications | ⏳ |

## File layout

```
apps/mobile/
├── pubspec.yaml
├── lib/
│   ├── main.dart                 ← bootstrap; auto-resume or login
│   ├── api/
│   │   ├── client.dart           ← StraumvaktApi (login, getMe, getChargers)
│   │   ├── types.dart            ← DriverProfile, DriverCharger, ConnectorStatus
│   │   └── auth_storage.dart     ← FlutterSecureStorage wrapper
│   ├── theme/
│   │   ├── palette.dart          ← BrandPalette + AppTheme.dark()
│   │   └── logo.dart             ← LogoMark + LogoWordmark
│   └── screens/
│       ├── login.dart            ← email + password form
│       └── home.dart             ← chargers list grouped by location
└── assets/images/                ← logo + hero PNGs (copied from CPMS mock)
```

## What was deliberately NOT copied from the CPMS mock

The 3,449-line `main.dart` from the mock had a lot of UI we don't need
yet (or shouldn't ship until backed by real data):

- `_AppTruth` static fixtures — replaced by API calls
- ON / Isorka brand variants — out of pilot scope
- Pre-charge inspection card — needs Phase 3 connector status
- Active charging screen — needs Phase 2 live session
- Session history (CDR rows) — needs Phase 2 history endpoint
- RFID token wizard — admin-side concern, not driver-facing
- Web staging showcase shell — was a desktop preview, not the app
- Iceland number plate widget — cute but Autocharge handles vehicle ID

Anything we want back is a small re-import once the backing endpoint
ships.
