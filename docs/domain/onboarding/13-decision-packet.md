# Decision workshop packet

Phase 11. Every unresolved choice in this packet, with a default recommendation
so the workshop is a review rather than a blank page.

**Two categories, deliberately separated.** Mixing them wastes a room full of
people answering questions a grep could settle.

---

## Part A — decisions only a human can make

### D-01. Is `invites/consume` used as a password reset? — **blocks a Critical**

**Recommendation: no. Refuse when a credential exists (WP S2).**
Alternatives: keep it (rejected — it is the Critical); keep it behind
re-authentication (defeats the purpose).
Reversibility: **total**, one conditional.
Cost of delay: the Critical stays open. Every unconsumed invite remains a
standing password-reset capability.
Security effect: closes ATO via invitation.
Unlocks: S2, T-SEC-2a/b/c.
*Answerable by source?* No. Nothing in the repo records intent.

### D-02. Verify kennitala, or stop asking for it?

**Recommendation: verify it against the invited user.** The app already collects
it and tells the user it is checked; the cheaper fix (delete the field) discards
a real identity signal already in hand.
Alternatives: remove from the app (cheap, loses assurance); make it optional
(worst — non-determinism).
Reversibility: high.
Cost of delay: every enrolment continues to create a false impression of
identity verification.
Unlocks: S1, M5, T-SEC-3a/b.

### D-03. Should revocation stop a charge in progress?

**Recommendation: no — take effect at the next authorization.**
Stopping a car mid-charge, at night, in a car park, is not obviously the safe
default, and the person affected may be an employee whose access lapsed for
administrative reasons.
Alternatives: stop immediately (safety risk, support load); stop only on
explicit emergency revocation (**strong runner-up**, worth discussing).
Reversibility: medium — changes user expectations once shipped.
*Answerable by source?* No. Safety and policy.

### D-04. What is a "supported client version"?

**Recommendation: define by users blocked, not versions outstanding.**
Without a definition, rollout stage 5 cannot be evaluated and the programme
stalls at stage 4 — which is the safe failure, but a stall nonetheless.
Cost of delay: `consume` can never be hardened, so D-01's fix is capped at
refusing overwrites and cannot reach identity binding.
Unlocks: rollout stages 5–7.

### D-05. Credential rotation grace period

**Recommendation: 14 days**, chosen so a printed sticker survives a normal
maintenance visit. Not evidence-based — a starting point.
Reversibility: total, per credential.

### D-06. Are one-time visitor grants needed at launch?

**Recommendation: no.** Reusable credential plus approval mode covers the
visitor case adequately for beta. Adding a third credential type before the
first is proven multiplies the abuse surface.
Reversibility: high — additive later.

### D-07. Retention periods for identity, access and audit

**Recommendation: legal input required; do not guess.**
Default until then: retain audit indefinitely, soft-delete identity.
*Answerable by source?* No — legal.

### D-08. Break-glass notification target

**Recommendation: notify the organisation's admins by email plus an in-app
banner**, not a log entry someone must go and read.
Cost of delay: break-glass exists without an audience, which is the same as not
existing.

### D-09. May staff complete `commercial`?

**Recommendation: no** (already the packet's position, doc 05 §4). An
organisation accepting pricing it never saw, recorded as accepted because staff
clicked, is the failure that survives into billing disputes.
Alternative worth discussing: **staff prepare, org accepts** — two actors, one
step. Likely the right long-term answer.

### D-10. Onboarding event log — reuse `audit.actions` or a new table?

**Recommendation: new table.** Workflow control-flow and audit have different
retention lifetimes and different readers.
Reversibility: **low** once written — this is the most expensive decision here
to reverse, and worth the most workshop time.

---

## Part B — questions answerable without a human

Do these **before** the workshop; several change the recommendations above.

| # | Question | Answerable by | Effort |
| --- | --- | --- | --- |
| Q-01 | Are any invites configured with a host-admin allow-term? (finding D's blast radius) | database read on staging | minutes |
| Q-02 | Are any org invite tokens currently outstanding, and for which accounts? (D-01's blast radius) | database read | minutes |
| Q-03 | Is any token minted with `maxRedemptions > 1`? | database read | minutes |
| Q-04 | Can existing `IdToken` rows be classified `driver` vs `installation_technical` from data alone? | database read + inspection | hours — **blocks A6 migration** |
| Q-05 | Are the rate-limiter bindings actually present in each deployed environment? | Cloudflare dashboard, read-only | minutes |
| Q-06 | Does any external client call the eleven no-in-repo-caller routes? | Worker request logs | hours |
| Q-07 | Do H1–H4 hold on the installed firmware? | bench, see [12](12-verification-and-hardware.md) §B5 | days |
| Q-08 | Does `src/app/invite/[token]/accept-form.tsx` still exist on any branch intended for release? | `git grep` across branches | minutes |

**Q-01, Q-02 and Q-04 are the highest-value.** Q-01 and Q-02 size two live
findings; Q-04 is a genuine blocker for the attribution work and the only one
that could change the migration plan.

None of these was run here: all require a database, a cloud dashboard or
hardware, all of which are outside this track's hard stops.

---

## Recommended workshop order

1. **D-01** — a Critical is open; decide first, ship the one-line fix same day.
2. **D-02** — cheap, user-visible, closes an assurance gap.
3. **D-04** — everything downstream in the rollout depends on it.
4. **D-10** — the least reversible decision in the packet.
5. **D-03, D-09** — policy, benefit from discussion.
6. **D-05 … D-08** — defaults are probably fine; confirm and move on.

Run Q-01, Q-02 and Q-05 beforehand. They take minutes and they turn D-01 from a
principle into a number.
