# Adversarial security analysis

Phase 2. Twelve abuse cases against the current implementation, each with a
source-to-sink trace. Severity assumes **staging is beta with real chargers and
real people**, which is the accepted product position — not a sandbox.

## Severity model and vocabulary

Severity = impact × reachability. Reachability is weighted heavily: a
theoretical flaw behind three unimplemented features is not equal to one behind
a link in an email.

Four distinct outcomes, deliberately not conflated:

- **Credential stuffing** — reusing leaked passwords. Not specific to us.
- **Account takeover (ATO)** — controlling an existing identity.
- **Membership escalation** — gaining tenancy or privilege the identity should
  not have.
- **Attribution corruption** — a session, cost or action recorded against the
  wrong person. Uniquely damaging because it is *believed* afterwards.

| # | Abuse case | Class | Severity |
| --- | --- | --- | --- |
| 2 | Existing-account password overwrite | **ATO** | **Critical** |
| 1 | Stolen organisation invitation | Membership escalation | **High** |
| 9 | Shared technical token attributed to a driver | Attribution corruption | **High** |
| 8 | Audit actor laundering | Attribution corruption | **High** |
| 3 | Kennitala supplied but discarded | Assurance failure | Medium-High |
| 12 | Stale mobile during contract migration | Availability | Medium-High |
| 5 | Cross-tenant invitation confusion | Membership escalation | Medium |
| 6 | Code/passphrase guessing | Membership escalation | Medium |
| 7 | Support-context escalation | Membership escalation | Medium |
| 4 | Invitation replay / race | Membership escalation | Low-Medium |
| 11 | Concurrent approval of one request | Integrity | Low-Medium |
| 10 | Revoked access during active charge | Safety/billing | Low |

## 2. Existing-account password overwrite — **Critical**

**Assets.** Any account that has been invited to an organisation: its password,
its session, everything the identity can reach.

**Prerequisites.** Possession of one unconsumed org invite token. No account, no
session, no network position, no prior compromise.

**Trace.** `invites.ts:86` accepts `{token, password}` → `:100-132` resolves and
claims the token by hash, checking only `kind`, `usedAt`, `expiresAt` → `:142`
`userCredential.upsert({ where:{userId: row.userId}, update:{ passwordHash } })`
→ `:149` membership → `active` → `:156` `emailVerifiedAt` set.

The upsert has **no branch on whether a credential already exists**. The bearer
chooses the new password. The audit row at `:165` records the action as
`membership.invite_accepted` with the *invitee* as actor.

**Impact.** Full ATO of the invited identity, plus organisation membership,
plus an audit trail naming the victim as the person who did it. If that identity
is an org admin, the tenant follows.

**Why Critical and not High.** It requires no skill, leaves misleading evidence,
and invite links travel through email, chat and screenshots by design.

**Detection.** Today: none specific. `membership.invite_accepted` looks identical
whether the real invitee or a bearer performed it. Proposed: alert when a
consume sets a credential on a user that already had one, and when
`emailVerifiedAt` moves for an already-verified user.

**Prevention.** WP **S2** — refuse with `409 already_claimed` when a credential
exists, exactly as `driver.ts:1090` already does.

**Compatibility risk.** Low. First-time invitees are unaffected. **[U]** whether
anything uses consume as a password reset — a product question, not a code
search.

**Rollback.** One conditional; revert is one line.

**Tests.** T-SEC-2a (existing credential → 409, hash unchanged), T-SEC-2b
(no credential → 200), T-SEC-2c (audit records the refusal).

## 1. Stolen organisation invitation — **High**

**Prerequisites.** The invite link. That is all — `invites.ts:4-6` states
possession is the only authorisation.

**Trace.** As above, minus the overwrite: the bearer sets a password on a
placeholder identity and becomes an `active` `Membership` of the organisation.

**Impact.** Membership escalation into a tenant, under someone else's name.
Note the inversion: the **bearer** path grants *organisation* membership while
the **identity-bound** path (`redeem-invite`) grants the lesser driver-group
membership.

**Prevention.** WP **A1**/**S-consume-bind**: require an authenticated session
and compare to the bound user, as `redeem-invite` does. Sequencing is critical —
see [11](11-rollout-programme.md); hardening before clients move recreates the
deadlock.

**Tests.** T-SEC-1a (bearer without session → 401), T-SEC-1b (wrong identity →
generic not_found + audit), T-SEC-1c (bound identity → 200).

## 3. Kennitala supplied but discarded — Medium-High

**Prerequisites.** None. This is the default path for every mobile invite today.

**Trace.** `client.dart:97-107` sends it → non-strict `ConsumeBody`
(`invites.ts:36-39`) strips it → handler never sees it. `client.dart:135`
tells the user to "Check the code, kennitala and password".
`client_contract_test.dart:136` asserts the client "serializes identity".

**Impact.** Not a direct compromise — an **assurance failure**. Everyone
downstream (support, ops, a court, an auditor) may reasonably believe a national
ID was verified at enrolment. It was not. The screenshot of the form is evidence
of a check that never happened.

**Prevention.** WP **S1**: verify it against the invited user, or stop asking.
Both are defensible; the current state is not.

**Tests.** T-SEC-3a (unknown field rejected or verified — not silently dropped),
T-SEC-3b (contract test renamed and asserting real server behaviour).

## 9. Shared technical token attributed to a driver — **High**

**Prerequisites.** An installation-level technical token that resolves to a
`userId` — e.g. minted by, or linked to, a person.

**Trace.** `ocpp-authorize.ts:17-21` returns `{verdict, userId?, …}` and
"`userId` is set only when `verdict === "Accepted"`". Nothing in the contract
distinguishes *why* a token was accepted. A shared token that resolves to a user
therefore attributes **every session on that installation** to that person.

**Impact.** Attribution corruption at scale, and it is believed downstream —
billing, usage reports, disputes. Unlike ATO this leaves no trace of being
wrong.

**Prevention.** WP **T2** (`IdToken.tokenClass`) + **A10**: a class-3 token
returns `Accepted` with `userId: null` and `attribution: "installation"`.
Enforce in the resolver, assert in a test.

**Tests.** T-ATTR-9a (technical token → `userId` null), T-ATTR-9b (concurrent
sessions on one technical token attribute to none), T-ATTR-9c (driver token
still attributes).

## 8. Audit actor laundering — **High**

**Prerequisites.** Any path that writes an audit row with an actor the acting
party controls.

**Trace.** Two live instances. (a) `invites.ts:165` records
`membership.invite_accepted` with the invitee as actor, though a bearer may have
acted — abuse case 1/2 launders through it. (b) Staff assistance today has no
`onBehalfOf` field, so an action taken by staff inside a tenant is recorded as
*someone*, and the design question is whose.

**Impact.** The audit log — the artefact relied on to answer "who did this" —
gives a confidently wrong answer. Worse than no log.

**Prevention.** `actorUserId` must always be the authenticated principal;
`onBehalfOfOrgId` carries the tenant; where the bearer is not provably the
invitee, record `actorKind: "bearer"` rather than naming the invitee.

**Tests.** T-AUD-8a (bearer consume does not name the invitee as actor),
T-AUD-8b (staff action names the staff member), T-AUD-8c (no path can set actor
from request input).

## 4. Invitation replay and races — Low-Medium

**Trace.** `redeem-invite` already does a conditional claim —
`updateMany({where:{id, usedAt: null}})` and treats `count === 0` as
`already_used` (`driver.ts:1254-1260`). `consume` uses the same pattern
(`invites.ts:130-132`). Both are correct compare-and-set.

**Residual.** `maxRedemptions` exists in the invite model (`host-invites.ts:195`)
but only `security: 'none'` is implemented; multi-use semantics are unproven.
**[U]** whether any token is minted with `maxRedemptions > 1`.

**Tests.** T-RACE-4a (two concurrent redeems → exactly one grant), T-RACE-4b
(replay after success → 410).

## 5. Cross-tenant invitation confusion — Medium

**Trace.** The token carries `metadata.orgId` (`invites.ts:69` guards
`malformed_metadata`). A token whose metadata names org A while the membership
row names org B would grant against the wrong tenant.

**Prevention.** Derive the org from the membership row, never from
client-visible metadata; assert they agree and fail closed if not.

**Tests.** T-TEN-5a (metadata/membership mismatch → refuse), T-TEN-5b (no route
accepts an orgId from the request body when a token implies one).

## 6. Code/passphrase guessing and enumeration — Medium

Not yet implemented; the design in [03](03-unaffiliated-and-access-code.md) §3
addresses it. **The live risk is `rate-limit.ts:23-25,116`, which fails OPEN
with a warn when the binding is absent.** For login that is a deliberate
availability trade-off. For a join endpoint it means an unconfigured
environment silently offers unlimited guessing.

**Prevention.** WP **S3** — fail closed on join only.

**Tests.** T-ABUSE-6a (limiter absent → join refuses), T-ABUSE-6b (all failure
reasons identical), T-ABUSE-6c (per-code limit tighter than per-IP).

## 7. Support-context privilege escalation — Medium

**Trace.** `permissions.ts:26-28` gives `super_user` the platform set as a
literal list, not a wildcard — deliberately. The escalation risk is *reusing*
`platform.tenant.write` as the support gate, which would make every existing
super-user a support agent retroactively, and composing the ADR 0034 contractor
mapping into platform permissions.

**Prevention.** WP **S6** (new `platform.support.enter`) and **S4** (a test
asserting tenant roles never compose into platform verbs).

**Tests.** T-AUTH-7a (existing super_user cannot enter support without the new
verb), T-AUTH-7b (context bound to one org), T-AUTH-7c (expiry enforced
server-side per request).

## 10. Revoked access during an active charge — Low

Revocation takes effect at the next authorization decision; a session in
progress continues. **[U]** whether it should stop — stopping a car mid-charge
at night is not obviously the safe default. Flagged as a **product and safety
decision**, deliberately not resolved here.

## 11. Concurrent approval of one access request — Low-Medium

Two admins approve simultaneously → two grants, or one grant and one error.
**Prevention.** Unique `(driverGroupId, userId)` — which
`DriverGroupMembership` already has as a compound key **[F]** — plus a
compare-and-set on request status. **Tests.** T-RACE-11a, T-RACE-11b.

## 12. Stale mobile during contract migration — Medium-High

**This is the abuse case with no attacker**, and historically the most damaging.

**Trace.** The app ships through app stores; an unknown tail of installs calls
the old path for months. `claim-invite` has never had a client
([08](08-evidence-ledger.md) §4), so "the new path exists" is not evidence anyone
uses it. Harden `consume` first and every un-updated install loses onboarding —
the N1 deadlock, recreated deliberately.

**Prevention.** The staged programme in [11](11-rollout-programme.md): measure,
detect capability, add the new path, dual-contract window, adoption gate, only
then harden, only then retire.

**Tests.** T-COMPAT-12a (old client + new server), T-COMPAT-12b (new client +
old server), T-COMPAT-12c (adoption gate blocks hardening below threshold).
