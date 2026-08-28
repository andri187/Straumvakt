# SLOs and incident runbooks

**Proposals. No alert, dashboard, or automation was created.** Targets are `[T]`.

## Principle

Every runbook below **preserves evidence before it recovers**, and **no runbook
instructs a destructive action without a backup or an approval gate**. Where the
fastest fix is destructive, the runbook says so and routes through approval.

## SLOs / SLIs

| # | SLI | Measurement | Target `[T]` | Gate |
|---|---|---|---|---|
| 1 | Charger connection availability | connectors with a live socket ÷ provisioned | 99% rolling 1 h | 4k pilot |
| 2 | Command acceptance latency | request → 202 | p95 < 2 s | launch |
| 3 | Command execution latency | 202 → charger acts | p95 < 10 s | launch |
| 4 | Session start correctness | starts producing a session row ÷ accepted starts | > 99% | **launch** |
| 5 | Session stop correctness | stops producing a stopped charger ÷ accepted stops | > 99.5% | **launch** |
| 6 | Meter ingestion freshness | event → durable | p95 < 5 s | 4k pilot |
| 7 | Queue consumer lag | oldest unacked age | p95 < 30 s; page > 5 min | 4k pilot |
| 8 | Dead letters | count | 0 sustained; any growth pages | launch |
| 9 | Cost projection freshness | session end → cost visible | p95 < 10 min | **launch** |
| 10 | Driver API availability | non-5xx ÷ total | 99.9% | launch |
| 11 | Login success rate | successes ÷ attempts | tracked, no target | launch |
| 12 | Login throttle rate | 429 ÷ attempts | alert on sudden rise | launch |
| 13 | Tap-intent correlation success | matched ÷ armed | > 90% | tap launch |
| 14 | Issue detection → acknowledgement | fault → operator ack | p95 < 30 min | 4k pilot |

SLOs 4, 5 and 9 gate launch because each is directly visible to a driver as
"the product is wrong", not merely "the product is slow".

---

# Runbooks

Common preamble for all: **record UTC time, who is acting, and the observed
symptom before changing anything.**

## RB-1 · Live domain serves the wrong Worker or version

**Detect:** brand-domain response differs from the expected build; unexpected
version id in the dashboard.
**Contain:** do not deploy. Capture `curl -sD-` output and body SHA-256 for
apex, www and the workers.dev host.
**Evidence:** current version id, deployment list, custom-domain attachment.
**Diagnose:** did a Git integration fire? **Is the integration owned by CPMS?**
CPMS declares the same Worker names (`wrangler.jsonc:3,32`) and documents
auto-deploy — a CPMS push can overwrite this Worker.
**Recover:** Cloudflare rollback to the last known-good version id.
**Rollback:** re-attach custom domains to the previous Worker if the version
rollback is insufficient.
**Validate:** body SHA matches the expected build; TLS valid.
**Follow-up:** PROPOSED-B and PROPOSED-C.

## RB-2 · A `staging` advance became a production release

**Detect:** brand domain changes after a branch push.
**Contain:** **do not force-push the branch back** — that is itself a production
action and may re-trigger a build. Roll back the *Worker version* instead.
**Evidence:** pushed SHA, build log, version id before and after.
**Recover:** version rollback; then decide branch state deliberately.
**Approval gate:** any branch history rewrite.
**Follow-up:** protection (SEC-11) and PROPOSED-A.

## RB-3 · Custom domain disappears after a deploy

**Detect:** apex/www resolve but do not serve, or TLS fails.
**Contain:** re-attach the custom domain — **fastest path back to serving.**
**Evidence:** pre-deploy domain list (captured per the release runbook), config
diff, deploy log.
**Note:** deleting a custom domain does **not** delete its Advanced Certificate;
re-attachment may or may not reuse it cleanly — verify TLS explicitly, do not
assume.
**Follow-up:** PROPOSED-C. This behaviour is undocumented by Cloudflare and is a
standing stop condition.

## RB-4 · Hyperdrive points at the wrong Neon branch

**Detect:** live data inconsistent with expectation; or an unqualified query
fails as `relation … does not exist`.
**Contain:** **stop writes.** A wrong-branch write is worse than downtime.
**Evidence:** Hyperdrive config, branch id, compute activity timestamps.
**Diagnose:** compare the configured branch id against
`br-tiny-river-abgpqq37` (staging).
**Recover:** repoint Hyperdrive; **approval-gated** — it is a production config
change.
**Validate:** a read returns known-good staging rows.
**Follow-up:** PROPOSED-D.

## RB-5 · Database default-branch mistake

**Detect:** `relation … does not exist`, or a query returning implausibly little
data. **Treat this error as a wrong-branch signal first** — the abandoned
`production` branch carries an older schema, which is why the symptom looks like
a schema bug.
**Contain:** stop the tool; identify the branch actually reached via compute
`last_active`.
**Evidence:** the exact call, whether a branch id was passed.
**Recover:** re-run against the explicit branch id. If a **write** occurred,
escalate — `production` is unprotected.
**Follow-up:** PROPOSED-D; branch-id discipline for agents and tooling.

## RB-6 · OCPP reconnect storm

**Detect:** connection count collapses then spikes; queue depth rises; DO wake
concurrency spikes.
**Contain:** do not restart the gateway — that restarts the storm.
**Evidence:** connects/s curve, queue depth, error classes.
**Diagnose:** upstream network event, gateway deploy, or vendor-side restart.
**Recover:** allow backoff to work; if reconnects are not backing off, that is
the finding.
**Validate:** 95% reconnected within 5 min `[T]`.
**Follow-up:** E2; reconnect jitter (capacity mitigation 5).

## RB-7 · AMQP / Fly consumer outage

**Detect:** consumer lag rises monotonically; ingest freshness breaches.
**Contain:** confirm the queue is **retaining**, not dropping — retention is the
thing that makes this survivable.
**Evidence:** backlog depth at detection, consumer logs, last processed offset.
**Recover:** restart the consumer; watch that catch-up does not starve live
traffic (E6's real subject).
**Validate:** backlog drains; no duplicate session rows.

## RB-8 · Queue or dead-letter growth

**Detect:** SLO 7/8 breach.
**Contain:** **do not purge the queue.** Purging destroys evidence and data.
**Evidence:** sample messages (redacted), DLQ counts, error classes.
**Diagnose:** poison message vs. systemic consumer failure.
**Recover:** fix the consumer, then replay the DLQ.
**Approval gate:** any purge or bulk discard.

## RB-9 · Session start works but the app cannot recover

**Detect:** driver reports charging with no active session shown; `/sessions/current`
returns `[]` while a session row exists.
**Evidence:** session id, `userId`, poll responses, app version.
**Diagnose:** the start race (empty array means "not yet" *and* "ended" — the API
cannot distinguish); or a `userId` mismatch; or a status not in `in_progress`.
**Recover:** driver-side, force refresh. Platform-side, correct the status.
**Follow-up:** the start-race grace state (acceptance AC-12).

## RB-10 · Stop accepted but the charger keeps charging

**Detect:** 202 returned, session stays `in_progress`.
**Evidence:** command id, queue state, OCPP `transactionId`, charger connectivity.
**Diagnose:** command queued but undelivered; charger offline; missing
`transactionId` — note the API returns **409** rather than enqueuing a command
the charger cannot act on, so a 202 means a transaction ref existed.
**Recover:** re-issue; if the charger is unreachable, this is a **physical
safety matter** — the driver must be told plainly that the session is still live.
**Escalate:** operator, and the site host if the vehicle is blocking a bay.

## RB-11 · Cost projection or invoicing lag

**Detect:** SLO 9 breach; drivers see "Pending" long after ending.
**Contain:** **do not backfill by hand.** A hand-written cost is unauditable.
**Evidence:** projection backlog, last successful run, affected session ids.
**Recover:** re-run projection; verify
`totalExVat + vat == totalIncVat` (already asserted in
`compute-session-cost.ts:109`).
**Approval gate:** any manual cost adjustment.

## RB-12 · Fabricated or stale telemetry incident

**Detect:** drivers report implausible power/cost; or a client displays a value
the API cannot source.
**Evidence:** exact API response, client version, screenshot.
**Diagnose:** is the client rendering `0` as measured? Is it applying — or
failing to apply — the aurar ÷100 convention?
**Immediate:** if money is displayed wrongly by 100×, treat as **Sev-1** — that is
a trust and billing incident, not a display bug.
**Recover:** roll the client back, or hot-fix the field.
**Follow-up:** P0-A and P0-E. **This runbook exists because the two current
mismatches cancel, and correcting one alone triggers exactly this incident.**

## RB-13 · BLE credential exposure

**Detect:** PIN observed outside the app; a rooted-device report.
**Contain:** revoke the driver's grants; **note the PIN itself cannot be
rotated** — it is factory-set and printed on the enclosure.
**Evidence:** `charger.ble_pin.released` audit rows, grant timestamps, affected
serials.
**Recover:** there is no cryptographic recovery. Mitigation is physical or
policy: restrict which chargers are grantable, and to whom.
**Follow-up:** PROPOSED-I. **This is the runbook whose recovery step is weakest,
and that is the argument for the role boundary.**

## RB-14 · Suspected cross-tenant access

**Detect:** a driver reports another org's charger or session; an anomalous
404/200 pattern.
**Contain:** **preserve logs before anything else.**
**Evidence:** request ids, tokens (hashed), org ids, the exact predicate path.
**Diagnose:** re-run the cross-tenant negative suite (AC-40…AC-44). Check whether
ownership was enforced in the query predicate or in a separate check — the
predicate form is the correct one and is what the current code uses.
**Recover:** revoke tokens (SEC-2 notes there is no revocation mechanism today —
this is where that gap bites), patch the predicate.
**Escalate:** this is a **reportable data incident** if confirmed.
