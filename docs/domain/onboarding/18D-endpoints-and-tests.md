# Appendix 18D — endpoint pseudocode and test matrix

Completion-rule items 4 and 5. All endpoint names **PROPOSED** unless marked
`EXISTS`.

---

## Part 1 — endpoint pseudocode

Conventions inherited from source, not invented: errors are
`{ "error": "<snake_case>" }`; validation is
`{ "error":"validation", "issues":[…] }` at 400; bearer for driver routes,
admin session for admin routes; tenancy is an explicit `orgId` argument.

### 1.1 `POST /api/public/invites/consume` — **EXISTS, changed**

```
auth:        none (bearer token in body)     [unchanged]
permission:  none
request:     { token, password }             [strict — A10]
flow:
  tx:
    row = userToken.findUnique(tokenHash)
    if !row || row.kind != "invite"   -> not_found        404
    if row.usedAt                     -> already_used     410
    if row.expiresAt <= now           -> expired          410
    meta -> { orgId, email } else     -> malformed        400   [was 500]
    ── A01 GUARD, BEFORE THE CLAIM ──
    if userCredential.exists(row.userId) -> already_claimed 409
    claim = userToken.updateMany(id, usedAt:null -> now)
    if claim.count == 0               -> already_used     410
    userCredential.create(...)        [A02: create, not upsert]
    membership.updateMany(invited -> active)
    user.update(emailVerifiedAt)
    audit("membership.invite_accepted", actorKind:"user")
response 200: { ok, userId, orgId, email }
audit on refusal: ("invite.consume_refused", actorKind:"bearer")   [A04]
idempotency: conditional claim on usedAt (CAS)
tests: T-S2-1..6
UI: 409 -> "This invitation has already been set up. Sign in instead."
```

### 1.2 `POST /api/driver/join` — PROPOSED

```
auth:        bearer driver session  [REQUIRED for every method — the invariant]
request:     { method:"invite",     token }
           | { method:"accessCode", code, passphrase }
           | { method:"request",    installationRef, message? }
headers:     Idempotency-Key
flow (accessCode):
  cred = credential.byCode(code)                  // point lookup, unique index
  ok   = cred && verifyPassphrase(passphrase, cred.hash)   // constant-time-ish
  if !ok || cred.revoked || cred.expired || cred.exhausted
                                    -> rejected:"not_available"   200
  switch cred.policyMode:
    automatic         -> grant()   -> { state:"granted", grantId, driverGroupId }
    approval_required -> request() -> { state:"pending", requestId }
    invite_only|closed             -> rejected:"not_available"
errors:  401 unauthenticated · 429 rate_limited (FAIL CLOSED) · 400 validation
idempotency: Idempotency-Key -> first result replayed
audit:   join.granted | join.pending | join.rejected (+credentialId)
tests:   T-JOIN-1/2, T-ABUSE-6a/b, T-RACE-3/4
UI:      one generic failure string for every rejection cause
```

### 1.3 `POST /api/admin/support-contexts` — PROPOSED

```
auth:        admin session
permission:  platform.support.action        [first call site — C12]
request:     { organisationId, reason, breakGlass? }
flow:        create SupportContext(expiresAt = now + TTL, absolute)
             audit("support_context.opened", reason, breakGlass)
             enqueue notification to org admins           [outbox]
response 201:{ id, actorUserId, actorEmail, organisationId, organisationName,
               enteredAt, expiresAt, reason, breakGlass }
errors:      403 forbidden (verb missing) · 400 validation (no reason)
tests:       T-SC-2/7/8
UI:          banner contract, doc 17 §2.5
```
`GET /current` → the open context or 404 · `POST /:id/exit` → closes, audits ·
`POST /:id/extend` → new reason + new absolute expiry, audited.

### 1.4 `requirePermission` guard — **EXISTS, changed** (not an endpoint)

```
resolve userId, orgId                       [exists today, :69-70]
perms = resolveEffectivePermissions(db, userId, orgId)    [exists, :74]
if !perms.has(verb) -> 403 forbidden
── NEW ──
if orgId && satisfiedOnlyByPlatformGrant(perms, verb):
    ctx = supportContext.open(userId, orgId, now)
    if !ctx -> 403 support_context_required
    c.set("supportContextId", ctx.id)
```
`satisfiedOnlyByPlatformGrant` is the whole safety argument: a member acts as a
member (T-SC-5).

### 1.5 Onboarding — PROPOSED

```
GET   /api/admin/orgs/:orgId/onboarding        -> summary (doc 10 §3.1)
POST  /api/admin/orgs/:orgId/onboarding        -> start/resume, Idempotency-Key
PATCH /api/admin/orgs/:orgId/onboarding/steps/:stepKey
      headers If-Match:<version>
      body    { state:"complete"|"skipped"|"blocked", reason?, payload? }
      errors  409 version_conflict · 422 step_not_skippable
              403 step_not_permitted   (commercial + support agent)
```

### 1.6 Membership and access requests — partly EXISTS

```
GET   …/access-requests?status=&limit=&cursor=   -> { items, nextCursor }
GET   …/access-requests/:id
POST  /api/driver/access-requests/:id/cancel     (requester)
POST  …/access-requests/:id/approve   If-Match   -> grant, audit
POST  …/access-requests/:id/reject    If-Match   -> { reasonCode, note? }
dedupe: partial unique (installation_id,user_id) WHERE pending
        second submit returns the first with 200 (not 409)
```

### 1.7 Agreements and cost factors — PROPOSED

```
POST   …/agreements                 -> draft
PATCH  …/agreements/:id             -> draft only, else 409 not_draft
POST   …/agreements/:id/activate    -> permission: org admin ONLY (K07)
                                       exclusion constraint rejects overlap (K05)
                                       audit + pricing snapshot
POST   …/agreements/:id/retire      -> sets effectiveUntil; never deletes
POST   …/agreements/:id/clauses     -> { costFactorCode, value, scope }
                                       scope ∈ org|driver_group|installation|charger
DELETE …/clauses/:id                -> draft only
POST   …/agreements/:id/preview     -> REUSES debug-resolve resolver (K08)
```

### 1.8 Attribution — EXISTS, extended

```
POST /api/internal/ocpp-authorize            [EXISTS]
 response (additive):
   { verdict, reason, enforceAuthorize, userId?, idTokenId?,
     tokenClass, attribution }
 invariant: tokenClass=="installation_technical"
            => userId == null && attribution == "installation"
POST /api/admin/sessions/:id/attribution/correct   -- PROPOSED
   { attribution, subjectUserId?, basis, reason }
   never overwrites; emits a correction event
```

### 1.9 Audit projection — PROPOSED

```
GET /api/admin/orgs/:orgId/audit-events?…  permission: audit.read  [D03]
 -> { items:[{ actorUserId, actorKind, onBehalfOfOrgId, supportContextId,
                action, targetType, targetId, reason, occurredAt }], nextCursor }
 visible to the ORGANISATION, not only to Straumvakt
```

---

## Part 2 — test matrix

`layer`: U unit · R repository · A API contract · E end-to-end · S static.
"Codex may rely on" = the behaviour is stable enough to build UI against.

| Test | Packages | Layer | Needs | Command (safe) | Expected | Failure means | Codex rely |
|---|---|---|---|---|---|---|---|
| **T-S2-1** guard before claim | A01,A03 | A | DB | parity, disposable | 409, hash identical, `usedAt` null | Critical open | yes |
| **T-S2-2** create not upsert | A02 | R | DB | parity | credential created once | overwrite possible | yes |
| **T-S2-3** refusal audited | A04 | A | DB | parity | actor ≠ invitee | actor laundering | yes |
| **T-S2-4** concurrent consume | A09 | R | DB | parity | one winner | double grant | no |
| **T-S2-5** **no invite burn** | A08 | A | DB | parity | invitee still succeeds | **deadlock recreated** | yes |
| **T-S2-6** malformed → 400 | A13 | A | DB | parity | 400 | wrong class of error | no |
| **T-SC-1** platform-only needs ctx | C02 | A | DB | parity | 403 `support_context_required` | unaudited staff access | yes |
| **T-SC-3** expiry server-side | C05 | A | DB | parity | 403 after expiry | permanent context | yes |
| **T-SC-4** ctx binds one org | C06 | A | DB | parity | 403 on org B | cross-tenant | yes |
| **T-SC-5** **member path works** | C03 | A | DB | parity | allowed, no ctx | staff lockout | yes |
| **T-SC-6** impersonate absent | D01 | S | none | `npm run check` | verb not found | loaded gun remains | yes |
| **T-ATTR-1** technical ⇒ null user | E04 | U | none | `npm test` | `userId` null | false attribution | yes |
| **T-ATTR-2** concurrent technical | E17 | R | DB | parity | neither names a user | billing corruption | yes |
| **T-ATTR-5** upgrade only | E08 | U | none | `npm test` | downgrade rejected | silent re-assignment | yes |
| **T-ATTR-7** CHECK constraint | E05 | R | DB | parity | insert fails | invariant drift | no |
| **T-AGR-overlap** | K05,L11 | R | DB | parity | second rejected | non-deterministic pricing | yes |
| **T-AGR-activate-perm** | K07 | A | DB | parity | staff 403 | terms accepted for org | yes |
| **T-PERM-matrix** | P04 | S | none | `npm run check` | matches source | silent drift | yes |
| **T-PERM-inventory** | P05 | S | none | `npm run check` | no new unenforced verb | permission rot | yes |
| **T-RL-failclosed** | J06 | U | none | `npm test` | join refuses | unlimited guessing | yes |
| **T-ABUSE-6b** generic failure | B05 | A | DB | parity | identical bodies | enumeration | yes |
| **T-COMPAT-1** old client | B-group | E | beta | — | works | breakage | no |
| **T-COMPAT-3** **fails by design** | B13 | E | beta | — | **fails** | gate reordered | no |
| **T-UI-disabled** | O04 | U | none | Codex suite | disabled state asserted | UI lies | yes |
| **T-OBS-1** overwrite alert | A05 | E | beta | — | alert fires | silent Critical | no |
| **H1–H4** | F05–F08 | E | hardware | bench | recorded | assumptions unproven | no |

**Safe command for every DB row** — approval required, and the suite **mutates**:

```
PARITY_DATABASE_URL=<approved disposable branch> npm --prefix apps/api run test:parity
```

Never point it at staging or production.

**Runnable with no DB/cloud/hardware today:** T-SC-6, T-ATTR-1, T-ATTR-5,
T-PERM-matrix, T-PERM-inventory, T-RL-failclosed, T-UI-disabled — the natural
first CI batch, matching the 38 `[L]` scenarios in
[18C](18C-scenarios.md).

**Tests run in this session: none.** All of the above are specifications; this
track forbids live DB, cloud and hardware access.
