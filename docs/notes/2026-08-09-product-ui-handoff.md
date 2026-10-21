# Product-to-market UI handoff

Date: 2026-08-09
Tracks: staff/CPO web and Driver Flutter
External state: unchanged

## Verdict

Straumvakt now has a local, inspectable product-to-market slice across three personas. It is not an end-to-end onboarding release. Existing read and mutation contracts are wired where their authorization and semantics are supported; unsafe or absent contracts remain read-only or visibly unavailable.

## Branches and commits

| Worktree                                | Branch                                 | Starting tip | Implementation commits |
| --------------------------------------- | -------------------------------------- | ------------ | ---------------------- |
| `E:\Claude\Straumvakt-onboarding-web`   | `codex/onboarding-web-experience`      | `d228f53`    | `3f05e48`, `1d247b9`   |
| `E:\Claude\Straumvakt-driver-access-ui` | `codex/unaffiliated-driver-experience` | `75beb3c`    | `ad5d8c7`              |

All commits are local. Neither branch has been pushed or merged.

## Testable now

- Environment-gated three-persona preview at `http://localhost:3012/local/product-preview`.
- Staff source-derived workflow readiness inventory.
- CPO charger inventory and existing charger-create contract.
- CPO driver membership and access-request review.
- CPO session and cost-factor read surfaces.
- Driver guest and unaffiliated states.
- Identity-bound driver invite redemption.
- Honest blocked installation-code fields.
- Concurrent-session selection and truthful unavailable session values from the preceding mobile product line.

## Backend contracts consumed

- Staff host-application and organisation reads.
- Organisation sites, installations, chargers and charger create.
- Organisation driver-group, driver, agreement and access-request reads.
- Existing access-request approve/deny.
- Organisation session summary.
- Platform cost-factor catalogue.
- Authenticated `POST /api/driver/redeem-invite`.
- Driver charger read used to recover from unaffiliated state.

## Deliberately blocked

- Organisation invitation creation/consumption until the password-overwrite and identity-binding problems are removed.
- Installation access code/passphrase until issue/redeem/approval/status/revoke contracts exist.
- Persisted support context and audit timeline.
- Driver visibility policy distinct from site access classification.
- Driver/group cost-factor assignment.
- Driver access-request status/cancel for unaffiliated recovery.
- Account deletion and retention workflow.
- Any hardware, BLE, NFC, OCPP or live charging claim not observed on a device/charger.

## Verification

### Web

- Focused Vitest: 3 passed.
- Root TypeScript: passed with `--incremental false`.
- Next production build: passed; all new routes present.
- Full Vitest: 51 files passed, 670 tests passed, 1 skipped; one loader suite failed only in this junction-backed worktree and passes 9/9 in the release candidate.
- Full check pipeline: 8/11 passed. Remaining red: API typecheck cannot find the generated Prisma node client in this worktree; dependency graph resolves workspace packages through the release-candidate `node_modules` junction; work-view remains the deliberately retired route decision. API endpoint reference is regenerated and green.

### Mobile

- `flutter test`: 48 passed.
- `flutter analyze`: no issues.
- `flutter build apk --debug`: passed.
- Normal APK installed and opened on Android 15 / API 35 emulator.
- Normal APK SHA-256: `31656338C1739264531F4B0301D0549062D1691093BB96AE239A5CAE1CFD2B04`.

## Evidence

Screenshots live outside Git at `C:\Users\Andri\Documents\New project\evidence\product-to-market-2026-08-09`:

- desktop admin, CPO and Driver preview;
- tablet preview;
- mobile-width admin, CPO and Driver preview;
- real Driver guest app;
- unaffiliated Driver;
- identity-bound invitation;
- blocked installation-code state.

The final three signed-in Driver captures used a temporary local-only QA entry point. It was deleted before commit, the normal app was rebuilt, and the normal APK was reinstalled.

## Known risks before beta

1. The app still contains the old unsafe public invite client/screen as parked compatibility source, though it has no UI caller. Remove it only with the backend/client migration plan.
2. Mobile's default API host remains the beta Worker; production promotion requires a separate release configuration decision.
3. Charger creation returns a one-time OCPP credential and must not be retried automatically after an ambiguous response.
4. The organisation invite path is intentionally non-interactive until B01 in the work-package packet is resolved.
5. Android 11-14 remain untested; only build/widget evidence carries across versions.
6. No real login, invite, charger creation, access decision, session, SQL query or hardware action was executed.

## Durable planning artifacts

- `2026-08-09-product-to-market-ui-contract.md`: readiness matrix, route map, demo contract and backend continuation prompts.
- `2026-08-09-product-ui-qa-and-compatibility.md`: local runbook, responsive/accessibility checklist and five-version Android matrix.
- `2026-08-09-product-ui-work-packages.md`: 64 packages and top 20 issue-ready bodies.

## External-state confirmation

No push, merge, pull request, deploy, SQL, Cloudflare/Neon/GitHub mutation, live login, live API mutation, charger command, BLE write or hardware action occurred. The dirty shared checkout `E:\Claude\Straumvakt` and all peer worktrees were treated as read-only.

## Hardening continuation

### Time

- Start UTC: `2026-08-09T13:47:43Z`
- End UTC: `2026-08-09T14:27:18Z`
- Wall clock: `00:39:35`
- This run is under 45 minutes because all output gates were met after parallel local verification: 54 UI improvements, 46 new/improved tests, 15 visual groups, 12 accessibility improvements, 9 Android matrix cells, and 32 issue-ready packages.

### Delivered and verified

- Authenticated organisation routes now share truthful loading, empty, error, metric, status and backend-contract states.
- Charger credentials, clipboard fallback, create ambiguity, form ordering and table accessibility were hardened.
- Driver filtering, counts, denial validation and focus restoration were added.
- Sessions and agreements preserve unknown/provisional values and expose retryable read failures.
- Staff readiness gained product filters and explicit support/audit/onboarding boundaries without restoring work-view.
- Flutter unaffiliated and installation states gained semantic headings, live outcomes and decorative-image exclusion.
- Four static guards keep `/api/public/invites/consume` out of reachable mobile UI.
- A supervised `ZPR074002`/FEV300 A-B-C-D script was prepared but not executed.
- A local beta rehearsal and 32-package continuation backlog were added.

| Gate | Result |
| --- | --- |
| UI improvements | 54 |
| New/improved tests | 46: 36 web + 10 mobile |
| Visual evidence | 15: 12 browser + 3 Android |
| Accessibility fixes/checks | 12 |
| Android matrix cells | 9 across API 31 real and API 35 emulator |
| Work packages | 32 |
| Web TypeScript/build/focused tests | pass / pass / 36 pass |
| Web full tests | 699 pass, 1 skipped, 1 pre-existing loader failure |
| Flutter tests/analyze/build | 58 pass / clean / pass |

Local commits: web `e27ada3`; mobile `77b7e75`; documentation follows this handoff update on the local web branch. The preview remains at `http://localhost:3012/local/product-preview`. Authenticated routes were source-, type-, build- and component-verified without a live login.

Claude A should preserve the identity-bound mobile route and treat the consume guards as a migration boundary. Claude B should treat API 31/35 results as UI evidence only; they do not alter environment or OCPP decisions.

No push, PR, merge, deployment, SQL, cloud mutation, live login, API mutation, charger command, BLE/NFC write, or physical hardware action occurred.
