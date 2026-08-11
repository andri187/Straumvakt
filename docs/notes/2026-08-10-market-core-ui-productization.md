# Market Core UI productization

Date: 2026-08-10

## Product position

This workspace is a local market-review product for Icelandic AC charging in MDUs and workplaces. It presents Straumvakt Admin, Organisation/CPO and Driver workflows without claiming authentication, persistence, live telemetry, issued invoices or collected payments.

The underlying screen inventory was already broad. This pass productized the review contract:

- all 79 post-login routes now receive a typed classification;
- every route declares its workflow, fixture truth, interaction state, backend dependency and primary honesty risk;
- visible commands are described as unavailable, not merely styled disabled;
- integration routes are review evidence, not Core product features;
- future decisions remain distinct from Core;
- the organisation workflow is directly navigable from profile through sites, connectors, drivers/access, pricing and billing material;
- equivalent Admin and Driver journeys are directly navigable.

## Route matrix

| Persona | Workflow | Route family | Product class | Data truth | Interaction | Main backend dependency |
|---|---|---|---|---|---|---|
| Admin | Operate | overview, organisations, fleet, tasks | Core | Local fixture | Read-only or unavailable command | Live platform read models and safe task mutations |
| Admin | Core commercial | core-product, core-pricing, standard-telemetry | Core | Local fixture | Read-only | Billing definitions, measured telemetry provenance |
| Admin | Readiness | support, risks, activity, readiness, core-readiness, billing-trust | Core readiness | Local/source-shaped fixture | Unavailable command where present | Permission, attribution, audit and runtime evidence |
| Admin | Verification evidence | OCPP, frame, tenant and integration routes | Review evidence | Source-shaped fixture | Read-only | Runtime/control-plane evidence |
| Organisation | Operate | overview, chargers, sites, drivers, access, sessions | Core | Local fixture | Read-only or unavailable command | Tenant read/mutation authority |
| Organisation | Pricing and billing | agreements, core-pricing, rates, billing-material, delivery-log, monthly-reporting | Core | Local fixture | Unavailable command where present | Versioned rates, CDR authority, period close, delivery |
| Organisation | Access and setup | access-groups, settings, onboarding | Core/readiness | Local fixture | Unavailable command | Identity-bound onboarding, permission and audit |
| Organisation | Readiness and evidence | pricing, driver, export, legal and integration routes | Readiness/evidence/future | Source-shaped fixture | Read-only/unavailable | Runtime proof and approved Icelandic formats |
| Driver | Charging | no-access, access, chargers, active, history | Core | Local fixture | Read-only or unavailable command | Access, measured session and stop contracts |
| Driver | Costs and statements | monthly-statement, cost-trust, report-ready | Core | Local fixture | Read-only/unavailable | CDR provenance, statement finality and delivery |
| Driver | Account | guest, account, help | Core | Local fixture | Unavailable destructive command | Identity and account governance |
| Driver | Statement/support states | statement, CDR, correction, delivery and integration routes | Review evidence | Local fixture | Read-only | Authoritative state and failure contracts |

Service/contractor remains outside the Core post-login route set. The DSO map remains a separate local utility and is not represented as a Core product workflow.

## Honesty taxonomy

- Money is illustrative: fixture rates and statements are not final charges, invoices or payment status.
- Measurement provenance: fixture, stale and unavailable values are not live charger measurements.
- Authority is not proven: visible access, identity and roster state does not prove mutation authority.
- Delivery is not settlement: delivery state does not prove receipt, invoice issue or payment.
- Source is not runtime proof: source-shaped evidence does not prove deployment, capacity or control-plane state.

## Source changes

- `src/app/app/market-route-contract.ts`
- `src/app/app/market-route-contract.test.ts`
- `src/app/app/post-login-shell.tsx`
- `src/app/app/post-login.css`
- `src/app/app/core-product-guard.test.ts`

No backend, mobile, database, cloud, billing engine or protocol source changed.
