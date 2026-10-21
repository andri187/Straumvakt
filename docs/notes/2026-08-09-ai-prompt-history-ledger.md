# AI Prompt History Ledger - 2026-08-09

Purpose: track Straumvakt AI-agent prompts, handoffs, elapsed time when
reported, and very short outcomes. This is a coordination artifact, not adopted
architecture or deployed-state evidence.

Legend:

- `not reported` means the handoff did not include the value.
- `in progress` means the prompt has been issued but no handoff has been
  reconciled yet.
- External mutation means push, PR, deploy, database/SQL, Cloudflare/Neon/DNS,
  live login, hardware command, or deletion/move. Local docs/status edits are
  not counted as external mutation.

| Issued UTC | Agent | Prompt file | Target worktree | Start tip | End tip | Estimated wall clock | Actual wall clock | Very short result | Status | Skipped / blocked | External mutation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-09 10:45 | Codex | `next-long-codex-product-ui-and-onboarding-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web`; `E:\Claude\Straumvakt-driver-access-ui` | web `4b69d0f`; mobile `4757f5c` | web `d228f53`; mobile `75beb3c` | 4-8h | not reported | Built web/mobile onboarding UI; backend-gated | Complete | Web had one pre-existing loader test failure; Samsung unavailable; backend contracts missing | No |
| 2026-08-09 10:46 | Claude A | `next-long-claude-a-single-onboarding-domain-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `5111db6` | `54c7155` | 4-8h | not reported | Found invite ATO risk; reconciled onboarding contract | Partial | Phase 1 census/state machines partial; Phase 8 matrix and Phase 10 expansion not reached | No |
| 2026-08-09 10:46 | Claude B | `next-long-claude-b-beta-production-and-worker-forensics-2026-08-09.md` | `E:\Claude\Straumvakt-beta-production` | `0d076ec` | `31c0900` | 4-8h | not reported | Resolved beta Worker topology; production no-go | Complete | Seven dashboard facts still blocked by absent control-plane evidence | No |
| 2026-08-09 11:24 | GPT coordinator | `next-gpt-coordinator-straumvakt-2026-08-09.md` | coordinator-only | n/a | n/a | 1-3h | not reported | Built local worktree/prompt coordination ledger | Complete | Remote/plugin evidence not yet integrated; elapsed time not tracked | No |
| 2026-08-09 12:25 | Claude A | `next-claude-a-backend-contracts-security-product-to-market-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `54c7155` | `d0f4cc0` | 8h+ | not reported | Backend partly ready; cost writes absent | Partial | Stopped after readiness verdict; later phases and continuation queue not attempted | No |
| 2026-08-09 12:25 | Claude B | `next-claude-b-cloudflare-release-cleanup-product-to-market-2026-08-09.md` | `E:\Claude\Straumvakt-beta-production` | `31c0900` | `563b554` | 8h+ | not reported | Cloudflare auth absent; workers_dev foot-gun | Partial | Seven Cloudflare dashboard facts remain blocked; no cleanup performed | No |
| 2026-08-09 12:26 | Codex | `next-codex-admin-cpo-driver-ui-product-to-market-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web`; `E:\Claude\Straumvakt-driver-access-ui` | web `d228f53`; mobile `75beb3c` | web `7a25fa5`; mobile `ad5d8c7` | 8h+ | 1h12m35s | Local three-persona product UI with real contracts and honest disabled states | Complete, good duration | Full web suite has one junction-specific loader failure; repo checks 8/11 due Prisma/junction/work-view; Android 11-14 still untested | No |
| 2026-08-09 12:39 | Claude A | `next-deep-claude-a-backend-product-market-hardening-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `d0f4cc0` | `1e9bfb8` | 8-14h | not reported | Designed S2; rejected visibility toggle | Partial | Stopped after Phase 8; 13 state machines, 120 packages, fallback queue not attempted | No |
| 2026-08-09 13:05 | Claude A | `next-ultra-claude-a-backend-security-domain-market-runway-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `1e9bfb8` | `4dea004` | 8-14h | 2m49s | D-01 invariant; support guard one seam | Partial under-run | Completed phases 0,2,3,8,10,13; skipped 160 packages and fallback queue | No |
| 2026-08-09 13:05 | Claude B | `next-ultra-claude-b-release-ops-cleanup-cloudflare-gap-2026-08-09.md` | `E:\Claude\Straumvakt-beta-production` | `563b554` | `31ce40b` | 8-14h | 11m43s | Release manifest, cleanup dry-run, 36 runbooks, 142 packages | Complete under-run | Produced substantial artifacts but far below requested unattended duration | No |
| 2026-08-09 13:18 | Claude A | `next-mechanical-claude-a-remaining-backend-packages-tests-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `4dea004` | `fc071b3` | 8h+ / count-gated | 9m50s | Delivered 204 packages, 50 issue bodies, 156 scenarios, endpoint/test specs | Complete under-run | All twelve completion-rule items delivered, but far below requested wall-clock duration | No |
| 2026-08-09 13:35 | Claude B | `next-mechanical-claude-b-release-ops-execution-artifacts-2026-08-09.md` | `E:\Claude\Straumvakt-beta-production` | `31ce40b` | `56af65d` | 8-14h / count-gated | 46m58s | Executable workers.dev linter, 270 items, 80 issues, 60 checklists, 50/50 fixtures | Complete under-run | Count gates met; Cloudflare/Neon rehearsals remain approval/credential blocked | No |
| 2026-08-09 13:44 | Codex | `next-codex-product-ui-hardening-qa-accessibility-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web`; `E:\Claude\Straumvakt-driver-access-ui` | web `7a25fa5`; mobile `ad5d8c7` | web `0f4dbc8`; mobile `77b7e75` | 6-10h / implementation+QA gated | 39m35s | 54 UI improvements, 46 tests, 15 visual groups, 9 Android cells | Complete under-run | QA thresholds met, but this does not settle the separate market-visual/UI lane | No |
| 2026-08-09 13:54 | Codex | `next-codex-real-post-login-market-ui-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web`; `E:\Claude\Straumvakt-driver-access-ui` | web `0f4dbc8`; mobile `77b7e75` | not fired | 6-10h / post-login route gated | n/a | Real credential-routed Straumvakt admin, CPO and Driver market UI | Ready, not running | Held because Codex was already finishing the hardening run; do not treat `/local/product-preview` as market UI | No |
| 2026-08-09 14:02 | Claude A | `next-claude-a-source-linked-backend-implementation-readiness-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `fc071b3` | `e66a10c` | 6-10h / source-linked readiness gated | 49m15s | 19-series source-linked packet: 140 inventory, 303 tasks, 76 tests, 58 proposals | Complete under-run | New defects found; next useful A run is scratch-branch compiler verification, not more docs | No |
| 2026-08-09 15:18 | Claude A | `overnight-claude-a-scratch-compiler-verification-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | `e66a10c` | scratch `4812a00` | >=4h / scratch compiler verification | 1h07m33s | Twelve slices applied; tsc clean; 696 tests pass; npm run check 9/10; ten assumptions corrected | Complete under-run | Verifiable hardening surface exhausted; greenfield feature builds left for a different prompt | No |
| 2026-08-09 15:18 | Claude B | `overnight-claude-b-release-ops-approved-verification-prep-2026-08-09.md` | `E:\Claude\Straumvakt-beta-production` | `56af65d` | `606ceae` | >=4h / release-ops verification prep | 1h13m28s | 105/105 fixtures, 31 new rules, 29-worktree correction, Wrangler model corrected | Complete under-run | Cloudflare session, Neon restore and rollback drill remain approval/credential gated | No |
| 2026-08-09 15:18 | Codex | `overnight-codex-straumvakt-org-visual-frontend-views-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web`; `E:\Claude\Straumvakt-driver-access-ui` | web `0f4dbc8`; mobile `77b7e75` | ready | >=4h / visual frontend lane | pending | Visual-first Straumvakt Admin, CPO, Driver and future Service UI views | Ready | Mandatory Time section; visual/demo only, no backend/cloud mutation | Unknown |
| 2026-08-09 15:31 | Codex | `codex-visual-product-system-second-pass-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web` | web `0f4dbc8` | web `8d39b1c` | >=4h / visual product-system second pass | ~35m15s | Deepened `/visual` with journey rail, design intent, readiness boundaries, design-system notes and review metadata | Complete under-run | 89 focused visual tests passed; production build passed; typecheck blocked by pre-existing generated Prisma client gap in API workspace | Yes |
| 2026-08-09 16:43 | Claude A | `next-claude-a-integrate-verified-hardening-slices-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-domain` | scratch `4812a00` | ready | >=4h / integrate verified hardening slices | pending | Convert green scratch verification into integration-ready backend hardening slices | Ready | Mandatory Time section; local only, no push/DB/cloud/hardware mutation | Unknown |
| 2026-08-09 16:43 | Claude B | `next-claude-b-control-plane-cleanup-freeze-2026-08-09.md` | `E:\Claude\Straumvakt-beta-production` | `606ceae` | ready | >=4h / control-plane and cleanup freeze | pending | Build approval-ready control-plane, 29-worktree and cleanup safety package | Ready | Mandatory Time section; no delete/move/cloud/DB/GitHub mutation | Unknown |
| 2026-08-09 16:43 | Codex | `next-codex-post-login-visual-routes-2026-08-09.md` | `E:\Claude\Straumvakt-onboarding-web` | web `8d39b1c` | ready | >=4h / local post-login visual routes | pending | Create local demo-only post-login-feeling Admin, CPO and Driver routes | Ready | Mandatory Time section; visual/demo only, no backend/cloud/hardware mutation | Unknown |
| 2026-08-10 22:35 | Claude A | `docs/agent-prompts/2026-08-10/2026-08-10-2235-claude-a-core-backend-billing-apply-plan.md` | `E:\Claude\Straumvakt-core-billing` | current at dispatch | pending | 4-8h | pending | Core billing/backend apply plan, tests, merge sequence | Ready | Awaiting go; must write completion artifact | No |
| 2026-08-10 22:35 | Claude B | `docs/agent-prompts/2026-08-10/2026-08-10-2235-claude-b-release-ops-ocpp-cost-gates.md` | `E:\Claude\Straumvakt-beta-production` | current at dispatch | pending | 4-8h | pending | OCPP heartbeat/cost gates, release checklist, measurement plan | Ready | Awaiting go; must write completion artifact | No |
| 2026-08-10 22:35 | Codex Work | `docs/agent-prompts/2026-08-10/2026-08-10-2235-codex-work-core-ui-real-product-polish.md` | `E:\Claude\Straumvakt-onboarding-web` | current at dispatch | pending | 4-8h | pending | Real Core UI polish for Admin, CPO, Driver | Ready | Awaiting go; must write completion artifact | No |
| 2026-08-10 23:05 | Claude A | `docs/agent-prompts/2026-08-10/2026-08-10-2305-claude-a-market-core-backend-readiness.md` | `E:\Claude\Straumvakt-core-billing` | current at dispatch | pending | 4-8h | pending | Market Core backend readiness: schema/API/merge/tests | Ready, supersedes 22:35 A dispatch | Awaiting go; must write completion artifact | No |
| 2026-08-10 23:05 | Claude B | `docs/agent-prompts/2026-08-10/2026-08-10-2305-claude-b-market-cloud-release-observability.md` | `E:\Claude\Straumvakt-beta-production` | current at dispatch | pending | 4-8h | pending | Cloud release/observability: Sentry/Analytics/gates/checklist | Ready, supersedes 22:35 B dispatch | Awaiting go; must write completion artifact | No |
| 2026-08-10 23:05 | Codex Work | `docs/agent-prompts/2026-08-10/2026-08-10-2305-codex-work-market-core-ui-productization.md` | `E:\Claude\Straumvakt-onboarding-web` | current at dispatch | pending | 4-8h | pending | Market Core UI productization for Admin, CPO, Driver | Ready, supersedes 22:35 Codex dispatch | Awaiting go; must write completion artifact | No |
| 2026-08-11 00:05 | Claude A | `docs/agent-prompts/2026-08-11/2026-08-11-0005-claude-a-core-billing-ledger-implementation.md` | `E:\Claude\Straumvakt-core-billing` | not reported | `47a99f6` | 4h | 11m44s | Settlement snapshot, statements and the money contract | Complete under-run | Pure slice only; nothing persists | No |
| 2026-08-11 00:05 | Claude B | `docs/agent-prompts/2026-08-11/2026-08-11-0005-claude-b-cloudflare-observability-implementation.md` | `E:\Claude\Straumvakt-relops-b` | `21f6d20` | `10f873d` | 4h | 16m40s | Gateway observability slice: interval, metrics, Sentry scrubbing, gates | Complete under-run | Cloudflare dashboard facts still blocked | No |
| 2026-08-11 04:10 | Claude A | `docs/agent-prompts/2026-08-11/2026-08-11-0410-claude-a-core-billing-persistence-api-survival.md` | `E:\Claude\Straumvakt-core-billing` | `47a99f6` | `a615a52` | 4-8h | 54m27s | 11 tables declared + generated (unapplied), pure mapper, tenant guard, 310-row census; three launch blockers found | Complete under-run | Every route blocked on a table that cannot be applied without a DB decision | No |
| 2026-08-11 04:10 | Claude B | `docs/agent-prompts/2026-08-11/2026-08-11-0410-claude-b-cloudflare-cost-observability-release-drill.md` | `E:\Claude\Straumvakt-relops-b` | `10f873d` | `815425a` | 4-8h | 24m53s | Top-level lacks queue/DLQ/R2; old gate asked globally not per-env; 12 new rules | Complete under-run | Seven Cloudflare dashboard facts still blocked | No |
| 2026-08-11 09:55 | Claude A | `docs/agent-prompts/2026-08-11/2026-08-11-0955-claude-a-core-billing-merge-blocker-burn-down.md` | `E:\Claude\Straumvakt-core-billing` | n/a | **never fired** | 4-8h | n/a | Not executed - no commit exists on any branch after 2026-08-11T09:33:29Z | **Superseded 2026-08-18** | Absorbed into the 2026-08-18 14:15 A prompt | No |
| 2026-08-11 09:55 | Claude B | `docs/agent-prompts/2026-08-11/2026-08-11-0955-claude-b-cloudflare-top-level-readiness-and-liveness-sweeper.md` | `E:\Claude\Straumvakt-relops-b` | n/a | **never fired** | 4-8h | n/a | Not executed - no commit exists on any branch after 2026-08-11T09:33:29Z | **Superseded 2026-08-18** | Absorbed as the fallback queue of the 2026-08-18 14:15 B prompt | No |
| 2026-08-18 14:15 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-1415-claude-a-core-billing-integration-and-blocker-burn-down.md` | `E:\Claude\Straumvakt-core-billing` | `a615a52` (base `82c63ac`) | `686f5af` | **none - deliverable-gated** | 57m | Merged with ZERO conflicts to `dev/core-billing-integration`; three launch blockers closed; flat-fee feeder built; preflight pack delivered; tests 1,185 -> 1,303 | **Complete - 20/20 gates** | Fallback queue (S12) not reached. Four written claims refuted, incl. the census's own account of the cross-tenant hole. Canonical found RED on `npm run typecheck` - not caused here, fixed in one line, fix must be carried to canonical | No |
| 2026-08-18 14:15 | Claude B | `docs/agent-prompts/2026-08-18/2026-08-18-1415-claude-b-market-rails-invoice-delivery-and-collection.md` | `E:\Claude\Straumvakt-relops-b` | `815425a` | `608749f` | **none - deliverable-gated** | 45m56s | Both task-8 decision packets delivered with 8 ordered blocking questions; full format-agnostic rail shipped (65 fixtures, offline validator wired into `npm run check`); liveness sweeper built; 6 of 7 Cloudflare facts closed | **Complete - 21/21 gates + 7/7 fallback** | First run ever to clear its entire fallback queue. `npm run check` 12/12 green. Cloudflare read-only session WAS available - the 2026-08-11 blocker is gone | No - read-only `wrangler` only |

**Dispatch 2026-08-18 14:15 — A and B confirmed running in parallel.** Tips at
dispatch, observed `2026-08-18T14:28:05Z`: Claude A `a615a52` on
`scratch/claude-a-core-billing-2026-08-10`, integration base `82c63ac`; Claude B
`815425a` on `scratch/claude-b-release-ops-2026-08-10`. Neither
`dev/core-billing-integration` nor `dev/market-rails` existed at dispatch, so
their creation is attributable to this round. Lane boundary in force: B must not
edit `packages/commercial/**`, `apps/api/src/lib/billing/**`,
`apps/api/drizzle/**` or `apps/api/src/routes/public/driver.ts`.
| 2026-08-18 15:40 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-1540-claude-a-activity-source-and-first-invoice-dry-run.md` | `E:\Claude\Straumvakt-core-billing` | `686f5af` | `e7247b6` | **none - deliverable-gated** | n/a | **INTERRUPTED - `API Error: 529 Overloaded`.** Phase 1 landed: `cafbee4` merged `dev/market-rails` at `608749f`, `e7247b6` regenerated the dependency graph and filed **CR-1** against B's invoice contracts. Phases 2-5 never reached | **Incomplete - interrupted, no completion artifact** | Infrastructure failure, not a stop decision. 2 commits survived because they were committed; the run's entire record was lost because it was not. Resumed by the 17:25 prompt | No |
| 2026-08-18 15:40 | Claude B | `docs/agent-prompts/2026-08-18/2026-08-18-1540-claude-b-production-definition-and-environment-path.md` | `E:\Claude\Straumvakt-relops-b` | `608749f` | `a81860b` | **none - deliverable-gated** | 32m45s | **Production already exists and is called staging** - all three public hostnames bound to `-staging` Workers. S0 proven as `ws.straumvakt.org` -> `straumvakt-ocpp-staging`. Recommends option (a); option (c) struck. The one-way-door premise was wrong - Cloudflare has recorded every version all along, rollback works today. A's CR-1 serviced | **Complete - 26/26 gates + 7/7 fallback** | `npm run check` 13/13 green; 888 + 176 tests | No - read-only `wrangler` only |
| 2026-08-18 17:25 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-1725-claude-a-activity-source-and-first-invoice-dry-run-RESUME.md` | `E:\Claude\Straumvakt-core-billing` | `e7247b6` | **never started** | **none - deliverable-gated** | n/a | Not executed - the platform incident was still active. Replaced by the three-chunk split at 18:05 | **Superseded 2026-08-18 18:05** | Its content is carried directly by A2a/A2b/A2c | No |
| 2026-08-18 18:05 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-1805-claude-a2a-connector-activity-writer.md` | `E:\Claude\Straumvakt-core-billing` | `e7247b6` | `1a418df` | **none - deliverable-gated** | ~5m | **Chunk 1 of 3.** Nothing was lost - the connector writer was already built and green in the tree when the 529 hit; salvaged and committed unchanged. `dev/market-rails` re-merged at `a81860b`; **CR-1 closed**. Branch fully green for the first time | **Complete - 12/12 gates** | Zero-session connector decided ACTIVE (the fee is per connector, not per session) | No |
| 2026-08-18 18:05 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-1805-claude-a2b-driver-activity-and-active-driver-decision.md` | `E:\Claude\Straumvakt-core-billing` | `3a27999` | `21191c8` | **none - deliverable-gated** | ~8m | **Chunk 2 of 3.** Driver writer verified and extended; **the refusal kept**. Decision packet: the locked definition cannot be computed; the gap is 50 kr/month at customer 1 (0.83%) but **structurally ~15% in the MDU shape the product is built for**; narrowing is one line and the door only opens forwards | **Complete - 14/14 gates** | Closed periods can never be re-priced, so widening later gains nothing retroactively | No |
| 2026-08-18 18:05 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-1805-claude-a2c-feeder-wiring-and-first-invoice-dry-run.md` | `E:\Claude\Straumvakt-core-billing` | `1b9df38` | `a84141e` | **none - deliverable-gated** | ~15m | **Chunk 3 of 3. THE INVOICE EXISTS.** `SV-2026-000001`, 30 connectors, 2 drivers, **7.564,00 kr**, produced offline - no database, no socket - and printed in full. Two runs byte-identical at 2,782 bytes. 3 connectors saw a session all month, 27 did not: reading 'active' as 'used' would have billed 3 instead of 30, a 5.400 kr undercharge with no error raised | **Complete - 15/15 gates** | Fallback queue not reached. 1,630 tests, 16/16 checks, tree clean | No |
| 2026-08-18 20:55 | Claude A | `docs/agent-prompts/2026-08-18/2026-08-18-2055-claude-a-period-lifecycle-and-the-operable-invoice.md` | `E:\Claude\Straumvakt-core-billing` | `a84141e` | `4a84b5b` (branch now `8274256`) | **none - deliverable-gated** | 44m05s | **Round 3.** Period lifecycle closes delta 9.8; connector assertion closes 9.7; nine billing endpoints over ports; operator runbook, 13 steps. Tests 1,630 -> **1,689** across 92 files, 16 of 16 checks, 4 fool-tests run and 4 caught | **Complete - 22/22 gates** | Fallback queue NOT reached - carried whole into round 4. Two blockers created: no invoice number sequence store (deliberately not invented) and no agreement write surface | No |
| 2026-08-18 20:55 | Claude B | `docs/agent-prompts/2026-08-18/2026-08-18-2055-claude-b-onboarding-an-org-to-invoiceable.md` | `E:\Claude\Straumvakt-relops-b` | `a81860b` | `da2d458` (branch now `7cc591e`) | **none - deliverable-gated** | 27m34s | **Round 3.** Kennitala capture already existed - the real gap was validation, which accepted any ten digits and stored a transposed pair silently. Invoice PDF + delivery log. **An org CANNOT be walked to invoiceable without hand-editing the database: `agreements.ts` is read-only and nothing calls `agreement.create`.** Charger identity is unique per `(orgId, identityString)` while the auth lookup is an unscoped `LIMIT 1` - routes energy to an arbitrary org | **Complete - 21/21 gates + 7/7 fallback** | 992 root + 176 gateway tests, `npm run check` 14 green. Second run ever to clear its whole fallback queue | No - read-only `wrangler` only |
| 2026-08-28 18:00 | Claude A | `docs/agent-prompts/2026-08-28/2026-08-28-1800-claude-a-asset-model-and-invoice-numbering.md` | `E:\Claude\Straumvakt-core-billing` | `8274256` | `eed6503` | **none - deliverable-gated** | **2h08m41s** | **Round 4.** Five migrations generated, none applied: `0004` the number store, `0005` devices/identities/placements, `0006`, `0007` hierarchy+vocabulary+vendor config, `0008` sessions sealed. **Billing now counts placement OVERLAP, which takes Dalvegur from 30 connectors to 20** and stops a mid-month move billing the wrong host. The ADR double-invoice is a named test AND a property test over 8 seeds. Gap-free chosen over a Postgres sequence, with the serialisation cost named. Tests 1,689 -> **1,882** / 105 files, 16 of 16, **19 fool tests** | **Complete - 29/31 met, 1 stated exception, 1 partial** | **The whole fallback queue AND 5 of 6 backlog items** - first run ever to reach the standing backlog. Found `zaptec-session-sync.ts:235` pricing a CDR with no Energy at zero *and* marking it complete. Gate 14 partial: the 1:1:1 invention is in B's file | No |
| 2026-08-28 18:00 | Claude B | `docs/agent-prompts/2026-08-28/2026-08-28-1800-claude-b-agreement-write-surface-and-clean-shell-assembly.md` | `E:\Claude\Straumvakt-relops-b` | `7cc591e` | pending | **none - deliverable-gated; deliberately long** | pending | **Round 4.** The agreement write surface that has never existed; ADR 0054 items 8-9, validity in place of existence; then **assembly** - `dev/clean-shell-assembly` merging A's FROZEN `8274256`, and both dry runs run in one tree for the first time; then the duplication verdict and the Dalvegur re-onboard rehearsal | Ready | 33 gates + 11 fallback + 6 backlog. Generates NO migration. Parallel with A | No - read-only `wrangler` only |
| 2026-08-28 18:30 | Codex Work | `docs/agent-prompts/2026-08-28/2026-08-28-1830-codex-work-driver-money-surface-and-mobile-reconciliation.md` | `E:\Claude\Straumvakt-onboarding-web` + `-driver-access-ui` | n/a | **withdrawn same evening** | n/a | n/a | **Coordinator error.** Gave the GPT lane engineering work - establishing a money unit from the API contract, choosing a mobile trunk, reconciling four branches, wiring endpoints. The GPT lane is the VISUAL aspect of the UI only | **Superseded 2026-08-28 19:00** | Split into the 19:00 codex prompt (visual) and the 19:00 claude-c prompt (engineering) | No |
| 2026-08-28 19:00 | Codex Work | `docs/agent-prompts/2026-08-28/2026-08-28-1900-codex-work-money-screens-visual-design.md` | `E:\Claude\Straumvakt-onboarding-web` + `-driver-access-ui` | `6e7076e` / `77b7e75` | pending | **none - deliverable-gated** | pending | **Round 4, visual lane.** The money screens: every state of a cost visually distinct and none of them a zero; the held-period screen; refusals as content; the provenance block; Icelandic formatting (`7.564,00 kr`); the example-figure audit; six empty states | Ready | 22 gates + 6 fallback. **`apps/api/**`, `packages/**` and `apps/mobile/lib/api/**` are read-only to this lane** - values it needs become `UI-CR-n` | No |
| 2026-08-28 19:00 | Claude C | `docs/agent-prompts/2026-08-28/2026-08-28-1900-claude-c-mobile-reconciliation-and-money-unit.md` | `E:\Claude\Straumvakt-driver-access-ui` | `77b7e75` | pending | **none - deliverable-gated** | pending | **Round 4, conditional.** Establish the unit of `ActiveSession.costIsk` as a FACT from the route (the app has two different `costIsk` fields, one documented aurar and divided, one an undocumented `double` rendered raw); land `ae5db26`, the fix authored 2026-08-09 and never merged; collapse four driver-app states into one trunk | **Ready if a third window is free** | 16 gates + 5 fallback. Otherwise it is round 5's first item - but the bug is live | No |

**Round 2026-08-18 closed.** Both agents complete, both gate tables fully met,
zero external mutation, zero conflicts on the A merge. `dev/core-billing-integration`
at `686f5af` and `dev/market-rails` at `608749f`, both local, neither pushed.

**Round 2 dispatched 2026-08-18 15:40.** Both lanes continue rather than restart:
A from `686f5af` on `dev/core-billing-integration`, B from `608749f`. Authority
unchanged - local merge, no push, no DB apply, Cloudflare read-only. Neither
lane is blocked on the two authorities Andri has not granted; round 2 is scoped
to what completes without them. A merges `dev/market-rails` to consume B's
invoice contracts read-only and files any needed contract change in
`docs/notes/2026-08-18-invoice-contract-change-requests.md`, which B services
first in its Phase 0.

## Current prompt calibration notes

1. Previous Claude A runs produced strong load-bearing findings but stopped
   before large mechanical continuation sections. Future prompts should say:
   "Do not stop after a verdict; if blocked, complete operator packs, scenarios,
   issues, matrices, and fallback analysis."
   The 2026-08-09 13:05 ultra prompt still under-ran at 2m49s, so the next
   Claude A prompt must explicitly require remaining mechanical outputs and
   forbid using "findings changed the package wording" as a stop reason. The
   2026-08-09 13:18 mechanical prompt delivered all required counts in 9m50s:
   good artifact volume, still not long unattended time. The 19-series improved
   to 49m15s and found source-invalidating defects, but the recommended next A
   step is compiler verification on a scratch branch, not more documentation.
2. Previous Claude B work was productive even without Cloudflare access, but
   dashboard-dependent facts remain blocked until a real Cloudflare read-only
   session exists. The 2026-08-09 13:05 ultra prompt improved output volume
   but still completed in 11m43s against an 8-14h target, so the next Claude B
   prompt must require runnable offline tools, expanded evidence templates,
   and execution checklists rather than another conclusion packet. The 13:35 B
   run reached 46m58s and produced executable validators/linters; remaining
   long-duration work is blocked on real Cloudflare/Neon approvals.
3. Codex UI work should remain backend-gated: charger and membership UI can move
   forward; pricing/cost-factor write UI, visibility toggle UI, and real invite
   redemption must wait. The 2026-08-09 12:26 Codex run is the best calibrated
   prompt so far: 1h12m35s, implementation plus verification, real commits, and
   explicit blocked states. However, Andri has rejected `/local/product-preview`
   as the to-market UI. Future Codex work must target real credential-routed
   post-login routes from `straumvakt.org`: Straumvakt admin, organisation/CPO
   admin, and Driver/mobile.
4. Future handoffs should include elapsed time, phases completed, phases
   skipped, artifact count, test count, and whether the prompt under-ran its
   intended unattended duration.
5. Every new agent prompt should explicitly require a closing `Time` section
   with start UTC, end UTC, actual wall-clock duration, and a one-line verdict
   on whether the prompt met the requested unattended-work target.
6. Straumvakt.org frontend visual development is its own lane. It should focus
   on how Straumvakt Admin, Organisation/CPO, Driver, and future Contractor
   Service UI look and behave, independent of backend/login hardening. Demo data
   is acceptable for visual work if clearly local and not presented as live.
7. `C:\Users\Andri\Documents\New project` has a `.git` directory with zero
   commits/tracked files. Treat prompt history there as unbacked until it is
   committed, archived, or copied into the canonical Straumvakt docs area.
8. From 2026-08-10 onward, every new agent prompt must require a local
   completion artifact. See
   `docs/notes/2026-08-10-agent-completion-artifact-rule.md`. Chat TL;DRs are
   helpful, but the coordinator source of truth is the saved completion file
   under `docs/agent-runs/YYYY-MM-DD/`.
9. From 2026-08-10 onward, every coordinator-created prompt must be saved under
   `docs/agent-prompts/YYYY-MM-DD/` using the filename convention in
   `docs/notes/2026-08-10-agent-prompt-file-rule.md`, and
   `docs/agent-prompts/latest.md` must be updated so each agent window can read
   its assigned prompt when Andri says "go".

10. **The 2026-08-11 09:55 pair was dispatched and never fired.** No commit
    exists on any branch after `2026-08-11T09:33:29Z`, and `latest.md` was
    written at 17:21 that day - after the last commit. Seven days passed before
    anyone noticed. **Coordinator rule: a prompt sitting at `status: ready` for
    more than 48h with no matching completion artifact is a stalled dispatch and
    must be re-confirmed or superseded, not left in the index.**

11. **Wall-clock targets are retired as of 2026-08-18.** Every run so far
    under-ran: 2m49s, 9m50s, 11m43s, 11m44s, 16m40s, 24m53s, 39m35s, 46m58s,
    49m15s, 54m27s, 1h07m33s, 1h12m35s, 1h13m28s - against targets of 4h to 14h.
    Twelve consecutive misses is not a discipline problem, it is a broken
    instrument. Prompts are now **deliverable-gated**: an explicit numbered gate
    table plus a fallback queue deep enough that stopping early requires
    visibly skipping named items. Start/end UTC and actual wall clock are still
    recorded, for the ledger, with no target to compare against.

12. **The persistent under-run had one real cause, now named.** Three
    consecutive A runs stopped because "every route this prompt asks for is
    blocked on a table that cannot be applied" - the prompts were local-only and
    the work was not. The 2026-08-18 round grants exactly one new authority,
    local merge to a dev integration branch with no push, and re-scopes the
    deliverables to what is provably completable under that constraint. The DB
    apply and the Cloudflare read-only session remain Andri's to grant.

13. **Deliverable gating worked on first use.** Both 2026-08-18 runs met their
    full gate tables — A 20/20, B 21/21 — and **B cleared its entire fallback
    queue as well, the first run ever to do so.** Wall clocks were 57m and
    45m56s, in the same band as previous "under-runs"; the difference is that
    the work is now provably complete against a list instead of measured against
    a clock nobody could hit. **Keep gate tables. Do not reintroduce hour
    targets.**

14. **A coordinator measurement error, recorded so it is not repeated.** The
    2026-08-18 dispatch told both agents the canonical checkout carried "580
    whitespace-only modified files" and built an anti-CRLF rule around it. **The
    premise was false.** It was measured through the Linux device bridge, which
    has no `/etc/gitconfig` and therefore cannot see Windows' system-level
    `core.autocrlf=true`; native Windows git normalises on read and reports **4
    modified files**, matching the `-w` count exactly. B caught it and correctly
    flipped the recommendation to "do not run a normalisation sequence".
    **Rule: any git state measured through the bridge must be confirmed from a
    native Windows window before it is written into a prompt as fact.** The
    substantive half of that finding — the 4 real files and the uncommitted
    mobile work — was correct and stands.

15. **The mobile money hazard was real but mis-stated, in the safer direction.**
    The dispatch said the Flutter client divides `costIsk` by 100. True of
    `DriverHistorySession`; **false of `ActiveSession`**, which renders the same
    field undivided — so in-flight cost is **100x too large in production
    today**. A found it and the rename-not-divide fix handles both.

16. **An interrupted run loses everything it has not committed, and that is a
    prompt-design problem, not bad luck.** Claude A's 2026-08-18 15:40 run died
    on an `API Error: 529 Overloaded`. Two commits survived; the entire run
    record - phase results, measurements, findings - was lost, because the
    completion artifact was written once at the end as every prompt has
    specified since 2026-08-10. **New standing rule: long prompts must require
    the completion artifact to be appended and committed after each phase, not
    written once at the end.** The 17:25 resume carries it as rule 11 and it
    should be in every prompt from now on.

17. **CR-1 is the first defect found by one lane, in another lane, and fixed
    without either crossing the boundary.** A found that B's golden-file tests
    compare `readFileSync` output against a renderer emitting LF while git
    checks the blobs out as CRLF under system-level `core.autocrlf=true` - so
    they fail on any fresh Windows checkout and are **invisible on the branch
    that created them**. A filed it rather than fixing it, explicitly stated it
    was not blocked, and continued; B serviced it in its own Phase 0. **The
    handover file mechanism works and should be standard whenever two lanes
    share a contract.**

18. **Round 2 corrected the environment picture more than it changed code.**
    B: production already exists and is called staging - all three public
    hostnames are bound to `-staging` Workers; S0 is
    `ws.straumvakt.org -> straumvakt-ocpp-staging`, proven rather than
    inferred; top-level `straumvakt-ocpp` is unreachable and served zero
    requests in 25s; and Cloudflare has been recording every version all along,
    so the "no rollback target / one-way door" premise that had been treated as
    the single blocking release fact since 2026-08-11 **was wrong**.

19. **Long prompts are a bad bet against a degraded API, and the fix is chunk
    size.** Claude A lost the 15:40 run to a 529 and never started the 17:25
    resume. status.claude.com confirmed a live incident - *"Degraded
    performance for multiple models"*, opened 2026-08-18 16:20 UTC, still
    `Investigating` at 17:12, **naming Opus 5 specifically**; third incident in
    four days. A 23-gate prompt attempted into that has one likely outcome:
    another partial run and another lost record. **Round 2 was re-cut as three
    chunks of 12-14 gates each (A2a/A2b/A2c), chained by completion artifact,
    each stopping if its predecessor's artifact is absent.** A 529 now costs one
    chunk rather than a round.

    **The general rule: size a dispatch to the reliability of the platform it
    runs on, not only to the shape of the work.** When the API is healthy, a
    20-gate prompt is fine; when it is not, chain small ones. Check
    status.claude.com before dispatching a long run.

20. **Chunking worked, and the interruption cost nothing in the end.** A2a's
    first act was salvaging the connector activity writer, which had been built
    and green in the working tree when the 529 hit. Three chunks ran ~5m, ~8m
    and ~15m for **41 of 41 gates**, against a 23-gate monolith that had
    produced two commits in the same wall-clock budget. **Chunk long work when
    the platform is degraded; the overhead of chaining is smaller than the cost
    of one lost run.**

21. **The port pattern is what makes offline proof possible, and it is now the
    house style.** A2c put `ActivitySourcePort` between the flat-fee feeder and
    the database so a fixture adapter could drive the entire path with no
    database. Had the feeder called Drizzle directly, *the only way to see an
    invoice before `0002` was applied would have been to apply `0002`.* Round 3
    extends the same rule to the API surface: build over a port, test against a
    fixture, write the Drizzle adapter and never execute it. **Every
    correctness question gets answered where being wrong is free.**

22. **The port's second-order rule is worth stating on its own: absent rows are
    `unavailable`, never zero.** Both count methods return `CountEvidence`
    rather than a number, so an adapter physically cannot express "I looked and
    found nothing" as a zero. A consequence nobody predicted: there is no such
    thing as "zero active drivers" - only "no driver rows", which is unknown -
    so an org with connectors and no drivers now **holds** rather than being
    billed for connectors alone. **A zero and an unknown look identical on an
    invoice, and only one of them is honest.**

23. **Round 3 is the first round where both agents work inside `apps/api`, so
    the lane boundary moved from module ownership to path ownership.** A
    creates `apps/api/src/routes/admin/billing/` as a new directory rather than
    extending an existing route file. **Two agents editing one route file is
    the one avoidable conflict, and directory-level separation removes it
    without either agent needing to coordinate mid-run.**

24. **Migration numbering is a lane boundary, and it is the hardest one there
    is.** `dev/core-billing-integration` carries `0000`-`0003`;
    `dev/market-rails` carries `0000`-`0001` and has never seen the other two.
    A migration generated in B's tree would therefore be numbered `0002` and
    collide destructively at assembly - not a merge conflict, a silent
    duplicate number. **Round 4 gives every migration to one lane.** The
    general rule: when two trees disagree about what has already been numbered,
    only one of them may number anything.

25. **Lanes that never merge reproduce the duplication the restart existed to
    kill, so assembly is now a scheduled phase rather than a hope.** Round 3
    left two delivery state machines, two document models, two active-connector
    derivations and ~3,500 LOC across 13 orphaned modules - and the clean shell
    had still never existed in one tree. Round 4's B lane merges A's **frozen
    commit**, not its branch head, so the assembly is reproducible while A is
    still committing. **Merge a SHA, never a moving branch, when the other lane
    is live.**

26. **A long round is a deep queue, not a long clock.** Andri asked for a round
    that burns as much wall clock as possible. The answer was not a wall-clock
    target - note 11 still stands, and a time target produces padding rather
    than work. It was three tiers per prompt: a gate table, a fallback queue,
    and a standing backlog, with an explicit instruction not to stop when the
    gate table is full, and a resume-do-not-restart clause so an interruption
    costs one phase instead of a run. **Depth is what makes a run long; a
    deadline only makes it dishonest.**

27. **Three port signatures were written verbatim into BOTH prompts.**
    `VendorConfigSinkPort`, `MembershipValidityPort` and
    `PlacementResolverPort` are the seams where round 4's two lanes meet. Round
    3 proved the lanes can share a contract file serviced through a CR; round 4
    goes further and locks the interface in the dispatch itself, so neither
    lane spends a minute waiting for the other to agree a type. **The
    coordinator's job at dispatch is to pre-agree the seams.**

28. **The GPT lane is the visual aspect of the UI. Nothing else.** A prompt was
    written on 2026-08-28 at 18:30 that had `codex-work` establishing a money
    unit from the API contract, choosing a mobile trunk, reconciling four
    branches and wiring endpoints. Andri withdrew it within the hour. **The
    division is by kind of work, not by surface:** Claude Code windows do all
    code work including the mobile engineering; ChatGPT does layout, states,
    copy, formatting and accessibility; Claude Desktop coordinates and writes
    no product code. A UI lane that is deciding what a number means is not a UI
    lane.

29. **Fresh start means the legacy ledger is not a target, not even for a test
    harness.** Round 4's A prompt carried a fallback item pointing the parity
    harness at 1,621 legacy `session_ledger` rows - inherited from round 3's
    queue, written before the fresh-start correction. Struck and replaced with
    the first-placement write path, which is what a *correct* onboarding will
    need when the model is ready for it. **A carried-forward fallback queue is
    where superseded framing survives longest; re-read it against the current
    corrections every round.**

30. **The coordinator's failure mode is doing the work instead of cutting it.**
    Same session: deep repo archaeology - reading Dart types, grepping render
    sites, diffing a stranded commit - and then a prompt written from it that
    told an agent what the coordinator had already found. The archaeology was
    right and one finding was valuable (`ae5db26`, a money fix authored
    2026-08-09 and never merged), but the output belonged in a dispatch, not in
    a coordinator's own analysis. **Find the blocker, name it, hand it to a
    lane. Do not solve it.**

31. **The specification for two rounds existed on no branch.** Claude A's own
    Phase 0 found that ADR 0054 - the document round 4 implements end to end -
    was an **untracked file in the canonical working tree**, as were the
    2026-08-20 handover and three of the notes it depends on. `git log --all
    --diff-filter=A -- 'docs/adr/0054*'` returned nothing. A read it as
    permitted read-only comparison and deliberately **did not** copy it into
    its lane branch, on the grounds that a duplicated ADR is how two copies
    diverge. **One `git clean -fd` in canonical would have destroyed the
    specification for rounds 4 and 5.** Coordinator failure, not an agent one:
    the coordinator writes the record and had never committed it.

32. **Both agents corrected the coordinator on a verified claim, and both were
    right.** B: the assertion that a path sets `enforceAuthorize` true was
    wrong - that line is a Prisma select projection and nothing assigns it. A:
    the membership call-site count is nine that decide, not five. **The pattern
    is now three rounds old: the coordinator's file:line claims are the least
    reliable input to a prompt.** The mitigation that works is telling the
    agent to verify the premise rather than trusting it, which is what round 4
    did explicitly for `enforceAuthorize`.

33. **A round that reaches its standing backlog changes what the queue is for.**
    A cleared 31 gates, the entire fallback queue and five of six backlog items
    in 2h08m. Every previous round stopped at the gate table. **The three-tier
    prompt - gates, fallback, standing backlog - is what produced it**, along
    with an explicit instruction not to stop when the gates are full. Ledger
    note 26 said depth is what makes a run long; this is the evidence.

## Next columns to backfill when reported

- Start timestamp from agent.
- End timestamp from agent.
- Actual wall-clock time.
- Estimated-vs-actual variance.
- Phase count completed.
- Artifact count.
- Test/check count.
- Whether the run met the requested "long unattended" target.
