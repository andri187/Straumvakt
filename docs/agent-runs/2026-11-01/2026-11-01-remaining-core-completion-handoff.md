# Remaining core completion — handoff (2026-11-01 → 2026-11-02)

Written by Claude Sonnet in VS Code (`E:\Claude\Straumvakt`). Branch `codex/core-checkpoint-2026-10-31`, HEAD `51a6ea7` before and after; **nothing was committed, pushed, deployed, migrated, or sent to Cloudflare, Neon or a charger.** Dirty tree preserved (no reset, stash, clean, extra checkout). Work window about 23:45 UTC 1 Nov – 01:15 UTC 2 Nov.

## Status (read this first)

| Dimension | Status |
|---|---|
| Implementation of every listed core item | **Complete** (A–E below), with the two product limits named in "Not built / not claimed" |
| Local verification | **Complete except three named verification gaps** (below). I am therefore **not** using the unqualified phrase "local verification complete" |
| Deployed | **No.** Release candidate prepared; one consolidated approval request is in "Release" |
| Real-charger / hardware / Neon-transport proven | **No.** No live read or charger action was made in this task |
| Manual acceptance (Andri/Codex) | **Pending** |

**The three verification gaps (each is a check I could not complete, not unfinished code):**
1. **Installation-editor unsaved-edit retention was not exercised in a rendered page.** The editor loads its data in a server component that needs a Neon-compatible database path; my browser rig gives the Next server no database (an attempt to bridge Neon's WebSocket transport to PGlite failed on the pipelined connect and was removed after a time-box). What is verified instead: Refresh/apply keeps expanded rows (browser), the store never touches form state, the editor page sends no background request, and `localMutation` semantics are unit-tested. Remaining check: a rendered pass of `/cpo/installations?id=…` with text typed, against any Neon-compatible database (the staging/dev branch after release, or a local Neon proxy).
2. **No Android emulator run.** A `Pixel_8` AVD exists, but an emulator pass needs a Gradle build and a local stand-in for the legacy driver login API. What ran instead: 74 Flutter tests + `flutter analyze`, and an opt-in end-to-end test (4 tests) in which the app's real `dart:io` WebSocket client, bearer-token header and discovery request talk to the real edge module and Durable Object class in local workerd.
3. **Server-rendered pages were not exercised against a database in the browser** (same cause as gap 1). The API handlers behind both pages were (real handlers, real migrations, PGlite); the server components that read the database directly (editor, onboarding) were not.

## Reconciled facts (the dated documents were not trusted)

- Baselines verified at start: root vitest **4,856 passed / 4 skipped (195 files + 1 skipped file)**, gateway **410 passed**, root `tsc` clean — the overnight report's number is correct.
- **Fixture population (the overnight wording "20 × 3 × 4 = 80" was wrong arithmetic):** `src/lib/perf/harness.ts` `DEFAULT_SIZE` is 20 installations × 3 circuits × **4 chargers per installation** (round-robin over the circuits) = **20 installations, 60 circuits, 80 chargers**. The rig prints this at start and the browser run counted 80 charger rows.
- Value-carrying realtime already existed locally (LiveRoom/live-client); I extended it, built no duplicate.
- Other operator pages: `people`, `sessions`, `costs`, `agreements`, `settings`, `organisations` and the KPI overview contain **zero** database or fetch calls (grep-verified); the layout only verifies the cookie. Only Installations and Chargers had the redundant-read pattern, and both are corrected.

## What changed since the overnight web increment (by area)

### A. Distributed read control (new)
- `src/lib/sync/gate.ts` — one fixed-window admission primitive. Cooldown = 1 per 30 s; read limits per actor-partition per minute: list 12, tree 40, detail 40, incoming 12 (`READ_LIMITS`). Hub-backed (the existing VersionHub Durable Object), with an isolate-local fallback that reports `source: "isolate"`.
- `src/lib/sync/hub.ts` — `VersionHubCore.gate/gateRecord/claimRepair/releaseRepair`; operations serialised inside the core; a structure commit folds into every remembered check answer; **bounded shared repair**: one isolate repairs a lost/expired reading, the rest wait up to 4 × 150 ms for its result, then read for themselves (bounded, never an indefinite wait).
- `src/lib/sync/check.ts` — the 30 s check cooldown is now shared across isolates through the gate (the deferred answer carries the revisions the admitting isolate recorded).
- `src/lib/installations/api.ts` — server-enforced 429 + `Retry-After` on list/tree/detail/incoming reads, **after** authorization and before any repository work. `permissionPartition(actor)` keys every gate, so actors with different access never share a window or answer.
- `src/lib/sync/structural-store.ts` + UI — a 429 keeps held data visible, sends nothing before the retry-after, and shows an honest message. No timers added.
- Without `VERSION_HUB` bound, every bound degrades to per-isolate; an older hub class (no such methods) is detected as "no coordination", never a failure.

### B. Shared realtime, web and mobile
- **Removal/placement invalidation:** `LiveRoom.reconcile/remove` with placement **tombstones** (7 days, cap 200): a removed placement's still-open socket cannot republish; a device returning under a new placement is accepted. Writers notify after commit: installation save → `reconcileLive`; lifecycle close (page **and** the recovery pass) → `removeLive`. Failure is swallowed (structure is already durable; the room also disposes obsolete devices).
- **Roles:** `src/lib/sync/live-fanout.ts` — operator = full normalized observation of one installation; driver = minimal projection of **only** the devices and connectors of their own open, authorized session (no org/installation/placement/generation internals, no error codes). The same single publication serves both; no read per viewer.
- **Edge:** `workers/cpo-shell-realtime.mjs` — operator cookie path (same-origin enforced; installation must be in the hub's list, else one bounded database check, so a guessed UUID never creates a room); driver bearer-token path (`DRIVER_AUTH_SECRET`, same HMAC format as the driver API — cross-tested by minting with `apps/api`'s own `mintDriverToken`); per-subject shared gate; follow-list for the app (`GET /api/cpo/sync` + Bearer returns only installation ids). Leases ≤ 60 s, 5 s-bucketed alarms; renewal re-verifies the token and the open session, so a finished session, a deactivated user or a revoked login loses access at the next renewal.
- **Grant:** `src/lib/sync/driver-live.ts` — one indexed read per driver per lease; migration 0011 adds the partial index. The planner check on real PostgreSQL shows it is used.
- **Web client:** `live-client.ts` rewritten — routine lease renewal (4001) reconnects at once with an 8 s grace (no flicker), the reconnect snapshot is complete (a device that left while away disappears), `remove` messages, one timer for the soonest expiry (an expired observation shows "Status outdated" — explicitly *not* a disconnection claim), jittered backoff, degraded signal; `live-status.tsx` falls back to the established poller **while push is unreachable** and says "Polled, not live".
- **Lost final publication:** gateway test — a charger that goes silent with the publication path down has its offline transition republished by the alarm alone (no frame, no other trigger); backoff 30 s → 5 min.
- **Coalescing window:** operational values coalesce for 1 s (`LIVE_DELAY_MS`) at the device before publication; financial/meter evidence is untouched and independent.
- **Mobile (Flutter):** `lib/live/live_client.dart` (`DriverLiveClient`, injectable channel) + `active_session.dart` integration. Enabled only by `--dart-define=STRAUMVAKT_LIVE_URL=<shell origin>` (empty = off, behaviour unchanged). While live data flows the API is read every 30 s instead of 3 s (completion, energy and cost remain API-authoritative); the legacy read model's `powerKw` is a placeholder zero, so live power is the first real value. Ambiguity is never guessed (no match by connector and more than one connector ⇒ no power shown).

### C. Lifecycle / commands / financial recovery
- The existing implementation was reviewed, not rewritten. **One real defect found by real PostgreSQL and fixed:** racing callers closing the same placement threw a raw `placement is no longer open` (a 500 to the loser). Now `PlacementAlreadyClosed` → the loser rolls back and resumes from the winner's result (`service.ts`, `drizzle-store.ts`).
- **Stop contract versioned:** `CommandEntrypoint.requestStopV1` (durable, attempt-keyed); the shell calls `requestStopV1`. Against a gateway that predates it (the live hotfix **and** the earlier baseline — both tested) the call rejects with `The RPC receiver does not implement the method "requestStopV1"`, `stopPortFrom` reports `unavailable`, removal stays pending and nothing unrecorded is sent. The unversioned `requestStop` remains as an alias for existing callers.
- Boot activation: the corrected placement-aware behaviour is preserved and re-verified in real workerd against current source (probe after grace; TriggerMessage Accepted does not complete; fresh boot completes; new placement re-probes; same-placement reconnect does not).

### D. Ingestion, liveness, release compatibility
- **The release trap is closed.** `callEngineBatch` previously treated a missing batch method as "retry everything forever". Now only a *proof* that the batch never ran (the real runtime message above) triggers per-event delivery on the older contract (ordered; stops at the first unavailable event; remembered 60 s, then re-probed). Timeouts, transport errors and malformed replies still retry all events and are **never** replayed individually.
- Proven in real workerd with the exact built gateway artifact: new gateway + old shell drains 3/3 events one by one in order; new gateway + new shell drains the same 3 as **one** batch call.

### E. Measurement / KPI
- The existing KPI overview now states what is built, what is off, and carries **local** evidence lines (labelled local, values remain "Not measured"). Nothing was invented.

## Completion ledger

| Item | Implementation | Evidence (what ran) | Release dependency |
|---|---|---|---|
| C1 durable command identity, fencing, no unsafe repeat | `gateway/src/{command-entrypoint,engine-mode,stop-command}.ts`, `lifecycle/service.ts` reservation | gateway 62 engine-mode + stop-command tests; real PG: 8 concurrent callers ⇒ **one attempt id**, close once, installation revision +1; workerd: V1 served by new gateway, rejected by both older gateways | gateway before shell |
| C2 autonomous lifecycle after real stop | `lifecycle/service.ts`, `recovery.ts`, `onPlacementClosed` | 84 lifecycle tests; recovery tests; real PG: close after stop evidence; **60 jittered start-vs-removal races × 3 runs** (e.g. started 43 / refused 17), invariant "placement closed while a session is open" never violated; blocked/closed starts refused | recovery stays off |
| F1 financial recovery | `workers/cpo-shell-recovery.mjs`, `recovery-live.ts` (default off, no cron) | recovery/costing tests; real PG: 6 consumers over 12 rows ⇒ processed 12, none twice, none left, 0 attempts | migration 0010, flag, cron — **not** in the first release |
| F2 coherent terms | `transactions.ts`, `drizzle-tx-store.ts` | start-read tests; terms-immutability trigger (0007) executes on real PG | none |
| R1 ingress recovery / repair | `outbox.ts`, `engine-mode.ts`, `repairOutbox` | outbox/engine-mode tests (417 gateway total) | none |
| R2 liveness | single DO alarm, `engine-mode.ts` | gateway tests incl. **lost final offline publication**; activation runtime in workerd | none |
| A1 authorization | operator (signed login) and driver (token + open-session grant) | 21 gate tests, fanout tests, 12 edge/realtime tests, real PG planner check | `DRIVER_AUTH_SECRET`, migration 0011 for the driver path |
| B1 batching 4a/4b | `engine-client.ts`, shell `callBatchV1`, `tryIngestMeters` | rpc-batch/meter tests; **real PG**: idempotent redelivery, 6 concurrent redeliveries, overlapping batches, atomic failure, unknown reference leaves no effect; workerd both shell versions | shell deploy |
| U1 shared realtime web + mobile | see B above | 10 web-client tests, 7 room checks in workerd (100 operators + 20 drivers, **1 publication → 120 deliveries in 22–32 ms**), 4 Flutter e2e + 16 Flutter unit/widget tests | flags + hub binding + secret |
| M1 measurement/release | KPI text, rigs, this manifest | below | n/a |
| Web items 1–8 of the parent brief | stores, handlers, pages | **68 real-browser checks, 0 failures** (desktop + 390 px) | none |
| Per-CPO operator accounts | **not built** | n/a | see "Not built" |

## Tests actually executed (final state)

| Check | Result |
|---|---|
| Root `tsc --noEmit` / gateway `tsc --noEmit` | pass / pass |
| Root vitest (`npx vitest run`) | **198 files passed, 2 skipped; 4,921 tests passed, 12 skipped** (8 opt-in PostgreSQL + 4 pre-existing gated) |
| Gateway vitest | **17 files, 417 tests passed** |
| Real PostgreSQL 17 (`STRAUMVAKT_TEST_PG_URL`, throw-away local server, UTF8) | **8 tests passed**; all 12 migrations execute |
| Flutter `analyze` / `test` | no issues / **74 passed**, 4 skipped (the opt-in e2e) |
| Flutter e2e against local workerd (`STRAUMVAKT_LIVE_E2E_URL`) | **4 passed** (real WebSocket + bearer header + discovery; grant filtering; remove; 401/403 ⇒ unavailable, no retry loop) |
| Real browser (Chrome 156, desktop 1280 × 900 and 390 × 844) | **68 checks, 0 failures** (`docs/agent-runs/2026-11-01/browser/results.json`, 14 screenshots) |
| workerd: mixed-version (exact artifacts) | 5 checks passed, against both the live hotfix `2e5e3e0b…` and the earlier baseline `58979434…` |
| workerd: live room (real DO class, SQLite storage) | 7 checks passed; lease expiry via the retained probe: close code **4001** on the current class |
| workerd: activation runtime (current source) | PASS (6 behaviours), zero live bindings |
| `check:adopted-schema` | OK, 12 migrations, chain intact, no drift |
| `next build --webpack` (no database) | pass |
| OpenNext build + asset pruning + wrangler dry-runs, explicit configs | pass (shell, shell with hub+realtime variant, gateway) |
| `check:schema-consistency` | **fails, pre-existing**: 8 S1 tables are not mirrored in the legacy Prisma schema (my change adds only an index) |
| `check-worker-bindings` | fails on the **legacy** `gateway/wrangler.jsonc` and `apps/api` targets only; the adopted S1 configs are not what it flags |
| `npm run lint` | cannot run (legacy `.eslintrc.json` with ESLint 9) — pre-existing |

## Measured, with the fixture stated

**Fixture:** 20 installations, 60 circuits, 80 chargers (one organisation, 4 sites).

Real browser (headless Chrome, rig = real handlers + real migrations on in-process PGlite; wall times are local and not a latency claim):

| Scenario | Browser requests | Server SQL (by class) |
|---|---|---|
| Installations, cold document | 1 list read; **no** tree, chargers or status | 2 (list + revision stamp) |
| First expansion of one row | 1 tree read, nothing else | 3, 0 history |
| Collapse and re-expand | **0** | 0 |
| Chargers, first visit via sidebar | 1 chargers list + 1 lean status + 1 incoming | 2 + 1 + 3; **no tree read, no per-installation read**; 80 rows shown |
| Installations / Chargers, warm revisit | **0** | **0** (0 connections) |
| Unchanged check | 1 | **0 structural, 0 data** (hub-fresh) |
| View entry after an external commit | 1 check (+ status step + incoming) ⇒ "Updates available", list not rearranged | — |
| Refresh applies it | list 1 + chargers list 1 + 1 changed expanded detail; no check | bounded |

Baseline vs after, same fixture and classifier (PGlite counts, `PERF=1 nav.perf.test.ts`, re-run on the final code and identical to the overnight table): chargers cold 84 → 6 queries; warm revisit 24 → 0; installations re-expansion 5 → 0; 10 simultaneous viewers 280 → 25 queries.

Operation cost of what this change adds (counts, not dollars; no bill exists): one hub request per accepted check per actor per 30 s and one per list/tree/detail/incoming read; one hub read per operator socket renewal (no database when the installation is listed); **one indexed database read per driver per 60 s lease while their charging screen is open**; **0** reads per viewer per update. A realistic Durable Object request price is not asserted here. Sub-$1 all-in OPEX remains a **target, not a measurement**.

## Defects found and fixed during verification (so the tests earned their keep)
1. Racing placement closers threw to the caller (found by real PostgreSQL) — fixed.
2. Hub gate index skipped the first key; core was not safe against interleaved storage access (found by the new unit tests) — fixed (`serial()`).
3. Live client flickered to "unavailable" on every 60 s lease renewal and never pruned devices removed while disconnected — rewritten.
4. Old shell + new gateway could not drain evidence — closed (above).

## Release

**Not deployed.** Everything below is prepared and locally proven.

### Exact artifacts (built from the dirty working tree, not from a commit)
| Artifact | Path | Bytes | SHA-256 |
|---|---|---|---|
| Gateway module (`straumvakt-ocpp-s1`), `gateway/wrangler.first-charger.jsonc` | `.tmp/release-candidate/gateway/index.js` | 664,924 | `2851b456ab399cff740b8e0860943137a5e69cc5670ccd06c4099d05e17abc5e` (two independent builds identical) |
| Shell module (`straumvakt-cpo-shell`), `wrangler.cpo-shell.jsonc` | `.tmp/release-candidate/shell/cpo-shell.js` | 8,775,898 | `76a91e89c049b3c393894a9e8fbb58cf7efcb8a2ca08f1578c61916cd15e4ec5` |
| Shell assets | `.open-next/assets` (81 files: 3 public landing files + 68 hashed JS + 10 CSS; wrangler's "172" counts its 91 directories) | 1,638,370 | manifest `7c47525cd94971c69a9a45594ba30db88104f20678c762815f0180e25183e2ea` (`find -type f | sort | sha256sum`) |
| Currently live gateway (rollback) | `.tmp/registered-boot-release/index.mjs` | — | `2e5e3e0b4faadc37dda5c29d93fd4dae111f750dc9fa6da19978917ef513fb3f` (version `3025ed3d-5975-42cd-ad8b-8193bf82bb2e`) |
| Currently live shell (rollback) | version `5bd1b2c4-bde4-4c29-95a7-a86448aff29d` | — | — |

Build commands: gateway — `cd gateway && npx wrangler deploy --dry-run --outdir ../.tmp/release-candidate/gateway --config wrangler.first-charger.jsonc` (wrangler 4.152.0). Shell — `env -u DATABASE_URL npx next build --webpack`, `npx opennextjs-cloudflare build --skipNextBuild`, `node scripts/prepare-cpo-shell-assets.mjs`, `npx wrangler deploy --dry-run --config wrangler.cpo-shell.jsonc --outdir .tmp/release-candidate/shell`. **The shell build is not claimed reproducible**; release the artifact above or re-verify the remote content hash after upload (the method used for the hotfix). The ordinary `gateway/wrangler.jsonc` contains legacy targets: **never deploy it**.

### Bindings, migrations, flags
- Existing shell bindings unchanged: `OCPP_PENDING` and `GATEWAY` → gateway `CommandEntrypoint`. **`GATEWAY` is what switches on removal with a charge in progress**; it now calls `requestStopV1`, so the gateway must go first.
- **Stage A needs no migration and no new binding** (flags off): the new code paths that touch new database objects (recovery cursor, driver grant index) are unreachable with the flags off.
- Migration **0010** (recovery cursor table; additive; not applied to Neon per the 2026-10-31 verification) and **0011** (`ocpp_transactions_open_by_user_index`, additive, brief write lock on a small table). Both executed on a real PostgreSQL 17. I did not read the live schema state; verify read-only before applying.
- Stage B: `durable_objects.bindings VERSION_HUB → VersionHub` and `migrations: new_sqlite_classes ["VersionHub"]` on the shell (commented, not active, in `wrangler.cpo-shell.jsonc`; dry-run with them passes).
- Stage C: `CPO_SHELL_REALTIME_ENABLED="true"` (shell), `OCPP_REALTIME_ENABLED="true"` (gateway), secret `DRIVER_AUTH_SECRET` (the driver API's `AUTH_SECRET`; an operator action, nothing in this task touches secrets), app build `--dart-define=STRAUMVAKT_LIVE_URL=https://www.straumvakt.org`. **Enable the shell flag before the gateway flag.**
- Stage D: `CPO_SHELL_RECOVERY_ENABLED="true"` + `triggers.crons ["0 * * * *"]` + migration 0010. Each enabled pass can wake the Neon compute (illustrative figure from the plan: about 15 CU-hours/month at the old minimum settings; not measured).

### Staged order and compatibility (every row proven in workerd, except where marked)
| Step | State after it | Safe because |
|---|---|---|
| 1. Deploy gateway artifact | new gateway + OLD shell | batch method absent ⇒ per-event drain, in order (proven); no shell GATEWAY binding yet ⇒ removal unchanged |
| 2. Deploy shell artifact | new + new | one batch call per drain (proven); `GATEWAY` → `requestStopV1` served (proven) |
| Rollback gateway only | OLD (hotfix) gateway + new shell | shell keeps `call`/`admit`/`pending`; V1 stop fails closed (proven against the live hotfix artifact); batch method unused |
| Rollback shell only | new gateway + OLD shell | per-event drain (proven) |
| 3. (Stage B) bind VERSION_HUB | shared limits/cooldown/repair become real | older hub class/absent binding degrade to per-isolate; flags still off |
| 4. (Stages C, D) | flag flips | each reversible by setting its flag back to `"false"`; pending work waits, nothing is lost |

### Feature enablement conditions
Push: hub bound; shell flag then gateway flag; sockets only for the signed operator login (and, with the secret, drivers with an open session). Recovery: migration 0010 + flag + cron + an agreed recovery SLO. Neither is enabled by Stage A.

### ONE consolidated approval request (nothing below has been executed)
> **Approve release R1:** (1) deploy the gateway artifact `2851b456…` to `straumvakt-ocpp-s1` with `gateway/wrangler.first-charger.jsonc`; (2) deploy the shell artifact `76a91e89…` to `straumvakt-cpo-shell` with `wrangler.cpo-shell.jsonc` (existing bindings, flags unset ⇒ off); (3) create and bind the `VersionHub` Durable Object namespace (migration v1) on the shell; (4) apply additive migrations 0010 and 0011 to the primary Neon target after a read-only check of the live schema. **Not requested:** enabling realtime, recovery, or the driver secret — those are separate go/no-go flips after your manual acceptance.
Rollback: shell → `5bd1b2c4…`, gateway → `3025ed3d…`, remove the hub binding; migrations are additive and stay.

## Not built / not claimed
- **Per-CPO operator accounts and driver enrolment/commercial registration** do not exist in the product (excluded). The code has one extension point (`permissionScopeKey` / `AccessPort.visible`) and tests prove gates and cooldowns are never shared across partitions; this is **not** tenancy.
- No signed-OCMF verification; no charger-vendor writes; no Neon transport/latency test; no production OPEX, p95, or fleet-scale claim; the unreleased hub binding means shared limits are per-isolate in production until Stage B.
- The remaining overnight caveat about the activation probe stands: whether the real Zaptec cloud honours `TriggerMessage(BootNotification)` is unverified. **No real ZPR148882 evidence was gathered in this task** (no live read, per the instruction).

## Files (this task; full dirty tree otherwise preserved)
Gateway: `engine-client.ts`(+test), `command-entrypoint.ts`(+test), `engine-mode.test.ts`. Shell/edge: `workers/cpo-shell-{hub,realtime,edge}.mjs`, `wrangler.cpo-shell.jsonc` (comments only). Sync: `src/lib/sync/{gate,live-fanout,driver-live}.ts` (new), `{hub,check,api,live,live-room,live-client,structural-store}.ts`. Installations: `api.ts`, `repo.ts`, `live-bindings.ts`. Lifecycle/recovery: `lifecycle/{service,drizzle-store,live}.ts`, `ocpp-engine/{recovery,recovery-live}.ts`. UI: `live-status.tsx`, `installation-tree.tsx`, `installations-overview.tsx`, `chargers-overview.tsx`, `kpi-overview.tsx`. Schema: `packages/shared/src/db/charging.ts`, `apps/api/drizzle/0011_*` + snapshot + journal. Mobile: `lib/live/live_client.dart`, `lib/screens/active_session.dart`. Tests: 7 new/extended TS suites, `src/lib/pg-concurrency/` (opt-in), 3 new Dart suites. Tooling (test-only, never imported by the app): `tools/browser-rig/{rig.cts,drive.mjs}`, `tools/release-checks/{mixed-version,live-room,mobile-e2e}*.mjs`. Evidence: `docs/agent-runs/2026-11-01/browser/`.

Reproduce: `STRAUMVAKT_TEST_PG_URL=… npx vitest run src/lib/pg-concurrency`; `node tools/release-checks/mixed-version.mjs <new gateway index.js> <live gateway>`; `node tools/release-checks/live-room.mjs`; `npx tsx tools/browser-rig/rig.cts` then `node tools/browser-rig/drive.mjs`; `node tools/release-checks/mobile-e2e.mjs` then `STRAUMVAKT_LIVE_E2E_URL=http://127.0.0.1:8791 flutter test test/live/live_e2e_test.dart`.

## Recommended next step
Codex reviews the diff and artifacts; Andri decides release R1. After R1, the three verification gaps close with one rendered editor pass against the real database and one emulator run, then the separately authorized real-charger journey (actual StopTransaction, settlement, removal/return).
