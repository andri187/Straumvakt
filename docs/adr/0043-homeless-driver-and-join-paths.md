# ADR 0043 — The homeless driver, and how a driver joins an installation

**Status:** Proposed — 2026-08-03.
**Relates to:** [ADR 0020](./0020-driver-access-via-driver-groups.md),
[ADR 0022](./0022-driver-self-onboarding.md),
[ADR 0028](./0028-driver-invite-mechanism.md),
[ADR 0031](./0031-cost-model-and-money-flow.md),
[ADR 0042](./0042-real-driver-identity-and-tap-attribution.md).

---

## Context

ADR 0042 established that there is effectively one driver identity and
all 46 sessions resolve to it. The question that follows is how real
drivers get in — and specifically whether an app self-signup can become
a Straumvakt user at all.

**It already can.** The backend bridge exists and is tested:

| Piece | State |
|---|---|
| `POST /api/public/register` (ENROLL-1) | built |
| `repositories/registration.ts` → `registerDriver` | built |
| `repositories/driver-access-requests.ts` (ENROLL-2) | built |
| Access-request emails — submitted / inbound / approved / denied | all four built |
| Email verification | built |
| ADR 0022 self-onboarding R1 path (`routes/public/driver.ts:843`) | built |
| **Mobile app calling any of it** | **not built** |

So this ADR does not design a bridge. It names the state that bridge
produces, and pins the ways out of it — because the state is currently
unnamed, and an unnamed state is one nobody codes defensively against.

---

## Decision

### D1 — "Homeless" is a first-class, expected state

A driver who self-enrols exists as `identity.users` with
`audience='driver'` and a credential, and **zero `DriverGroupMembership`
rows**. They can log in. They can see the app. They can charge nowhere.

This is already representable — membership is the access grant, and
zero memberships is the natural encoding. What is missing is that
nothing *treats* it as a state:

- the app has no empty-state that explains it or offers a way out
- nothing distinguishes "new, not yet joined" from "removed from every
  group" — operationally very different, identical in the data
- ADR 0031's billing has no bearer for such a user, which is correct
  (they cannot charge) but is nowhere stated

**Homeless is the default landing state for every self-enrolled driver,
not an error.** The app's job is to make it obviously temporary.

### D2 — Four ways out, in ascending trust

| Path | Who initiates | Trust basis |
|---|---|---|
| **Operator/host adds manually** | host | out-of-band; host already knows the person |
| **Invite redemption** — code, QR, or email link | host | possession of a single-use secret (ADR 0028) |
| **Installation code + password** | driver | possession of a shared secret the host distributes |
| **Access request** | driver | host approves from the inbox (ENROLL-2) |

The first two are host-push and already designed. The last two are
driver-pull and are what "self-enrol then join" actually needs.

### D3 — Whether a code grants or requests is the CPO's choice

> **Amended 2026-08-03**, before acceptance. The original D3 forbade a
> shared code from granting access outright. The operator's objection:
> *"the user needs to provide information to be invoiced anyway, I don't
> see the harm if the CPO wants the id for access to be just installation
> code without pass or permission."*
>
> That is correct and the original was wrong on ownership.
> [ADR 0031 §1](./0031-cost-model-and-money-flow.md) makes the **host the
> principal** — they sell the electricity and they carry the cost. A
> blanket ban made a risk decision on behalf of the party who bears the
> risk. An MDU with forty apartments where every resident needs manual
> approval is a support burden that makes the product worse, and a
> free-vend host has no reason to care who charges at all.
>
> The design is therefore **configurable per installation**, with a safe
> default rather than a prohibition:

```
Installation.codeJoinPolicy : request | grant     (default: request)
```

- `request` — presenting a valid code opens a pre-filled access request
  naming that installation. Host approves. *Default.*
- `grant` — presenting a valid code creates the membership directly.
  The CPO has decided the convenience is worth the exposure.

Two things stay non-negotiable, because they are what make `grant`
recoverable rather than permanent:

1. **Codes must be rotatable**, and rotation must not require touching
   existing members. A leaked code cannot be un-leaked; the only remedy
   is a new one.
2. **Memberships must record how they were created.** A membership
   granted by code is revocable as a class — "remove everyone who joined
   via the old code" has to be one operation, not an audit.

Without those two, `grant` is a door with no lock rather than a door
with a key the host chose to hand out.

QR remains an *encoding* of the code, not a separate trust level. It
inherits whatever `codeJoinPolicy` the installation sets.

### D3b — The intent is eID-only. The shipped endpoint is not.

> **Corrected 2026-08-03.** The operator: *"user is never asked to insert
> kennitala, it is only fetched via IS eID via mobile number."* That is
> the design, and every ADR that touches it agrees — 0005, 0006, 0022,
> 0026 and 0031 all assume Auðkenni / rafræn skilríki as the identity
> source. The original wording below called this a design weakness. It
> is not. It is an **unimplemented design**, which is a different problem
> with a different fix.

Verified 2026-08-03: eID appears in those five ADRs and **in no
implementation file** — nothing under `apps/` or `src/` references
Auðkenni, island.is or rafræn skilríki. Meanwhile
`routes/public/register.ts:45` accepts:

```ts
kennitala: z.string().regex(/^\d{10}$/, "kennitala_must_be_10_digits")
```

Ten digits from the request body. Format-checked, never verified.

**The consequence is not about the app.** If the Flutter client only ever
populates that field from an eID response, the client is behaving
correctly — but `POST /api/public/register` is a **public endpoint**, and
the client's behaviour does not constrain it. Anyone can post ten digits
directly. The identity guarantee lives in the app, where it cannot be
enforced, rather than in the API, where it can.

So the fix is not "add eID" — the design already says eID. The fix is
that the endpoint must **stop accepting a kennitala as input at all**,
and instead derive it from a completed eID assertion. Until it does,
D3c's `eid_verified` assurance level cannot be trusted for accounts
created through the public path, because the stored kennitala may never
have been attested.

*Original wording, retained because the risk it describes is real for as
long as the endpoint is unchanged:*

The argument for `grant` rests on the driver being identified and
therefore billable. **Kennitala is currently self-asserted**:
`repositories/registration.ts` checks only that it is not already taken
(`kennitala_taken`), with no verification against Þjóðskrá, Auðkenni or
island.is.

So a registrant can enter any unused kennitala, and the resulting invoice
goes through the Icelandic e-bill flow to whoever really owns it. That is
worse than non-payment — it is mis-invoicing a stranger.

**This is not an argument against `grant`.** The same self-asserted
kennitala backs invite redemption and every other path equally; the
weakness is in registration, not in how someone joins. It is recorded
here because it is the actual load-bearing assumption behind "they are
billable anyway," and it does not currently hold. Verified identity is a
separate piece of work and should not gate this one.

### D3c — Identity assurance is required at *join* time, per installation

**Operator, 2026-08-03:** *"if the installation requires it, the user must
either sign in by Icelandic electric ID, or harden the account with eID
sign in upon adding the installation."*

This is the answer to D3b, and it is better than verifying at
registration. Verification is a property of **what you are joining**, not
of signing up:

```
Installation.identityAssurance : self_asserted | eid_verified
User.assuranceLevel            : self_asserted | eid_verified
```

- Signup stays frictionless. A homeless self-enrolled user with a
  self-asserted kennitala is harmless — they cannot charge anywhere.
- The moment they attempt to join an installation set to
  `eid_verified`, they must complete **rafræn skilríki / Auðkenni**
  sign-in — either as their original login method, or as a **step-up on
  the existing account** at join time.
- Hardening is permanent and account-wide. Verify once; every later join
  is already satisfied.

This also puts the cost on the party that wants the assurance. A
free-vend host absorbing energy has no reason to demand eID; an MDU
billing forty apartments individually very much does. Same shape as
`codeJoinPolicy` — the CPO chooses.

**Why this genuinely closes D3b:** Icelandic eID does not merely prove
*a* person is present, it returns the **verified kennitala**. That is
exactly the field `registration.ts` currently accepts on trust, so a
successful hardening replaces an assertion with an attestation.

#### The edge case that must not be silent

If the eID-verified kennitala **differs** from the self-asserted one
already on the account, that is not a correction to apply quietly. It
means either a typo or someone who registered under a kennitala that is
not theirs — and the account may already carry sessions, invoices and a
ledger history billed to the asserted identity.

Changing the billing identity of an account with financial history is a
Rule 5 event. The mismatch must **block the join and surface to an
operator**, never auto-resolve. ADR 0031 makes the invoice a real claim
against a real kennitala; silently repointing it is the one outcome
worse than refusing the join.

#### Interaction with kennitala-less dependents

[ADR 0031 §18](./0031-cost-model-and-money-flow.md) permits a user
without their own kennitala where they are bound to a group whose owner
has one — the HOA teenager case. Such a user **cannot** complete eID.

So an installation set to `eid_verified` cannot admit dependents
directly. The group **owner** verifies and joins; dependents inherit
access through the group and are never independently asserted. That is
consistent — §18 already routes their billing to the owner — but it must
be explicit, or the first HOA with a teenager hits a wall nobody
predicted.

### D3-original — A shared installation code is a *request*, never a grant *(superseded, retained for the reasoning)*

An installation identity code plus password — printed in a stairwell,
on a charger, in a building handbook — is a **shared** secret. Shared
secrets leak by construction: a resident photographs it, a contractor
keeps it, an ex-tenant never forgets it.

So presenting a valid installation code **creates an access request
naming that installation**, pre-filled and low-friction. It does not
create a membership. The host still approves.

This is the difference between a code that is convenient and a code that
is a liability. A single-use invite (ADR 0028) may grant directly
because possession is meaningfully scoped; a stairwell poster may not.

QR is an encoding of the same code, not a separate trust level. QR alone
= request. QR + password = request with the password step already
satisfied. Neither grants.

### D4 — The access request carries the installation, not just the org

ENROLL-2 exists but a request must name **which installation** the
driver wants, so a host with several sites approves into the right
DriverGroup rather than choosing from memory. Where a code was
presented, that resolves the installation automatically — which is the
main reason the code path is worth building over a free-text request.

### D5 — Joining is not the same as being billable

A membership grants access. ADR 0031 resolves the *bearer* separately —
the driver, their group owner, or a sponsoring workplace. A driver may
therefore be joined and chargeable while somebody else pays, and that
must not be inferred from the join path they used.

Specifically: approving an access request must not silently make the
requester the payer. Bearer comes from the agreement, always.

---

## Consequences

**Positive.** Self-enrolment stops being a dead end. The four paths cover
host-push and driver-pull without inventing a mechanism — three of the
four already have backend support. Naming the homeless state gives the
app something concrete to design an empty-state around.

**Negative.** Every driver-pull path terminates in a host approving
something, which is a human in the loop and a place requests pile up.
The access-request inbox becomes an operational surface that needs to be
watched, not just built.

**Security.** D3 is the load-bearing decision. Treating a shared code as
a grant would let anyone who has ever seen a stairwell poster charge on
the host's account — and under ADR 0031 the host, not Straumvakt, carries
that cost.

**Sequencing.** The backend is largely built; the gap is the app. This
depends on nothing in P4 and can proceed in parallel. ADR 0042's
per-driver identity work is what makes any of it observable — until then
every joined driver still resolves to the same row.
