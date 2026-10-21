# Codex Work completion: Core UI real-product polish

## TL;DR

The local Straumvakt Core workspace now presents Admin, Organisation/CPO and Driver routes as credible operational products instead of flat fixture inventories. Daily routes are grouped by purpose; evidence-heavy routes remain reachable in collapsed sections; every screen labels Core scope, local provenance, read-only behavior and backend gating; and each persona has a clear operating workflow. Driver statements explicitly remain separate from invoices, payment requests and paid status.

## Run

- Agent: `codex-work`
- Lane: `core-ui-product-polish`
- Start UTC: approximately 2026-08-10T22:35:00Z
- End UTC: 2026-08-10T22:54:10Z
- Wall-clock duration: approximately 19 minutes
- Prompt estimate: 4-8 hours
- Estimate met: no; the source already contained extensive Core fixture and guard coverage, so the scoped polish and verification completed substantially sooner.

## Containment

- Target worktree: `E:\Claude\Straumvakt-onboarding-web`
- Prompt-time branch mismatch: worktree was clean on unrelated `poc/dso-map-public-button-2026-08-10`.
- Resolution: preserved that branch and created `codex/core-ui-real-product-polish-2026-08-10` from verified Core UI lineage `codex/onboarding-web-experience`.
- Start tip: `af25b82b7931e3bb0dd29b66427e6fd05ffbe6a3`
- End tip: `db9443c86c5e6732478ab422f46a4803edf78f45`
- Commit: `db9443c feat(ui): clarify Core product workflows`
- Remote state: branch has no push or PR.
- End worktree state: tracked tree clean; unrelated `poc/` remains untracked from the prior DSO branch and was not staged, changed or deleted.

## Product changes

- Grouped 21 Admin, 24 Organisation and 34 Driver routes into operational sections.
- Kept readiness and integration evidence routes accessible but collapsed by default.
- Added visible `Core`, `Local fixture`, `Read only` and conditional `Backend gated` labels.
- Added Admin platform-control, Organisation monthly-operating and Driver charging-record workflow bands.
- Added explicit statement-versus-invoice/payment language.
- Preserved disabled actions, fixture money labels, missing-power honesty and Service exclusion.
- Added responsive rules for the workflow band at tablet and mobile widths.

## Files changed

- `src/app/app/post-login-data.ts`
- `src/app/app/post-login-shell.tsx`
- `src/app/app/post-login.css`
- `src/app/app/post-login-data.test.ts`
- `src/app/app/post-login-guard.test.ts`
- `src/app/app/core-product-guard.test.ts`
- `docs/notes/2026-08-10-core-ui-real-product-polish.md`
- `docs/notes/2026-08-10-core-ui-review-guide.md`
- `docs/notes/2026-08-10-core-ui-backend-unlock-list.md`

No mobile, API runtime, database, authentication, billing engine, Worker, OCPP, BLE or NFC file changed.

## Verification

- Focused Core UI suite: 6 files, 1,372 tests passed.
- Root `npx tsc --noEmit`: passed.
- `npm run build`: passed; local routes included.
- `git diff --check`: passed before commit.
- Browser: Admin Core pricing at 1440x900, no horizontal overflow.
- Browser: Organisation billing material at 820x1180, period lock disabled, no horizontal overflow.
- Browser: Driver monthly statement at 390x844, drawer and evidence disclosure work, no horizontal overflow, no `0 kW`, statement disclaimer visible.
- Full `npm test`: 72 files and 2,434 tests passed, 1 skipped; one pre-existing suite load failed because `scripts/check-workspace-typecheck.test.mjs` has an invalid token.
- Aggregate `npm run typecheck`: root frontend passed, then `apps/api` failed because `prisma/generated/node-client/client` is absent and dependent script types fail. No backend generation was performed.
- Existing Next warning: middleware convention is deprecated in Next 16 in favor of proxy.

## Local preview

- Entry: http://localhost:3012/login-demo
- Feature flag: `STRAUMVAKT_LOCAL_PRODUCT_PREVIEW=1`
- Existing local server PID reported by Next: `24792`

## Backend dependencies still disabled

- Identity-bound onboarding and access mutation.
- Authoritative measured-power and CDR cost contracts.
- Multi-session recovery selection.
- Organisation driver mutations and rate mutations.
- Billing period lock, report export and delivery retry.
- Admin support context and cross-tenant billing authority.
- Icelandic bank/accounting export formats.

See `docs/notes/2026-08-10-core-ui-backend-unlock-list.md`.

## External-state confirmation

No push, PR, deploy, SQL, database connection, cloud mutation, DNS change, Worker action, secret operation, hardware command or remote Git mutation occurred.

## Cleanup candidates

- Review and remove or relocate the inherited untracked `E:\Claude\Straumvakt-onboarding-web\poc\` only after confirming the DSO POC branch is preserved elsewhere.
- Repair the invalid-token workspace typecheck test.
- Generate the API Prisma node client only in the backend/release lane if that lane requires aggregate typecheck.

## Next action

Review the three personas from `/login-demo`, then decide whether `db9443c` should be integrated into the next local release candidate. Backend actions must remain disabled until the contracts in the unlock list are approved and implemented.
