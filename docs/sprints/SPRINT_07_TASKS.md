# Sprint 7 — Push API + Observability · Task List

**Status:** FUTURE — entry condition: Sprint 6 exit met.
**Branch:** `dev/sprint-07-push-and-observability`.

> Sketch-level. See [delivery plan §10](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#10-sprint-7--push-api--observability).
> Issue-related event types (`issue.opened`, `issue.resolved`) and
> issue-count dashboard tiles defer with Issue Engine (tag D).

---

## Milestone 7.1 — Push API subscriber registry
- [ ] `webhooks.subscriptions` admin CRUD page (schema in place)
- [ ] Per-tenant scope filtering, signing-secret generation, status

## Milestone 7.2 — Canonical event vocabulary (pilot subset)
- [ ] Emitters for: `transaction.started`, `transaction.updated`,
      `transaction.stopped`, `charger.added`, `connector.status_updated`,
      `card.authorize_request`
- [ ] Each event validated against a Zod schema at emission time
- [ ] Schemas vendored in `src/lib/webhooks/schemas/`
- [ ] DEFERRED: `transaction.billed` (tag E), `issue.opened`, `issue.resolved` (tag D)

## Milestone 7.3 — Durable retry + DLQ
- [ ] Cloudflare Queue or Durable Object retry loop
- [ ] Exponential backoff (1s, 4s, 16s, 60s, 5m, 30m, 6h)
- [ ] DLQ table (`webhooks.dead_letters`) — already in schema
- [ ] Health score per subscriber

## Milestone 7.4 — OpenTelemetry across both workers
- [ ] OTel SDK on Cloudflare (verify chosen library is Workers-runtime safe)
- [ ] `traceparent` propagation across Service Binding boundary
- [ ] Trace from OCPP message ID → event log row → API response

## Milestone 7.5 — Per-tenant operator dashboard
- [ ] Tiles: uptime, session success rate, retention-job status
- [ ] Reads from `aggregate` rows (Sprint 4), not raw event log
- [ ] DEFERRED tiles: open issue count, MRR

---

**Risks:** OTel-on-Workers library compatibility — verify before
committing the build dependency.
