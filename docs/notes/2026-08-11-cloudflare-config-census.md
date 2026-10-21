# Cloudflare config and deployed-shape census

160 rows, **derived** rather than recalled: every row exists because a
key, symbol, action or secret name exists in the tree. Regenerate with

```
node scripts/analysis/observability/collect-config-census.mjs --md
```

Impact columns are judgement and come from an explicit annotation map in
that collector; rows it does not key are marked `product-default` in the
JSON output rather than silently inheriting a guess.

**Scope limit, stated up front.** This is a census of *configuration*,
not of *deployment*. No Cloudflare API call was made. Everything below
describes what a deploy of this tree would produce, which is not
necessarily what is running. Column A of the launch checklist is still
the only thing that settles the difference.

---

## The finding that dominates the rest

**The event-driven architecture exists only in staging.**

| | `straumvakt-ocpp` / `hlada-api` (top-level) | `*-staging` |
|---|---|---|
| Gateway queue producer | **absent** | `OCPP_EVENTS_QUEUE → straumvakt-ocpp-events-staging` |
| API queue consumers | **absent** | 3, each with a DLQ |
| R2 evidence bucket | **absent** | `straumvakt-evidence-staging` |
| Analytics Engine | absent (commented) | absent (commented) |
| `version_metadata` | absent (commented) | absent (commented) |

Four consequences, none of which any existing gate catches:

1. **ADR 0017's decoupling does not exist in the top-level environment.**
   `enqueueOrPost` falls through to `postEvent`, a synchronous
   service-binding hop to the API Worker, for *every* meaningful event.
2. **The DO awaits that hop.** Hibernation stops paying for itself when
   the object is held open across a round trip it did not need to make.
3. **There is no DLQ, so there is no parking space.** A failed event in
   staging lands in `straumvakt-ocpp-events-dlq-staging`; the same
   failure top-level is a `console.warn` and a lost event.
4. **No evidence bucket** — statements, exports and debug bundles have
   nowhere to go.

The source comment already knows: `ingest-client.ts:30` reads
`prod → OCPP_EVENTS_QUEUE=straumvakt-ocpp-events (when provisioned)`.
"When provisioned" has no gate behind it, which is why this survived.

**Gate OC16 passes anyway.** It asserts a queue producer is *declared*,
and one is — in staging. A gate that passes for the wrong reason is
worse than an absent gate, because it converts an open question into a
green tick. `OB16`/`OB17` in this run's checker close it by environment.

---

## The census

| # | File | Key | Product | Env | Shape | Inheritance | Cost impact | Release impact | Rollback impact | Blocker | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `wrangler.jsonc` | `$schema` | unknown | top-level | "node_modules/wrangler/config-schema.json" | inherited into named envs unless overridden | none | none | none | no | `wrangler.jsonc:$schema` |
| 2 | `wrangler.jsonc` | `name` | Worker | top-level | "hlada" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:name` |
| 3 | `wrangler.jsonc` | `main` | Worker | top-level | ".open-next/worker.js" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:main` |
| 4 | `wrangler.jsonc` | `compatibility_date` | Worker | top-level | "2026-04-18" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:compatibility_date` |
| 5 | `wrangler.jsonc` | `compatibility_flags` | Worker | top-level | array[2] | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:compatibility_flags` |
| 6 | `wrangler.jsonc` | `assets` | Pages | top-level | {directory, binding} | inherited into named envs unless overridden | low | build output path | redeploy | no | `wrangler.jsonc:assets` |
| 7 | `wrangler.jsonc` | `observability` | Cloudflare observability | top-level | {enabled} | inherited into named envs unless overridden | low — but log volume scales with frame volume | enabling is additive | toggle off | no | `wrangler.jsonc:observability` |
| 8 | `wrangler.jsonc` | `limits` | Worker | top-level | {cpu_ms} | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:limits` |
| 9 | `wrangler.jsonc` | `vars` | Worker | top-level | {NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_API_BASE_URL} | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 10 | `wrangler.jsonc` | `vars[]` | Worker | top-level | var NEXT_PUBLIC_APP_NAME = "Straumvakt" | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 11 | `wrangler.jsonc` | `vars[]` | Worker | top-level | var NEXT_PUBLIC_APP_ENV = "production" | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 12 | `wrangler.jsonc` | `vars[]` | Worker | top-level | var NEXT_PUBLIC_API_BASE_URL = "" | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 13 | `wrangler.jsonc` | `services` | Worker | top-level | array[1] | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | target Worker must exist in the same environment | redeploy | no | `wrangler.jsonc:services` |
| 14 | `wrangler.jsonc` | `services[]` | Worker | top-level | service OCPP_GATEWAY → straumvakt-ocpp | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:services` |
| 15 | `wrangler.jsonc` | `env.staging.name` | Worker | staging | "hlada-staging" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:name` |
| 16 | `wrangler.jsonc` | `env.staging.assets` | Pages | staging | {directory, binding} | inherited into named envs unless overridden | low | build output path | redeploy | no | `wrangler.jsonc:assets` |
| 17 | `wrangler.jsonc` | `env.staging.vars` | Worker | staging | {NEXT_PUBLIC_APP_NAME, NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_API_BASE_URL} | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 18 | `wrangler.jsonc` | `env.staging.vars[]` | Worker | staging | var NEXT_PUBLIC_APP_NAME = "Straumvakt (staging)" | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 19 | `wrangler.jsonc` | `env.staging.vars[]` | Worker | staging | var NEXT_PUBLIC_APP_ENV = "staging" | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 20 | `wrangler.jsonc` | `env.staging.vars[]` | Worker | staging | var NEXT_PUBLIC_API_BASE_URL = "https://hlada-api-staging.straumvakt.workers.dev" | NOT inherited into named envs — must be redeclared | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:vars` |
| 21 | `wrangler.jsonc` | `env.staging.routes` | DNS/domain | staging | array[2] | inherited into named envs unless overridden | none directly | can remove a pinned host | re-add route; DNS TTL delay | yes | `wrangler.jsonc:routes` |
| 22 | `wrangler.jsonc` | `env.staging.workers_dev` | DNS/domain | staging | true | inherited into named envs unless overridden | none | undeclared + routes added ⇒ inferred false ⇒ pinned host disappears | re-declare and redeploy; shipped mobile clients cannot be fixed server-side | yes | `wrangler.jsonc:workers_dev` |
| 23 | `wrangler.jsonc` | `env.staging.services` | Worker | staging | array[1] | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | target Worker must exist in the same environment | redeploy | no | `wrangler.jsonc:services` |
| 24 | `wrangler.jsonc` | `env.staging.services[]` | Worker | staging | service OCPP_GATEWAY → straumvakt-ocpp-staging | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | name change creates a new Worker | redeploy previous version | no | `wrangler.jsonc:services` |
| 25 | `wrangler.jsonc` | `env.staging.hyperdrive` | Hyperdrive | staging | array[1] | NOT inherited into named envs — must be redeclared | none | none | none | no | `wrangler.jsonc:hyperdrive` |
| 26 | `apps/api/wrangler.jsonc` | `$schema` | unknown | top-level | "node_modules/wrangler/config-schema.json" | inherited into named envs unless overridden | none | none | none | no | `apps/api/wrangler.jsonc:$schema` |
| 27 | `apps/api/wrangler.jsonc` | `name` | Worker | top-level | "hlada-api" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:name` |
| 28 | `apps/api/wrangler.jsonc` | `main` | Worker | top-level | "src/index.ts" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:main` |
| 29 | `apps/api/wrangler.jsonc` | `compatibility_date` | Worker | top-level | "2026-04-18" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:compatibility_date` |
| 30 | `apps/api/wrangler.jsonc` | `compatibility_flags` | Worker | top-level | array[2] | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:compatibility_flags` |
| 31 | `apps/api/wrangler.jsonc` | `observability` | Cloudflare observability | top-level | {enabled} | inherited into named envs unless overridden | low — but log volume scales with frame volume | enabling is additive | toggle off | no | `apps/api/wrangler.jsonc:observability` |
| 32 | `apps/api/wrangler.jsonc` | `services` | Worker | top-level | array[1] | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | target Worker must exist in the same environment | redeploy | no | `apps/api/wrangler.jsonc:services` |
| 33 | `apps/api/wrangler.jsonc` | `services[]` | Worker | top-level | service OCPP_GATEWAY → straumvakt-ocpp | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:services` |
| 34 | `apps/api/wrangler.jsonc` | `env.staging.name` | Worker | staging | "hlada-api-staging" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:name` |
| 35 | `apps/api/wrangler.jsonc` | `env.staging.services` | Worker | staging | array[1] | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | target Worker must exist in the same environment | redeploy | no | `apps/api/wrangler.jsonc:services` |
| 36 | `apps/api/wrangler.jsonc` | `env.staging.services[]` | Worker | staging | service OCPP_GATEWAY → straumvakt-ocpp-staging | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:services` |
| 37 | `apps/api/wrangler.jsonc` | `env.staging.hyperdrive` | Hyperdrive | staging | array[1] | NOT inherited into named envs — must be redeclared | none | none | none | no | `apps/api/wrangler.jsonc:hyperdrive` |
| 38 | `apps/api/wrangler.jsonc` | `env.staging.r2_buckets` | R2 | staging | array[1] | NOT inherited into named envs — must be redeclared | low — storage + class A/B ops | bucket must exist before first write | objects persist | no | `apps/api/wrangler.jsonc:r2_buckets` |
| 39 | `apps/api/wrangler.jsonc` | `env.staging.r2_buckets[]` | R2 | staging | EVIDENCE_BUCKET → straumvakt-evidence-staging | NOT inherited into named envs — must be redeclared | low — storage + class A/B ops | bucket must exist before first write | objects persist | no | `apps/api/wrangler.jsonc:r2_buckets` |
| 40 | `apps/api/wrangler.jsonc` | `env.staging.queues` | Queue | staging | {producers, consumers} | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `apps/api/wrangler.jsonc:queues` |
| 41 | `apps/api/wrangler.jsonc` | `env.staging.queues[]` | Queue | staging | producer OUTBOUND_QUEUE → straumvakt-outbound-staging | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `apps/api/wrangler.jsonc:queues` |
| 42 | `apps/api/wrangler.jsonc` | `env.staging.queues[]` | Queue | staging | producer ARCHIVE_QUEUE → straumvakt-archive-events-staging | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `apps/api/wrangler.jsonc:queues` |
| 43 | `apps/api/wrangler.jsonc` | `env.staging.queues[]` | Queue | staging | consumer ← straumvakt-outbound-staging (dlq straumvakt-outbound-dlq-staging) | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `apps/api/wrangler.jsonc:queues` |
| 44 | `apps/api/wrangler.jsonc` | `env.staging.queues[]` | Queue | staging | consumer ← straumvakt-ocpp-events-staging (dlq straumvakt-ocpp-events-dlq-staging) | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `apps/api/wrangler.jsonc:queues` |
| 45 | `apps/api/wrangler.jsonc` | `env.staging.queues[]` | Queue | staging | consumer ← straumvakt-archive-events-staging (dlq straumvakt-archive-events-dlq-staging) | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `apps/api/wrangler.jsonc:queues` |
| 46 | `apps/api/wrangler.jsonc` | `env.staging.triggers` | Worker | staging | {crons} | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `apps/api/wrangler.jsonc:triggers` |
| 47 | `apps/api/wrangler.jsonc` | `env.staging.unsafe` | unknown | staging | {bindings} | NOT inherited into named envs — must be redeclared | none | none | none | no | `apps/api/wrangler.jsonc:unsafe` |
| 48 | `gateway/wrangler.jsonc` | `$schema` | unknown | top-level | "node_modules/wrangler/config-schema.json" | inherited into named envs unless overridden | none | none | none | no | `gateway/wrangler.jsonc:$schema` |
| 49 | `gateway/wrangler.jsonc` | `name` | Worker | top-level | "straumvakt-ocpp" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:name` |
| 50 | `gateway/wrangler.jsonc` | `main` | Worker | top-level | "src/index.ts" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:main` |
| 51 | `gateway/wrangler.jsonc` | `compatibility_date` | Worker | top-level | "2026-04-18" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:compatibility_date` |
| 52 | `gateway/wrangler.jsonc` | `compatibility_flags` | Worker | top-level | array[1] | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:compatibility_flags` |
| 53 | `gateway/wrangler.jsonc` | `durable_objects` | Durable Object | top-level | {bindings} | NOT inherited into named envs — must be redeclared | high — per-object wakeups + duration | class name is a migration boundary | migrations are not reversible in place | no | `gateway/wrangler.jsonc:durable_objects` |
| 54 | `gateway/wrangler.jsonc` | `durable_objects[]` | Durable Object | top-level | IDENTITY_DO → IdentityDurableObject | NOT inherited into named envs — must be redeclared | high — per-object wakeups + duration | class name is a migration boundary | migrations are not reversible in place | no | `gateway/wrangler.jsonc:durable_objects` |
| 55 | `gateway/wrangler.jsonc` | `migrations` | Durable Object | top-level | array[1] | inherited into named envs unless overridden | none | a new_sqlite_classes tag is one-way | cannot be undone in place — this is the sharpest edge in the file | no | `gateway/wrangler.jsonc:migrations` |
| 56 | `gateway/wrangler.jsonc` | `migrations[]` | Durable Object | top-level | migration v1: ["IdentityDurableObject"] | NOT inherited into named envs — must be redeclared | none | class name is a migration boundary | migrations are not reversible in place | no | `gateway/wrangler.jsonc:migrations` |
| 57 | `gateway/wrangler.jsonc` | `services` | Worker | top-level | array[1] | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | target Worker must exist in the same environment | redeploy | no | `gateway/wrangler.jsonc:services` |
| 58 | `gateway/wrangler.jsonc` | `services[]` | Worker | top-level | service MAIN_APP → hlada-api | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:services` |
| 59 | `gateway/wrangler.jsonc` | `observability` | Cloudflare observability | top-level | {enabled} | inherited into named envs unless overridden | low — but log volume scales with frame volume | enabling is additive | toggle off | no | `gateway/wrangler.jsonc:observability` |
| 60 | `gateway/wrangler.jsonc` | `env.staging.name` | Worker | staging | "straumvakt-ocpp-staging" | inherited into named envs unless overridden | medium — request + CPU | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:name` |
| 61 | `gateway/wrangler.jsonc` | `env.staging.durable_objects` | Durable Object | staging | {bindings} | NOT inherited into named envs — must be redeclared | high — per-object wakeups + duration | class name is a migration boundary | migrations are not reversible in place | no | `gateway/wrangler.jsonc:durable_objects` |
| 62 | `gateway/wrangler.jsonc` | `env.staging.durable_objects[]` | Durable Object | staging | IDENTITY_DO → IdentityDurableObject | NOT inherited into named envs — must be redeclared | high — per-object wakeups + duration | class name is a migration boundary | migrations are not reversible in place | no | `gateway/wrangler.jsonc:durable_objects` |
| 63 | `gateway/wrangler.jsonc` | `env.staging.services` | Worker | staging | array[1] | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | target Worker must exist in the same environment | redeploy | no | `gateway/wrangler.jsonc:services` |
| 64 | `gateway/wrangler.jsonc` | `env.staging.services[]` | Worker | staging | service MAIN_APP → hlada-api-staging | NOT inherited into named envs — must be redeclared | medium — a synchronous Worker-to-Worker hop per call | name change creates a new Worker | redeploy previous version | no | `gateway/wrangler.jsonc:services` |
| 65 | `gateway/wrangler.jsonc` | `env.staging.queues` | Queue | staging | {producers} | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `gateway/wrangler.jsonc:queues` |
| 66 | `gateway/wrangler.jsonc` | `env.staging.queues[]` | Queue | staging | producer OCPP_EVENTS_QUEUE → straumvakt-ocpp-events-staging | NOT inherited into named envs — must be redeclared | high — per-message op | binding must exist per environment | in-flight messages survive a rollback | no | `gateway/wrangler.jsonc:queues` |
| 67 | `gateway/src/heartbeat-fastpath.ts` | `PRODUCT_HEARTBEAT_INTERVAL_SECONDS` | Worker | all | idle heartbeat frame, seconds | source, not config | medium — request + CPU | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:PRODUCT_HEARTBEAT_INTERVAL_SECONDS` |
| 68 | `gateway/src/heartbeat-fastpath.ts` | `bootNotificationIntervalSeconds` | Worker | all | derives advertised interval from liveness config | source, not config | medium — request + CPU | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:bootNotificationIntervalSeconds` |
| 69 | `gateway/src/heartbeat-fastpath.ts` | `resolveHeartbeatIntervalSeconds` | Worker | all | range-guarded env override | source, not config | medium — request + CPU | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:resolveHeartbeatIntervalSeconds` |
| 70 | `gateway/src/heartbeat-fastpath.ts` | `bypassesIngest` | Queue | all | actions that skip queue + ingest | source, not config | high — per-message op | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:bypassesIngest` |
| 71 | `gateway/src/heartbeat-fastpath.ts` | `recordFrame` | Durable Object | all | liveness transition + rollup | source, not config | high — per-object wakeups + duration | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:recordFrame` |
| 72 | `gateway/src/heartbeat-fastpath.ts` | `frameCapDecision` | Durable Object | all | per-connector frame cap | source, not config | high — per-object wakeups + duration | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:frameCapDecision` |
| 73 | `gateway/src/heartbeat-fastpath.ts` | `CAP_EXEMPT_ACTIONS` | Durable Object | all | billing-material actions never shed | source, not config | high — per-object wakeups + duration | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 74 | `gateway/src/heartbeat-fastpath.ts` | `DEFAULT_FRAME_CAP` | Durable Object | all | window, max frames, quarantine, anomaly threshold | source, not config | high — per-object wakeups + duration | present | git revert | no | `gateway/src/heartbeat-fastpath.ts:DEFAULT_FRAME_CAP` |
| 75 | `gateway/src/identity-do.ts` | `handleInboundCall` | Durable Object | all | frame entry point | source, not config | high — per-object wakeups + duration | present | git revert | no | `gateway/src/identity-do.ts:handleInboundCall` |
| 76 | `gateway/src/identity-do.ts` | `stubResponseFor` | Worker | all | BootNotification/Heartbeat replies | source, not config | medium — request + CPU | present | git revert | no | `gateway/src/identity-do.ts:stubResponseFor` |
| 77 | `gateway/src/identity-do.ts` | `OPS_STATE_KEY` | Durable Object | all | single storage key for liveness + cap | source, not config | high — per-object wakeups + duration | present | git revert | no | `gateway/src/identity-do.ts:OPS_STATE_KEY` |
| 78 | `gateway/src/ingest-client.ts` | `enqueueOrPost` | Queue | all | queue producer with service-binding fallback | source, not config | high — per-message op | present | git revert | no | `gateway/src/ingest-client.ts:enqueueOrPost` |
| 79 | `gateway/src/metrics.ts` | `createMetricsWriter` | Analytics Engine | all | no-op safe writer | source, not config | low — sampled writes | present | git revert | no | `gateway/src/metrics.ts:createMetricsWriter` |
| 80 | `gateway/src/metrics.ts` | `METRIC_NAMES` | Analytics Engine | all | closed vocabulary, 9 names | source, not config | low — sampled writes | present | git revert | no | `gateway/src/metrics.ts:METRIC_NAMES` |
| 81 | `gateway/src/metrics.ts` | `pseudonymiseIdentity` | Analytics Engine | all | salted FNV-1a, sync | source, not config | low — sampled writes | present | git revert | no | `gateway/src/metrics.ts:pseudonymiseIdentity` |
| 82 | `gateway/src/metrics.ts` | `FORBIDDEN_DIMENSION_KEYS` | Analytics Engine | all | runtime PII guard | source, not config | low — sampled writes | present | git revert | no | `gateway/src/metrics.ts:FORBIDDEN_DIMENSION_KEYS` |
| 83 | `gateway/src/sentry-scrub.ts` | `scrubEvent` | Sentry/env | all | beforeSend transform | source, not config | none | present | git revert | no | `gateway/src/sentry-scrub.ts:scrubEvent` |
| 84 | `gateway/src/sentry-scrub.ts` | `OCPP_PAYLOAD_ALLOWLIST` | Sentry/env | all | payload allowlist | source, not config | none | present | git revert | no | `gateway/src/sentry-scrub.ts:OCPP_PAYLOAD_ALLOWLIST` |
| 85 | `gateway/src/sentry-scrub.ts` | `DENY_KEY_SUBSTRINGS` | Sentry/env | all | key denylist incl. kennitala | source, not config | none | present | git revert | no | `gateway/src/sentry-scrub.ts:DENY_KEY_SUBSTRINGS` |
| 86 | `gateway/src/sentry-scrub.ts` | `sentryConfigFrom` | Sentry/env | all | fail-closed when DSN absent | source, not config | none | present | git revert | no | `gateway/src/sentry-scrub.ts:sentryConfigFrom` |
| 87 | `gateway/src/auth.ts` | `GatewayEnv` | Worker | all | env surface / binding contract | source, not config | medium — request + CPU | present | git revert | no | `gateway/src/auth.ts:GatewayEnv` |
| 88 | `gateway/src/auth.ts` | `parseBasicAuth` | Worker | all | charger credential parsing | source, not config | medium — request + CPU | present | git revert | no | `gateway/src/auth.ts:parseBasicAuth` |
| 89 | `.github/workflows/check.yml` | `workflow` | Worker | ci | GitHub Actions workflow | n/a | none | CI gate | n/a | no | `.github/workflows/check.yml` |
| 90 | `.github/workflows/zaptec-consumer-deploy.yml` | `workflow` | Worker | ci | GitHub Actions workflow | n/a | none | CI gate | n/a | no | `.github/workflows/zaptec-consumer-deploy.yml` |
| 91 | `package.json` | `scripts.dev` | Worker | local | next dev | n/a | none | local | n/a | no | `package.json:scripts.dev` |
| 92 | `package.json` | `scripts.build` | Worker | local | next build --webpack | n/a | none | local | n/a | no | `package.json:scripts.build` |
| 93 | `package.json` | `scripts.start` | Worker | local | next start | n/a | none | local | n/a | no | `package.json:scripts.start` |
| 94 | `package.json` | `scripts.lint` | Worker | local | next lint | n/a | none | local | n/a | no | `package.json:scripts.lint` |
| 95 | `package.json` | `scripts.typecheck` | Worker | local | tsc --noEmit && npm run typecheck --workspace… | n/a | none | local | n/a | no | `package.json:scripts.typecheck` |
| 96 | `package.json` | `scripts.format` | Worker | local | prettier --write "src/**/*.{ts,tsx,css,md}" | n/a | none | local | n/a | no | `package.json:scripts.format` |
| 97 | `package.json` | `scripts.deploy` | Worker | local | next build --webpack && opennextjs-cloudflare… | n/a | none | MUTATING — this is a deploy path | n/a | no | `package.json:scripts.deploy` |
| 98 | `package.json` | `scripts.deploy:staging` | Worker | local | next build --webpack && opennextjs-cloudflare… | n/a | none | MUTATING — this is a deploy path | n/a | no | `package.json:scripts.deploy:staging` |
| 99 | `package.json` | `scripts.preview` | Worker | local | next build --webpack && opennextjs-cloudflare… | n/a | none | local | n/a | no | `package.json:scripts.preview` |
| 100 | `package.json` | `scripts.preview:staging` | Worker | local | next build --webpack && opennextjs-cloudflare… | n/a | none | local | n/a | no | `package.json:scripts.preview:staging` |
| 101 | `package.json` | `scripts.test` | Worker | local | vitest run | n/a | none | local | n/a | no | `package.json:scripts.test` |
| 102 | `package.json` | `scripts.test:watch` | Worker | local | vitest | n/a | none | local | n/a | no | `package.json:scripts.test:watch` |
| 103 | `package.json` | `scripts.db:generate` | Worker | local | prisma generate && npm --prefix apps/api run … | n/a | none | local | n/a | no | `package.json:scripts.db:generate` |
| 104 | `package.json` | `scripts.db:studio` | Worker | local | prisma studio | n/a | none | local | n/a | no | `package.json:scripts.db:studio` |
| 105 | `package.json` | `scripts.db:validate` | Worker | local | prisma validate | n/a | none | local | n/a | no | `package.json:scripts.db:validate` |
| 106 | `package.json` | `scripts.sync:api-schema` | Worker | local | node scripts/sync-api-prisma-schema.mjs | n/a | none | local | n/a | no | `package.json:scripts.sync:api-schema` |
| 107 | `package.json` | `scripts.check:api-schema` | Worker | local | node scripts/sync-api-prisma-schema.mjs --check | n/a | none | local | n/a | no | `package.json:scripts.check:api-schema` |
| 108 | `package.json` | `scripts.sync:detour-assets` | Worker | local | node scripts/sync-detour-assets.mjs | n/a | none | local | n/a | no | `package.json:scripts.sync:detour-assets` |
| 109 | `package.json` | `scripts.check:deps` | Worker | local | depcruise apps/api/src src packages --config … | n/a | none | local | n/a | no | `package.json:scripts.check:deps` |
| 110 | `package.json` | `scripts.deps:baseline` | Worker | local | depcruise apps/api/src src packages --config … | n/a | none | local | n/a | no | `package.json:scripts.deps:baseline` |
| 111 | `package.json` | `scripts.deps:graph` | Worker | local | node scripts/gen-dependency-graph.mjs | n/a | none | local | n/a | no | `package.json:scripts.deps:graph` |
| 112 | `package.json` | `scripts.check:deps-graph` | Worker | local | node scripts/gen-dependency-graph.mjs --check | n/a | none | local | n/a | no | `package.json:scripts.check:deps-graph` |
| 113 | `package.json` | `scripts.check` | Worker | local | node scripts/check-all.mjs | n/a | none | local | n/a | no | `package.json:scripts.check` |
| 114 | `package.json` | `scripts.check:schemas` | Worker | local | prisma validate --schema prisma/schema && pri… | n/a | none | local | n/a | no | `package.json:scripts.check:schemas` |
| 115 | `package.json` | `scripts.check:workspace-typecheck` | Worker | local | node scripts/check-workspace-typecheck.mjs | n/a | none | local | n/a | no | `package.json:scripts.check:workspace-typecheck` |
| 116 | `package.json` | `scripts.check:migrations-visible` | Worker | local | tsx scripts/check-migrations-visible.mts | n/a | none | local | n/a | no | `package.json:scripts.check:migrations-visible` |
| 117 | `package.json` | `scripts.check:migrations` | Worker | local | prisma migrate status --schema prisma/schema | n/a | none | local | n/a | no | `package.json:scripts.check:migrations` |
| 118 | `package.json` | `scripts.api:endpoints` | Worker | local | node scripts/gen-api-endpoints.mjs | n/a | none | local | n/a | no | `package.json:scripts.api:endpoints` |
| 119 | `package.json` | `scripts.check:api-endpoints` | Worker | local | node scripts/gen-api-endpoints.mjs --check | n/a | none | local | n/a | no | `package.json:scripts.check:api-endpoints` |
| 120 | `package.json` | `scripts.check:unused-exports` | Worker | local | node scripts/check-unused-exports.mjs | n/a | none | local | n/a | no | `package.json:scripts.check:unused-exports` |
| 121 | `package.json` | `scripts.unused-exports:baseline` | Worker | local | node scripts/check-unused-exports.mjs --baseline | n/a | none | local | n/a | no | `package.json:scripts.unused-exports:baseline` |
| 122 | `package.json` | `scripts.db:generate:sql` | Worker | local | npm --prefix apps/api exec -- drizzle-kit gen… | n/a | none | local | n/a | no | `package.json:scripts.db:generate:sql` |
| 123 | `package.json` | `scripts.db:baseline` | Worker | local | node apps/api/scripts/drizzle-baseline.mjs | n/a | none | local | n/a | no | `package.json:scripts.db:baseline` |
| 124 | `package.json` | `scripts.db:migrate:status` | Worker | local | npm --prefix apps/api exec -- drizzle-kit check | n/a | none | local | n/a | no | `package.json:scripts.db:migrate:status` |
| 125 | `package.json` | `scripts.check:schema-consistency` | Worker | local | node scripts/check-schema-consistency.mjs | n/a | none | local | n/a | no | `package.json:scripts.check:schema-consistency` |
| 126 | `package.json` | `scripts.work-view` | Worker | local | node scripts/gen-work-view.mjs | n/a | none | local | n/a | no | `package.json:scripts.work-view` |
| 127 | `package.json` | `scripts.check:work-view` | Worker | local | node scripts/gen-work-view.mjs --check | n/a | none | local | n/a | no | `package.json:scripts.check:work-view` |
| 128 | `gateway/package.json` | `scripts.dev` | Worker | local | wrangler dev | n/a | none | local | n/a | no | `gateway/package.json:scripts.dev` |
| 129 | `gateway/package.json` | `scripts.deploy` | Worker | local | wrangler deploy | n/a | none | MUTATING — this is a deploy path | n/a | no | `gateway/package.json:scripts.deploy` |
| 130 | `gateway/package.json` | `scripts.deploy:staging` | Worker | local | wrangler deploy --env staging | n/a | none | MUTATING — this is a deploy path | n/a | no | `gateway/package.json:scripts.deploy:staging` |
| 131 | `gateway/package.json` | `scripts.typecheck` | Worker | local | tsc --noEmit | n/a | none | local | n/a | no | `gateway/package.json:scripts.typecheck` |
| 132 | `gateway/package.json` | `scripts.test` | Worker | local | vitest run | n/a | none | local | n/a | no | `gateway/package.json:scripts.test` |
| 133 | `apps/api/package.json` | `scripts.dev` | Worker | local | wrangler dev | n/a | none | local | n/a | no | `apps/api/package.json:scripts.dev` |
| 134 | `apps/api/package.json` | `scripts.deploy:staging` | Worker | local | prisma generate && wrangler deploy --env staging | n/a | none | MUTATING — this is a deploy path | n/a | no | `apps/api/package.json:scripts.deploy:staging` |
| 135 | `apps/api/package.json` | `scripts.deploy:prod` | Worker | local | prisma generate && wrangler deploy | n/a | none | MUTATING — this is a deploy path | n/a | no | `apps/api/package.json:scripts.deploy:prod` |
| 136 | `apps/api/package.json` | `scripts.prisma:generate` | Worker | local | prisma generate | n/a | none | local | n/a | no | `apps/api/package.json:scripts.prisma:generate` |
| 137 | `apps/api/package.json` | `scripts.typecheck` | Worker | local | tsc --noEmit && tsc --noEmit -p tsconfig.test… | n/a | none | local | n/a | no | `apps/api/package.json:scripts.typecheck` |
| 138 | `apps/api/package.json` | `scripts.test:parity` | Worker | local | vitest run --config vitest.parity.config.ts | n/a | none | local | n/a | no | `apps/api/package.json:scripts.test:parity` |
| 139 | `apps/api/package.json` | `scripts.script` | Worker | local | node scripts/run.mjs | n/a | none | local | n/a | no | `apps/api/package.json:scripts.script` |
| 140 | `gateway/src/heartbeat-fastpath.ts` | `action:Heartbeat` | Durable Object | all | storage=liveness only; bypassesIngest=yes; capExempt=no | source, not config | 720/connector/month at 3600 s; 43,200 at 60 s | gates OB6, OC1, OC5 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 141 | `gateway/src/heartbeat-fastpath.ts` | `action:BootNotification` | Durable Object | all | storage=event; bypassesIngest=no; capExempt=yes | source, not config | one per connect; carries the interval reply | gates OB6, OB7 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 142 | `gateway/src/heartbeat-fastpath.ts` | `action:StatusNotification` | Durable Object | all | storage=event; bypassesIngest=no; capExempt=no | source, not config | per connector state change | gates OC4 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 143 | `gateway/src/heartbeat-fastpath.ts` | `action:MeterValues` | Durable Object | all | storage=billing material; bypassesIngest=no; capExempt=yes | source, not config | UNKNOWN until M-3; dominates active sessions | gates OC6 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 144 | `gateway/src/heartbeat-fastpath.ts` | `action:StartTransaction` | Durable Object | all | storage=billing material; bypassesIngest=no; capExempt=yes | source, not config | one per session | gates OC6 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 145 | `gateway/src/heartbeat-fastpath.ts` | `action:StopTransaction` | Durable Object | all | storage=billing material; bypassesIngest=no; capExempt=yes | source, not config | one per session | gates OC6 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 146 | `gateway/src/heartbeat-fastpath.ts` | `action:Authorize` | Durable Object | all | storage=event; bypassesIngest=no; capExempt=yes | source, not config | one per session start; upstream call | gates OC4 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 147 | `gateway/src/heartbeat-fastpath.ts` | `action:DataTransfer` | Durable Object | all | storage=raw protocol; bypassesIngest=no; capExempt=no | source, not config | vendor-specific, unbounded by spec | gates OC7, OC8 | git revert | no | `heartbeat-fastpath.ts:CAP_EXEMPT_ACTIONS` |
| 148 | `gateway/src/metrics.ts` | `metric:heartbeats_received` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 149 | `gateway/src/metrics.ts` | `metric:heartbeats_suppressed` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 150 | `gateway/src/metrics.ts` | `metric:missed_heartbeats` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 151 | `gateway/src/metrics.ts` | `metric:queue_messages_by_type` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 152 | `gateway/src/metrics.ts` | `metric:noisy_charger_events` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 153 | `gateway/src/metrics.ts` | `metric:gateway_errors_by_type` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 154 | `gateway/src/metrics.ts` | `metric:billing_job_started` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 155 | `gateway/src/metrics.ts` | `metric:billing_job_completed` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 156 | `gateway/src/metrics.ts` | `metric:billing_job_failed` | Analytics Engine | all | index=name; blobs=[name, cid, eventType, errorKind, period] | source, not config | one sampled data point per occurrence; cardinality bounded by the closed vocabulary | no binding today ⇒ written nowhere | additive | no | `metrics.ts:METRIC_NAMES` |
| 157 | `(Worker secret)` | `secret:OCPP_INGEST_SECRET` | Secrets Store | gateway + api | NAME ONLY — value never read by this census | secrets are per-environment, never inherited | none | shared ingest gate between gateway and API | re-set the secret | no | `docs/notes — never the value` |
| 158 | `(Worker secret)` | `secret:SENTRY_DSN` | Secrets Store | gateway | NAME ONLY — value never read by this census | secrets are per-environment, never inherited | none | absent today; fail-closed disables reporting | re-set the secret | no | `docs/notes — never the value` |
| 159 | `(Worker secret)` | `secret:AUTH_SECRET` | Secrets Store | api | NAME ONLY — value never read by this census | secrets are per-environment, never inherited | none | a real value is already public in git history — must be rotated, not reused | re-set the secret | yes | `docs/notes — never the value` |
| 160 | `(Worker secret)` | `secret:DATABASE_URL` | Secrets Store | api | NAME ONLY — value never read by this census | secrets are per-environment, never inherited | none | Neon DSN; secret binding, never a plaintext var | re-set the secret | no | `docs/notes — never the value` |

---

## The twenty claims, verified or refuted

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Advertised heartbeat interval is derived from the liveness config, not a second literal | **verified** | `heartbeat-fastpath.ts:bootNotificationIntervalSeconds` derives from `idleHeartbeatIntervalMs`; `identity-do.ts:1027` routes through `resolveHeartbeatIntervalSeconds`. Gate OB6/OB7. |
| 2 | Unchanged heartbeats skip queue and DB ingest | **verified** | `identity-do.ts:647` guards on `bypassesIngest` before the enqueue and returns after replying. Gate OB2–OB4, OC1. |
| 3 | Missed heartbeat creates an event | **REFUTED** | Liveness transitions are computed only in `handleInboundCall`. Nothing runs when nothing arrives, so a charger that goes silent produces **no event at all** — its offline state is discovered on the next frame, which may never come. The DO `alarm()` exists but is the outbound-command timeout sweep, not a liveness sweeper. |
| 4 | Queue binding exists for the intended environment | **REFUTED for top-level** | Producer declared in `env.staging` only; top-level `straumvakt-ocpp` has none. Consumers likewise only in `hlada-api-staging`. |
| 5 | Worker-to-Worker synchronous fallback still exists, and when | **verified** | `ingest-client.ts:112` — used when `env.OCPP_EVENTS_QUEUE` is undefined (local dev **and top-level**) or when `queue.send` throws. Logs `posted_fallback` at `console.log`, which is not an alert. |
| 6 | Per-connector frame cap exists and is tested | **verified** | `frameCapDecision`; 35 assertions in `heartbeat-fastpath.selftest.mjs`. Gate OB5, OC10. |
| 7 | Noisy-charger breach emits a signal without logging sensitive payload | **partly** | `frame_cap.breached` / `frame_cap.anomaly` are `console.warn`/`console.error` with identity and counts, no payload — safe. But they are **logs, not metrics or events**: nothing aggregates them, and `noisy_charger_events` has no writer call yet. |
| 8 | Sentry DSN binding present, or fail-closed missing | **fail-closed missing** | `sentryConfigFrom` returns `enabled:false` on absent/blank DSN. No DSN anywhere. Gate OB12 blocks a literal. |
| 9 | Scrubber cannot leak idTag, Basic Auth, credentials, query strings, user, kennitala, or unknown future fields | **verified** | Denylist of key substrings at any depth/casing + payload allowlist; `user` dropped wholesale; URL userinfo and query stripped. Unknown-field case has a dedicated test. |
| 10 | Analytics Engine binding present, or fail-closed missing | **fail-closed missing** | Commented placeholder; gate OB14 fails until configured. Writer no-ops. |
| 11 | Metrics vocabulary is closed and cannot accept arbitrary keys | **verified** | `MetricName` union + `MetricDimensions` with four named fields, no free-form bag; `FORBIDDEN_DIMENSION_KEYS` backs it at runtime. |
| 12 | `workers_dev` / custom-domain behaviour is safe | **REFUTED (3 environments)** | `hlada` top-level, `hlada-api` top-level and `hlada-api-staging` declare neither `routes` nor `workers_dev`. Adding a route infers `workers_dev:false` and removes a host a shipped mobile client pins. Unchanged since 2026-08-09. Gate OC20. |
| 13 | Route/custom-domain config cannot accidentally break the pinned mobile host | **REFUTED** | Same as 12. `apps/mobile/lib/api/client.dart:25` pins `hlada-api-staging.straumvakt.workers.dev` with no runtime override, so recovery is server-side only — a client fix costs a store release. |
| 14 | Production release has a version id / rollback target | **REFUTED — blocking** | `version_metadata` commented; no version id has ever been recorded. Gate OB15. |
| 15 | R2 export/debug bundle story exists | **staging only** | `EVIDENCE_BUCKET → straumvakt-evidence-staging` in `env.staging`; absent top-level. No lifecycle/TTL declared anywhere. |
| 16 | Workflows present, and would billing jobs benefit | **absent** | Zero `workflows` keys. Billing/report jobs currently have no declared scheduler; see the alert policy note — this is a gap, not a decision. |
| 17 | Cloudflare Access present for internal tools | **absent** | Zero references to Access, Zero Trust or `CF_Authorization` in any config or source. |
| 18 | Secrets runbook cannot expose secret values in evidence artifacts | **verified by construction** | This census records secret **names** only; the runbook forbids storing raw `/secrets` responses (`key_base64`, `key_jwk`) and forbids `GET .../scripts/{name}` which returns the source bundle. |
| 19 | Sentry and Analytics additions are in Core docs | **verified** | Three notes from the prior run, plus this one. |
| 20 | All cost-sensitive terms have an owner/checker | **REFUTED** | Idle heartbeat → OC5/OB6 ✓. Frame cap → OC10/OB5 ✓. Queue ops → OC1 ✓ but **not per environment** until OB16. Active-session `MeterValues` → **no checker can help; needs M-3**. DO duration → no checker. Neon writes → no checker. |

### Score

**Verified 9 · refuted 7 · fail-closed-missing 2 · partly 1 · absent 2** (17–20 overlap categories; each row is counted once by its strongest verdict).

The refutations cluster into three groups, and only one of them is new:

- **Environment asymmetry** (3, 4, 15) — new this run, and the most
  consequential.
- **Pinned-host foot-gun** (12, 13) — known since 2026-08-09, unchanged.
- **No rollback target** (14) — known, still the single blocking fact.

Claim 3 is the other new one and is quieter: a fleet whose chargers can
die without anyone being told is not observable, whatever the dashboards
say.
