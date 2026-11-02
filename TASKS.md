# TASKS — market phase

- **2026-11-02 20:09 UTC — OEM picker + Chargers tabs IMPLEMENTED locally; not committed, pushed or deployed.** Superseding the 19:43 "queued" entry. Add installation (`/cpo/installations?add=1`) opens the 11-card model board with no database or API read; only Easee Charge and Zaptec Pro are links, and only when the deployment's `CPO_VENDOR_CONNECT` enables a vendor that has a server reader (otherwise "Not enabled here"); the other 9 are inert. Manual entry (`?new=1`) stays one step away; choosing a card goes to `?onboard=1&model=<vendor>` and starts that model's connection check. Chargers has Already onboarded / Knocking tabs (both stay mounted, so no request or lost selection on switching) with an in-app badge and notice counting only visible, unexpired knocking rows from the existing incoming snapshot; unreadable data shows "?" not zero. Pictures are 360 px WebP derivatives (4.2 MB originals → 88 KB), added to the shell's public asset allow-lists. **Image reuse rights remain unverified** (`public/oem-models/README.md`). Checks: root `tsc` clean, 417 tests in the affected folders pass, production build passes, 56 real-browser checks (desktop + 390 px) pass. Not run: the OEM continuation page and the manual editor against a database (the rig gives Next none), and the full suites (not needed for this scope). Handoff `docs/agent-runs/2026-11-02/2026-11-02-oem-picker-charger-tabs-handoff.md`.

- **2026-11-02 19:34 UTC — Stage A LIVE.** Andri approved the Git push and the gateway-then-shell release. Commit `a0a4930` was pushed to `origin/codex/core-checkpoint-2026-10-31`. Gateway `straumvakt-ocpp-s1` is version `d1d4fc7f-3f85-4cc4-8175-eb23e299a65b`; shell `straumvakt-cpo-shell` is version `0503225a-4130-43a5-920b-015c5d13a5f4`. Both approved source package hashes matched the handoff before deployment. Cloudflare readback confirms both versions, the shell's three existing secret bindings, `GATEWAY`, recovery `false`, no realtime flag and no `VERSION_HUB`. Public www and apex requests reach `/signin` with HTTP 200. No migration, realtime/recovery enablement, driver secret or real-installation setting change. The three named verification gaps in the next entry remain. Release record: `docs/agent-runs/2026-11-02/2026-11-02-stage-a-release.md`.

- **2026-11-02 01:13 UTC — Remaining core implemented and locally verified; NOT deployed; three verification gaps named.** Superseding the 2026-11-01 23:42 UTC "prepared for Claude" entry. One Sonnet High run completed all remaining core work: distributed read control (shared check cooldown, server read limits with 429, bounded shared repair lease, all through the existing VersionHub), shared realtime for web and the existing Flutter app (role-scoped fanout, minimal driver projection, removal/placement tombstones, bounded polling fallback, truthful stale/outdated states), a closed release trap (new gateway + old shell now drains one event at a time; the stop command is the versioned `requestStopV1` and fails closed against older gateways), and a real defect found by real PostgreSQL and fixed (racing placement closers). Evidence: root 4,921 passed / 12 skipped, gateway 417, Flutter 74 + 4 opt-in end-to-end against local workerd, 8 real-PostgreSQL-17 concurrency tests, 68 real-browser checks (desktop + narrow), workerd checks of the exact artifacts, both typechecks, adopted-schema check (12 migrations). **Named gaps (verification, not code): editor unsaved-edit retention not exercised in a rendered page; no Android emulator run; server-rendered pages not exercised against a database in the browser. No Neon transport, real charger or live read.** Release candidate: gateway `2851b456…`, shell `76a91e89…`, migrations 0010 + 0011 (additive), one consolidated approval request in the handoff; realtime, recovery and the driver secret stay OFF until separate go decisions. Handoff `docs/agent-runs/2026-11-01/2026-11-01-remaining-core-completion-handoff.md`. Nothing committed, pushed, deployed or migrated; no real-installation setting touched.

- **2026-10-31 23:22 UTC — Activation-only gateway hotfix LIVE.** Version `3025ed3d-5975-42cd-ad8b-8193bf82bb2e`, health 200 and remote artifact hash verified. Isolated overlay on verified live baseline avoids unreleased batch-RPC dependency; shell/core/UI changes remain local. Exact artifact passed local WebSocket/alarm/status-ingestion test. ZPR148882 registered boot not yet confirmed by bounded post-release check. No real-installation settings changed. Claude progress monitors off; use substantial Claude tasks with existing per-run approval. Details: `docs/agent-runs/2026-10-31/2026-10-31-registered-boot-hotfix-release.md`.

- **2026-10-31 23:18 UTC — Small registered-boot fix verified locally, NOT deployed.** Sonnet's completed-device shortcut now applies only to the same placement; removal/re-addition under a new placement starts a fresh activation attempt. Regression reproduced before correction. Codex verification: 410 gateway + 182 scoped root tests pass, both typechecks pass, current-source local workerd WebSocket/alarm check passes with zero live bindings. Stop expiry, outbox flushing and activation share the alarm correctly. Real Zaptec response remains unverified; ownership redesign deferred. User reports OCPP auth re-enabled themselves; no real-installation/cloud/DB/deployment changes by Codex. Evidence: `docs/agent-runs/2026-10-31/2026-10-31-core-freeze-checkpoint.md`.

- **2026-10-31 22:59 UTC — Activation task narrowed after corrected telemetry, not launched.** Later Cloudflare analytics exposes a post-registration HTTP101 at 22:20; no registered boot is recorded. Supersedes the 22:52 ownership-redesign scope: request a missing BootNotification on the existing admitted device socket with bounded correlation and activation timeout. DO keys/routing/Pending promotion stay unchanged. Updated brief at the existing path below; superseding mail `20261031-225947Z-codex-to-sonnet-registered-boot-small-fix`. The user switched the real installation to Native auth; no live changes permitted. Old launcher plan is invalidated by changed context; individual run approval remains required.

- **2026-10-31 22:52 UTC — Pending activation repair prepared locally, not launched.** Real onboarding exposed the unverified forced-reconnect dependency: delivered promotion closes its socket, but no fresh registered boot follows. Local deployed-bundle transport reproduction and 91 scoped gateway tests confirm the mechanism, not Zaptec's root cause. Prepare Sonnet High, 30-minute source-only run to retain transport with sound ownership/authentication where feasible and add bounded activation failure. Exact brief: `docs/agent-prompts/2026-10-31-s1-pending-activation-without-disconnect.md`. Individual model-run approval still required. No real installation/cloud/DB/charger changes or deployment.

- **2026-10-31 — FEATURE FREEZE, approved by Andri.** Review and checkpoint the existing core fixes, then onboard one real AC charger. No new feature/research/model lane. Keep realtime and scheduled recovery disabled. Local integration rerun: 752 root + 383 gateway tests pass, both typechecks and adopted schema check pass. Local checkpoint on `codex/core-checkpoint-2026-10-31`; source checkpoint is not release approval. See `docs/agent-runs/2026-10-31/2026-10-31-core-freeze-checkpoint.md`.

- **2026-10-31 22:05 UTC — Core architecture source fixes and shared-live prototype verified locally.** Coherent authorization/terms snapshot; missing command bindings no longer burn stop attempts; independent silence detection and alarm arbitration; bounded selected outbox repair; one-client transport batching and compatible bulk meter SQL; opt-in latest-value publication/subscription using the existing VersionHub class and sync URL. 389 root + 383 gateway tests PASS (772 total), both typechecks, production Next build, schema policy/check (11 migrations), config lint and Worker packaging dry-runs pass. Local workerd: one publication to 100 sockets in 30 ms, duplicate suppressed, expired lease closed; no DB binding. Realtime/recovery remain disabled and NOTHING deployed/applied. Driver grants/mobile wiring, placement-removal invalidation and real PostgreSQL/hardware/production OPEX validation remain explicit rollout gates, not claimed complete. See `docs/agent-runs/2026-10-31/2026-10-31-core-architecture-codex-verification.md`. No new model run.

- **2026-10-31 21:48 UTC — Recovery selector corrected locally with a durable cursor.** Replaced random sorting with indexed device-id traversal and a singleton scheduling position, preserving the existing lifecycle/costing engines. Drizzle migration 0010 generated, NOT applied. 342 root + 372 gateway tests PASS (714 total), both typechecks, config lint and Worker packaging dry-run pass. Actual local PostgreSQL query plan used the existing partial index with 50,000 completed/2,000 open requests and no sort/seq scan. Overall schema checker still flags the pre-existing migration 0008 backfill; no drift/new migration problem reported. Recovery remains disabled/no cron; real Neon concurrency, CPU and evidence-query validation remain. See `docs/agent-runs/2026-10-31/2026-10-31-recovery-cursor-codex-verification.md`. Coherent terms capture remains the next separate step-2 source task.

- **2026-10-31 21:43 UTC — Codex bounded recovery review: PARTIAL, disabled.** Independently ran 312 root + 372 gateway tests (684 passed), both typechecks, config lint and adopted shell Wrangler packaging dry-run. Reproduced and corrected two outage defects: failure-recording errors no longer consume the full costing batch; lifecycle-triggered costing unavailability is propagated. Deterministic/indexed lifecycle traversal still required: random md5 selection does not guarantee fairness or bound database scan work. No schedule/deployment/migration/model run. Evidence and remaining acceptance gates: `docs/agent-runs/2026-10-31/2026-10-31-bounded-recovery-codex-verification.md`. Step 2 remains incomplete; coherent terms-capture reads are also separate pending work.

- **2026-10-31 — Requirements research brief expanded for full product-intent traceability.** After Andri asked whether all intended features were included, added explicit adopted people/mobile/sponsorship/activation requirements plus staged energy/OpenADR, external CPMS, evidence and integration ambitions. Source/adoption/delivery/implementation status must be recorded separately; historical proposals are not silently approved. Existing second research brief updated, AC-only/funds-flow decisions retained; no research/model run or implementation launched.

- **2026-10-31 21:31 UTC — Separate CPMS requirements/cloud/web/mobile research task created as an openable file.** `docs/agent-prompts/2026-10-31-cpms-requirements-cloud-web-mobile-research.md` establishes an evidence-based AC requirements catalogue, user journeys, shared web/mobile contracts, cloud capabilities, data ownership, SLOs and acceptance tests. Complements the four-provider OPEX comparison; usable outside the local environment with explicit evidence limits. Prepared only, no model launched or product changes.

- **2026-10-31 21:29 UTC — Opus alternatives expanded to FOUR full comparisons at Andri's request.** AWS, Azure, Google Cloud and smaller European hosting (Lean Euro), against the current improved Cloudflare/Neon baseline. Established CPMS requirements and agreed AC-only scope are the shared baseline; equivalent reliability, operational evidence and total OPEX analysis for all four. Updated existing brief and immutable clarification. Supersedes the optional-European-reference scope below. Still prepared only; no Opus launch.

- **2026-10-31 21:27 UTC — Cloud alternatives clarified: AWS, Azure and Google Cloud are the three main comparisons.** Andri explicitly asked for Google. Updated Opus brief and sent immutable clarification; smaller European hosting is only an optional cost reference. Still prepared only; no Opus run launched.

- **2026-10-31 21:26 UTC — Opus AC cloud-alternatives/OPEX comparison prepared only.** Andri requested a task comparing two or three other approaches; prepared three provider families against the improved current baseline, with equal AC workloads, reliability, full recurring costs/labour and migration cost separated. Brief: `docs/agent-prompts/2026-10-31-opus-alternative-cloud-architectures-opex.md`; immutable Opus mail queued. Recommended Opus High public-research run, 45-minute cap; NOT launched or individually approved. Sonnet recovery continues in its existing lane; no product changes for this research task.

- **2026-10-31 21:21:18 UTC — Sonnet High bounded recovery run confirmed running.** Run `ed0c8d69-f80a-44c7-932c-2a1055f1fef3`, session `06e56e96-ab36-4c2c-82d8-707075101380`, deadline 21:51:19 UTC. Individually authorized by Andri's "Continue" for the named next step. Source-only scope and limits in the brief below; completion/phase monitor installed. No shell/test tools for Sonnet, no cloud/DB/hardware/deployment; Codex verification follows the handoff.

- **2026-10-31 21:21 UTC — Bounded session/lifecycle recovery preparing for Sonnet High.** Andri said "Continue" after this next architecture step and Sonnet High were identified. One source-only 30-minute run; brief `docs/agent-prompts/2026-10-31-s1-bounded-session-lifecycle-recovery.md`, mail `20261031-212053Z-codex-to-sonnet-bounded-session-lifecycle-recovery`. Existing shell Worker and agreements/costing/lifecycle engine; max 20 costing items, 5 lifecycle requests and cooperative deadline. Schedule remains disabled; no new services/schema/UI work or external actions. Current launcher lock/hold clear; previous KPI implementation verified. Terms-capture consistency remains a separate subtask.

- **2026-10-31 20:24 UTC — KPI Overview independently verified locally.** Sonnet Medium returned at 20:15:53; Codex corrected command/freshness/ingestion metric definitions, added a disclosure cue and page-boundary tests. 61 focused tests, root typecheck and actual Next desktop/narrow visual checks pass; anonymous access redirects. Six live values remain Not measured, local test evidence separately labelled. Existing Analytics Engine writer inventoried; no verified live aggregate source. Preview localhost:3121 uses temporary local credentials and disabled DB URL. Evidence: `docs/agent-runs/2026-10-31/2026-10-31-kpi-overview-codex-verification.md`. No deploy/cloud/DB/hardware action or new Claude run; bounded recovery is the next architecture increment.

- **2026-10-31 20:13 UTC — KPI-only test Overview preparing for Sonnet Medium.** Andri said "Carry on" after local command verification. Narrow six-file presentation/auth-check/test/handoff scope, 20-minute cap, existing Claude Max account. Keep all live metrics unmeasured; show verified command/operation counts only as dated local evidence. No polling, endpoints, DB reads or deployment. Brief `docs/agent-prompts/2026-10-31-s1-test-login-kpi-overview.md`; dispatch `20261031-201350Z-codex-to-sonnet-test-login-kpi-overview`. No new model started at this checkpoint.

- **2026-10-31 20:12 UTC — Durable lifecycle stop independently verified locally.** Fixed one aliasing error in a race-test fixture; added a 100-redelivery operation-count test. Root lifecycle/engine/costing 230 passed; full gateway 372 passed; root/gateway typechecks and adopted config lint pass. Actual local workerd + SQLite DO: 100 concurrent first deliveries → one wire command, one retained record, 100 accepted replies. Evidence: `docs/agent-runs/2026-10-31/2026-10-31-durable-stop-codex-verification.md`. No production/source fix beyond tests, no deployment/Neon/hardware action. Real PostgreSQL, deployed alarm/hibernation and real AC journey remain unverified; autonomous recovery still unfinished. KPI Overview remains prepared, not launched.

- **2026-10-31 20:08 UTC — Sonnet command/lifecycle run returned for review.** Run `1df327e9-df05-4c78-a1c1-ff243c02cf28` finished 20:04:36 UTC; handoff `docs/agent-runs/2026-10-31/2026-10-31-durable-lifecycle-stop-handoff.md`. Reports durable stop attempts, reservation-before-send, deduplication/fencing, alarm composition and local GATEWAY binding. Tests written but NOT RUN; independent review/checks pending. Inspect stricter cancellation after uncertain outcomes and mixed-version rollout before acceptance. Autonomous lifecycle/costing recovery remains later. No deploy/DB/hardware action. Terminal monitor deleted. Older onboarding and Opus launcher-mail receipt omissions reconciled without activating additional work.

- **2026-10-31 20:01 UTC — Test-login KPI Overview requested; queued after the active lifecycle run.** Replace only `/cpo` main content with the six agreed KPI groups for the verified shared test login, preserving navigation and access controls. Show source/window/freshness for measurements and `Not measured` for missing data; no invented zeroes, polling or per-viewer Neon aggregation. Brief: `docs/agent-prompts/2026-10-31-s1-test-login-kpi-overview.md`. Prepared only, not implemented or live; no additional Claude run launched. Current command task `1df327e9-df05-4c78-a1c1-ff243c02cf28` confirmed running, started 19:54:24 UTC.

- **2026-10-31 19:52:11 UTC — AC architecture corrections: first command/lifecycle task prepared.** Andri requested creation and launch of the work. Codex selects one Sonnet High source-only run, 30-minute cap, for durable/idempotent lifecycle stop attempts and local GATEWAY wiring. Brief: `docs/agent-prompts/2026-10-31-s1-durable-lifecycle-stop.md`. Builds on the reviewed AC-only minimal-change plan; independent costing recovery, ingest batching and shared realtime follow separately. No model launched at this checkpoint; no deploy/DB/charger/Git actions authorized. Existing onboarding source is preserved.

- **2026-10-31 — Opus CPMS architecture/industry/OPEX investigation APPROVED FOR LAUNCH.** Andri requested a thorough independent review of industry architectures, available services, actual Straumvakt source/deployment gaps, prior decisions, shared web/mobile events and reproducible operating costs for MDU/workplace fleets. Brief: `docs/agent-prompts/2026-10-31-opus-cpms-architecture-investigation.md`; immutable task sent to Opus inbox. Andri approved Opus High with public research; the launcher now has an opt-in read-only research mode, checked by 18 passing local launcher tests. Preparing one fresh run with a 30-minute cap. No product implementation or external mutation is authorized. This review must inform architecture-dependent live-update work; existing onboarding review/testing remains outstanding.

**LEGACY CHECKLIST:** Written 2026-08-08 and retired as an active assignment
queue on 2026-10-26. It predates the August new-build SOW, which is now also
legacy. Its existing-surface onboarding and first-invoice goal must not direct
new work. Use the
[working scope rebaseline](docs/notes/2026-10-26-market-scope-reconciliation.md)
to create a new SOW, manifest and task list after reviewing current evidence.
Check the live checkout and handoffs before any Sonnet assignment.

**Milestone boundary adopted 2026-10-27:** S1 is a working pre-commercial
product; S2 develops/tests the invoice engine and validates sustained use;
S3 is separately approved commercial release. New assignments must name their
stage under `SOW-market-phase.md`. No first customer, real invoice, collection
or completed invoice engine gates S1. This notice does not reactivate the
legacy checklist below or create an implementation assignment.

Tracked checklist for [SOW-market-phase.md](./SOW-market-phase.md).
Rules: [FOCUS.md](./FOCUS.md) · State: [WORKSPACE.md](./WORKSPACE.md) · Log:
[DECISIONS.md](./DECISIONS.md)

## Current S1 assignment — 2026-10-29

- **2026-10-31 13:40 UTC — Sonnet Medium bulk Incoming/circuit assignment run started with Andri's individual approval.** Plan `f293b21f-99ff-4abd-9f3b-fa1ece292347`, 30-minute limit, background run. Scope: multiselect Incoming, editor-local To assign, drag/selector circuit assignment and zero-rating highlighting, existing APIs/save validation. Source-only; Codex tests/reviews afterward. Brief: `docs/agent-prompts/2026-10-31-s1-bulk-incoming-circuit-assignment.md`. No deployment or hardware operation authorized by this run.

- **2026-10-31 13:30 UTC — Real Zaptec BootNotification capture/disclosure VERIFIED LIVE.** After Andri enabled the URL, the authenticated Chargers page showed seven open Incoming connections. Expanded ZCS029401: full displayed body identifies Zaptec / ZapCharger Pro / firmware 3.2.2.0 / serial ZCS029401. No charger attached or charging command sent. Next: circuit assignment and reconnect/admission trial; sustained traffic behavior still unverified. Evidence and screenshot in the pending-live-release handoff.

- **2026-10-31 13:29 UTC — Pending onboarding deployed for controlled real-charger testing.** Andri approved the named staged release. Gateway `5cce9bd6` and shell `5bd1b2c4` independently confirmed at 100%; Pending enabled and reciprocal service binding metadata correct. Gateway health and sign-in redirect pass. Await Andri sign-in/URL confirmation for actual Zaptec boot-body capture and promotion checks; not yet hardware-verified. Evidence: `docs/agent-runs/2026-10-31/2026-10-31-pending-live-release.md`.

- **2026-10-31 13:23 UTC — Pending renewal corrections independently VERIFIED LOCALLY.** Sonnet's three-file run returned; Codex passed 144 gateway + 111 root tests, all four independent ownership/cooldown cases, and both typechecks. Both remaining reproduced failures are fixed. Evidence appended to `docs/agent-runs/2026-10-31/2026-10-31-pending-renewal-two-fixes-handoff.md`. Ready for release preparation; not deployed or hardware-proven. Existing scale/runtime limitations remain. No new model run.

- **2026-10-31 13:17 UTC — Andri approved one Sonnet High background follow-up for the two remaining renewal failures.** Scope: PendingMode, its maintained tests and one handoff; token-safe stale-renewal cleanup and attempt-time cooldown. Task: `docs/agent-prompts/2026-10-31-s1-pending-renewal-two-fixes.md`. Launcher start/result remains recorded in local runner state. No deployment/DB/charger action; Codex verifies after return.

- **2026-10-31 13:14 UTC — Background Sonnet ownership run returned; still partial, HOLD PENDING RELEASE.** Codex independently passed 138 gateway + 111 root tests and both typechecks. Prior ownership failures now pass, but two local tests reproduce stale creating renewal after close and missing attempt-time cooldown during a slow gate call. Exact evidence and bounded correction guidance appended to `docs/agent-runs/2026-10-31/2026-10-31-pending-connection-ownership-handoff.md`. No deployment/new model run; completion monitor deleted.

- **2026-10-31 12:54 UTC — Approved Sonnet High CLI run returned; HOLD PENDING RELEASE.** Original five regressions pass; Codex passed 118 gateway + 111 root tests and both typechecks. Two new local tests reproduce delayed old-close release of a replacement slot and an empty slot retained by two failed attempts. Follow-up is bounded connection ownership plus renewal-outage cooldown, prepared but NOT approved/launched. Review: `docs/agent-runs/2026-10-31/2026-10-31-pending-cli-correction-review.md`; task: `docs/agent-prompts/2026-10-31-s1-pending-connection-ownership.md`. No live changes.

- **2026-10-31 12:45 UTC — Codex independently reviewed the pending-onboarding corrections: HOLD RELEASE.** Focused checks pass (111 root, 91 gateway), but five new local regression cases confirm four gateway gaps: normal rechecks do not renew admission leases, failed rechecks repeatedly call the engine, prototype-named charger IDs bypass slot accounting, and rejected upgrades leave leases without sockets. Existing 100-body capture cap also creates a documented future CPO onboarding ceiling once those bodies belong to registered chargers. Live read-only metadata confirms Pending mode/reverse binding are not deployed. Review: `docs/agent-runs/2026-10-31/2026-10-31-pending-onboarding-second-review.md`; bounded gateway task prepared at `docs/agent-prompts/2026-10-31-s1-pending-gateway-final-corrections.md`, awaiting individual Sonnet High CLI approval. No new model run, product source edit or live mutation.

- **2026-10-31 11:42 UTC — Pending onboarding review: fixes queued, no release.** Codex independently passed 78 root + 77 gateway focused tests, then reproduced three missing cases in isolated local fixtures: early close of a replacement socket, hidden 26th connected candidate, and repeated engine calls for changing invalid boot bodies. Source review also flags destructive age-only capture pruning, incomplete resource caps, lost/truncated promotion notifications and missing credential-failure feedback. Follow-up remains the same Sonnet lane; bounded reconnect promotion is a candidate for hardware validation, not proof. Review and fix criteria: `docs/agent-runs/2026-10-31/2026-10-31-pending-onboarding-review.md`.

- **2026-10-31 11:40 UTC — Pending onboarding handoff RECEIVED, not release-approved.** Sonnet reports full boot capture, Incoming disclosure and restricted Pending sockets implemented locally; 4591 root tests and 280 gateway tests reported, with a root Vitest collection failure for the node:test mail script. Codex read the handoff and spot-checked source, confirming reconnect-based promotion without TriggerMessage, best-effort promotion recovery delayed up to six hours of retry activity, and a new shell service binding. Full independent review/testing and real-device trial remain outstanding; resource bounds, credential-error visibility and promotion design need review before release. Handoff: `docs/agent-runs/2026-10-31/2026-10-31-pending-onboarding-boot-capture-handoff.md`.

- **2026-10-31 12:45 UTC — Pending onboarding review fixes: SOURCE COMPLETE, LOCAL ONLY, NOT DEPLOYED, NOT HARDWARE-PROVEN.** Codex review items addressed: persisted capture budget (10 min) and hibernation-safe message window; real per-CPO admission gate (25 sockets); advisory-locked capture cap with body-only, registered-safe eviction (no whole-row deletion); batched presence (no cut at 25); per-generation deadline, OPEN-only presence and stale-async guards; durable activation intent in the attach transaction with recorded outcomes, bounded read-time retry and visible failure; credential refusals shown and self-clearing. 12 new tests run the SQL on real Postgres (PGlite) and fixed one bug. tsc, 176 root files/4624 tests, 13 gateway files/294 tests, build pass. No wall-clock timer for a lost activation signal (decision pending). Handoff: `docs/agent-runs/2026-10-31/2026-10-31-pending-onboarding-review-fixes-handoff.md`. Awaiting Codex review.

- **2026-10-31 11:35 UTC — Pending onboarding + full BootNotification: SOURCE COMPLETE, LOCAL ONLY, NOT DEPLOYED, NOT HARDWARE-PROVEN.** Unknown ids of an active CPO wait in a restricted `Pending` socket (gateway flag `PENDING_ONBOARDING`), the complete received BootNotification is captured in the existing discovery row (no migration) and shown by an icon disclosure on Incoming rows; connected candidates stay listed past 30 min via one bounded gateway presence read; save-after-commit signals the gateway, which re-reads registration and closes the pending socket so the charger reconnects through normal admission. Open: spec tension (OCPP 1.6 s4.2 says Pending channel SHOULD NOT be closed), no TriggerMessage, no operator notice for credential mismatch, no registered-charger detail UI. tsc, 175 root files/4591 tests, 13 gateway files/280 tests, build and real-component browser checks pass. Handoff: `docs/agent-runs/2026-10-31/2026-10-31-pending-onboarding-boot-capture-handoff.md`. Awaiting Codex review.

- **2026-10-31 — Pending onboarding + full BootNotification task queued for Sonnet.** Andri requests the restricted connection/Pending/circuit-assignment flow and a real full-payload inspection. Brief: `docs/agent-prompts/2026-10-31-s1-pending-onboarding-boot-capture.md`. Reuses the gateway, discovery read and installation save; includes connected-vs-expired discovery, full scoped capture, bounded low-OPEX waiting and verified promotion. Source/local checks first, then Codex review and controlled real-charger trial. No implementation or deployment by queuing; broader UI push remains separate.

- **2026-10-31 — Incoming reappearance USER-CONFIRMED.** Andri restored the OCPP URL and reports chargers appearing again, completing the user-observed disappearance/reappearance sequence. Independent follow-up browser inspection reached sign-in; identities/counts and duplicate-free reuse remain unverified. Next onboarding step is attaching one chosen Incoming charger to an installation circuit and verifying its accepted connection/BootNotification. No attachment or charger command performed in this follow-up.

- **2026-10-31 01:22 UTC — Incoming expiry + Refresh LIVE.** Independently reviewed, 326 focused tests and production build/package/dry-run passed. Existing shell version `cea275fb-20d5-4a8b-a83d-780130033aff` confirmed at 100%. Live reload hides the 20 stale candidates; manual Refresh completes successfully. No new endpoint, discovery polling, migration, gateway or hardware change. Fresh real-charger reappearance awaits Andri re-enabling the previously working URL. Evidence: `docs/agent-runs/2026-10-31/2026-10-31-incoming-discovery-live-release.md`. This supersedes the local-only status below; push/OPEX follow-up remains separate.

- **2026-10-31 — consolidated Opus follow-up now queued: final OPEX implementation check.** Covers the five fixes, lost-final-update recovery, admission-cache invalidation, scaling and the well-below-$1 operating-cost target together. Extends the existing read-only review; requests a bounded GO WITH FIXES/BLOCKED verdict and tests for the first status slice, with telemetry and discovery follow-ons separated. Mail subject `Final bounded check: OPEX implementation, reliability and scaling`. Awaiting manual Got mail dispatch; no code/deployment and no new Sonnet lane.

- **2026-10-31 — all-in recurring unit-cost target clarified: well below USD 1 per connector/month.** Include attributable cloud, invoicing/collection, email/domain, support/accounting and other recurring operations. Existing cloud-only estimates do not prove compliance. Quantify workload/fleet/CPO count, headroom and measured costs before claiming the target is met; no budget increase or provider purchase approved.

- **2026-10-31 — billing findings recorded; Opus push review received.** Service-fee invoicing research (Konto candidate, published costs, no provider selected) is in `docs/notes/2026-10-31-service-fee-invoicing-findings.md`. Opus supports shared push with bounded fixes; Codex confirms value-carrying/scoping/repeat-query findings but flags lost-final-event recovery and source/cost corrections in `docs/agent-runs/2026-10-31/2026-10-31-codex-push-review-triage.md`. No push implementation dispatch or deployment.

- **2026-10-31 — Opus low-OPEX live-push review prepared.** User requested a focused review before implementation: shared web/mobile push without periodic UI status polling or per-viewer Neon reads per event; retain required session evidence and reuse the existing gateway/hub/outbox. Brief: `docs/agent-prompts/2026-10-31-opus-low-opex-live-push-review.md`. Read-only review, not a new Sonnet coding lane or infrastructure approval; Incoming expiry remains local and awaiting review/release.

- **2026-10-31 — Incoming inactivity window + manual Refresh queued for Sonnet.** Initial 30-minute last-recorded-knock window, hide expired unknown candidates and re-show the same row once after a new recorded knock. Retain evidence, existing endpoint/attachment path and ingress/write limits; no polling or new service. Brief: `docs/agent-prompts/2026-10-31-s1-incoming-discovery-expiry.md`. Not implemented/live by queuing.

- **2026-10-30 23:56 UTC — fully collapsed default LIVE.** User clarified sites must also start collapsed. Codex applied the small default-state correction after Sonnet's completed handoff; rebuilt, packaged, dry-ran and published existing shell version `c4d93492-e667-4769-a777-1f8826664497`. Live reload and site toggle confirmed; sidebar retained, no data-access change.

- **2026-10-30 23:53 UTC — Incoming styling and expandable Installations LIVE.** Reviewed, independently tested (212 tests/build/package/dry-run), published to existing shell version `ac70ae6c-34c9-41f6-b98b-b3da5bb9c100`, confirmed 100%. Live collapsed default, detail expansion, sidebar and Incoming Attach navigation verified; no registration/save. Evidence: `docs/agent-runs/2026-10-30/2026-10-30-installation-tree-live-release.md`.

- **2026-10-31 00:12 UTC — Incoming discovery expiry + manual Refresh: SOURCE COMPLETE, LOCAL ONLY, NOT DEPLOYED.** Unregistered incoming rows are listed for 30 minutes after their last recorded knock (shared server read, injectable clock; recovery rows not expired); Incoming shows Last seen and a Refresh that reuses `GET /api/cpo/installations?incoming=1` (response gains `asOf`/`windowMs`). Zero-network local expiry timer; no new endpoint, write, migration or polling. tsc, build, 326 focused tests and browser evidence pass. Handoff: `docs/agent-runs/2026-10-31/2026-10-31-incoming-discovery-expiry-handoff.md`. Awaiting Codex review.

- **2026-10-30 23:49 UTC — Incoming styling + expandable Installations tree: SOURCE COMPLETE, LOCAL ONLY, NOT DEPLOYED.** Incoming restyled to the compact flat table; /cpo/installations is now a Site > Installation > Circuit > Charger tree, collapsed by default, reusing the existing list read (+siteId) and GET /api/cpo/installations?id= once per first expansion. Endpoint inventory unchanged. tsc, build and 212 focused tests pass; browser call-count harness and screenshots recorded. Handoff: `docs/agent-runs/2026-10-30/2026-10-30-incoming-styling-and-installation-tree-handoff.md`. Awaiting Codex review.

- **2026-10-30 — refined Installations visual approved.** Andri accepted the compact continuous tree in `current-installations-preview.html`; the existing expandable Installations brief now names this reference and its screenshot. Same Sonnet lane and endpoint-reuse scope; this records visual approval, not implementation or deployment.

- **2026-10-30 23:33 UTC — expandable Installations task queued for Sonnet, after Incoming styling in the same lane.** Adopt Site → Installation → Circuit → Charger overview; reuse current list and installation detail endpoint, loading once on expansion with no per-child requests or new polling. Preserve editor/drafts/Attach. Brief: `docs/agent-prompts/2026-10-30-s1-expandable-installations.md`. Not implemented or deployed by queuing.

- **2026-10-30 — Incoming styling follow-up queued for Sonnet.** The deployed grouping changed registered rows only, leaving the visible Incoming table in the old large card. Adapt Incoming to the approved compact local preview with shared styling; keep its existing read, CPO scope and Attach flow. Presentation only: no new API, fetch, query, polling or onboarding path. Named mailbox task `codex-to-sonnet-incoming-table-styling`; not implemented or deployed by queuing.

- **2026-10-30 23:25 UTC — grouped charger-list release LIVE.** Existing shell version `a685a841-b35d-4429-b23c-98cc7e8a157f`, verified 100% deployment. Build/package/dry-run passed. Real page retains 20 Incoming entries; Attach reaches installation selection. No registered chargers yet, so populated grouping remains locally verified only. No assignment, charger command, migration or Git publication. Evidence: `docs/agent-runs/2026-10-30/2026-10-30-grouped-chargers-live-release.md`.

- **2026-10-30 23:22 UTC — grouped charger handoff read and source checked by Codex.** Three grouping tests independently pass; production `npm run build` (including TypeScript) passes with database URLs empty. No deployment. Sonnet reports 4531 passing tests plus the existing `sonnet-mail.test.mjs` collection failure; that wider run is not wholly green. Broader gateway/OPEX follow-up remains unstarted, separate from the live ingress guard.

- **2026-10-30 23:11 UTC — grouped charger-list presentation approved; queued for the existing Sonnet lane.** Use the first local preview (archived operator table), adapt installation/circuit grouping to current data and preserve Incoming/Attach. No added polling, APIs or legacy runtime. Brief: `docs/agent-prompts/2026-10-30-s1-grouped-charger-list.md`. Not implemented or deployed by queuing; reconcile ongoing OPEX work first.

- **2026-10-30 23:05 UTC — real OCPP discovery LIVE AND VERIFIED.** Missing gateway/custom domain fixed: `straumvakt-ocpp-s1` version `3bcc12a6-bf40-4028-a3c4-476ebbcfde19` serves `test-cpo.straumvakt.org` with pre-engine host/identity limits. Six real knocks first observed, then 20 distinct Incoming identities verified in the real browser. None assigned; accepted socket/Boot/charging remain unverified. Shell copy correction deployed as `37bcb665-8d9f-453d-9587-2d034fe70496`. Details/limits/rollback: `docs/agent-runs/2026-10-30/2026-10-30-gateway-live-discovery.md`. Repeat-DB suppression and pending-socket/liveness follow-up remain; approximate platform rate limits are not a global spending cap.

- **2026-10-30 22:49 UTC — installation web creation LIVE AND VERIFIED.** User-approved 0008/0009 rehearsed/rolled back then applied on existing development Neon; Test CPO associated; existing CPO shell deployed as `2be586b2-602d-40b4-95c5-d3283fcff5e9`. Real browser created Test site + Installation save test + one 0 A circuit, listed and reopened with TN/3 phases/CB persisted; scoped SQL confirmed. Focused 242 tests and build/package/dry-run passed. No gateway/hardware change; traffic protection still separate. Details: `docs/agent-runs/2026-10-30/2026-10-30-installation-web-live-test.md`.

- **2026-10-30 — gateway traffic/OPEX protection prioritized before live exposure; follow-up queued for Sonnet.** Bound excessive retries before engine/Neon access, unique-identity floods and log/storage amplification; show discovery once without repeat counters. Preserve attachment and lifecycle correctness. First scope is protection of the existing route with measured local call counts; restricted pending sockets and on-demand liveness need a separate explicit implementation boundary and cost assessment, not an unbounded side effect. No live changes by queuing.

- **2026-10-30 23:20 UTC — grouped charger list: SOURCE COMPLETE, LOCAL ONLY.** `/cpo/chargers` now groups installation → circuit by stable id with the existing status mechanism; proof and limits in "Follow-up 4" of the installation form-fixes handoff. Not deployed. The queued gateway traffic/OPEX task (`20261030-224005Z`) was NOT started: Codex took the ingress slice and asked for no overlapping gateway lane.
- **2026-10-30 22:35 UTC — TN/IT row and incoming/manual charger attachment: SOURCE COMPLETE, LOCAL ONLY, NOT LIVE.** Record: "Follow-up 3" in `docs/agent-runs/2026-10-30/2026-10-30-installation-form-fixes-handoff.md`. TN/IT is a new nullable `main_grid_type` with an additive reviewed migration `0009` (not applied; 0008 still an unapplied candidate and must be applied first). Incoming candidates come from the existing `ocpp.pending_discoveries`, scoped to the workspace CPO (`CPO_SHELL_ORG_ID`), and attach through the one existing installation save. Checked on the in-memory store and in a database-free browser harness only: no PostgreSQL, gateway or hardware evidence. Remaining before live: set `CPO_SHELL_ORG_ID`, apply 0008 then 0009 on an approved target, and the real-charger sequence in the handoff.
- **2026-10-30 — electrical row follow-up QUEUED for Sonnet (now implemented, see above).** User specifies one main installation row ordered **TN/IT → Phases → CB → Rating (A)**. Add TN/IT selection with persisted/draft round-trip and preserve unknown historical values; no automatic voltage inference or extra voltage controls. Incorporate in the existing Sonnet lane alongside incoming charger attachment; not implemented or deployed by queuing.

- **2026-10-30 — manual and incoming charger attachment QUEUED for Sonnet.** Brief: `docs/agent-prompts/2026-10-30-s1-incoming-charger-attachment.md`. User confirmed both entry routes: typed OCPP identity or an already-knocking candidate, attached to a circuit in an installation through one shared registration path. Expose CPO-scoped incoming candidates, preserve admission/lifecycle/identity history and prevent duplicates. Source work and safe local checks; not started or live merely by queuing.

- **2026-10-30 — exact installation-form trimming queued for Sonnet.** `20261030-215405Z-codex-to-sonnet-installation-form-trim`: remove repeated prose, required legend beside title, one password label, Create Site + dropdown action, circuit-add button after list, new capacity defaults to 0. Preserve historic unknown values and draft/account-context behavior.

- **2026-10-30 — form context/order correction queued for Sonnet after visual review.** `20261030-213909Z-codex-to-sonnet-installation-form-context-correction`: remove CPO selector from account-scoped installation flow; OCPP URL first, installation/electrical structure together, electrician last; optional protection-type dropdown; remove physical-effective-date input from creation. Account/test-CPO association must be established honestly outside the form. Local-only implementation.

- **2026-10-30 — installation form fixes QUEUED for Sonnet.** Brief `docs/agent-prompts/2026-10-30-s1-installation-form-fixes.md`, mail `20261030-210159Z-codex-to-sonnet-installation-form-fixes`. One optional password field with safe edit behavior; established CPO context; consolidated electrical tree; draft leave/discard and conflict recovery. CPO-only routing source handoff received, not independently runtime verified; migration/deployment remain outstanding.

- **2026-10-30 (late evening) — CPO-only OCPP routing: SOURCE DONE, NOT LIVE, MIGRATION 0008 NOT APPLIED.** Dispatched by “Got mail” (`20261030-201617Z-codex-to-sonnet-cpo-ocpp-routing`, brief `docs/agent-prompts/2026-10-30-s1-cpo-ocpp-routing.md`). Chargers now connect to `wss://{cpo-id}.straumvakt.org/{charge-point-id}`: route parsing, gateway routing, admission lookup, identity storage, registration, lifecycle return/removal and the sync/editor reads were changed together; the installation is derived from the charger’s registered placement; same id in two CPOs is isolated and one CPO cannot hold an id twice across installations (exclusion constraint). Unfinished forms are saved as revision-checked drafts (whole form, never a password) and the editor runs one server action at a time. Migration 0008 was REWRITTEN before it was applied. Local tests, typecheck and build pass; **PostgreSQL behaviour, the gateway on Workers, the editor in a browser and hardware are all UNVERIFIED.** Rollout order: rehearse 0008 in a rolled-back transaction, check 0008’s real state on the target, apply, then deploy code, then the gateway. Handoff: `docs/agent-runs/2026-10-30/2026-10-30-cpo-ocpp-routing-handoff.md`.

- **2026-10-30 (evening) — SUPERSEDED by the CPO-only URL entry above (the installation-key reservation and its migration were replaced); kept for the record.** Installation OCPP address during creation: SOURCE DONE, NOT LIVE. Dispatched by “Got mail” (`20261030-192949Z-codex-to-sonnet-installation-address-draft`). The key is reserved server-side when the CPO is chosen (new `properties.installation_key_reservations`, which is also the resumable draft), shown as `wss://{cpo-id}.straumvakt.org/{installation-key}/` with each charger’s full address under it; a failed save keeps the key; Cancel closes only the reservation; changing CPO discards the draft after confirmation. Local tests and build pass; PostgreSQL behaviour, the editor in a browser, and the concurrent-request paths are UNVERIFIED. **Apply migration 0008 before deploying this code or installation saves fail.** Handoff: `docs/agent-runs/2026-10-30/2026-10-30-installation-address-draft-handoff.md`.

- **2026-10-30 — CPO web editor deployed, pending authenticated verification.** With Andri's explicit authorization, set `DATABASE_URL` on `straumvakt-cpo-shell`, deployed version `d29cca11-a9d9-4d5f-9eff-9d865a03843b` to the existing domains after build, asset pruning and dry-run. Login redirect verified; no authenticated save or charger connection verified. This deployment includes the local, uncommitted BootNotification observation change. Details: `docs/agent-runs/2026-10-30/2026-10-30-first-charger-connection-prep.md`.

- **2026-10-30 — first charger connection prioritized.** Proposed separate gateway configuration locally; gateway dry-run passes and local no-database smoke returns 200 health/503 admission. No cloud deployment or charger setup yet. Need the selected physical charger, OCPP identity and Portal access; see `docs/agent-runs/2026-10-30/2026-10-30-first-charger-connection-prep.md`.

- **2026-10-30 — onboarding build check.** `npm run build`, OpenNext build using `wrangler.cpo-shell.jsonc`, and Wrangler shell `--dry-run` now pass locally. The dry run does not deploy or prove Workers RPC; it contains no database/gateway bindings, and generated assets have not been pruned for release. A gateway and real registration/connection remain outstanding; see `docs/agent-runs/2026-10-30/2026-10-30-first-charger-postgres-validation.md`.

- **2026-10-30 18:53 UTC — approved development PostgreSQL migration applied; partial validation.** Project `silent-thunder-69180957`, primary branch `development`, database `neondb`: `citext` prerequisite and migrations 0000–0007 applied atomically after a rollback-only rehearsal. Eight ledger entries and expected trigger/index read back. Rolled-back synthetic checks verified immutable terms and one-open-request uniqueness; a two-connection row-lock conflict was observed and its temporary placement deleted. This is not the complete application concurrency suite, a Workers test or a charger test. See `docs/agent-runs/2026-10-30/2026-10-30-first-charger-postgres-validation.md`.

- **2026-10-30 — local first-charger checkpoint committed, not deployed.** `7a0cf3a` on `fix/drizzle-unique-constraints-2026-10-26` contains the CPO/gateway/lifecycle/costing candidate and migrations 0001–0007. Focused review plus 4,164 root tests passed (1 skipped), gateway 219 passed; PostgreSQL/Workers/hardware unverified. Other pre-existing changes remain dirty. Read-only Neon metadata found project `silent-thunder-69180957`, primary branch `development`, database `neondb`, role `neondb_owner`, default isolation READ COMMITTED and no non-system tables; this does not authorize migrations or establish an isolated test target.

- **2026-10-30 — Codex review follow-up, local only.** Fixed refused starts marking an active session superseded; unconfirmed older sessions now block charger closure and stay `needs_attention` until real stop evidence; plain-save guard includes them. Focused 236 tests and root typecheck pass. No operator reconciliation path, PostgreSQL concurrency verification, Workers or hardware run; terms capture consistency remains open. Details: `docs/agent-runs/2026-10-30/2026-10-30-codex-first-charger-integrity-review.md`.

- **2026-10-30 (night) — first-charger integrity: FIVE ITEMS ADDRESSED IN SOURCE, NOT LIVE.**
  Dispatched by "got mail" (`20261030-181247Z-codex-to-sonnet-first-charger-integrity`).
  Duplicate-request race (rollback + re-authorised resume, conflicting payloads); start-vs-removal-vs-close
  serialisation (placement FOR SHARE/UPDATE, lock order installation->placement, model-checked; stale-socket
  start refused); superseded sessions non-gating but unconfirmed/held (no fabricated stop); immutable terms
  snapshot at start + DB trigger (migration 0007) with costing reading only the snapshot; closed-identity
  attempts logged. Local: root 4162 passed, gateway 219, tsc clean, adopted-schema check OK. NOT verified:
  any PostgreSQL behaviour (locks, constraints, trigger, isolation), Cloudflare, hardware. Handoff:
  `docs/agent-runs/2026-10-30/2026-10-30-first-charger-integrity-handoff.md`. Untracked-increment risk and
  open decisions are listed there (section 9).
- **2026-10-30 18:12 UTC — first-charger integrity and release preparation QUEUED for Sonnet, not confirmed running.** Brief: `docs/agent-prompts/2026-10-30-s1-first-charger-integrity.md`; mail `20261030-181247Z-codex-to-sonnet-first-charger-integrity`. Andri dispatches it by telling Sonnet “Got mail.” Source work and safe local verification; no database, deployment or hardware action authorised. It follows Opus's lifecycle review and Codex's unresolved concurrency assessment.

- **2026-10-30 (evening) — installation/charger lifecycle: SAFE INCREMENT DONE, PARTIAL, NOT LIVE.**
  Dispatched by "got mail" (`20261030-171113Z-codex-to-sonnet-installation-charger-lifecycle`).
  Guarded charger removal (delete during a session -> block starts, RemoteStop, pending until
  durable stop, close, settle via costing), known-device return, engine start-block, gateway
  stop command, `POST /api/cpo/lifecycle`, migration 0006, plain-save detach guard. Local:
  root 4120 passed, gateway 219 passed, tsc clean. NOT done: editor wiring, cross-installation
  transfer, installation close, terms/payer version sealing, PostgreSQL/Cloudflare/hardware
  verification. Handoff: `docs/agent-runs/2026-10-30/2026-10-30-installation-charger-lifecycle-handoff.md`.
- **2026-10-30 17:11 UTC — installation and charger lifecycle QUEUED for Sonnet, not confirmed running.** Andri asked Codex to send the prepared assignment. Brief: `docs/agent-prompts/2026-10-30-s1-installation-charger-lifecycle.md`; mail `20261030-171113Z-codex-to-sonnet-installation-charger-lifecycle`. Say “Got mail” to Sonnet to dispatch it. Deleting a charger during an active session must initiate a stop and settle with the driver, subject to confirmed closure and evidence. Source and safe local tests only; no database, deployment or hardware action authorised. The prior OCPP handoff remains unverified on runtime and hardware; reconcile before editing.

- **2026-10-30 — OCPP engine completion continuation: SOURCE INTEGRATION DONE, NOT LIVE.**
  Dispatched by "got mail" (`20261030-003100Z-codex-to-sonnet-ocpp-engine-completion`).
  Engine hosted as a named WorkerEntrypoint on the shell Worker (RPC, no public route);
  legacy gateway routes gated off by default; `/api/cpo/sync` mounted + chargers-page
  live state; cross-instance version hub (optional binding); costing consumer over the
  retained resolver (migration 0005); `npm run check:adopted-schema`. Local: root 4081
  passed, gateway 210 passed, tsc clean. Handoff:
  `docs/agent-runs/2026-10-30/2026-10-30-ocpp-engine-completion-handoff.md` (section 9
  lists unmet criteria). NOT verified: Cloudflare entrypoint/RPC/DO behaviour, PostgreSQL
  execution of 0000-0005, OCPP conformance, hardware. No commit/push/deploy/DB/secret action.
- **2026-10-30 00:31 UTC — OCPP completion continuation QUEUED, not confirmed running.**
  Andri clarified Sonnet is idle after the partial handoff. Codex checked the
  canonical branch/HEAD, one worktree, 91 dirty entries and latest mail, and queued
  `docs/agent-prompts/2026-10-30-s1-ocpp-engine-completion.md` via
  `20261030-003100Z-codex-to-sonnet-ocpp-engine-completion`.
  Say "Got mail" to Sonnet to dispatch this named continuation: source wiring,
  shared cache/delta integration, costing consumer and corrected validation/release
  preparation. Codex independently passed 105 engine/sync and 200 gateway tests;
  initial review records remaining gaps. No deployment, Neon access, test database,
  secrets, hardware or Git publication authorized. Earlier queued/running statuses
  below are historical; this continues the partial engine assignment.

- **2026-10-29 (late) — generic OCPP engine and delta contracts: SOURCE IMPLEMENTED, NOT LIVE.**
  Dispatched by Andri's "got mail"; receipt `20261029-232244Z-codex-to-sonnet-generic-ocpp-engine-and-deltas-sonnet`.
  Checkpoints A–D implemented at logic/contract level with database-free tests
  (root 293 passed across the affected set, gateway 200 passed, both `tsc` clean).
  Handoff: `docs/agent-runs/2026-10-29/2026-10-29-generic-ocpp-engine-and-delta-handoff.md`.
  Migrations 0003 + 0004 prepared, applied nowhere. NOT verified: PostgreSQL behaviour,
  Workers runtime, OCPP spec fidelity against OCA documents, hardware. NOT done (see
  handoff §9): mounting the internal/sync routes, engine-mode command dispatch and
  liveness, costing hand-off consumer, operator reconciliation view, driver/access
  enrolment workflow (live acceptance is gated on it), editor/mobile wiring. No commit,
  push, deploy, secret, database or hardware action was taken.
- **23:22 UTC NEXT TASK QUEUED — generic OCPP engine and incremental data contracts.**
  Andri requested Sonnet's next task after scope review and the caching/delta discussion.
  Active assignment: `docs/agent-prompts/2026-10-29-s1-generic-ocpp-engine-and-delta-contracts.md`.
  Mail: `20261029-232244Z-codex-to-sonnet-generic-ocpp-engine-and-deltas`.
  Andri saying "Got mail" to Sonnet dispatches this named source/test task under
  docs/AGENT_MAIL.md; no second generic start confirmation. Execution not yet
  confirmed. No new unread Codex mail or later Sonnet assignment at preparation.
  Sequential checkpoints: scoped admission/access; durable correct sessions;
  integration/failure tests/release manifest; server cache/snapshot/delta contracts.
  Generic OCPP, Drizzle only, no test DB, cloud/hardware/deploy/Git operations.
  Standard smart-charging contracts included; allocator, full mobile rewrite and
  visual redesign excluded. The $30/month estimate has NOT been approved.
  Supersedes earlier engine "draft only" status below; those entries are history.
  Installation-management source handoff remains awaiting independent acceptance
  and operational verification/release, not undone or silently accepted by this task.

- **23:05 UTC engine task design (Codex):**
  `docs/agent-prompts/2026-10-29-generic-ocpp-engine-first-increment-REVIEW.md`
  proposes the first generic engine increment: scoped admission/current access,
  reliable transaction/context evidence, Drizzle integration and failure tests.
  Replaces the three-file B0 recommendation for review purposes; does not dispatch
  Sonnet. Carries smart-charging contracts forward without making a full allocator
  a prerequisite. Main product decisions are settled; offline hardware policy and
  exact release/cost operations remain later verification/approval items.

- **22:44 UTC engine draft received (Codex):** Opus supplied
  `docs/agent-prompts/2026-10-29-ocpp-engine-alignment-DRAFT.md` and confirmed
  its placement in follow-up mail. Draft only; not accepted for implementation.
  Proposed batches B0–B5 require review of Drizzle/installation dependencies,
  profile-clearing safety, event attribution and test-evidence limits before
  any new Sonnet assignment. Existing optional-credential and enforced-driver
  trial decisions must be carried forward. Visual review of the installation
  form can proceed separately; this does not authorize a preview deployment.

- **22:12 UTC coordination update (Codex):** Sonnet's installation handoff
  received and read; source/build/test success is reported by Sonnet, not yet
  independently accepted by Codex. Persistence and deployment remain unverified.
  Opus is being asked to draft the subsequent OCPP engine assignment, covering
  protocol conformance, Durable Object/Queue reliability, smart-charging design
  and integration with these installation contracts. **Draft for review only;
  do not start new Sonnet work.** Resolve the old Prisma-mirror check against
  Drizzle authority rather than assuming a Prisma mirror is required; also
  review the separate installation history table against the shared audit design.

- **Live installation management and charger registration:** Andri requested
  the [thorough Sonnet assignment](docs/agent-prompts/2026-10-29-s1-live-installation-management.md).
  Implement one-page persisted installation/circuit/subcircuit/charger editing,
  generated connection details, electrician contact and revision-aware audit.
  Shared Straumvakt login is the web audit actor. Email review is deferred and
  not enforced now; no wizard, commissioning stage or activation checklist.
- **Delivery:** intended for the existing live web UI; no local-only prototype,
  fixture persistence or test database. Prepare real Drizzle/backend implementation
  and the exact existing-target migration/deployment/cost package before operational
  execution. Gateway communication is a subsequent task using the same contracts;
  do not claim the generated OCPP URL is active or enable hardware now.
- **Dispatch status (19:27 UTC):** queued in Sonnet's mailbox, not confirmed
  running. Opus receives the same current requirements/status. Earlier shell
  assignment is completed; older multi-org assignment remains deferred. No
  concurrent coding lane has been created. October 29 decisions supersede earlier
  UI commissioning/activation requirements for this increment.
- **21:12 UTC clarification:** Sonnet's receipt records `needs-user-input` after
  reading the assignment because the mailbox wording appeared to prohibit starting.
  Codex clarified the named-assignment dispatch rule and queued a follow-up. The
  intended implementation is already user-requested; perform the live checkout
  check and begin within the prompt's source/test boundaries. No execution is yet
  confirmed and no database/deployment authority has been added.
- **Status 2026-10-29 ~21:40 UTC (Sonnet, VS Code): source implemented, NOT live.**
  Andri dispatched the work in chat; mail receipts written. Implemented and
  locally verified: migration `0002_installation_management` (reviewed, **not
  applied anywhere**), Drizzle store/service/API (`/api/cpo/installations`,
  `/api/cpo/directory`), one-page editor, chargers list, policy/edge allow-list
  updates. 47 new + 188 affected tests pass; `next build` and the OpenNext
  bundle succeed with no Prisma/Hyperdrive in the bundle. **Not verified:** any
  PostgreSQL behaviour (no database was contacted), real persistence, deployment.
  Awaiting Codex: exact execution manifest in
  `docs/agent-runs/2026-10-29/2026-10-29-installation-management-handoff.md`.
  Open: `check:schema-consistency` fails until the Prisma mirror is updated or the
  check is waived (Prisma not touched, per "no new Prisma").

## Completed S1 shell assignment — 2026-10-27 (historical checkpoints)

- **CPO shell, first increment:** Sonnet is assigned local implementation of
  the existing visual shell with server-side test login, protected pages,
  logout, honest empty states and disabled unconnected operations. See
  [the scoped assignment](docs/agent-prompts/2026-10-27-cpo-shell-first-increment.md).
  Return tested local changes and an exact deployment proposal for review;
  no Git publication, cloud mutation, database write or live charger action.
  The earlier unstarted multi-org test assignment remains deferred and is
  not a concurrent task. This entry does not reactivate the legacy queue below.
  **Status 2026-10-27 22:26 UTC:** implemented locally and tested (uncommitted,
  HEAD `15c036f`); handoff in
  [the run report](docs/agent-runs/2026-10-27/2026-10-27-2226-cpo-shell-first-increment-handoff.md).
  **Later checkpoint:** Andri approved publication to www.straumvakt.org;
  deployment, edge asset filtering and login throttling completed. Live login
  and logout verified. Andri rejected the selected visual shell: restore the
  original console's visual styling and homepage design, keeping
  current authentication and empty/unconnected states. UI correction remains
  outstanding and must stay database-free. See WORKSPACE.md for deployment
  identity and the read-only Neon cost checkpoint.
  **Presentation direction subsequently accepted:** preserved car-artwork homepage
  and simplified flat CPO navigation; the expandable tree remains a reference.
  Local clickable subpages are illustrative only. Next proposed increment is
  integrating this presentation with the existing authenticated shell, preserving
  empty/unconnected production states.
  **Next assignment queued 2026-10-27 23:04 UTC:**
  [approved homepage and flat shell](docs/agent-prompts/2026-10-27-s1-approved-homepage-and-flat-shell.md),
  delivered to Sonnet's local inbox. Strictly no Neon or other external service
  work; preserve authentication, route/asset filtering and rate limiting. Local
  implementation and tested release handoff only. Awaiting manual "Got mail"
  wake-up; not confirmed running. Older multi-org work remains deferred.
  **Completed and published 2026-10-27 23:30 UTC:** Sonnet continued the
  interrupted implementation; Codex reviewed, checked and deployed the approved
  shell. Both www and apex are attached; apex redirects to www (DNS caches may
  briefly lag). No Neon access. This closes presentation integration only;
  connected onboarding and real scoped identities remain subsequent S1 work.
  See the [release evidence](docs/agent-runs/2026-10-27/2026-10-27-2332-approved-shell-release.md).
  **Status 2026-10-27 23:30 UTC:** implemented locally and verified (uncommitted,
  HEAD `15c036f`, nothing deployed): car-artwork homepage at `/signin`, flat
  navigation, eight protected `/cpo` routes with honest unconnected screens,
  exact asset allowlist (car AVIF/WebP + logo icon). 88 focused tests, root
  typecheck, build and local packaging pass; no external service contacted.
  Pending: browser check of the sticky desktop sidebar and Codex's release.
  See [the handoff](docs/agent-runs/2026-10-27/2026-10-27-2330-approved-homepage-flat-shell-handoff.md).

**The objective, in one sentence:** get one real organisation to a correct
invoice, from a clean production environment.

---

## How to read this

**Priority order is not strict serial order.** Two tracks run in **parallel**:

```
NOW ──┬──► TRACK A (money) ──────────┐
      │                              ├──► GO-LIVE ──► EXPAND
      └──► TRACK B (environments) ───┘
```

They converge at the **GO-LIVE** gate. Nothing in Track B waits on Track A, or
the reverse.

**Gates** are marked inline and mean *stop and get a decision*:

| marker | meaning |
|---|---|
| `[GATE: design approval]` | Rule 5 — design presented, approved, before code |
| `[GATE: parity green]` | the harness must match before an old path retires |
| `[GATE: deploy go-ahead]` | Rule 1 — no deploy without an explicit yes |
| `[GATE: secret go-ahead]` | Rule 2 — operator sets the value; never written here |
| `[GATE: prod go-ahead]` | production is touched only on an explicit yes |

**Blockers are not gates.** A gate is a decision someone has to make; a
`[BLOCKER]` is a known defect that makes a task's acceptance criterion
un-meetable until it is fixed. A task carrying one cannot be ticked, however
much of its build work is finished.

**By-product work is not a task.** Drizzle conversion of touched files, the
vendor ratchet trending to 0, and per-context harvesting all happen **inside**
the tasks below. There is no porting sprint and no "finish the migration"
item — that is what FOCUS.md rule 1's exception is for.

**Each task runs from its own prompt** and honours its own stops.

---

## NOW — foundation

- [x] **1. Commit the contracts harvest.** Gates verified green: tsc, build,
      dependency-cruiser (baseline still 24, none added), every existing
      `@straumvakt/shared` import resolving through the re-export shim, and the
      two new pieces present — the general money-line shape
      (`{whoseMoney, posture, counterparty}`) and the vendor-adapter interface.

- [~] **2. Housekeeping** — code and docs done; one operator action outstanding.
  - [x] 2a. Admin credential **prepared**. Verified binding-only: no fallback in
        either auth path, no value in any worker config, and `.env.example`
        defaults blanked — that template was the actual source.
        `[GATE: secret go-ahead ✅ cleared]`
        **→ OPERATOR: set `ADMIN_PASSWORD` on hlada · hlada-staging ·
        hlada-api · hlada-api-staging. Then I verify the path on dev.**
  - [x] 2b. Canon reconciled — WORKSPACE.md trued to measured numbers,
        three wrong seed lines recorded.
  - [x] 2c. `SERVICES.md` — full register; invoice rail and Dev-tier cost
        flagged **PENDING**, not picked.
  - [x] 2d. Work view built at `/admin/work`, generated from WORKSPACE.md,
        admin-gated. `[GATE: deploy go-ahead ✅ cleared — option C]`
        No domain wired; ships by normal branch promotion.
  - [x] 2e. straumvakt.org cleanup — **nothing moved**. 66 of 88 assets are
        referenced; the 22 that are not are runtime-loaded Flutter output.
        Repoint deferred to task 10.

---

## TRACK A — money pipeline  *(Rule 5 throughout)*

- [ ] **3. Approve the money-engine design** — harvest plan, invoice ledger,
      flat-fee line, parity plan.
      `[GATE: design approval]`
      *Drafted: `docs/notes/2026-08-08-commercial-harvest-and-invoice-ledger-design.md`.
      One open question in it: add `per_connector` to `RATE_BASES` (recommended)
      vs reuse `per_day`.*

- [ ] **4. Build the parity harness** — 1,621 legacy `session_ledger` rows +
      the 64 test-branch priced sessions (128 lines). Includes a vacuity guard.
      **Built and green before any file moves.**

- [ ] **5. Harvest the resolver into `packages/commercial`** — copy-then-
      strangle; the old path keeps running.
      `[GATE: parity green before retiring the old path]`

- [ ] **6. Build the line-agnostic invoice ledger** — lines carry the money-line
      tag; invoices group by *(claim holder, counterparty, period)*; **lines of
      different posture never share an invoice**, because the header is the
      legal artefact.

- [ ] **7. Build the flat-fee principal line → invoice** — Straumvakt↔host,
      one factor, per-connector × count, monthly. No CDR, no attribution.
      Re-priceable at renewal via a time-boxed rate reference.

- [ ] **8. Scope and wire the invoice delivery + collection rail** — email/PDF
      and/or the Icelandic kröfu claim system.
      **Currently unscoped, and market-critical: the pipeline is not done until
      the host can receive and pay.**

---

## TRACK B — environments  *(parallel with Track A)*

- [ ] **9. Stand up the shared Dev tier** — prove the deploy and migration flow
      end to end.
      `[GATE: deploy go-ahead]`
      *Cost delta (extra Neon branch + Workers + Fly app) is a number to decide
      — see `SERVICES.md` when it lands.*

- [ ] **10. Per-service path-scoped deploys** — a push touching one app
      rebuilds one app. **The gateway's charger-facing hostname is preserved
      (S0)** — 21 chargers hold live WebSockets against it.
      `[GATE: deploy go-ahead]`

- [ ] **11. Clean Prod from migrations + clean seed + data hygiene.**
      `[GATE: prod go-ahead]`

---

## ONBOARDING

- [ ] **12. Admin-onboard customer 1** on the existing surface. Deliberately
      *not* gated on self-serve — the invoice must not wait for it.

- [ ] **13. Self-serve onboarding — BLOCKED** — self-enrol → invite users →
      attach chargers → flat-fee agreement. One path, not seven.
      `[BLOCKER: invite codes are bearer-only]`
      **Acceptance — "an org completes self-enroll to a flat-fee agreement
      without hand-setup" — cannot be met while this holds.** The invite step
      of that path is not merely incomplete, it is unsafe:
      `POST /api/driver/redeem-invite` grants the DriverGroup membership to
      whoever presents a valid code, without checking it against the invited
      user. Confirmed end to end 2026-08-08 — a different driver redeemed
      another's code and burned it. Access-grant resolution, so Rule 5 applies:
      design approval before any fix. Two further defects on the same path are
      recorded in the note: the invitee is locked out of redeeming their own
      invite, and the placeholder user the invite creates carries no idToken.
      See [DECISIONS.md](./DECISIONS.md) 2026-08-08 and
      `docs/notes/2026-08-08-n1-onboarding-workflow-exercise.md`.

---

## GO-LIVE

- [ ] **14. Verify gate** — Track A and Track B both green, delivery rail live,
      admin credential rotated, Prod clean.

- [ ] **15. Send customer 1's first correct invoice from clean Prod.**
      **← the phase is done here.**

---

## EXPAND

- [ ] **16. Un-park attribution** → the metered CDR line (host↔driver, agent
      posture) + self-serve at scale.
      *Un-parked by task 15 and nothing earlier — it is the workplace-pays-for-
      home differentiator, and it arrives through the same resolver into the
      same ledger.*

## Queued 2026-10-31: cached overviews / explicit refresh

Andri requested this task after noticing slow Installations and Chargers navigation. Brief: docs/agent-prompts/2026-10-31-s1-cached-overviews-refresh.md. Queued only; no concurrent run. Finish/reconcile direct onboarding first and retain Easee/Zaptec priority. Reuse sync revisions/cache, provide browser-held overview and Updates available with bounded explicit refresh. Current status adapter polls and clears on unmount; browser push is not established by VERSION_HUB. No live measurements or deployment claim. Individual model-run approval still required.

