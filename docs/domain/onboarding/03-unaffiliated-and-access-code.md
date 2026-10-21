# Unaffiliated identity and the join contract

Phase 2. Server-visible identity states, what each may see, and the access
code + passphrase design. Proposal only.

## 1. Identity states

Guest is local-only and has no server representation at all — that is the point
of it. Everything below is a server state.

| State | Server record | Sessions | May see |
| --- | --- | --- | --- |
| No account | none | none | public marketing only |
| Registered / unaffiliated | `User`, no `Membership`, no `DriverGroupMembership` | yes | own profile only |
| Pending invitation | + unconsumed `UserToken` | yes | the invite's org **display name** only |
| Pending access request | + `AccessRequest(status=pending)` | yes | own request status |
| Active driver access | + `DriverGroupMembership` | yes | chargers in that group, own sessions |
| Suspended / revoked | membership row `revoked` or absent | yes | own history, no live chargers |
| Org member / admin | + `Membership(status=active)` | yes | org scope per permission bundle |

**Registered/unaffiliated is a full identity with zero tenancy.** It has no
membership, no access, no billing relationship. It exists so a driver can hold
an account, a vehicle profile and a session history before any organisation
knows about them — which is exactly what ADR 0043 anticipated.

## 2. What `/me` may reveal

The rule: **before a grant exists, no organisation-private data.**

| State | `/me` may include | `/me` must NOT include |
| --- | --- | --- |
| Unaffiliated | userId, email, displayName, `persona: "none"`, `orgs: []` | any org id, name, charger, site or installation |
| Pending invitation | + inviting org **display name**, expiry | orgId, charger inventory, other invitees, member list |
| Pending access request | + target installation display name, status | charger list, pricing, other requests, requester count |
| Active access | + driver groups, chargers in scope | orgs or installations outside scope |

**[F]** Today `/api/admin/me` returns `persona` plus an `orgs[]` array of
`{orgId, displayName, kind, role}` — the web `org-context.ts` depends on that
shape. The unaffiliated case is `persona: "none"` with an empty array, which
already satisfies the rule. No change needed for state 1; the leak risk is in
states 2 and 3, which do not have a `/me` representation yet.

**[R]** Add a dedicated `GET /api/driver/join-state` rather than widening
`/me`. Reason: `/me` is consumed by the console's persona routing **[F]**;
adding invitation/request context there couples driver join flow to operator
console routing and makes the leak surface harder to reason about.

## 3. Access code and passphrase

The product ask: an unaffiliated driver enters or scans an installation access
code plus a passphrase, and joins.

### Shape

- **Code** — public, printable, on a sticker or QR. Identifies the installation
  or driver group. Non-secret by design: assume it is photographed.
  Format: 8 characters, Crockford base32 (no I/L/O/U), grouped `XXXX-XXXX`,
  with the last character a check digit so typos fail locally before hitting the
  server.
- **Passphrase** — the secret. Never derived from the code. Minimum 12
  characters or four diceware words. Stored as PBKDF2 with a per-credential
  salt, using the same helper as `hashPassword` **[F]** — never plaintext, never
  reversible, never shown again after creation.

**Lookup must not be a two-step oracle.** Code and passphrase are verified in a
single call with one generic failure, so an attacker cannot enumerate valid
codes by observing which ones return "wrong passphrase" versus "unknown code".
This mirrors the existing login handler, which deliberately equalises CPU on
miss with a dummy hash and returns one generic `auth_failed` for
no-user/no-password/wrong-password **[F]** (`driver.ts:143-152`).

### Credential record

```
InstallationAccessCredential
  id, orgId, installationId, driverGroupId
  code                      -- unique, indexed, non-secret
  passphraseHash, salt
  policyMode                -- automatic | approval_required | invite_only | closed
  maxUses?, usedCount
  validFrom, expiresAt?
  rotatedFromId?            -- rotation chain
  revokedAt?, revokedReason?
  createdByUserId, onBehalfOfOrgId
```

### Rotation and revocation

- Rotation mints a new row and sets `expiresAt` on the old one to now + grace.
  Both are valid during the grace window so a printed sticker does not brick on
  the hour it is replaced. **[U]** Grace length is a product decision; 14 days
  is a starting point, not a recommendation.
- Revocation is immediate, requires a reason, and does **not** revoke grants
  already made through it. Membership survives credential death — otherwise
  rotating a sticker would eject every driver who ever used it.
- Emergency revocation: one call kills every credential for an installation and
  writes one event per killed credential. Existing sessions are unaffected; see
  §6.

### Rate limiting and enumeration resistance

- Per-IP and per-code attempt limits, with the per-code limit the tighter of the
  two so a distributed attack on one code is still bounded.
- One generic failure for unknown code, wrong passphrase, expired, revoked and
  exhausted.
- **[F]** The infrastructure exists: `ADMIN_LOGIN_RATE_LIMITER` and
  `DRIVER_LOGIN_RATE_LIMITER` are already bound in `apps/api/wrangler.jsonc`, and
  `rate-limit.ts` fails **open** with a warning when the binding is absent.
  **[R]** For join, fail **closed** — an unbound limiter must reject, not admit.
  A rate limiter that disappears in an environment where it was never configured
  is exactly how enumeration protection is lost silently.

## 4. Policy modes

| Mode | Correct code + passphrase yields |
| --- | --- |
| `automatic` | immediate `DriverGroupMembership` |
| `approval_required` | `AccessRequest(pending)`; no access until approved |
| `invite_only` | generic failure — code path disabled, invitations only |
| `closed` | generic failure |

`invite_only` and `closed` return the **same** generic failure as a wrong
passphrase, so policy state is not probeable.

**Mid-request policy change** is the interesting case. If an org switches
`automatic → approval_required` while a request is in flight, the request is
evaluated against the policy **at the moment of evaluation**, not submission,
and the requester sees "pending" rather than an error. Switching to `closed`
with requests outstanding leaves them pending, not auto-rejected — an
organisation closing its doors should not silently deny people it may still want
to admit, and auto-rejection destroys the record of who asked.

## 5. Reusable credential vs one-time grant vs invitation

| | Reusable code+passphrase | One-time grant | Invitation token |
| --- | --- | --- | --- |
| Fits "scan the sticker" | **yes** | no | no |
| Identity-bound | no | no | **yes** (ADR 0053) |
| Revocable per person | no | n/a | yes |
| Survives staff turnover | yes — that is the risk | n/a | n/a |
| Enumerable | mitigated by §3 | n/a | no |

**[R] Recommend all three, with distinct jobs, and never let the shared one
become tenant membership:**

- **Code + passphrase** grants `DriverGroupMembership` and nothing else. It must
  never grant `Membership` (organisation administration), and never survive its
  own revocation as an unaudited capability.
- Every join through a shared credential records *which credential* was used, so
  a rotation can enumerate exactly who entered through the compromised one. This
  is the property that makes a shared secret acceptable: it is shared for
  *entry*, but the resulting grant is per-person, per-membership and
  individually revocable.
- **Invitation** stays the identity-bound path for named people.
- **One-time grant** is the visitor case — **[U]** whether it is needed at
  launch is a product decision.

This directly answers the brief's constraint: a shared passphrase must not turn
into permanent unaudited tenant membership. It does not, because it grants a
*driver group* membership that is attributed to a person and to the credential
that admitted them.

## 6. Suspension, revocation and live sessions

- Revoking access does **not** stop a charging session in progress. **[U]**
  Whether it should is a product and safety decision — stopping a car mid-charge
  in a car park at night is not obviously the safe default.
- Revocation takes effect at the next authorization decision.
- The audit event records actor, target person, credential used, and reason.
