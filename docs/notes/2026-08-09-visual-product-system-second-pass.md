# Straumvakt Visual Product System - Second Pass

## Summary

This pass deepens the local `/visual` workspace from a set of persona dashboards into a reviewable product-design surface for the future Straumvakt.org application.

It remains visual-only. No login, API, database, cloud, charger, OCPP, BLE, NFC or hardware path is wired.

## What Changed

- Added a persona journey rail for every workspace so Admin, Organisation/CPO, Driver and Service screens can be reviewed as flows rather than isolated pages.
- Added screen-level review metadata: design intent, what is reviewable now, local/demo boundary and decision prompt.
- Added a collapsible visual review panel on the selected screen.
- Added a compact design-system strip that states the working rules for accent color, operational surfaces, disabled actions and hidden rejected controls.
- Added persona-level next-decision queues so review can focus on visible product choices instead of backend readiness.
- Strengthened tests so every screen carries the new metadata and money-like fixture values stay inside demo/provisional/read-only boundaries.

## Strongest Views Now

- Straumvakt Admin is strongest for discussing the operator cockpit, support context, risk ownership and release evidence.
- Organisation/CPO is strongest for discussing charger operations, driver access decisions and commercial read-only boundaries.
- Driver is strongest for discussing guest, unaffiliated, active charging, history and privacy states.
- Service remains explicitly future-facing, but is now concrete enough to review contractor safety, diagnostics, evidence and handoff patterns.

## Still Visual-Only

- Real credential routing from `straumvakt.org`.
- Staff support-context persistence and audit reads.
- Organisation invite submission.
- Driver installation-code submission.
- Agreement and cost-factor write surfaces.
- Contractor service workflows.
- Any production data, charger control or billing mutation.

## Review Order

1. Open `/visual` and inspect Admin overview, support context and beta readiness.
2. Switch to Organisation/CPO and inspect chargers, access requests, sessions and agreements.
3. Switch to Driver and inspect guest, no-access, access, active session and account states.
4. Switch to Service only as a future product discussion, not as launch scope.
5. For each persona, use the new journey rail and review panel to decide whether hierarchy and terminology feel right before backend work starts.

## Do Not Wire Yet

- Do not wire disabled actions until the backend readiness gate for that workflow exists.
- Do not render charger visibility controls unless the product decision rejecting visibility is reversed.
- Do not make pricing or cost-factor assignment interactive until write contracts and billing tests exist.
- Do not treat `/local/product-preview` as the accepted market UI.
