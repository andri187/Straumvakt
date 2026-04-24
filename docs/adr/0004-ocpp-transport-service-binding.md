# ADR 0004 — OCPP Gateway ↔ Main App Transport: Service Binding

**Status:** Accepted
**Date:** 2026-04-24
**Sprint:** 1

## Context

Sprint 1 stands up the OCPP event ingest pipeline. The gateway worker
(`straumvakt-ocpp`, Sprint 1.4) receives OCPP messages from chargers
over WebSocket, translates them to domain events, and delivers those
events to the main app (`hlada`) for event-log-first persistence and
projection.

Three credible transports for that gateway → main-app hop:

1. **HMAC-SHA256 over public HTTP.** Webhook with signed
   body + timestamp, shared secret, replay defence.
2. **Cloudflare Service Binding.** Worker-to-Worker call, no public
   internet hop, authenticated by CF routing (same account).
3. **Cloudflare Queues** between the two workers.

## Decision

Use **Cloudflare Service Binding** for the gateway → main-app hop in
Sprint 1. Keep the route contract queue-migratable (single event per
call, idempotent by `eventId`, 202-accepted shape) so a later switch to
Queues is transport-only — not a contract change.

The main app exposes `POST /api/ocpp/events` guarded by a shared
`OCPP_INGEST_SECRET` header check (constant-time compare). The gateway
attaches that secret when calling `env.MAIN_APP.fetch(...)`. The
secret exists because OpenNext + Next.js expose the route on the
public worker surface by default; the header gate closes it to
non-gateway callers. Secret lives in Cloudflare dashboard (per-env),
never in `wrangler.jsonc` or git.

### Why not HMAC-HTTP

Portability gain is illusory — V3 has already committed the gateway
to Cloudflare Workers + Durable Objects (architecture §9). Moving
the gateway off CF would be a rewrite regardless of transport. HMAC
adds a secret-management layer, timestamp skew logic, body-signing
plumbing, and a public attack surface we then have to defend. None of
that buys us anything we don't get from the service binding.

### Why not Queues yet

Queues are a valid answer once durable buffering is observably needed.
Today that need is already covered by the **Durable Object** sitting
on the gateway side — each OCPPIdentity has its own DO with per-row
storage. If the main app is unreachable, the DO holds the un-acked
event and retries with backoff. That is the buffer.

Adding Cloudflare Queues on top of that is a second buffering layer
for no marginal resilience until volume overwhelms the DO-side retry
path. It would also pull in consumer lifecycle, DLQ tuning, batch
size decisions, and OpenNext queue-handler integration work that is
not on Sprint 1's critical path.

### Observable migration trigger to Queues

Re-evaluate when **any** of these signals fires:

- DO-side un-acked event backlog per identity exceeds 100 sustained
  for >5 minutes (measured via DO storage keys under `inflight:*`).
- Main-app `POST /api/ocpp/events` p95 latency under gateway retry
  load exceeds 200 ms.
- Total ingest volume exceeds 5M events/day (the scale where CF
  Queues starts to beat per-request cost on the binding path, once
  idempotency replays count toward billing).
- A second consumer beyond main-app ingest appears (e.g. a real-time
  analytics consumer). At that point queues become the fan-out layer.

When that trigger fires, write ADR 0XXX "migrate OCPP ingest to
Cloudflare Queues." The event-log-first contract does not change.
The gateway producer + main-app consumer both switch, tested locally
via `wrangler dev --local` queue emulation.

## Consequences

### Positive

- No public endpoint for ingest — attack surface reduction.
- Inner binding calls are free sub-requests; at end-game scale this
  is meaningful ($ and CPU).
- Simpler code than HMAC — no signing, no timestamp, no replay test.
- Native CF trust model — binding = same-account callers only.
- `OCPP_INGEST_SECRET` is a single rotate-able string, not a keyed
  signing infrastructure.

### Negative

- Sprint 1.1 can't run an end-to-end "real binding" test because the
  gateway worker doesn't exist until 1.4. 1.1's test is therefore
  contract-level (replay idempotency, auth gating) with a stub
  caller; first real binding test is 1.4.
- Locks the transport to CF for the gateway leg. Mitigated by the
  fact that V3 already made the gateway runtime CF-specific.

### Neutral

- Route contract is queue-migratable by design; switching transport
  later is plumbing, not re-architecture.

## Alternatives considered

See §Context. The short version: HMAC-HTTP overbuilds for the CF-to-CF
case, Queues prematurely buys durability we already have from Durable
Objects.

## References

- `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md` §5 (OCPP track),
  §9 (runtime — CF Workers + DOs committed).
- `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` §4 (Sprint 1).
- `CLAUDE.md` Rule 2 (secrets posture), Rule 5 (OCPP semantic
  stop-and-summarise).
- ADR 0001 (V3 foundation schema — `events.event_log`,
  `events.idempotency_keys` contracts this transport targets).
