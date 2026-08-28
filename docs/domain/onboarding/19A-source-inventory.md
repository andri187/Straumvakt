# Appendix 19A — source inventory

**140 entries across 10 areas.** Phase 1 of the source-linked implementation
readiness packet. Every path and symbol below was read on branch
`docs/singular-onboarding-domain-packet` at tip `fc071b3`. Nothing was executed:
no SQL, no database connection, no test run, no network call.

## How to read this

| Column | Meaning |
|---|---|
| **ID** | `SI-<AREA>-<nn>`, stable — implementation tasks in [19B](19B-implementation-task-map.md) cite these |
| **File** | repo-relative path |
| **Symbols / routes** | real exported names and route paths, with line anchors as read |
| **Pkg** | work-package IDs from [18A](18A-work-packages.md) |
| **Scen** | scenario numbers from [18C](18C-scenarios.md) |
| **Risk** | blast radius if this file is changed |
| **Conf** | confidence that the entry is accurate — `Low` is a real signal, not a hedge |

Line anchors are a reading aid, not a contract. They drift on the next commit;
the symbol name is the durable reference.

## What this inventory changed

Building it invalidated several assumptions the 18-series packet was written on.
The corrections are recorded in full in
[19-source-linked-implementation-readiness.md](19-source-linked-implementation-readiness.md)
§ "Corrected findings", and the five that change sequencing are:

1. **The agreement write surface does not exist at all.** Group K is greenfield,
   not hardening — see area A07.
2. **The organisation onboarding aggregate does not exist.** Group G is
   greenfield — see area A08.
3. **No test suite runs in CI.** Every "in CI, offline" acceptance criterion in
   Group P needs a CI step that has never existed — see area A10.
4. **The `sales_cs` mitigation named in a source comment is not implemented** —
   see area A03.
5. **The rate limiter fails open**, which is the opposite of what the packet's
   `T-RL-failclosed` assumes — see area A02.

---

## A01 — Invite consume, claim/redeem, user tokens, registration, password

Three separate onboarding token flows live side by side, all keyed on a SHA-256 hash of a 32-char plaintext stored in one `identity.user_tokens` table. (1) Operator/agent invites: `POST /api/admin/orgs/:orgId/invites` mints `kind='invite'`, emails a `{origin}/invite/{plaintext}` link, and `POST /api/public/invites/consume` is bearer-only — it sets a password by `upsert` and flips `Membership` to `active`. (2) Host→driver invites: `kind='driver'` tokens minted by `createDriverInvite`, redeemed by `POST /api/driver/redeem-invite` which IS identity-bound (ADR 0053) and preceded by `POST /api/driver/claim-invite`, which refuses when the bound user already has a credential row. (3) Driver self-registration: `POST /api/public/register` → 24h `magic_link` token with `metadata.purpose='email_verify'` → `GET /api/public/verify-email/:token`, plus a 1h `password_reset` flow. Two ORMs are in play mid-migration: `repositories/invites.ts`, `user-tokens.ts` and `create-driver.ts` are Drizzle; `routes/public/invites.ts`, `registration.ts`, `host-invites.ts` and `routes/public/driver.ts` are still Prisma. The hardening the docs describe for `consume` (credential guard, `create` not `upsert`, `already_claimed` 409, bearer audit) is genuinely absent from `invites.ts` — but the equivalent guard already ships two files away in `driver.ts` `claim-invite`, so the pattern is written and only needs porting.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-INVITE-01 | `apps/api/src/routes/public/invites.ts` | `publicInvites`; `GET /peek` :41; `POST /consume` :86; claim :130-133; `upsert` :142-146; status map :180 | A01,A02,A03,A04,A10,A13,B12,B13 | 1-18 | `test/parity/driver-invite-redemption-parity.test.ts` :620 | High | High | Nothing unit-tests this file — is a new `invites.test.ts` in scope for A08/A09? |
| SI-INVITE-02 | `apps/api/src/repositories/user-tokens.ts` | `UserTokenKind` :47; `createUserToken` :64; `consumeUserToken` :109; `revokeUserToken` :165; `listOutstandingUserTokens` :183 | A09,B02 | 7-12 | `test/parity/user-tokens.test.ts` | High | High | `consumeUserToken` already enforces `expectedKind` — should `consume` be refactored onto it rather than hardened in place? |
| SI-INVITE-03 | `apps/api/src/repositories/invites.ts` | `createInvite` :77; `listInvitesForOrg` :237; `revokeInvite` :288; `INVITE_ROLES` :46 | B12,B13 | 9,11,19 | none found | High | High | Stale-token revoke at :163-179 filters `metadata.orgId` in JS — safe under load? |
| SI-INVITE-04 | `apps/api/src/routes/admin/org-invites.ts` | `adminOrgInvites`; `POST/GET/DELETE /api/admin/orgs/:orgId/invites` :64,:150,:172; `buildInviteUrl` :40 | B13 | 19,27 | none found | Medium | High | `buildInviteUrl` trusts the `Origin`/`Referer` header — should the base URL be pinned per environment? |
| SI-INVITE-05 | `apps/api/src/routes/public/driver.ts` | `POST /api/driver/claim-invite` :1029; `POST /api/driver/redeem-invite` :1158; identity bind :1207; credential guard :1089 | B01,B02,B05,B07,B14 | 20-23,26 | `test/parity/driver-invite-redemption-parity.test.ts` | High | High | Does `join` (B01-B05) subsume these two routes or wrap them? |
| SI-INVITE-06 | `apps/api/src/repositories/host-invites.ts` | `createDriverInvite` :146; `listOrgDriverInvites` :247; `listOrgDriverGroups` :103; placeholder user :175-184 | B14 | 20,22 | `test/parity/driver-invite-redemption-parity.test.ts` :363 | High | High | B14 wants placeholder `status:"invited"`, which `UserStatus` does not have — migrate or pick another marker? |
| SI-INVITE-07 | `apps/api/src/repositories/registration.ts` | `registerDriver` :117; `consumeEmailVerification` :323; `initiatePasswordReset` :553; `confirmPasswordReset` :607 | A11 | 13-15 | `apps/api/src/repositories/registration.test.ts` | High | High | Three raw-SQL blocks (:420,:491,:515) bypass the ORM entirely — do they survive the Drizzle migration? |
| SI-INVITE-08 | `apps/api/src/routes/public/register.ts` | `publicRegister`; `POST /api/public/register` :72; `RegisterBody` :41-56 strict; `buildBaseUrl` :58 | A11 | 13-15 | `apps/api/src/routes/public/register.test.ts` | Medium | High | Register requires kennitala and is `.strict()`; consume ignores it — which is the intended contract for A11? |
| SI-INVITE-09 | `apps/api/src/routes/public/password-reset.ts` | `publicPasswordReset`; `POST /api/public/password-reset` :60; `POST /confirm/:token` :90 | — | 9,10 | `apps/api/src/routes/public/password-reset.test.ts` | Medium | High | Reset confirm has no credential-existence guard either — same class as A01, intentionally out of scope? |
| SI-INVITE-10 | `apps/api/src/routes/public/email-verification.ts` | `publicEmailVerification`; `GET /api/public/verify-email/:token` :72; `POST` alias :73 | — | 9-11 | `apps/api/src/routes/public/email-verification.test.ts` | Medium | High | GET-triggered state mutation is prefetch-vulnerable — accepted risk or a gap? |
| SI-INVITE-11 | `apps/api/src/lib/password.ts` | `hashPassword` :73; `verifyPassword` :88; `DEFAULT_ITERATIONS` = 100000 :17; format `pbkdf2:sha256:iter:salt:hash` | A01,A02 | 1,4 | `apps/api/src/lib/password.test.ts` | High | High | A01 needs "hash byte-identical after refusal" — the salt is random, so the assertion must read the stored string, not re-hash |
| SI-INVITE-12 | `apps/api/src/lib/audit.ts` | `recordAuditAction` :58; `AuditActionInput.actorKind: ActorKind` :29; dual Drizzle/Prisma branch :54 | A04 | 5,6 | none directly | High | High | A04's `actorKind:"bearer"` is not a valid enum value today — is a migration authorised? |
| SI-INVITE-13 | `apps/api/src/repositories/create-driver.ts` | `createDriver` :143; `virtualRfidValueFromUserId` :83; `DriverSource` :88 | B14 | 4,20 | none | Low | High | Zero importers — is this meant to be wired up as part of B14, or deleted? |
| SI-INVITE-14 | `apps/mobile/lib/api/client.dart` | `consumeInvite` :93 posts `{token,kennitala,password}` to `/api/public/invites/consume` :99 | A06,A11,A12 | 13-15,20-23 | `apps/mobile/lib/screens/redeem_invite.dart` | High | High | The app sends driver invites to the ORG invite route — does it ever work against `kind='driver'` codes? |

**Area findings**

1. `apps/api/src/routes/public/invites.ts:142-146` uses `userCredential.upsert` with an `update: { passwordHash }` branch and no prior existence check, and the claim at `:130-133` runs *before* it. Both A01 and A02 are real, unmitigated. The status map at `:180` collapses everything non-`not_found` to 410, so A03 is real too.

2. The guard A01 asks for is already written, 900 lines away: `apps/api/src/routes/public/driver.ts:1089` refuses with `already_claimed` when `row.user.credentials !== null`, and `:1096` uses `create`, not `upsert`. Porting that block into `invites.ts` is closer to a copy than a design.

3. `ActorKind` has exactly four values — `user`, `system`, `vendor_webhook`, `ocpp_worker` (`prisma/schema/identity.prisma`'s sibling `prisma/schema/platform.prisma:119-126`, mirrored in `packages/shared/src/db/platform.ts:29`). A04 ("audit refused consume with `actorKind:"bearer"`") is scoped in 18A as "New audit branch" — it is not; it needs an enum migration on `audit.actions.actor_kind` first, or it must reuse `system`.

4. `ConsumeBody` at `apps/api/src/routes/public/invites.ts:36-39` is a plain `z.object` with no `.strict()`, while `RegisterBody` at `apps/api/src/routes/public/register.ts:41-56` *is* `.strict()`. The mobile app posts `kennitala` into consume (`apps/mobile/lib/api/client.dart:99-107`) and the server silently drops it. A10 flipping consume to strict would 400 every current mobile redemption — that is scenario 13 and scenario 23's "failing by design", and it lands on shipped clients, not archived ones.

5. `repositories/user-tokens.ts:47` declares `UserTokenKind = "invite" | "magic_link" | "password_reset"`, but the DB enum has a fourth value, `driver` (`packages/shared/src/db/identity.ts:56`, `prisma/schema/identity.prisma:405-413`). `listOutstandingUserTokens` and `consumeUserToken` therefore cannot address driver invites at all — any B02 "delegate to existing logic" has to widen this union.

6. `apps/api/src/repositories/create-driver.ts` has **no callers**. A repo-wide grep for `create-driver` and `createDriver(` matches only the file itself. Its own header claims it is "the single source of truth for what a driver IS" and that every path routes through it — that is false today. The four real creation paths each hand-roll: `registration.ts:157` (issues `virtual_rfid`), `host-invites.ts:180` (issues nothing), `domains/identity/repositories/users.ts:272` (issues `kind:"rfid"` labelled "Primary", not `virtual_rfid`).

7. There is no web frontend for any of these flows on this branch. `src/app` contains only `home`, `org/[slug]`, `staff/overview`. The invite email links to `{origin}/invite/{plaintext}` (`routes/admin/org-invites.ts:45`) and the verify/reset mails link to `{baseUrl}/verify-email/...` and `/password-reset/...` (`registration.ts:243`, `:586`) — none of those routes exist. The only implementations are archived at `archive/straumvakt-org-console-2026-08-08/app/invite/[token]/`, which posts `{token,password}` (`accept-form.tsx:49-52`). A07's "archived web form" is accurate; scenario 19 tests a form that is not deployed.

8. `apps/api/src/repositories/registration.ts` is a second, independent token implementation: it re-declares `TOKEN_ALPHABET` and `generateTokenPlaintext` at `:61-71` and re-declares `virtualRfidValueFromUserId` at `:75` (a byte-identical copy of `create-driver.ts:83`). It also writes `email_verify` tokens as `kind='magic_link'` discriminated only by `metadata.purpose` (`:210-223`, checked at `:347`) — so a token-kind guard alone will never catch a mis-routed verify token.

9. `UserCredential.passwordHash` is nullable (`prisma/schema/identity.prisma:343`) and `clearUserPasswordHash` (`apps/api/src/domains/identity/repositories/users.ts:381-386`) nulls the column while leaving the row. Any A01/A02 guard written as "does a credential row exist" will lock out a user whose password an admin deliberately cleared; the guard must test `passwordHash IS NOT NULL`.

10. B14 ("placeholder user `status:"invited"`") needs a schema change, not a value change: `UserStatus` is `active | suspended | deleted` (`prisma/schema/identity.prisma:133-139`). `createDriverInvite` currently writes `status: "active"` for the placeholder (`host-invites.ts:181`), and `claim-invite` rejects anything not `"active"` at `driver.ts:1092`, so flipping the placeholder status without touching that check breaks the claim path.

11. All four public onboarding routes share one rate-limit bucket, `ADMIN_LOGIN_RATE_LIMITER` (`register.ts:78`, `password-reset.ts:66,:96`), and `rateLimit` **fails open with a console.warn** when the binding is absent (`apps/api/src/lib/rate-limit.ts:124-129`). `POST /api/public/invites/consume` and `GET /peek` have **no rate limit at all** — `publicInvites` registers no middleware. Scenario 11/12's "unknown token → 404" is an unthrottled oracle today.
## A02 — Driver join, access requests, installation access credentials, passphrase/code

Today there is no `join` surface at all — no `POST /api/driver/join`, no `routes/public/join.ts`, and no `installation_access_credential` table anywhere in schema or code. What exists instead are three *separate*, independently-shaped entry paths bolted onto `routes/public/driver.ts`: (1) `POST /api/driver/access-requests`, which writes an `agreements.driver_access_requests` row and emails driver + org main-contact, reviewed by an operator through `PATCH /api/admin/access-requests/:id`; (2) `POST /api/driver/redeem-invite`, which consumes a 120-bit `user_tokens` row of `kind='driver'` and grants a `DriverGroupMembership` — hardened by ADR 0053 so the token's bound `userId` must equal the caller's, checked *before* the conditional claim; and (3) `POST /api/driver/claim-invite`, the password-bootstrap for the passwordless placeholder user that `createDriverInvite` creates. There is no code+passphrase path, no rotation, no revocation, no idempotency key, and no withdraw. Two things the packet treats as gaps are already built: identity binding (driver.ts:1207) and its `not_found`-identical rejection, plus the operator-side approve/deny idempotency. Two things the packet treats as present are not: `rate-limit.ts` fails **open** (line 128), and neither `/access-requests` nor `/redeem-invite` is rate-limited at all. The "installation access credentials" the seed paths point at (`credential-management.ts`, `credential-crypto.ts`) are *vendor portal* credentials for Zaptec — an unrelated concern that shares only the word; they are the nearest existing seal-a-secret pattern, not the Group J subject.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-JOIN-01 | `apps/api/src/routes/public/driver.ts` | `requireDriver` :100-113; `POST /api/driver/access-requests` :867-930; `POST /redeem-invite` :1158-1300; `POST /claim-invite` :1029-1156 | B01,B02,B04,B05 | 31-35,44,45 | `test/parity/driver-invite-redemption-parity.test.ts` | High | High | Does `/join` replace these three or wrap them? |
| SI-JOIN-02 | `apps/api/src/repositories/driver-access-requests.ts` | `createSelfRequest` :164-336; `listForOperator` :352; `approveRequest` :470-661; `denyRequest` :681 | B04,B07,I04 | 37,44,45,129,130,133-136 | `driver-access-requests.test.ts`; `test/parity/driver-access-request-flow.test.ts` | High | High | Group choice is min-member-count — is that intended policy or an accident? |
| SI-JOIN-03 | `apps/api/src/routes/admin/access-requests.ts` | `adminAccessRequests`; `GET /api/admin/access-requests` :76; `PATCH /api/admin/access-requests/:id` :112-223 | B07 | 129,130,133,135,136 | `test/parity/driver-access-request-flow.test.ts` | High | High | `assertPermission("member.write")` is the only gate — right permission for approvals? |
| SI-JOIN-04 | `apps/api/src/lib/rate-limit.ts` | `rateLimit` :116-144; fail-open branch :121-129; `getRequestIp` :66 | J06 | 127,128 | none exist | High | High | Flip to fail-closed globally, or only for the join surface? |
| SI-JOIN-05 | `apps/api/src/lib/driver-session.ts` | `mintDriverToken` :66; `verifyDriverToken` :88-113; `driverSessionConfig` :115; stateless, no revocation | B01 | 31 | none exist | High | High | Revocation is wait-for-expiry only — acceptable for a credential-backed join? |
| SI-JOIN-06 | `apps/api/src/repositories/host-invites.ts` | `createDriverInvite` :146-210; `generateInviteCode` :86-94; creates invitee with `status: "active"` :181 | B14,B12 | 32,33,39 | `test/parity/driver-invite-redemption-parity.test.ts` | High | High | B14 wants `status:"invited"` — who consumes that status today? |
| SI-JOIN-07 | `apps/api/src/repositories/driver-group-memberships.ts` | `createMembership` :53-79; `listMembershipsForDriverGroup` :90; `removeMembership` :118 | B07 | 44,129,130 | `test/parity/driver-group-memberships-route.test.ts` | Medium | High | Read-then-insert is not atomic — needs a unique-constraint upsert for scen 130 |
| SI-JOIN-08 | `apps/api/src/routes/admin/driver-group-memberships.ts` | `adminDriverGroupMemberships`; `POST /:orgId/driver-group-memberships` :46; `GET` same path :154 | B07 | 129,131,132 | `test/parity/driver-group-memberships-route.test.ts` | Medium | High | No DELETE route exists — where does revoke live? |
| SI-JOIN-09 | `packages/shared/src/db/identity.ts` | `userTokens` table :222-243 with `security`, `passwordKeyHash`, `maxRedemptions`, `driverGroupId`; `driverInviteSecurityEnum` :57 | B03,J01,J02 | 36,39,40 | none direct | High | High | Is `password_key_hash` the intended home for the Group J passphrase, or a new table? |
| SI-JOIN-10 | `packages/shared/src/db/commercial.ts` | `driverAccessRequests` :410-430; `driverAccessRequestStatusEnum` :52 includes `withdrawn`; `driverAccessRequestTriggerEnum` :51 | B04,J01 | 134,136 | `test/parity/driver-access-request-flow.test.ts` | High | High | `withdrawn` is never written by any code — build it or drop it? |
| SI-JOIN-11 | `apps/api/src/lib/credential-crypto.ts` | `sealPassword` :40-50; `openPassword` :52-61; `deriveAesKey` :19-31 using `OCPP_CRED_KEK` | J02 | 121,122 | `vendor-credential-probe.test.ts` (mocked) | Medium | High | AES-GCM seal is reversible — J02 wants PBKDF2 one-way. Different primitive needed |
| SI-JOIN-12 | `apps/api/src/repositories/credential-management.ts` | `unsealAndAuth` :121-143; `getCredentialManagementTree` :145; `applyCredentialSelection` :354 — vendor/Zaptec, not driver join | — | — | `vendor-credential-probe.test.ts` | Low | High | Named in seeds but out of scope — confirm the naming collision is understood |
| SI-JOIN-13 | `apps/api/src/routes/public/register.ts` | `publicRegister`; `POST /api/public/register` :72; mounted `index.ts:220`; no client caller | I01,I02 | 31 | `register.test.ts` | Medium | High | Mobile app never calls it — is web the intended caller or is it dead? |
| SI-JOIN-14 | `apps/api/src/lib/email-templates/access-request-submitted.ts` and siblings | `renderAccessRequestSubmittedEmail` :30; `-approved.ts` :29; `-denied.ts` :29; `-inbound.ts` :33 | B04 | 133 | `access-request.test.ts` | Low | High | Emails link `/people/access-requests` and `/account/access-requests` — neither page exists |

**Area findings**

1. `POST /api/driver/join` **does not exist**, and neither does `apps/api/src/routes/public/join.ts` — the directory listing of `apps/api/src/routes/public/` contains only `driver.ts`, `driver-charger-pin.ts`, `driver-tap-intent.ts`, `email-verification.ts`, `host-applications.ts`, `invites.ts`, `password-reset.ts`, `register.ts`. Group B is a greenfield route, not a refactor.
2. `installation_access_credential` **does not exist** in any form — no Drizzle table, no Prisma model, no migration, no route. A repo-wide grep for `installation_access_credential` / `installationAccessCredential` returns zero hits. All of Group J (J01-J08) and scenarios 121-128 are unbuilt from zero; there is no code+passphrase concept anywhere in the codebase.
3. `apps/api/src/lib/rate-limit.ts:121-129` fails **OPEN** when the binding is missing — it logs a warn and calls `next()`. J06 and scenario 127 require the opposite. Worse, the join-adjacent routes are not rate-limited at all: `POST /access-requests` (driver.ts:867) and `POST /redeem-invite` (driver.ts:1158) take no `rateLimit` middleware; only `/login` and `/claim-invite` (driver.ts:1030-1035) do. The binding names are `ADMIN_LOGIN_RATE_LIMITER` and `DRIVER_LOGIN_RATE_LIMITER` (bindings.ts:95-100, apps/api/wrangler.jsonc:144-152) — there is no per-code bucket, so scenario 128 has no binding to key on.
4. Identity binding is **already implemented and already tested** — `driver.ts:1207` compares `row.userId !== userId` before the conditional claim at :1249, returns a byte-identical `not_found` 404, and writes `driver_invite.redemption_rejected` to audit (:1217). `apps/api/test/parity/driver-invite-redemption-parity.test.ts:388-594` covers scenarios 32-35 against a real DB. B02/B12 should reuse this, not re-derive it.
5. The `withdrawn` status is a **write-dead enum value**: `packages/shared/src/db/commercial.ts:52` defines it and `routes/admin/access-requests.ts:71` accepts it as a *filter*, but no code path anywhere sets it. There is no driver-side withdraw endpoint, so scenario 134 has no implementation and the request-side of scenario 45 (re-request returns the first) is only half-true — `createSelfRequest` returns `{error:"already_requested"}` with a 409 (driver.ts:911-919), which is exactly the 409 scenario 45 says must become a 200.
6. `createMembership` (driver-group-memberships.ts:53-79) does a SELECT-then-INSERT with no unique constraint fallback, and `approveRequest` (driver-access-requests.ts:576-599) does the same read-then-create inside its transaction. Scenario 130 ("two concurrent approvals → one grant and one 409") will not hold as written — the loser gets a raw Postgres unique-violation, not a 409, assuming `driverGroupId_userId` is unique at all.
7. There is **no client for any of this**. `apps/mobile/lib/api/client.dart` calls twelve `/api/driver/*` endpoints and none of them are `/access-requests`, `/redeem-invite`, or `/claim-invite`. The operator console pages the emails link to (`/people/access-requests`, `/account/access-requests`, built by `buildOperatorInboxUrl` / `buildDriverStatusUrl` at driver-access-requests.ts:128-142) exist in neither `src/app/` nor the archived console at `archive/straumvakt-org-console-2026-08-08/`. Every approve/deny email currently sends the recipient to a 404.
8. `apps/api/src/repositories/driver-access-requests.ts:53-73` accesses the table through a `PrismaClient & { driverAccessRequest: any }` cast, and `routes/admin/access-requests.ts:151-166` repeats the same escape hatch with a hand-written structural type. The comment says it goes away "once ENROLL-1 + ENROLL-3 land" — they have landed and the cast has not. Any Group B/J work on this file is typing against `any`.
9. No `Idempotency-Key` infrastructure exists for HTTP requests. The only idempotency-key code is `batchInsertIdempotencyKeys` / `findExistingIdempotencyKeys` in `apps/api/src/lib/db/raw.ts` for the OCPP ingest path — a different concern with a different key space. B06 and scenario 43 start from nothing.
10. `credential-crypto.ts` is the wrong primitive for J02. `sealPassword`/`openPassword` (:40-61) are AES-GCM under a single worker-secret KEK — deliberately **reversible**, because Zaptec portal passwords must be replayed to a third party. A join passphrase must be one-way (PBKDF2 per J02), so Group J needs a new helper rather than a reuse, and `OCPP_CRED_KEK` should not be extended to cover it.
## A03 — Permission resolver, requirePermission, platform grants, org scope, admin session

Authorization is a two-layer, fully-live system, not a stub. Layer one is a pure
catalogue in `permissions.ts` (25 per-tenant verbs, 15 platform verbs, six
membership bundles plus five deprecated-role aliases, six platform-role bundles).
Layer two is `effective-permissions.ts`, which loads the caller's one active
`tenancy.memberships` row for the target org and their one active
`identity.platform_grants` row, unions the bundles, then **expands
`platform.tenant.{read,write,delete}` into the whole matching per-tenant verb
family** — which is how platform staff get tenant access at all. `requirePermission`
is wired at 163 non-comment call sites across 38 route files, so the model really
is enforced. Three things the packet assumes are wrong. (1) The "bootstrap admin
gets god-mode" branch is dead: since Sprint 5.5 the login route always stamps
`userId` on the cookie, so `isBootstrapSession` returns false and the bootstrap
admin passes through the ordinary DB path on the `super_user` grant that
`bootstrapAdminUser` creates. (2) `member.remove` **is** gated, contradicting D02
and doc 16. (3) 85 of the gates name a per-tenant verb but pass no `orgIdParam`,
so `orgId` is `null`, the membership lookup is skipped entirely, and only the
platform expansion can satisfy them — a `host_admin` can never pass those routes,
which is the opposite of what C03 assumes. Support context does not exist in any
form: no table, no module, no column, no call site.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-PERMISSIONS-01 | `apps/api/src/lib/auth/permissions.ts` | `PER_TENANT_PERMISSIONS` :41-75; `PLATFORM_PERMISSIONS` :77-100; `MEMBERSHIP_ROLE_PERMISSIONS` :209-230; `PLATFORM_ROLE_PERMISSIONS` :242-279; `effectivePermissions` :324 | D01,D04,D06,D07,D08,D09,D10,C12 | 63,67,71-73 | `permissions.test.ts`; `effective-permissions.test.ts` | High | High | Deleting `platform.impersonate` breaks the literal super_user list at :243 and the exhaustive test at :176 — same-commit change? |
| SI-PERMISSIONS-02 | `apps/api/src/lib/auth/effective-permissions.ts` | `getActiveMembership` :35; `getActivePlatformGrant` :65; `expandPlatformTenantVerbs` :103-139; `resolveEffectivePermissions` :154; `expandPermissionsSync` :177 | C02,C03,D10 | 52,63,64,67 | `effective-permissions.test.ts` | High | High | Does C03 mean carving `member.*` out of the tenant.write expansion, as the file's own comment :96-101 proposes? |
| SI-PERMISSIONS-03 | `apps/api/src/lib/auth/require-permission.ts` | `requirePermission` :45-89; `assertPermission` :106-134; `isBootstrapSession` :147-151; `sessionUserId` :161-164; `RequirePermissionOptions.orgIdParam` :31 | C02,C03,C04,C05,C06 | 47,48,50,51,52,56,63,64 | `require-permission.test.ts` | High | High | The guard needs to know whether access was membership-derived or platform-derived — the resolver returns a flat verb list and throws that distinction away |
| SI-PERMISSIONS-04 | `apps/api/src/lib/auth/org-scope.ts` | `OrgScope` :26; `orgInScope` :29; `resolveOrgScope` :38-63 | C03,C06 | 50,63,64 | none — no test file exists | High | High | Should support context narrow `OrgScope` to the one bound org, or is that C06's job inside requirePermission only? |
| SI-PERMISSIONS-05 | `apps/api/src/lib/admin-session.ts` | `SessionPayload` :10-21 with optional `userId` :20; `createAdminSession` :61; `verifyAdminSession` :79; `adminSessionConfig` :106 | C02,C10 | 69,70 | `require-permission.test.ts` constructs this shape | High | High | Does the support context live in the cookie or only in the DB? Cookie is a 12h HMAC with no revocation path |
| SI-PERMISSIONS-06 | `apps/api/src/lib/auth-middleware.ts` | `AuthVars` :9; `requireAdmin` :11-20 sets `c.set("session", ...)` | C02 | 47,69 | `require-permission.test.ts` mimics this middleware | Medium | High | — |
| SI-PERMISSIONS-07 | `apps/api/src/routes/admin/auth.ts` | `POST /api/admin/login` :28; Path A bootstrap :77-91; Path B UserCredential :92-132; `createAdminSession({ userId })` :134-137; `POST /api/admin/logout` :166 | C02,C03 | 63,69 | `apps/api/test/parity/admin-bootstrap.test.ts` | High | High | Path B mints a cookie for org members with no grant — those users hit 403 on the 85 orgId-less gates; is that in scope for C03? |
| SI-PERMISSIONS-08 | `apps/api/src/repositories/admin-bootstrap.ts` | `bootstrapAdminUser` :46-105; creates `super_user` PlatformGrant :86-95; `BootstrapResult` :32 | C02,C03 | 63,74 | `apps/api/test/parity/admin-bootstrap.test.ts` (real-DB, rolled back) | Medium | High | With the guard in place the bootstrap admin becomes platform-derived and would need a context for every tenant read — intended? |
| SI-PERMISSIONS-09 | `apps/api/src/routes/admin/me.ts` | `GET /api/admin/me` :33-81; persona fork :72-78 returns operator/host_admin/member/none; `isPlatform` :65 | C08 | 52,60,64 | none | Medium | High | Is `/me` where the UI learns about an open support context, or does C08 add a separate endpoint? |
| SI-PERMISSIONS-10 | `packages/shared/src/db/identity.ts` | `platformGrants` :386-399 (userId PRIMARY KEY, `scope` jsonb, `expiresAt`); `memberships` :316-336; `platformRoleEnum` :66; `membershipRoleEnum` :61 | C01,C06 | 47,51,63 | `apps/api/test/parity/schema-columns.test.ts` | High | High | `platform_grants.scope` jsonb exists and nothing reads it — reuse for context binding or leave it dead? |
| SI-PERMISSIONS-11 | `apps/api/src/domains/identity/routes/admin-memberships.ts` | `PATCH /api/admin/memberships/:orgId/:userId` :13 gated `member.write`; `DELETE /api/admin/memberships/:orgId/:userId` :31 gated `member.remove` :33 | D02 | 64,65 | none directly | Low | High | D02 says member.remove is unenforced — it is enforced here. Is D02 already closed or does it mean a different removal path? |
| SI-PERMISSIONS-12 | `apps/api/src/domains/identity/routes/admin-users.ts` | `GET /` :42 `platform.tenant.read`; `POST /` :51 `platform.tenant.write`; `GET /:id` :67 and `PATCH /:id` :102 use `member.read`/`member.write` with NO orgIdParam | D10,P05 | 63,66 | none | Medium | High | These per-tenant gates resolve with orgId=null so only platform expansion satisfies them — bug or deliberate cross-tenant surface? |
| SI-PERMISSIONS-13 | `apps/api/src/routes/admin/access-requests.ts` | `assertPermission(c, "member.write", orgId)` :90 and :178; imports at :33 | C02,C06 | 50,64 | `apps/api/test/parity/driver-access-request-flow.test.ts` | Medium | High | `assertPermission` is a second, parallel enforcement seam — C02's guard must land in both or it is bypassable here |
| SI-PERMISSIONS-14 | `src/lib/org-context.ts` | `AdminMe` :39-45; `requireOrgContext` :131-140; `orgLandingPathForSession` :159 — UI-side consumer of GET /api/admin/me | C04 | 60,61 | none | Low | Medium | Where does the support banner read expiry from if the UI only sees persona, not context state? |

**Area findings**

1. The bootstrap god-mode branch is dead code for every session minted since Sprint 5.5. `apps/api/src/routes/admin/auth.ts:134-137` always passes `userId` into `createAdminSession`, `admin-session.ts:20` carries it, and `require-permission.ts:147-151` defines a bootstrap session as `sub === "admin"` AND **no** userId. So `isBootstrapSession` returns false for a freshly-logged-in bootstrap admin, the `return next()` at `require-permission.ts:55-59` never fires, and the admin passes only because `repositories/admin-bootstrap.ts:86-95` gave them a `super_user` PlatformGrant. Consequence for C02: the guard will intercept the bootstrap operator, not just support agents — there is no longer a god-mode escape hatch, and `require-permission.test.ts:67-93` exercises a session shape production no longer produces.

2. 85 of the `requirePermission` call sites name a per-tenant verb and pass no `orgIdParam`. `require-permission.ts:69-71` then sets `orgId = null`, and `effective-permissions.ts:160` skips `getActiveMembership` entirely, so the membership bundle contributes nothing. Those 85 gates are satisfiable **only** through `expandPlatformTenantVerbs`. C03 ("membership-derived access needs no context", scenario 52/64) therefore cannot hold on those routes as written — there is no membership-derived path to leave alone. Only 32 call sites pass `orgIdParam`.

3. `member.remove` is enforced at `apps/api/src/domains/identity/routes/admin-memberships.ts:33`. D02 and `docs/domain/onboarding/16-permission-matrix.md:56,100` both claim it is unenforced; the source disagrees. The doc's "18 verbs with zero call sites" is also off in the other direction: `tariff.read` is unenforced and is not on the doc's list. Verified-unenforced set is 17: `tariff.read`, `tariff.write`, `contract.write`, `audit.read`, `billing.export`, `platform.impersonate`, `platform.support.action`, `platform.audit.read`, `platform.tariff_catalogue.{read,write}`, `platform.finance.{read,write}`, `platform.grant.{read,write}`, `platform.feature_flag.{read,write}`, `platform.migration.run`.

4. Support context does not exist anywhere. Grepping the whole tree for `SupportContext`, `support_context`, `supportContext`, `onBehalfOfOrgId` and `platform.support.action` returns hits in exactly two files: `apps/api/src/lib/auth/permissions.ts:83` (the catalogue entry) and `apps/api/src/lib/auth/permissions.test.ts`. There is no `lib/auth/support-context.ts`, no Prisma model, no migration, and no audit column. C01-C15 is greenfield in full.

5. `expandPlatformTenantVerbs` at `apps/api/src/lib/auth/effective-permissions.ts:111-120` classifies `member.invite`, `member.write` and `member.remove` as WRITE verbs, so any grant holding `platform.tenant.write` — `super_user`, `platform_admin`, **and `sales_cs`** (`permissions.ts:266-270`) — can invite, edit and remove members in every organisation. The file's own comment at :96-101 flags this as a known caveat deferred from Sprint 4.3. Note `sales_cs`'s `platform.tenant.write` carries the comment "column-restricted in repo layer (org notes/tags only)" at `permissions.ts:268`, but the expansion does not honour that restriction and no repo-layer column restriction was found.

6. `apps/api/src/lib/auth/org-scope.ts` has no test file — it is the only module in `lib/auth/` without one, and `resolveOrgScope` is called from just 10 handlers across 8 route files (`active-sessions`, `billing`, `chargers` x2, `circuits` x2, `installations` x2, `properties` x2, `sites` x3), all of them reads. No write path is row-scoped; writes rely on the verb gate alone.

7. `identity.platform_grants` uses `user_id` as its PRIMARY KEY (`packages/shared/src/db/identity.ts:386-389`), so a user has at most one platform grant and it cannot be org-bound. C06 ("context binds one org") cannot be expressed on the grant row; it needs the new C01 table. The table does carry an unused `scope` jsonb column (:398) and an `expiresAt` that `getActivePlatformGrant` already enforces (`effective-permissions.ts:84`), so per-request expiry checking (C05) has a working precedent to copy.

8. There is a second enforcement seam that C02 must also cover: `assertPermission` (`require-permission.ts:106-134`) is a route-called function, not middleware, used where orgId comes from a sub-resource lookup. It duplicates the same bootstrap/userId/resolve/deny logic. Live call sites are `routes/admin/access-requests.ts:90` and `:178`. A guard added only to the `requirePermission` factory leaves those two paths open.
## A04 — Audit and action logging, observability, outbox/dispatch, email side effects

Four loosely-coupled mechanisms live here. (1) **Audit**: a single writer,
`recordAuditAction`, that accepts either a Prisma or a Drizzle handle and inserts
one row into `audit.actions`; fourteen source files call it, one file reads it back,
and no API route exposes it — the log is write-mostly today. (2) **Outbox/dispatch**:
`ocpp.outbound_commands` rows are written by `enqueueCommand`, a `{commandId}`
message goes to a Cloudflare Queue, and `processCommand` claims the row with a single
atomic `UPDATE … WHERE status='pending'` and hands it to a `TargetRegistry` target
(only one is registered — the OCPP gateway service binding). A per-minute cron
sweeper re-publishes stale pending rows. (3) **Observability**: everything is
`console.log`/`console.error` inside the Worker — a structured-log convention
(`[ocpp-q]`, `[archive-q]`, `[partition-cron]`, `[ocpp-silence]`) plus one real
detector, `checkOcppSilence`, which reads only the protocol tables and escalates
`fleetWide` on a ratio. There is no alerting sink, no metrics store, and no
dashboard: an alert is a log line someone must be tailing. (4) **Email**: `sendEmail`
POSTs to Resend and fails open with a warn; every caller ignores or degrades on the
failure, and no email send writes an audit row. Against 18A Group N the docs assume
more than exists: there is no audit projection endpoint (N03), no `bearer` actor kind
(N02 — the enum is `user`/`system`/`vendor_webhook`/`ocpp_worker`, and only `user` is
ever written), no retention policy for `audit.actions` (N07), and no test file for
`audit.ts` at all.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-AUDIT-01 | `apps/api/src/lib/audit.ts` | `recordAuditAction` :58-86; `AuditActionInput` :26-34; `isDrizzle` :54 | N01,N02,N05,N06 | 155, 5-6 | none — no `audit.test.ts` exists | High | High | Does the dual-client shim get frozen or removed before Group N lands? |
| SI-AUDIT-02 | `packages/shared/src/db/platform.ts` | `actions` :91-108; `actorKindEnum` :29; `eventLog` :32; `protocolLog` :117; `archiveWatermark` :56 | N02,N05,N06,N07 | 155 | `apps/api/test/parity/domain-schemas.test.ts` | High | High | Adding `bearer` to `ActorKind` needs a Postgres enum migration plus the Prisma enum — who owns that? |
| SI-AUDIT-03 | `apps/api/src/repositories/installation-ocpp.ts` | `getInstallationOcppSummary` :260-293; `listInstallationOcppSummaries` :306-345 | N03,N05 | 115 | `installation-ocpp.test.ts` | Medium | High | This is the only audit reader in the codebase — is N03 meant to generalise it? |
| SI-AUDIT-04 | `apps/api/src/repositories/driver-access-requests.ts` | `createSelfRequest` :164; `approveRequest` :470; `denyRequest` :681; audit :263,615,741; email :289,314,648,767 | N01,N05,R06 | 155 | `driver-access-requests.test.ts`; `apps/api/test/parity/driver-access-request-flow.test.ts` | High | High | Audit is inside the tx and email outside it — is a sent-but-rolled-back email acceptable? |
| SI-AUDIT-05 | `apps/api/src/lib/email.ts` | `sendEmail` :41-101; `SendEmailResult` :33-36; `DEFAULT_FROM` :38 | R06,N08 | 156 | `email.test.ts` | Medium | High | Fail-open means a silent non-delivery — should a failed send become an audit row? |
| SI-AUDIT-06 | `apps/api/src/repositories/outbound-commands.ts` | `enqueueCommand` :43-84; table `ocpp.outbound_commands`; `OUTBOUND_QUEUE.send` :76 | — | 118 | none | High | High | `correlationId` is required by the caller but never validated — where is it minted? |
| SI-AUDIT-07 | `apps/api/src/lib/dispatcher.ts` | `processCommand` :128-165; `sweepStuckPending` :174-191; `claimById` :49-84; `markFailed` :100 | R04 | 118 | none | High | High | Nothing enforces max attempts — is an unbounded retry loop intended? |
| SI-AUDIT-08 | `apps/api/src/lib/dispatch-targets.ts` | `TargetRegistry` :33-51; `ServiceBindingOcppTarget` :62-125; `buildRegistry` :132-139 | — | 118 | none | Medium | High | Vendor targets are described in the header comment but none are registered — planned or dropped? |
| SI-AUDIT-09 | `apps/api/src/index.ts` | `handleOutboundCommandBatch` :294-319; `queue()` :324-352; `scheduled()` :354+; silence log :438-473 | R01,R02,R03,R04 | 118 | none | High | High | Every cron branch is `ctx.waitUntil` with a swallowed catch — is partial cron failure meant to be invisible? |
| SI-AUDIT-10 | `apps/api/src/lib/ocpp-silence-watch.ts` | `checkOcppSilence` :108-180; `isFleetWide` :72-76; `SILENCE_THRESHOLD_MS` :31; `FLEET_WIDE_SPEAKING_RATIO` :64 | R01,R03 | — | `ocpp-silence-watch.test.ts` | Medium | High | Output is a console line only — where does R01/R03 "fires" actually route? |
| SI-AUDIT-11 | `apps/api/src/queues/ocpp-events.ts` | `handleOcppEventsBatch` :171+; `fanOutToArchive` :136-168; `HEARTBEAT_EVENT_TYPES` :105; `percentile` :118 | R04,N06 | — | `ocpp-events.test.ts` | High | High | Heartbeats are recorded but never archived — see finding 4 |
| SI-AUDIT-12 | `apps/api/src/queues/archive-events.ts` | `buildArchiveKey` :46-64; `handleArchiveEventsBatch` :113-228; `recordWatermarksViaPg` :89 | N06,N07 | — | `archive-events.test.ts` | High | High | Malformed envelopes are acked and dropped with no durable record — acceptable for evidence? |
| SI-AUDIT-13 | `apps/api/src/lib/db/archive-watermark.ts` | `aggregateWatermarkDeltas` :78-93; `upsertArchiveWatermarks` :100-134; `readArchiveWatermarks` :141-167 | N06,N07 | — | `archive-watermark.test.ts` | Medium | High | Watermark counts objects, not rows — is the 1:1 assumption ever checked? |
| SI-AUDIT-14 | `apps/api/src/lib/db/partition-cron.ts` | `decidePartitionDrop` :329-405; `readPartitionGroups` :445-465; `POSTGRES_RETENTION_DAYS` :191; `DROPPABLE_PARENTS` :226 | N07 | — | `partition-cron.test.ts` | High | High | Gate compares archived objects to all rows including unarchived heartbeats — see finding 4 |

**Area findings**

1. **`audit.actions` is written but never exposed.** Fourteen source files call
   `recordAuditAction` (`apps/api/src/lib/audit.ts:58`), yet the only code that reads
   the table anywhere in the repo is
   `apps/api/src/repositories/installation-ocpp.ts:272` and `:330`, and it reads
   exactly three action names (`installation.ocpp_password.{rotate,set,disable}`) to
   derive a `lastRotatedAt` timestamp. There is no `GET` route, no repository, and no
   UI over `audit.actions`. 18A **N03 "Audit projection endpoint"** and **N04
   "Org-visible staff actions"** are therefore greenfield, not hardening.

2. **`ActorKind` has no `bearer` value, and only `user` is ever written.**
   `prisma/schema/platform.prisma:119-126` and
   `packages/shared/src/db/platform.ts:29` both declare
   `user | system | vendor_webhook | ocpp_worker`. A repo-wide scan of
   `actorKind: "…"` literals returns 24 hits and every single one is `"user"` — the
   other three enum values are dead. **N02** needs a Postgres enum ALTER plus a Prisma
   enum edit before any code change, and scenario 6 ("`actorKind` is `bearer`")
   cannot pass today. Note that the one place a bearer-style rejection *is* audited —
   `apps/api/src/routes/public/driver.ts:1214` writing
   `driver_invite.redemption_rejected` — hard-codes `actorKind: "user"`, and is
   wrapped in `if (row.driverGroup)` (`:1206`) because `audit.actions.org_id` is
   `NOT NULL` with an FK. A malformed token's rejection goes unlogged entirely.

3. **The outbox has no terminal failure state.** `processCommand`
   (`apps/api/src/lib/dispatcher.ts:128`) marks a row `failed` only for "no target"
   or a `permanent` dispatch result; a `retriable` result leaves the row `pending`
   (`:161-164`, with a comment admitting "a DLQ consumer … would mark the row
   failed"). No DLQ consumer exists: `apps/api/wrangler.jsonc:87,109,116` declare
   three dead-letter queues and `apps/api/src/index.ts:324-352` has no branch for any
   of them. Meanwhile `claimById` pushes `not_before` only 30s forward (`:59`,
   default `crashRetryFloorSec = 30`) while `sweepStuckPending` re-publishes anything
   older than 60s (`:179`), on a `* * * * *` cron. A charger that is permanently
   unreachable produces a command row that is re-dispatched forever with an
   ever-growing `attempts` counter. Grepping the whole of `apps/api/src` for
   `maxAttempts`/`max_attempts`/`attempts >` returns nothing.

4. **The partition-drop gate and the archive fan-out disagree, so `protocol_log`
   partitions can never be dropped.** `fanOutToArchive`
   (`apps/api/src/queues/ocpp-events.ts:154-157`) deliberately filters heartbeats out
   of the archive queue per ADR 0040 D4 — but heartbeats *are* written to
   `events.protocol_log` as `raw_protocol` (`gateway/src/identity-do.ts:238` stamps
   the class; `apps/api/src/lib/ocpp/events-repository.ts:138-139` routes it;
   `apps/api/src/queues/ocpp-events.ts:229` inserts them via `batchIngestHeartbeats`).
   `readPartitionGroups` (`apps/api/src/lib/db/partition-cron.ts:445`) counts every
   row in the partition with no event-type exclusion, and `decidePartitionDrop`
   (`:389-391`) blocks on `archived < g.rows`. Since heartbeats dominate
   `protocol_log` and contribute zero archived objects, the gate will emit
   `watermark_shortfall` permanently. This is not a config problem — it is two ADRs
   whose rules do not compose.

5. **All "alerts" are console lines and all cron work is fire-and-forget.** Every
   observability signal in `apps/api/src/index.ts:354-473` is wrapped in
   `ctx.waitUntil((async () => { try … catch { console.error } })())`. The OCPP
   silence watch — the one detector built from a real three-month outage — reports
   via `console.error("[ocpp-silence] FLEET-WIDE …")` at `:449` and
   `console.warn("[ocpp-silence]", …)` at `:458`. Nothing is persisted, emailed, or
   sent to a webhook. 18A **R01/R02/R03** all specify "Fires", and there is currently
   no mechanism for anything to fire into.

6. **`webhooks` is a phantom schema.** `packages/shared/src/db/platform.ts:26`
   exports `webhooksSchema = pgSchema("webhooks")` and lines 110-114 carry three
   doc-comment placeholders (`WebhookSubscription`, `WebhookDelivery`,
   `WebhookDeadLetter`) with **no table bodies**. `prisma/schema/platform.prisma`
   declares only five models (`EventLogEntry`, `ArchiveWatermark`, `IdempotencyKey`,
   `AuditAction`, `ProtocolLogEntry`) — none of them webhooks. A repo-wide grep for
   `webhookSubscription|webhookDelivery|webhookDeadLetter` hits only that one file.
   Any packet text implying a webhook delivery/dead-letter path is describing
   something that does not exist.

7. **Zero unit tests cover the audit writer or the dispatcher.** There is no
   `audit.test.ts`, `dispatcher.test.ts`, or `dispatch-targets.test.ts`; a grep for
   `recordAuditAction|processCommand|sweepStuckPending|buildRegistry` across all
   `*.test.ts` in the repo returns no files. The only coverage of audit writes is
   incidental, via a Prisma fake in
   `apps/api/src/repositories/driver-access-requests.test.ts:487-488` and `:621`,
   which asserts row counts. Scenario 155 ("exactly one audit event per state
   change") has no test harness to hang off today. By contrast the archive/retention
   side is well covered — `archive-events.test.ts`, `archive-watermark.test.ts`,
   `partition-cron.test.ts`, `ocpp-events.test.ts`, `ocpp-silence-watch.test.ts` and
   `email.test.ts` all exist next to their sources.

8. **Email is fully decoupled from audit.** `sendEmail`
   (`apps/api/src/lib/email.ts:41`) has seven call sites:
   `repositories/{driver-access-requests,host-applications,registration}.ts` and
   `routes/admin/org-invites.ts`. Of those, only `driver-access-requests.ts` also
   writes an audit row. Driver registration, email verification, password reset and
   host-application submission produce **no** `audit.actions` row at all, and the
   org-invite route (`routes/admin/org-invites.ts:120`) audits in the repository
   layer, not around the send. `sendEmail` returns a discriminated result that
   callers log-and-continue on (`:47`, `:75`, `:81`), so a Resend outage is invisible
   outside the Worker tail.

9. **The audit shim's own comment is one file out of date.**
   `apps/api/src/lib/audit.ts:8` says "This is called from 15 files"; the actual
   count of non-test, non-doc callers is 14 (`routes/public/{driver,invites,
   driver-charger-pin}.ts`, `routes/admin/{driver-group-memberships,bill-objects}.ts`
   and nine repositories). Minor, but it means the "delete the Prisma branch when the
   last caller ports" checklist is being tracked by hand and has already drifted.
## A05 — OCPP authorization, idTag classification, token handling, local auth list

Today the charger's `Authorize` / `StartTransaction` idTag is resolved by one pure
function, `resolveAuthorize` in `apps/api/src/routes/internal/ocpp-authorize.ts`, called
over a Cloudflare service binding from the gateway Durable Object. It does an exact
unique lookup on `identity.id_tokens.value`, applies status → expiry → installation-scope
→ contract-membership → clause-count gates in that order, and returns a verdict plus the
installation's `enforceAuthorize` flag. The gateway honours the verdict only when that
flag is true; otherwise it logs and replies `Accepted` (shadow mode), and it caches
verdicts in DO storage for 60 s keyed by idTag. What the packet's Group E assumes does
not exist yet: there is no `tokenClass` column, no `attribution` field in the authorize
response, no `session_attribution` table and no `authorization_decision` table anywhere
in the repo — `IdToken.userId` is a NOT NULL FK to `User`, so "technical token ⇒ userId
null" is a schema change, not a resolver change. Attribution today happens once, late and
elsewhere: `projections.ts` re-resolves `idTag → IdToken(status='active') → userId` at
session-stop and writes it to `session_ledger.driver_user_id`, while
`charging.sessions.user_id` is never written by the OCPP path at all. The classifier
(`idtag-classifier.ts`) is a pure shape heuristic used only for display in session detail
— it never feeds a verdict, and it does not know about the phone-tap random-UID rule that
the resolver itself relies on. Local auth list is one-token-at-a-time Differential push
with guards mirroring the online resolver; there is no revocation propagation.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-OCPP-01 | `apps/api/src/routes/internal/ocpp-authorize.ts` | `resolveAuthorize` :130-340; `AuthorizeReason` :56-73; `PrismaLike` :353; POST /api/internal/ocpp-authorize :75 | E03,E04,F01 | 75-79 | `ocpp-authorize.test.ts` | High | High | Does `attribution` go in the same response object or a sibling field the old gateway ignores |
| SI-OCPP-02 | `gateway/src/identity-do.ts` | `responseFor` :725; `resolveAuthorizeVerdict` :786; `requestAuthorizeVerdict` :913; `stubResponseFor` :950; POST /invalidate-authorize :358 | E16,F03,F08 | 79,87,90 | `identity-do.test.ts`, `index.test.ts` | High | High | Should the 60 s verdict cache be shortened once a real deny path exists |
| SI-OCPP-03 | `apps/api/src/lib/idtag-classifier.ts` | `classifyIdTagFormat` :73-147; `idTagKindLabel` :153; `EMAID_PATTERN` :64 | E02,F09,R02 | 75-77,81 | `idtag-classifier.test.ts` | Medium | High | Is `detectedKind` allowed to seed `tokenClass` or must E02 be an operator decision only |
| SI-OCPP-04 | `apps/api/src/domains/identity/repositories/id-tokens.ts` | `createIdToken` :119; `mintRfidValue` :49; `revokeIdToken` :229; `updateIdToken` :286; `backfillPrimaryRfidForUsersWithoutTokens` :357 | E01,E02,E13 | 81,82 | `id-tokens.test.ts` | High | High | E04 needs `id_tokens.user_id` nullable — who owns that migration |
| SI-OCPP-05 | `apps/api/src/lib/ocpp/projections.ts` | `onOcppRawStartTransaction` :835; idTag to IdToken resolve :407-415 and :972-977; `sessionLedger.upsert` :423 | E06,E07,E14 | 78,79,84 | `projections.test.ts` | High | High | Does `session_attribution` replace `session_ledger.driver_user_id` or shadow it |
| SI-OCPP-06 | `apps/api/src/repositories/local-auth-list-push.ts` | `pushIdTokenToCharger` :74; `PushIdTokenError` :57; status/scope/contract guards :118-188 | E15 | 75,78 | none — no test file exists | High | High | Should a technical-class token be pushable to a local list at all |
| SI-OCPP-07 | `apps/api/src/repositories/charger-technical-read.ts` | `getChargerTechnicalRead` :377; `getLocalAuthRosterForInstallation` :139; `decideVerdict` :255 | E15,F01 | 75-77,81 | `charger-technical-read.test.ts` | Medium | High | `decideVerdict` omits the zero-clause gate the resolver has — intentional or drift |
| SI-OCPP-08 | `apps/api/src/repositories/tap-intents.ts` | `matchAndConsumeTapIntent` :250; `TAP_INTENT_TTL_SECONDS` :50; `REPRESENT_WINDOW_SECONDS` :115; `TapIntentMatch` :86 | E11 | 84 | none — no test file exists | High | High | Is a tap-intent match `basis='tap'` and does it count as a driver upgrade under E08 |
| SI-OCPP-09 | `apps/api/src/lib/tap-intent/random-uid.ts` | `isRandomEmulatedUid` :67; `normaliseIdTag` :46; `randomUidLabel` :76; `RANDOM_UID_PATTERN` :38 | E02,E11 | 79,84 | none — no test file exists | Medium | High | Should the classifier import this so `08xxxxxx` stops reporting as a 4-byte card |
| SI-OCPP-10 | `apps/api/src/lib/ocpp-internal-auth.ts` | `verifyIngest` :53; `hexEquals` :17; `constantTimeEquals` :34; header `x-straumvakt-ingest` :11 | — | 75-90 | none — no test file exists | High | High | — |
| SI-OCPP-11 | `apps/api/src/routes/internal/ocpp-auth.ts` | POST /api/internal/ocpp-auth :52; case-insensitive identity match :90; no-auth accept :119 | — | 87 | `auth.test.ts` in gateway | High | High | Does free-vend/no-auth need its own attribution class distinct from unknown |
| SI-OCPP-12 | `apps/api/src/routes/admin/chargers.ts` | POST /api/admin/chargers/:ocppIdentityId/local-auth-list/push :491-518; `requirePermission("charger.config")` | E15 | 75,78 | none for this route | Medium | High | Push accepts `requestedBy: null` hardcoded — who is the audit actor |
| SI-OCPP-13 | `apps/api/src/domains/identity/routes/admin-id-tokens.ts` | DELETE /api/admin/tokens/:tokenId :61 revoke; DELETE …/hard :86; PATCH :125; POST /backfill :40 | E01,E13 | 82,85 | none — no test file exists | Medium | High | Revoke must also invalidate the gateway verdict cache — where does that call live |
| SI-OCPP-14 | `apps/api/src/repositories/session-full-detail.ts` | `classifyIdTagFormat` consumption :548-568; `idTagClassification` block; `confidenceTier` :543 | E03,E14,F09 | 76,77,79 | none — no test file exists | Low | Medium | Does the session UI show `attribution` from the new table or keep deriving it here |

**Area findings**

1. `tokenClass` does not exist. A repo-wide grep for `tokenClass`, `token_class`,
   `session_attribution`, `sessionAttribution`, `authorization_decision` and
   `authorizationDecision` across `*.ts`, `*.prisma` and `*.sql` returns zero hits.
   E01, E05, E06, E07, E10 are all greenfield, not edits.
2. `IdToken.userId` is NOT NULL with a cascading FK
   (`apps/api/prisma/schema/identity.prisma:215` and `:239`). E04 ("technical token ⇒
   `userId: null`") therefore cannot be satisfied in the resolver alone — it needs the
   column made nullable plus the E05 CHECK. The existing `IdTokenKind` enum
   (`identity.prisma:250-262`) has eight values including `evccid` and `virtual_rfid`,
   none of which express "belongs to the installation, not a person".
3. Attribution is computed twice and stored once, in the wrong place. `projections.ts:972`
   re-runs `idToken.findFirst({ where: { value: idTag, status: "active" } })` at
   session-stop and writes only `session_ledger.driver_user_id`. `charging.sessions` has a
   nullable `user_id` column (`charging.prisma:30`) that the OCPP projection never writes —
   `apps/api/scripts/backfill-session-user-from-idtag.ts:12-21` measured 56 staging sessions
   whose tag resolves but whose `user_id` was never set. Any E06 work must decide whether
   `session_attribution` supersedes both.
4. A tap-intent-authorised session is attributed to nobody. `resolveAuthorize` returns
   `userId` from the tap intent (`ocpp-authorize.ts:183-199`), the gateway only logs it
   (`identity-do.ts:680`), and the projection's only attribution path is
   `idTag → IdToken`. A random emulated UID can never be an `IdToken` by construction
   (`random-uid.ts:55-65`), so scenario 84's "tap evidence after an unknown session"
   currently has no persistence path at all — the verdict's `userId` is discarded.
5. The classifier and the tap detector disagree on the same string.
   `classifyIdTagFormat("085ACDF6")` returns `iso14443_4byte` / `high`
   (`idtag-classifier.ts:96-98`) while `isRandomEmulatedUid` calls the identical value a
   phone tap (`random-uid.ts:38`). The classifier imports only `./oui/lookup`
   (`idtag-classifier.ts:29`). Any operator UI reading `detectedKind` will confidently
   mislabel every phone tap as a physical card.
6. Two guards the packet may assume are missing are already present. The contract gate
   (active `DriverGroupMembership` under an active installation-type `Agreement`) runs in
   `ocpp-authorize.ts:275-306`, and a zero-clause agreement is refused with
   `no_billable_clauses` at `:320-330`. Both are gated behind `enforceAuthorize`, so they
   are inert at every installation until F02's runbook flips the flag. The same contract
   gate is duplicated in `local-auth-list-push.ts:165-188` and a third time, without the
   clause-count check, in `charger-technical-read.ts:255-266` — three copies of one rule.
7. Nothing ever calls the gateway's cache invalidation. `POST /invalidate-authorize/:id`
   exists (`gateway/src/index.ts:72-87`, `identity-do.ts:358, 870-898`) but grepping
   `apps/api/src` for `invalidateAuthorize` / `invalidate-authorize` returns zero hits, and
   `env.OCPP_GATEWAY` is used only by the dispatcher (`lib/dispatch-targets.ts:137`).
   `revokeIdToken` (`id-tokens.ts:229`) flips status and returns — so a revoked token keeps
   authorising for up to 60 s of DO cache, and indefinitely in a charger's local list, since
   `pushIdTokenToCharger` has no removal counterpart.
8. The gateway invents transaction ids. `stubResponseFor("StartTransaction")` returns
   `Math.floor(Math.random() * 2_000_000_000)` (`identity-do.ts:961`) and that id is never
   ingested — `onOcppRawStartTransaction` closes sessions by
   `(ocppIdentityId, status='in_progress')` instead (`projections.ts:828-833`). Scenario 78
   (two concurrent sessions on one technical token) has no way to disambiguate today.
9. An availability refusal is indistinguishable from a deny on the wire.
   `AVAILABILITY_REFUSAL_STATUS` is literally `"Blocked"` (`identity-do.ts:326`), separated
   from a real deny only by a log field (`:698`). F03's "driver sees a reason" has no
   channel in OCPP 1.6 `idTagInfo` — it needs an out-of-band surface.
10. Test coverage is uneven in a way that matters for change safety.
    `ocpp-authorize.test.ts`, `identity-do.test.ts` (1485 lines), `projections.test.ts`
    (35 KB) and `idtag-classifier.test.ts` exist and will break on any verdict-shape change.
    There is **no** test file for `local-auth-list-push.ts`, `tap-intents.ts`,
    `random-uid.ts`, `ocpp-internal-auth.ts` or `admin-id-tokens.ts` — every guard listed in
    finding 6 for the push path is currently unverified by CI.
## A06 — Charge session attribution, session ledger, driver sessions, dispute correction

A charge session is created twice over by two independent writer families: the OCPP
projection handlers (`session.started` / `ocpp.raw.StartTransaction`) and the Zaptec
CDR family (webhook `/session-start` `/session-end`, plus the polled `chargehistory`
sync). Both close the session, resolve a tariff chain, compute a cost with the pure
engine, and upsert one row into `reports.session_ledger`. Attribution is a
best-effort `idTag → IdToken.value → userId` lookup performed *at stop time* and
written only to the ledger's `driver_user_id`; the OCPP writers never populate
`charging.sessions.user_id` at all, so the two driver-facing surfaces disagree about
what the driver owns. There is no `session_attribution` table, no
`authorization_decision` table, no dispute state machine, no correction event, and no
operator re-attribution route — the sole way to change a settled ledger row today is
a manual `--commit` run of a backfill script that overwrites `cost_isk_minor` in
place and clobbers the attribution columns. What the docs describe as "corrections"
and "billing subject follows" is, in source, an unaudited in-place UPDATE.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-SESSIONS-01 | `apps/api/src/lib/ocpp/projections.ts` | `onSessionStarted` :151; `onSessionStopped` :325; `onOcppRawStopTransaction` :887; sessionLedger.upsert :423 :980 | E04,E06,E07,M02 | 91,92,95 | `projections.test.ts` | High | High | Should attribution move to start-time, or stay a stop-time re-resolve? |
| SI-SESSIONS-02 | `apps/api/src/repositories/session-ledger.ts` | `listSessionLedger` :73; `totalSessionLedger` :210; `LedgerScope` tagged union :22-33 | E14,M07 | 95,96 | `session-ledger.test.ts` | High | High | Where does the installation-as-billing-subject scope live once E14 lands? |
| SI-SESSIONS-03 | `apps/api/src/repositories/driver-sessions.ts` | `getDriverActiveSessions` :109; `resolveStoppableSession` :149; `listDriverSessionHistory` :203; `minorToIsk` :95 | E14,M07 | 95,96 | `driver-sessions.test.ts` | High | High | Is `costIsk` meant to be aurar or krónur on the wire? |
| SI-SESSIONS-04 | `apps/api/src/routes/public/driver.ts` | `GET /api/driver/sessions/current` :696; `/sessions/history` :713; `/invoices` :740; `GET /api/driver/sessions/:id` :759 | E14,M07 | 95,96 | — | High | High | Three history surfaces, three different source tables — which is canonical? |
| SI-SESSIONS-05 | `apps/api/src/routes/admin/billing.ts` | `scopeFromQuery` :58; `GET /api/admin/billing/sessions` :113; `/sessions/:id` :86; `/sessions/:id/full` :101 | M06,M07 | 95,96 | — | High | High | Who owns closing the unvalidated scope params before pilot? |
| SI-SESSIONS-06 | `apps/api/src/repositories/session-detail.ts` | `getSessionDetail` :49; ledger-cost preference :156-159; `projectEnergyDetails` :191; `formatIsk` :241 | M05 | 98 | — | Medium | High | Ledger cost wins over session cost — intended after a CDR overlay? |
| SI-SESSIONS-07 | `apps/api/src/repositories/session-full-detail.ts` | `getSessionFullDetail` :146; `buildVehicleIdentity` :519; `identityTypeLabel` :444; samples join :249-262 | E12,F09,M05 | 98 | — | Medium | High | Is this the evidence bundle for M05, or does M05 need a signed export? |
| SI-SESSIONS-08 | `apps/api/src/repositories/vehicle-id-sessions.ts` | `listVehicleIdSessions` :48; filter on ev_plc_mac OR auth_id_value OR pnc_attempted :85-91 | E12,F09 | 98 | — | Low | High | — |
| SI-SESSIONS-09 | `apps/api/src/routes/admin/active-sessions.ts` | `adminActiveSessions` `GET /api/admin/active-sessions` :21-49; `resolveOrgScope` guard :23 :48 | M06 | 95 | — | Low | High | Live sessions carry `user_id` but it is not selected — deliberate? |
| SI-SESSIONS-10 | `apps/api/src/repositories/driver-invoices.ts` | `listDriverActualSessions` :30; ledger-cost override map :60-64; `whToKwh` :28 | E14,M07 | 95,96 | — | High | High | Rounds kWh to 1 dp while the ledger keeps 3 — invoice-safe? |
| SI-SESSIONS-11 | `packages/shared/src/db/charging.ts` | `sessions` :28-91; `liveSessions` :191-217; `protocolTransactionRefs` :132-147; `tapIntents` :169-188 | E05,E06 | 91,95 | `test/parity/domain-schemas.test.ts` | High | High | Adding a CHECK for null-subject needs a real subject column first — where? |
| SI-SESSIONS-12 | `apps/api/src/repositories/zaptec-session-sync.ts` | `importOne` :134; CDR-to-OCPP row match :256-271; `computeEnrichmentStatus` :287; sessionLedger.upsert :446-471 | M02,M03 | 91,93 | `zaptec-session-sync.test.ts` | High | High | On mismatch the ledger keeps the OCPP cost — is that the intended freeze? |
| SI-SESSIONS-13 | `apps/api/src/routes/webhooks/zaptec.ts` | `POST /api/webhooks/zaptec/auth` :104; `/session-start` :156; `/session-end` :246; ledger upsert :380 | E03,E13,F03 | 95 | `webhooks/zaptec.test.ts` | High | High | Only writer family that sets `sessions.user_id` — is that intended? |
| SI-SESSIONS-14 | `apps/api/scripts/backfill-session-costs.ts` | ledger upsert with full-row `update` :176-199; `driverIdTag: ocppIdentity.identityString` :185 | M02,M03,M08 | 91,92,97 | — | High | High | Is this script still run, and by whom? |

**Area findings**

1. **The OCPP writers never set `charging.sessions.user_id`.** `onSessionStarted`
   (`apps/api/src/lib/ocpp/projections.ts:185-199`) and `onOcppRawStartTransaction`
   (`:859-872`) both omit `userId` from the create; the only place a driver is
   resolved on the OCPP path is at stop time, into the ledger's `driver_user_id`
   (`:406-416`, `:971-978`). The only writers that set `sessions.user_id` are the
   Zaptec webhook (`routes/webhooks/zaptec.ts:211`, `:335`) and the CDR sync
   (`repositories/zaptec-session-sync.ts:329`, `:347`). Consequence:
   `GET /api/driver/sessions/current` and `GET /api/driver/invoices` — both of which
   filter `sessions.user_id` (`driver-sessions.ts:114`, `driver-invoices.ts:53`) —
   return nothing for a purely OCPP-originated session, while
   `GET /api/driver/sessions/history` (ledger-scoped) returns it. The gap the packet
   assumes ("attribution exists but is unrecorded") is really a split-brain: two
   attribution columns in two tables, populated by disjoint code paths.

2. **Tap-and-auth attribution is computed and then thrown away.**
   `resolveAuthorize` (`apps/api/src/routes/internal/ocpp-authorize.ts:173-212`)
   matches a random-UID phone tap to a tap intent and returns `userId`. The gateway
   consumes it only as a log field (`gateway/src/identity-do.ts:680`, inside
   `console.log("[ocpp-gw] authorize.evaluated", …)`). Nothing persists it. Because a
   random emulated UID can never match an `IdToken.value`, the stop-time re-resolve
   at `projections.ts:408-415` returns null — so every tap-and-auth session lands in
   the ledger with `driver_user_id = NULL` and `driver_id_tag` = a UID that will
   never be seen again. E11 ("tap-intent correlation window") is implemented at the
   authorize boundary and unimplemented everywhere downstream.

3. **`session_attribution` and `authorization_decision` do not exist.** Greps for
   `session_attribution` / `sessionAttribution` and `authorization_decision` /
   `authorizationDecision` across `apps`, `packages`, `prisma` and `src` return zero
   hits. Neither does a dispute state machine: the word "dispute" appears in exactly
   three files, all as prose comments (`projections.ts:320-323`,
   `repositories/tap-intents.ts`, `packages/contracts/src/vendor/adapter.ts`).
   E06, E07, E10, M01 and M06 are greenfield, not modifications.

4. **The only correction path in the repo overwrites the ledger and corrupts
   attribution.** `apps/api/scripts/backfill-session-costs.ts:176-199` builds one
   `data` object and passes it as *both* `create` and `update` to
   `sessionLedger.upsert`, so a `--commit` run rewrites `cost_isk_minor` in place with
   no correction record — the direct opposite of M02 / scenarios 91-92. Worse, that
   same object sets `driverUserId: s.userId` (NULL for every OCPP-origin session, per
   finding 1) and `driverIdTag: s.ocppIdentity?.identityString` (`:185`) — the
   *charger's* OCPP identity string, not a driver token. Running it against
   OCPP-attributed rows silently nulls the driver and writes the charger id into the
   driver column.

5. **A CDR that disagrees with OCPP updates the session but freezes the ledger.**
   `zaptec-session-sync.ts:306-332` overwrites `sessions.energy_wh`, `stop_reason`,
   `cost_ex_vat_minor` and `cost_inc_vat_minor` on the matched OCPP row with the
   CDR-derived figures, but the paired `sessionLedger.upsert` update block
   (`:467-470`) sets **only** `verifiedSource` and `enrichmentStatus` — never
   `costIskMinor`, `energyKwh` or `durationSec`. So after a mismatch the session row
   and the ledger row carry two different costs for the same session, and
   `getSessionDetail` / `getSessionFullDetail` both prefer the stale ledger value
   (`session-detail.ts:156-159`, `session-full-detail.ts:318-321`). Re-running the
   sync cannot fix it: `importOne` short-circuits on `already_imported`
   (`zaptec-session-sync.ts:138-145`).

6. **`GET /api/admin/billing/sessions` takes its tenant scope straight from query
   params with no ownership check.** `scopeFromQuery`
   (`apps/api/src/routes/admin/billing.ts:58-67`) turns `?driverUserId=`,
   `?chargingStationId=`, `?siteId=` or `?orgId=` into a `LedgerScope` verbatim; the
   only gates are `requireAdmin` and `requirePermission("billing.read")`, neither of
   which is resource-scoped (`lib/auth/require-permission.ts` resolves an org only via
   an `orgIdParam` *path* param, and bootstrap sessions get an unconditional pass at
   `:187-191`). The repository explicitly documents that it trusts the caller
   (`session-ledger.ts:16-18`), and the route's own comment admits the check is
   deferred (`billing.ts:51-56`). Contrast `active-sessions.ts:23,:48`, which *does*
   call `resolveOrgScope` and filter. Any billing.read holder can read another
   tenant's ledger, and scenario 96 ("no person named anywhere") cannot hold while
   `?driverUserId=` is a free parameter returning `driverIdTag`.

7. **The driver app displays cost 100x too high.** `cost_isk_minor` is aurar —
   1/100 króna, stated at `lib/tariff/compute-session-cost.ts:12-16` and implemented
   by `formatIskMinor` (`:211-219`, divides by 100). `driver-sessions.ts:95-98`
   `minorToIsk` returns `Number(minor)` undivided under the comment "ISK has no minor
   unit, so minor === major", and the Flutter client renders it as
   `'${s.costIsk!.toStringAsFixed(0)} kr'`
   (`apps/mobile/lib/screens/active_session.dart:208-209`). The behaviour is locked in
   by an assertion — `driver-sessions.test.ts:246` expects `costIsk: 64988` for a row
   whose true value is 649.88 kr. `driver-invoices.ts:21` documents the unit correctly
   but still returns the raw aurar under the same `costIsk` key.

8. **Cost is computed by whichever writer arrives first, and both use the same
   resolver.** `resolveTariffChainWithIdsForSession` + `computeSessionCost` are called
   identically at `projections.ts:377-399`, `projections.ts:954-969`,
   `webhooks/zaptec.ts:370-377` and `zaptec-session-sync.ts:228-235`, and all four
   persist only `resolved.dsoTariffDefinitionId` — the retailer half of the chain is
   deliberately not stored (`projections.ts:437-443`). An evidence bundle for
   scenario 98 therefore cannot reconstruct the retailer component from the ledger
   alone.

9. **Test coverage is thin exactly where correction will land.** Adjacent tests exist
   for `driver-sessions.test.ts`, `session-ledger.test.ts`, `zaptec-session-sync.test.ts`,
   `projections.test.ts` and `routes/webhooks/zaptec.test.ts`. There is **no** test file
   beside `session-detail.ts`, `session-full-detail.ts`, `vehicle-id-sessions.ts`,
   `driver-invoices.ts`, `routes/admin/billing.ts`, `routes/admin/active-sessions.ts`
   or `routes/public/driver.ts` — the entire read side that a dispute UI would consume
   is untested (`apps/api/src/routes/admin/` contains only `charging-stations.test.ts`).
## A07 — Agreements, cost factors, tariff resolution, pricing preview, billing write gap

Two independent pricing engines exist side by side and only one of them touches money. The legacy engine — `lib/tariff/resolve-tariff-chain.ts` walking Site→DSO tariff and Installation→retailer tariff, then `lib/tariff/compute-session-cost.ts` doing BigInt-minor math — is invoked inside the OCPP `session.stopped` projection and writes `reports.session_ledger.cost_isk_minor` for every session. The ADR 0019 agreements engine (`packages/commercial/src/agreement/resolve.ts`, reached through byte-for-byte re-export shims at `apps/api/src/lib/agreement/{resolve,types}.ts`) is fully implemented, heavily unit-tested, and has priced zero sessions: its cron feeder `runAgreementsBillingTick` selects only sessions ended within 30 days that carry a `userId`, and the source itself records that the newest attributable session ended 2026-05-13, so the predicate matches nothing. Read surfaces are complete — list, detail, `debug-resolve` preview, driver-facing indicative pricing — but there is **no agreement write surface at all**: no `prisma.agreement.create/update`, no clause or bearer-rule mutation anywhere under `apps/api/src`. Cost factors and rate references, by contrast, do have full CRUD. So Group K is a genuine greenfield gap, Group L is roughly half-built (catalogue CRUD exists; scope assignment does not), and the docs' claim that agreements resolution is "canonical" is contradicted by a comment in the repo's own source.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-AGREEMENTS-01 | `packages/commercial/src/agreement/resolve.ts` | `resolveBillingLines` :34; `resolveFactor` :45; `buildLadder` :78; `pickActiveRate` :123; `computeBillingLines` :141 | K08,L04,L05 | 144,145 | `packages/commercial/src/agreement/resolve.test.ts`; `apps/api/src/lib/agreement/resolve.test.ts` | High | High | Two forked copies of resolve.test.ts both run — which is authoritative |
| SI-AGREEMENTS-02 | `packages/commercial/src/agreement/types.ts` | `RATE_BASES` :39; `allocationSchema` :91; `SessionContext` :148; `BillingLineDraft` :192; lowercase bearer preprocess :69 | L01,K12 | 145,146 | `packages/commercial/src/agreement/types.test.ts`; `apps/api/src/lib/agreement/types.test.ts` | High | High | `RuleScope` has no org or driver-group tier — does L01 need one |
| SI-AGREEMENTS-03 | `apps/api/src/lib/agreement/persist.ts` | `loadAgreementContext` :86; `resolveAndPersistForSession` :335; determinism orderBy :155-165; wrk to org coercion :399-406 | K08,L04,M03 | 144,145,147 | `apps/api/src/lib/agreement/persist.test.ts` | High | High | `agreementId` falls back to empty string :293 when only workplace agreements match |
| SI-AGREEMENTS-04 | `apps/api/src/lib/agreement/billing-tick.ts` | `runAgreementsBillingTick` :88; `RECENT_WINDOW_DAYS = 30` :59; eligibility where :96-109 | M03,K14 | 147,148 | none | Medium | High | Widening `sinceDays` would emit lines for sessions already priced by legacy — is that a double charge |
| SI-AGREEMENTS-05 | `apps/api/src/routes/admin/agreements-debug.ts` | `GET /api/admin/agreements` :35; `GET /:id` :42; `POST /debug-resolve` :89; `GET /debug-options` :173 | K08,L05,K09 | 144,145 | none | Low | High | K08 says preview reuses debug-resolve — does it need a non-admin caller |
| SI-AGREEMENTS-06 | `apps/api/src/routes/admin/agreements-resolve.ts` | `POST /api/admin/agreements/sessions/:sessionId/resolve` :27; `requirePermission("billing.write")` | M03,M02 | 147,148 | none | Medium | High | Re-resolve is a no-op when lines exist — where does scenario 148's correction record come from |
| SI-AGREEMENTS-07 | `apps/api/src/repositories/agreements.ts` | `listAgreements` :155; `getAgreementDetail` :188; `listAgreementMembershipsForUser` :110; `PILOT_TYPES` :11 | K09,K01,K02 | 137,138 | none | Low | High | Repo is read-only and has no org scoping — K09 wants tenant-scoped CRUD |
| SI-AGREEMENTS-08 | `apps/api/src/routes/admin/billing-cost-factors.ts` | `costFactorsRouter` :31; `GET /` :40; `POST /` :50; `PATCH /:id` :97; `POST /:id/deactivate` :163; `POST /:id/reactivate` :188 | L06,L02,L07 | 145,146 | none | Medium | High | All gated on `billing.write`, never `tariff.write` or `contract.write` |
| SI-AGREEMENTS-09 | `apps/api/src/repositories/billing-cost-factors.ts` | `listCostFactors` :63; `createCostFactor` :165; `updateCostFactor` :199; `deactivateCostFactor` :252; `reactivateCostFactor` :293 | L06,L02,L03 | 145 | none | Medium | High | Catalogue is `billing.cost_factors`; the resolver reads `agreements.cost_factors` — two tables |
| SI-AGREEMENTS-10 | `apps/api/src/lib/billing/cost-factor-zod.ts` | `createCostFactorSchema` :67; `updateCostFactorSchema` :94; `COST_FACTOR_CODE_PATTERN` from `pilot-scope.ts` | L02,L10 | 140 | none | Low | High | No effective-dating fields at all — L10 has no schema to hang dates on |
| SI-AGREEMENTS-11 | `apps/api/src/lib/tariff/resolve-tariff-chain.ts` | `resolveTariffChainWithIdsForSession` :185; `resolveTariffChainForSession` :167; `parseComputeRule` :82; `TariffResolutionError` :58 | L04,L05 | 144,147 | `apps/api/src/lib/tariff/resolve-tariff-chain.test.ts` | High | High | Only `computeRule.kind = "flat"` is supported — everything else throws |
| SI-AGREEMENTS-12 | `apps/api/src/lib/tariff/compute-session-cost.ts` | `computeSessionCost` :112; `formatIskMinor` :211; `TariffChain` :60; `CostBreakdown` :89 | L05,M02 | 144,147 | `apps/api/src/lib/tariff/compute-session-cost.test.ts` | High | High | This is the price of record today; scenario 144 asks preview to match the other engine |
| SI-AGREEMENTS-13 | `apps/api/src/repositories/driver-pricing.ts` | `listDriverInstallations` :256; `getDriverChargerPricing` :441; `findActiveRateRef` :132; routes at `driver.ts` :816 and :830 | L12,K08,L05 | 144,145 | `apps/api/src/repositories/driver-pricing.test.ts` | Low | High | Preview walks clause defaults only — BearerRule overrides never applied |
| SI-AGREEMENTS-14 | `packages/shared/src/db/commercial.ts` | `agreements` :293; `agreementClauses` :319; `bearerRules` :433; `agreementsBillingLines` :459; `rateReferences` :270; `rateBasisEnum` :46 | K05,K06,L10 | 139,140 | `apps/api/test/parity/domain-schemas.test.ts`; `apps/api/test/parity/commercial-harvest-parity.test.ts` | Medium | High | No range type or exclusion constraint declared — K05 has nothing to build on |

**Area findings**

1. **There is no agreement write path anywhere in the API.** A grep across `apps/api/src` for `.agreement.create|update|delete|upsert`, `agreementClause.*`, and `bearerRule.*` returns zero hits. The only write in the whole repo is the one-off script `apps/api/scripts/supersede-orphan-b6771541.ts`. Group K (K01–K04, K09, K12) is greenfield, not a hardening exercise. `apps/api/src/repositories/agreements.ts` is read-only by design and its header says so at line 1.

2. **The agreements resolver has priced zero sessions, and the reason in the source is not the reason ADR 0025 gives.** `apps/api/src/lib/agreement/billing-tick.ts:62-87` documents a staging count: 1,619 completed sessions, 8 with a `userId`, 8 with energy and end time, **0** inside `RECENT_WINDOW_DAYS`. The header at :8-31 states plainly that ADR 0025's per-installation `useAgreementsResolver` flag "does not exist in code" and that what actually runs is both resolvers ungated, without ADR 0025 §Step 2's mandatory comparison gate. Do not plan around that flag.

3. **`contract.write` and `tariff.write` exist in the permission catalogue but guard nothing.** They are declared at `apps/api/src/lib/auth/permissions.ts:69` and `:72` and bundled into ADMIN (`:152-153`) and FINANCE (`:175`), yet `requirePermission("contract.write")` and `requirePermission("tariff.write")` appear in zero route files. Every billing mutation — cost factors, rate references, session re-resolve — is gated on `billing.write`. K11's "verbs live" acceptance is half-true: the verbs exist, the enforcement does not.

4. **`per_connector` is in the Prisma schema and the Drizzle declarations but has no migration.** `prisma/schema/commercial.prisma:406` declares it, `packages/shared/src/db/commercial.ts:46` declares it, but grepping `prisma/migrations/` for `per_connector` returns nothing (latest migration is `20260807120000_drop_never_used_tables`). The comment at `packages/commercial/src/agreement/types.ts:34-37` says the Postgres enum "does NOT yet carry this value" — that is still true, and the schema files are now ahead of the database. Anyone running `prisma migrate` against staging will generate an `ALTER TYPE`.

5. **Scenario 139's exclusion constraint does not exist.** `prisma/schema/commercial.prisma:483-513` gives `Agreement` four plain `@@index` declarations and no unique or range constraint on `(installationId, effectiveFrom, effectiveUntil)`. Grepping all of `prisma/migrations/` for `EXCLUDE`, `btree_gist`, or `tstzrange` returns nothing. The overlap case is instead handled at read time by a `console.warn` plus a deterministic `orderBy` in `apps/api/src/lib/agreement/persist.ts:143-165` — the resolver picks the newest and logs the conflict. K05 must add both the extension and the constraint.

6. **The pricing preview and the actual price come from different engines, and the source admits it.** `apps/api/src/repositories/driver-pricing.ts:25-34` states that "canonical is aspirational, not current", that `agreement/resolve.ts` has priced 0 sessions, and that the legacy tariff path is what prices every session — with no comparison enforcing agreement between the two. The infrastructure to compare exists but is operator-run only: `apps/api/src/lib/billing-shadow/shadow-compare.ts` (`shadowCompare` :85, `tallyResult` :156) plus the script `apps/api/scripts/shadow-compare-resolvers.ts`. K08's "no second pricing impl" acceptance currently has three implementations, not one: the tariff chain, the agreements resolver, and the driver-pricing headline summariser (`summarisePerKwhForList` :175, `summariseForCharger` :208).

7. **The rate book already has the staged-version write surface that agreements lack.** `apps/api/src/routes/admin/billing-rate-references.ts` exposes `POST /` :97, `PATCH /:id` :152 and `POST /:id/retire` :206, and its header (:6-12) records the invariant that price-resolution fields on an active row are immutable, with "stage new version" auto-closing the prior row's `effectiveUntil` in one transaction. That is exactly the K02/K04/K13 shape, already built and working, for a sibling table — copy it rather than invent it.

8. **The `wrk` bearer is a resolver-only fiction that gets flattened on write.** `packages/commercial/src/agreement/types.ts:12` includes `wrk` in `BEARER_CODES`, but the Postgres enum is `["org","usr","trd"]` (`packages/shared/src/db/commercial.ts:43`). `apps/api/src/lib/agreement/persist.ts:399-406` translates `wrk` to `bearerType: "org"` with `bearerRef` set to the driver group's `ownerOrgId` at the storage boundary. Any query over `agreements.billing_lines` cannot distinguish a workplace-borne line from a CPO-borne one except by inspecting `bearer_ref`.

9. **`apps/api/src/lib/agreement/{resolve,types}.ts` are pure re-export shims, not implementations** (`resolve.ts:14-15`, `types.ts:14-15`), pointing at `@straumvakt/commercial/agreement/*`. The duplicated test files have already forked: `packages/commercial/src/agreement/resolve.test.ts` carries a `describe("per_connector basis")` block (added 2026-08-08) that `apps/api/src/lib/agreement/resolve.test.ts` lacks, and both run under the root `vitest.config.ts` include list (`packages/**/*.test.ts` was added specifically so the harvested tests would not silently stop running). The parity suite under `apps/api/test/parity/` matches none of those globs and only runs via `npm run test:parity --workspace apps/api` with `vitest.parity.config.ts`.

10. **Cost factors live in two unrelated tables and Group L straddles both.** `billing.cost_factors` (`billingCostFactors` :89, anchored by `CostFactorAnchor`, referenced by `TariffDefinition`) is what `billing-cost-factors.ts` CRUDs and what L06 names. `agreements.cost_factors` (`agreementsCostFactors` :255, referenced by `RateReference` and `AgreementClause`) is what the agreements resolver actually walks, and its only write surface is the read-only select-options endpoint at `billing-rate-references.ts:43`. L02 "assign cost factor to scope" has no write surface on either table.
## A08 — Organisation onboarding aggregate, charger onboarding, installations, org hierarchy

There is no onboarding *aggregate* in this codebase. What exists is a one-shot
"chain" endpoint — `POST /api/admin/onboarding/chains` — that creates
Organization → Property → Site → SiteAsset → ChargingStation → EVSE → Connector
→ OcppIdentity inside a single 60s Prisma transaction and returns a generated
OCPP password in plaintext exactly once. There is no `onboarding_workflow`,
`onboarding_step` or `onboarding_substep` table anywhere in the repo, no
`GET/POST/PATCH /api/admin/orgs/:orgId/onboarding` route, no status machine
(`draft/ready/active/suspended/cancelled`), no version/If-Match, and no
idempotency key — so every scenario 99–112 is greenfield, not a hardening job.
Org hierarchy is plain CRUD (`orgs`, `properties`, `sites`, `installations`)
behind `requireAdmin` + `requirePermission`, plus one genuinely heavy operation,
`moveSiteToOrg`, which re-parents ~14 tables atomically. Charger onboarding is
further along than the docs imply: vendor-attach conflict/idempotency (H05) is
implemented *and* unit-tested, and OCPP password rotate/set/disable (H03) already
writes an audit row with the actor. Installation `onboardingStatus` is an enum
column on `assets.installations` and is surfaced in the site tree, but nothing
drives it through a lifecycle.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-ONBOARDING-01 | `apps/api/src/routes/admin/onboarding.ts` | `adminOnboarding` :9; `POST /api/admin/onboarding/chains` :13 gated `charger.write` | G06,G07 | 99-101,113 | none exist | High | High | Is `/chains` kept as the "create everything" fast path once G06-G08 land, or replaced? |
| SI-ONBOARDING-02 | `apps/api/src/repositories/onboarding-chains.ts` | `createOnboardingChain` :51-199; `OnboardingChainResult` :13; pendingDiscovery deleteMany :166 | G01,G03,G07 | 99,101,113,116 | none exist | High | High | Chain creates no Installation row — should G07 require one? |
| SI-ONBOARDING-03 | `packages/contracts/src/inputs/onboarding-chains.ts` | `OnboardingChainInput` :31-85; `IDENTITY_RE` :5; re-export shim at packages/shared | G07,G10 | 99,103,104,113 | none exist | Medium | High | Shim in packages/shared re-exports this; which home wins for new fields? |
| SI-ONBOARDING-04 | `apps/api/src/routes/admin/orgs.ts` | `adminOrgs` :41; `GET|POST /` :54,:68; `GET|PATCH /:orgId` :83,:95; `POST /:orgId/archive` :109 | G06,G09,G11,G12 | 105-112 | none exist | High | High | `/archive` writes status directly with no audit — is that the cancel path G11 wants? |
| SI-ONBOARDING-05 | `apps/api/src/repositories/orgs.ts` | `listOrgs` :110; `getOrgById` :122; `createOrg` :133; `updateOrg` :165; toSummary :80 | G01,G11,G12 | 99,105,106,108 | none exist | Medium | High | `status` has no enum guard in the repo — where is the allowed set defined? |
| SI-ONBOARDING-06 | `apps/api/src/routes/admin/installations.ts` | `adminInstallations` :24; `POST /:id/ocpp-password/rotate` :129; `PATCH /:id/ocpp-password` :144; `POST /:id/ocpp-password/disable` :183 | H03,H04 | 115,116 | `installation-ocpp.test.ts` | High | High | H04 says password must never be in a body, but rotate returns it by design — which wins? |
| SI-ONBOARDING-07 | `apps/api/src/repositories/installation-ocpp.ts` | `rotateInstallationOcppPassword` :110; `setInstallationOcppPassword` :151; `disableInstallationOcppAuth` :198; `getInstallationOcppSummary` :260 | H03,H04 | 115,116 | `installation-ocpp.test.ts` | High | High | Bootstrap admin passes `actorUserId = null`; does H03 accept a null actor? |
| SI-ONBOARDING-08 | `apps/api/src/repositories/installations.ts` | `listAllInstallations` :60; `createInstallation` :116; `updateInstallation` :135; `deleteInstallation` :154 hard cascade | H07 | 113,117 | none exist | High | High | `deleteInstallation` hard-deletes chargers under it — does H07 soft-delete cover this path too? |
| SI-ONBOARDING-09 | `apps/api/src/routes/admin/chargers.ts` | `POST /` :63; `DELETE /:id` :281; `POST /:id/attach-vendor` :298; `GET /commands/:commandId` :525 | H03,H05,H07 | 113,114,116-118 | `routes/admin/charging-stations.test.ts` | High | High | `POST /` passes `actorUserId = null` while a session exists — deliberate or oversight? |
| SI-ONBOARDING-10 | `apps/api/src/repositories/chargers.ts` | `createCharger` :507; `updateCharger` :649; `deleteCharger` :752; `attachVendorToOcppIdentity` :800; `AttachVendorError` :775 | H05,H07 | 113,114,117 | `test/parity/chargers-repository.test.ts` | High | High | Soft delete needs a column — is `decommissioned` (derived from Zaptec) the right anchor? |
| SI-ONBOARDING-11 | `apps/api/src/repositories/site-tree.ts` | `listSiteTree` :360-752; installation/circuit/station loads :390-455; assembly :660-750 | H01,H02 | 113,119 | none exist | Medium | High | Adding an availability status means a new field on every tree node — who owns that contract? |
| SI-ONBOARDING-12 | `apps/api/src/repositories/sites.ts` | `deleteSite` :146; `moveSiteToOrg` :209; `MoveSiteResult` :159; audit :476 | G11,G12 | 108,113 | none exist | High | High | Move clears installation credentials and site tariffs — is that acceptable during an active workflow? |
| SI-ONBOARDING-13 | `apps/api/src/repositories/pending-discoveries.ts` | `listPendingDiscoveries` :20; `clearIdlePendingDiscoveries` :70; `upsertPendingDiscovery` :90 lowercases key :98 | — | 113 | none exist | Medium | High | Should provisioning match pending rows case-insensitively (see finding 3)? |
| SI-ONBOARDING-14 | `apps/api/src/routes/admin/host-applications.ts` | `adminHostApplications` :23; `GET /` :32; `GET /:id` :50; `PATCH /:id` :68 status only | — | 99 | `test/parity/host-applications.test.ts` | Medium | High | `converted_org_id` exists but nothing writes it — does the aggregate own the conversion? |

**Area findings**

1. **The organisation onboarding aggregate does not exist at all.** A repo-wide
   grep for `onboarding_workflow`, `onboarding_step`, `onboarding_substep` and
   `onboardingWorkflow` across `*.prisma`, `*.ts` and `*.sql` returns zero hits
   outside `docs/`. `apps/api/src/routes/admin/orgs.ts` (411 lines, read in full)
   registers no `/onboarding` sub-route, so the three endpoints 18D names at
   `docs/domain/onboarding/18D-endpoints-and-tests.md:103-105`
   (`GET|POST /api/admin/orgs/:orgId/onboarding`, `PATCH …/steps/:stepKey`) are
   all absent. G01-G12 and scenarios 99-112 are greenfield.

2. **`POST /api/admin/onboarding/chains` creates no Installation.**
   `createOnboardingChain` (`apps/api/src/repositories/onboarding-chains.ts:51-199`)
   inserts Org, Property, Site, SiteAsset, ChargingStation, EVSE, Connector and
   OcppIdentity — but `tx.chargingStation.create` at :117-127 sets no
   `installationId`, and `OnboardingChainInput` has no installation field
   (`packages/contracts/src/inputs/onboarding-chains.ts:31-85`). Every charger
   born from the chain is an "orphan charger" in the site tree
   (`site-tree.ts:721-725`) and cannot use the per-installation OCPP password
   surface at all.

3. **Provisioning does not reliably clear the pending-discovery row — a case
   bug.** `upsertPendingDiscovery` lowercases the key before write
   (`apps/api/src/repositories/pending-discoveries.ts:98`), but both provisioning
   paths delete on the raw operator-supplied string:
   `onboarding-chains.ts:166-168` (`where: { identityString: input.identityString }`)
   and `chargers.ts:579-581` (`eq(pendingDiscoveries.identityString, input.identityString)`).
   `IDENTITY_RE` at `packages/contracts/src/inputs/onboarding-chains.ts:5` permits
   `A-Z`, so provisioning `ZPR074002` leaves the `zpr074002` pending row behind
   and the charger stays in the pending pool after successful onboarding.

4. **H05 (vendor-attach idempotency) is already done, including tests.**
   `attachVendorToOcppIdentity` (`apps/api/src/repositories/chargers.ts:800-940`)
   treats identical values as an idempotent update and throws
   `conflict_vendor_resource_id` / `conflict_credentials_ref` on divergence; the
   route maps both to 409 (`routes/admin/chargers.ts:349-351`) and
   `apps/api/src/routes/admin/charging-stations.test.ts` exercises every error
   code. Scenario 114 is a verification task, not an implementation task.

5. **H04 ("OCPP password never in response body") contradicts the implemented
   design, three times.** `POST /api/admin/onboarding/chains` returns
   `ocppPassword` (`onboarding-chains.ts:198`, surfaced at `onboarding.ts:21-28`),
   `POST /api/admin/chargers` returns it (`chargers.ts:605-646` → route :69-76),
   and `POST /api/admin/installations/:id/ocpp-password/rotate` returns
   `plaintext` (`installation-ocpp.ts:135` → route :129-142). All three carry
   explicit comments saying the one-shot return is intentional. H04 needs a
   decision, not a patch.

6. **Charger delete is a hard cascade with no audit row.** `deleteCharger`
   (`apps/api/src/repositories/chargers.ts:752-754`) is a single
   `db.delete(siteAssets)` relying on FK cascade, and — unlike `createCharger`
   (:591-603) and `updateCharger` (:694-702) — writes no `recordAuditAction`.
   `deleteInstallation` (`installations.ts:154-170`) and `deleteSite`
   (`sites.ts:146-157`) are likewise unaudited hard cascades. H07 / scenario 117
   therefore has to add both the soft-delete column and the audit call.

7. **Actor attribution is dropped on the charger and chain write paths.**
   `routes/admin/chargers.ts:68` calls `createCharger(db, parsed.data, null)`,
   :272 calls `updateCharger(…, null)`, and `routes/admin/onboarding.ts:20` calls
   `createOnboardingChain(db, parsed.data, null)` — all three have a live session
   in `c.get("session")` and simply do not pass it. The installation OCPP routes
   do it correctly (`installations.ts:137`, `:163`, `:191` pass
   `c.var.session.userId ?? null`), so the fix is mechanical.

8. **`apps/api/src/routes/admin/org-email-domains.ts` is defined but never
   mounted.** `apps/api/src/index.ts` imports and routes `adminOrgs`,
   `adminProperties`, `adminSites`, `adminInstallations`, `adminChargers`,
   `adminOnboarding`, `adminPendingDiscoveries` and `adminHostApplications`
   (:128-200) but never `adminOrgEmailDomains`; a repo-wide grep finds the symbol
   only in its own file, in `apps/api/test/parity/org-email-domains.test.ts`
   (which mounts it directly at :52-68), in archived UI under
   `archive/straumvakt-org-console-2026-08-08/`, and in docs. The endpoint is
   fully implemented, fully tested against the real DB, and unreachable in
   production.

9. **Tenant scoping on charger/chain creation comes from the permission tier, not
   from the body.** `requirePermission("charger.write")` with no `orgIdParam`
   resolves with `orgId = null` (`lib/auth/require-permission.ts:69-74`), and
   `resolveEffectivePermissions` then skips the membership lookup entirely
   (`lib/auth/effective-permissions.ts:159-169`). So only platform grants (or the
   bootstrap god-mode session, :55-59) can create chargers, and nothing validates
   that `input.orgId` / `input.siteId` are consistent or belong to the caller.
   Scenario 113 needs an explicit org/site consistency check.

10. **`host_applications.converted_org_id` is a dead column.**
    `updateHostApplicationStatus` sets only `status`
    (`apps/api/src/repositories/host-applications.ts:164-177`), and a repo-wide
    grep shows `convertedOrgId` is read in `toSummary` (:78) and declared in the
    schemas (`prisma/schema/identity.prisma:588`,
    `packages/shared/src/db/identity.ts:306`) but written nowhere. The "won
    application → host org" conversion the file header attributes to ADR 0027
    does not exist.

11. **There is no live UI for any of this.** The Next app under `src/app` contains
    only `home`, `org/[slug]`, `staff/overview` and the root page; the entire
    admin console — including the `/onboard` form that was the sole caller of
    `POST /api/admin/onboarding/chains` — lives under
    `archive/straumvakt-org-console-2026-08-08/app/(app)/onboard/onboard-form.tsx:181`.
    Scenarios flagged `[L]` (111, 112, 120) have no surface to land on today.

12. **Test coverage in this area is close to zero.** `OnboardingChainInput` and
    `createOnboardingChain` have no test file at all (grep for
    `OnboardingChainInput` outside `docs/` returns only the four source files).
    The only tests touching this area are `installation-ocpp.test.ts`,
    `routes/admin/charging-stations.test.ts` (attach-vendor only),
    `test/parity/chargers-repository.test.ts` (read-side only:
    `listAllChargers`, `getChargerById`, `listSiteCircuits`),
    `test/parity/host-applications.test.ts` and
    `test/parity/org-email-domains.test.ts`.
## A09 — Next.js web app: middleware, admin/org UI route handlers, API clients, session verify

The web app on this branch is very small — eight page files and one middleware. It contains **no app-router API routes at all** (`src/app/api/` does not exist); every request goes out to the `apps/api` Hono Worker through `apiFetch` (browser) or `apiFetchServer` (RSC), both of which resolve the API host from a hard-coded UI-host→API-host map plus `NEXT_PUBLIC_API_BASE_URL`. There are exactly three doors: `/` (org login), `/staff` → `/staff/overview` (platform staff), and `/org/[slug]` (+`/profile`) driven by the tenant registry in `src/lib/org-tenant.ts`; `/home` is a persona fork that redirects host_admins into `/org/<slug>`. The single largest doc-vs-reality gap: `docs/relaunch-middleware-reconciliation.md` and three source comments still say middleware never executes, but commit `14c1ce2` ("move middleware.ts into src/ so it actually runs") already relocated it — `src/middleware.ts` is live and gates every extensionless path, while the `/org/[slug]` rule that the reconciliation doc says must be added **before** the relocation was never written. Of the Group O acceptance criteria, none are implemented in the web app: there is no demo-mode flag, no disabled-state copy library, no `*.test.ts` under `src/` at all, and `LanguageProvider` hard-forces English so every Icelandic string in the tenant registry is dead.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-WEB-01 | `src/middleware.ts` | `middleware` :79-137; `staffRouteResponse` :58-77; `PUBLIC_PATHS` :12; `ADMIN_HEADER` :16; matcher :139-141 | — | 156 | none | High | High | `/org/[slug]` still has no explicit rule — it silently inherits the catch-all redirect to `/`. Was that decided or inherited? |
| SI-WEB-02 | `src/lib/admin-session.ts` | `verifyAdminSession` :96-122; `createAdminSession` :80-94; `adminSessionConfig` :130-133; `getAdminCredentials` :24-31 | — | 156 | none | High | High | This is a second, independent copy of `apps/api/src/lib/admin-session.ts` — which one is canonical when they drift? |
| SI-WEB-03 | `src/lib/api-client.ts` | `apiFetch` :52-65; `apiFetchJson` :72-84; `HOSTNAME_TO_API` :29-35; `ApiError` :67-70 | C04,O04 | 149-154 | none | High | High | `apiFetchJson` flattens every error to a string message — a `403 support_context_required` code cannot survive it |
| SI-WEB-04 | `src/lib/api-client-server.ts` | `apiFetchServer` :26-63; `apiFetchServerJson` :70-82; cookie forwarding :49-54 | C04,O04 | 149-154 | none | High | High | Forwards the whole cookie jar to a cross-origin API host — is that intended for non-session cookies too? |
| SI-WEB-05 | `src/lib/org-context.ts` | `requireOrgContext` :131-151; `orgLandingPathForSession` :159-165; `fetchMe`/`fetchOrg` :82-93; `AdminMe` :39-51 | G06,O06 | 150 | none | High | High | `pickMembership` falls back to the first host_admin org :116 — a wrong slug silently renders another tenant then rewrites the URL |
| SI-WEB-06 | `src/lib/org-tenant.ts` | `resolveOrgTenant` :357-384; `slugForOrgName` :315-318; `readOrgBranding` :252-275; `BUILT_SECTIONS` :204-207; `TENANT_REGISTRY` :166-180 | O06,O07,O08 | 149-151 | none | Medium | High | `BUILT_SECTIONS` is the only "is this shipped" switch in the web app — should onboarding/cost-factor gating hang off it? |
| SI-WEB-07 | `src/app/org/[slug]/layout.tsx` | `OrgLayout` :29-42; `generateMetadata` :19-27; imports `../org-landing.css` :15 | G06 | 150 | none | High | High | Layout is the only auth gate for every `/org/[slug]/*` sub-route — nothing re-checks below it |
| SI-WEB-08 | `src/app/org/[slug]/page.tsx` | `OrgOverviewPage` :71; GET orgs/:id/chargers, /installations, /sessions :88-98; section cards :289-320 | O06,O08 | 149-151 | none | Medium | High | Unbuilt sections render as "soon", not as the doc-17 disabled-state copy — is "soon" acceptable for O01? |
| SI-WEB-09 | `src/app/org/page.tsx` | `OrgEntryPage` :24-30; always redirects via `requireOrgContext()` | — | 150 | none | Low | High | — |
| SI-WEB-10 | `src/app/staff/overview/page.tsx` | `StaffOverviewPage` :218; `load<T>` :118-131; six parallel GETs :302-312; isPlatform gate :275 | O05,O10 | 149-154 | none | High | High | Its comment :221-231 asserts middleware is dead — now false; the gate reasoning needs re-deriving |
| SI-WEB-11 | `src/app/page.tsx` | `RootPage` :52; POST `/api/admin/login` via `apiFetch` :64-68; success → `/home` :70 | — | 152 | none | Medium | High | With `NEXT_PUBLIC_API_BASE_URL` empty (local dev) this posts to a Next route that does not exist |
| SI-WEB-12 | `src/components/language-provider.tsx` | `LanguageProvider` :22-50; `FORCED_LANGUAGE = "en"` :20; `useLanguage` :52-58 | O01 | 149-151 | none | Medium | High | `initialLanguage` prop is accepted and ignored :26 — dead parameter or a restore hook? |
| SI-WEB-13 | `src/lib/api-auth.ts` | `requireAdmin` :12-14; `requireStraumvaktStaff` :17-23; `unauthorized` :25-27; `apiError` :29-34 | — | — | none | Low | High | Zero importers anywhere in `src/` — delete, or is it the intended seam for reinstated Next API routes? |
| SI-WEB-14 | `next.config.mjs` | `typedRoutes: true` :15; `redirects()` :19-32 (`/tenants*` → `/accounts*`); `env` APP_VERSION/BUILD_TIME :46-47 | O02 | 153 | none | Medium | High | No `NEXT_PUBLIC_DEMO_MODE` exists anywhere, so O02's "build fails" guard has nothing to hook into |

**Area findings**

1. **The middleware relocation the reconciliation doc says to do "last" has already happened, and the doc is stale.** `src/middleware.ts` exists (git: `14c1ce2 [Sprint 9] move middleware.ts into src/ so it actually runs`), the repo-root `middleware.ts` is gone, yet `docs/relaunch-middleware-reconciliation.md:3` still reads "Status: open" and its §1 still asserts the file "sits at the repo root". Three source comments repeat the same dead claim: `src/middleware.ts:45-54`, `src/app/staff/page.tsx:27-34`, and `src/app/staff/overview/page.tsx:221-231` ("an unauthenticated visitor reaches this line directly"). Any implementer reading those will reason from a false premise.
2. **Step 2 of that doc was skipped: `/org/[slug]` has no middleware rule.** `src/middleware.ts:113-131` runs `staffRouteResponse` then falls through to the catch-all, so an unauthenticated `/org/<slug>` is redirected to `/` by default — exactly the "silently inherits a default nobody chose" outcome the doc warned about at §3. The `x-straumvakt-admin-verified` strip-and-restamp (`src/middleware.ts:87-88`, `:135`) is now genuinely live, but **nothing in `src/` reads that header** — no consumer exists.
3. **There are no Next.js API route handlers in this app.** `src/app/api/` does not exist; `find src -name route.ts` returns nothing. Every `/api/admin/*` path in the UI is served by `apps/api` (`app.route("/api/admin", adminAuth)` at `apps/api/src/index.ts:125`, `/api/admin/orgs` :128, `/api/admin/me` :139). Consequently `src/lib/api-auth.ts` (`requireAdmin`, `requireStraumvaktStaff`, `unauthorized`, `apiError`) has **zero importers** and `PUBLIC_PATHS = {"/api/admin/login"}` in `src/middleware.ts:12` guards a path this app never serves. With `NEXT_PUBLIC_API_BASE_URL` empty — the root `wrangler.jsonc:22` production value and the local-dev default — `apiFetch` resolves to a relative URL and login 404s.
4. **There is not a single test file under `src/`.** `vitest.config.ts:17-22` includes `src/**/*.test.ts`, but `find src -name "*.test.ts*"` is empty; all web coverage is zero. Group O's O04 ("absent endpoint → assert disabled state") and scenario 154 have no existing harness to extend — a new test directory has to be created, not amended.
5. **Nothing in Group O is implemented.** `grep -rn DEMO_MODE` over the whole repo returns nothing, so O02/O03 and scenario 153 have no starting point. There is no disabled-state copy library (O01): the only disabled affordance is the literal string "soon"/"væntanlegt" in `src/app/org/[slug]/page.tsx:296-299` plus the `.soon` classes in `src/app/org/org-landing.css:182,470,474`. The strings "not tracked yet" and "Managed through driver groups" (scenarios 150, 151) appear nowhere in `src/`.
6. **`LanguageProvider` hard-forces English and ignores its own prop.** `src/components/language-provider.tsx:20` sets `FORCED_LANGUAGE = "en"` and `:26` declares `initialLanguage` but never uses it, even though `src/app/layout.tsx:24,29` computes and passes it. Every `language === "is"` branch in the org template — including all Icelandic taglines in `TENANT_REGISTRY` (`src/lib/org-tenant.ts:175-178`) and every label in `orgSectionLabel` (`:401-440`) — is unreachable. Any O01 copy work only needs the English branch today.
7. **Session verification is duplicated, not shared.** `verifyAdminSession` exists twice with independent implementations: `src/lib/admin-session.ts:96` (UI Worker, used by middleware only) and `apps/api/src/lib/admin-session.ts:79` (API Worker, used by `auth-middleware.ts`). Both read `process.env.AUTH_SECRET` from their own Worker. Now that middleware is live, an `AUTH_SECRET` mismatch between the two Workers produces a redirect loop (`/` → login → `/home` → middleware rejects → `/`), a failure mode `src/app/staff/overview/page.tsx:248-263` anticipated but could not previously trigger.
8. **`next.config.mjs:19-32` permanently redirects `/tenants*` → `/accounts*`, and `/accounts` does not exist.** The whole `(app)` console lives in `archive/straumvakt-org-console-2026-08-08/`; the redirect now lands on a 404 and, because it is `permanent: true`, browsers cache it.
9. **The org template's tenant isolation is real but the slug fallback is loose.** `requireOrgContext` (`src/lib/org-context.ts:131-151`) only ever resolves orgs returned by `GET /api/admin/me`, so a foreign slug cannot resolve — good. But `pickMembership` (`:104-117`) returns `hostAdminOrgs[0]` whenever the slug matches nothing, so a multi-org host_admin asking for an unknown slug is shown their *first* org and then redirected to that org's canonical URL rather than being refused.
## A10 — Shared DTOs/contracts, DB schema (drizzle + prisma), mobile contract surface, CI guards

The shared vocabulary was split one day before this inventory: `packages/contracts`
now holds every DTO, zod input shape, the vendor-adapter interface and the money-line
type, and `packages/shared` keeps only the Drizzle table declarations plus 31
one-line re-export shims pointing at contracts. Nothing outside `packages/shared`
imports `@straumvakt/contracts` yet — all 36 app-side call sites still go through
`@straumvakt/shared/inputs/*` and `@straumvakt/shared/domain/*`, so the new package
is real but unadopted. The database has two descriptions: Drizzle in
`packages/shared/src/db/*.ts` is authoritative (ADR 0051) and generates SQL into
`apps/api/drizzle/`, while `prisma/schema/*.prisma` survives downstream to generate
the client ~500 un-ported calls still use, and `apps/api/prisma/schema/` is a
generated copy of that. Migrations therefore live in two places: 47 Prisma
migrations in `prisma/migrations/` and 2 Drizzle migrations in `apps/api/drizzle/`.
CI is one workflow, `.github/workflows/check.yml`, which runs `npm run check` —
nine offline guards (typecheck, prisma validate, generated-copy freshness,
Drizzle/Prisma column comparison, dependency-cruiser, endpoint inventory, unused
exports, work-view). It does **not** run vitest at all: no test suite executes in
CI on any branch. None of the tables the packet's Groups C, E and G assume
(`support_contexts`, `session_attribution`, `IdToken.tokenClass`,
`onboarding_workflow`) exist anywhere in source.

| ID | File | Symbols / routes | Pkg | Scen | Tests affected | Risk | Conf | Open question |
|---|---|---|---|---|---|---|---|---|
| SI-CONTRACTS-01 | `packages/contracts/src/inputs/users.ts` | `UserCreateInput` :11-45; `UserUpdateInput` :47-89; `IdTokenKindEnum` :116-127; `MEMBERSHIP_ROLES` :159-173; `MembershipCreateInput` :176-180 | A10,B14,P04 | 13-14,20 | `apps/api/src/lib/auth/permissions.test.ts`; `apps/api/src/routes/public/register.test.ts` | High | High | Is `host_admin` deliberately unassignable through `POST /api/admin/orgs/:id/memberships`, or is the zod enum simply stale? |
| SI-CONTRACTS-02 | `packages/contracts/src/domain/users.ts` | `MembershipRole` :9-24 with `host_admin` :24; `IdTokenKind` :90-103; `UserSummary` :38-69; `OrgMembershipSummary` :146-152 | P04,B14 | 20,155 | `apps/api/src/lib/auth/permissions.test.ts` | High | High | Should the DTO union be generated from the Drizzle enum rather than hand-kept? |
| SI-CONTRACTS-03 | `packages/contracts/src/inputs/onboarding-chains.ts` | `OnboardingChainInput` :31-85; re-exports `OrganizationRoleEnum` :9; `KENNITALA_RE` :4 | G01,G03,Q01 | 150 | none — no test file exists for this input | High | High | The one-shot chain input has no workflow/step model behind it; does Group G replace it or wrap it? |
| SI-CONTRACTS-04 | `packages/shared/src/index.ts` | barrel exports only `OrgInputs` and `domain/orgs` :6-7; all other surface via package.json subpath exports | Q01,Q03,P12 | 19-21 | none | Medium | High | When does the shim layer get deleted, and what forces callers to move before then? |
| SI-CONTRACTS-05 | `packages/shared/src/db/identity.ts` | `users` :70; `userCredentials` :211-219; `userTokens` :222-243; `memberships` :316-336; `membershipRoleEnum` :61; `organizations.roles` nullable :284 | E01,C01,G01,Q01 | 155 | `apps/api/test/parity/domain-schemas.test.ts`; `apps/api/test/parity/user-tokens.test.ts`; `apps/api/test/parity/identity-repositories.test.ts` | High | High | `tenancy.organizations.roles` is nullable in the DB and non-null in Prisma — who owns restoring the constraint? |
| SI-CONTRACTS-06 | `prisma/schema/identity.prisma` | `model User` :14; `model UserCredential` :340; `model UserToken` :365; `model Organization` :428; `model Membership` :609; `enum MembershipRole` :648; `enum IdTokenKind` :240 | Q01,Q02 | 155 | `apps/api/test/parity/schema-columns.test.ts` | High | High | Any schema change must be written twice until the last Prisma call goes — is that sequencing written down for Group Q? |
| SI-CONTRACTS-07 | `prisma.config.ts` | `schema: prisma/schema` :30; `migrations.path` :57; `migrations.seed` :58 | Q09,Q10 | — | none | High | High | Q09 says the guard shipped, but `check:migrations` is still not wired into CI — is that acceptable? |
| SI-CONTRACTS-08 | `apps/api/drizzle.config.ts` | `schema: packages/shared/src/db/*.ts` :25; `out: ./drizzle` :26; `schemaFilter` 18 entries :36; `strict` :42 | Q01,Q05 | — | none | High | Medium | `schemaFilter` omits `hosts` and `issues` which the Prisma datasource still lists — safe, or a blind spot for future tables? |
| SI-CONTRACTS-09 | `scripts/check-schema-consistency.mjs` | two-pass Prisma parse :43-77; Drizzle parse :80-95; vacuous-pass guard :108-118; compare :120-132 | Q01,P11 | — | `scripts/check-schema-consistency.test.mjs` | High | High | It compares table and column names only — no types, nullability or defaults. Is that gap acknowledged? |
| SI-CONTRACTS-10 | `scripts/sync-api-prisma-schema.mjs` | generates `apps/api/prisma/schema/` :74-96; `--check` stale detection :122-129; orphan sweep :106-111 | Q01,Q12 | — | none | Medium | High | `apps/api/prisma/header.prisma` stays hand-maintained — does anything guard its datasource against drift? |
| SI-CONTRACTS-11 | `.github/workflows/check.yml` | `on: push branches **` :47-50; `npm run db:generate` :69; `npm run check` :70; deliberate omission of `check:migrations` :10-44 | P01,P11,Q09 | 153 | every `*.test.ts` in the repo — none of them run here | High | High | Adding `npm test` to CI is a one-line change; what is blocking it? |
| SI-CONTRACTS-12 | `vitest.config.ts` | `include` globs :19-24 covering `src`, `apps/api/src`, `packages`, `scripts/**/*.test.mjs`; `environment: node` :16 | P01,P11,P12 | — | all offline suites | Medium | High | `apps/mobile` Dart tests are outside this runner entirely — who runs them? |
| SI-CONTRACTS-13 | `apps/api/test/parity/domain-schemas.test.ts` | `allTables()` :44-59 discovers exported Drizzle tables across 8 domain modules; guarded by `hasDb` from `_harness.ts` :29 | P10,Q04 | — | itself; `apps/api/test/parity/schema-columns.test.ts` | Medium | High | This is the only thing proving the Drizzle declarations are true, and it never runs in CI — is a disposable branch planned? |
| SI-CONTRACTS-14 | `apps/mobile/lib/api/client.dart` | `consumeInvite` :93-119 posts `token` plus `kennitala` plus `password` to `POST /api/public/invites/consume`; `_inviteErrorMessage` :122-137 | A06,A11,A12,B08 | 20-23,25 | none — `apps/mobile/test/` holds only `widget_test.dart` | High | High | The app has no branch for `already_claimed`; what does it show today when S2 lands? |

**Area findings**

1. `packages/contracts` has no consumer outside itself. Every one of the 32 files
   that reference `@straumvakt/contracts` is either the package's own
   `src/index.ts` or one of the 31 re-export shims inside `packages/shared/src`
   (`packages/shared/src/inputs/users.ts:10`, `packages/shared/src/domain/users.ts:10`,
   and so on). All 36 app-side imports still name `@straumvakt/shared/inputs/*` or
   `@straumvakt/shared/domain/*`. The harvest is complete but adoption is zero.

2. `host_admin` exists in four places and is missing from two. It is in the
   Drizzle enum (`packages/shared/src/db/identity.ts:61`), the domain union
   (`packages/contracts/src/domain/users.ts:24`) and the permission bundle
   (`apps/api/src/lib/auth/permissions.ts:223`), but **not** in
   `MEMBERSHIP_ROLES` (`packages/contracts/src/inputs/users.ts:159-173`) — so
   `MembershipCreateInput` at `apps/api/src/routes/admin/orgs.ts:398` rejects it
   with a 400 — and **not** in the hand-written `ALL_MEMBERSHIP_ROLES` list at
   `apps/api/src/lib/auth/permissions.test.ts:26-38`, so the "every role has a
   bundle" test never sees it. P04 ("permission-matrix test from source") has a
   live example waiting for it.

3. **No test runs in CI.** `.github/workflows/check.yml:64-70` is the only
   push-triggered workflow and its three steps are `npm install`,
   `npm run db:generate`, `npm run check`. `scripts/check-all.mjs:14-36` lists
   nine checks and none of them is vitest. Every P0 item in Group P ("in CI,
   offline") needs a CI step that does not exist yet, not just a test file.

4. **The tables Groups C, E and G assume are absent everywhere in source, not
   merely unmigrated.** A repo-wide grep excluding `docs/` for
   `onboarding_workflow`, `SupportContext`, `support_contexts`,
   `session_attribution` and `tokenClass` across `.ts`, `.tsx`, `.prisma`,
   `.sql`, `.mjs` and `.dart` returns nothing. C01, E01, E06, E10 and G01-G05 are
   greenfield in both the Drizzle declarations and both Prisma schemas.

5. **`ConsumeBody` is not a shared contract and silently drops `kennitala`.** It
   is a local zod object at `apps/api/src/routes/public/invites.ts:36-39` with
   only `token` and `password`; the mobile client sends a third field,
   `kennitala`, at `apps/mobile/lib/api/client.dart:101-105`. Non-strict `z.object`
   strips it without error, so A11's "verify or drop" decision is currently
   resolved as "drop, silently". A10's strictness change would turn every mobile
   invite redemption into a 400 — that is scenario 20 failing, not passing.

6. **The mobile contract test the packet cites is not on this branch.**
   `apps/mobile/test/api/client_contract_test.dart` is cited by
   `docs/domain/onboarding/08-evidence-ledger.md:61` at commit `4757f5c`;
   `git merge-base --is-ancestor 4757f5c HEAD` reports NOT_ANCESTOR, and
   `git ls-tree -r HEAD -- apps/mobile/test` lists only `widget_test.dart`, an
   eleven-line placeholder. A12 ("rename mobile contract test") has no file to
   rename in this worktree.

7. **There are zero test files in `packages/contracts` and `packages/shared`**, and
   `scripts/check-unused-exports.mjs:34-39` only walks `apps/api/src` and
   `apps/api/test` — so nothing in either package is covered by a test or by the
   dead-export guard. `.dependency-cruiser.cjs:213-227` (`no-package-to-deployable`)
   is the only guard that touches them at all.

8. **Two migration systems run in parallel and only one is checked.**
   `prisma/migrations/` holds 47 directories plus `migration_lock.toml`;
   `apps/api/drizzle/meta/_journal.json` holds 2 entries (`0000_baseline`,
   `0001_regular_talos`). `npm run check:migrations` covers only the Prisma set,
   needs a live `DATABASE_URL`, is deliberately excluded from CI
   (`.github/workflows/check.yml:10-44`), and exits non-zero today because
   `20260807003000_drop_issues_scaffold` and `20260807120000_drop_never_used_tables`
   are on disk but unrecorded against staging — exactly Q10.

9. **Scenario 153's guard does not exist.** `NEXT_PUBLIC_DEMO_MODE` appears nowhere
   in the repo outside `docs/`; there is no build-time check that fails when it is
   set against a beta config.

10. The commercial harvest left duplicated live tests: `apps/api/src/lib/agreement/
    resolve.ts` is a 15-line shim (`:1-9`) over `packages/commercial/src/agreement/
    resolve.ts` (314 lines), yet `apps/api/src/lib/agreement/resolve.test.ts` (497
    lines) and `packages/commercial/src/agreement/resolve.test.ts` (574 lines) both
    match `vitest.config.ts:19-24` and both run. Any P-group headline test count is
    inflated by that pair.
