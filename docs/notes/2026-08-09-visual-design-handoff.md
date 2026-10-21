# Straumvakt organisation visual frontend handoff

## TL;DR

A local, environment-gated `/visual` workspace now makes four product families concrete: Straumvakt Admin, Organisation/CPO, Driver, and future Service/contractor. It contains 34 navigable screen states, four persona navigation models, four isolated demo datasets, and no API or database activity.

## Ready for review

- 34 screen/state concepts: Admin 8, Organisation 9, Driver 9, Service 8.
- 4 distinct navigation and information-architecture models.
- 4 synthetic demo-account boundaries using reserved `.test` addresses.
- 78 counted visual improvements: 34 screens, 4 shells, 4 datasets, 16 responsive/accessibility decisions, and 20 shared interaction/presentation details.
- 53 focused tests covering data contracts, source boundaries, guards, semantics, and accessibility invariants.
- 31 screenshot groups, including 4 verified at a true 390 x 844 viewport and several desktop, tablet, and 200% zoom captures.
- 40 issue-ready visual work packages with later wiring and rollback boundaries.

## Concept only

- Attributed staff support context has no persistence or audit-read contract.
- Organisation invitation submission is withheld because the current bearer path is unsafe.
- Driver installation-code access has no approved backend workflow.
- Service/contractor assignment, diagnostics, evidence, settlement, and handoff are all future concepts.
- Metrics and rows are synthetic examples, not operational claims.

## Product decisions represented

- Admin and organisation operations are separate products, even when staff can assist.
- Staff assistance is attributed support, never impersonation.
- Drivers may exist without an organisation and can later request or redeem access.
- Missing measurements remain missing; the UI does not invent power, cost, or audit values.
- Service access is assignment-scoped, not broad organisation membership.
- Repository health work-view is not restored as a product page.

## Backend work for later approval

1. Define read contracts for each persona and screen.
2. Define identity-bound invitation and installation-code workflows.
3. Define support-context persistence, expiry, attribution, and audit reads.
4. Define contractor assignment and revocation before exposing service data.
5. Define error envelopes and explicit unavailable/provisional fields.
6. Add mutations only after read paths, empty states, and rollback are proven.

## Safety boundary

The route calls `notFound()` unless `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`. Middleware permits local access only under the same flag. The production Wrangler configuration does not set the flag. Source tests reject API literals, fetch clients, and request code in the visual module.

## Evidence

Screenshots are stored outside the repository at `C:\Users\Andri\Documents\New project\evidence\straumvakt-visual-views-2026-08-09`. The canonical local review URL is `http://localhost:3012/visual` while the preview server is running with the flag enabled.

## Review order

1. Compare the Admin and Organisation boundaries.
2. Walk Driver from Guest to No access, Access, Chargers, Active session, and History.
3. Review disabled onboarding and installation states for honest language.
4. Treat Service UI as an architecture probe, not launch scope.
5. Approve one vertical slice before replacing fixtures with source data.
