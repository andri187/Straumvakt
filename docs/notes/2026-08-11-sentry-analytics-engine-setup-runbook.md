# Sentry + Analytics Engine — setup runbook

Everything below needs Andri's approval and a Cloudflare session. The
code side is already merged-ready; this is the part that changes cloud
state.

Nothing in this runbook was executed by the lane that wrote it.

---

## Exact names

| Kind | Name | Where |
|---|---|---|
| Analytics Engine binding | `OCPP_METRICS` | `gateway/wrangler.jsonc` |
| Analytics Engine dataset | `straumvakt_ocpp_metrics` | created on first write |
| Version metadata binding | `CF_VERSION_METADATA` | `gateway/wrangler.jsonc` |
| Sentry DSN | `SENTRY_DSN` | Worker **secret** |
| Interval override | `OCPP_HEARTBEAT_INTERVAL_SECONDS` | var, optional, usually absent |

The dataset name is a **proposal**, not something discovered from the
account. If a naming convention already exists, that wins — change the
placeholder and the gate follows.

## Step 1 — version_metadata (do this first)

This is the project's single blocking release gap: no Worker version id
has ever been recorded, so there is no rollback target and release rule
R1 correctly rejects every release.

In `gateway/wrangler.jsonc`, uncomment:

```jsonc
"version_metadata": { "binding": "CF_VERSION_METADATA" },
```

Deploy staging. Then **record the version id** — that recording, not the
binding, is what closes C1.

Gate: `OB15` passes.

## Step 2 — Analytics Engine

Uncomment:

```jsonc
"analytics_engine_datasets": [
  { "binding": "OCPP_METRICS", "dataset": "straumvakt_ocpp_metrics" }
],
```

Add it to `env.staging` as well — **bindings are not inheritable into
named environments**, unlike `workers_dev` and `routes`. A binding
declared only at the top level does not exist in staging. This has
already caused one incorrect finding in this project, so it is worth
stating twice.

No dashboard provisioning is required; the dataset appears on first
write.

Gate: `OB14` passes.

## Step 3 — call the writer

Not done by this lane, on purpose. The writer is built, tested and
gated, but calling it from the OCPP hot path changes hot-path behaviour,
and doing that with no binding to observe and no hardware to verify
against is how a fast path regresses.

Wire in `identity-do.ts`, minimally, once the binding exists:

```ts
const metrics = createMetricsWriter(this.env.OCPP_METRICS);
// on every inbound frame:
metrics.count("heartbeats_received", { identity, eventType: frame.action });
// on the fast-path return:
metrics.count("heartbeats_suppressed", { identity });
```

Those two are the priority. Their ratio is the only thing that will tell
you the fast path is still working in production.

Then, in order of value: `missed_heartbeats` on the liveness transition,
`noisy_charger_events` on a cap breach, `queue_messages_by_type` at the
enqueue, `gateway_errors_by_type` in the parse-error path.

Verify: the writer is no-op safe, so this can ship before the binding
without effect. Confirm points arrive before relying on any dashboard.

## Step 4 — Sentry

**Install** (not done here — no node_modules in this worktree):

```
npm i @sentry/cloudflare
```

**Wire** in `gateway/src/index.ts`:

```ts
import * as Sentry from "@sentry/cloudflare";
import { scrubEvent, sentryConfigFrom } from "./sentry-scrub";

export default Sentry.withSentry(
  (env) => {
    const cfg = sentryConfigFrom(env, "staging");
    return {
      dsn: cfg.dsn,
      enabled: cfg.enabled,
      release: cfg.release,        // CF_VERSION_METADATA.id
      environment: cfg.environment,
      tracesSampleRate: 0.05,
      beforeSend: scrubEvent,      // ← non-negotiable
      beforeBreadcrumb: (b) => scrubEvent({ breadcrumbs: [b] }).breadcrumbs?.[0] ?? null,
    };
  },
  handler,
);
```

The Durable Object needs `Sentry.instrumentDurableObjectWithSentry` with
the same options object — a DO exception is the high-severity case and
it does not flow through the Worker handler.

**Secret**:

```
wrangler secret put SENTRY_DSN --env staging
```

Never a `vars` entry. A DSN is a credential: anyone holding it can forge
events into the project.

**Verification gate before production.** Do not set the production DSN
until a **real staging payload containing an idTag is confirmed
scrubbed** in the Sentry UI. This is measurement M-8. An unscrubbed
event is a personal-data export to a third-party processor, and it
cannot be un-sent.

Gates: `OB11` already passes (scrubber exists); `OB12` fails the build
if a DSN literal is ever committed.

## Order

**1 → 2 → 3 → 4**, staging fully before production at every step.

Step 1 is the one with standalone value: it closes the release gap
whether or not anything else here happens.

## Rollback

| Step | Undo |
|---|---|
| 1, 2 | redeploy previous config; bindings are additive, nothing depends on them |
| 3 | writer is no-op safe — removing the binding disables it with no code change |
| 4 | `wrangler secret delete SENTRY_DSN`; absent DSN disables reporting by design |

No step here is a one-way door. Step 1 is the step that *removes* one.

## What this does not cover

- Queue depth and DLQ alerts — pre-existing blind spot, follows the
  first charger.
- R2 bucket bounds.
- Connected-charger count, which is still not exposed by any surface, so
  the gateway rollback drill remains unverifiable.
- Sampling rates under real load. `0.05` is a starting guess, not a
  measured value.
