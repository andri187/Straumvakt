# Inbound OCPP queue — staging operator runbook

**Sprint:** 5 — first runbook for the queue-backed ingest path. Sprint 10
expands this into the production runbook.

## Resources

| Role | Cloudflare Queues name | Notes |
|---|---|---|
| Main | `straumvakt-ocpp-events-staging` | producer = gateway DO; consumer = `hlada-api-staging` |
| DLQ | `straumvakt-ocpp-events-dlq-staging` | catches poison messages + post-max_retries failures |

Bound by:
- `gateway/wrangler.jsonc` env.staging — producer binding `OCPP_EVENTS_QUEUE`
- `apps/api/wrangler.jsonc` env.staging — consumer config (max_batch_size=100, max_retries=3)

## Deploy ordering (Sprint 5.1 → 5.2 cutover)

The producer (gateway) only flips to enqueue in Milestone 5.2. Until
then the gateway DO still calls `postEvent()` over service binding;
the queue exists with no messages flowing.

When Milestone 5.2 lands, deploy in this order:

1. **api Worker first** — `cd apps/api && npm run deploy:staging`. This
   is what makes the consumer live. Check `wrangler tail` for the
   `[ocpp-q] consumed` log line on the next event after gateway flips.
2. **Gateway second** — `cd gateway && npx wrangler deploy --env staging`.
   This is what flips the producer.

The reverse order (gateway first) drops events: enqueued envelopes have
no consumer to drain them, and Cloudflare Queues holds them but the
operator can't see ingest progress until the api Worker catches up.

## Watching the queue

```powershell
# Live consumer logs (apps/api)
cd apps/api
npx wrangler tail --env staging --format pretty
```

### Grep-able log lines (Sprint 5.4)

All queue-related lines use a fixed `[ocpp-q]` (consumer side) or
`[ocpp-gw]` (gateway producer side) prefix so a single pipe slices
the firehose down to operationally-relevant events.

**Producer (`straumvakt-ocpp-staging`)**

| Pattern | Meaning | Useful keys |
|---|---|---|
| `[ocpp-gw] enqueued` | Queue.send succeeded | `eventId`, `eventType`, `sendMs` (should be ≤ 5ms p95) |
| `[ocpp-gw] queue.send failed, falling back to postEvent` | Queue accept threw — falling back to service binding | `eventId`, `sendMs`, `error` |
| `[ocpp-gw] posted_fallback` | Service-binding fallback completed | `eventId`, `kind` (accepted/rejected/retriable) |
| `[ocpp-gw] authorize.evaluated` | Authorize/StartTransaction verdict resolved | `verdict`, `mode` (enforced/shadow), `idTag`, `userId`, `idTokenId` |
| `[ocpp-gw] command_result ingest failed` | Outbound-command result envelope failed to ingest | `eventId`, `kind`, `error` |

**Consumer (`hlada-api-staging`)**

| Pattern | Meaning | Useful keys |
|---|---|---|
| `[ocpp-q] batch_start` | New batch arriving | `queue`, `count` |
| `[ocpp-q] batch_summary` | End-of-batch summary | `acked`, `retried`, `dropped`, `recorded`, `replays`, `p50LagMs`, `p95LagMs`, `durationMs` |
| `[ocpp-q] consumed` | Single envelope ingested | `eventId`, `eventType`, `recorded`, `lagMs` |
| `[ocpp-q] validation_failed` | Poison drop (bad envelope shape) | `error`, `eventId` |
| `[ocpp-q] transient_failure` | Transient DB error → retried | `eventId`, `error` |

### Common queries

```powershell
# Producer-side — confirm enqueue latency is sub-5ms p95
npx wrangler tail straumvakt-ocpp-staging --format json | grep enqueued

# Consumer-side — batch-level summary stream (one line per batch)
npx wrangler tail hlada-api-staging --format json | grep batch_summary

# Hunting for poison messages
npx wrangler tail hlada-api-staging --format json | grep validation_failed

# Hunting for hyperdrive blips
npx wrangler tail hlada-api-staging --format json | grep transient_failure
```

DLQ depth via `wrangler queues list` (Sprint 10 wires Grafana).

## Diagnose a stuck queue

If `[ocpp-q] consumed` lines stop arriving but charger sessions
continue:

1. **Check consumer health.** `npx wrangler tail --env staging` —
   if no log lines at all, the apps/api Worker may be in a deploy
   stale state. Redeploy.
2. **Check queue depth.** `npx wrangler queues list`. If `producers=1
   consumers=0` for `straumvakt-ocpp-events-staging`, the consumer
   binding fell out of wrangler.jsonc — restore + redeploy.
3. **Check DLQ growth.** `npx wrangler queues list` — non-zero
   message count on `-dlq-staging` means poison messages are landing.
   See replay procedure below.

## DLQ replay

Three steps: diagnose → resolve underlying issue → replay.

### Diagnose

Pull a sample message from the DLQ to inspect its shape:

```powershell
cd apps/api
$env:CLOUDFLARE_API_TOKEN = "<token with Queues:edit>"
$env:CLOUDFLARE_ACCOUNT_ID = "<your account id>"

# Pull just one for a peek (this script also acks; use carefully)
# In practice — let `wrangler queues consumer log` (Cloudflare console)
# show you the offending message before running replay.
```

Common causes:
- **Validation failure** (`[ocpp-q] validation_failed`) — gateway
  emitted a malformed envelope. Fix the gateway code, redeploy. The
  bad message should NOT be replayed (it'll just fail again); use
  `wrangler queues purge straumvakt-ocpp-events-dlq-staging` after
  confirming no legitimate messages are in the DLQ.
- **Transient failure** (`[ocpp-q] transient_failure`) — Postgres /
  Hyperdrive blip. Wait for issue resolution, then run replay.

### Resolve

Validate the underlying issue is fixed:

```powershell
# Postgres reachable?
cd apps/api
npx prisma db execute --stdin <<< "SELECT 1"

# Hyperdrive log shows healthy?
# Cloudflare dashboard → Hyperdrive → staging binding → Logs
```

### Replay

```powershell
cd apps/api
$env:CLOUDFLARE_API_TOKEN = "<token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"

npx tsx scripts/replay-dlq.ts `
  --dlq straumvakt-ocpp-events-dlq-staging `
  --main straumvakt-ocpp-events-staging `
  --limit 100
```

The script pulls in batches of up to 100, re-publishes each onto the
main queue, and ack's the DLQ copy. Idempotency is preserved by the
unique constraint on `event_log_raw_protocol(event_id)` — a replayed
event whose original made it to Postgres is a no-op recorded:false.

Watch `wrangler tail` while the replay runs; you should see one
`[ocpp-q] consumed` line per replayed message with `recorded:false`
(if the original landed) or `recorded:true` (if it didn't).

## Smoke-test the path (5.1 only — gateway not flipped yet)

```powershell
# Drop a synthetic event onto the queue manually:
$body = @{
  eventId       = [guid]::NewGuid().Guid
  orgId         = "<a real staging orgId>"
  aggregateType = "ocpp_identity"
  aggregateId   = "<a real staging identity uuid>"
  eventType     = "ocpp.raw.Heartbeat"
  occurredAt    = (Get-Date).ToUniversalTime().ToString("o")
  correlationId = [guid]::NewGuid().Guid
  retentionClass = "raw_protocol"
  payload       = @{ action = "Heartbeat"; request = @{} }
} | ConvertTo-Json -Compress

npx wrangler queues producer publish straumvakt-ocpp-events-staging --body $body
```

Then `npx wrangler tail --env staging` — expect `[ocpp-q] consumed`
within a second.

## Local-dev notes

`wrangler dev --local` doesn't bind queues. The gateway DO falls back
to direct service binding (Sprint 5.2 wires this fallback). Local
charger simulator dev loop unchanged.
