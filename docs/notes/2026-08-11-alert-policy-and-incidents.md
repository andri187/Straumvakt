# Alert policy and incident definitions — Core launch

Fourteen alerts. **Four of them cannot fire today** because the signal
they need does not exist, and those are marked rather than quietly
listed as if they were live.

Guiding rule, carried from the observability plan: *a metric that only
exists during an incident is not a metric.* Every threshold below has a
baseline, so a deviation is arithmetic rather than intuition.

---

## Severity ladder

| Level | Means | Response |
|---|---|---|
| **S1** | Customer cannot charge, or money is wrong | Wake someone |
| **S2** | Degraded; recovery is automatic but bounded | Same business day |
| **S3** | Cost or hygiene; no customer impact yet | Weekly review |

**Billing invariant failure is always S1 and never auto-retries.** A
wrong invoice is worse than a late one.

---

## The alerts

### A1 · Missed heartbeat rate

| | |
|---|---|
| Severity | **S2** per connector, **S1** if a whole site |
| Source | Analytics Engine `missed_heartbeats` |
| Threshold | any connector silent > 3 intervals (3 h at the product frame); or > 5 % of a site's connectors within 15 min |
| False positives | a site-wide network outage is one incident, not N — group by site before paging |
| First responder | check the site's other connectors, then the gateway, then the charger |
| Customer impact | a driver arrives at a charger nobody knows is dead |
| Blocks launch? | **YES** |
| **Live today?** | **NO — there is no liveness sweeper.** Offline is computed only when a frame arrives, so a charger that dies silently is never counted. Gate OB18. |

### A2 · Noisy charger cap breach

| | |
|---|---|
| Severity | S2, S1 on repeat |
| Source | `noisy_charger_events` |
| Threshold | any breach; 3 consecutive windows = anomaly |
| False positives | firmware update storms — correlate with BootNotification |
| First responder | confirm the cap is shedding, then contact the site |
| Customer impact | none directly; the cap protects the estate |
| Blocks launch? | no — the cap works offline-proven |
| **Live today?** | **NO** — breach is a `console.warn`, never a metric. Gate OB25. |

### A3 · Queue backlog growing

| | |
|---|---|
| Severity | S2 |
| Source | Cloudflare Queue metric |
| Threshold | backlog age > 60 s sustained 5 min |
| False positives | a deploy pause; suppress for 2 min after a deploy |
| First responder | check consumer errors, then Neon connection count |
| Customer impact | delayed session records, delayed billing |
| Blocks launch? | no |
| **Live today?** | staging only — top-level has no queue at all (OB16) |

### A4 · Consumer failure rate

| | |
|---|---|
| Severity | **S1** |
| Source | Queue metric + Sentry |
| Threshold | > 1 % of messages failing over 5 min, or any DLQ growth |
| False positives | one poison message ≠ a failing consumer; alert on rate and on DLQ separately |
| First responder | read the DLQ message, do not replay blindly |
| Customer impact | lost session data → wrong bills |
| Blocks launch? | **YES** — a DLQ is the only thing standing between a bad message and data loss |
| **Live today?** | staging only (OB17) |

### A5 · OCPP gateway error spike

| | |
|---|---|
| Severity | S1 |
| Source | Sentry + `gateway_errors_by_type` |
| Threshold | > 10 exceptions / 5 min, or any `parse_error` class |
| False positives | one charger with bad firmware — group by identity |
| First responder | a new parse-error class is new protocol reality; triage before suppressing |
| Customer impact | broken sockets, chargers cannot start sessions |
| Blocks launch? | **YES** |
| **Live today?** | **NO — Sentry absent.** |

### A6 · BootNotification interval drift

| | |
|---|---|
| Severity | S3, but a **cost** S1 at scale |
| Source | static gate OB23 in CI + observed heartbeat spacing |
| Threshold | advertised interval ≠ 3600 without a recorded override |
| False positives | a deliberate override — which is why the resolver reports `env-override` vs `rejected-override` |
| First responder | confirm which of the two it is before touching anything |
| Customer impact | none visible; the bill moves 60x |
| Blocks launch? | no — gated statically |
| **Live today?** | **YES**, as a build gate |

### A7 · Sentry error-rate spike

S2. Source Sentry. Threshold: 3x the 7-day median for the same hour of
week. False positive: a deploy — key to release id, which needs
`version_metadata`. **Not live today.**

### A8 · Sentry PII scrubber violation

| | |
|---|---|
| Severity | **S1 — treat as a data incident, not a bug** |
| Source | a scheduled probe that submits a synthetic event containing a known idTag sentinel and asserts it is absent |
| Threshold | any occurrence |
| False positives | essentially none if the sentinel is unique |
| First responder | **disable the DSN first**, investigate second |
| Customer impact | personal data exported to a third-party processor |
| Blocks launch? | **YES — no production DSN until this probe passes** (M-8) |
| **Live today?** | **NO** |

### A9 · Analytics binding missing / no data

S2. Source: synthetic — if `heartbeats_received` is zero for 1 h while
sockets are connected, the binding is missing or the writer regressed.
False positive: genuinely zero connectors. **Not live today** (OB14).

### A10 · Statement / billing job failure

**S1.** Source: `billing_job_failed`, or `started` without `completed`
within the expected window. Never auto-retry a billing invariant
failure. Blocks launch: **yes**, for any month that has to be invoiced.
**Not live today** — and worse, **no scheduler is declared at all**
(OB21), so there is no job to fail.

### A11 · Delivery failure / retry storm

S2. Source: queue retry counts + `gateway_errors_by_type`. Threshold:
retries > 5x baseline over 10 min. Watch for the self-amplifying case —
a retry storm that itself trips the frame cap.

### A12 · Cloudflare deployment mismatch

| | |
|---|---|
| Severity | S2 |
| Source | compare deployed version id against the release record |
| Threshold | any difference |
| False positives | a rollback someone did and did not record — which is itself the problem |
| Blocks launch? | no |
| **Live today?** | **NO — no version id has ever been recorded.** Gate OB24. |

### A13 · Pinned hostname broken

| | |
|---|---|
| Severity | **S1** |
| Source | synthetic probe against `hlada-api-staging.straumvakt.workers.dev` and the gateway host, every minute, from outside Cloudflare |
| Threshold | 2 consecutive failures |
| False positives | probe-network issues — require two regions |
| First responder | check whether a route was added; `workers_dev` inference is the usual cause |
| Customer impact | **total** — the shipped mobile client has no fallback host, and chargers have the gateway URL burned into device config |
| Blocks launch? | **YES** — this is the cheapest alert here and it covers the worst failure |
| **Live today?** | **NO** — no synthetic probe exists |

### A14 · Neon connection / error spike from Workers

S2, S1 if connections are exhausted. Source: Neon metrics + Sentry.
Threshold: connection count > 80 % of ceiling, or any
`too many connections`. First responder: check for a reconnect storm
(A11) before raising the ceiling — the ceiling is usually not the bug.

---

## What this table actually says

**Nine of fourteen alerts cannot fire today.** Not because thresholds
are wrong, but because four signals do not exist:

1. **No liveness sweeper** → A1 impossible
2. **No Sentry** → A5, A7, A8 impossible
3. **No Analytics Engine binding** → A2, A9 impossible; A6 static-only
4. **No version id, no scheduler, no synthetic probes** → A10, A12, A13

Of these, **A13 is the one to build first**: it is a curl in a cron, it
needs no binding and no vendor, and it covers the failure with the
largest blast radius and the slowest recovery.

**A1 is the one that changes the product.** A charging network that
cannot tell you a charger is dead is not a charging network — and the
gap is not a missing dashboard, it is a missing sweeper in the DO.

---

## Launch-blocking subset

| Alert | Why it blocks |
|---|---|
| A1 missed heartbeat | dead chargers are invisible |
| A4 consumer failure / DLQ | silent data loss → wrong bills |
| A5 gateway error spike | chargers cannot start sessions |
| A8 scrubber violation | personal-data export |
| A13 pinned hostname | total outage, slowest possible recovery |

A10 blocks the first invoice rather than the first charger, which is a
later date but a harder deadline.
