# Appendix 19F — API contract examples

**34 examples**, `AC-01`–`AC-25` across two parts. The brief asked for 20.

Every endpoint is labelled **EXISTS**, **EXISTS, changed** or **PROPOSED**, and
the label was checked against the route files rather than assumed. Most of
part 2 is `PROPOSED` — support contexts, the onboarding aggregate and the
agreement write surface do not exist yet.

**All identities are fixtures.** `driver-anna@example.test`,
`driver-bjorn@example.test`, `staff-carol@example.test`,
`admin-dagur@example.test`, `org_alpha` / `org_beta` / `org_gamma`, codes
`ALFA-1111` / `BETA-2222`. Passwords are always the literal `<redacted>`. No
real address, name, secret or token appears anywhere in this document.

**One convention correction.** The 18-series states that validation failures use
a single shape. They do not — **three** are live:

| Shape | Where |
|---|---|
| `{"error":"validation","issues":[…]}` | `invites.ts:90`, `admin/access-requests.ts:84`, `admin/onboarding.ts:17` |
| `{"error":"validation","message":"…"}` — no issues array | every `driver.ts` route: `:872-876`, `:1042`, `:1162` |
| `{"error":"validation_error","issues":[…]}` | `billing-rate-references.ts:101-113`, `billing-cost-factors.ts:59-70` |

Each example documents the shape its own endpoint actually returns rather than
flattening them. New endpoints are specified on the `issues` form. Related:
401 emits `{"error":"unauthorized"}` (`auth-middleware.ts:17`,
`require-permission.ts:52`), **not** `unauthenticated` as doc 10 §2 claims.

---

## Appendix 19F part 1 of 2 — API contract examples: invite consume, authenticated join, redeem invite, installation codes, access requests

Nineteen contract examples, AC-01..AC-19. Every **EXISTS** label was checked
against the route file named in its Notes on branch `docs/singular-onboarding-domain-packet`.
Every **PROPOSED** endpoint returned zero hits in `apps/api/src/routes/` — those
are specifications, not descriptions.

Conventions taken from source, not invented:

- Error bodies are `{"error":"<snake_case>"}`. Some routes add `message`
  (`driver.ts`, several in Icelandic), some add `issues` (`invites.ts:90`,
  `access-requests.ts:84`). The two are **not** interchangeable today: driver
  routes return `{"error":"validation","message":"…"}` (`driver.ts:1162`) while
  admin/public-invite routes return `{"error":"validation","issues":[…]}`
  (`invites.ts:90`). New endpoints below use the `issues` form.
- Driver routes authenticate with `Authorization: Bearer <access token>` via
  `requireDriver` (`apps/api/src/routes/public/driver.ts:100-112`); failure is
  `401 {"error":"unauthenticated","message":"Missing bearer token."}`.
- Admin routes authenticate with the session cookie via `requireAdmin`
  (`apps/api/src/lib/auth-middleware.ts:17`); failure is `401 {"error":"unauthorized"}`.
  Permission denial is `403 {"error":"forbidden","reason":"permission_missing","required":"<verb>"}`
  from `requirePermission` (`require-permission.ts:76-84`) or `assertPermission`
  (`:125-130`).
- Rate-limited routes return `429 {"error":"rate_limited","retry_after_sec":N,"limit":N}`
  plus a `Retry-After` header (`apps/api/src/lib/rate-limit.ts:135-142`).
- UUIDs are written `<uuid:label>`. Passwords and passphrases are `<redacted>`.

---

### AC-01 — `POST /api/public/invites/consume` — EXISTS, changed
**Auth** none (bearer token in body) · **Permission** none · **Idempotency** single-use token, CAS claim `updateMany where usedAt IS NULL` (`invites.ts:130-133`); replay is a 410, not a repeat 200 · **Frontend** unsafe

Request
```json
{ "token": "<opaque>", "password": "<redacted>" }
```

Success `200`
```json
{ "ok": true, "userId": "<uuid:anna>", "orgId": "<uuid:org_alpha>", "email": "driver-anna@example.test" }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | body fails `ConsumeBody` (`invites.ts:36-39`) |
| 400 | `{"error":"malformed_metadata"}` | token metadata missing `orgId` or `email` — **changed** from 500 (A13) |
| 404 | `{"error":"not_found"}` | no such token hash, or `kind !== "invite"` |
| 409 | `{"error":"already_claimed"}` | **new (A01/A03)** — `UserCredential` row already exists for the bound user; `usedAt` stays null |
| 410 | `{"error":"already_used"}` | `usedAt` non-null, or CAS claim lost the race |
| 410 | `{"error":"expired"}` | `expiresAt <= now` |

**Audit:** on success `membership.invite_accepted`, `actorKind:"user"`, `actorUserId = row.userId`, `targetType:"user"`, `metadata.tokenId` (`invites.ts:161-169`). On the new 409, A04 wants a refusal row whose actor is **not** the invitee — see Notes. · **Notes:** three changes to `invites.ts` relative to the branch: guard `userCredential` existence **before** the claim at `:130`; replace `upsert` (`:142-146`) with `create`; extend the status map at `:180`, which today collapses every non-`not_found` reason to 410. `ConsumeBody` is deliberately left non-strict — `apps/mobile/lib/api/client.dart:101-105` posts a third field `kennitala` that the server silently drops, and making it strict (A10) 400s every shipped mobile redemption. Frontend is `unsafe` because that same client has no branch for `already_claimed` (`client.dart:122-137`), so today's app would surface a generic failure on the new 409.

---

### AC-02 — `GET /api/public/invites/peek?token=<plaintext>` — EXISTS, changed
**Auth** none (bearer token in query string) · **Permission** none · **Idempotency** pure read, no state change · **Frontend** read-only

Request: `GET /api/public/invites/peek?token=<opaque>`

Success `200`
```json
{ "invite": { "orgId": "<uuid:org_alpha>", "orgDisplayName": "org_alpha", "role": "host_admin", "email": "driver-anna@example.test", "expiresAt": "2026-08-15T09:00:00.000Z" } }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"token_required"}` | `token` query param absent or empty (`invites.ts:43-45`) |
| 400 | `{"error":"malformed_metadata"}` | **changed** from 500 (`invites.ts:69`) |
| 404 | `{"error":"not_found"}` | unknown hash or `kind !== "invite"` |
| 410 | `{"error":"already_used"}` | `usedAt` non-null |
| 410 | `{"error":"expired"}` | past `expiresAt` |

**Audit:** none — peek writes no audit row today. · **Notes:** this route puts the plaintext invite token in a URL, so it lands in access logs and `Referer`. It is also completely unthrottled: `publicInvites` registers no middleware, so neither `/peek` nor `/consume` is rate-limited, making the 404-versus-410 split a free token-existence oracle. Any rate limit added here inherits the fail-open behaviour of `rate-limit.ts:121-129` unless J06 lands first.

---

### AC-03 — `POST /api/driver/claim-invite` — EXISTS
**Auth** none (invite code in body) · **Permission** none · **Idempotency** none — the token is **not** consumed; a second call converges on 409 `already_claimed` because the credential now exists · **Frontend** hidden

Request
```json
{ "token": "<opaque>", "password": "<redacted>" }
```

Success `200`
```json
{ "ok": true, "email": "driver-anna@example.test" }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","message":"…"}` | body fails `claimInviteSchema` (`driver.ts:1024-1027`) |
| 404 | `{"error":"not_found","message":"Boð fannst ekki."}` | unknown hash, `kind !== "driver"`, or bound user not `active` |
| 409 | `{"error":"already_claimed","message":"…"}` | `row.user.credentials !== null` (`driver.ts:1089`) |
| 409 | `{"error":"security_unsupported","message":"…"}` | `security !== "none"` (`:1083`) |
| 410 | `{"error":"already_used"}` / `{"error":"expired"}` | token consumed or past expiry |
| 429 | `{"error":"rate_limited","retry_after_sec":60,"limit":10}` | 10 per IP per 60s, binding `DRIVER_LOGIN_RATE_LIMITER` (`:1031-1036`) |

**Audit:** `driver_invite.claimed`, `actorKind:"user"`, `actorUserId = row.userId`, `targetType:"user_token"`, `targetId = token.id`, `metadata.driverGroupId` — written **only when the token resolves a driver group** (`driver.ts:1107-1117`), because `audit.actions.org_id` is NOT NULL with an FK. · **Notes:** this is the bootstrap half of ADR 0053, and it is the credential guard that AC-01 needs to copy: `driver.ts:1089` refuses before any write and `:1096` uses `create`, not `upsert`. It deliberately leaks `already_claimed` as distinct from `not_found` (the header at `:1018-1022` argues the disclosure is bounded by 120 bits plus the rate limit). Frontend `hidden`: `apps/mobile/lib/api/client.dart` calls twelve `/api/driver/*` endpoints and this is not one of them.

---

### AC-04 — `POST /api/driver/redeem-invite` — EXISTS
**Auth** bearer (driver access token) · **Permission** none beyond identity binding · **Idempotency** the grant is idempotent (find-then-create, `driver.ts:1241-1251`) but the token is single-use via CAS (`:1254-1257`), so a replay by the same driver returns 410 · **Frontend** hidden

Request
```json
{ "token": "<opaque>" }
```

Success `200`
```json
{ "ok": true, "driverGroupId": "<uuid:group_alpha>", "driverGroupDisplayName": "org_alpha drivers", "installationDisplayName": "org_alpha site 1" }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","message":"Invite code required."}` | body fails `redeemInviteSchema` (`:1153-1156`) |
| 401 | `{"error":"unauthenticated","message":"…"}` | no or invalid bearer |
| 404 | `{"error":"not_found","message":"Boð fannst ekki."}` | unknown hash, wrong kind, **or identity mismatch** — byte-identical on purpose (`:1207-1229`) |
| 409 | `{"error":"security_unsupported","message":"…"}` | `security !== "none"` |
| 410 | `{"error":"already_used"}` / `{"error":"expired"}` | consumed or expired |
| 500 | `{"error":"malformed","message":"Boðið er ógilt."}` | token has no `driverGroupId` |

**Audit:** success `driver_invite.redeemed`, `actorKind:"user"`, `targetType:"driver_group"`, `metadata {tokenId, driverGroupId}` (`:1262-1270`). Identity mismatch writes `driver_invite.redemption_rejected` with `metadata {reason:"identity_mismatch", boundUserId, attemptedByUserId, driverGroupId}` (`:1213-1226`) — the distinct reason goes to audit, never to the caller. · **Notes:** the binding check runs **before** the claim so a stranger's failed attempt leaves `usedAt` null and the real invitee can still redeem. This is already covered against a real DB by `apps/api/test/parity/driver-invite-redemption-parity.test.ts` (scenarios 32-35). B02 should delegate here rather than re-derive it. Caveat: `repositories/user-tokens.ts:47` types `UserTokenKind` as `"invite" | "magic_link" | "password_reset"` — it cannot address `kind='driver'` at all, so any shared helper must widen that union first.

---

### AC-05 — `POST /api/driver/join` (`method:"invite"`) — PROPOSED
**Auth** bearer (driver access token) · **Permission** none beyond identity binding · **Idempotency** `Idempotency-Key` header, required; plus the CAS claim inherited from AC-04 · **Frontend** fixture

Request
```json
{ "method": "invite", "code": "<opaque>" }
```

Success `200`
```json
{ "outcome": "granted", "grantId": "<uuid:grant_anna_alpha>", "driverGroupId": "<uuid:group_alpha>", "installationDisplayName": "org_alpha site 1" }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | body fails the discriminated union on `method` |
| 400 | `{"error":"idempotency_key_required"}` | header absent (B06) |
| 401 | `{"error":"unauthenticated","message":"…"}` | no or invalid bearer (scenario 31) |
| 404 | `{"error":"not_available"}` | every failure cause: unknown code, wrong kind, identity mismatch, expired, consumed, unsupported security (B05, scenarios 33 and 39-42) |
| 409 | `{"error":"idempotency_key_conflict"}` | same key replayed with a different body |
| 429 | `{"error":"rate_limited","retry_after_sec":N,"limit":N}` | fail-**closed** limiter (J06) |

**Audit:** reuse AC-04's taxonomy verbatim — `driver_invite.redeemed` on success, `driver_invite.redemption_rejected` on identity mismatch. Add `metadata.joinMethod:"invite"` so B10's deprecation counter can separate `/join` traffic from the legacy route. · **Notes:** `POST /api/driver/join` does not exist and neither does `apps/api/src/routes/public/join.ts` — `routes/public/` holds only `driver.ts`, `driver-charger-pin.ts`, `driver-tap-intent.ts`, `email-verification.ts`, `host-applications.ts`, `invites.ts`, `password-reset.ts`, `register.ts`. Two contract regressions relative to AC-04 are deliberate and must be accepted explicitly: `not_available` collapses AC-04's 404/409/410 split into one status, and it changes the code a shipped client would branch on. No HTTP-level idempotency store exists anywhere in `apps/api/src` — `events.idempotency_keys` (`lib/db/raw.ts:249-320`) is the OCPP event pipeline's, keyed on event ids, and is not reusable as a request-replay cache.

---

### AC-06 — `POST /api/driver/join` (`method:"accessCode"`) — PROPOSED
**Auth** bearer (driver access token) · **Permission** none · **Idempotency** `Idempotency-Key` header, required (scenario 43) · **Frontend** fixture

Request
```json
{ "method": "accessCode", "code": "ALFA-1111", "passphrase": "<redacted>" }
```

Success `200` (org_alpha, automatic)
```json
{ "outcome": "granted", "grantId": "<uuid:grant_anna_alpha>", "driverGroupId": "<uuid:group_alpha>" }
```

Success `200` (org_beta, approval required — scenario 37)
```json
{ "outcome": "pending", "requestId": "<uuid:req_anna_beta>", "status": "pending" }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | missing `code` or `passphrase` |
| 401 | `{"error":"unauthenticated","message":"…"}` | no bearer |
| 404 | `{"error":"not_available"}` | wrong passphrase, unknown code, revoked credential, exhausted credential, org_gamma closed, invite-only mode — one body for all six (scenarios 38-42) |
| 429 | `{"error":"rate_limited","retry_after_sec":N,"limit":N}` | per-code bucket, fail-closed |

**Audit:** proposed `installation_access_credential.redeemed` on success and `…redemption_rejected` on failure, `actorKind:"user"`, `targetType:"installation_access_credential"`. Failure rows must carry the real reason in `metadata.reason` since the response cannot. · **Notes:** everything this method reads is greenfield — a repo-wide grep for `installation_access_credential` and `installationAccessCredential` across `.ts`, `.prisma`, `.sql` and `.dart` returns **zero** hits, so J01-J03 gate this endpoint. The org join modes the scenarios use (`automatic` / `approval_required` / `closed`) also do not exist under those names; the nearest shipped concept is `OrgEmailDomain.policy`, whose enum is `auto_join | request_approval | disabled` (`apps/api/src/routes/admin/org-email-domains.ts:53`), and that route is **not mounted** in `apps/api/src/index.ts` — it is unreachable in production. Per-code rate limiting has no binding: only `ADMIN_LOGIN_RATE_LIMITER` and `DRIVER_LOGIN_RATE_LIMITER` exist (`apps/api/wrangler.jsonc`), and `rate-limit.ts:121-129` currently fails **open** when a binding is missing, which is the opposite of scenario 127.

---

### AC-07 — `POST /api/driver/join` (`method:"request"`) — PROPOSED
**Auth** bearer (driver access token) · **Permission** none · **Idempotency** natural — an existing pending request for the same installation is returned with 200, not 409 (scenario 45) · **Frontend** fixture

Request
```json
{ "method": "request", "installationId": "<uuid:inst_alpha_1>" }
```

Success `200`
```json
{ "outcome": "pending", "requestId": "<uuid:req_anna_alpha>", "status": "pending", "createdAt": "2026-08-09T09:00:00.000Z", "alreadyExisted": false }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | `installationId` absent or not a uuid |
| 401 | `{"error":"unauthenticated","message":"…"}` | no bearer |
| 404 | `{"error":"not_available"}` | unknown installation, closed org, or the driver already has access — collapsed per B05 |
| 429 | `{"error":"rate_limited","retry_after_sec":N,"limit":N}` | fail-closed limiter |

**Audit:** `driver_access_request.created`, `actorKind:"user"` — reuse the existing action name written at `repositories/driver-access-requests.ts:267` rather than minting a second one. · **Notes:** this method wraps `createSelfRequest` (`driver-access-requests.ts:164-336`), which today returns `{error:"already_requested", existingRequestId}` and the route maps it to **409** (`driver.ts:913-921`). Scenario 45 requires 200 with the first request returned, so either `createSelfRequest` gains an `alreadyExisted` success branch or `/join` translates the 409 — pick one and apply it to AC-14 as well, or the two surfaces disagree. Note also that B05's `not_available` swallows `already_have_access`, which the legacy route reports distinctly; that is a real loss of client-side signal.

---

### AC-08 — `GET /api/driver/join-methods` — PROPOSED
**Auth** bearer optional (unauthenticated callers get the same list) · **Permission** none · **Idempotency** pure read · **Frontend** read-only

Success `200`
```json
{ "methods": ["invite", "accessCode", "request"], "serverVersion": "2026.08.1", "legacy": { "invitesConsume": "supported", "redeemInvite": "supported" } }
```

Errors

| Status | Body | When |
|---|---|---|
| 429 | `{"error":"rate_limited","retry_after_sec":N,"limit":N}` | shared public bucket |

**Audit:** none. · **Notes:** B08 / scenario 25. This endpoint is what makes scenario 22 ("new app, old server, `join` 404s, app falls back without crashing") testable without probing `/join` itself. It must be served by the API worker, not the web app: `src/app` on this branch contains only `home`, `org/[slug]` and `staff/overview`, and there is **no** `src/app/api` — the Next.js app has no route handlers at all. The `legacy` block is the input to B10's deprecation counter and B11's adoption gate; it is data, not enforcement.

---

### AC-09 — `POST /api/admin/installations/:installationId/access-credentials` — PROPOSED
**Auth** session cookie (`requireAdmin`) · **Permission** `site.write` · **Idempotency** `Idempotency-Key` header, optional; without it a repeat call mints a second credential · **Frontend** fixture

Request
```json
{ "label": "org_alpha front gate", "maxRedemptions": 50, "expiresAt": "2026-12-31T23:59:59.000Z" }
```

Success `201`
```json
{ "credential": { "id": "<uuid:cred_alfa>", "code": "ALFA-1111", "passphrase": "<redacted>", "label": "org_alpha front gate", "maxRedemptions": 50, "redemptionCount": 0, "status": "active", "expiresAt": "2026-12-31T23:59:59.000Z" } }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | body fails the schema |
| 401 | `{"error":"unauthorized"}` | no session |
| 403 | `{"error":"forbidden","reason":"permission_missing","required":"site.write"}` | verb absent |
| 404 | `{"error":"not_found"}` | installation absent (or in another tenant — same body) |
| 409 | `{"error":"code_collision"}` | generated code already taken; retry |

**Audit:** proposed `installation_access_credential.created`, `actorKind:"user"`, `actorUserId` = session userId, `targetType:"installation_access_credential"`, `targetId = credential.id`, `metadata {installationId, label, maxRedemptions, expiresAt}`. Never log the code or the passphrase. · **Notes:** J01-J03. `passphrase` is returned **exactly once** and is not retrievable afterwards (scenarios 121-122) — the shipped precedent is `POST /api/admin/installations/:id/ocpp-password/rotate` (`routes/admin/installations.ts:129-142`), which returns plaintext once and persists only a hash. Store PBKDF2 with a per-credential salt via `apps/api/src/lib/password.ts` (J02). One real gate: `requirePermission("site.write")` on this path is called **without** `orgIdParam`, exactly as the sibling ocpp-password routes are, so `resolveEffectivePermissions` is invoked with `orgId = null` (`require-permission.ts:70-75`, `effective-permissions.ts:157-160`) and no membership-derived permission resolves. As written, only platform-grant holders pass — an org's own `host_admin` is denied. If host self-service is intended, this route must resolve the installation's org first and use `assertPermission`, the same shape `routes/admin/access-requests.ts:178` uses. Also note that any grant holding `platform.tenant.write` (including `sales_cs`) expands into org-wide write verbs via `expandPlatformTenantVerbs` (`effective-permissions.ts:103-139`), so the blast radius of that choice is wider than it looks.

---

### AC-10 — `GET /api/admin/installations/:installationId/access-credentials` — PROPOSED
**Auth** session cookie · **Permission** `site.read` · **Idempotency** pure read · **Frontend** read-only

Success `200`
```json
{ "credentials": [ { "id": "<uuid:cred_alfa>", "code": "ALFA-1111", "label": "org_alpha front gate", "status": "active", "redemptionCount": 12, "maxRedemptions": 50, "expiresAt": "2026-12-31T23:59:59.000Z", "rotatedFromId": null, "revokedAt": null }, { "id": "<uuid:cred_beta>", "code": "BETA-2222", "label": "org_beta contractors", "status": "revoked", "redemptionCount": 3, "maxRedemptions": 10, "expiresAt": null, "rotatedFromId": null, "revokedAt": "2026-08-01T12:00:00.000Z" } ], "totals": { "active": 1, "revoked": 1, "expired": 0 } }
```

Errors

| Status | Body | When |
|---|---|---|
| 401 | `{"error":"unauthorized"}` | no session |
| 403 | `{"error":"forbidden","reason":"permission_missing","required":"site.read"}` | verb absent |
| 404 | `{"error":"not_found"}` | installation absent or cross-tenant |

**Audit:** none on read. · **Notes:** the response deliberately has no `passphrase` field at all — not `null`, absent — so scenario 122 fails loudly if a serializer ever regains it. `status` is derived (`revoked` beats `expired` beats `exhausted` beats `active`) rather than stored, so an exhausted credential does not need a background job to change state. `code` is safe to return to an authorised operator; it is the passphrase that is the secret half of the pair.

---

### AC-11 — `POST /api/admin/installations/:installationId/access-credentials/:credentialId/rotate` — PROPOSED
**Auth** session cookie · **Permission** `site.write` · **Idempotency** none — each call mints a new row; use `Idempotency-Key` to make a retry safe · **Frontend** fixture

Request
```json
{ "graceMinutes": 1440 }
```

Success `201`
```json
{ "credential": { "id": "<uuid:cred_alfa_v2>", "code": "ALFA-1111", "passphrase": "<redacted>", "rotatedFromId": "<uuid:cred_alfa>", "status": "active" }, "previous": { "id": "<uuid:cred_alfa>", "status": "grace", "graceEndsAt": "2026-08-10T09:00:00.000Z" } }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | `graceMinutes` out of range |
| 401 / 403 | as AC-09 | session or verb |
| 404 | `{"error":"not_found"}` | installation or credential absent, or credential belongs to another installation |
| 409 | `{"error":"already_revoked"}` | the source credential is revoked — rotate a live one or issue a new one |

**Audit:** proposed `installation_access_credential.rotated`, `targetId` = the **new** credential, `metadata {rotatedFromId, graceEndsAt}`. Emit a second row against the old credential so a per-credential timeline reads correctly. · **Notes:** J04, scenario 123 — both credentials must authorise a join during the grace window, which means AC-06's verify step resolves a **set** of candidate credentials for the code, not a single row. Rotation keeps the printed `code` stable and changes only the passphrase; that is what makes the grace window useful (the QR sticker on the wall does not change). Whether `code` can be rotated too is unverified as a product decision.

---

### AC-12 — `DELETE /api/admin/installations/:installationId/access-credentials/:credentialId` — PROPOSED
**Auth** session cookie · **Permission** `site.write` · **Idempotency** yes — revoking an already-revoked credential returns 200 with the original `revokedAt` · **Frontend** fixture

Success `200`
```json
{ "ok": true, "credential": { "id": "<uuid:cred_alfa>", "status": "revoked", "revokedAt": "2026-08-09T09:00:00.000Z" }, "grantsRetained": 41 }
```

Errors

| Status | Body | When |
|---|---|---|
| 401 / 403 | as AC-09 | session or verb |
| 404 | `{"error":"not_found"}` | installation or credential absent, or cross-installation |

**Audit:** proposed `installation_access_credential.revoked`, `actorKind:"user"`, `metadata {installationId, redemptionCountAtRevoke}`. · **Notes:** J05, scenarios 124-125 and 131-132. Revocation must be **credential-scoped only**: existing `DriverGroupMembership` rows survive untouched, so a live charging session is not stopped (scenario 131) and drivers who already joined keep working. The next join through that code returns AC-06's `not_available`. `grantsRetained` is returned specifically so an operator sees the number of people they did *not* cut off — the mistake this endpoint invites is assuming it revokes access.

---

### AC-13 — `POST /api/admin/installations/:installationId/access-credentials/revoke-all` — PROPOSED
**Auth** session cookie · **Permission** `site.write` · **Idempotency** yes — a second call revokes zero and returns `revoked: []` · **Frontend** disabled

Request
```json
{ "reason": "code sheet posted publicly" }
```

Success `200`
```json
{ "ok": true, "revoked": [ { "id": "<uuid:cred_alfa>", "code": "ALFA-1111" }, { "id": "<uuid:cred_beta>", "code": "BETA-2222" } ], "count": 2, "grantsRetained": 63 }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | `reason` missing or empty |
| 401 / 403 | as AC-09 | session or verb |
| 404 | `{"error":"not_found"}` | installation absent |

**Audit:** **one `installation_access_credential.revoked` row per credential** (scenario 126), all sharing `metadata.batchId` and `metadata.reason`, plus one `installation.access_credentials_revoked_all` summary row. Do not collapse the per-credential rows into the summary — the per-credential timeline is the thing an incident review reads. · **Notes:** J08. Frontend `disabled` means: render the control, keep it behind an explicit confirm that names the installation and the count, and never make it the default action next to AC-12. `reason` is mandatory and free text; it is the only field that survives into the incident record.

---

### AC-14 — `POST /api/driver/access-requests` — EXISTS, changed
**Auth** bearer (driver access token) · **Permission** none · **Idempotency** currently a 409 on repeat; **changed** to return the existing pending request with 200 (scenario 45) · **Frontend** hidden

Request
```json
{ "installationId": "<uuid:inst_alpha_1>" }
```

Success `201` (first request — unchanged)
```json
{ "accessRequest": { "id": "<uuid:req_anna_alpha>", "installationId": "<uuid:inst_alpha_1>", "status": "pending", "createdAt": "2026-08-09T09:00:00.000Z" } }
```

Success `200` (**changed** — repeat request)
```json
{ "accessRequest": { "id": "<uuid:req_anna_alpha>", "installationId": "<uuid:inst_alpha_1>", "status": "pending", "createdAt": "2026-08-09T09:00:00.000Z" }, "alreadyExisted": true }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","message":"installationId is required (uuid)."}` | body fails `accessRequestSchema` (`driver.ts:863-865`) |
| 401 | `{"error":"unauthenticated","message":"…"}` | no bearer, or `user_not_found` (`:922-927`) |
| 404 | `{"error":"not_found","message":"Installation not found."}` | `installation_not_found` |
| 409 | `{"error":"already_have_access"}` | active membership already covers the installation (`:910-912`) |
| ~~409~~ | ~~`{"error":"already_requested","existingRequestId":"…"}`~~ | **removed** — was `driver.ts:913-921`, now the 200 above |
| 500 | `{"error":"internal"}` | unmapped repo failure |

**Audit:** `driver_access_request.created` inside the transaction (`driver-access-requests.ts:263-270`); the driver receipt email and the org-main-contact notification are sent **outside** it (`:289`, `:314`) and fail open. · **Notes:** the repeat-request change touches `CreateSelfRequestFailure` (`driver-access-requests.ts:158-162`), not just the route. Two live caveats: the route has **no rate limit** — `publicDriver.post("/access-requests", requireDriver, …)` takes no `rateLimit` middleware, unlike `/claim-invite` and `/login` — and the repo reaches the table through a `PrismaClient & { driverAccessRequest: any }` cast (`driver-access-requests.ts:53-73`), so this work is typed against `any`. Frontend `hidden`: `apps/mobile/lib/api/client.dart` does not call this endpoint, and the receipt email links to `{baseUrl}/account/access-requests` (`:128-130`), a page that exists in neither `src/app/` nor the archived console.

---

### AC-15 — `GET /api/driver/access-requests` — PROPOSED
**Auth** bearer (driver access token) · **Permission** none — scoped to the caller's own `userId` from the token payload · **Idempotency** pure read · **Frontend** fixture

Success `200`
```json
{ "requests": [ { "id": "<uuid:req_anna_alpha>", "installationId": "<uuid:inst_alpha_1>", "installationDisplayName": "org_alpha site 1", "status": "pending", "createdAt": "2026-08-09T09:00:00.000Z", "reviewedAt": null, "denialReason": null } ], "totals": { "pending": 1, "approved": 0, "denied": 0, "withdrawn": 0 } }
```

Errors

| Status | Body | When |
|---|---|---|
| 401 | `{"error":"unauthenticated","message":"…"}` | no or invalid bearer |

**Audit:** none on read. · **Notes:** the driver half of the pair does not exist — the only list surface is the operator's `GET /api/admin/access-requests` (AC-17). This is the endpoint the approval and denial emails already link at (`buildDriverStatusUrl` → `/account/access-requests`, `driver-access-requests.ts:128-130`), so every one of those mails currently sends the driver to a 404. Disclosure rule (I05/I09): the driver sees the installation display name and their own request state, and nothing about the org's other members, chargers or groups. `reviewedBy` from `AccessRequestSummary` (`:110`) must **not** be projected here — an operator's identity is not the requester's business. `denialReason` is operator-written free text and is shown verbatim, so the deny UI copy in AC-19 needs to say so.

---

### AC-16 — `POST /api/driver/access-requests/:id/withdraw` — PROPOSED
**Auth** bearer (driver access token) · **Permission** none — the row's `userId` must equal the caller's · **Idempotency** yes — withdrawing an already-withdrawn request returns 200 with the original timestamp · **Frontend** fixture

Request: empty body (or `{ "reason": "found another charger" }`)

Success `200`
```json
{ "ok": true, "accessRequest": { "id": "<uuid:req_anna_alpha>", "status": "withdrawn", "withdrawnAt": "2026-08-09T10:00:00.000Z" } }
```

Errors

| Status | Body | When |
|---|---|---|
| 401 | `{"error":"unauthenticated","message":"…"}` | no bearer |
| 404 | `{"error":"not_found"}` | unknown id **or** a request belonging to another driver — one body, no ownership oracle |
| 409 | `{"error":"request_not_pending"}` | already approved or denied — matches the repo's existing failure name |

**Audit:** proposed `driver_access_request.withdrawn`, `actorKind:"user"`, `actorUserId` = the requester, `targetType:"driver_access_request"`. · **Notes:** scenario 134. `withdrawn` is a **write-dead enum value** today: it is declared in `packages/shared/src/db/commercial.ts:52` and accepted as a list filter at `routes/admin/access-requests.ts:71`, but no code path anywhere sets it, and there is no driver-side withdraw route. So this endpoint is the missing writer for a status the schema, the type union (`driver-access-requests.ts:86-90`) and the operator filter already know about — cheap to add, and the alternative is deleting the enum value. Withdrawing must not cascade: an approved request that already produced a `DriverGroupMembership` cannot be withdrawn (hence the 409), because that would silently revoke access through a driver-facing route.

---

### AC-17 — `GET /api/admin/access-requests?orgId=&status=&limit=` — EXISTS
**Auth** session cookie (`requireAdmin`, `access-requests.ts:48`) · **Permission** `member.write` on the queried org via `assertPermission` (`:90`) · **Idempotency** pure read · **Frontend** read-only

Request: `GET /api/admin/access-requests?orgId=<uuid:org_alpha>&status=pending&limit=50`

Success `200`
```json
{ "requests": [ { "id": "<uuid:req_anna_alpha>", "userId": "<uuid:anna>", "userEmail": "driver-anna@example.test", "userDisplayName": null, "installationId": "<uuid:inst_alpha_1>", "installationDisplayName": "org_alpha site 1", "siteDisplayName": "org_alpha site", "triggeredBy": "self_request", "status": "pending", "denialReason": null, "orgEmailDomain": null, "createdAt": "2026-08-09T09:00:00.000Z", "reviewedAt": null, "reviewedBy": null, "resultingMembershipId": null } ], "totals": { "pending": 1, "approved": 0, "denied": 0, "withdrawn": 0 } }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | `orgId` not a uuid, bad `status`, `limit` outside 1-200 (`ListQuery`, `:68-74`) |
| 401 | `{"error":"unauthorized"}` | no session |
| 403 | `{"error":"forbidden","reason":"permission_missing","required":"member.write"}` | verb absent for that org |

**Audit:** none on read. · **Notes:** `status` defaults to `pending`. The gate is a **read** guarded by a **write** verb, which is deliberate (only someone who could approve should see the queue) but means `member.read` holders see nothing — worth confirming as policy. Two enforcement caveats that apply to AC-17 through AC-19 together: `assertPermission` is a second, parallel enforcement seam from the `requirePermission` middleware factory, so a guard added only to the factory leaves these three routes open (`require-permission.ts:106-134`; live call sites are `access-requests.ts:90` and `:178`); and both seams return early for a bootstrap session (`:55-59` and `:115-117`) — `sub === "admin"` with no `userId` skips the permission check entirely.

---

### AC-18 — `PATCH /api/admin/access-requests/:id` (`action:"approve"`) — EXISTS
**Auth** session cookie · **Permission** `member.write` on the request's parent org, resolved by looking up `installation.orgId` first (`access-requests.ts:156-179`) · **Idempotency** yes — an already-approved request whose `resultingMembershipId` still resolves returns the same membership with `alreadyExisted: true` (`driver-access-requests.ts:514-526`) · **Frontend** hidden

Request
```json
{ "action": "approve" }
```

Success `200`
```json
{ "ok": true, "membership": { "id": "<uuid:grant_anna_alpha>", "driverGroupId": "<uuid:group_alpha>" }, "alreadyExisted": false }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"validation","issues":[…]}` | body fails `PatchBody` (`:106-112`) |
| 401 | `{"error":"unauthorized"}` | no session |
| 401 | `{"error":"session_missing_userid_relogin_required"}` | session has no `userId` — no reviewer to record (`:143-148`) |
| 403 | `{"error":"forbidden","reason":"permission_missing","required":"member.write"}` | verb absent |
| 404 | `{"error":"request_not_found"}` | unknown id |
| 409 | `{"error":"request_not_pending"}` | denied or withdrawn (`driver-access-requests.ts:534-539`) |
| 409 | `{"error":"installation_org_mismatch"}` | request's org differs from the asserted one (`:507-512`) |
| 422 | `{"error":"no_driver_group_for_installation"}` | no active agreement yields a group (`:564-566`) |

**Audit:** `driver_access_request.approved` inside the transaction (`:619`), approval email outside it (`:648`). · **Notes:** group selection is **smallest member count, ties broken by group `createdAt` asc** (`:541-570`) — deterministic and re-runnable, but it is load-spreading policy that nobody has ratified; two installations under one agreement will not co-locate a household. Scenario 130 ("two concurrent approvals give one grant and one 409") does **not** hold as written: `approveRequest` does a read-then-create inside the transaction (`:576-599`) with no unique-constraint fallback, so the loser surfaces a raw Postgres unique violation, not a 409 — assuming `driverGroupId_userId` is unique at all. The same read-then-create shape is in `createMembership` (`driver-group-memberships.ts:53-79`). Frontend `hidden`: `buildOperatorInboxUrl` points at `/people/access-requests` (`:140-142`), which exists in neither `src/app/` nor `archive/straumvakt-org-console-2026-08-08/`.

---

### AC-19 — `PATCH /api/admin/access-requests/:id` (`action:"deny"`) — EXISTS
**Auth** session cookie · **Permission** `member.write` on the request's parent org · **Idempotency** none — a second deny returns 409 `request_not_pending` · **Frontend** hidden

Request
```json
{ "action": "deny", "denialReason": "not a resident of this building" }
```

Success `200`
```json
{ "ok": true }
```

Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error":"denial_reason_required","issues":[…]}` | `denialReason` missing or blank — split out from generic validation at `access-requests.ts:126-137` |
| 400 | `{"error":"validation","issues":[…]}` | any other schema failure |
| 401 | `{"error":"unauthorized"}` or `{"error":"session_missing_userid_relogin_required"}` | no session, or session without `userId` |
| 403 | `{"error":"forbidden","reason":"permission_missing","required":"member.write"}` | verb absent |
| 404 | `{"error":"request_not_found"}` | unknown id |
| 409 | `{"error":"request_not_pending"}` | already approved, denied or withdrawn |
| 409 | `{"error":"installation_org_mismatch"}` | cross-tenant |

**Audit:** `driver_access_request.denied` inside the transaction with the reason recorded (`driver-access-requests.ts:745`), denial email outside it (`:767`). This satisfies scenario 133 ("a rejection records a reason code") for the **stored** reason; there is no controlled vocabulary — `denialReason` is `z.string().trim().min(1).max(500)` (`access-requests.ts:110`), free text. If scenario 133 means an enumerated code, that is a schema change, not a copy change. · **Notes:** the success body is bare `{"ok":true}` and returns no updated row, so a UI must re-fetch AC-17 to refresh. `denialReason` is shown verbatim to the driver in the denial email and in AC-15 — the operator UI must say so at the point of entry, because an internal note written here becomes driver-visible text. Scenario 136 ("org closes, pending requests are not auto-rejected") needs no code: nothing bulk-denies today, so the behaviour is correct by absence, and any future close-org flow must not add one.
## Appendix 19F part 2 of 2 — API contract examples: support context, onboarding aggregate, agreements, cost factors, attribution correction, audit read

Fifteen contract examples, **AC-11 … AC-25**. Part 1 held AC-01 … AC-10; this part
runs to AC-25 because the six areas named for it do not compress into ten
endpoints without merging unrelated error tables.

**Every endpoint in this part is PROPOSED.** Exactly one has a live
implementation to wrap (AC-23, which reuses `POST /api/admin/agreements/debug-resolve`,
`apps/api/src/routes/admin/agreements-debug.ts:89`). Nothing else here exists:
no support-context table, module, column or call site; no onboarding aggregate
of any kind; no agreement write path anywhere under `apps/api/src`; no
cost-factor assignment surface on either cost-factor table; no attribution or
dispute record; no audit read route.

### Conventions used below

Verified against source, not against doc 10 §2:

- **401 body is `{ "error": "unauthorized" }`**, emitted by `requireAdmin`
  (`apps/api/src/lib/auth-middleware.ts:17`) and by `requirePermission`
  (`apps/api/src/lib/auth/require-permission.ts:52`). Doc 10 §2 says
  `unauthenticated`; no route emits that string. New endpoints should match the
  source, not the doc.
- **403 body is `{ "error": "forbidden", "reason": "permission_missing", "required": "<verb>" }`**
  (`require-permission.ts:76-83`, duplicated in `assertPermission` at `:124-129`).
- **429 body is `{ "error": "rate_limited", "retry_after_sec": n, "limit": n }`**
  with a `Retry-After` header (`apps/api/src/lib/rate-limit.ts:133-141`). The
  limiter **fails open** when the binding is absent (`:121-129`), so a 429 is not
  guaranteed to be reachable in any environment lacking the binding.
- **Validation** is either `{ "error": "validation", "issues": [...] }` at 400
  (`routes/admin/onboarding.ts:17`) or `{ "error": "validation_error", "issues": [...] }`
  at 400/422 (`billing-rate-references.ts:101-113`, `billing-cost-factors.ts:59-70`).
  Both spellings are live. New endpoints in the billing family should use
  `validation_error`; onboarding-family endpoints should use `validation`.
- **Idempotency-Key and If-Match have zero HTTP infrastructure.** A repo grep of
  `apps/api/src` returns no `If-Match` at all, and `Idempotency-Key` appears
  nowhere as a header. There *is* a reusable store — `events.idempotency_keys`
  (`packages/shared/src/db/platform.ts:74-88`: PK `(scope, key)`, `result` jsonb,
  `expiresAt`) — used today only by the OCPP batch ingest
  (`apps/api/src/lib/db/raw.ts:88-94`, `findExistingIdempotencyKeys`,
  `batchInsertIdempotencyKeys`). Every "Idempotency" line below means "should be
  built on that table"; none of it is wired to an HTTP route.
- **Fixture identities** `driver-anna@example.test`, `staff-carol@example.test`,
  `admin-dagur@example.test` and `org_alpha` / `org_beta` / `org_gamma` are used
  as readable aliases. Real columns are `uuid` (e.g. `agreements.agreements.id`,
  `packages/shared/src/db/commercial.ts:296`), and existing routes reject
  non-UUIDs at the door (`agreements-debug.ts:44`, `agreements-resolve.ts:30`),
  so the wire values are UUIDs; the aliases stand in for them.
- **Audit** lines name the `recordAuditAction` input shape
  (`apps/api/src/lib/audit.ts:26-34`: `orgId`, `actorUserId`, `actorKind`,
  `action`, `targetType`, `targetId`, `metadata`). That is the whole writer.
  `audit.actions` has **no** `support_context_id`, `on_behalf_of_org_id` or
  `reason` column (`packages/shared/src/db/platform.ts:91-108`), and `actorKind`
  has no `bearer` value (`:29`) — C10, C11, N02 and doc 10 §3.10's `reason` field
  all need a migration before any of the Audit lines below can be honoured in full.

---

### AC-11 — `POST /api/admin/support-contexts` (enter) — PROPOSED

**Auth:** admin session cookie (`requireAdmin`) · **Permission:** `platform.support.action` — declared in `PLATFORM_PERMISSIONS` (`apps/api/src/lib/auth/permissions.ts`) with **zero enforcement call sites**; this would be its first · **Idempotency:** `Idempotency-Key` required, scope `support_context.enter` · **Frontend:** support banner (18A group O); the banner has no data source today because `GET /api/admin/me` (`routes/admin/me.ts:33-81`) returns only a persona fork.

Request:

```json
{
  "organisationId": "org_alpha",
  "reason": "driver-anna@example.test cannot see her session history; ticket SV-1042",
  "breakGlass": false
}
```

Success `201`:

```json
{
  "supportContext": {
    "id": "sc_01",
    "organisationId": "org_alpha",
    "staffUserId": "staff-carol@example.test",
    "reason": "driver-anna@example.test cannot see her session history; ticket SV-1042",
    "breakGlass": false,
    "grantedPermissions": ["member.read", "charger.read", "billing.read"],
    "openedAt": "2026-08-09T09:00:00Z",
    "expiresAt": "2026-08-09T11:00:00Z"
  }
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation` | `reason` absent, empty, or under a minimum length (scenario 53) | new zod schema; no precedent |
| `401 unauthorized` | no admin cookie | `auth-middleware.ts:17` |
| `403 forbidden` | caller lacks `platform.support.action` (scenario 59) | `require-permission.ts:76-83` |
| `404 not_found` | `organisationId` unknown — must not distinguish "exists but invisible" | doc 10 §3.1 rule, no source precedent |
| `409 already_open` | caller already holds an open context for a different org | new; needs a partial unique index on (staffUserId, closedAt IS NULL) |
| `429 rate_limited` | limiter binding present and tripped | `rate-limit.ts:133-141` |

**Audit:** one row, `action: "support_context.opened"`, `orgId` = the *target*
org (`org_alpha`), `actorUserId` = staff-carol's userId, `actorKind: "user"`,
`targetType: "support_context"`, `targetId` = the new context id,
`metadata: { reason, breakGlass, expiresAt }`. Scenario 49 wants
`onBehalfOfOrgId` and `supportContextId` as first-class columns — neither exists;
until C10/C11 land, `orgId` carrying the target org is the only honest
approximation, and it collides with the "actor's own org" reading used elsewhere.

**Notes.**
1. Doc 10 §3.9 names the verb `platform.support.enter`. **That verb does not
   exist.** `PLATFORM_PERMISSIONS` has `platform.support.action` and no
   `platform.support.*` sibling. Use the verb that exists or add the new one
   deliberately.
2. The context cannot live on `identity.platform_grants`: its PRIMARY KEY is
   `user_id` (`packages/shared/src/db/identity.ts:386-389`), so one user has at
   most one grant and it cannot be org-bound. C01's new table is mandatory. The
   unused `scope` jsonb on that table (`:398`) is a tempting shortcut that still
   cannot express two concurrent contexts.
3. Expiry has a working precedent to copy: `getActivePlatformGrant`
   (`apps/api/src/lib/auth/effective-permissions.ts:65`, expiry check at `:84`)
   already filters on `expiresAt` per request.
4. `grantedPermissions` in the response is a **projection**, not a grant. The
   resolver (`resolveEffectivePermissions`, `effective-permissions.ts:154`)
   returns a flat verb list and discards whether a verb came from a membership or
   from `expandPlatformTenantVerbs` (`:103-139`). Any guard that must distinguish
   "membership-derived" from "platform-derived" (C03, scenario 52) needs the
   resolver to return provenance, which it does not.

---

### AC-12 — `GET /api/admin/support-contexts/current` (read) — PROPOSED

**Auth:** admin session cookie · **Permission:** none beyond a valid session — a caller must always be able to read their own context, including after it expires · **Idempotency:** n/a (read) · **Frontend:** the banner in scenario 60 needs org name, staff email, reason and expiry from exactly this call.

Request: none.

Success `200` (open context):

```json
{
  "supportContext": {
    "id": "sc_01",
    "organisationId": "org_alpha",
    "organisationDisplayName": "Alpha fixture org",
    "staffEmail": "staff-carol@example.test",
    "reason": "driver-anna@example.test cannot see her session history; ticket SV-1042",
    "breakGlass": false,
    "expiresAt": "2026-08-09T11:00:00Z",
    "secondsRemaining": 4211
  }
}
```

Success `200` (no context — deliberately not 404):

```json
{ "supportContext": null }
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `401 unauthorized` | no admin cookie | `auth-middleware.ts:17` |

**Audit:** none. Reads are not audited anywhere in the codebase today; adding a
read audit here would be the first, and N05's taxonomy has no name for it.

**Notes.**
1. 18A C08 says "Returns or 404". Returning `{ "supportContext": null }` at 200
   is the better contract: scenario 61 requires the UI to stop offering mutations
   *before* the server rejects them, which means polling this endpoint, and a 404
   poll loop is indistinguishable from an outage. Flagged as a deliberate
   divergence from C08.
2. `secondsRemaining` must be computed server-side from the same clock the guard
   uses. There is no clock abstraction in `lib/auth/`; every module calls
   `new Date()` directly (e.g. `effective-permissions.ts:84`), so a test for
   scenario 51 ("expired mid-session") has nothing to inject.
3. `staffEmail` in the body is the actor's own address, so it is not a
   disclosure. Do not add the *target org's* member emails here — doc 10 §3.11's
   disclosure discipline applies.

---

### AC-13 — `POST /api/admin/support-contexts/:id/exit` — PROPOSED

**Auth:** admin session cookie · **Permission:** ownership of the context (staffUserId match), **not** a verb — a support agent whose grant was revoked mid-context must still be able to close it · **Idempotency:** naturally idempotent; a second exit returns 200 with `alreadyClosed: true` rather than 409 · **Frontend:** banner "End support session" button.

Request:

```json
{ "note": "resolved; nothing changed on org_alpha" }
```

Success `200`:

```json
{
  "supportContext": {
    "id": "sc_01",
    "organisationId": "org_alpha",
    "closedAt": "2026-08-09T09:34:00Z",
    "closedBy": "staff",
    "alreadyClosed": false
  }
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `401 unauthorized` | no admin cookie | `auth-middleware.ts:17` |
| `403 forbidden` | context belongs to another staff user | new check; `require-permission.ts` has no ownership concept |
| `404 not_found` | unknown context id | new |

**Audit:** `action: "support_context.exited"`, `orgId` = target org,
`actorUserId` = staff-carol, `actorKind: "user"`,
`targetType: "support_context"`, `targetId` = `sc_01`,
`metadata: { note, closedBy: "staff", durationSeconds }`.

**Notes.**
1. Scenario 56 ("further actions 403") only holds if the guard reads the context
   row **per request**. The admin session cookie is a 12h HMAC
   (`apps/api/src/lib/admin-session.ts`, `adminSessionConfig` at `:106`) with no
   revocation path, so the context must never be encoded in the cookie — a
   cookie-borne context cannot be exited.
2. The guard must be added to **both** enforcement seams. `requirePermission`
   (`require-permission.ts:45-89`) is middleware; `assertPermission` (`:106-134`)
   is a plain function called directly from `routes/admin/access-requests.ts:90`
   and `:178`. A guard in the middleware only leaves those two paths open.
3. Both seams early-return before any new guard could run:
   `require-permission.ts:55-59` and `assertPermission` `:115-117` both
   `return next()` / `return null` for `isBootstrapSession` (`:147-151`:
   `sub === "admin"` **and** no userId). The login route now always stamps
   `userId` (`routes/admin/auth.ts:134-137`), so a fresh cookie takes the real
   path — but any session minted without `userId` bypasses the context check
   entirely. Placing the guard *before* the bootstrap branch is the only safe
   ordering, and that changes bootstrap behaviour.

---

### AC-14 — `POST /api/admin/support-contexts/:id/extend` — PROPOSED

**Auth:** admin session cookie · **Permission:** `platform.support.action` plus ownership · **Idempotency:** `Idempotency-Key` required, scope `support_context.extend`; a replay returns the same `expiresAt` rather than extending twice · **Frontend:** banner countdown offers "Extend" under a threshold (18A C15).

Request:

```json
{
  "reason": "session export still running; ticket SV-1042",
  "additionalMinutes": 60
}
```

Success `200`:

```json
{
  "supportContext": {
    "id": "sc_01",
    "organisationId": "org_alpha",
    "previousExpiresAt": "2026-08-09T11:00:00Z",
    "expiresAt": "2026-08-09T12:00:00Z",
    "extensionCount": 1,
    "breakGlass": false
  }
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation` | `reason` missing, or `additionalMinutes` outside the allowed range | new zod schema |
| `403 forbidden` | lacks the verb, or context belongs to another staff user | `require-permission.ts:76-83` |
| `409 context_closed` | context already exited | new |
| `409 context_expired` | context expired before the extend arrived — must re-enter, not extend | new; distinct from `context_closed` so the UI can offer AC-11 |
| `422 extension_limit_reached` | max extensions or max total TTL exceeded | new |
| `422 break_glass_not_extendable` | `breakGlass: true` contexts carry a shorter TTL by design (C13, scenario 57) | new |

**Audit:** `action: "support_context.extended"`, `metadata: { reason,
previousExpiresAt, expiresAt, extensionCount }`. C15's acceptance is "extension
audited"; the new `reason` must be stored on the *event*, not by overwriting the
context's original reason, or the entry justification is lost.

**Notes.**
1. Unbounded extension defeats C05 entirely. Both a per-extension cap and an
   absolute-since-open cap are needed; neither has a precedent value in source to
   copy.
2. `403 support_context_expired` (C04's distinct code) belongs on the *guarded*
   routes, not here. On this route an expired context is a 409, because the
   resource exists and the correct next action is AC-11, not re-entry into the
   same row.

---

### AC-15 — `GET /api/admin/orgs/:orgId/onboarding` (aggregate read) — PROPOSED

**Auth:** admin session cookie · **Permission:** `org.read` with `orgIdParam: "orgId"`, plus a support context for platform-derived callers · **Idempotency:** n/a (read) · **Frontend:** Codex `OnboardingSummary`; scenario 112 requires "This isn't tracked yet" when the workflow is absent, not a derived progress bar.

Request: none.

Success `200`:

```json
{
  "workflowId": "wf_alpha_1",
  "organisationId": "org_alpha",
  "state": "in_progress",
  "nextActor": "organisation",
  "version": 7,
  "steps": [
    {
      "key": "organisation",
      "state": "complete",
      "owner": "organisation",
      "updatedAt": "2026-08-09T10:00:00Z",
      "substeps": [
        { "key": "org_identity", "state": "complete" },
        { "key": "legal_contact", "state": "skipped", "skipReason": "supplied offline" }
      ]
    },
    { "key": "commercial", "state": "pending", "owner": "organisation", "substeps": [] }
  ]
}
```

Success `200` when no workflow has ever been started:

```json
{ "workflowId": null, "organisationId": "org_alpha", "state": "untracked", "version": 0, "steps": [] }
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `401 unauthorized` | no admin cookie | `auth-middleware.ts:17` |
| `404 not_found` | org unknown **or** invisible to the caller — never 403, which would confirm existence | doc 10 §3.1 |

**Audit:** none (read).

**Notes.**
1. Fully greenfield. A repo-wide grep for `onboarding_workflow`,
   `onboarding_step`, `onboarding_substep` and `onboardingWorkflow` across
   `*.ts`, `*.prisma` and `*.sql` returns zero hits outside `docs/`.
   `apps/api/src/routes/admin/orgs.ts` registers 23 handlers and none of them is
   an `/onboarding` sub-route; the router is mounted at `/api/admin/orgs`
   (`apps/api/src/index.ts:128`).
2. The `state: "untracked"` variant is what makes scenario 112 implementable
   without the UI guessing. It is not in doc 10 §3.1 — flagged as an addition.
3. The seven step keys and thirteen substep keys (G03, G04) are named in doc 10
   §1 only. **Unverified against any source artefact** — there is no enum, no
   constant, no type. Whoever implements G03 is authoring that list, not
   transcribing it.
4. `prisma/schema.prisma` is not a file. The schema is the folder
   `prisma/schema/` (8 `.prisma` files); `apps/api/prisma/schema/` is a generated
   copy. New models go in the folder, and the copy must be regenerated.

---

### AC-16 — `POST /api/admin/orgs/:orgId/onboarding` (start / resume) — PROPOSED

**Auth:** admin session cookie · **Permission:** `org.write` with `orgIdParam: "orgId"` · **Idempotency:** `Idempotency-Key` **required**; a replay returns the existing workflow with `created: false` · **Frontend:** "Start onboarding" on the org detail page.

Request:

```json
{ "startedBy": "staff", "note": "kickoff call held with org_alpha" }
```

Success `201` (created) / `200` (resumed):

```json
{
  "created": false,
  "workflowId": "wf_alpha_1",
  "organisationId": "org_alpha",
  "state": "draft",
  "version": 1,
  "steps": []
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation` | body fails the schema | `routes/admin/onboarding.ts:17` spelling |
| `400 idempotency_key_required` | header absent | new; no precedent |
| `403 forbidden` | lacks `org.write` for this org | `require-permission.ts:76-83` |
| `404 not_found` | org unknown or invisible | doc 10 §3.1 |
| `409 already_open` | a *different* Idempotency-Key targets an org that already has an open workflow (scenario 100) | needs the G02 partial unique index |
| `422 idempotency_key_reused` | same key, different request body | new; `events.idempotency_keys.result` can store the first response to compare |

**Audit:** `action: "onboarding_workflow.started"`, `orgId`, `actorUserId`,
`actorKind: "user"`, `targetType: "onboarding_workflow"`, `targetId` = workflow
id, `metadata: { startedBy, idempotencyKey }`. Scenario 110 requires `nextActor`
and the audit to reflect a staff actor — `actorKind` cannot express that
(`user | system | vendor_webhook | ocpp_worker`), so "staff" has to live in
`metadata` or in the new workflow row, not in the enum.

**Notes.**
1. Scenarios 100 and 101 are two different mechanisms and both are needed: the
   partial unique index makes a second *open* workflow impossible at the DB
   level, and the idempotency key makes a retried *same* request return the first
   result. Neither substitutes for the other.
2. The nearest live sibling is `POST /api/admin/onboarding/chains`
   (`routes/admin/onboarding.ts:13`, gated `charger.write`, mounted at
   `/api/admin/onboarding`, `index.ts:138`). It is a one-shot creator of
   Org → Property → Site → SiteAsset → ChargingStation → EVSE → Connector →
   OcppIdentity inside one transaction (`repositories/onboarding-chains.ts:51-199`)
   with no idempotency key and no workflow row. Decide explicitly whether
   `/chains` becomes a *step executor* under this aggregate or stays a parallel
   fast path; today it would create the org a second time.
3. `createOnboardingChain(db, parsed.data, null)` passes a literal `null` actor
   (`routes/admin/onboarding.ts:22`) while a session is in scope. Any new
   endpoint here must pass `sessionUserId(c.get("session"))`
   (`require-permission.ts:161-164`) or scenario 69 ("actor never from request
   input") is satisfied only vacuously, by having no actor at all.

---

### AC-17 — `PATCH /api/admin/orgs/:orgId/onboarding/steps/:stepKey` — PROPOSED

**Auth:** admin session cookie · **Permission:** `org.write` with `orgIdParam: "orgId"`; the `commercial` step additionally rejects support-context callers (scenario 62) · **Idempotency:** `Idempotency-Key` **and** `If-Match: <version>` both required · **Frontend:** step checklist; a 409 must re-render from the returned aggregate rather than re-fetching.

Request (headers `If-Match: 7`, `Idempotency-Key: 5f3c…`):

```json
{ "state": "skipped", "reason": "legal contact supplied offline", "payload": null }
```

Success `200`:

```json
{
  "workflowId": "wf_alpha_1",
  "organisationId": "org_alpha",
  "state": "in_progress",
  "version": 8,
  "changedStep": { "key": "legal_contact", "state": "skipped", "skipReason": "legal contact supplied offline" },
  "steps": []
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation` | unknown `state` value, or unknown `stepKey` | new |
| `400 skip_reason_required` | optional step skipped with no reason (scenario 104) | new |
| `403 step_not_permitted` | `commercial` submitted inside a support context (scenario 62, doc 05 §4) | new; needs the guard to know a context is active |
| `409 version_conflict` | `If-Match` does not match current `version` (scenario 102); body carries the **current** aggregate | new; no `If-Match` handling exists anywhere in `apps/api/src` |
| `422 step_not_skippable` | required step, `state: "skipped"` (scenario 103) | new |
| `428 if_match_required` | header absent | new; deliberate 428 so a missing header is not confused with a stale one |

**Audit:** `action: "onboarding_step.changed"`, `targetType: "onboarding_step"`,
`targetId` = step row id, `metadata: { stepKey, from, to, reason, version }`.
Scenario 155 ("exactly one audit event per state change") means the step change
and the derived workflow-state change must be **one** row, not two — a
step-completion that flips the workflow to `ready` still writes one event.

**Notes.**
1. `409 version_conflict` returning the current aggregate is what makes the UI
   recoverable. It doubles this endpoint's response type as AC-15's; keep them
   the same shape or the client needs two parsers.
2. `403 step_not_permitted` is the only place in the packet where a *step*, not a
   verb, is the permission unit. `requirePermission` takes a `Permission` from a
   closed union (`permissions.ts`), so this check cannot be expressed as a verb
   and must live inside the handler.
3. Scenario 107 ("non-active workflow, invite redeemed, refused") is **not**
   enforceable from this endpoint. The redemption path is
   `apps/api/src/routes/public/invites.ts` and it has no workflow lookup; G09 is a
   change to that route, not to this one. Note also that `ConsumeBody`
   (`invites.ts:36-39`) is a non-strict zod object over `{ token, password }` and
   the mobile client sends a third field, `kennitala`
   (`apps/mobile/lib/api/client.dart:101-105`), which is silently stripped —
   tightening that schema while adding a workflow check would 400 every mobile
   redemption.

---

### AC-18 — `POST /api/admin/agreements` (create draft) — PROPOSED

**Auth:** admin session cookie (`adminAgreementsDebug.use("*", requireAdmin)`, `agreements-debug.ts:31`) · **Permission:** `contract.write` — declared at `permissions.ts` and bundled into ADMIN and FINANCE, but guarding **zero routes** today; this would be its first call site (K11, D05) · **Idempotency:** `Idempotency-Key` recommended, scope `agreement.create` · **Frontend:** operator `/agreements` page, which is read-only today.

Request:

```json
{
  "agreementType": "installation",
  "counterpartyOrgId": "org_alpha",
  "cpoOrgId": "org_beta",
  "installationId": "inst_alpha_1",
  "displayName": "org_alpha depot — installation contract",
  "effectiveFrom": "2026-09-01T00:00:00Z",
  "effectiveUntil": null,
  "notes": "pilot"
}
```

Success `201`:

```json
{
  "agreement": {
    "id": "agr_01",
    "agreementType": "installation",
    "status": "draft",
    "counterpartyOrgId": "org_alpha",
    "cpoOrgId": "org_beta",
    "installationId": "inst_alpha_1",
    "displayName": "org_alpha depot — installation contract",
    "effectiveFrom": "2026-09-01T00:00:00Z",
    "effectiveUntil": null,
    "clauseCount": 0
  }
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation_error` | zod failure; `issues` array of `{ path, message }` | `billing-rate-references.ts:101-113` |
| `400 effective_dating_required` | `effectiveFrom` absent (K06, scenario 140) | new; the column is `notNull` at `commercial.ts:304` so the DB would reject it anyway with an opaque error |
| `403 forbidden` | lacks `contract.write` | `require-permission.ts:76-83` |
| `404 not_found` | unknown `counterpartyOrgId` or `installationId` | new |
| `422 agreement_type_not_in_pilot` | type outside `service_cpo` / `installation` | `repositories/agreements.ts:11` `PILOT_TYPES` |

**Audit:** `action: "agreement.created"`, `orgId` = `counterpartyOrgId`,
`targetType: "agreement"`, `targetId` = new id,
`metadata: { agreementType, effectiveFrom, installationId }` (K10).

**Notes.**
1. Greenfield. A grep of `apps/api/src` for `.agreement.create|update|delete|upsert`,
   `agreementClause.*` and `bearerRule.*` returns zero hits. The only agreement
   write in the whole repo is the one-off script
   `apps/api/scripts/supersede-orphan-b6771541.ts`.
   `apps/api/src/repositories/agreements.ts` declares itself read-only in its
   header (lines 1-7) and exposes only `listAgreements` and `getAgreementDetail`.
2. **Copy `apps/api/src/routes/admin/billing-rate-references.ts`.** It already
   implements exactly this shape for the sibling `agreements.rate_references`
   table: `POST /` at `:97` (stage a version, auto-closing the prior row's
   `effectiveUntil` in one transaction), `PATCH /:id` at `:152` (immutable
   price-resolution fields on an active row), `POST /:id/retire` at `:206`. Its
   header (`:6-12`) states the invariant. K02, K04 and K13 are that file with a
   different table.
3. `AgreementStatus` is `["draft", "active", "expired"]`
   (`packages/shared/src/db/commercial.ts:42`). There is no `retired` and no
   `cancelled`. AC-21 has to express retirement inside that three-value enum.
4. The router is mounted twice under overlapping prefixes:
   `/api/admin/agreements` → `adminAgreementsDebug` (`index.ts:178`) and
   `/api/admin/agreements/sessions` → `adminAgreementsResolve` (`:184`). A new
   `POST /` on the first router does not collide, but a future `GET /sessions`
   would.

---

### AC-19 — `PATCH /api/admin/agreements/:id` (update, draft only) — PROPOSED

**Auth:** admin session cookie · **Permission:** `contract.write` · **Idempotency:** not required (last write wins on a draft) · **Frontend:** draft editor; the control must be hidden, not merely disabled, once status is `active`.

Request:

```json
{ "displayName": "org_alpha depot — installation contract (rev B)", "notes": "counterparty confirmed", "effectiveFrom": "2026-09-15T00:00:00Z" }
```

Success `200`:

```json
{ "agreement": { "id": "agr_01", "status": "draft", "displayName": "org_alpha depot — installation contract (rev B)", "effectiveFrom": "2026-09-15T00:00:00Z" } }
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 invalid_id` | `:id` is not UUID-shaped | `agreements-debug.ts:44-45` |
| `400 validation_error` | zod failure | `billing-rate-references.ts:101-113` |
| `400 active_row_immutable` | status is `active` (K02, scenario 138); response carries `suggestion: "stage_new_version"` | `billing-rate-references.ts:171-181` |
| `403 forbidden` | lacks `contract.write` | `require-permission.ts:76-83` |
| `404 not_found` | unknown id | `agreements-debug.ts:49` |
| `422 immutable_field` | `agreementType` or `counterpartyOrgId` in the body — identity fields, never patchable | `billing-cost-factors.ts:105-114` |

**Audit:** `action: "agreement.updated"`, `metadata: { changed: ["displayName",
"effectiveFrom"] }`. Record the field names, not the values — a values diff on
`notes` is a free-text sink and scenario 156 forbids leaking anything unredacted
into logs.

**Notes.**
1. The `active_row_immutable` / `stage_new_version` pairing is the
   already-shipped answer to "how do I change an active price"
   (`billing-rate-references.ts:6-12`). Reusing the same error code across both
   tables means one UI handler.
2. `billing-cost-factors.ts:105-114` rejects immutable fields with a **422**
   while `billing-rate-references.ts:171-181` rejects them with a **400**. The two
   live files disagree. Pick one for the agreements surface and note the
   inconsistency rather than inheriting both.

---

### AC-20 — `POST /api/admin/agreements/:id/activate` — PROPOSED

**Auth:** admin session cookie · **Permission:** K07 says org admin only — see note 1, this is the hardest requirement in Group K · **Idempotency:** `Idempotency-Key` recommended; a replay on an already-active agreement returns 200 with `alreadyActive: true` · **Frontend:** "Activate" with a confirm dialog showing the pricing snapshot.

Request:

```json
{ "confirmPricingSnapshotHash": "sha256:…", "note": "board approved 2026-08-08" }
```

Success `200`:

```json
{
  "agreement": { "id": "agr_01", "status": "active", "effectiveFrom": "2026-09-15T00:00:00Z", "effectiveUntil": null },
  "alreadyActive": false,
  "pricingSnapshot": {
    "clauseCount": 3,
    "factorCodes": ["energy_kwh", "network_fee", "session_fee"],
    "resolvedAt": "2026-08-09T09:40:00Z"
  }
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 invalid_id` | non-UUID `:id` | `agreements-debug.ts:44-45` |
| `400 no_clauses` | activating an agreement with zero clauses would price nothing | new |
| `403 forbidden` | caller is platform staff, not an org admin (scenario 141) | see note 1 |
| `404 not_found` | unknown id | `agreements-debug.ts:49` |
| `409 overlapping_active_agreement` | another active agreement covers the same installation and overlapping range (scenario 139) | see note 2 |
| `422 effective_from_in_past` | activation would retro-price already-settled sessions (scenario 147) | new |

**Audit:** `action: "agreement.activated"`, `orgId` = `counterpartyOrgId`,
`targetType: "agreement"`, `metadata: { effectiveFrom, effectiveUntil,
pricingSnapshot }` (K10, scenario 142 explicitly wants the snapshot in the audit
row).

**Notes.**
1. **"Staff cannot activate" is not expressible with the current resolver.**
   `expandPlatformTenantVerbs` (`apps/api/src/lib/auth/effective-permissions.ts:103-139`)
   expands `platform.tenant.write` into the whole write family — including
   `contract.write` — in **every** organisation, and `sales_cs` holds
   `platform.tenant.write` (`permissions.ts:268`, whose comment claims
   "column-restricted in repo layer" — that restriction **is not implemented
   anywhere**). So a `sales_cs` staff account passes `contract.write` on org_alpha
   today. K07 requires either carving `contract.write` out of the expansion, or
   an explicit `membership-derived only` check in the handler. The resolver
   returns a flat verb list and cannot tell the handler which it was.
2. **The overlap constraint does not exist.** `prisma/schema/commercial.prisma`
   gives `Agreement` four plain `@@index` declarations and no range or unique
   constraint on `(installationId, effectiveFrom, effectiveUntil)`; grepping all
   of `prisma/migrations/` for `EXCLUDE`, `btree_gist` or `tstzrange` returns
   nothing. Today overlap is handled at *read* time by a `console.warn` plus a
   deterministic `orderBy` in `apps/api/src/lib/agreement/persist.ts:143-165`.
   Until K05 adds the extension and the constraint, `409 overlapping_active_agreement`
   is an application-level check inside a transaction and is racy under
   concurrency.
3. The pricing snapshot should be produced by the same call as AC-23 so the
   dialog and the audit row cannot disagree.

---

### AC-21 — `POST /api/admin/agreements/:id/retire` — PROPOSED

**Auth:** admin session cookie · **Permission:** `contract.write` (plus the same org-admin question as AC-20) · **Idempotency:** replay returns `not_active` rather than moving the date again · **Frontend:** "Retire" with the gap warning surfaced verbatim.

Request:

```json
{ "effectiveUntil": "2026-12-31T23:59:59Z", "reason": "org_alpha moving to a new contract" }
```

Success `200`:

```json
{
  "agreement": { "id": "agr_01", "status": "active", "effectiveUntil": "2026-12-31T23:59:59Z" },
  "warning": "Sessions ending after effectiveUntil will resolve no agreement for this installation. Stage a replacement before that date to close the gap."
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 invalid_id` | non-UUID `:id` | `agreements-debug.ts:44-45` |
| `400 not_active` | agreement is `draft` or already `expired`; body carries `status` | `billing-rate-references.ts:215-223` |
| `400 effective_until_before_effective_from` | inverted range | new |
| `403 forbidden` | lacks the verb | `require-permission.ts:76-83` |
| `404 not_found` | unknown id | `agreements-debug.ts:49` |

**Audit:** `action: "agreement.retired"`,
`metadata: { effectiveUntil, reason, hadClauses: 3 }` (K10, scenario 143).

**Notes.**
1. Retire sets `effectiveUntil` and **deletes nothing** (scenario 143). The
   status enum has no `retired` value, so the row stays `active` until the date
   passes and only then reads as `expired`. Whether `status` is recomputed by a
   job or derived at read time is undecided in source — `listAgreements`
   (`repositories/agreements.ts:155`) returns a `status` union of
   `draft | active | expired`, so something already derives it; **unverified**
   which.
2. Copy the warning-in-the-success-body pattern from
   `billing-rate-references.ts:226-231` — retiring a rate reference already
   returns exactly this kind of gap warning.
3. K13 ("supersede chain visible") has no column to hang on: `agreements` has no
   `supersedesId` (`packages/shared/src/db/commercial.ts:293-316`). Either add
   one or accept that the chain is inferable only from overlapping date ranges on
   the same `installationId`.

---

### AC-22 — `POST` / `DELETE /api/admin/agreements/:id/assignments` (cost-factor assign and unassign) — PROPOSED

**Auth:** admin session cookie · **Permission:** `tariff.write` — declared at `permissions.ts` and bundled, guarding **zero routes** today (K11, D05); every live billing mutation uses `billing.write` instead · **Idempotency:** `Idempotency-Key` on create, scope `agreement.assignment`; L09's bulk variant must be idempotent per assignment · **Frontend:** clause/scope matrix on the agreement detail page; scenario 149 requires the control to be hidden entirely while this endpoint is absent.

Assign request:

```json
{
  "costFactorId": "cf_energy_kwh",
  "scopeType": "charger",
  "scopeId": "chg_alpha_7",
  "audienceType": "driver_group",
  "audienceId": "dg_alpha_staff",
  "bearerType": "org",
  "bearerRef": "org_alpha",
  "rateRefCode": "ENERGY_STD",
  "effectiveFrom": "2026-09-01T00:00:00Z",
  "effectiveUntil": null
}
```

Assign success `201`:

```json
{
  "assignment": {
    "id": "rule_01",
    "agreementId": "agr_01",
    "costFactorId": "cf_energy_kwh",
    "scopeType": "charger",
    "scopeId": "chg_alpha_7",
    "audienceType": "driver_group",
    "audienceId": "dg_alpha_staff",
    "bearerType": "org",
    "rateRefCode": "ENERGY_STD",
    "effectiveFrom": "2026-09-01T00:00:00Z",
    "effectiveUntil": null
  }
}
```

Unassign request — `DELETE /api/admin/agreements/agr_01/assignments/rule_01`:

```json
{ "effectiveUntil": "2026-10-01T00:00:00Z", "reason": "charger chg_alpha_7 decommissioned" }
```

Unassign success `200`:

```json
{ "assignment": { "id": "rule_01", "effectiveUntil": "2026-10-01T00:00:00Z", "deleted": false } }
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation_error` | zod failure | `billing-rate-references.ts:101-113` |
| `400 effective_dating_required` | `effectiveFrom` absent | column is `notNull` at `commercial.ts:447` |
| `403 forbidden` | lacks `tariff.write` | `require-permission.ts:76-83` |
| `404 not_found` | unknown agreement, cost factor, or assignment | `agreements-debug.ts:49` |
| `409 conflict` | an assignment with the same agreement, factor, scope, audience and overlapping dates already exists (L11) | new; no unique or exclusion constraint exists on `bearer_rules` |
| `422 per_driver_scope_not_supported` | `audienceType: "user"` (L01, scenario 146) | see note 2 |
| `422 agreement_not_draft` | assignments added to an `active` agreement | K12 says draft-only |

**Audit:** `action: "agreement_assignment.created"` /
`"agreement_assignment.retired"`, `orgId` = the agreement's
`counterpartyOrgId`, `targetType: "bearer_rule"`, `targetId` = rule id,
`metadata: { costFactorId, scopeType, scopeId, audienceType, effectiveFrom,
effectiveUntil }` (L08).

**Notes.**
1. **Two unrelated cost-factor tables exist and Group L straddles both.**
   `billing.cost_factors` has full CRUD
   (`apps/api/src/routes/admin/billing-cost-factors.ts`: `GET /` `:40`,
   `POST /` `:50`, `PATCH /:id` `:97`, `POST /:id/deactivate` `:163`,
   `POST /:id/reactivate` `:188`) and is what L06 names. `agreements.cost_factors`
   (`packages/shared/src/db/commercial.ts:255`) is what the resolver actually
   walks, and its only surface is the read-only select-options endpoint at
   `billing-rate-references.ts:43`. **This endpoint must target
   `agreements.cost_factors`**, or assignments will reference rows the resolver
   never reads.
2. `audienceType` is a live DB enum with values `["driver_group", "user"]`
   (`commercial.ts:45`), so a per-driver assignment is *expressible in the
   schema*. Scenario 146 requires it to be refused for beta. That refusal is an
   application-level check only; nothing in the DB prevents it, and a direct SQL
   insert bypasses it.
3. Delete is never a delete. `bearer_rules` has `effectiveUntil`
   (`commercial.ts:448`); L03 requires historical resolution to stay intact, and
   `resolveBillingLines` (`packages/commercial/src/agreement/resolve.ts:34`)
   resolves as-of the session time, so removing a row would silently reprice
   history. The `DELETE` verb here performs an `effectiveUntil` write; the
   response's `deleted: false` says so explicitly.
4. `scopeType` is `["site", "installation", "circuit", "charger"]`
   (`commercial.ts:44`, mirrored as `RULE_SCOPES` at
   `packages/commercial/src/agreement/types.ts:15`). L01's proposed enum
   `org/group/installation/charger` does **not** match: there is no `org` scope
   and no `group` scope, and `site` and `circuit` exist that L01 omits. Reconcile
   before writing the zod schema.

---

### AC-23 — `POST /api/admin/agreements/:id/preview` (pricing preview) — PROPOSED, wrapping an endpoint that EXISTS

**Auth:** admin session cookie · **Permission:** `billing.read` — matching the existing `debug-resolve` gate · **Idempotency:** n/a (pure computation, writes nothing) · **Frontend:** the confirm dialog in AC-20 and the driver-facing explanation in L12.

Request:

```json
{
  "userId": "driver-anna@example.test",
  "chargingStationId": "chg_alpha_7",
  "at": "2026-09-02T18:00:00Z",
  "energyKwh": 42.5,
  "durationMinutes": 95
}
```

Success `200`:

```json
{
  "granted": true,
  "installationAgreement": { "id": "agr_01", "displayName": "org_alpha depot — installation contract" },
  "workplaceAgreements": [],
  "driverGroup": { "id": "dg_alpha_staff", "displayName": "org_alpha staff" },
  "sessionInputs": { "at": "2026-09-02T18:00:00Z", "energyKwh": 42.5, "durationMinutes": 95, "durationDays": 0.066 },
  "enlistedFactorCount": 3,
  "applicableRuleCount": 2,
  "billingLines": [
    {
      "factorCode": "energy_kwh",
      "kind": "passthrough",
      "basisType": "per_kwh",
      "basisQuantity": 42.5,
      "unitPriceMinor": "2450",
      "amountExVatMinor": "104125",
      "vatRatePct": 24,
      "vatAmountMinor": "24990",
      "amountIncVatMinor": "129115",
      "currency": "ISK",
      "bearerType": "org",
      "bearerRef": "org_alpha",
      "recipientOrgId": "org_beta",
      "recipientUserId": null,
      "rateRefId": "rr_01",
      "ruleId": "rule_01",
      "computationDetail": {}
    }
  ]
}
```

Success `200` when access is denied (note: **200, not 403**):

```json
{ "granted": false, "reason": "no_membership", "message": "…", "installationAgreement": null, "cpoOrgId": "org_beta", "installationId": "inst_alpha_1" }
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 invalid_input` | zod failure; body carries `details` from `error.format()` | `agreements-debug.ts:91-93` |
| `401 unauthorized` | no admin cookie | `auth-middleware.ts:17` |
| `403 forbidden` | lacks `billing.read` | `require-permission.ts:76-83` |

**Audit:** none. `debug-resolve` writes nothing by design
(`agreements-debug.ts:16-17`).

**Notes.**
1. This is the **only** item in part 2 with a working implementation to wrap:
   `POST /api/admin/agreements/debug-resolve` (`agreements-debug.ts:89`), gated
   `billing.read`, schema at `:55-61` (`userId` and `chargingStationId` must be
   UUIDs; `energyKwh` defaults to 10, `durationMinutes` to 60). Money fields are
   **serialised as strings** because Hono's JSON serialiser rejects BigInt
   (`:63-67`); any client must parse them back.
2. `granted: false` returns **200** with a reason, not 403 — deliberate, and it
   must stay that way or the preview UI cannot explain a denial. This is the
   opposite of every other endpoint in this part.
3. **Preview cannot price an unsaved draft.** `loadAgreementContext`
   (`apps/api/src/lib/agreement/persist.ts:86`) reads persisted rows only. K08's
   "preview reuses debug-resolve" therefore only works after AC-18 has persisted
   the draft; a true what-if over an unsaved clause set needs a different entry
   point into `resolveBillingLines`.
4. **Scenario 144 ("preview matches actual resolution") is false today and the
   source says so.** `apps/api/src/repositories/driver-pricing.ts:25-34` records
   that the agreements resolver has priced **0** sessions and that the legacy
   chain (`lib/tariff/resolve-tariff-chain.ts` +
   `lib/tariff/compute-session-cost.ts`) prices every session. There are three
   pricing implementations live, not one — add `summarisePerKwhForList`
   (`driver-pricing.ts:175`) and `summariseForCharger` (`:208`) as the third.
   A comparison harness exists but is operator-run only
   (`apps/api/src/lib/billing-shadow/shadow-compare.ts`, `shadowCompare` at `:85`).

---

### AC-24 — `POST /api/admin/billing/sessions/:sessionId/attribution-corrections` — PROPOSED

**Auth:** admin session cookie · **Permission:** `billing.write` (matching `agreements-resolve.ts:28`) · **Idempotency:** `Idempotency-Key` required, scope `attribution.correction`; a replay returns the existing correction · **Frontend:** dispute drawer on `/charge-log/[sessionId]`.

Request:

```json
{
  "correctedSubject": { "kind": "driver", "userId": "driver-anna@example.test" },
  "previousSubject": { "kind": "unknown" },
  "basis": "operator_review",
  "reason": "card BETA-2222 was lent out; org_beta confirmed the driver",
  "disputeId": "dsp_01"
}
```

Success `201`:

```json
{
  "correction": {
    "id": "corr_01",
    "sessionId": "sess_01",
    "previousSubject": { "kind": "unknown" },
    "correctedSubject": { "kind": "driver", "userId": "driver-anna@example.test" },
    "basis": "operator_review",
    "supersededBillingLineIds": ["bl_01", "bl_02"],
    "emittedBillingLineIds": ["bl_03", "bl_04"],
    "cdrMutated": false,
    "createdAt": "2026-08-09T09:50:00Z"
  },
  "dispute": { "id": "dsp_01", "state": "resolved_corrected" }
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 invalid_session_id` | non-UUID `:sessionId` | `agreements-resolve.ts:30-33` |
| `403 forbidden` | lacks `billing.write` | `require-permission.ts:76-83` |
| `404 not_found` | unknown session | new |
| `409 correction_exists` | a correction already supersedes this attribution and no new dispute is cited | new |
| `422 session_not_settled` | session has no end time or no billing lines to supersede | `agreements-resolve.ts:38-40` returns 422 with `reason` for the analogous case |
| `422 downgrade_requires_dispute` | correcting a named driver back to `unknown` without a `disputeId` (E08's upgrade-only rule) | new |

**Audit:** `action: "session_attribution.corrected"`, `orgId` = the session's
org, `actorUserId` = the operator (scenario 94 — never the driver),
`actorKind: "user"`, `targetType: "charge_session"`, `targetId` = sessionId,
`metadata: { previousSubject, correctedSubject, basis, disputeId,
supersededBillingLineIds }`.

**Notes.**
1. Wholly greenfield: there is no `session_attribution` table, no
   `authorization_decision` table, no dispute state machine and no correction
   event anywhere in the repo.
2. **The existing re-resolve route cannot produce a correction.**
   `POST /api/admin/agreements/sessions/:sessionId/resolve`
   (`apps/api/src/routes/admin/agreements-resolve.ts:27`) is idempotent by
   *skipping*: when billing lines exist it returns
   `{ ok: true, alreadyExisted: true, emitted: 0 }` and writes nothing
   (`:43-50`, mechanism at `persist.ts:356`). Scenario 148 ("explicit re-resolve
   produces a correction") is unsatisfiable through that route as written.
3. **That route also writes no audit row.** The file imports no audit helper at
   all — scenario 97 ("re-resolution is audited") fails today.
4. **Attribution is split-brained across two tables.** The OCPP writers never set
   `charging.sessions.user_id` (`apps/api/src/lib/ocpp/projections.ts:185-199`
   and `:859-872` omit it); the driver is resolved only at stop time into
   `reports.session_ledger.driver_user_id` (`:406-416`, `:971-978`). The only
   writers that set `sessions.user_id` are the Zaptec webhook
   (`routes/webhooks/zaptec.ts:211`, `:335`) and the CDR sync
   (`repositories/zaptec-session-sync.ts:329`, `:347`). A correction must write
   **both** or `GET /api/driver/sessions/current` and
   `GET /api/driver/sessions/history` will disagree about who owns the session.
5. Scenario 91 ("no CDR is overwritten") has a live counterexample:
   `apps/api/scripts/backfill-session-costs.ts:176-199` upserts the ledger with a
   full-row `update` and reassigns `driverIdTag` at `:185` — an unaudited in-place
   mutation. M02 must retire or fence that script, not just add a new endpoint.
6. Scenario 96 ("no person named anywhere in the invoice") interacts with E14:
   an unknown-attribution session billed to the installation must leave both
   `recipientUserId` and `bearerRef`-as-user null on the emitted lines
   (`agreements.billing_lines`, `commercial.ts:459-486`).

---

### AC-25 — `GET /api/admin/orgs/:orgId/audit-events` (audit read) — PROPOSED

**Auth:** admin session cookie · **Permission:** `audit.read` with `orgIdParam: "orgId"` — declared in `PER_TENANT_PERMISSIONS` (`permissions.ts`) and guarding **zero routes** today; this would be its first call site (D03) · **Idempotency:** n/a (read) · **Frontend:** org-visible activity log (N04, scenario 55) — the organisation sees staff actions taken on it, not only Straumvakt.

Request — `GET /api/admin/orgs/org_alpha/audit-events?since=2026-08-01T00:00:00Z&limit=50&cursor=…`

Success `200`:

```json
{
  "items": [
    {
      "id": "aud_01",
      "occurredAt": "2026-08-09T09:00:00Z",
      "action": "support_context.opened",
      "actorUserId": "staff-carol@example.test",
      "actorKind": "user",
      "onBehalfOfOrgId": "org_alpha",
      "supportContextId": "sc_01",
      "targetType": "support_context",
      "targetId": "sc_01",
      "reason": "driver-anna@example.test cannot see her session history; ticket SV-1042"
    }
  ],
  "nextCursor": "2026-08-09T09:00:00Z|aud_01"
}
```

Errors:

| Status and code | When | Source anchor |
|---|---|---|
| `400 validation` | malformed `since`, `limit` out of range, or unparseable cursor | new |
| `401 unauthorized` | no admin cookie | `auth-middleware.ts:17` |
| `403 forbidden` | lacks `audit.read` for this org | `require-permission.ts:76-83` |
| `404 not_found` | org unknown or invisible | doc 10 §3.1 |

**Audit:** none (read). Whether reading an org's audit log is itself auditable is
an open N-group question; there is no precedent to copy.

**Notes.**
1. `audit.actions` is **write-mostly**. `recordAuditAction`
   (`apps/api/src/lib/audit.ts:58-86`) is called from fourteen source files, and
   the only reader anywhere in the repo is
   `apps/api/src/repositories/installation-ocpp.ts:272` and `:330`, which reads
   exactly three action names to derive a `lastRotatedAt`. There is no `GET`
   route, no list repository and no UI over the table. N03 and N04 are greenfield.
2. **Three of the response fields have no column.**
   `packages/shared/src/db/platform.ts:91-108` declares `id`, `orgId`,
   `actorUserId`, `actorKind`, `action`, `targetType`, `targetId`, `metadata`,
   `occurredAt` — and nothing else. `onBehalfOfOrgId` (C11), `supportContextId`
   (C10) and `reason` (doc 10 §3.10) all require a migration. Until then they can
   only be projected out of `metadata` jsonb, which no writer populates
   consistently.
3. `actorKind` cannot express a bearer actor. The enum is
   `["user", "system", "vendor_webhook", "ocpp_worker"]`
   (`packages/shared/src/db/platform.ts:29`, mirrored in
   `prisma/schema/platform.prisma`), and only `user` is ever written. Scenarios 6
   and 70 depend on N02's new value, which needs both a Postgres `ALTER TYPE` and
   the Prisma enum in the same change.
4. Cursor pagination lands on a supporting index: `audit.actions` carries
   `index().on(t.orgId, t.occurredAt)` (`platform.ts:105`). A
   `(occurredAt, id)` keyset cursor is index-covered; an offset cursor is not.
5. Scenario 156 ("no hash, DSN, token or personal identifier in any log line")
   is unenforced on this path. `metadata` is free-form jsonb with no writer-side
   redaction (`audit.ts:78-84` passes it straight through), so exposing the column
   to organisations makes every existing writer's metadata an org-visible
   disclosure surface. N08 must land **before** this endpoint, not after.
6. There is no retention policy for `audit.actions` (N07). The partition-drop
   machinery (`apps/api/src/lib/db/partition-cron.ts`, `DROPPABLE_PARENTS` at
   `:226`) does not cover it — **unverified** whether `audit.actions` is even
   partitioned.

---

### Cross-cutting acceptance note

Several 18-series acceptance criteria for these packages are phrased as "asserted
in CI". **No test suite runs in CI on this branch.**
`.github/workflows/check.yml` has three steps — `npm install`,
`npm run db:generate`, `npm run check` — and `scripts/check-all.mjs` runs nine
offline checks, none of them vitest. Any "in CI" criterion attached to AC-11 …
AC-25 requires a CI step that has never existed, and that step is its own work
item.
