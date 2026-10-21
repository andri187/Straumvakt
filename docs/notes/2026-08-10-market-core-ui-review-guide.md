# Market Core UI review guide

Date: 2026-08-10

## Entry

Use http://localhost:3012/login-demo with `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`.

No authentication occurs. No password is accepted or transmitted.

## Organisation-to-billing review

Open `/app/org/settings` and follow the Monthly operating path:

1. Organisation: profile and operating context.
2. Sites: customer places and technical installations.
3. Connectors: charger inventory and operational exceptions.
4. Drivers and access: roster, groups and unavailable mutations.
5. Pricing: DSO/network rate, retailer rate, CPO add-on, plug-time fee and grace.
6. Billing material: CDR evidence, adjustments, period state and unavailable close action.

Continue to `/app/org/delivery-log` and `/app/org/monthly-reporting`. Confirm delivery does not imply settlement and export remains unavailable.

## Admin review

Follow the Platform control path:

1. Organisations.
2. Fleet exceptions.
3. Billing evidence.
4. Launch readiness.

Open one Verification evidence route and confirm its first badge says Review evidence and its lower boundary says source is not runtime proof.

## Driver review

Follow Your charging record:

1. Access scope.
2. Assigned chargers.
3. Active session.
4. Cost explanation.
5. Monthly statement.

Confirm:

- observed power is never replaced by 0 kW;
- unavailable cost is not represented as free;
- a statement is not described as an invoice, payment request or paid status;
- commands remain unavailable;
- monthly cost ownership remains readable at 390 px width.

## Classification spot checks

- `/app/org/rates`: Core + Local fixture + Action unavailable.
- `/app/admin/integration-heartbeat`: Review evidence.
- `/app/org/compliance-later`: Future decision.
- `/app/driver/installation`: Future decision and unavailable command.
- `/app/driver/integration-cdr-pending`: Review evidence with unavailable cost.

## Viewports

- Desktop: 1440 x 900
- Tablet: 820 x 1180
- Mobile: 390 x 844

Review page-level overflow, workflow wrapping, table scrolling, drawer interaction, focus visibility and disabled action legibility.
