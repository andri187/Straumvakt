# ADR 0005 — Pilot Scope Tightening (2026-04-25)

**Status:** Accepted
**Date:** 2026-04-25
**Sprints affected:** 2, 3, 4, 5, 6, 8, 9, 10
**Rollback anchor:** git tag `pre-pilot-rescope-2026-04-25`

## Context

The original V3 delivery plan defined Sprint 10 (Pilot Go-Live) as a
commercially-ready pilot: real chargers, real drivers, real invoices,
payment processing, OCPI dual-role roaming, Auðkenni electronic-ID
login, QR-code session start, multi-currency, and a verified EU
residency posture.

Reality check on 2026-04-25 — the pilot doesn't need to be a
commercial release. It needs to be a **demonstrable platform**:
chargers communicating, drivers logging in and starting sessions,
operators seeing data and running diagnostics. Money movement,
roaming reciprocity, and full regulatory ceremony can happen *after*
the pilot proves the platform works.

Compressing pilot scope to what's actually needed for that demonstration
shortens the runway to Sprint 10 and de-risks the commercial-grade work
(payments, dunning, EU compliance ceremony) by giving it dedicated
focus post-pilot rather than racing it alongside foundation work.

## Decision

Items moved out of pilot scope and into the post-pilot backlog,
grouped by topic. Tags A–G match the
[`straumvakt_roadmap.svg`](../architecture/straumvakt_roadmap.svg)
tag column.

### A — Roaming

- **eMSP endpoints** (let our drivers charge at partner CPOs).
  Sprint 2 still ships **CPO-side** OCPI: locations, sessions, CDRs,
  tariffs, basic RFID authorize. The eMSP half is post-pilot.
- **OCPI token push to roaming partners** — same Sprint 2 bucket.
  Without eMSP we don't push our drivers' tokens out; we only accept
  them locally where applicable.
- **OCPP 2.0.1 adapter** — Sprint 9 keeps OCPP 1.6J for the pilot.
  2.0.1 unlocks 2.0.1-only roaming partners; deferred until eMSP
  ships.

### B — Driver login

- **Auðkenni electronic-ID (OIDC)** login. Pilot uses **user/password**
  only on the Driver PWA. Auðkenni integration paperwork is real
  work and Iceland-specific; defer until the pilot proves the
  platform.
- **QR-code session start.** Pilot uses idTag/RFID flows that the
  charger initiates. QR experience is post-pilot polish.

### C — Multi-currency

- **EUR + per-locale currency variants.** Pilot is **ISK only**.
  All `CustomerPlan` / `ChargerServicePlan` / `Tariff` rows in
  Sprint 4 use ISK; the schema already supports a `currency` column,
  so EUR is additive later — no migration debt.

### D — Issue Engine v2

Sprint 5 ships a **basic** Issue Engine — the five core rules already
in the plan, ticket workflow, helper role, charger history, console
pages. Deferred:

- **Advanced detection** (anomaly + sequence rules)
- **Smart routing** (helper → contractor → escalation tiers)
- **ML categorization** on issue history (already a V3 non-goal in
  the architecture; reaffirmed here)
- **Helper reputation scoring**

### E — Real billing

Sprint 6 becomes a **billing dashboard** — read-only presentation of
the data the system already has (sessions, tariffs, accumulating
amounts). No money movement. Deferred:

- **Monthly invoice generation** (cron job, rollup logic)
- **Billing transactions** as committed ledger entries
- **Statements** (cross-period rollups for users / hosts)
- **Employer reimbursement workflow** (workplace cost routing)
- **PDF invoices** (rendering + storage)

### F — Commerce + compliance

Sprint 8 becomes "Hardening" — backup restore drill, OCPP gateway
load test, observability hardening. Deferred:

- **Payment provider integration** (Stripe / Adyen / Netgíró
  decision) and tokenization
- **Dunning workflow** (failed-payment escalation)
- **EU residency *verification ceremony*** — the runtime
  *posture* (Cloudflare Data Localization, Neon EU region, R2 EU
  jurisdiction) stays in place during pilot. What's deferred is
  the audit-trail ceremony: documented residency runbook,
  per-quarter reverification, sign-off paperwork.

### Sprint 10 — Pilot Go-Live (scope updated)

> **Demonstrable platform, not commercial release.**

In pilot:

- Real chargers (OCPP 1.6J), pilot drivers (user/password login)
- Sessions start, run, and stop end-to-end against real hardware
- Operator console runs the site
- Issue Engine fires basic rules against real events
- Billing dashboard shows what *would* be billed
- Push API publishes events to a test subscriber
- Backup restore drill executed
- Pilot retrospective written

Out of pilot (commercial readiness, post-pilot):

- Money actually moves between parties
- Drivers from other CPOs can roam onto our chargers (eMSP)
- Auðkenni login flow live
- EU residency audit ceremony complete

## Consequences

### Positive

- **Sprints 2 / 3 / 4 / 6 / 8 / 9 each lose 20–60% of their original
  scope.** Sprint 6 in particular goes from full invoice generation
  to read-only dashboard — the largest single reduction.
- Sprint 10 has a clearer, narrower exit criterion. Easier to call
  "done."
- Commercial-readiness work (payments, dunning, EU audit, eMSP)
  gets dedicated post-pilot attention rather than racing alongside
  foundation work — quality goes up.
- Iceland-specific and roaming-specific items (Auðkenni, eMSP, OCPP
  2.0.1) defer until the pilot proves the platform's worth defending
  with that paperwork investment.

### Negative

- **Pilot is non-commercial.** Operators in the pilot won't be
  collecting money via Straumvakt. Manual invoicing during the
  pilot window is the operator's responsibility (likely 1–2 month
  pilot window; manageable).
- **Roaming-only chargers** (drivers presenting OCPI tokens from
  partner CPOs) cannot be served during pilot. Pilot site selection
  must avoid this case or accept those sessions fail authentication
  during the pilot.
- **EU residency ceremony deferred** is a real flag for any
  privacy-conscious pilot customer. The *posture* is correct
  (Cloudflare EU data localization on, Neon EU region) — only the
  documented audit ceremony is deferred. Communicate this carefully
  in pilot customer onboarding.

### Neutral

- **Schema is unaffected.** Every item moved post-pilot lives on
  schema columns and tables that are already in V3. No re-migration
  when post-pilot work begins.
- **Architecture canon's V3 §11 non-goals list grows** by the new
  deferred items (this ADR's tags A–F). Reaffirms the "foundations
  before floors" principle.
- The straumvakt_roadmap.svg is the visual companion to this ADR;
  every tag (A–G) in the roadmap maps to a section above.

## Alternatives considered

**Keep original scope, accept slip.** Rejected — pilot was already
~5 months on the optimistic 2-week-sprints assumption. Adding roaming +
Auðkenni + payments would push it ~8–10 months minimum, defeating the
"prove the platform" goal of doing a pilot.

**Defer Sprint 10 itself; demo internally instead.** Rejected — pilot
exists to expose the platform to real charger hardware and real
drivers, not just internal users. Demoing internally would defer that
external feedback indefinitely.

**De-scope further (cut the Issue Engine, console, multi-tenant).**
Rejected — those are minimum viable for an operator to actually use
the platform during pilot. Without them the operator has no UI for
diagnosing real-charger problems, which the pilot is designed to
surface.

## References

- [`docs/architecture/straumvakt_roadmap.svg`](../architecture/straumvakt_roadmap.svg)
  — visual roadmap with A–G tag system.
- [`docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md`](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md)
  — updated §1.1 / §1.2 / §1.3 / §2 / per-sprint sections.
- [`docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md`](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md)
  §11 — V3 non-goals list amended.
- Git tag `pre-pilot-rescope-2026-04-25` — snapshot of source of truth
  immediately before this ADR.
