# Codex Work completion: Market Core UI productization

## TL;DR

The local Core UI now has a tested market-review contract across all 79 Admin, Organisation/CPO and Driver routes. Each route declares Core/readiness/evidence/future classification, local fixture truth, unavailable-command state, backend dependency and its main honesty risk. Admin, Organisation and Driver workflow bands are now real local navigation, including a six-step Organisation path from profile through sites/connectors, drivers/access and pricing to billing material.

## Timing

- Agent: `codex-work`
- Lane: `market-core-ui-productization`
- Start UTC: 2026-08-10T23:59:59Z
- End UTC: 2026-08-11T00:14:49Z
- Wall-clock duration: approximately 15 minutes
- Prompt estimate: 4-8 hours
- Estimate met: no; the predecessor task had already built the broad product screen inventory, allowing this pass to concentrate on route contracts, navigable journeys and verification.

## Containment

- Worktree: `E:\Claude\Straumvakt-onboarding-web`
- Branch: `codex/core-ui-real-product-polish-2026-08-10`
- Start tip: `db9443c86c5e6732478ab422f46a4803edf78f45`
- End tip: `6e7076e687d240b206c38447e40574801c3efa7e`
- Commit: `6e7076e feat(ui): productize market review routes`
- End state: tracked tree clean; inherited `poc/` remains untracked and untouched.
- Push/PR: none.

## Product changes

- Added a typed market contract for all 79 post-login routes.
- Classified routes independently from implementation readiness:
  - Core workflow
  - Core readiness
  - Review evidence
  - Future decision
- Kept blocked Core commands classified as Core while rendering Action unavailable.
- Added route-specific backend dependency text.
- Added route-specific honesty notes for money, telemetry, identity/access, delivery and runtime proof.
- Made workflow bands locally navigable.
- Added the Organisation path: Organisation -> Sites -> Connectors -> Drivers and access -> Pricing -> Billing material.
- Added equivalent Admin and Driver product paths.
- Preserved local-only guards, disabled commands, no Service persona, no fake payment/invoice and no 0 kW missing measurement.

## Files changed

- `src/app/app/market-route-contract.ts`
- `src/app/app/market-route-contract.test.ts`
- `src/app/app/post-login-shell.tsx`
- `src/app/app/post-login.css`
- `src/app/app/core-product-guard.test.ts`
- `docs/notes/2026-08-10-market-core-ui-productization.md`
- `docs/notes/2026-08-10-market-core-ui-review-guide.md`
- `docs/notes/2026-08-10-market-core-ui-backend-unlock-list.md`
- `docs/notes/2026-08-10-market-core-ui-test-report.md`

No mobile, backend runtime, API, database, billing engine, cloud, Worker or protocol source changed.

## Verification

- Focused Vitest: 7 files, 1,383 tests passed.
- Root TypeScript: `npx tsc --noEmit` passed.
- Production build: `npm run build` passed.
- `git diff --check` passed before commit.
- Desktop 1440x900:
  - Organisation settings displayed six workflow links.
  - Core / Local fixture / Action unavailable / backend dependency displayed.
  - Billing-material workflow navigation succeeded.
  - No horizontal overflow.
- Tablet 820x1180:
  - Admin integration route displayed Review evidence.
  - Honesty note displayed Source is not runtime proof.
  - Organisation legal/SLA route displayed Future decision.
  - No horizontal overflow.
- Mobile 390x844:
  - Driver monthly statement displayed Core, not readiness.
  - Five workflow links wrapped correctly.
  - Current step visible.
  - No 0 kW and no horizontal overflow.

Known baseline issues from the predecessor pass were not modified:

- full `npm test` passes 2,434 tests with 1 skipped, but one suite fails to load because `scripts/check-workspace-typecheck.test.mjs` contains an invalid token;
- aggregate `npm run typecheck` passes the root frontend, then `apps/api` fails because its generated Prisma node client is absent.

## Local preview

- http://localhost:3012/login-demo
- Required flag: `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`

## Backend dependencies still disabled

- Identity-bound login/invitation/access workflows.
- Site, connector, driver and access-group mutations.
- Measured telemetry provenance and session control.
- Versioned rate persistence.
- CDR authority and final cost.
- Billing-period close and immutable statements.
- Delivery/retry and Icelandic exports.
- Staff support context and cross-tenant reads.

See `docs/notes/2026-08-10-market-core-ui-backend-unlock-list.md`.

## Cleanup candidates

- Preserve or deliberately relocate/delete the inherited untracked `E:\Claude\Straumvakt-onboarding-web\poc\` after confirming the DSO POC branch is safe.
- Repair the invalid-token workspace typecheck test in its owning quality lane.
- Generate the API Prisma node client only in the backend/release lane.

## External confirmation

No push, PR, deploy, SQL, database connection, cloud or DNS mutation, Worker action, secret operation, hardware command or remote Git mutation occurred.

## Next action

Review the Organisation path from `/app/org/settings` to `/app/org/billing-material`, then review Driver access through monthly statement. Decide whether commits `db9443c` and `6e7076e` should move together into the next local release candidate.
