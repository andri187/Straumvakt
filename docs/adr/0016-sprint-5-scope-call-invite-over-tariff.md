# ADR 0016 — Sprint 5 Scope Call: Invite Flow over Commercial Model

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Historical — a past sprint-scope decision, not a proposal awaiting approval. Reclassified 2026-08-04; the sprints it governs are long finished. Kept for the reasoning, not as an open question.
**Date:** 2026-05-03
**Sprint:** Records the Sprint 5 scope call before code lands.
**Supersedes (in part):** Sprint 5 milestones 5.1–5.5 in [STRAUMVAKT_V3_DELIVERY_PLAN.md §8](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md) (Commercial Model). Those milestones move to Sprint 6.
**Relates to:** [ADR 0014](./0014-identity-tenancy-and-authorization.md) §"Sprint 5 (invite + driver self-registration)" build-order section, [ADR 0015](./0015-sprint-3-scope-swap-ocpi-to-identity.md) (precedent for delivery-plan vs ADR-0014 scope reconciliation).

## Context

Two competing schedules name "Sprint 5":

- **Delivery plan §8 — Commercial Model (ISK only).** Pre-pilot. Tariff
  engine pure function, `CustomerPlan` + `ChargerServicePlan` schemas,
  plan-selection priority resolver. Pilot-critical for billing math
  (without it, the operator can't see what would be invoiced).

- **ADR 0014 §"Build order" → Sprint 5 — Invite flow + driver
  self-registration + impersonation.** Pre-pilot. Closes the
  permissions-foundation loop that Sprint 4 just opened: real
  multi-user sessions land here, `requirePermission` flips from
  bootstrap god-mode to per-user checks, the ~30 sub-resource routes
  Sprint 4.4 left bare get their `assertPermission` retrofits.

Both fit "pre-pilot." Both are pilot-critical. Both fit a sprint.
Sprint 5 can only host one of them.

## Decision

Sprint 5 = **Invite Flow + Driver Self-Registration + Impersonation**
per ADR 0014's build order. Commercial Model slips to **Sprint 6**.
Subsequent sprints cascade by one slot.

## Why invite flow over tariff

### 1. Sprint 4 set up the runway; Sprint 5 should land on it.

Sprint 4 shipped the schema (`Membership`, `PlatformGrant`, lifecycle
fields, scope arrays) AND the permissions middleware. Without real
multi-user sessions:
- The middleware's bootstrap god-mode is the ONLY active code path.
- The ~30 sub-resource routes migrated to bare `requirePermission(verb)`
  in 4.4 are documenting the verb but not actually gating.
- Customer admins still cannot self-administer their teams.

If Sprint 5 ships tariff engine instead, all that infrastructure sits
unused for another sprint. The longer it sits, the more chance of
silent drift between "the model in `apps/api/src/lib/auth/`" and
"what code paths actually exercise it." Invite flow turns the lights
on inside the permissions cabinet that Sprint 4 just built.

### 2. Tariff engine is a pure-function deliverable.

ADR 0014 / Rule 5 doesn't gate tariff engine work; it gates billing
*correctness*. The pure function (milestone 5.3 in the old §8) is
unit-testable in isolation. Schema (5.1, 5.2) is additive. **Tariff
engine slips cleanly.** Schema additions don't break anything by
existing unused. The pure function is mostly the same effort
whether it lands Sprint 5 or Sprint 6.

By contrast, invite flow's value compounds. Once admins can invite
team members, every subsequent sprint can have real users testing
real RBAC against a real surface. Sprint 6+ benefits from "we have
multiple test users" in a way Sprint 5+ benefits from tariff math
much less directly.

### 3. Pilot Go-Live needs both — but priority order matters.

Pilot Go-Live (Sprint 10) requires: customer admins inviting their
team, drivers signing up, sessions metered, costs computed, billing
visible. Both invite-flow and tariff are part of that surface.

If we ship them in `invite → tariff` order:
- Sprint 5: invite flow lands. Sprint 6 + 7 use real users while
  building tariff and lifecycle.
- Pilot prep (Sprint 8 + 9) tests the full chain with real users
  exercising real role boundaries against real billing math.

If we ship them in `tariff → invite` order:
- Sprint 5: tariff lands. Sprint 6 builds invite. Sprint 7 lifecycle.
- Tariff math is tested against bootstrap admin only until Sprint 6.
  Multi-user RBAC against billing-data routes only validated at
  Sprint 7+.

The first ordering gives more sprints of multi-user shakedown before
pilot, which is when the "weird interaction between role X and
billing visibility" bugs surface.

### 4. Sprint 4's carry-forward depends on Sprint 5 = invite.

Sprint 4 retro names six carry-forward items; #1 is the sub-resource
route refactor that "becomes mechanical once invite flow lands real
userIds in the session." If Sprint 5 isn't invite, that work
either:
- gets re-deferred (compounding tech debt), or
- ships in Sprint 6 against still-bootstrap-only sessions, which is
  pointless — it'd rebuild the routes a second time when Sprint 7 invite
  finally lands.

Aligning Sprint 5 with the carry-forward closes the loop cleanly.

## Consequences

### Schedule slip cascade

Every downstream sprint shifts by one slot:

| Slot | Pre-this-ADR | Post-this-ADR |
|---|---|---|
| Sprint 5 | Commercial Model | Invite Flow + Driver Signup + Impersonation |
| Sprint 6 | Billing Dashboard | Commercial Model (slipped) |
| Sprint 7 | Push API + Observability | Billing Dashboard (slipped) |
| Sprint 8 | Hardening | Push API + Observability (slipped) |
| Sprint 9 | Multi-Tenant + White-Label | Hardening (slipped) |
| Sprint 10 | **Pilot Go-Live** | Multi-Tenant + White-Label (slipped) |
| Sprint 11 | Enterprise API (post-pilot) | **Pilot Go-Live** (slipped) |
| Sprint 12+ | Post-pilot work | Enterprise API + post-pilot work (shifted) |

**Pilot Go-Live moves from Sprint 10 to Sprint 11.** That's the cost
of this decision.

The cost is honest: ADR 0014 was authored knowing it would consume
Sprint 3 (formerly OCPI) and Sprint 5 (formerly Commercial Model);
Sprint 3 was already documented in ADR 0015. This ADR is the second
half of the same swap.

### Implications for Data Storage Lifecycle

Original Sprint 4 was Data Lifecycle. ADR 0015 slipped it to Sprint 6.
This ADR slips it to Sprint 7. By the time it lands, the pilot dataset
has been growing for ~3 months at staging volumes. Still tractable
(~9M events estimated for that window vs the 4000-charger plan's
500M/month projection).

### Implications for OCPI

ADR 0015 placed OCPI Foundation at Sprint 14 post-pilot. With this
ADR's slip, OCPI moves to Sprint 15 by relative count. No customer
asking for OCPI today — slip is theoretical.

## What lands in Sprint 5

Per ADR 0014 §"Sprint 5 (invite + driver self-registration)":

1. **Agent invite flow.**
   - `POST /api/admin/orgs/:orgId/invitations` (admin sends invite).
   - `GET /api/public/accept-invite/:token` (recipient lands).
   - `POST /api/public/accept-invite/:token` (recipient confirms + sets credential).

2. **Driver self-registration flow.**
   - `POST /api/public/signup` (phone/email + verification).
   - `POST /api/public/verify-otp`.

3. **`UserCredential` polymorphic kinds.**
   - Today: `passwordHash` only.
   - Sprint 5: `password`, `magic_link`, `otp`. (Full polymorphism per
     ADR 0014 Layer 1; passkey + oauth_* defer to Sprint 9.)

4. **Real multi-user sessions.**
   - `SessionPayload` extends with `userId`.
   - `requirePermission` middleware switches from bootstrap god-mode to
     real lookup once `userId` is populated.

5. **Sub-resource route inline `assertPermission` retrofits.**
   - ~30 routes from Sprint 4.4 carry-forward.

6. **Impersonation flow.**
   - Audit-logged. Session swap with original user retained.
   - Max duration enforced.
   - `platform.impersonate` permission gates access (already in catalogue).

7. **UI: invite-email template, accept-invite landing page,
   driver app signup screens.**

The detailed milestone breakdown lives in `docs/sprints/SPRINT_05_TASKS.md`.

## Open questions

1. **OTP delivery channel for driver signup.** SMS via Twilio /
   Cloudflare Email? In-app push (no, drivers haven't installed yet)?
   Recommend SMS via a Cloudflare-friendly provider; details in
   Sprint 5 plan.
2. **Magic-link token TTL for agent invites.** ADR 0014 leaves this
   open. Recommend 7 days for invite acceptance; 15 minutes for OTP.
   Confirm at first design summary.
3. **Impersonation session max duration.** ADR 0014 says enforced;
   doesn't specify. Recommend 4 hours per impersonation; configurable
   per-tenant later.
4. **Existing bootstrap admin migration.** Once `userId` is in the
   session payload, the bootstrap admin needs an actual `User` row
   (it's currently env-var only). Spike this at the start of Sprint 5.

## References

- [ADR 0014 — Identity, Tenancy, Authorization](./0014-identity-tenancy-and-authorization.md) §"Sprint 5 (invite + driver self-registration)"
- [ADR 0015 — Sprint 3 scope swap](./0015-sprint-3-scope-swap-ocpi-to-identity.md) (precedent)
- [docs/retros/sprint-04.md](../retros/sprint-04.md) (Sprint 4 close)
- [docs/sprints/SPRINT_05_TASKS.md](../sprints/SPRINT_05_TASKS.md) (Sprint 5 detail)
- [docs/notes/2026-05-02-permission-hierarchy-review.md](../notes/2026-05-02-permission-hierarchy-review.md) (parked concerns)
