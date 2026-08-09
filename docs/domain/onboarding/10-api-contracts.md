# API contract package

Phase 4, completing the previously partial Phase 6 as a standalone artifact.
**Every name below is PROPOSED.** Nothing here is implemented.

## 1. Vocabulary reconciliation — one set of names, not two

This packet and Codex's `2026-08-09-onboarding-frontend-contract.md` were written
independently and converged on the same architecture with different words. Two
vocabularies shipping together is how a domain acquires permanent translation
layers, so one is adopted here.

**Rule applied:** the UI is the consumer, so Codex's names win unless this
packet's carries a distinction Codex's cannot express.

| Concept | This packet had | Codex had | **ADOPTED** | Why |
| --- | --- | --- | --- | --- |
| Workflow state | `AwaitingValidation` | `ready` | **`ready`** | shorter, same meaning |
| Workflow state | `Suspended` | *(absent)* | **`suspended` added** | doc 02 invariant 4 needs it; a live org can be paused without cancelling |
| Step state | `done` | `complete` | **`complete`** | consumer's word |
| Step state | `pending` | `not_started` | **`not_started`** | unambiguous |
| Step state | *(absent)* | `ready` | **`ready`** | genuinely useful: unblocked but untouched |
| Step state | `failed` | *(absent)* | **dropped** | `blocked` + reason covers it |
| Next actor | `nextActionOwner: org_admin\|staff\|system` | `nextActor: organisation\|straumvakt\|null` | **`nextActor`** | `null` beats a fake `system` actor |
| Steps | 13 fine-grained | 7 coarse | **7 coarse + `substeps[]`** | see §2 |
| Support ctx | `+expiresAt, grantedPermissions, breakGlass` | actor/org/reason only | **Codex's + this packet's three** | expiry and scope are security-load-bearing, not presentation |

### Step granularity

Codex's seven (`organisation`, `administrator`, `commercial`, `infrastructure`,
`chargers`, `driver_access`, `validation`) are the right **UI** granularity — a
progress bar with thirteen entries is a wall. This packet's thirteen are the
right **audit** granularity.

**Adopted:** seven steps, each with `substeps[]`. The UI renders steps; the
audit log and skip-reasons attach to substeps. Neither side loses.

## 2. Conventions inherited from the current API

Matched, not reinvented — all `SOURCE-FACT` from `apps/api/src/routes`:

- Errors are `{ "error": "<snake_case_code>" }` with an HTTP status. Existing
  codes include `not_found`, `already_used`, `expired`, `validation`,
  `auth_failed`, `unauthenticated`, `already_have_access`, `token_required`.
- Validation failures are `{ "error": "validation", "issues": [...] }` with
  `400` (`invites.ts:90`).
- Machine codes are stable; human strings are not part of the contract.
- Bearer tokens for driver routes; admin session cookie for admin routes.
- Tenancy predicate is an explicit `orgId` argument, never inferred.

**New conventions proposed** (none exist yet): `Idempotency-Key` request header
on every mutating endpoint; `If-Match` carrying the aggregate `version` for
compare-and-set; cursor pagination as `{ items, nextCursor }`.

## 3. Endpoints

Common to all: `401 unauthenticated`, `403 forbidden`, `429 rate_limited`,
`500 internal`. Every mutation writes an audit event naming `actorUserId` and,
inside a support context, `onBehalfOfOrgId`.

### 3.1 `GET /api/admin/orgs/:orgId/onboarding` — PROPOSED

Auth: org admin, or staff in support context. Tenancy: `orgId` predicate.

```json
{ "workflowId": "wf_…", "organisationId": "org_…",
  "state": "in_progress", "nextActor": "organisation", "version": 7,
  "steps": [ { "key": "organisation", "state": "complete",
               "owner": "organisation", "updatedAt": "2026-08-09T10:00:00Z",
               "substeps": [ { "key": "org_identity", "state": "complete" },
                             { "key": "legal_contact", "state": "skipped",
                               "skipReason": "supplied offline" } ] } ] }
```

Errors: `404 not_found` (also when the caller may not see the org — **never**
`403`, which would confirm existence).

### 3.2 `POST /api/admin/orgs/:orgId/onboarding` — start/resume — PROPOSED

Idempotent on `Idempotency-Key`. Returns the existing workflow if one is open
rather than creating a second. `409 already_open` only if a *different*
idempotency key targets an open workflow.

### 3.3 `PATCH /api/admin/orgs/:orgId/onboarding/steps/:stepKey` — PROPOSED

Headers: `Idempotency-Key`, `If-Match: <version>`.
Body: `{ "state": "complete"|"skipped"|"blocked", "reason"?, "payload"? }`.

Errors: `409 version_conflict` returning the current aggregate;
`422 step_not_skippable` for required steps; `403 step_not_permitted` for
`commercial` submitted by a support agent (doc 05 §4).

### 3.4 `POST /api/driver/join` — PROPOSED

**The single join command.** Auth: **bearer driver session required for every
method** — this is the invariant that ends bearer membership grants.

```json
{ "method": "accessCode", "code": "K3QP-7M2X", "passphrase": "…" }
{ "method": "invite",     "token": "…" }
{ "method": "request",    "installationRef": "K3QP-7M2X", "message"? }
```

Success mirrors Codex's `JoinInstallationResult` exactly:

```json
{ "state": "granted", "grantId": "dgm_…", "driverGroupId": "dg_…" }
{ "state": "pending", "requestId": "req_…" }
{ "state": "rejected", "reasonCode": "not_available" }
```

**One generic rejection.** `not_available` covers unknown code, wrong
passphrase, expired, revoked, exhausted, `invite_only` and `closed` — see
[09](09-adversarial-analysis.md) §6. Rate limit: per-identity, per-code and
per-IP, **fail closed**.

Idempotency: replay of the same key returns the first result. A second distinct
join to a group the caller already belongs to returns `granted` with the
existing `grantId` — never a duplicate row, never an error.

### 3.5 QR payload — PROPOSED

```
SVK1:<code>
```

Versioned prefix so a future scheme is distinguishable. It carries **only the
code** — never the passphrase, which the person supplies. A QR containing both
is a credential printed on a wall.

`SVK1` payloads that fail the check digit are rejected client-side without a
network call, so typos and foreign QR codes never reach the join limiter.

### 3.6 Access requests — PROPOSED

- `GET /api/admin/orgs/:orgId/access-requests?status=&limit=&cursor=` →
  `{ items, nextCursor }`
- `GET …/access-requests/:id`
- `POST /api/driver/access-requests/:id/cancel` — requester withdraws
- `POST /api/admin/orgs/:orgId/access-requests/:id/approve` — `If-Match`
- `POST …/reject` — `{ reasonCode, note? }`, `If-Match`

Dedupe: one open request per `(installationId, userId)`; a second returns the
first with `200`, not `409` — resubmitting must not look like an error to a
confused driver.

### 3.7 Access policy — PROPOSED

`GET`/`PUT /api/admin/orgs/:orgId/installations/:id/access-policy`
`{ "mode": "automatic"|"approval_required"|"invite_only"|"closed" }`,
`If-Match`. Changing mode never retroactively resolves open requests
(doc 03 §4).

### 3.8 Access credentials — PROPOSED

- `POST …/installations/:id/access-credentials` → returns `code` **and the
  passphrase exactly once**, never retrievable again
- `POST …/access-credentials/:credId/rotate` → new pair, old one gains
  `expiresAt = now + grace`
- `POST …/access-credentials/:credId/revoke` → `{ reason }`, immediate;
  **existing grants survive** (doc 03 §3)

### 3.9 Support context — PROPOSED

- `POST /api/admin/support-contexts` → `{ organisationId, reason }`; requires
  `platform.support.enter`; returns Codex's `SupportContext` plus `expiresAt`,
  `grantedPermissions[]`, `breakGlass`
- `GET /api/admin/support-contexts/current`
- `POST /api/admin/support-contexts/:id/exit`

Expiry is absolute and enforced **server-side per request**. `403
support_context_expired` is distinct from `403 forbidden` so the UI can offer
re-entry rather than a dead end.

### 3.10 Audit projection — PROPOSED

`GET /api/admin/orgs/:orgId/audit-events?…` → `{ items, nextCursor }` with
`actorUserId`, `actorKind`, `onBehalfOfOrgId`, `action`, `targetType`,
`targetId`, `reason`, `occurredAt`. **Visible to the organisation, not only to
Straumvakt** (doc 05 §3 rule 6).

### 3.11 `GET /api/driver/join-state` — PROPOSED

Deliberately not `/me`, which the console's persona routing consumes
(doc 03 §2). Returns per-state data honouring the disclosure table: an
unaffiliated driver sees `{ "state": "unaffiliated" }` and nothing else; a
pending invitation reveals the **organisation display name only**, never its id
or inventory.

### 3.12 Sessions chooser — PROPOSED

`GET /api/driver/sessions/active` → `{ items: [ { sessionId, stationId,
connectorId, transactionId, startedAt, attribution } ] }`.

Identity of a session is **station + connector + transaction** — never the
idTag, and never a user. `attribution ∈ driver | installation | unknown`.

### 3.13 Authorization result, separated from attribution — PROPOSED

Extends the existing `ocpp-authorize` response (`SOURCE-FACT` `:17-19`) rather
than replacing it:

```json
{ "verdict": "Accepted", "reason": "…", "enforceAuthorize": true,
  "tokenClass": "installation_technical",
  "attribution": "installation",
  "userId": null,
  "idTokenId": "idt_…" }
```

**Invariant: `tokenClass: "installation_technical"` ⇒ `userId: null` and
`attribution: "installation"`.** Enforced in the resolver, asserted in a test.
This is the single most important line in this document.

Backward compatibility: `verdict`, `reason`, `enforceAuthorize`, `userId`,
`idTokenId` keep their current names and meanings; `tokenClass` and
`attribution` are additive. An old gateway ignoring them behaves exactly as
today.

## 4. Compatibility matrix

| | New server | Old server |
| --- | --- | --- |
| **New client** | full | `join` 404s → fall back to `invites/consume`; capability probe in [11](11-persistence-and-rollout.md) |
| **Old client** | `invites/consume` still accepted for the whole window | today |

No endpoint is removed within the compatibility window, and none is removed at
all until gates G1–G5 pass (doc 04 §4).
