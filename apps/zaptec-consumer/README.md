# Zaptec Service Bus Consumer

Long-running Node process that subscribes to Zaptec's Azure Service
Bus topic per installation and observes inbound events. Phase 1:
listen + log only. Phase 2 will translate events to our `IngestEvent`
envelope and POST them to `/api/internal/ocpp-events`.

## Why a separate app

Cloudflare Workers can't hold persistent TCP connections, which
AMQP 1.0 requires. Service Bus subscriptions also auto-disable
after ~14 days of inactivity, so the consumer must run continuously.

## Deploy to Fly.io

Operator-side, one-time setup:

```powershell
# Install flyctl if you haven't already.
# Windows: powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

cd apps\zaptec-consumer
flyctl auth login

# Launch — uses fly.toml in this directory.
# Don't deploy yet; we need secrets first.
flyctl launch --no-deploy --copy-config

# Set secrets (values stay in your shell, never enter chat or git).
flyctl secrets set ZAPTEC_USERNAME=<paste>
flyctl secrets set ZAPTEC_PASSWORD=<paste>
# Optional — pin to specific installations. Otherwise subscribes to
# all visible MessagingEnabled installations.
# flyctl secrets set INSTALLATION_IDS=<uuid1>,<uuid2>

# First deploy.
flyctl deploy

# Watch live logs to confirm AMQP connections succeed.
flyctl logs
```

## What you'll see

On startup the app logs (one JSON line each):

- `zaptec_consumer_starting`
- `zaptec_oauth_granted`
- `installations_visible` — count + sample
- `target_installations` — which ones we'll subscribe to
- `zaptec_amqp_connecting` per installation
- `zaptec_amqp_connected` per installation (good — subscription open)

Then, as events flow:

- `zaptec_amqp_message` — one line per inbound message, full body
  + applicationProperties + subject

Every 60s a `stats_heartbeat` line summarising:

- installations connected
- total messages received
- total errors

Errors flow as `zaptec_amqp_error` (non-fatal) and `zaptec_amqp_connect_failed`
(retried with exponential backoff up to 5 min).

## Health endpoint

`GET https://<app>.fly.dev/health` returns 200 if at least one
listener is connected, 503 otherwise. Body is JSON with per-
installation state.

## Env vars

| Name | Required | Description |
|---|---|---|
| `ZAPTEC_USERNAME` | yes | Zaptec partner credential email |
| `ZAPTEC_PASSWORD` | yes | Zaptec partner credential password |
| `INSTALLATION_IDS` | no | Comma-separated UUIDs. If unset, subscribes to all visible installations with `MessagingEnabled !== false`. |
| `MAX_INSTALLATIONS` | no | Cap on auto-subscribed installations (default 20). |
| `PORT` | no | Health endpoint port (Fly sets this; default 8080). |

## Operational notes

- **14-day idle disable** — Service Bus subscriptions auto-disable
  after ~14 days of inactivity. As long as the consumer is running,
  this doesn't fire. If we ever take it offline for >14 days,
  re-deploying will re-create the subscription on next AMQP open.
- **5-min message TTL** — messages expire if not consumed quickly.
  Phase 1 receives in `receiveAndDelete` mode (auto-acked), so this
  doesn't hit us. Phase 2 may switch to `peekLock` for at-least-once
  semantics; revisit then.
- **Subscription limits** — Zaptec caps active subscriptions per
  installation. Don't run two consumer instances against the same
  installation concurrently.
- **Reconnect** — exponential backoff, max 5 min. Token refreshes
  on 401.

## Phase 2 (to come)

- Add `STRAUMVAKT_API_BASE_URL` + `OCPP_INGEST_SECRET` env vars.
- Translate Service Bus messages → `IngestEvent` envelope.
- POST to `/api/internal/ocpp-events` with bearer auth.
- Bounded local retry queue on postback failure.
- Operator console surface for per-installation listener health.

The translator's exact mapping depends on the message shapes we
observe in Phase 1.
