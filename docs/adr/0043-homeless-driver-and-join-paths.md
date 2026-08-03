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

### D3 — A shared installation code is a *request*, never a grant

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
