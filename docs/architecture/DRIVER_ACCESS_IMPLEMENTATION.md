# Driver Access Implementation

Status: implementation-ready design note.

Purpose: make RFID Card, Mobile Tap, and In-App Start first-class driver authentication methods before the driver app is hardwired to Straumvakt.

## Product Shape

Driver Access has three methods:

| Method | Driver action | Technical entry point | Primary OCPP behavior |
|---|---|---|---|
| RFID Card | Tap physical card on charger reader | Charger sends `Authorize(idTag)` | Accept or reject idTag |
| Mobile Tap | Tap phone on charger reader | Charger sends `Authorize(idTag)` from phone credential | Accept or reject idTag |
| App Start | Press Start in driver app | Driver API creates remote-start command | `RemoteStartTransaction` |

No QR flow is included.

## Architecture Rule

RFID Card and Mobile Tap are charger-initiated authentication.

In-App Start is Straumvakt-initiated control.

All three authenticate the same driver identity and resolve to the same authorization decision model:

```text
Driver -> DriverCredential -> DriverContract / policy -> AuthorizeResult
```

The mobile app is only a presentation client. It does not speak directly to the OCPP Gateway, Neon, or Queues.

## Proposed Schema

Add a `people.driver_credentials` table. It should store hashes only; never store raw card IDs or raw mobile tap secrets after enrollment.

```prisma
enum DriverCredentialType {
  rfid_card
  mobile_tap
  app_start

  @@schema("people")
}

enum DriverCredentialStatus {
  pending
  active
  suspended
  revoked
  expired

  @@schema("people")
}

model DriverCredential {
  id             String                 @id @default(uuid()) @db.Uuid
  orgId          String                 @map("org_id") @db.Uuid
  userId         String                 @map("user_id") @db.Uuid
  type           DriverCredentialType
  tokenHash      String                 @map("token_hash")
  publicTokenRef String?                @map("public_token_ref")
  label          String?
  status         DriverCredentialStatus @default(pending)
  validFrom      DateTime               @default(now()) @map("valid_from") @db.Timestamptz(6)
  expiresAt      DateTime?              @map("expires_at") @db.Timestamptz(6)
  lastUsedAt     DateTime?              @map("last_used_at") @db.Timestamptz(6)
  metadata       Json                   @default("{}") @db.JsonB
  createdAt      DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime               @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization   Organization           @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user           User                   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([orgId, tokenHash])
  @@index([orgId, userId, status])
  @@index([type, status])
  @@map("driver_credentials")
  @@schema("people")
}
```

Recommended relation additions:

```prisma
// User
driverCredentials DriverCredential[]

// Organization
driverCredentials DriverCredential[]
```

Optional later fields:

- `lastAuthorizedConnectorId`
- `lastRejectedReason`
- `rotatesAt`
- `issuedByUserId`
- `externalIssuer`

## Token Rules

For RFID Card:

- Normalize reader-provided `idTag`.
- Hash normalized value with server-side pepper.
- Match `people.driver_credentials.token_hash`.

For Mobile Tap:

- Android HCE can present a mobile credential if the reader supports ISO-DEP/APDU.
- iPhone HCE depends on Apple-managed entitlements and eligibility.
- Use short-lived or rotatable credentials where hardware permits.
- Store only a hash of the credential Straumvakt expects to see as `idTag`.

For App Start:

- No NFC token is required.
- The driver session token authenticates the app call.
- The backend may still create a `DriverCredential` row of type `app_start` as the driver's enabled app-start entitlement.

## Authorization Service

Add a shared authorization service used by both OCPP Authorize and driver remote start.

Suggested module:

```text
apps/api/src/services/driver-access.ts
```

Core functions:

```ts
type DriverAccessMethod = "rfid_card" | "mobile_tap" | "app_start";

type AuthorizeDriverInput = {
  orgId: string;
  method: DriverAccessMethod;
  rawToken?: string;
  userId?: string;
  connectorId?: string;
  chargingStationId?: string;
  occurredAt: Date;
};

type AuthorizeDriverResult =
  | { ok: true; userId: string; credentialId?: string; idTag: string }
  | { ok: false; reason: "unknown_token" | "revoked" | "expired" | "not_allowed" | "contract_missing" };
```

Resolution order:

1. Identify driver from credential or app session.
2. Verify credential status and validity window.
3. Verify driver may use the target organization/site/charger.
4. Resolve active `DriverContract` when billing/cost allocation is required.
5. Return OCPP-compatible authorization result.
6. Write audit/event log entry.

## API Routes

Driver app:

```text
GET  /api/driver/access-methods
POST /api/driver/start-session
POST /api/driver/stop-session
POST /api/driver/mobile-tap/issue
POST /api/driver/mobile-tap/rotate
POST /api/driver/mobile-tap/revoke
```

Operator/admin:

```text
GET    /api/admin/users/:id/driver-credentials
POST   /api/admin/users/:id/driver-credentials/rfid
POST   /api/admin/users/:id/driver-credentials/mobile-tap
PATCH  /api/admin/driver-credentials/:id
DELETE /api/admin/driver-credentials/:id
```

Internal OCPP authorization:

```text
POST /api/internal/driver-access/authorize
```

Expected internal body:

```json
{
  "orgId": "uuid",
  "identityId": "uuid",
  "connectorId": "uuid",
  "idTag": "reader-or-phone-token",
  "source": "ocpp_authorize"
}
```

## OCPP Mapping

RFID Card and Mobile Tap:

```text
Charger -> Authorize(idTag)
API Worker -> DriverAccess.authorize(rawToken)
API Worker -> Accepted / Blocked / Expired / Invalid
```

App Start:

```text
Driver App -> POST /api/driver/start-session
API Worker -> DriverAccess.authorize(userId, app_start)
API Worker -> OutboundCommand(controlDomain=remote_start)
Queue -> OCPP Gateway -> RemoteStartTransaction(idTag)
Gateway -> Charger
Gateway -> command_result event
```

The `idTag` used in `RemoteStartTransaction` should be a backend-issued app-start idTag mapped to the driver credential, not a raw mobile app session token.

## UI Requirements

Driver app:

- Access Methods screen with RFID Card, Mobile Tap, App Start.
- Active credential status.
- Start Charge screen for App Start.
- Active Session screen.
- Stop Session button.
- Rejected authorization reason shown in plain driver language.

Operator UI:

- User detail panel: Driver Access methods.
- Add/revoke RFID card.
- Enable/disable Mobile Tap.
- Enable/disable App Start.
- Last used timestamp and last charger/site.

## Security Requirements

- Store token hashes only.
- Use constant-time hash comparisons where practical.
- Do not expose raw RFID/mobile token values in API responses.
- Audit every issue, revoke, authorize, reject, remote start, and remote stop.
- Allow immediate revocation.
- Support expiry for mobile tap credentials.
- Rate-limit failed token authorization.

## Hardware Requirements

RFID Card:

- Works with existing charger RFID readers if they send an `idTag` through OCPP.

Mobile Tap:

- Requires phone HCE support and a reader that can read the phone-presented credential.
- Android is the realistic first implementation target.
- iOS support should be tracked separately because HCE is entitlement-controlled.

App Start:

- Requires charger support for remote start through the selected control plane.
- For OCPP this is `RemoteStartTransaction`.
- For vendor APIs this maps to the vendor start command if routed through vendor control.

## Implementation Checklist

1. Add `DriverCredential` schema and migration.
2. Add repository for driver credentials.
3. Add `driver-access` service.
4. Wire OCPP `Authorize` projection/handler to driver-access.
5. Add driver app API routes.
6. Add admin credential management API routes.
7. Add remote-start command creation for App Start.
8. Add event/audit entries.
9. Add operator UI management panel.
10. Add driver app Access Methods and Start Charge screens.
11. Add tests for unknown, active, revoked, expired, and contract-missing credentials.
12. Add simulator/hardware test for RFID first, Mobile Tap second, App Start third.

## Acceptance Criteria

- A physical RFID card can authorize a known driver.
- A revoked RFID card is rejected.
- App Start creates an outbound command and shows session state in the driver app.
- Mobile Tap has a feature flag and clear unsupported-device behavior.
- Every authorization path resolves the same driver identity.
- Session rows record `userId` and `idTag`.
- Billing can resolve the user's `DriverContract` after session stop.

