# Sprint 5 — Invite Flow + Driver Self-Registration · Task List

**Status:** ACTIVE — entry condition: Sprint 4 closure list checked.
**Branch:** `dev/sprint-05-invite-flow` (cut from `staging`).

> Scope per [ADR 0014](../adr/0014-identity-tenancy-and-authorization.md)
> §"Sprint 5 (invite + driver self-registration)" + Sprint 4
> carry-forward (sub-resource route `assertPermission` retrofits,
> production cutover dead-code cleanup). Commercial Model slipped to
> Sprint 6 per [ADR 0016](../adr/0016-sprint-5-scope-call-invite-over-tariff.md).

---

## Milestone 5.1 — Bootstrap admin → real User row

> Closing the gap before any session-userId work lands. Today's
> bootstrap admin is env-var only; SessionPayload has no `userId`.
> Sprint 5 needs a real User row to anchor the session.

- [ ] Spike: how is the bootstrap admin's email mapped to a User row?
  - Option A: seed the User row at Worker startup if missing.
  - Option B: run a one-shot `prisma seed`-style migration that
    materialises it.
  - Option C: extend the login flow to look up the User row by
    email and attach userId to the session.
- [ ] Pick option; document in `docs/notes/2026-05-03-bootstrap-admin-userid.md`.
- [ ] `SessionPayload` extends with `userId?: string` (optional during
      transition; required post-Sprint-5 once invite flow lands).
- [ ] `apps/api/src/lib/auth/require-permission.ts` updated:
      `isBootstrapSession` reframes — bootstrap = "platform-admin
      override" rather than "no userId attached".
- [ ] Test: bootstrap admin gets a `userId`; permission resolution
      goes through `effectivePermissions` instead of the god-mode
      branch.

## Milestone 5.2 — `UserCredential` polymorphic schema

> Rule 4 — explicit operator instruction per edit. Additive: new
> columns on `UserCredential` model.

- [ ] `CredentialKind` enum (`password | passkey | oauth_google |
      oauth_microsoft | magic_link | otp | api_key`).
- [ ] `UserCredential` extended fields: `kind`, `publicKey?`,
      `externalSub?`, `apiKeyHash?`, `scopes[]`, `status`,
      `lastUsedAt?`, `expiresAt?`. Existing `passwordHash` and
      `totpSecret` migrate to `kind=password` rows.
- [ ] Migration: backfill existing `UserCredential` rows with
      `kind='password'`. `totpSecret` → `kind='otp'` if non-null.
- [ ] Repository: `apps/api/src/repositories/user-credentials.ts` —
      `createCredential`, `verifyCredential`, `revokeCredential`.
- [ ] Tests for the polymorphic surface (one test per kind).

## Milestone 5.3 — Agent invite flow (admin side)

- [ ] Schema: `Invitation` model in `tenancy` schema —
      `id, orgId, email, role, invitedById, tokenHash, status, expiresAt, acceptedAt, createdAt`.
- [ ] Migration.
- [ ] Repository: `apps/api/src/repositories/invitations.ts` —
      `createInvitation`, `findByTokenHash`, `markAccepted`, `expire`.
- [ ] Route: `POST /api/admin/orgs/:orgId/invitations` —
      requirePermission("member.invite", { orgIdParam: "orgId" }).
      Body: `{ email, role }`. Returns the token (one-time display).
- [ ] Email template: invite link `https://hlada-staging.straumvakt.workers.dev/accept-invite/<token>`.
      Operator copies + sends manually for staging; Sprint 5+ wires
      Cloudflare Email Routing or similar.
- [ ] Token TTL: 7 days (per ADR 0016 open question recommendation).

## Milestone 5.4 — Agent invite flow (recipient side)

- [ ] Public route: `GET /api/public/accept-invite/:token` —
      validates token, returns invitation summary (org name, role,
      inviter email). 404 for invalid/expired.
- [ ] Public page: `/accept-invite/[token]/page.tsx` — landing UI
      with "set password" or "use SSO" choice.
- [ ] Public route: `POST /api/public/accept-invite/:token` — body
      `{ password }` (Sprint 5 password-only; SSO post-pilot). Creates
      User + Membership + UserCredential in one transaction.
      Marks invitation accepted. Issues admin session cookie.
- [ ] Route is rate-limited (5 attempts per IP per 5 min).
- [ ] Tests: happy path, expired token, already-accepted token,
      password-too-short.

## Milestone 5.5 — Driver self-registration flow

- [ ] Public route: `POST /api/public/signup` — body
      `{ email | phone, displayName? }`. Creates a driver-audience User
      row + sends OTP via SMS (TBD provider).
- [ ] Public route: `POST /api/public/verify-otp` — body
      `{ identifier, otp }`. Verifies code; creates `UserCredential`
      with `kind='otp'` (cached secret) and issues session cookie.
- [ ] Driver-audience User has no Membership — uses `DriverContract`
      for billing scope when Sprint 6 wires that.
- [ ] OTP TTL: 15 minutes (per ADR 0016).
- [ ] Tests: signup, verify, expired otp, wrong otp, rate-limited.

## Milestone 5.6 — Sub-resource route `assertPermission` retrofits

> Sprint 4.4 carry-forward. ~30 admin routes today use bare
> `requirePermission(verb)` without orgIdParam — bootstrap admin
> passes via god-mode but real users get no orgId-scoped check.
> Sprint 5 retrofits each route to fetch the resource by id, get
> its orgId, then call `assertPermission(c, verb, orgId)`.

- [ ] adminSites: `GET/PATCH/DELETE /:siteId` and nested
- [ ] adminInstallations: `GET/PATCH/DELETE /:id`
- [ ] adminCircuits: `GET/PATCH/DELETE /:id`
- [ ] adminProperties: `GET/PATCH/DELETE /:id`
- [ ] adminChargers: `GET/PATCH/DELETE /:id` and OCPP command paths
- [ ] adminUsers: `GET/PATCH /:id`, `GET/POST /:id/tokens`
- [ ] adminIdTokens: `GET/DELETE /:tokenId`
- [ ] adminVendorCredentials (All variant): `GET/PATCH/DELETE /:id`
      and the workflow paths
- [ ] Each route gets a `getOrgIdForResource(db, id)` helper if not
      already present in its repo.

## Milestone 5.7 — Impersonation flow

- [ ] Schema: `ImpersonationGrant` model in `audit` or `identity`
      schema — `id, actorUserId, targetUserId, grantedById, grantedAt,
      expiresAt, revokedAt, reason`.
- [ ] Route: `POST /api/admin/platform/impersonate` —
      requirePermission("platform.impersonate"). Body
      `{ targetUserId, reason }`. Mints an impersonation grant +
      issues a new session cookie with `actAsUserId=targetUserId`.
- [ ] Route: `POST /api/admin/platform/impersonate/end` — clears
      impersonation, restores original session.
- [ ] Audit: every impersonation start AND every privileged write
      during impersonation logs `actor=originalUserId,
      acting_as=targetUserId`.
- [ ] Max duration: 4 hours per grant (per ADR 0016).
- [ ] UI: "Impersonate" button on `/tenants/agents/[id]` page;
      banner across the top of the impersonating session showing
      "You are acting as ANNA · End impersonation".

## Milestone 5.8 — Production cutover follow-up cleanup

> Sprint 4.5 left dead UI-Worker-side code in place during the
> deploy-window safety period. Sprint 5 cleans up after both gateway
> environments are confirmed on the new URL.

- [ ] Delete `src/app/api/ocpp/events/route.ts` (UI Worker route).
- [ ] Delete `src/app/api/internal/ocpp-auth/route.ts` (UI Worker mirror).
- [ ] Delete `src/lib/ocpp/{event-envelope,projections,bootstrap,
      ingest-auth,internal-auth}.ts` + their tests.
- [ ] Delete `src/lib/repositories/events.ts` + test.
- [ ] Drop the legacy `/api/ocpp/events` mount on apps/api
      (keep only `/api/internal/ocpp-events`).
- [ ] Smoke against staging + production after each deletion.

---

**Risks:**
- 5.1 spike must land before 5.6 retrofits. Real userIds in session
  are the prerequisite for `assertPermission` to actually check.
- 5.2 schema migration: `UserCredential.passwordHash` → `kind='password'`
  row reshuffling. Test against scratch Neon branch first.
- 5.3 / 5.4 invite flow: token security. Tokens are bearer; treat
  like passwords. Hash before storing; compare constant-time.
- 5.5 driver signup: phone-number / email verification depends on
  third-party (SMS / email). Plan a fallback for staging.
- 5.7 impersonation: every privileged write must log both actor and
  acting_as. Audit drift = security incident.
- 5.8 cleanup: deletion-only commit, but wait for confirmed prod
  redeploy before merging.

**Out of scope (Sprint 6+):**
- OAuth credentials (`oauth_google`, `oauth_microsoft`) — Sprint 9.
- Passkey credentials — Sprint 9.
- API-key credentials (service principals) — Sprint 11.
- Commercial Model (tariff engine, CustomerPlan, ChargerServicePlan) — Sprint 6.
- Data Storage Lifecycle — Sprint 7.
- MFA enforcement on PlatformGrant — Sprint 9.
- Postgres RLS — Sprint 9.
