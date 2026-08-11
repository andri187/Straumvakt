# Market Core UI test report

Date: 2026-08-10

## Automated coverage

The focused suite covers:

- all 79 Admin, Organisation and Driver routes exactly once;
- no Service route in the Core set;
- Core/readiness/evidence/future classification;
- local-fixture truth on every route;
- read-only versus unavailable-command behavior;
- backend dependency text for every visual command;
- money, telemetry, identity/access, delivery and runtime-proof risk classes;
- Core pricing at 200 kr/connector, 50 kr/driver and 450 kr/connector cap;
- DSO, retailer, CPO add-on, plug-time and grace;
- disabled rate, period, statement and export actions;
- no 0 kW missing-measurement claim;
- no fake payment, invoice or bank claim;
- no network client or persistence form in the local UI;
- responsive and accessibility guards;
- navigable Organisation onboarding-to-billing workflow.

## Commands

- Focused Vitest: `npm test -- src/app/app/market-route-contract.test.ts ...`
- Root TypeScript: `npx tsc --noEmit`
- Production build: `npm run build`

## Known repository-level issues

The previous pass established two unrelated baseline issues:

- full `npm test` loads 72 files and passes 2,434 tests, but `scripts/check-workspace-typecheck.test.mjs` has an invalid token;
- aggregate `npm run typecheck` passes the root frontend and then fails in `apps/api` because the generated Prisma node client is absent.

Neither issue is changed or worked around in this frontend lane.

## Manual QA

Required routes:

- Admin `/app/admin/organisations` and one integration evidence route.
- Organisation `/app/org/settings` through `/app/org/billing-material`.
- Driver `/app/driver/access` through `/app/driver/monthly-statement`.

Required sizes: 1440x900, 820x1180 and 390x844.

Pass criteria: no page-level horizontal overflow; workflow links wrap; current step is visible; tables scroll internally; disabled commands remain legible; route classification and honesty note agree with content.
