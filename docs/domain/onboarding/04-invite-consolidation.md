# Invitation and driver-creation consolidation

Phase 3. Additive migration to one join command, with a compatibility window.
Proposal only. No route is deleted here and none should be deleted on a flag day.

## 1. What exists, judged

From [01](01-current-path-inventory.md) §1, with a verdict per path.

| Path | Verdict |
| --- | --- |
| `POST /api/public/invites/consume` | **keep the route, fix the semantics.** The only path the app calls. Bearer-transferable and overwrites passwords. |
| `POST /api/driver/claim-invite` | **keep.** Correct: sets a credential on the bound user only, refuses if one exists, leaves the token unconsumed. |
| `POST /api/driver/redeem-invite` | **keep. This is the target shape.** Identity-bound, grants the group membership, audits rejections. |
| `POST /api/public/register` | **keep.** The only path that validates kennitala. |
| `POST /api/driver/access-requests` + `PATCH /api/admin/access-requests/:id` | **keep**, fold into the join command as the `approval_required` branch. |
| `POST /api/admin/orgs/:orgId/driver-group-memberships` | **keep**, admin-side direct grant. |
| `POST /api/admin/orgs/:orgId/invites` / `.../driver-invites` | **converge the mint side** onto one command with a `kind`. |

## 2. Target: one join command, four entry shapes

```
POST /api/driver/join
  { method: "invite",     token, ... }
  { method: "accessCode", code, passphrase }
  { method: "request",    installationRef, message? }
  { method: "orgInvite",  token, ... }
```

All four converge on one service with one set of invariants:

1. **Identity binding is mandatory.** The caller is an authenticated identity
   before any grant. No path grants to "whoever holds the token".
2. **A grant is always `DriverGroupMembership`**, attributed to a person, and to
   the credential or token that admitted them.
3. **Organisation administration is never granted by a driver join.** Only the
   org-invite path may create `Membership`, and only identity-bound.
4. **Credential creation never overwrites.** If the bound user has a password,
   the join requires authentication instead of setting one.
5. Every outcome writes an event with actor, target, credential used, and, on
   rejection, the reason — the shape `redeem-invite` already implements.

## 3. Fixing `consume` without breaking the app

This is the ordering problem, and it is the whole risk. From
[01](01-current-path-inventory.md) §5: the shipping app avoids the historical
deadlock **only because `consume` sets a password**. Harden that first and
drivers cannot onboard at all.

**[R] Sequence — each step independently shippable and reversible:**

**Step 1 — stop the silent discard (no behaviour change).**
Make `ConsumeBody` strict, or accept `kennitala` explicitly and verify it
against the invited user. Today it is stripped by a non-strict Zod object while
the app tells the user it is checked **[F]**. Either verify it or stop asking
for it; the current state is the only genuinely indefensible one.
*Gate:* none. Nothing depends on it being ignored.

**Step 2 — stop the overwrite.**
Change `userCredential.upsert(update:{passwordHash})` to refuse when a
credential exists, returning `409 already_claimed` exactly as
`claim-invite` does **[F]**. A first-time invitee is unaffected; only the
password-reset capability disappears.
*Gate:* confirm no flow relies on `consume` as a password reset. **[U]** —
needs a product answer, not a code search.

**Step 3 — add the identity-bound path to the app.**
Mobile moves to `claim-invite` → login → `redeem-invite`, or to the unified
`POST /api/driver/join`. Both already work; the RC's parity suite proves the
loop end to end **[F]**.
*Gate:* app release adoption — see §4.

**Step 4 — make `consume` identity-bound.**
Require an authenticated session and compare against the token's bound user,
as `redeem-invite` does. **This is the breaking step and must come last.**
*Gate:* adoption threshold from §4 met.

**Step 5 — converge the mint side** onto one command, then deprecate the
duplicate mint routes.

Steps 1 and 2 are strict security improvements with no client dependency and
can ship immediately. Steps 3–5 need the compatibility window.

## 4. Deprecation telemetry and removal gates

No route is removed until it is provably unused. **[F]** The repo already has
the mechanism: the generated endpoint doc reports in-repo callers, and eleven of
these routes already show none — but "no in-repo caller" is not "no caller",
because the console was archived and external clients are invisible to it.

**[R]** Add a structured deprecation counter at each legacy entry, emitting
route, client version if presented, and outcome — no personal data, no token
material. Then:

| Gate | Condition |
| --- | --- |
| G1 | new path live in production for ≥ 30 days |
| G2 | legacy path calls < 1% of total joins for 14 consecutive days |
| G3 | zero calls from any client version still supported |
| G4 | a documented runbook exists for anyone still on the old path |
| G5 | Andri approves removal explicitly |

All five, or the route stays. **Do not delete on a flag day** — the mobile app
ships through app stores, so an unknown tail of installs will call the old path
for months after the new one lands.

## 5. Placeholder users

**[F]** `host-invites.ts:175-183` find-or-creates the invitee as
`audience:"driver", status:"active"` with no credential.

**[I]** A passwordless `active` user is indistinguishable at a glance from a
real one, and it is created by the *inviter*, not the invitee — so an org admin
can populate the identity table with addresses that never respond.

**[R]** Keep find-or-create — it is what makes the token identity-bound at mint
time — but mark the row: `status: "invited"` until first successful
authentication, then `active`. That gives cleanup a safe predicate and stops
placeholder accounts inflating any user count. **[U]** Whether `status` already
carries meaning elsewhere that this would disturb.

## 6. What must not happen

- No flag-day deletion of `invites/consume`.
- No hardening of `consume` before the app has an alternative — that is the
  driver-onboarding deadlock, reintroduced deliberately.
- No merging of org-invite and driver-invite into one token kind. They confer
  different privileges; one token kind for both is how the current inversion
  happened.
- No new bearer-transferable path, for any reason.
