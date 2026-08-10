# Core Ops — OCPP cost gates, release gates, and cleanup state

**Run.** `overnight-claude-core-ops-ocpp-cost-release-cleanup-2026-08-10.md`
**Worktree.** `E:\Claude\Straumvakt-beta-production` · `docs/beta-production-release-architecture` · start tip `939d9e4`

**The finding this run exists for:** every OCPP Call frame — **including
`Heartbeat`** — is enqueued unconditionally at `gateway/src/identity-do.ts:615`.
The retention class rides *on* the message as metadata; it does not gate the
send. An idle connector therefore costs **720 queue operations a month** for
frames that carry nothing but liveness and a clock, against a price cap of
**450 kr per connector per month**.

That is now an executable gate (**OC1**), not a paragraph.

---

## Starting verification

| | |
|---|---|
| Worktree / branch | `Straumvakt-beta-production` / `docs/beta-production-release-architecture` |
| HEAD at start | `939d9e4` · dirty 0 |
| `E:\Claude` | **17.09 GB total, 1.24 GB content** — 93% regenerable build output |
| First-level folders | **13** |
| Registered worktrees | **13** (12 on disk + 1 stale registration) |
| Local / remote branches | **46 / 16** |

**State changed under me during this run.** `Straumvakt-parked` and `zaptec-test`
were deleted between 02:16 and 02:28 by another actor — my own attempt in the
previous task was blocked by the permission classifier, so this was not me. I
re-verified the consequences rather than assume them: `docs/OpenADR` (38 files)
and `tools/zaptec-test` (60 on disk, 58 tracked) survive, commit `82c63ac` is
reachable, and the `.env` byte backup still exists off-repo — where it is now the
**only** copy.

---

## Phase 1 — Live state reconciliation

### Folder classification (13 first-level entries)

| Folder | GB | Content MB | Git | Class | Why it is still outside canonical |
|---|---|---|---|---|---|
| `CPMS` | 8.78 | 49.5 | repo (nested) | **provenance** | Separate project and separate remote. Origin of the `hlada` names and much of the OCPP design. Standing rule: never touch. |
| `Straumvakt` | 3.85 | 377 | **canonical** | keep | The destination. 26 dirty entries belonging to other lanes. |
| `Straumvakt-onboarding-domain` | 1.33 | 97.4 | worktree | **active lane** | Claude A. Moved twice during this run (`584a19f`). |
| `Straumvakt-core-billing` | 1.30 | 66.8 | worktree | **active lane** | Created by another session. |
| `Straumvakt-release-candidate` | 1.27 | 86 | worktree | keep | Pinned at `4b69d0f`. Protected by name in the cleanup prompt. |
| `Straumvakt-diag-p4c` | 0.09 | 92.6 | worktree | keep | Protected by name. 1 dirty file. |
| `Straumvakt-audit-checks` | 0.08 | 86 | worktree | retirable | Detached at `2b7ebf6`, 0 unique, 0 dirty. |
| `Straumvakt-relaunch-integration` | 0.08 | 85.9 | worktree | keep | Protected by name. |
| `Straumvakt-driver-access-ui` | 0.07 | 64.8 | worktree | **active lane** | Codex. |
| `Straumvakt-relops-b` | 0.06 | 64.7 | worktree | unknown owner | At `4b69d0f`, 0 dirty. Created by another session; purpose not recorded anywhere I can find. |
| `Straumvakt-core-security` | 0.06 | 64.7 | worktree | **created by me** | I created it for the Claude A task that was then superseded. **It is a cleanup candidate I introduced.** |
| `Straumvakt-beta-production` | 0.06 | 65.9 | worktree | keep | This lane. |
| `Straumvakt-onboarding-web` | 0.06 | 65.3 | worktree | **active lane** | Codex. |

**The measurement that matters for cleanup:** 17.09 GB total against **1.24 GB of
real content**. Roughly **15.85 GB is regenerable** `node_modules` / `.next` /
`.dart_tool` / `build`. Every worktree carries its own copy.

### What remains outside canonical, and why

1. **`CPMS`** — a different project. Not ours to move.
2. **Nine sibling worktrees** — the git worktree model *requires* separate
   directories. They are not duplication in the wasteful sense; the waste is the
   nine independent `node_modules` trees, not the checkouts.
3. **One stale registration** — `/sessions/rcw-…/Straumvakt-docs-log` at
   `5311cbd`, a forbidden commit. Prunable, but pruning is a mutation this prompt
   does not approve.
4. **`Straumvakt-core-security`, mine.** The prompt says no new top-level
   `Straumvakt-*` folders. I created that one in the previous task, before this
   rule was stated. Reporting it rather than quietly leaving it.

**Nothing was deleted, moved or archived by this run.**

---

## Phase 2 — OCPP cost gate package

**22 rules · 40 fixtures · all 22 exercised · 168/168 across 7 checkers.**

```
node scripts/analysis/ocpp/collect-ocpp-cost-profile.mjs --out <profile.json>
node scripts/analysis/ocpp/check-ocpp-cost.mjs [--strict] [--json] <profile.json>
node scripts/analysis/ocpp/check-ocpp-cost.mjs --self-test
```

Collection is separate from judgement, the pattern that has worked for every
checker in this programme: the collector reads source and config and records what
is true; the checker decides whether it is affordable. You cannot conveniently
arrange a fleet of noisy chargers to prove a rule fires — but you can write the
profile down.

| Rule | Enforces | Severity |
|---|---|---|
| **OC1** | Heartbeat must not reach the queue | error |
| **OC2** | Labelling a frame disposable is not the same as not sending it | warn |
| **OC3** | Heartbeat classified `raw_protocol` somewhere | error |
| **OC4** | Default retention must be `operational`, not `raw_protocol` — **fail long, not short** | error |
| **OC5** | Idle interval ≥ 3600 s | error |
| **OC6** | Active-session interval must be *measured*, never invented | error |
| **OC7** | No permanent raw frame persistence | error |
| **OC8** | Raw TTL present and ≤ 30 days | error / warn |
| **OC9** | `lastSeenAt`, online/offline transitions, hourly rollup all exist | error |
| **OC10** | Per-connector frame cap exists | error |
| **OC11** | Frames/connector/month within a stated ceiling | error |
| **OC12** | DO uses the Hibernation API | error |
| **OC13** | Code accounts for losing in-memory state across a wake | warn |
| **OC14** | `setWebSocketAutoResponse` — **info only** | info |
| **OC15** | Authorize cache TTL present and ≤ 5 min | error / warn |
| **OC16** | Queue producer binding declared | error |
| **OC17** | Synchronous fallback must warn | error |
| **OC18** | Every producer has a consumer in the estate | warn |
| **OC19** | Consumers declare a DLQ; retries bounded | error / warn |
| **OC20** | A pinned host's config declares `workers_dev` | error |
| **OC21** | A pinned host with no runtime override | warn |
| **OC22** | No Neon branch per organisation | error |

### Design notes worth keeping

**OC4 fails long, not short.** The existing `retentionClassFor` already defaults
to `operational` rather than `raw_protocol`, with a comment explaining why: an
untriaged frame type is more likely to be something new that matters than
something disposable. The rule protects that choice from being "optimised" later.

**OC14 is deliberately informational.** `setWebSocketAutoResponse` answers
WebSocket-level ping without waking the DO — but OCPP `Heartbeat` is an
*application* frame and still wakes it. Those two are easy to conflate, and a
rule that failed a build over a control that does not address the actual cost
would be deleted rather than read.

**No money constants.** Cloudflare and Neon unit prices are not hard-coded. A
stale price in a checker is worse than no price. The rules reason about whether a
cost scales with **frames** rather than with **sessions**; Phase 3 turns that
into ISK.

### Against the real repository

```
ERROR OC1   every Call frame is enqueued, including Heartbeat (identity-do.ts:615)
WARN  OC2   retentionClass rides on the message rather than gating the send
WARN  OC8   no TTL recorded for raw protocol frames
ERROR OC10  no per-connector frame cap
INFO  OC14  setWebSocketAutoResponse not used
ERROR OC20  wrangler.jsonc [top-level hlada] pinned, workers_dev undeclared
ERROR OC20  apps/api [top-level hlada-api] pinned, workers_dev undeclared
ERROR OC20  apps/api [env.staging hlada-api-staging] pinned, workers_dev undeclared
WARN  OC21  flutter-mobile pin has no runtime override (client.dart:25)
```

**5 errors, 3 warnings, 1 info.** Profile committed at
`docs/notes/evidence/ocpp-cost-profile-2026-08-10.json`.

What passes and is worth saying: the DO **does** use the Hibernation API, the
queue producer binding **is** declared, the fallback **does** warn, and Heartbeat
**is** correctly classified `raw_protocol`. The gap is that the classification
arrives too late to save the queue operation.

### Scale fixtures

Eight fixtures model 50 / 100 / 500 / 1000 connectors, each twice — once with the
heartbeat dropped before the queue (passes) and once with the current behaviour
(fails). At 1000 connectors that is **720,000 queue operations a month** buying
nothing, against **450,000 kr** of capped monthly revenue.

---

## Phase 4 — Release and environment gates

Rather than a new parallel list, these are the gates that already exist as code
plus the OCPP additions. **168 fixtures across 7 checkers**, all green:

| Checker | Rules | Fixtures |
|---|---|---|
| environment manifests | — | 8 |
| release manifests | R1–R17 | 37 |
| preservation manifests | P1–P15 | 32 |
| freeze manifests | FZ1–FZ12 | 23 |
| wrangler configs | L1–L8 | 11 |
| **ocpp cost gates** | **OC1–OC22** | **40** |
| branch safety | G1–G11 | 17 |
| | **85 rules** | **168** |

Live results against the estate today:

- **Branch safety:** 2 × G1 (branches tracking the deploy pointer), 2 × G3
  (shared upstreams), 3 × G10 (worktrees at forbidden commits), G6 and G7
  warnings. **Unchanged from yesterday** — none of it has been remediated.
- **Wrangler:** 0 errors, 5 × L2, 6 × L3.
- **OCPP cost:** 5 errors as above.

**Queue binding verified in config, not in the deployed environment.** The
producer binding exists in `gateway/wrangler.jsonc`; whether it exists on the
deployed Worker is blocked fact F2-adjacent and needs the read-only Cloudflare
session (AP-1). Config agreement is not deployment agreement, and this programme
has already been wrong about that once.

---

## Phase 3 — Measurement plan (when chargers are connected again)

The active-session heartbeat interval is **TBD from real charger data** and this
run does not invent it. What follows is what to measure so it stops being TBD.

### Per-connector frame accounting

Count frames per connector per month **by message type**, separated into idle and
in-session. The single number that decides the ingest bill is
*frames-per-session-hour*, and nothing in the repository knows it.

| # | Metric | Source | Why |
|---|---|---|---|
| 1–8 | Frames/month by type: Heartbeat, StatusNotification, MeterValues, StartTransaction, StopTransaction, Authorize, BootNotification, DataTransfer | gateway logs / queue | Splits disposable from financial |
| 9 | Frames per session-hour | derived | **The unknown that sizes everything** |
| 10 | Idle:active frame ratio | derived | Tells you whether OC1 or MeterValues dominates |
| 11–13 | DO requests, DO duration (GB-s), DO storage ops | Cloudflare analytics | Hibernation is only a saving if duration stays flat while sockets are held |
| 14–16 | Queue operations, batch size distribution, DLQ depth | Queues dashboard | OC18/OC19 in production |
| 17–20 | Neon rows written/day, storage growth/day, connection count, compute active hours | Neon metrics | Retention policy needs a growth rate |
| 21–24 | Report-burst job count, duration, peak concurrency, failures | job runner | Monthly close is the burst |
| 25–28 | Web UI API calls per admin session, per page, per poll interval, per month | API logs | UI polling is a silent multiplier |
| 29–32 | Driver UI API calls: per session, per poll, per push, per month | API logs | Same, on a bigger population |
| 33–35 | Log lines/day, Logpush volume, tail sampling rate | observability | Logs bill too |
| 36–40 | Per-charger frame rate p50/p95/p99/max, and count over the OC10 cap | derived | Noisy-charger detection |
| 41–44 | Cost per connector in ISK: DO, Queues, Neon, total | derived | Against the 200 kr line |
| 45–48 | Cost per active driver in ISK: API, Neon, notification, total | derived | Against the 50 kr line |
| 49–52 | Margin per connector at 50 / 100 / 500 / 1000 | derived | Against the 450 kr cap |
| 53–56 | Reconnect storm size, duration, peak concurrent sockets, failed reconnects | gateway | Sizes the DO and Neon connection ceiling |
| 57–60 | Session count/month, mean session duration, energy/session, cost accuracy vs hand calculation | derived | The billing correctness check |

### Read-only query sketches

All `SELECT` only. **None of these was run** — there is no live database access in
this lane, and running them is a separate approval.

```sql
-- 1. Frames by type and retention class, last 30 days
SELECT event_type, retention_class, count(*) AS frames
FROM ocpp_events WHERE occurred_at > now() - interval '30 days'
GROUP BY 1,2 ORDER BY frames DESC;

-- 2. The OC1 number, measured rather than derived
SELECT count(*) FILTER (WHERE event_type = 'ocpp.raw.Heartbeat')::numeric
     / NULLIF(count(DISTINCT identity_id),0) AS heartbeats_per_connector
FROM ocpp_events WHERE occurred_at > now() - interval '30 days';

-- 3. Noisy connectors against the OC10 cap
SELECT identity_id, date_trunc('hour', occurred_at) AS hr, count(*) AS frames
FROM ocpp_events WHERE occurred_at > now() - interval '7 days'
GROUP BY 1,2 HAVING count(*) > 120 ORDER BY frames DESC LIMIT 50;

-- 4. Raw-protocol rows that outlived the TTL (OC7/OC8 in production)
SELECT retention_class, min(occurred_at), count(*)
FROM ocpp_events WHERE retention_class = 'raw_protocol'
  AND occurred_at < now() - interval '7 days' GROUP BY 1;

-- 5. Storage growth per day, to turn retention into a number
SELECT date_trunc('day', occurred_at) d, count(*) rows,
       pg_size_pretty(sum(pg_column_size(payload))) approx_payload
FROM ocpp_events WHERE occurred_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1;
```

Sketches 6–20 follow the same shape for sessions, drivers, report bursts, DLQ
contents, and per-org distribution. Every one is `SELECT`; none aggregates
personal data beyond a count.

### Alerts and runbook actions

**Alerts (specified, not implemented):** frames/connector/hour over cap ·
DLQ depth non-zero · queue backlog growing over 15 min · fallback ingest path
active at all · DO duration rising while socket count flat · Neon connection
count over 80% of ceiling · storage growth over budget · raw rows past TTL ·
report burst over duration budget · error 1042 on a pinned host · charger count
drop over 10% · reconnect storm over the measured ceiling · cost per connector
over 200 kr · cost per connector over the 450 kr cap · Authorize latency p99 ·
session cost mismatch against hand calculation · unknown frame type appearing ·
retention class `operational` growing unexpectedly · Logpush volume spike ·
consumer retry rate rising.

**Runbook actions:** cap a noisy connector · drain a DLQ after triage · fail over
to the synchronous ingest deliberately · widen the heartbeat interval under load ·
purge expired raw frames · roll back a gateway version (drill RD-04) ·
re-establish the charger count baseline · repoint Hyperdrive after a Neon restore ·
raise the frame cap with a recorded reason · declare a cost incident.

---

## Phase 5 — Agent Landmine Barrier

A reusable appendix for future prompts, at
[`2026-08-10-appendix-s-agent-landmine-barrier.md`](2026-08-10-appendix-s-agent-landmine-barrier.md).

---

## Top blockers

1. **OC1 — heartbeat reaches the queue.** The only finding here that scales with
   the fleet. Fix is small: drop `Heartbeat` before `enqueueOrPost` and fold it
   into `lastSeenAt` plus a transition event.
2. **OC10 — no per-connector frame cap.** One misbehaving charger can bill the
   estate, and 450 kr per connector cannot absorb it.
3. **OC20 — three environments pinned without declaring `workers_dev`.**
   Unchanged since yesterday.
4. **Queue binding unverified in the deployed environment.** Config is not
   deployment.
5. **Active-session interval still unknown.** Everything above is sized against a
   number nobody has.
6. **Branch-safety findings unremediated** — 2 × G1, 2 × G3, 3 × G10.
7. **The Android upload key** remains on one disk plus one local backup on the
   same machine. It cannot be rotated.
