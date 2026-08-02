# ADR 0023 — Real-time per-connector status propagation

**Status:** Proposed — direction agreed, implementation pending.
**Created:** 2026-05-11
**Triggered by:** "morning health check" diagnostic conversation
(2026-05-11) — confirmed that per-connector OCPP status frames arrive
at the gateway (~426 from Dalvegur on 2026-05-11), land in
`events.event_log` as `ocpp.raw.StatusNotification`, but are **never
projected** to `assets.connectors.status`. UI consequence: connector
display never moves off "unknown" / "available", drivers and operators
can't see "Charging" / "Preparing" / "Finishing".

## Prerequisite — fix A (separate work, blocks this ADR)

This ADR assumes **fix A is shipped first**: raw-handler projections
in `apps/api/src/lib/ocpp/projections.ts` for `ocpp.raw.BootNotification`,
`ocpp.raw.StatusNotification`, `ocpp.raw.StartTransaction`,
`ocpp.raw.StopTransaction`. Pattern mirrors the existing
`ocpp.raw.MeterValues` handler.

Without fix A, `assets.connectors.status` doesn't move, so propagation
has nothing to propagate.

## Problem

After fix A, `assets.connectors.status` updates in ~1-2s of the
StatusNotification arriving at the gateway (queue lag + projection
write). Getting that change onto a user's screen with **low delay**
needs an architectural choice — Workers can't naively push from the
projection to N clients.

## Decision — split by surface

### Mobile driver app — smart polling + silent push

- **Foreground & visible**: poll `/api/driver/chargers` every 10-15s,
  client-side timer.
- **Backgrounded / app idle**: stop polling.
- **Post-action** (start/stop session): immediate refresh, don't wait
  for next tick.
- **Pull-to-refresh**: always available, no rate-limit gate.
- **Silent push** via FCM/APNs for high-signal background events:
  - Driver's active session ended (StopTransaction)
  - Charger the driver recently tapped/started is now Available again
  - Driver's reserved connector became Faulted
  Push wakes the app for **one** refresh, then it goes back to sleep.

**Why this over WebSocket-from-mobile:** mobile WS lifecycle is genuinely
painful (reconnect on doze/airplane mode/network swap, foreground-only
auth-token refresh, OS-killed connections). The latency win over
focus-gated 10-15s polling doesn't justify the engineering cost for a
list view. Push covers the one case where seconds matter.

### Operator web console — Server-Sent Events via Durable Object fanout

- New `FleetFanoutDO` per `org_id` (keyed by tenant).
- Operator opens `/sites`, browser opens `EventSource` to
  `/api/operator/fleet/stream` → routed to DO for their org.
- DO holds connections via Hibernation API (free at rest).
- After fix A writes `connectors.status`, the projection also
  fire-and-forgets a service-binding POST to `FleetFanoutDO[orgId]`
  with the small envelope `{ connectorId, status, statusUpdatedAt }`.
- DO pushes the envelope as an SSE event to all connected operators
  for that org.
- Operator UI listens, updates the relevant row in place.

**Why SSE over WS:** one-way fits the use case (server → operator);
browsers handle reconnect + last-event-id automatically; no
subprotocol negotiation gymnastics.

### Shared fanout glue

```
[OCPP StatusNotification frame]
        │
        ▼
[gateway DO → queue → consumer]
        │
        ▼
[projection: UPDATE assets.connectors.status]            ← fix A
        │
        ├──► fire-and-forget POST FleetFanoutDO[orgId]   ← SSE push
        │
        └──► fire-and-forget enqueue PUSH_QUEUE          ← FCM/APNs filter+send
              └──► push-notification worker
```

Both fanout paths are **fire-and-forget post-commit** — failure here
never blocks or rolls back the projection. Operator console and
mobile app fall back to their next poll cycle / pull-to-refresh, so
the system degrades gracefully when the fanout layer is unhealthy.

## Open questions

1. **`FleetFanoutDO` capacity**: at pilot scale (≤10 operator sessions
   per org) Hibernation API is plenty. If the operator console
   eventually has driver-facing views (public roaming maps?),
   per-`org_id` fanout might need partition keys other than org. Not a
   pilot concern.

2. **Push notification filtering**: who decides "this status change is
   worth a push"? Naive "every connector everywhere" would spam every
   driver. First cut: only push when the driver has an active session
   on that connector or has explicitly favourited it. Driver-side
   notification-preferences UI is a separate small workstream.

3. **Service-binding fanout failure handling**: if `FleetFanoutDO`
   returns 5xx, do we retry, log-and-drop, or queue? Lean log-and-drop
   for the SSE path (next poll closes the gap); explicit retry queue
   for the push path (push reliability is the whole point).

4. **Authn on the SSE stream**: re-use the operator session cookie
   (Workers can read it on the EventSource upgrade). For mobile WS
   path (deferred), the access token would go in the URL query string
   since native WebSocket APIs don't accept headers — short-lived token
   only.

## Out of scope

- WebSocket from mobile app — deferred unless sub-second mobile latency
  becomes a real requirement (it isn't for a driver-app list view).
- Replacing the Zaptec REST `/state` poller — separate decision; that
  poller may stay as fallback for the no-OCPP installs forever.
- Operator console grid layout changes — UI/UX work, separate ADR
  if needed.

## Sketch — shippable in this order

1. **Fix A** (prerequisite, separate ADR / PR): ~1 day.
2. **Mobile smart polling** (focus-gated timer + pull-to-refresh +
   post-action refresh): ~half day, zero new infra. Closes the
   "I can't see the charger is in use" complaint immediately.
3. **`FleetFanoutDO` + projection fanout + operator SSE**: ~2 days.
   Sub-second operator experience.
4. **Push notification pipeline** (FCM/APNs creds, token registration,
   filter, notification-preferences UI stub): ~3-5 days. Last because
   foreground mobile is already handled by (2).

## Decision

**Proposed.** Awaiting fix A delivery + first usable per-connector
status data before committing to the fanout infrastructure. Re-open
this ADR for a real decision when (2) ships and we measure whether the
operator console polling-cost is actually painful enough to justify
(3).
