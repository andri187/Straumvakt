# Verification specification and the hardware attribution boundary

Phases 6 and 9. Test specifications precise enough to implement without
inventing policy, and the evidence hierarchy that decides who a session belongs
to.

All fixtures use fictitious `.test` identities. No real person, kennitala,
address, token or meter payload appears anywhere in this packet.

## Part A — verification specification

### A0. Fixtures

```
org-alpha.test        org_alpha   automatic
org-beta.test         org_beta    approval_required
org-gamma.test        org_gamma   closed
driver-anna.test      unaffiliated, no membership
driver-bjorn.test     member of org_alpha driver group
staff-carol.test      platform.support.enter
admin-dagur.test      org_alpha admin
code ALFA-1111 / passphrase "correct horse battery staple"   -> org_alpha
code BETA-2222 / passphrase "…"                              -> org_beta
```

Kennitala fixtures are structurally valid but **not real**: `0101901234` is
already used in the existing mobile contract test and is safe to reuse.

### A1. Security regression tests — the four findings

These are the tests that must exist before any of S1–S4 is called done.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| T-SEC-2a | invitee has a credential | bearer consumes with a new password | `409 already_claimed`; **`passwordHash` byte-identical**; token unconsumed |
| T-SEC-2b | invitee has none | bearer consumes | `200`; credential created |
| T-SEC-2c | as 2a | — | audit row records the refusal, actor ≠ invitee |
| T-SEC-1a | valid token, no session | `POST /join {method:"invite"}` | `401 unauthenticated` |
| T-SEC-1b | token bound to anna, session is bjorn | join | `404 not_found` (**identical body** to unknown token) + audit `redemption_rejected` |
| T-SEC-1c | token bound to anna, session is anna | join | `200 granted` |
| T-SEC-3a | body carries `kennitala` | consume | either verified against the invitee, or `400 validation` — **never silently dropped** |
| T-SEC-3b | — | contract test runs | asserts the **real** server shape; no field the server does not emit |
| T-SEC-D1 | invite requires host approval | consume | response carries `pendingApproval: true` **or** the field does not exist in the client — never a default that lies |

T-SEC-D1 is finding D: today the Dart default makes it unconditionally `false`.
Either the server emits it or the client must not model it.

### A2. Authorization vs attribution

| ID | Given | Then |
| --- | --- | --- |
| T-ATTR-1 | `installation_technical` token accepted | `userId: null`, `attribution: "installation"` |
| T-ATTR-2 | two concurrent sessions, same technical token | both `installation`; neither names a user |
| T-ATTR-3 | driver token accepted | `attribution: "driver"`, `subject_user_id` set |
| T-ATTR-4 | free vend, no token | `attribution: "unknown"`; **signed meter values still retained** |
| T-ATTR-5 | tap evidence arrives after an `unknown` session | `unknown → driver` allowed, event records the basis |
| T-ATTR-6 | attempt `driver → unknown` silently | rejected; requires an explicit correction event |
| T-ATTR-7 | CHECK constraint | `attribution='installation'` with a non-null `subject_user_id` cannot be inserted |

### A3. Race and replay

| ID | Scenario | Expected |
| --- | --- | --- |
| T-RACE-1 | two concurrent redeems of one token | exactly one grant; loser `410 already_used` |
| T-RACE-2 | two admins approve one request | one grant; second `409 version_conflict` |
| T-RACE-3 | two identical joins, same `Idempotency-Key` | one grant, identical response twice |
| T-RACE-4 | join a group already joined | `200 granted` with the existing `grantId`; no duplicate row |
| T-RACE-5 | policy flips `automatic → approval_required` mid-request | evaluated at decision time; `pending`, not an error |
| T-RACE-6 | two open workflows attempted for one org | partial unique index rejects the second |

### A4. Rate limit and enumeration

| ID | Scenario | Expected |
| --- | --- | --- |
| T-RL-1 | rate-limiter binding absent | join **refuses** (fail closed) — contrast login, which fails open by design |
| T-RL-2 | unknown code vs wrong passphrase vs revoked vs closed | **identical** status, body and timing class |
| T-RL-3 | N+1 attempts on one code from many IPs | per-code limit trips |
| T-RL-4 | QR with a bad check digit | rejected client-side; **no** network call |

### A5. Audit attribution

`T-AUD-1` bearer consume does not record the invitee as actor ·
`T-AUD-2` every support-context mutation carries `actorUserId` +
`onBehalfOfOrgId` + `support_context_id` · `T-AUD-3` no route accepts an actor
from request input · `T-AUD-4` the org-visible audit projection shows staff
actions to the organisation.

### A6. Consumer compatibility matrix

| ID | Client | Server | Expected |
| --- | --- | --- | --- |
| T-COMPAT-1 | old app | new server | `invites/consume` works unchanged for the whole window |
| T-COMPAT-2 | new app | old server | `join` 404s → falls back; no crash, no data loss |
| T-COMPAT-3 | old app | hardened consume | **fails** — this is the test that proves stage 6 must not run before gate 5 |
| T-COMPAT-4 | old gateway | new authorize response | extra fields ignored; behaviour identical |

T-COMPAT-3 is deliberately a **failing-by-design** test: it documents the
deadlock, so anyone tempted to reorder the programme sees the cost.

### A7. Property-based invariants

1. No sequence of join calls produces two `DriverGroupMembership` rows for one
   `(driverGroupId, userId)`.
2. No sequence of transitions reaches `active` with a required step not
   `complete`.
3. For all authorization decisions, `token_class = installation_technical`
   ⇒ no user is named.
4. Every state-changing API call produces exactly one audit event.
5. Replaying any request with the same `Idempotency-Key` never increases the
   number of grants.

### A8. Tests that cannot run offline

| Needs | Tests | Safe command (**do not run without approval**) |
| --- | --- | --- |
| Database | repository, race, migration rehearsal | `PARITY_DATABASE_URL=<approved disposable branch> npm --prefix apps/api run test:parity` — the suite **mutates**; never point it at staging |
| Hardware | H1–H4 below | bench plan in Part B |
| Cloud dashboard | rate-limiter binding present in each env | Cloudflare console, read-only |
| Human | audit legibility, banner copy | review session |

## Part B — hardware attribution boundary

### B1. Evidence-strength hierarchy

Strongest to weakest, for **attribution** (not authorization):

1. **Autocharge / EVCCID** — binds the *vehicle*, and only a person if the
   vehicle is bound to one.
2. **Driver-specific virtual idTag** — binds the account that was issued it.
3. **App tap intent correlated to a transaction** — binds the session that armed
   it, within a time and station window.
4. **Physical RFID** — binds the *card*. A card can be lent, and frequently is.
5. **Installation technical token** — binds **nothing**. Authorizes only.
6. **No evidence** — `unknown`.

**A vehicle is not a person and a card is not a person.** Levels 1 and 4 are
attribution *hints* that become person-attribution only through an explicit,
revocable binding the user made.

### B2. Authorization decision matrix

| Presented | `enforceAuthorize` false | true |
| --- | --- | --- |
| Driver token, valid | Accepted (logged) | Accepted |
| Driver token, expired/blocked | Accepted (logged as Expired/Blocked) | **Rejected** |
| Technical token, valid | Accepted | Accepted |
| Unknown idTag | Accepted (logged Invalid) | **Rejected** |
| No idTag, free vend | Accepted locally | **`UNKNOWN` — see H1** |

`SOURCE-FACT` the false column is today's behaviour: the gateway "logs the
verdict but always replies Accepted" (`ocpp-authorize.ts:23-24`).

### B3. Attribution decision matrix

| Evidence | Attribution | Subject |
| --- | --- | --- |
| Driver token | `driver` | token owner |
| Physical card bound to a user | `driver` | binding owner |
| Physical card unbound | `installation` | none |
| Technical token only | `installation` | **none — never the minter** |
| Tap intent correlated | `driver` | intent owner |
| Autocharge, vehicle bound | `driver` | vehicle owner |
| Autocharge, vehicle unbound | `unknown` | none |
| Nothing | `unknown` | none |

### B4. Unknown and correction policy

`unknown` is a legitimate terminal state, not a defect to be cleaned up.
Upgrades (`unknown → driver`) require new evidence and record its basis.
Downgrades and re-assignments require an explicit correction event with an
actor and a reason; the original value is never overwritten in place.

**A session may be billed while `unknown`** — to the installation, not a person.
Inventing a person to satisfy a non-null column is the failure this whole
document exists to prevent.

### B5. Bench-test plan for every `[U]`

Nothing here is inferable from vendor naming, and none of it may be assumed.

| ID | Question | Method | Blocks |
| --- | --- | --- | --- |
| **H1** | Does the charger demand a non-empty idTag for free-vend `StartTransaction`? | free-vend config, start locally, capture the OCPP frame | B2 bottom row; A10 |
| **H2** | Can one technical token be presented concurrently on multiple EVSEs? | two EVSEs, same token, overlapping sessions | T-ATTR-2 |
| **H3** | Does `RemoteStartTransaction`'s idTag echo unchanged into `StartTransaction`/`TransactionEvent`? | RemoteStart with a marker idTag, capture both frames | tap correlation; T-ATTR-5 |
| **H4** | OCPP 1.6 vs 2.0.1 `idTagInfo` handling with `enforceAuthorize` true | one charger each version, present an expired token | staged rollout |

**Not to be assumed under any circumstances:** that EVCCID or EMAID appears in
signed meter data. `UNKNOWN` until a captured frame shows it. Signed meter data
is evidence of *energy*, and treating it as evidence of *identity* is precisely
the conflation this boundary exists to stop.
