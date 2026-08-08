# ADR 0053 — Driver invites are identity-bound capabilities, not bearer tokens

**Status:** Accepted · **Date:** 2026-08-08
**Amends:** ADR 0028 (host↔driver invite loop) §4
**Does not touch:** ADR 0026 (org enrolment invites) — see §5, which exists
specifically to stop this decision being applied there by analogy.

> FOCUS.md rule 8 says write an ADR only when a decision is load-bearing *and*
> irreversible. This qualifies on both counts: it changes who an access grant
> can be issued to, and the invariant it establishes is one that later code
> will be read against.

---

## Context

`POST /api/driver/redeem-invite` granted a `DriverGroupMembership` to whoever
presented a valid, unexpired, unconsumed invite code. It never compared the
code to the person redeeming it.

This was found on 2026-08-08 while exercising the onboarding surfaces for the
N1 workflow exercise, and reproduced end to end: a code minted for one driver
was redeemed by a different authenticated driver, which returned `200`,
granted that driver the group membership, and **consumed the token** — leaving
the actual invitee with nothing and no way to retry.

### It had already happened once, unnoticed

The staging audit log retains the evidence, from two months before anyone
looked:

| time (2026-06-07) | action | actor | detail |
|---|---|---|---|
| 16:14:06 | `driver_invite.created` | `host@n1.is` | invitee `test-invite@n1.is`, token `44d10017…` |
| 16:14:20 | `driver_invite.redeemed` | **`driver@n1.is`** | `tokenId: 44d10017…` |

Same token, redeemed fourteen seconds later by someone other than the
invitee. `driver@n1.is` already held that membership (`added_at` 2026-05-09),
so the redemption granted nothing — and still burned the invite.

Nothing detected it, and nothing could have: the endpoint returns `200`, and
the audit row records *who redeemed* without recording that they were not the
invitee. A log that cannot express the anomaly cannot surface it.

### The implementation had drifted from ADR 0028 in two directions at once

ADR 0028 §4 specified redemption as an **identity-capturing** step: the
redeemer supplies email + password + kennitala, and the User is found-or-
created *at redemption*. The token pre-bound no one.

What shipped does the opposite at both ends:

- `createDriverInvite` **find-or-creates the invitee at mint time** and stores
  them in `user_tokens.user_id` (`NOT NULL`) — a binding ADR 0028 never asked
  for.
- `redeem-invite` **requires an already-authenticated driver** — an
  authentication step ADR 0028 never asked for either.
- Nothing compares the two.

The vulnerability lives exactly in that gap. Each half is defensible; together,
with no check between them, they produce a token that carries an identity that
nothing enforces. The route's own comment had rationalised it — *"the bearer is
the canonical identity"* — which is how it survived review.

---

## Decision

### 1. A driver invite grants access to the identity it was issued to, and to no one else

`redeem-invite` compares `user_tokens.user_id` against the authenticated
driver's `userId` and refuses on mismatch. The token is a capability **bound to
a principal**, not a bearer capability.

No schema change: `user_tokens.user_id` is already `NOT NULL` and already
populated at mint.

### 2. A rejected redemption must not consume the invite

The identity check runs **before** the conditional claim, so a mismatch leaves
`used_at` null and the real invitee can still redeem. This is the half that
actually cost the June invitee their invite — the mis-redemption granted
nothing yet still burned the token, because the claim ran unconditionally once
validation passed.

### 3. A mismatch is indistinguishable from an unknown code

A distinct `403 not_your_invite` would turn the endpoint into an oracle: any
authenticated driver could probe codes and learn which exist. The mismatch
returns the **byte-identical `404 not_found`** an unknown code returns.

The true reason is recorded server-side as a new audit action,
`driver_invite.redemption_rejected`, carrying both the bound and the attempting
user id — the record the June incident needed and did not have. Observability
moves to the audit log, where it is not also an attacker's tool.

### 4. The invitee is given a way to obtain the session the check now requires

Binding alone would have moved the flow from *wrong* to *impossible*:
`createDriverInvite` creates the invitee as a **passwordless placeholder** and
sends no email, so the bound user cannot log in, and cannot self-register
either — their own placeholder already owns the email address. Before this ADR
the only person who could complete a redemption was someone who was not
supposed to.

So `POST /api/driver/claim-invite` is added: token + password, unauthenticated,
which sets the credential **on the bound user only**, marks the email verified,
and leaves the token unconsumed so the now-authenticated invitee can redeem
normally.

It **refuses when the bound user already has a credential** (`409
already_claimed`). Without that, a leaked code would be account takeover of a
real driver rather than the bootstrap of a fresh placeholder. Existing drivers
never need it: they log in and redeem, and the binding check passes.

Claiming is possession-based, and that is deliberate and bounded — it is the
only way to bootstrap an account that has no credential yet, it is the same
trust model ADR 0026 already uses for org invites, and it can only ever act on
a credential-less placeholder.

---

## 5. This does NOT apply to org invites — do not "fix" them too

There are two invite systems. They look alike and are not.

| | **driver invite** (this ADR) | **org invite** (ADR 0026 / 0017) |
|---|---|---|
| kind | `user_tokens.kind='driver'` | `user_tokens.kind='invite'` |
| endpoint | `POST /api/driver/redeem-invite` | `POST /api/public/invites/consume` |
| grants | `DriverGroupMembership` — access to charge | `Membership` — org role, plus sets a password |
| auth | **authenticated + identity-bound** | **bearer by design** |
| clients | `src/app/driver/redeem/page.tsx` | Flutter app + `src/app/invite/[token]` |

The org invite is bearer **on purpose**: consuming it *establishes* the
account, so possession has to be sufficient — there is no prior identity to
bind to. Its client says so outright: *"No bearer auth — possession of the
invite token is the credential (ADR 0026 §3/§5)."*

`POST /api/public/invites/consume` is untouched by this change, and a
regression test asserts that. If a future reader finds the two paths
inconsistent, the inconsistency is the decision, not an oversight.

---

## Consequences

### Enabled
- An invite can no longer be redeemed by anyone but its recipient, and a
  failed attempt no longer destroys it.
- The invited driver can complete the loop for the first time — previously
  nobody legitimate could.
- `driver_invite.redemption_rejected` makes the failure mode visible in the
  audit log instead of silent behind a `200`.

### Costs / risks
- **Two-step onboarding** for a new driver: claim, then redeem. The
  alternative was a redemption that establishes identity (ADR 0028 §4 as
  written), which keeps the grant flowing to whoever completes it — a leaked
  code would still reach a stranger. The extra step buys the stronger
  invariant.
- **Typo'd invite email is now a dead end** rather than something a
  bystander can absorb: the placeholder is bound to the wrong address and
  the intended person can never redeem. Correct behaviour, worse ergonomics —
  the host must revoke and re-invite. There is no revoke surface today; noted,
  not built.
- `security='password_key'` / `'allow_term'` (ADR 0028 §3) remain
  unimplemented and still return `security_unsupported`. This ADR does not
  change that.

### Not addressed here, deliberately
- **Invited drivers still receive no `virtual_rfid`.** `createDriverInvite`
  mints no idToken at all, so a driver enrolled this way still cannot present
  an idTag at a charge point. That is the `createDriver` un-park (FOCUS.md
  parked list) and is tracked separately at lower severity — it degrades
  attribution; it does not let one driver take another's access.
- **No invite revocation surface.** Named above as a cost.

### Migration
**None.** There are zero live `kind='driver'` tokens in any environment —
staging and test are empty, and `identity.user_tokens` does not exist in
production at all. This was free to fix at the moment it was found, and would
not have been once real invites were outstanding.
