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
