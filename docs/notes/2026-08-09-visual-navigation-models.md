# Straumvakt visual navigation models

Status: local visual concept, not a released product surface.

The `/visual` workspace is available only when `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`. It uses demo data, performs no requests, and deliberately disables actions whose contracts do not exist.

## Shared structure

- Desktop: fixed left navigation, compact persona switcher, page heading, measures, operational table, priority queue, and workflow-state reference.
- Mobile: persistent persona icons, menu-controlled workspace navigation, single-column measures and horizontally contained tables.
- State language: ready, loading, unavailable, and scoped are designed as first-class product states.
- Navigation rule: persona changes reset to that persona's overview; screen changes retain the persona and clear local filtering.
- Boundary rule: cross-tenant controls, unsafe invite submission, repository-health internals, and unsupported mutations are absent or visibly disabled.

## Straumvakt Admin

**Purpose:** platform operations across organisations without pretending to be an organisation user.

Primary destinations: Operations overview, Organisations, Fleet oversight, Support context, Unresolved risks, Audit and activity, Beta readiness, Staff task queue.

Mobile priority: task queue, urgent fleet exceptions, and explicit support context. Repository work-view data is intentionally absent. Support assistance is presented as an attributed, expiring context rather than impersonation.

## Organisation / CPO

**Purpose:** operate one organisation's sites, installations, chargers, drivers, access, sessions, agreements, and settings.

Primary destinations: Overview, Chargers, Sites and installations, Drivers, Access requests, Sessions, Agreements and cost, Settings, Onboarding and invites.

Mobile priority: active exceptions and decisions. Platform administration and other organisations are absent. Unsafe bearer invitations are withheld; the screen explains the required identity-bound replacement.

## Driver

**Purpose:** move honestly from guest to registered-but-unaffiliated, access request, available chargers, active charging, and history.

Primary destinations: Guest, No access yet, Invite and access, Chargers, Active session, History, Account and privacy, Installation code, Help and support.

Mobile priority: the current relationship and next valid action. Organisation administration and charger configuration are absent. Installation-code submission remains a disabled visual contract until its backend exists.

## Service / contractor (future)

**Purpose:** demonstrate assignment-scoped field work without implying that contractor authorisation exists.

Primary destinations: Work queue, Assigned chargers, Service case, Diagnostics, Site visit, Evidence capture, Service settlement, Case handoff.

Mobile priority: safety state, assigned scope, visit checklist, and evidence continuity. Fleet-wide browsing, commercial administration, and unassigned customer data are absent. Every view is labelled future concept.

## Responsive and accessibility decisions

1. A skip link reaches the page content.
2. Persona controls use tab semantics and selected state.
3. Workspace navigation has an explicit accessible name.
4. Current screens expose `aria-current=page`.
5. Mobile navigation has named open, close, and overlay controls.
6. Tables use captions, scoped column headings, and contained overflow.
7. Search inputs have programmatic labels.
8. Result counts use an `aria-live` region.
9. Disabled actions remain visible with an explanatory state or notice.
10. Metrics use stable grid tracks so value length does not shift the page.
11. Focus-visible treatment is preserved for keyboard users.
12. Reduced-motion and forced-colour modes have explicit fallbacks.
13. A true 390 px viewport has no document overflow in any persona.
14. At 200% zoom, tables scroll inside their region rather than widening the page.
15. Status meaning is carried by text and shape, not colour alone.
16. Demo identities use reserved `.test` addresses and contain no personal data.
