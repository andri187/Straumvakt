# Andri morning review: billing trust and backend gates

Local start: `http://127.0.0.1:3012/login-demo`

Everything is a local fixture. Disabled actions are intentional evidence of a missing contract, not unfinished button wiring.

## Twenty-minute click path

1. Open `/login-demo` and choose **Driver**.
2. Open `/app/driver/statement-final`; confirm final still says it is not payment or an issued invoice.
3. Open `/app/driver/statement-draft`; compare provisional energy and cost language.
4. Open `/app/driver/meter-verification-held`; confirm billed energy is unavailable while start, stop and expected delta remain visible.
5. Open `/app/driver/cdr-authority-pending`; confirm a CDR-shaped record does not claim authoritative price.
6. Open `/app/driver/cdr-corrected`; confirm original, adjustment and corrected amount coexist.
7. Open `/app/driver/export-ready`, then `/app/driver/export-blocked`; compare evidence readiness with document-download readiness.
8. Open `/app/driver/delivery-logged`, then `/app/driver/delivery-failed`; confirm neither implies payment or recipient acceptance.
9. Open `/app/org/pricing-readiness`; confirm a configured tariff does not make meter/CDR evidence authoritative.
10. Open `/app/org/driver-authority`; confirm manual driver creation is visibly blocked.
11. Open `/app/org/export-readiness`; confirm bank and accounting formats remain unknown.
12. Open `/app/admin/billing-trust`; assess whether held and corrected counts are scannable.
13. Open `/app/admin/ocpp-cost-gate`; confirm the heartbeat concern is understandable without exposing an operator protocol toggle.
14. Open `/app/admin/connector-frame-cap`; confirm the absent cap is not presented as protection.
15. Open `/app/admin/tenant-read-boundary`; confirm platform read authority is distinct from mutation and impersonation.

## Keyboard and focus checklist

- Tab from the browser chrome to **Skip to content** and activate it.
- At widths below 860 px, open and close navigation using keyboard only.
- Verify focus does not move behind the open drawer.
- Navigate every sidebar link and confirm the current route is announced.
- Reach the table filter, type a matching and non-matching value, and hear the result count change.
- Enter the horizontal table region and verify it has an accessible name and visible focus.
- Reach disabled actions and confirm adjacent text explains the unavailable state.
- Confirm warning notes are not distinguished by colour alone.
- At 200% browser zoom, repeat meter hold, driver authority and export-blocked routes.
- In Windows forced-colors mode, verify status, warning and Core-contract boundaries remain visible.
- With reduced motion enabled, confirm the drawer does not animate.
- With a screen reader, confirm amount, currency, owner and provisional state are not announced twice.

## Product decisions to record

1. Is `Statement final` acceptable, or should Core use `Statement ready` until legal invoice design exists?
2. Should drivers see raw meter start/stop, or only the expected delta and hold reason?
3. Which role may read cross-tenant billing trust counts?
4. Does driver deactivation affect billing immediately or at the next period boundary?
5. Is the routine-message cost gate a beta launch blocker?
6. Is a per-connector frame cap required before the 4k connector pilot?
7. Which Icelandic export format should be researched first?

## Hard stops

- Do not enable download, export, retry, period close or driver mutation from these screens.
- Do not translate the candidate Icelandic copy without native review of the whole terminology set.
- Do not infer backend readiness from a visually green state.
- Do not push this branch or deploy any Worker as part of UI review.
