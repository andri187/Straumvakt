# OCPP continuity and field safety

**No charger was touched, configured, tested or connected to.** This is a
field-operation design and a bench plan, not an execution record.

## The principle this document exists to enforce

> An OCPP endpoint URL and a Durable Object identity are **device configuration
> and operational state**, not deployment details.

A web or API cutover is a control-plane operation with a minutes-long rollback.
An OCPP endpoint change is a **field campaign** whose failure mode is a charger
that never comes back, in a car park, belonging to a customer.

**They must never appear in the same change ticket.**

## Current connection path (RF, RC `4b69d0f`)

```mermaid
sequenceDiagram
    participant CP as Charger (field)
    participant GW as straumvakt-ocpp-staging
    participant DO as IDENTITY_DO
    participant API as hlada-api-staging
    participant DB as Neon (staging)

    CP->>GW: WSS upgrade + Basic-Auth
    Note over GW: auth.ts — extracts Basic-Auth from the upgrade;<br/>rejects the upgrade on failure, logs the attempt
    GW->>DO: route to per-charger Durable Object
    Note over DO: WebSocket Hibernation API —<br/>evicted from memory between frames
    CP->>DO: BootNotification / Heartbeat / StatusNotification
    DO->>API: MAIN_APP binding + x-straumvakt-ingest header
    Note over DO,API: OCPP_INGEST_SECRET authenticates gateway → API
    API->>DB: persist
    CP->>DO: Authorize(idTag)
    DO->>API: authorize sidecar
    API-->>DO: verdict
    Note over DO: verdict cached in the DO
    DO-->>CP: Authorize.conf
```

| Element | Evidence |
|---|---|
| Basic-Auth on the WebSocket upgrade | `gateway/src/auth.ts:2,69` |
| Gateway → API authenticated by `OCPP_INGEST_SECRET` via `x-straumvakt-ingest` | `gateway/src/auth.ts:106,145` |
| `MAIN_APP` binds the gateway to the **API** Worker | `gateway/wrangler.jsonc:64-65` |
| Per-charger Durable Object `IDENTITY_DO` / `IdentityDurableObject` | `gateway/wrangler.jsonc:9-17,54-58` |
| DO uses **WebSocket Hibernation**; Authorize verdicts cached in the DO | `gateway/src/identity-do.test.ts:2,4` |

## What changes, and what does not, per cutover type

| Cutover | Charger sees | Rollback | Blast radius |
|---|---|---|---|
| **Web Worker** | nothing — chargers never contact it | re-attach domain, minutes | browser users only |
| **API Worker** | nothing directly; the gateway's `MAIN_APP` binding must be repointed | redeploy gateway config | ingest pauses if mis-sequenced |
| **OCPP endpoint URL** | **everything** — it must reconnect somewhere new | **none from our side** | **the entire fleet** |
| **OCPP Worker rename (same URL impossible)** | as above | as above | as above |

**A rename of the gateway is not a rename. It is a fleet endpoint migration.**

## Blast radius of a URL change

| Effect | Detail |
|---|---|
| Every open WebSocket severed | simultaneously, by definition |
| Reconnect storm | modelled ~83 connects/s for 5k in a 60 s window — **self-inflicted** |
| Durable Object state lost | a new Worker's DO namespace is empty; cached Authorize verdicts and per-charger state rebuild from scratch |
| In-flight transactions | a session mid-charge whose gateway disappears cannot be stopped cleanly by the app |
| Chargers that do not reconnect | require physical or vendor-portal intervention **per device** |
| Basic-Auth credentials | per-charger; if they travel with the endpoint, each device must be re-provisioned |

**UNK — vendor portal behaviour.** Whether the endpoint can be changed remotely
per-charger, in bulk, or at all, is a Zaptec-portal question. Nothing in this
repository establishes it. **Until answered, treat every endpoint change as
requiring physical access**, which is the pessimistic assumption and the correct
default.

## Certificate and DNS dependencies

- The gateway is reached on `*.workers.dev` today — Cloudflare's certificate,
  nothing of ours to manage.
- Moving to a branded OCPP hostname (e.g. `ocpp.straumvakt.org`) introduces a
  certificate we must keep valid **forever**, on a path where an expiry means the
  whole fleet drops.
- **PR:** do not brand the OCPP endpoint. The workers.dev hostname is stable,
  its certificate is Cloudflare's problem, and no customer ever sees the URL.
  Branding it converts a non-issue into a permanent operational obligation.

## Heartbeat and BootNotification implications

| Signal | Behaviour on cutover | Consequence |
|---|---|---|
| `BootNotification` | every charger sends one on reconnect | a fleet-wide boot burst on top of the connect burst |
| `Heartbeat` interval | server-assigned in the `BootNotification` response | **the interval is a capacity lever** — the model's dominant variable at 2.97× swing |
| `StatusNotification` | resent after reconnect | duplicate status writes are expected; ingest must be idempotent |

**Opportunity worth naming:** because the interval is assigned at boot, a
migration is the one moment the whole fleet can be moved to a new heartbeat
interval at once. That is the cheapest capacity lever available — and the only
time it costs nothing extra.

## Staged canary strategy

**Never migrate the fleet in one step.** Cohorts, with a hold between each.

| Cohort | Size | Composition | Hold | Gate to proceed |
|---|---|---|---|---|
| C0 bench | 1 | a lab charger, not in service | until stable | reconnects, boots, charges, stops |
| C1 canary | 1–2 | **owned sites, low traffic**, physically reachable | 48 h | 100% reconnect; no session anomaly |
| C2 pilot | ~5% | one site, mixed hardware/firmware | 72 h | ≥99% reconnect; no manual intervention |
| C3 wave | ~25% | multiple sites | 1 week | as C2, plus no support tickets |
| C4 fleet | remainder | — | — | — |

### Cohorting rules

1. **Physical reachability first.** C1 must be chargers someone can walk to.
2. **Never split a site across cohorts** — a half-migrated site is
   indistinguishable from a site with a fault.
3. **Group by firmware version**, because reconnect behaviour is firmware
   behaviour, not fleet behaviour.
4. **Exclude any charger with an active session** at the moment of migration.

## Rollback when devices do not reconnect

**Be honest: rollback is weak here, and that is the reason for cohorts.**

| Scenario | Recovery |
|---|---|
| Charger reconnects to the new endpoint | nothing to do |
| Charger fails to reconnect, old endpoint **still live** | revert its configuration → it returns |
| Charger fails to reconnect, old endpoint **retired** | **field visit or vendor portal** |
| Charger offline for another reason | indistinguishable from the above without device access |

**Therefore: the old gateway stays live and reachable for the entire campaign,
plus a defined tail.** Retiring it early converts a reversible migration into an
irreversible one, and the last row above means you cannot even tell which
chargers you have stranded.

## Preserving active sessions

| Rule | Why |
|---|---|
| Migrate only chargers with **no session in progress**, verified immediately before | a severed gateway leaves a session unstoppable from the app |
| Verify per charger, not per site | a single active session blocks that charger, not the cohort |
| Never migrate during a known peak | reduces the population needing exclusion |
| If a session starts mid-window, **skip that charger** | it costs nothing to defer one device |

## Fleet-wide stop conditions

Halt the campaign immediately if:

1. Reconnect rate for a cohort < 95% after the hold.
2. Any charger requires physical intervention to recover.
3. A session is lost or becomes unstoppable.
4. `IDENTITY_DO` errors rise on the new gateway.
5. The queue backlog grows and does not drain after the connect burst.
6. Any Authorize verdict regression — a driver denied at a charger they may use.
7. **Anything unexplained.** The cost of pausing is a delay; the cost of
   continuing is stranded hardware.

## Bench-test plan (no field charger)

| # | Test | Method | Pass |
|---|---|---|---|
| BT-1 | Upgrade + Basic-Auth against a new gateway | bench charger or OCPP simulator | upgrade accepted |
| BT-2 | Wrong credential rejected | simulator | upgrade rejected **and logged** |
| BT-3 | BootNotification round trip | simulator | accepted; heartbeat interval assigned |
| BT-4 | Authorize verdict + DO caching | simulator, repeat idTag | second call served from cache |
| BT-5 | Ingest reaches the API | check the `x-straumvakt-ingest` path end to end | row persisted |
| BT-6 | Reconnect after forced disconnect | simulator | reconnects within backoff |
| BT-7 | Session start/stop | bench charger | transaction completes |
| BT-8 | Endpoint reconfiguration | bench charger, vendor portal | **establishes whether remote reconfiguration is even possible — closes the main UNK** |

**BT-8 is the highest-value bench test.** It determines whether the entire
campaign is a remote operation or a physical one, and therefore whether it is
weeks or months.

## Recommendation

**Do not rename or move the beta OCPP gateway.** Create `straumvakt-ocpp` fresh
for production chargers — the name is free (DF: 1042) — so production onboards
directly onto the correct endpoint and **no existing device is ever migrated**.

Under the accepted no-backfill decision, real customers onboard fresh in
production anyway. **A production charger will be configured once, correctly, at
onboarding.** The fleet migration this document plans for may therefore never
need to happen at all — which is by far the best outcome available, and it comes
free with a decision that has already been made for other reasons.
