# Market observability plan

What must exist **before** a real charger joins beta. Today essentially none of
it does, which is the finding.

Guiding rule: **a metric that only exists during an incident is not a metric.**
Every signal below has a defined baseline, so a deviation is arithmetic rather
than intuition.

---

## Workers Analytics Engine

One binding, written from the OCPP gateway and the API. Cheap, high-cardinality,
and deliberately **not** in Neon — telemetry must never compete with business
truth for storage or for a restore.

| Metric | Blob / index | Baseline today | Reads as trouble when |
|---|---|---|---|
| `frames_per_connector` | identity, action | idle about 1/hour | over 120/hour, a cap breach (OC10) |
| `heartbeats_received` | identity | 720/connector/month | — |
| **`heartbeats_suppressed`** | identity | **received minus transitions** | near zero, meaning the fast path regressed and every heartbeat bills again |
| `missed_heartbeats` | identity | 0 | one or more, charger silent past 3 intervals |
| `queue_messages_by_type` | event type | heartbeat share near zero | heartbeat share rises, an OC1 regression |
| `queue_backlog_age` | queue | seconds | minutes, consumer not keeping up |
| `noisy_charger_events` | identity | 0 | any, since one unit can bill the estate |
| `DO_invocations_estimate` | worker | flat against socket count | rising while sockets stay flat, hibernation regressed |
| `Neon_write_estimate` | table | tracks sessions, not frames | tracks frames, raw persistence leaked back |
| `gateway_errors_by_type` | error kind | 0 | any parse-error class, which is new protocol reality |
| `billing_job_started` / `completed` / `failed` | period | started equals completed | they diverge, the close is stuck |

**The pair that matters most is `heartbeats_received` against
`heartbeats_suppressed`.** Their ratio is the fast path's health expressed as a
number: if suppression collapses, cost silently returns to the pre-fix baseline
and nothing else in the system notices.

---

## Sentry

Errors that never become metrics because they are exceptions, not counts.

| Signal | Severity | Note |
|---|---|---|
| OCPP gateway exception | high | the charger sees a broken socket |
| DO exception | high | often a hibernation-wake assumption |
| Queue consumer failure | high | precedes DLQ growth |
| API exception | medium | user-visible |
| **Billing invariant failure** | **code red** | never auto-retry; a wrong invoice is worse than a late one |
| Report generation failure | medium | recoverable, monthly cadence |
| **Unexpected protocol parse error** | high | a frame type nobody triaged, the fail-long-not-short case |
| Release regression alert | high | keyed to Worker version id, which does not exist yet |

**Scrubbing is mandatory before the DSN goes live.** OCPP payloads carry idTags,
which identify drivers. An unscrubbed Sentry event is a personal-data export.

---

## R2

| Bucket | Contents | Bound |
|---|---|---|
| statements / exports | customer-facing artefacts | retention per contract |
| debug bundles | bounded, size and count capped | delete after N days |
| protocol evidence | frame snapshots around an incident | TTL, never permanent |

The debug bucket is where temporary storage becomes permanent. It gets a cap at
creation, not after the first surprise.

---

## What exists today

| | |
|---|---|
| Analytics Engine binding | none |
| Sentry DSN | none |
| Metric writer in the gateway | none |
| Structured logs | present: single-line `[ocpp-gw]`, grep-able, already in `identity-do.ts` |
| Connected-charger count | not exposed, so several gates cannot be evaluated at all |

The structured log lines are the one real asset: `authorize.evaluated`,
`ingest retriable`, `ingest rejected`, plus the new `frame_cap.breached` and
`frame_cap.anomaly`. They are the cheapest path to first telemetry, since a tail
consumer could populate Analytics Engine without touching the hot path.

---

## Ordering

1. Analytics Engine binding plus the two heartbeat counters, which prove the fast path in production
2. Sentry with scrubbing, which catches what counters cannot
3. Connected-charger count, which unblocks the gateway rollback drill
4. Queue depth and DLQ alerts, the pre-existing blind spot
5. R2 buckets with bounds

**Steps 1 to 3 are beta blockers.** Steps 4 and 5 can follow the first charger.
