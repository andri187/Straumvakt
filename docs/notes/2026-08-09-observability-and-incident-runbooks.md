# Observability and incident runbooks

**Design proposals and 22 runbooks. No dashboard, alert, metric or automation was
created.**

## Principles

1. **Every signal is environment-scoped.** An alert that does not say *which
   estate* fired is worse than no alert during an incident.
2. **Beta alerts inform; production alerts page.** Otherwise beta noise trains
   people to ignore the channel, and the channel stops working when it matters.
3. **Preserve evidence before recovering.** Every runbook below does this.
4. **No runbook performs a destructive action without a backup or approval gate.**
5. **Rollback is never gated.** A control that delays recovery is a liability.

## Golden signals by component

| Component | Latency | Traffic | Errors | Saturation |
|---|---|---|---|---|
| Web Worker | TTFB p95 | req/s | 5xx rate | `cpu_ms` vs 50 |
| API Worker | endpoint p95 | req/s by route | 5xx, 401/403 ratio | `cpu_ms`, DB connections |
| OCPP gateway | handshake p95 | connects/s, live sockets | upgrade rejections | DO wake concurrency |
| Queues | oldest-unacked age | msg/s in/out | DLQ count | depth |
| Database | query p95 | queries/s | error class | connection count |
| Onboarding | step completion time | orgs/day | validation failures | — |
| Auth | login p95 | attempts/min | failure rate, **429 rate** | limiter headroom |
| Billing | projection lag | sessions projected/min | projection failures | backlog |

## SLOs and error budgets

| SLI | Target `[T]` | Budget (30d) | Gate |
|---|---|---|---|
| Driver API availability | 99.9% | 43 min | launch |
| Web availability | 99.9% | 43 min | launch |
| Charger connection availability | 99% rolling 1 h | — | 4k pilot |
| Session start correctness | > 99% | — | **launch** |
| Session stop correctness | > 99.5% | — | **launch** |
| Cost projection freshness | p95 < 10 min | — | **launch** |
| Ingest freshness | p95 < 5 s | — | 4k pilot |
| Queue consumer lag | p95 < 30 s | — | 4k pilot |
| Dead letters | 0 sustained | any growth pages | launch |
| Command execution latency | p95 < 10 s | — | launch |

The three launch gates are the ones a driver experiences as *"the product is
wrong"* rather than *"the product is slow"*.

## Metric naming

```
straumvakt.<component>.<signal>{env, worker, route?, org_id?, outcome?}
```

`env` ∈ `beta | production | load-test` is **mandatory on every metric**.
`org_id` is permitted (it is a tenant id, not personal data); `user_id`,
`email`, `kennitala`, plate and EVCCID are **never** metric dimensions.

## Trace correlation

| Field | Source | Crosses |
|---|---|---|
| `request_id` | edge, per request | web/API → DB |
| `session_id` | charging session | API → queue → projection |
| `command_id` | outbound command | API → queue → gateway → charger |
| `charger_serial` | OCPP | gateway → API |
| `release_id` | deploy manifest | **everything in one release** |

`release_id` is the field that makes *"did this start with the last deploy?"*
answerable in seconds rather than by memory.

## Structured logs and redaction

| Log | Never log |
|---|---|
| `request_id`, `env`, `release_id`, route, status, duration | email, password, token, PIN |
| `org_id`, `session_id`, `charger_serial` | kennitala, plate, **full EVCCID** |
| hashed rate-limit key | the address that produced it |
| error class + message | raw meter payloads, OCMF blobs |

**EVCCID is personal data by linkage** — it identifies a vehicle across sites.
Log a masked suffix or nothing.

---

# Runbooks

Common preamble: **record UTC, who is acting, and the observed symptom before
changing anything.**

### RB-01 · Wrong-environment deployment
**Detect:** production body hash matches beta's, or vice versa; version id changed unexpectedly.
**Contain:** do not deploy again. Capture both body hashes and both version ids.
**Diagnose:** which integration fired? Which branch? **Is it CPMS's?**
**Recover:** Cloudflare rollback to the captured version id.
**Validate:** body hashes differ between estates.
**Follow-up:** branch protection; CPMS disconnection.

### RB-02 · Domain serves the old Worker after cutover
**Detect:** `curl | sha256sum` on the brand domain equals the **beta** Worker's hash.
**Note:** the site loads and looks correct — **only the hash comparison detects this** (SF-5).
**Recover:** re-check the attachment; re-attach to the intended Worker.
**Validate:** hash differs from beta; TLS valid on apex **and** `www` separately.

### RB-03 · Custom domain disappeared after a deploy
**Contain:** re-attach — the fastest path back to serving.
**Evidence:** pre-deploy domain list; config diff; deploy log.
**Note:** deleting a custom domain does **not** delete its Advanced Certificate; re-attachment may not reuse it cleanly. **Verify TLS explicitly.**
**Follow-up:** the route-omission behaviour is undocumented and remains a stop condition.

### RB-04 · Certificate expiry or invalid TLS
**Detect:** TLS handshake failure; expiry within 14 days.
**Evidence:** `openssl s_client` output per hostname.
**Recover:** re-issue via the custom-domain flow.
**Note:** apex and `www` have **separate certificates** — check both; fixing one does not fix the other.

### RB-05 · OCPP reconnect storm
**Detect:** live sockets collapse then spike; queue depth rises; DO wakes spike.
**Contain:** **do not restart the gateway** — that restarts the storm.
**Diagnose:** upstream network, gateway deploy, or vendor-side restart.
**Recover:** let backoff work. If reconnects are not backing off, **that is the finding**.
**Validate:** 95% reconnected < 5 min.

### RB-06 · Chargers fail to reconnect after an endpoint change
**Contain:** **keep the old endpoint live.**
**Evidence:** per-charger last-seen; cohort membership.
**Recover:** revert configuration per charger → it returns.
**Escalate:** if the old endpoint was retired, this is a **field visit**, and an offline charger is indistinguishable from a stranded one.

### RB-07 · Queue backlog growth
**Contain:** **do not purge** — purging destroys evidence and data.
**Evidence:** depth curve, sample messages (redacted), consumer logs.
**Recover:** fix the consumer, then replay.
**Gate:** any purge or bulk discard requires approval.

### RB-08 · Dead-letter queue growth
**Detect:** DLQ count > 0 sustained.
**Evidence:** sample a message; classify poison vs systemic.
**Recover:** fix, then replay the DLQ.
**Check:** is a valid message stuck behind a poison one? That is a different, worse problem.

### RB-09 · Database connection exhaustion
**Detect:** connection errors under load; Hyperdrive saturation.
**Contain:** shed load if possible before restarting anything.
**Evidence:** connection count, error class, request rate at the knee.
**Note:** Workers mint a client per request with `Pool max: 1`. The ceiling is Hyperdrive's, and **it has never been measured** (E7).

### RB-10 · Hyperdrive points at the wrong Neon branch
**Contain:** **stop writes.** A wrong-branch write is worse than downtime.
**Evidence:** Hyperdrive target host prefix; the branch's compute id — **two sources**.
**Recover:** repoint (approval-gated).
**Validate:** a read returns known-good rows for that environment.

### RB-11 · Default-branch mistake
**Detect:** `relation … does not exist`, or implausibly little data.
**Read it as a wrong-branch signal first** — the abandoned branch's older schema makes it look like a schema bug.
**Recover:** re-run with an explicit branch id. **If a write occurred, escalate** — that branch is unprotected.

### RB-12 · Migration history mismatch
**Detect:** `migrate status` disagrees with disk; checksum error.
**Evidence:** `_prisma_migrations` contents; disk count.
**Do not:** edit a recorded migration — the pinned checksum breaks every later run.
**Recover:** reconcile deliberately per the operator pack.

### RB-13 · Migration recorded but DDL never ran
**Detect:** history says applied; the object still exists.
**Cause:** `resolve --applied` used where `deploy` was needed.
**Recover:** run the SQL by hand — **re-deploying will not re-run a recorded migration**.
**Prevent:** never `resolve` a migration whose statements have outstanding work.

### RB-14 · Cost projection lag
**Detect:** SLO breach; drivers see "Pending" long after ending.
**Contain:** **do not hand-backfill** — a hand-written cost is unauditable.
**Recover:** re-run projection; verify `exVat + vat == incVat`.
**Gate:** any manual cost adjustment requires approval.

### RB-15 · Cost discrepancy reported by a driver
**Detect:** a customer disputes an amount.
**Evidence:** session id, the exact API response, client version, the meter reading.
**Diagnose:** unit error (aurar vs króna), tariff resolution, or a projection bug.
**Severity:** if amounts are wrong by ~100×, treat as **Sev-1** — a trust and billing incident, not a display bug.
**Recover:** correct the projection; **notify affected drivers**, do not quietly fix.

### RB-16 · Stale mobile client incompatibility
**Detect:** error rate concentrated on one app version; the pinned host sees unexpected traffic.
**Contain:** **do not retire the pinned hostname.**
**Recover:** restore the removed field additively; a mobile release cannot be rolled back.
**Prevent:** additive-first, remove one release later.

### RB-17 · Session start works but the app cannot recover
**Diagnose:** the start race — an empty array means both "not yet" and "ended", and the API cannot distinguish them.
**Recover:** force refresh; correct the session status if wrong.
**Follow-up:** the client grace state.

### RB-18 · Stop accepted but the charger keeps charging
**Evidence:** command id, queue state, OCPP transaction id, connectivity.
**Note:** the API returns 409 rather than enqueuing a command the charger cannot act on, so a 202 means a transaction ref existed.
**Escalate:** this is a **physical safety matter** — tell the driver plainly the session is still live; involve the site host if a bay is blocked.

### RB-19 · Invite abuse
**Detect:** many redemptions from one IP; codes redeemed by unexpected identities.
**Evidence:** invite ids, inviter, redeemer, timestamps.
**Contain:** revoke outstanding codes for that org.
**Diagnose:** is identity binding enforced **on the path used**? Three consume paths exist.
**Follow-up:** negative test per path.

### RB-20 · Audit attribution failure
**Detect:** an audit row with no user, or an action with no row.
**Severity:** high — attribution is the control that makes every other control reviewable.
**Evidence:** the action, the session, what the row does contain.
**Recover:** cannot be retro-attributed. **Record the gap honestly** rather than guessing.

### RB-21 · Login throttling false positives
**Detect:** 429 rate rises; a legitimate customer reports being locked out.
**Likely cause:** shared NAT — one user's failures throttling a whole office.
**Contain:** confirm the account limiter, not the IP limiter, is the correct dimension.
**Recover:** the window expires; do not disable throttling under pressure.

### RB-22 · Suspected cross-tenant access
**Contain:** **preserve logs before anything else.**
**Evidence:** request ids, hashed tokens, org ids, the predicate path.
**Diagnose:** re-run the cross-tenant negative suite. Was ownership enforced in the query predicate or as a separate check?
**Recover:** revoke tokens — **note there is no revocation mechanism today**; patch the predicate.
**Escalate:** a confirmed case is a **reportable data incident**.

---

## Alert routing

| Severity | Beta | Production |
|---|---|---|
| **Sev-1** — customer cannot charge, money wrong, data incident | channel | **page** |
| **Sev-2** — SLO breach, DLQ growth, cert < 14 days | channel | **page** in hours |
| **Sev-3** — informational | channel | channel |

**Rollback triggers** — any of these authorises a rollback with no approval:
brand domain not serving; TLS invalid; wrong-environment deploy confirmed;
production reading beta data; money wrong by an order of magnitude; charger
fleet disconnected and not recovering.
