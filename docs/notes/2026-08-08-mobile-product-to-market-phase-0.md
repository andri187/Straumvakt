# Mobile Driver Product-to-Market: Phase 0 Baseline

Date: 2026-08-08

Status: assessment and preservation complete; no live redesign implemented.

Updated handoff reconciliation: the later 2026-08-08 mobile handoff is
authoritative for historical caller status. It confirms that driver-group
invite acceptance has never had a mobile caller, while history and invoices
have also never been mobile features in committed history. The local screens
for profile, vehicle, history, and invoices are untracked prototypes in this
shared checkout, not restored committed functionality.

## 1. Product boundary

The Flutter app in `apps/mobile` is now the only maintained driver-facing
Straumvakt surface. The parked web driver portal is a capability and UX
reference only. The mobile product must eventually cover the complete driver
journey:

`onboard -> receive access -> identify charger -> start -> monitor -> finish -> understand cost -> retrieve history`

The market-phase objective remains the first real organisation and correct
invoice. Mobile work should make the driver journey trustworthy without
allowing optional configurators or service tooling to delay that objective.

## 2. Repository baseline

Canonical app: `apps/mobile`

Normal entry point: `apps/mobile/lib/main.dart`

Current branch: `dev/straumvakt-org-relaunch`

The worktree was already dirty before this assessment. Relevant local work:

- Modified: `lib/api/client.dart`, `lib/api/types.dart`,
  `lib/screens/menu_drawer.dart`.
- Untracked: `lib/screens/charge_history.dart`, `lib/screens/profile.dart`,
  `lib/screens/my_vehicle.dart`, `lib/my_vehicle_preview.dart`, and the
  My Vehicle focused test and configurable assets.
- Unrelated modified/untracked files also exist and must not be reverted.

The current vehicle concept has been copied, not moved, to:

`archive/mobile-driver-vehicle-concept-2026-08-04/`

## 3. Capability matrix

| Capability | State | Evidence and qualification |
|---|---|---|
| Login | Working core | Calls `POST /api/driver/login`; stores bearer and refresh tokens securely. |
| Cold-start session restoration | Working core | Reads stored token, calls `/me`, then resolves charger access. |
| Expired/revoked token recovery | Partial | Bootstrap clears auth on `ApiException`; handling is not centralised for later API calls. |
| Empty-access funnel | Working UI | Zero chargers routes to invite entry and refresh. |
| Passwordless driver invite claim | Missing | No mobile caller for `POST /api/driver/claim-invite`. |
| Authenticated driver invite redemption | Missing | No mobile caller for `POST /api/driver/redeem-invite`. |
| Existing invite form | Contract mismatch | Calls older `/api/public/invites/consume` with kennitala/password. It is not ADR 0053's claim-login-redeem flow. |
| Manual invite and QR entry | Present UI | Scanner and code normalisation exist and can be reused. |
| Accessible charger list | Working core | Calls `GET /api/driver/chargers`; groups returned chargers by location. |
| Connector states | Working core | Available, preparing, charging, suspended, finishing, unavailable, faulted, offline, and unknown are represented. |
| BLE proximity discovery | Implemented, launch status unconfirmed | Scans known chargers and coordinates scan/GATT ownership. Product scope currently parks BLE unless required. |
| Tap intent | Implemented, launch status unconfirmed | Arms/disarms real tap-intent API. Field workflow and launch requirement require confirmation. |
| Charger settings | Service-oriented and overexposed | Driver menu currently links to BLE charger settings. Advanced operations correctly fail locked, but this is not a normal driver workflow. |
| Remote start | Working API path | Calls `POST /api/driver/start-session` and reports accepted command. |
| Active session | Wired but source contract currently disagrees | The handoff classifies watching as connected. In the current tree the API returns `{sessions: [...]}`, while the client parses the whole body as one `ActiveSession`. Verify deployed behaviour on a handset, then align the client to the authoritative response. No active-session entry point exists on app resume/home. |
| Remote stop | Implemented but depends on active-session fix | Calls `POST /api/driver/stop-session` with the live session id. |
| Finished/settlement state | Partial | Shows a small ended state from the last in-memory snapshot; no enriched settlement fetch or itemised cost. |
| Charge history | Net-new local prototype | Never existed in committed mobile history. The current untracked screen calls the live endpoint but has no pagination or detail route. |
| Receipts/invoices | Net-new local prototype | Never existed in committed mobile history. The current untracked screen calls `/api/driver/invoices`, but presents session rows rather than invoice documents/collection state. |
| Session detail | Missing | Backend `GET /api/driver/sessions/:id` exists; mobile has no caller or screen. |
| Profile | Local uncommitted implementation | Display-name update exists; email/password are not editable by the API. |
| Language | Partial | Locale persistence/sync exists, but many screens still contain hardcoded English. |
| Support | Missing | Menu item only shows a Phase 2 snackbar. |
| My Vehicle | Mock concept | Entirely local, with hardcoded identity/specification/session data and no vehicle API. |
| Autocharge status/enrolment | Mock UI | Local boolean and synthetic EVCCID text; not connected to captured identity. |
| Automated mobile coverage | Insufficient | One placeholder test plus the untracked My Vehicle visual test. Core auth/charging/invite flows lack focused tests. |

## 4. Essential journey map

### 4.1 New invited driver

1. Open invite deep link or enter/scan code.
2. Attempt `claim-invite` with a new password.
3. If the account is already claimed, route to login with email/code context.
4. Log in as the bound invitee.
5. Call authenticated `redeem-invite` with the same code.
6. Refresh charger access.
7. Show granted, pending, expired, already-used, unsupported-security, or
   identity-safe not-found state.

The mobile app does not currently implement this flow.

### 4.2 Returning driver

1. Restore stored session and profile.
2. Check for an active charging session before showing idle home.
3. If active, make the session immediately recoverable.
4. Otherwise load accessible chargers and real connector states.
5. Select a charger and review known pricing.
6. Send start request and wait for a real session to appear.
7. Monitor actual status, power, energy, elapsed time, and available cost.
8. Stop or detect external completion.
9. Fetch enriched final session detail/settlement.
10. Make the record available through history and invoices.

## 5. API-to-screen contract map

| API | Intended mobile surface | Current state |
|---|---|---|
| `POST /api/driver/login` | Login | Connected. |
| `GET /api/driver/me` | Bootstrap/profile | Connected. |
| `PATCH /api/driver/me` | Display name/locale | Connected in local work. |
| `POST /api/driver/claim-invite` | First-run invite claim | Missing. |
| `POST /api/driver/redeem-invite` | Authenticated access redemption | Missing. |
| `GET /api/driver/chargers` | Home/access list | Connected. |
| `GET /api/driver/chargers/:id/pricing` | Charger confirmation/tariff detail | Missing; list only uses `priceLabel`. |
| `POST /api/driver/start-session` | Start charging | Connected. |
| `GET /api/driver/sessions/current` | Active-session recovery/polling | Connected incorrectly. |
| `POST /api/driver/stop-session` | Active session | Connected, dependent on current-session correction. |
| `GET /api/driver/sessions/history` | History | Present in local uncommitted work. |
| `GET /api/driver/invoices` | Receipts/invoices | Present in local uncommitted work. |
| `GET /api/driver/sessions/:id` | Final settlement/session detail | Missing. |
| `GET /api/driver/installations` | Access view | Missing; home derives locations from chargers. |
| `POST /api/driver/access-requests` | Self-service access | Missing and outside immediate invited-driver path. |

No driver-owned vehicle CRUD or driver Autocharge-enrolment route was found.
Adding either is a backend/API decision requiring explicit approval.

## 6. Proposed information architecture

Use a driver-first structure with one primary home and a restrained menu:

- Home
  - active session recovery, when present
  - nearby/accessible charging locations
  - charger state and start action
- Activity
  - charge history
  - session detail and settlement
  - receipts/invoices
- Access
  - organisations/installations
  - redeem invite
  - RFID/vehicle identity when real
- Account
  - profile
  - My Vehicle market version
  - language
  - support, privacy, terms, sign out

Charger administration should not appear in the normal driver navigation.
If retained for field service, place it behind a role/capability gate or a
separate service entry point.

## 7. My Vehicle market boundary

The live market page should eventually show only persisted, truthful fields:

- registration;
- make and model;
- primary vehicle;
- real Autocharge identity/status, when available;
- a clean white default vehicle render.

Until a driver vehicle contract exists, the live screen must not imply that
local edits were saved. The parked concept remains the reference for future
catalogue, colour, plate, and material work.

## 8. Prioritised implementation slices

### Slice P0.1: Verify and align active-session contract and recovery

- Verify the deployed response against the current route and record the result.
- Parse `{sessions: [...]}` correctly if the route is authoritative.
- Define behaviour if multiple active sessions are returned.
- Check current session at home/bootstrap and expose recovery.
- Keep loading, no-session, transient-error, stopping, and ended states.
- Add client and widget tests.

Acceptance: a returning driver with an in-progress session can always reach
the real active session; an idle driver is never shown a fictitious session.

### Slice P0.2: ADR 0053 mobile invite flow

- Reuse code/QR capture.
- Implement claim, login, and authenticated redemption states.
- Preserve anti-enumeration semantics and server messages.
- Remove the current contract ambiguity from the empty-access funnel.

Acceptance: a passwordless invited driver can become the bound user and gain
the intended DriverGroup access; an established driver can log in and redeem.

This is confirmed net-new mobile scope, not a regression. It is the only
remaining client gap in the already-secured invite contract and becomes P0.1
instead if self-service driver onboarding is required for customer 1.

### Slice P0.3: Final session truth

- Add session-detail client and screen.
- Replace the in-memory ended summary with the enriched final record.
- Show pending/uncosted rather than zero.
- Display only cost components actually returned by the API.

Acceptance: after stop/disconnect, the driver can understand energy, duration,
status, and available cost without fabricated line items.

### Slice P0.4: Commit-quality net-new history and invoices

- Review the current local implementation against exact API DTOs and units.
- Add pagination, detail navigation, empty/error states, and tests.
- Distinguish charge records from actual invoice documents and collection.

Acceptance: history and invoiceable sessions are reliable mobile features,
not untracked prototypes.

### Slice P1: Navigation, profile, localisation, and support

- Simplify the menu around Home, Activity, Access, and Account.
- Gate or remove service-only charger settings from driver navigation.
- Externalise all visible copy and complete English/Icelandic coverage.
- Provide a real support destination and product/legal information.

### Slice P1: My Vehicle market version

Blocked on an approved persistence/identity contract. Once approved, build the
minimal white-first page and keep the full configurator parked.

## 9. Backend/API changes requiring explicit approval

The following cannot be completed truthfully through visual/mobile-only work:

1. Driver-owned vehicle list/create/update/delete endpoints.
2. Primary-vehicle persistence.
3. Paint colour and finish persistence.
4. Driver-visible Autocharge enrolment/status and safe identity projection.
5. Itemised settlement fields not already returned by session detail.
6. Plug-time countdown/tariff clauses if pricing does not expose them.
7. Invoice document, delivery, and collection-status APIs.
8. Push notification registration and event delivery.
9. Role/capability contract for field-service charger settings.

None of these backend changes are authorised by this assessment.

## 10. Immediate recommendation

First run the active-session contract check on the connected handset and live
environment. If self-service invite acceptance is required for customer 1,
implement ADR 0053 mobile claim/login/redeem immediately after that narrow
verification. Otherwise finish active-session recovery first. Review this
baseline before changing navigation or replacing the live My Vehicle screen.
