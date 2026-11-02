# Core freeze and local checkpoint — 2026-10-31

Andri approved freezing new features, reviewing/checkpointing the core fixes,
then onboarding one real charger. This checkpoint preserves source; it is not
a deployment approval or proof of a successful hardware journey.

## Boundary

- Canonical checkout: E:\Claude\Straumvakt; remote and single worktree verified.
- Starting HEAD: 7a0cf3ad48127d858738a60262397558280350c2.
- Local checkpoint branch: codex/core-checkpoint-2026-10-31.
- 260 short-status entries at entry. No running launcher status was found.
- Freeze new features and research assignments. Only review, fixes necessary
  for the existing journey, release verification and the real-device test proceed.
- Preserve existing onboarding/UI work and the single lifecycle/costing engine.
- Recovery remains false/no cron; realtime is not enabled or bound. The existing
  opt-in realtime source is interleaved with the core modules and is preserved
  in this source checkpoint, not approved for external use.
- No push, deployment, migration, secret change or charger command for this checkpoint.

## Reviewed scope and checks

Reviewed command persistence/deadlines and placement fencing, lifecycle retry
reservation, batching/acknowledgement and fallback, coherent terms transaction,
outbox repair bounds, disabled recovery/realtime gates, and onboarding integration
dependencies. This is a focused integration review, not an exhaustive audit of
every historical change since HEAD.

The explicit checkpoint includes the affected engine/lifecycle/costing,
gateway, installation, sync, CPO UI, Worker modules, migration 0008–0010 and
their schema metadata, plus the associated schema-check and Worker tests/configs.
It excludes local secrets, .tmp, remote attachments, archives, downloaded images,
launcher tooling, unrelated apps/api billing changes and deployment workflows.

Independent rerun at 22:09–22:12 UTC:

- Root scoped engine/lifecycle/costing/sync/installations/CPO/Worker tests:
  **752 passed, 49 files**.
- Entire gateway suite: **383 passed, 16 files**.
- Root and gateway TypeScript checks pass.
- Adopted schema check passes: 11 migrations, chain intact and no drift.
- Selected-file secret-pattern scan found no private-key, Resend-key, AWS-key
  or Neon credential URL patterns. This is a limited check, not a secret audit.

Prior fresh Next production build, local workerd probes and packaging evidence
are recorded in `2026-10-31-core-architecture-codex-verification.md`; those checks
were not redundantly repeated without a source change. PGlite tests are not
multi-connection Neon verification. No production OPEX or reliability SLO is proven.

## Release constraints and next real-device step

1. The new gateway batch RPC needs the matching shell entrypoint. Do not deploy
   either side in isolation and leave queued ingestion paused.
2. GATEWAY stop binding must target the durable attempt-keyed implementation.
   A command acknowledgement is not StopTransaction or settlement.
3. Recovery cursor migration 0010 is not applied; no recovery schedule may be
   enabled on that assumption. Keep it off for the initial onboarding.
4. Realtime still lacks the intended tenant/driver grants and placement-removal
   invalidation. Keep it off. Flutter realtime is not delivered by this patch.
5. Automatic OEM configuration stays disabled; reuse the working test OCPP URL
   and preserve vendor load balancing. Choose one observed Incoming charger,
   assign it to the existing test installation/circuit, and verify its actual
   BootNotification/registered connection. Do not invent electrical values.
6. Follow with a separately controlled physical session/stop/CDR/removal/return
   journey. Onboarding alone does not prove charging, billing or recovery.

At 22:10 UTC the signed-in production Chargers page displayed no registered
chargers and no Incoming entries in the preceding 30-minute window. Andri was
asked to enable the previously working test URL. The live navigation/cache patch
is still unreleased under the earlier keep-local instruction; page slowness is
not evidence that the local patch was deployed and failed.

Read-only Cloudflare metadata confirms live shell version
`5bd1b2c4-bde4-4c29-95a7-a86448aff29d` (13:28:53 UTC) and gateway version
`5cce9bd6-a432-44ba-9d2f-d2ea8572f1be` (13:29:14 UTC). Shell has OCPP_PENDING,
but no GATEWAY or VERSION_HUB binding. Current core/cache changes are not live.

Checkpoint staging: 158 explicit files; static local import resolution found no
dependency on an untracked, unstaged module. Roughly 39,585 added lines are the
three generated Drizzle snapshots. Four existing extra EOF blank lines remain
in TASKS, installation-editor, meter-readings and pending-service; no semantic
cleanup was mixed into the freeze. Source and prior historical changes outside
the explicit checkpoint remain in the working tree.

Local source checkpoint created: **05de7b2**. No active Git hooks were configured
beyond the sample hook files; no push occurred. Remaining 140 short-status entries
are outside the checkpoint (directory grouping changes this count).

Fresh OpenNext packaging after checkpoint exposed a real integration regression:
the asset-pruner's plain-Node import of the edge module eagerly loaded the optional
TypeScript realtime runtime. Fixed by loading that runtime only for an enabled
WebSocket upgrade, with disabled/unbound upgrades returning 404. The original
plain-Node asset preparation now succeeds (88 excluded generated assets removed,
three approved public files retained). The 43 edge/realtime tests pass with the
workspace TEMP path; an initial test attempt failed on sandbox TEMP rename EPERM,
not on assertions. No product feature was added.

Follow-up packaging fix committed as **72a4fcb**. Fresh OpenNext packaging,
asset pruning and both matched Worker dry-runs now pass. Still no deployment.

## Real charger registration through the existing live UI

Andri enabled `wss://test-cpo.straumvakt.org/{deviceid}` at the Zaptec installation
level. Fresh incoming connections appeared around 22:12–22:13 UTC. Selected only
`zpr148882`, whose retained BootNotification reports Zaptec / ZAPTEC PRO /
serial ZPR148882 / firmware 6.3.3.3. The retained boot itself is timestamped 13:30,
not falsely represented as a fresh boot.

At **22:14:11 UTC**, saved this one device through the production installation
editor into existing `Installation save test` / `Test circuit`. Save succeeded
at revision 2, device `364a0fe4-80ca-4a29-b61f-f20d3bcdd8f0`, circuit
`ca7f1170-9fa2-40d7-ae3a-fd4ad45593cb`, installation
`11320b72-f9c8-4fa8-b104-25e95ec72f39`. The UI history records acceptance from
Incoming. Main/circuit ratings remain the existing 0 A; no electrical value,
vendor configuration or load-balancing setting was changed by Codex.

The live list verified the device under the correct installation/circuit and
removed it from unregistered Incoming. Immediately after saving it correctly
showed activation waiting / status unknown, not a proven connected charger.
Registration is on the existing live release, **not hardware validation of the
new local core checkpoint**. A fresh accepted boot is the remaining connection
proof; no charging session or CDR has been claimed.

### Connection handoff remains unverified

Read-only Neon inspection identified the existing primary target from current
control-plane metadata: project `silent-thunder-69180957`, branch
`br-broad-boat-zaftlmic` / development, endpoint `ep-red-pine-zasodu3y`, database
`neondb`, role `neondb_owner`. Scoped SELECTs only, no direct SQL mutation.
Promotion was recorded delivered once at 22:14:12.195Z, outcome
`reconnect_requested`; the selected device had no registered BootNotification
receipt at the subsequent check. At 22:18 UTC admission data was consistent:
active Test CPO, exact `zpr148882` identity, current identity and placement,
matching organisation, open installation, password mode none.

Andri reports Zaptec Portal: online for 18 days, car disconnected, 0 kW,
authentication OCPP 1.6J cloud. This proves the vendor-side online report, not a
Straumvakt WebSocket. A narrowly scoped existing Cloudflare observability query
found only sampled shell page requests; 1% gateway sampling cannot exclude a
failed reconnect. No claim that Zaptec or the gateway is definitively at fault.

Requested one operator-controlled OCPP URL disable/re-enable on the test
installation to isolate a fresh registered connection from the pending-to-
registered reconnect handoff. No reset or electrical/load-balancing change was
requested. Until that succeeds, report **registered, connection unverified**,
not complete working onboarding. Do not proceed to a charging-session test.

### Charger-level diagnostic, 22:28 UTC

Andri disabled/re-enabled the installation URL, then temporarily set the same
URL at charger level on ZPR148882 only. His Zaptec Portal screenshot shows
"Charging station is not connected to OCPP server" on that charger. It is also
the only charger registered in Straumvakt, so this comparison does not isolate
configuration inheritance from the pending-versus-registered gateway paths.
Do not attribute the fault to Zaptec or the charger-level override yet.

Bounded sanitized Wrangler tails captured no HTTP request matching that device
during their observation windows; the last 90-second window had three events,
all with outcome `ok`, none matching the target. This is not proof that the
charger never attempted a connection. Sampled historical observability likewise
did not yield a target gateway rejection. A scoped read-only SELECT at 22:28
still found no registered BootNotification, discovery last seen 22:13:16.164Z,
and no recorded refusal reason. Source inspection alone has not identified a
proven registered-upgrade defect. No deploy or charger command was performed.
The temporary charger-level override remains to be removed after the diagnostic;
do not claim that cleanup has occurred. Onboarding remains incomplete pending
an observed registered handshake and accepted BootNotification.

### Read-only Zaptec API diagnostic and local token reuse

Andri authorized use of the Zaptec API credentials for diagnosis, then expressly
required no changes to the real-world installation. Diagnostic scope is GETs
only after authentication: exact charger ZPR148882, its installation configuration
and selected numerical state observations. No URL/configuration write, command,
reset, charging action or load-management change is authorized by this diagnostic.

The first successful API sign-in reached the inventory, but the temporary helper
incorrectly assumed the screenshot's Krónan label was an installation name.
It stopped on zero matches without reading or modifying charger settings. The
lookup now uses documented charger NameFilter followed by exact DeviceId and
installation-in-authenticated-inventory checks; local fake-response assertions
verified the lookup, bounded reads, credential exclusion and scope refusals.
Actual charger diagnostics still await the corrected authenticated run.

At Andri's request, the temporary helper now retains only the API access token
using Windows CurrentUser DPAPI encryption under ignored node_modules/.cache,
for the shorter of upstream expiry and one hour. No password/refresh token is
stored. A resume-only invocation reuses the token, does not call OAuth, honors
the local Zaptec cooldown, and invalidates a token on HTTP 401. HTTP 429 stops
reads and records Retry-After; it does not retry authentication automatically.
Local encryption/decryption and plaintext-exclusion checks passed using a fake
token, subsequently removed. A no-cache resume returned sign_in_required with
zero OAuth requests. Live token reuse is not yet verified. The earlier helper
discarded its token, so one more user sign-in remains necessary.

Only temporary diagnostic files and this record changed. The loopback form on
port 3124 returned HTTP 200 with the accurate token-retention disclosure. Browser
automation was unavailable; no successful automated browser refresh is claimed.

### Zaptec API observations, 22:35–22:37 UTC

User signed in successfully. The corrected serial lookup found ZPR148882:
Zaptec charger `f691e575-7b80-45e6-8614-c0adb0a330b6`, installation
`7d722149-3c5f-4488-8bf2-e660503e11e9`. These are vendor references, not
Straumvakt's permanent device/installation UUIDs.

Read-only API results: installation AuthenticationType=2 (cloud OCPP),
OcppCloudUrlVersion=1, IsRequiredAuthentication=true. Both configured URL
fields resolve to host test-cpo.straumvakt.org with the {deviceid} template;
the diagnostic URL parser renders braces as %7B/%7D, which is not evidence
that literal percent-encoded braces were entered in Zaptec Portal. No embedded
URL credentials/query. OcppInitialChargePointPassword and charger
PropertyOcppPassword are not configured (booleans only, no secret retained).
Charger IsOnline=true, OperatingMode=1, PropertyAuthenticationDisabled=false.
The current details response has Message=null and Warnings=null, and reports
CurrentUserHasServiceLevelTechnicalReadAccess=false. These fields do not
explain or invalidate the Portal's OCPP-specific warning.

Selected state observations include online=1, power=0 and operation-mode=1.
Their individual timestamps are retained in the sanitized diagnostic: they
are not all new measurements, and vendor online is not an OCPP connection.
A contemporaneous bounded Neon SELECT still found no registered boot and
discovery last_seen_at=22:13:16.164Z. The cause remains unproven; configuration
reads alone do not validate a WebSocket handshake or the registered path.

Live cross-process reuse of the DPAPI-encrypted access token succeeded for
subsequent GETs without another OAuth sign-in. Cache expiry is 23:35:38 UTC.
No installation/charger setting, permission, electrical value, firmware,
charging session, cloud deployment or database row was changed in these
diagnostics. Do not remove the user's temporary URL override without approval.

### Pending retry and transport investigation, 22:38–22:46 UTC

Read-only inspection of the deployed gateway bundle confirmed the Pending
BootNotification interval is 1800 seconds. Promotion closes the pending socket
with private code 4002, `registered; reconnect`; that requests a reconnect but
does not establish that Zaptec has performed one. The BootNotification interval
must not be presented as a verified Zaptec WebSocket reconnect timer.

Cloudflare zone HTTP analytics, queried around 22:40 UTC for the window starting
22:10 UTC, showed one target-path request at 22:13 with HTTP 101 and reported
sampleInterval=1. Host-wide results contained 21 HTTP 101 requests and no other
status groups. This is observed analytics evidence, subject to reporting delay
and WebSocket reporting semantics, not proof that no attempt could have occurred.
A bounded three-minute tail ending around 22:44 recorded three events, none
attributable to the target fetch path; two were WebSocket events without a
target-identifying request URL.

A temporary local test of the downloaded deployed gateway bundle passed the
registered WebSocket upgrade (101, ocpp1.6) and BootNotification response transport
using a local stub Engine and admission data. It used no live bindings. Installed
workerd supports compatibility date 2026-10-26, one day before the live setting;
this test therefore does not prove live database admission, cloud runtime parity,
or actual Zaptec behaviour. No product source or deployment was changed.

At 22:46:23 UTC the cached token was reused for two scoped GETs, without another
OAuth login. ZPR148882 remains vendor-online; TechnicalRead debug-log entitlement
is false, Message/Warnings are null, and the OCPP WebSocket ping override is null.
These are not proof of an established OCPP connection or a scheduled retry.

The public schema advertised by https://api.zaptec.com/help/index.js at
https://api.zaptec.com/swagger/v1/swagger.json contains no property matching
retry/reconnect/BootNotification/heartbeat and no documented GET path for the
OCPP connection/debug log. This is a limitation of the inspected public schema,
not proof that Zaptec has no internal or partner API. The charger-details reference
documents the TechnicalRead entitlement:
https://docs.zaptec.com/reference/api_chargers_id_get.
Thus the 30-minute value is confirmed on Straumvakt's side, but Zaptec's actual
retry scheduling remains unverified through the available API access. No command,
verbose-log enablement, permission change or installation modification was made.

### Handoff investigation, 22:47–22:50 UTC — no real-installation changes

User requested investigation only, expressly preserving the real installation.
The 22:47 read-only check still found only the 22:13 HTTP 101 for the target,
discovery last_seen_at 22:13:16.164Z, no registered BootNotification and no
recorded admission refusal. Analytics reporting limitations still apply.

Confirmed handoff sequence:

1. `src/lib/installations/repo.ts:33` signals attached identities after the save.
2. `gateway/src/command-entrypoint.ts:55` addresses the pending CPO/identity DO.
3. `gateway/src/pending-mode.ts:423` rechecks actual registration, then calls
   `close()` (line 396), closing with code 4002 and releasing its admission lease.
4. `gateway/src/index.ts:189` and `:212` route pending and registered upgrades
   to DIFFERENT DO keys. There is no in-place transport handoff.
5. `src/lib/installations/discovery.ts:90` considers reconnect_requested and
   not_connected delivered. Lines 155–162 retain a waiting state until a newer
   accepted boot; only undelivered work is retried. No activation deadline moves
   delivered-but-unconnected work into a timed-out recovery state.

Temporary local workerd test of the downloaded DEPLOYED gateway reproduced:
Pending interval=1800 -> promotion outcome=reconnect_requested -> client receives
close 4002 -> pending presence=false -> repeated promotion=not_connected.
An explicitly client-initiated fresh upgrade and boot then reached Accepted with
a stub Engine. No live binding, cloud write, database or real charger was used.
Artifacts: `.tmp/codex-recovery-tests/handoff-runtime-{wrapper,run,bundle}.mjs`.
This tests actual gateway transport with stub admission/business decisions, not
Zaptec behaviour or production correctness. Compatibility-date limitation remains
2026-10-26 locally versus 2026-10-27 deployed.

Existing gateway suites pending-mode, command-entrypoint and identity-do-pending:
91 tests passed across three files. Initial sandbox execution failed during
temporary-file rename before tests ran; rerun outside that restriction passed.
Promotion tests assert the socket close, not a real charger's reconnect/boot.

Findings:
- Confirmed reliability gap: successful signal delivery has no bounded connection
  completion/recovery outcome. A client that does not reconnect remains waiting.
- Confirmed interoperability dependency: close 4002 is a private application
  code, not a demonstrated Zaptec reconnect instruction. Source explicitly
  documents the departure from OCPP 1.6 section 4.2's recommendation to keep a
  Pending channel open. The earlier controlled-trial review/release already
  called hardware promotion unverified; this is that unproven assumption being
  exercised, not evidence of a new database/schema failure.
- The six-hour recheck is driven by incoming pending boots. It cannot restore a
  socket closed by promotion; shortening the 1800-second boot interval alone
  therefore does not establish a fix.
- Exact Zaptec reason for failing to reconnect remains unknown. Its handling of
  private close codes, backoff and cloud-bridge state are not exposed by the
  inspected public API. Do not claim 4002 has been proven the vendor root cause.

Recommended next local repair investigation: separate committed registration,
activation requested, boot-confirmed activation and activation timeout. Prefer
a validated transition that retains the pending transport through admission
where feasible; preserve authoritative placement/credential checks, device
ownership, command routing and generation fencing. An accepted WebSocket cannot
simply be moved to another DO. Do not implement a no-password-only shortcut or
forge/replay a boot as fresh evidence. If retaining forced reconnect, require
documented/vendor-verified close/reconnect behaviour plus bounded failure state;
changing 4002 to another code is only a hypothesis until tested with approval.
Before release, locally cover non-reconnecting clients, delayed/duplicate boot,
lost promotion, credential refusal, replacement/generation races and command
routing. Hardware validation and any live deployment remain separate approvals.

No production source, deployment, real installation, charger setting or session
was changed. Only local diagnostic artifacts and this investigation record changed.

### Correction from later telemetry and user-disabled OCPP mode, 22:57–22:58 UTC

Andri reported disabling OCPP authentication in Zaptec Portal. Two read-only
GETs at 22:57:51 UTC confirm AuthenticationType changed from 2 to 0 for both
the installation and ZPR148882; IsRequiredAuthentication remains true and
PropertyAuthenticationDisabled remains false. The public /api/constants response
maps 0=Native, 2=Ocpp. This is a change of authentication provider, not proof
that all driver authentication is disabled. IsOnline remains true to Zaptec.
Codex changed no vendor settings.

IMPORTANT CORRECTION: the fresh Cloudflare analytics query for 22:10–22:57:44
now returns TWO target-path HTTP 101 events, at minutes 22:13 and 22:20,
sampleInterval=1. Earlier queries returned only 22:13. Thus a post-registration
WebSocket upgrade did occur at the transport level. Earlier statements that
the charger never reconnected, or that its socket was definitely absent based
on missing boot/analytics, were too strong. The reason for delayed visibility
has not been established; reporting delay/long-lived WebSocket semantics are
possibilities, not conclusions. An HTTP 101 does not establish the duration
of a connection or successful application-level activation.

A bounded SELECT still reports no registered BootNotification, discovery last
seen 22:13:16.164Z and no stored refusal. Correct current diagnosis: the
forced-reconnect handoff did not yield boot-confirmed activation; absence of
any transport reconnect is disproven by the newer analytics. Investigate the
registered connection's missing fresh boot as well as the Pending promotion
design. Do not require a charger to boot spontaneously merely because its
WebSocket reconnected. The prepared task must retain this corrected evidence.

Expected application reaction to a vendor-side mode change: preserve device,
placement, session/CDR history; reflect gateway-observed disconnect/expiry,
without inferring its cause from silence. Exact Native/OCPP mode is known here
only because of the explicitly requested API diagnostic. A generic OCPP
connection does not notify Straumvakt of every Portal configuration change.

### Small boot fix returned; initial Codex verification, 23:09 UTC

Approved Sonnet High run 1536a2d6-af16-4179-8b82-55e37eb88534 returned for
review at 23:07:39 UTC, exit 0. Matching mail/handoff read and receipted; monitor
deleted after completion. No deployment or real-installation action.

Codex independently ran focused gateway engine-mode/boot-activation tests:
69 passed. Root pending/discovery tests: 89 passed. Root and gateway tsc
--noEmit both passed. Total 158 focused tests; these are local doubles, not
real charger/production validation.

Review remains open. Source-confirmed issue: seedActivation returns null for
ANY prior done record, even if placementId changes. The new pure test explicitly
expects p1 done -> p2 no probe. This would skip the missing-boot probe when a
previously activated device is removed/re-added or moved to a new placement;
completion must not be treated as permanent across placements. Requires a
correction/regression test before readiness can be claimed. Also review enabled
probe alarm coexistence because older engine-mode tests now disable the probe
via a new default-on environment switch. Local runtime verification remains.
Do not auto-delete registration, fabricate a stop/CDR, alter credentials or
re-enable OCPP in response. Live UI behaviour has not been verified by this read.

### Small boot fix: Codex correction and local verification, 23:18 UTC

The user authorized fixing remove/re-add and finishing local tests, with no real-installation changes. They subsequently reported re-enabling OCPP authentication themselves; Codex did not change or independently verify that setting.

Corrected `gateway/src/boot-activation.ts`: a completed activation is retained only for the same placementId. A device returning under a new placement starts a fresh activation attempt. The pure-state and gateway integration regressions both failed before this correction, then passed. The integration test also verifies that the old socket cannot complete the new placement and that ordinary same-placement reconnects do not repeat the probe.

Added enabled-probe alarm integration coverage: a stop deadline at 3 seconds, status outbox delivery at 5 seconds, boot probe at 10 seconds and activation timeout at 60 seconds coexist on the single alarm. The probe does not postpone stop expiry or outbox delivery, and no duplicate command or fabricated boot is produced.

Independent final local checks:
- Entire gateway suite: **410 passed, 17 files**.
- Root pending/pending-SQL/discovery/installation-lifecycle and lifecycle suites: **182 passed, 8 files**, using local test doubles. Total **592 passed**.
- Root and gateway TypeScript `--noEmit`: **PASS**.
- Scoped tracked diff whitespace check: **PASS** (existing line-ending warnings only).
- Current-source local Miniflare/workerd runtime: **PASS**. Actual local WebSockets and actual scheduled alarms exercised one missing-boot TriggerMessage, Accepted probe reply remaining incomplete until fresh BootNotification, accepted boot completion, new-placement reactivation, and same-placement reconnect without a repeated probe. Fixture has **zero live service/database bindings**. Uses installed runtime compatibility date 2026-10-26; production runtime/hardware parity is not claimed.

Reproduction files: `.tmp/codex-recovery-tests/activation-runtime-wrapper.mjs` and `activation-runtime-run.mjs`; these are local fixtures, not product routes. Existing Durable Objects guidance on single-alarm scheduling was checked against https://developers.cloudflare.com/durable-objects/api/alarms/.

The narrow source fix is ready for a separately authorized release/live validation. It is **not deployed**. Whether the actual Zaptec cloud sends the requested BootNotification remains unverified. Pending promotion still requests reconnect with code 4002; socket ownership redesign remains deferred. The gateway's 60-second attempt marker and UI's 15-minute save-based indication remain distinct; delayed promotion delivery still uses the save timestamp. No schema, cloud resources, secrets, OEM settings, real chargers, Git commit or push changed during this correction/verification.
