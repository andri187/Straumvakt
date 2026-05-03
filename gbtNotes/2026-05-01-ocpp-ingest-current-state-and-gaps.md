# OCPP Ingest — Current State And Gap Check

**Status:** investigation note, no scope change.
**Date:** 2026-05-01.
**Trigger:** operator-reported symptom — pressing Start Charge marks the
command "pending" but the connector status never changes. Investigation
into the cause uncovered a deployed-topology gap that this note records
in detail. The fix is captured by Sprint S1 in
`gbtNotes/scale-to-4000-chargers-sprint-plan.md` — this note is the
factual baseline that S1 will close.

---

## TL;DR

| Path | Production | Staging |
|---|---|---|
| Gateway `MAIN_APP` service binding → | `hlada` (UI Worker) | `hlada-api-staging` (API Worker) |
| Inbound OCPP event route `/api/ocpp/events` lives on | `hlada` ✓ | `hlada-staging` only — **not on `hlada-api-staging`** |
| Inbound OCPP auth route `/api/internal/ocpp-auth` | `hlada` ✓ | `hlada-api-staging` ✓ |
| Pending-discovery route `/api/internal/pending-discovery` | `hlada` ✓ | `hlada-api-staging` ✓ |
| Outbound command path (API outbox → queue → gateway) | working | working |

**Net effect on staging:** every OCPP frame the charger sends after the
WebSocket is open (BootNotification, Heartbeat, StatusNotification,
MeterValues, StartTransaction, StopTransaction, command results)
crosses the gateway → `MAIN_APP` service binding → POST
`/api/ocpp/events` → **404 on `hlada-api-staging`**. The gateway
classifies non-202 as either rejected (4xx) or retriable (5xx); a 404
falls through as rejected and the event is dropped, never persisted.

Connect-time hooks (auth + pending discovery) work because their
routes _are_ mounted on `apps/api`. Post-connect events do not.

---

## Wire-by-wire trace (verified 2026-05-01)

### 1. Gateway → MAIN_APP service binding

`gateway/wrangler.jsonc`:
- root `services[0].service = "hlada"` (UI Worker, production)
- `env.staging.services[0].service = "hlada-api-staging"` (API Worker, staging)

The binding name on the gateway side is always `MAIN_APP`. The Worker
it resolves to differs per environment.

### 2. Outgoing routes the gateway calls

Three URL paths, all via `env.MAIN_APP.fetch(new Request("https://main.internal<path>", …))`:

| File:line | Path | Purpose |
|---|---|---|
| `gateway/src/auth.ts:85` | `/api/internal/ocpp-auth` | Verify Basic-Auth on WS upgrade |
| `gateway/src/auth.ts:118` | `/api/internal/pending-discovery` | Record anonymous-charger connect attempts |
| `gateway/src/ingest-client.ts:43` | `/api/ocpp/events` | Forward every OCPP frame after the WS is open |

All three include `x-straumvakt-ingest: <OCPP_INGEST_SECRET>`.

### 3. What `apps/api` (= `hlada-api-staging`) actually mounts

`apps/api/src/index.ts`:
- Line 91: `app.route("/api/internal/ocpp-auth", internalOcppAuth);`
- Line 92: `app.route("/api/internal/pending-discovery", internalPendingDiscovery);`
- **No mount for `/api/ocpp/events`.**

The two `routes/internal/*.ts` files exist; the events route does not.

### 4. Where `/api/ocpp/events` actually lives

`src/app/api/ocpp/events/route.ts` — Next.js App Router handler in the
**UI Worker** (`hlada` / `hlada-staging`). Imports:
- `@/lib/ocpp/ingest-auth` (header verification)
- `@/lib/ocpp/event-envelope` (envelope parsing)
- `@/lib/repositories/events` (`ingestEvent` — Prisma, transaction, idempotency, projection dispatch)
- `@/lib/ocpp/bootstrap` (side-effect import: `registerAllProjections()`)

Projection handlers live in `src/lib/ocpp/projections.ts` (UI Worker
side). `events.ts` repository pulls `straumvakt-prisma-cf-client/client`.

### 5. Outbound (admin → charger) is fine

`apps/api/src/routes/admin/chargers.ts` writes to
`ocpp.outbound_commands`, publishes to `OUTBOUND_QUEUE`, the `queue()`
handler in `apps/api/src/index.ts` dispatches via the gateway's
`/dispatch/:identityId` service-binding endpoint, the gateway routes
to the right Durable Object, the DO sends the OCPP Call frame on the
open WebSocket. Production and staging both work because dispatch
goes the *other* direction (API → Gateway), not Gateway → API.

The user-visible symptom — Start Charge stays "pending" — is consistent
with two related things:

1. The dispatch may have succeeded and the charger may have replied
   `RemoteStartTransaction.conf` (Accepted/Rejected) and even followed
   up with `StartTransaction`. **But** since the events ingest route is
   404ing, none of that reaches our DB. The outbound row sits in the
   state where the gateway returned `kind:"ack"`-ish and we set
   `status='acked'`, but the operator-visible UI may still read
   `pending` if it's looking at stale data.
2. If the DO has no active WS for that identity (charger never
   authenticated against our gateway because Basic-Auth is off in
   Zaptec), gateway returns 503 → command stays `pending` and retries
   forever. This is a different cause but presents identically in the
   UI.

Both causes converge on the same operator complaint and both depend on
the events route being present to even diagnose them (StatusNotification
confirms which case).

---

## Gap check

### Confirmed gaps

1. **`/api/ocpp/events` not mounted on `apps/api`.** The route source
   exists only in the UI Worker. Staging gateway points at the API
   Worker. Every inbound charger frame on staging is dropped.
2. **`event-envelope.ts`, `projections.ts`, `bootstrap.ts`,
   `events.ts` (`ingestEvent`) are UI-Worker-side.** Even if the
   gateway binding were flipped back to `hlada-staging` as a quick fix,
   the long-term direction (Sprint S1) requires these to live in
   `apps/api`.
3. **`ocpp-internal-auth.ts` was already mirrored into `apps/api`**
   (separate from the UI's `ingest-auth.ts`). Confirm parity when
   porting — different header verification paths could mask cause.
4. **No tests in `apps/api` for the events ingest path** — current
   tests cover only the UI-Worker location.
5. **Documentation drift.** `gateway/wrangler.jsonc` top-comment says
   *"binding name 'MAIN_APP' maps to the 'hlada' Worker"* — it does in
   production. In staging it maps to `hlada-api-staging`. The comment
   should reflect "the API Worker on this environment" once S1 lands.

### Implied gaps (downstream of the broken path)

These are not new gaps — they are observable consequences of the route
being absent on staging:

- `Connector.status` projection (StatusNotification → DB) **never fires**
  on staging. Connector pills on `/sites` stay either grey "no source"
  or render only the vendor-derived fallback from Zaptec
  `OperatingMode`. The OCPP-direct branch is dead on staging today.
- `OcppIdentity.lastSeenAt` from gateway evidence is **never written**
  on staging. Anything that reads "online via OCPP gateway in last
  5 min" is always false on staging — only Zaptec `IsOnline` carries.
- `ChargeSession` rows are **not created from gateway evidence** on
  staging. StartTransaction/StopTransaction projections never run.
- `MeterValues` are **not persisted** on staging via the gateway path.
- `BootNotification` projection (firmware version, charge box serial,
  meter type, ICCID/IMSI population on `ChargingStation`) **does not
  fire** on staging.

Note: these consequences are *staging-only*. Production gateway points
at `hlada` (UI Worker) where the route IS mounted, so production
projections do fire. The split-brain is a staging problem today;
S1 makes both environments converge on the API Worker so the gap
cannot recur in production.

### Non-gaps (verified working)

- OCPP Basic-Auth on WS upgrade: `gateway/src/auth.ts` →
  `apps/api/src/routes/internal/ocpp-auth.ts`. Mounted, returns
  identity row + auth_secret_hash on success.
- Pending discovery for anonymous chargers: `gateway/src/auth.ts:117` →
  `apps/api/src/routes/internal/pending-discovery.ts`. Mounted, writes
  to `ocpp.pending_discoveries`.
- Outbound command dispatch (admin → charger): API outbox →
  `OUTBOUND_QUEUE` → API queue consumer → gateway service-binding
  `POST /dispatch/:identityId` → DO → WebSocket. Confirmed by code
  trace in `apps/api/src/lib/dispatcher.ts` +
  `apps/api/src/lib/dispatch-targets.ts:79`.

---

## Cross-reference to the scale plan

This gap is item #1 of **Sprint S1 — Fix The Runtime Split** in
`gbtNotes/scale-to-4000-chargers-sprint-plan.md` (lines 198-227). S1's
explicit task list:

- Confirm intended source of truth for OCPP inbound event ingest.
- Port `/api/ocpp/events` from the Next app into `apps/api`.
- Mount the new route in `apps/api/src/index.ts`.
- Move event-envelope parsing + projection bootstrap.
- Use the current Postgres path **as a temporary compatibility step**.
- Mark Prisma-based event ingest as transitional — do not optimise
  the 4,000-charger plan around per-event Prisma writes.
- Add `apps/api` tests: missing ingest header, malformed JSON,
  invalid envelope, idempotent replay, fresh event success.
- Update gateway docs/comments so `MAIN_APP` reads as "the API
  Worker on this environment."
- Smoke test: BootNotification / Heartbeat / MeterValues persist.

S1 exit criterion (line 224): *"Gateway staging no longer posts
inbound charger events to a route that only exists in the old Next
app."* — this note is the factual baseline that exit criterion will
be checked against.

---

## What would be wrong: the quick-fix temptation

A one-line flip of `gateway/wrangler.jsonc` `env.staging.services[0].service`
from `hlada-api-staging` → `hlada-staging` would resolve the staging
404 in minutes. Rejected because:

- It moves staging *backwards* in the migration direction (UI Worker
  re-acquires the inbound event ingest path that ADR 0013 is removing).
- Production already runs on the UI Worker; the binding flip would
  leave production untouched but staging would diverge from the target
  topology, exactly the inverse of how staging should lead.
- The S1 plan exists and is short. The quick fix would create a
  rollback-then-redo dance instead of a single clean cutover.

The right action is to execute S1 in a single change, not to flip
the binding and re-port later.

---

## Recommended next step

Execute Sprint S1 as a single change set:

1. Port files into `apps/api/src/lib/ocpp/{event-envelope,projections,bootstrap,events-repository}.ts`
   (events repository wraps the existing `ingestEvent` shape).
2. Add Hono handler `apps/api/src/routes/internal/ocpp-events.ts`
   (mirror the `routes/internal/*` convention; gateway binding implies
   internal-only, and this matches the existing `/api/internal/*`
   prefix used by ocpp-auth and pending-discovery).
3. Mount in `apps/api/src/index.ts`. Decide on URL: keep `/api/ocpp/events`
   (so gateway ingest-client doesn't change) **or** rename to
   `/api/internal/ocpp-events` (consistent prefix) and update
   `gateway/src/ingest-client.ts:43`. Recommend the rename — the
   gateway change is one line and the prefix consistency is worth it.
4. Tests in `apps/api/src/routes/internal/ocpp-events.test.ts`
   covering S1's listed cases.
5. Update `gateway/wrangler.jsonc` top comment to reflect environment-
   dependent meaning of `MAIN_APP`.
6. Deploy gateway + API together (atomic per Cloudflare auto-deploy
   ordering caveats — see `cf_autodeploy_clobbers` memory).
7. Smoke: connect a real charger or simulator, watch
   `OcppIdentity.lastSeenAt` tick, watch `Connector.status` flip on
   StatusNotification, watch a session appear after StartTransaction.
8. Once verified, remove `src/app/api/ocpp/events/route.ts` and the
   UI-Worker-side `events.ts` / `projections.ts` / `bootstrap.ts` —
   or leave them in place as a fallback for one sprint, marked
   deprecated.

Estimated effort: 2-3 hours including tests and smoke. No DB schema
changes. No projection logic changes — pure file relocation plus
mount + a one-line gateway URL update.
