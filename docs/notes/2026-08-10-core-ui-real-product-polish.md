# Core UI real-product polish

Date: 2026-08-10

## Outcome

The local-only post-login workspace now separates normal Core work from readiness and verification evidence. All existing routes remain addressable, but the sidebar no longer presents 21 Admin, 24 Organisation and 34 Driver routes as one flat list.

Every screen now states four things at the render boundary:

- Core scope
- local fixture provenance
- read-only behavior
- backend-gated mutation, when applicable

A persona-specific workflow band explains how the current screen fits into the product:

- Admin: organisation readiness -> fleet exceptions -> billing evidence -> attributed support
- Organisation: CDR evidence -> versioned rates -> period review -> statements and delivery
- Driver: access scope -> metered energy -> rate and fees -> statement status

The Driver language explicitly says that a statement is not an invoice, payment request or paid status.

## Route matrix

| Persona | Navigation group | Routes | Classification | Data | Interaction | Main honesty risk |
|---|---|---|---|---|---|---|
| Admin | Operate | overview, organisations, fleet, tasks | Core | Local fixtures | Read-only | Cross-tenant fixture data could look live |
| Admin | Core commercial | core-product, core-pricing, standard-telemetry | Core | Local fixtures | Read-only | Proposed definitions could look final |
| Admin | Readiness | support, risks, activity, readiness, core-readiness, billing-trust | Core readiness | Source-shaped fixtures | Disabled where mutation exists | Source implementation could look deployed |
| Admin | Verification evidence | ocpp-cost-gate, connector-frame-cap, tenant-read-boundary, integration-* | Review evidence | Source-shaped fixtures | Read-only | Backend evidence could be mistaken for runtime proof |
| Organisation | Operate | overview, chargers, sites, drivers, access, sessions | Core | Local fixtures | Read-only | Session values could look measured/live |
| Organisation | Pricing and billing | agreements, core-pricing, rates, billing-material, delivery-log, monthly-reporting | Core | Local fixtures | Mutations disabled | Demo money could look final or delivered |
| Organisation | Access and setup | access-groups, settings, onboarding | Core | Local fixtures | Safety-gated | Unsafe invitation or authority could look available |
| Organisation | Readiness and evidence | pricing-readiness, driver-authority, export-readiness, compliance-later, integration-* | Readiness/future | Source-shaped fixtures | Disabled | Unknown Icelandic formats could look supported |
| Driver | Charging | no-access, access, installation, chargers, active, history | Core | Local fixtures | Mutations disabled | Provisional values could look settled |
| Driver | Costs and statements | monthly-statement, cost-trust, report-ready | Core | Local fixtures | Downloads disabled | Statement could be confused with invoice/payment |
| Driver | Account | guest, account, help | Core | Local fixtures | Destructive actions disabled | Demo identity could look authenticated |
| Driver | Statement and support states | statement-*, meter-*, cdr-*, adjustment-*, export-*, delivery-*, integration-* | Review evidence | Local fixtures | Read-only/disabled | Edge states could look like actual account history |

Service/contractor routes are not exposed as Core post-login personas.

## Visual decisions

- Keep the operationally dense dark console treatment already established.
- Preserve one table and one attention queue as the main repeated pattern.
- Use navigation groups rather than adding another dashboard or nested cards.
- Keep verification routes reachable but collapsed until selected.
- Keep action buttons visibly disabled; do not invent success messages.
- Label money-like values as demo/read-only at the render edge.
- Preserve responsive table scrolling and the mobile drawer.

## Changed source

- `src/app/app/post-login-data.ts`: source-backed navigation grouping.
- `src/app/app/post-login-shell.tsx`: grouped navigation, provenance labels and persona workflow.
- `src/app/app/post-login.css`: compact styling and responsive rules.
- `src/app/app/post-login-data.test.ts`: every route must appear exactly once.
- `src/app/app/post-login-guard.test.ts`: robust disabled-action guard.
- `src/app/app/core-product-guard.test.ts`: provenance, workflow and grouping assertions.

No mobile, API, database, Worker, billing engine, authentication or protocol behavior changed.
