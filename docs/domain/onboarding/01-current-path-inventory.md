# Current path inventory and contradictions

Phase 0.3–0.6. Every row was read from source at the snapshot in
[00-INDEX](00-INDEX.md). File and line references are given so each claim can be
re-checked rather than trusted.

## 1. Path matrix — how a person becomes able to charge

Seven live paths reach "this person may charge at this installation". They do
not agree with each other.

| # | Entry point | Who may call | Binds identity? | Creates user | Sets password | Grants | Bearer-transferable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `POST /api/public/invites/consume` | anyone with the token | **no** [F] | no (pre-created) | **yes — overwrites** [F] | `Membership` → `active` | **yes** [F] |
| 2 | `POST /api/driver/claim-invite` | anyone with the token | no (sets credential on bound user only) | no | yes — **refuses if set** [F] | nothing | yes, but harmless |
| 3 | `POST /api/driver/redeem-invite` | authenticated driver | **yes** [F] | no | no | `DriverGroupMembership` | **no** [F] |
| 4 | `POST /api/public/register` | anyone | kennitala validated [F] | yes | yes | nothing | n/a |
| 5 | `POST /api/driver/access-requests` | authenticated driver | yes | no | no | request only | n/a |
| 6 | `PATCH /api/admin/access-requests/:id` | org admin | n/a | no | no | `DriverGroupMembership` | n/a |
| 7 | `POST /api/admin/orgs/:orgId/driver-group-memberships` | org admin | n/a | no | no | `DriverGroupMembership` | n/a |

Mint side: `POST /api/admin/orgs/:orgId/invites` (org invites) and
`POST /api/admin/orgs/:orgId/driver-invites` (driver invites) are separate
routes producing separate token kinds consumed by separate paths.

### Which path the Flutter app actually calls

**[F]** `apps/mobile/lib/api/client.dart:103` — the app calls **path 1**,
`POST /api/public/invites/consume`. It does not call `redeem-invite` or
`claim-invite` at all. The ADR 0053 identity binding therefore protects a path
the shipping app does not use.

## 2. Finding A — two invite paths, two security models

**[F]** `apps/api/src/routes/public/invites.ts:4-6`:

> These routes are NOT gated by the admin session cookie. They're gated by the
> invite token itself — possession of an unexpired unused invite token is the
> only authorisation required.

**[F]** `apps/api/src/routes/public/driver.ts:1203-1207` — `redeem-invite`
compares `row.userId !== userId` and rejects before any grant, deliberately
before the conditional claim, so a rejected attempt leaves the token unconsumed.

So an **organisation membership** — the higher privilege — is handed out on
bearer possession, while a **driver group membership** — the lower privilege —
is identity-bound. The protection is inverted relative to the risk.

**[I]** Anyone who obtains an org invite link (forwarded mail, shared screenshot,
mail-server log, shoulder-surfed QR) becomes an active member of that
organisation under the invitee's identity, and the audit row records the
*invitee* as actor.

## 3. Finding B — `consume` overwrites an existing password

**[F]** `apps/api/src/routes/public/invites.ts:142-147`:

```ts
await tx.userCredential.upsert({
  where: { userId: row.userId },
  create: { userId: row.userId, passwordHash },
  update: { passwordHash },        // <- overwrites
});
```

**[F]** The driver equivalent refuses: `driver.ts:1090` returns
`already_claimed` when the bound user already has a credential, and the parity
suite asserts the original hash is preserved
(`apps/api/test/parity/driver-invite-redemption-parity.test.ts`, "refuses with
409 already_claimed … and does not overwrite it").

**[I]** An unconsumed org invite is therefore a **standing password-reset
capability** against the invited account, valid until it expires, exercisable by
anyone holding the link. If an invited person accepts, then the token is somehow
replayed — or a second invite is issued and intercepted — their password can be
replaced without their involvement.

**[U]** Whether any org invite tokens are currently outstanding on staging, and
for which accounts. Not checked: that requires a database read, which is out of
scope here.

## 4. Finding C — the mobile app sends a national ID the server discards

**[F]** `apps/mobile/lib/api/client.dart:97-107` (mobile tip `4757f5c`) posts:

```dart
body: jsonEncode({ 'token': token, 'kennitala': kennitala, 'password': password })
```

**[F]** `apps/api/src/routes/public/invites.ts:36-39`:

```ts
const ConsumeBody = z.object({
  token: z.string().min(8).max(256),
  password: z.string().min(8).max(128),
});
```

A non-strict Zod object strips unknown keys, so `kennitala` never reaches the
handler. `grep kennitala apps/api/src/routes/public/invites.ts` returns nothing.

**[F]** The app presents this as a verified factor —
`client.dart:135` renders "Check the code, kennitala and password and try
again." on failure, and `client.dart:93` comments that the backend resolves
identity from it.

**[F]** By contrast `POST /api/public/register` **does** validate kennitala
(`register.ts:45`, 10-digit regex) and can return `kennitala_taken`
(`register.ts:19`).

**[I]** This is the most user-visible of the three: a driver is asked for a
national ID, is told it is being checked, and it is not. It creates a false
impression of identity verification in the UI and in any screenshot of it.

## 5. The N1 deadlock, re-derived rather than assumed

Hard stop 8 requires reconciling the historical deadlock against the current RC
instead of restating it.

**Historical claim:** a driver invited by email could never redeem, because
`redeem-invite` requires an authenticated driver session, the invitee was created
as a **passwordless placeholder**, and nothing let them set a password.

**[F]** The placeholder is real and still created:
`apps/api/src/repositories/host-invites.ts:175-183` find-or-creates the invitee
as `audience: "driver", status: "active"` with **no credential row**.

**[F]** The deadlock is **resolved on the current RC** for the driver path.
`POST /api/driver/claim-invite` (`driver.ts:991`, `:1030`) sets a credential on
the bound user without consuming the token, so the sequence claim → login →
redeem closes. The RC's parity suite asserts exactly this end to end
(`driver-invite-redemption-parity.test.ts:757`, "full loop: claim → login →
redeem completes end to end for a fresh invitee").

**[I] But it is resolved on a path the mobile app does not call.** Per §1 the
app uses `invites/consume`. So for the shipping Flutter client the deadlock is
avoided only because `consume` sets a password itself — which is Finding B, the
overwrite. The fix and the vulnerability are the same mechanism.

**Status: resolved in the API, not reachable from the app.** Any consolidation
must move the app onto the identity-bound path *before* the bearer path is
hardened, or drivers lose the ability to onboard.

## 6. ADR reconciliation

| ADR | Subject | Status against source |
| --- | --- | --- |
| 0014 | identity, tenancy, authorization | consistent |
| 0020 | driver access via driver groups | consistent — `DriverGroupMembership` is the grant everywhere |
| 0022 | driver self-onboarding | **partly superseded** — assumes a self-serve path the app does not use |
| 0026 | host-managed driver enrolment | consistent with paths 6–7 |
| 0027 | host onboarding, operator-create + host-admin invite | describes path 1; **does not mention the overwrite** |
| 0028 | driver invite mechanism | consistent; `security: 'none'` still the only implemented mode (`host-invites.ts:24`) |
| 0034 | contractor billing / Tengill | out of scope here; see 05 for why it must not become staff authority |
| 0042 | real driver identity and tap attribution | consistent; see 06 |
| 0043 | homeless driver and join paths | **the closest existing statement of the new product ask**; see 03 |
| 0044 | driver-side capabilities | consistent |
| 0050 | read models and the single onboarding | **the direct predecessor of this packet** |
| 0053 | driver invites are identity-bound | consistent, and enforced — but only on paths 2–3 |

**Contradiction between accepted ADR text and source:** ADR 0053 states invites
are identity-bound capabilities rather than bearer tokens. That is true of the
driver invite and false of the org invite, which remains bearer-only
(`invites.ts:4-6`). The ADR's principle has been applied to one of two paths.

## 7. Uncalled or obsolete surface

**[F]** From the generated caller column at `4b69d0f`, these onboarding-domain
routes have **no in-repo caller**: `/api/admin/groups`,
`/api/admin/host-applications/:id` (GET and PATCH), `/api/admin/memberships/*`,
`/api/admin/orgs/:orgId/driver-invites` (both verbs),
`/api/admin/orgs/:orgId/invites` (all verbs),
`/api/admin/orgs/:orgId/driver-group-memberships`, `/api/public/invites/peek`,
`/api/public/register`, `/api/public/host-applications`,
`/api/driver/access-requests`, `/api/admin/access-requests` (both).

**[I]** Callers were archived with the console during the relaunch; the routes
are implemented and served but nothing in-repo drives them. That is opportunity,
not dead code: the consolidation in [04](04-invite-consolidation.md) can change
these without a compatibility window, because there is no client to break. The
exceptions are the four paths the Flutter app really calls.

**[U]** Whether any external client (a browser bookmark, a partner integration,
a manual `curl` runbook) calls them. Cannot be determined from the repo.
