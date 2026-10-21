# OCPP / connector cost evidence — observed aggregates

Read-only evidence gathering for cloud/service cost estimation per
charger/connector. **No mutation of any kind:** every SQL statement was a
`SELECT`; no DDL, no DML, no migration, no deploy, no Cloudflare/Neon/GitHub
change. Aggregates only — no idTags, no payload bodies, no personal data, no
connection strings.

## ⚠ Read this before using any number below

**The database queried is the Neon STAGING branch, and it contains simulator
traffic.** That matters more than any single figure here:

- Session rates of 150–600 per connector per month are **simulator output**, not
  driver behaviour. Real-world sessions per connector will be far lower — the
  one connector with a 88-day observation window shows **8.3 sessions/month**,
  which is the only figure here that looks like a real duty cycle.
- **Protocol volume, by contrast, transfers well.** Heartbeats, boot
  notifications and status notifications are emitted by the charger firmware on
  a timer regardless of whether a human plugs in, so the per-connector message
  rates are broadly representative of production.

Use the message-rate numbers. Treat the session numbers as an upper bound
artefact.

---

## Phase 1 — Data sources

| Source | Path / system | Contains | Time range | Safe to query? | Notes |
|---|---|---|---|---|---|
| Neon Postgres (staging) | project `spring-leaf-73019190`, branch `br-tiny-river-abgpqq37` | full event/protocol/session history | 2026-05-03 → 2026-08-09 | yes, read-only | **the only usable source**; 942 MB synthetic storage |
| Gateway source | `gateway/src/*.ts`, `gateway/wrangler.jsonc` | DO design, hibernation, queue config | current | yes | authoritative for Phase 4 |
| Partition migration | `prisma/migrations/20260503180000_…` | partitioning strategy | — | yes | 106 daily partitions each for `event_log`, `meter_values` |
| Protocol-log migration | `prisma/migrations/20260802220000_protocol_log` | raw-tier split | — | yes | cutover 2026-08-03 |
| Old CPMS DO state | `E:\Claude\CPMS\…\.wrangler\state\v3\do\` | **nothing** | — | n/a | see below |
| Linux dev workstation | — | — | — | **unavailable** | `ssh` client present, no `~/.ssh/config`, no host defined |

**The old DO metadata files are empty.** Both
`straumvakt-ocpp-ChargerConnection` and `straumvakt-ocpp-ChargerRegistry`
`metadata.sqlite` files are 4096 bytes with `pageCount = 1` — a bare SQLite
header, zero rows. They are also from a **superseded architecture** (the current
gateway has one class, `IdentityDurableObject`; those two class names no longer
exist) and were last written 2026-04-19 by a local miniflare dev run. They carry
no historical evidence.

## Phase 2 — Schema inventory

| Domain | Table | Key columns | Time column | Join path to connector | Notes |
|---|---|---|---|---|---|
| protocol (raw) | `events.protocol_log` | `aggregate_id`, `event_type`, `payload` | `recorded_at` | `aggregate_id` → `ocpp.ocpp_identities.id` | partitioned daily, 15 partitions, live since 08-03 |
| events | `events.event_log` | same shape | `recorded_at` | same | partitioned daily, 106 partitions |
| events | `events.event_log_legacy` | — | `occurred_at` | — | frozen pre-partition remnant, 5,919 rows |
| identity | `ocpp.ocpp_identities` | `id` | — | 1:1 with station | 31 rows |
| assets | `assets.charging_stations` / `evses` / `connectors` | `id` | — | **1:1:1** | 31 each |
| charging | `charging.sessions` | `ocpp_identity_id`, `connector_id`, `evse_id` | `started_at` | direct | 1,655 rows |
| charging | `charging.live_session_samples` | `charger_id`, `power_w`, `energy_wh` | `observed_at` | `charger_id` | 340,866 rows — the real telemetry table |
| charging | `charging.meter_values` (+`_legacy`) | — | `measured_at` | — | **0 rows in both** |
| ocpp | `ocpp.outbound_commands` | `identity_id`, `status`, `correlation_id` | `created_at` | direct | 48 rows |
| reports | `reports.session_ledger` | — | — | — | 1,642 rows |
| events | `events.idempotency_keys` | `scope`, `key`, `expires_at` | `created_at` | — | 439,420 rows — see Phase 3 |

**Topology is 1 : 1 : 1 : 1** — station : EVSE : connector : OCPP identity. So in
this fleet *per-connector and per-charger costs are the same number*. That will
stop being true for any multi-connector hardware, and the DO is keyed per
**charger**, not per connector (Phase 4).

## Phase 3 — Observed aggregates

### Fleet-level rollup

| Metric | Value |
|---|---:|
| Organisations | 19 |
| Charging stations / EVSEs / connectors / OCPP identities | 31 / 31 / 31 / 31 |
| Distinct chargers ever seen in `event_log` | **49** |
| Chargers concurrently active (early Aug) | ~20 |
| Chargers connected on the last observed day | **1** |
| `event_log` window | 2026-05-03 → 2026-08-08 (98 days span, 95 active) |
| `protocol_log` window | 2026-08-03 → 2026-08-09 (7 days) |
| Charger-days observed | 333 |
| `event_log` rows | 366,000 |
| `protocol_log` rows | 67,549 |
| `live_session_samples` rows | 340,866 |
| Sessions | 1,655 over 89 active days (18.6/day fleet-wide) |
| Median rows / charger / day | **594** |
| Mean rows / charger / day | 1,099 |
| p95 rows / charger / day | 1,595 |
| **Peak rows / charger / day** | **24,361** |

49 distinct chargers against 31 provisioned means ~18 were de-provisioned or
re-created during the window. Any per-connector average computed against today's
31 rows is therefore slightly optimistic.

### OCPP message mix — `event_log`, 95 active days

| message_type | rows | rows/day | percent |
|---|---:|---:|---:|
| `ocpp.raw.Heartbeat` | 347,282 | 3,655.6 | **94.9 %** |
| `ocpp.raw.MeterValues` | 11,797 | 124.2 | 3.2 % |
| `ocpp.raw.StatusNotification` | 4,458 | 46.9 | 1.2 % |
| `ocpp.raw.BootNotification` | 2,115 | 22.3 | 0.6 % |
| `ocpp.raw.StartTransaction` | 184 | 1.9 | 0.1 % |
| `ocpp.raw.StopTransaction` | 118 | 1.2 | 0.03 % |
| `ocpp.command_result` | 26 | 0.3 | 0.01 % |
| `ocpp.raw.Authorize` | 20 | 0.2 | 0.01 % |
| **Total** | **366,000** | 3,852.6 | 100 % |

`protocol_log` is **100 % Heartbeat** (67,549 rows / 7 days).

**Heartbeats are the entire cost story.** Everything a charger does that a human
would recognise as work — starting, stopping, authorising, metering — is **0.2 %
of rows combined**.

Two heartbeat regimes are visible, so the interval is per-charger configuration,
not a fleet constant:

| Regime | Heartbeats/day | Implied interval |
|---|---:|---:|
| Fast | 1,342 – 1,435 | **~60 s** |
| Slow | 518 – 524 | ~165 s |

### One connector produced a third of everything

| Metric | Value |
|---|---:|
| Top-1 charger rows | **120,132** |
| Share of all `event_log` rows | **32.8 %** |
| Its heartbeat rate | 16,599/day → **one every 5.2 s** |
| Its sessions | **0** |

A single misconfigured or reconnect-looping charger, over 7 days, emitted a
third of the entire fleet's telemetry and did no charging at all. **Per-connector
averages are close to meaningless without a cap.** Any cost model must carry a
per-connector rate limit or the p99, not the mean.

### Per-connector monthly estimate inputs

Hashed references. `evlog/day` is total `event_log` rows for that connector.

| connector_ref_hash | observed_days | evlog_rows_per_day | hb_per_day | meter_rows_per_day | status_rows_per_day | sessions_per_month | est_db_mb_per_month¹ |
|---|---:|---:|---:|---:|---:|---:|---:|
| `517f927c` ⚠ | 7 | 17,007.7 | 16,599.0 | 188.9 | 214.3 | 0.0 | **400.1** |
| `a0f9c1fb` | 88 | 1,365.1 | 1,342.0 | 0.2 | 11.9 | 8.3 | 32.1 |
| `30712828` | 17 | 812.4 | 744.0 | 50.9 | 9.5 | 145.0 | 19.1 |
| `72957d9c` | 11 | 754.9 | 521.3 | 215.8 | 9.9 | 440.0 | 17.8 |
| `20fa209c` | 11 | 599.5 | 518.2 | 62.8 | 10.5 | 600.4 | 14.1 |
| `48a1b01d` | 11 | 598.6 | 522.0 | 56.5 | 14.0 | 251.8 | 14.1 |
| `a64dcd45` | 11 | 596.5 | 522.5 | 54.1 | 10.6 | 215.8 | 14.0 |
| `8e6519b5` | 11 | 594.9 | 520.1 | 61.3 | 7.4 | 235.2 | 14.0 |
| `86031662` | 11 | 594.6 | 522.5 | 59.2 | 7.4 | 188.2 | 14.0 |
| `e9fc193b` | 11 | 583.3 | 520.8 | 46.1 | 9.1 | 262.9 | 13.7 |
| `0b53ef50` | 11 | 578.2 | 524.4 | 41.8 | 6.6 | 168.8 | 13.6 |
| `d18b6027` | 11 | 572.0 | 523.5 | 33.9 | 8.2 | 199.2 | 13.4 |

¹ `evlog_rows_per_day × 30.4375 × 773 B ÷ 1024²`, using the measured 773 B/row
(table + index) for `event_log`. Excludes `live_session_samples`.

### Storage

| table | total_size | table_size | index_size | rows_estimate | notes |
|---|---:|---:|---:|---:|---|
| `events.event_log` | **264 MB** | 148 MB | 112 MB | 358,119 | 106 partitions; index = 76 % of heap |
| `events.idempotency_keys` | **147 MB** | 102 MB | 45 MB | 427,554 | **never purged — see below** |
| `charging.live_session_samples` | 69 MB | 32 MB | 38 MB | 340,698 | index > heap |
| `events.protocol_log` | 40 MB | 19 MB | 21 MB | 63,089 | 15 partitions, 7 days |
| `events.event_log_legacy` | 3.4 MB | 1.5 MB | 1.8 MB | 5,433 | frozen |
| `charging.imported_cdr_refs` | 3.0 MB | 2.5 MB | 0.3 MB | 1,631 | |
| `charging.meter_values` | 1.7 MB | **0 bytes** | 1.7 MB | **0** | 106 empty partitions, index-only overhead |
| `charging.sessions` | 976 kB | 488 kB | 448 kB | 1,643 | |
| `reports.session_ledger` | 792 kB | 328 kB | 424 kB | 1,581 | |

Project synthetic storage: **942 MB**. The four tables above are ~520 MB of it,
and **`event_log` + `idempotency_keys` alone are 411 MB — 44 %**.

Measured bytes per row, total including indexes:

| table | B/row |
|---|---:|
| `event_log` | **773** |
| `protocol_log` | 665 |
| `idempotency_keys` | 360 |
| `live_session_samples` | 212 |

### The retention table that could dominate cost

`events.idempotency_keys` — 439,420 rows, **147 MB**, second-largest object in
the database:

| Metric | Value |
|---|---:|
| Rows | 439,420 |
| **Already expired** | **360,443 (82.0 %)** |
| Oldest `expires_at` | **2026-05-10** — three months past |
| Distinct scopes | 1 |

The `expires_at` column is populated and honoured on read, but **nothing ever
deletes expired rows**. This is a dedupe cache for the OCPP event pipeline, not
durable data. Purging expired rows would reclaim roughly **120 MB — about 13 %
of total project storage** — immediately, and it grows without bound at the
current rate.

`charging.meter_values` is the inverse problem: **106 daily partitions carrying
1.7 MB of indexes over 0 rows**, plus a cron creating +7 forward partitions every
five minutes. The partition machinery runs in full for a table nothing writes to;
energy telemetry goes to `live_session_samples` instead.

## Phase 4 — Durable Object cost risk

| Question | Finding | Evidence | Cost implication |
|---|---|---|---|
| DO granularity | **One per OCPP identity (charger)** | `index.ts:113`, `:145` `IDENTITY_DO.idFromName(identityId)`; `wrangler.jsonc:8` | Not per connector, not global. In this 1:1 fleet it is also per connector; on multi-connector hardware it is cheaper than per-connector |
| Hibernation | **Yes — Hibernation API** | `identity-do.ts:404` `this.state.acceptWebSocket(serverWs)` | **The main cost risk is already avoided.** No billable wall-clock between frames |
| In-memory state | **Deliberately none** | `identity-do.ts:141-150`, `:56-65` | Authorize verdicts and inflight commands live in `state.storage` precisely *because* the DO is evicted between frames |
| Alarms | **Only while commands are inflight** | `identity-do.ts:502` `alarm()`, `:575` `deleteAlarm()` | No periodic wake-up. Comment is explicit: "drop the alarm so a hibernating DO isn't woken for an empty sweep" |
| `setWebSocketAutoResponse` | **Not used** | absent from `identity-do.ts` | Every heartbeat wakes the DO → ~95 % of all DO invocations. See caveat below |
| DO storage contents | meta, `authz:` verdicts, `cmd:<uniqueId>` inflight commands | `identity-do.ts:56-65`, `:246` | Small and bounded; not message history |
| Message history | **Not** in DO storage | `ingest-client.ts` `enqueueOrPost` | Goes to queue or Postgres |
| Registry DO | **None** | one binding only, `wrangler.jsonc:9-16` | No fan-in hot object |
| Outbound commands | Postgres + DO storage, correlated | `ocpp.outbound_commands`, `cmd:` prefix | 48 rows total — negligible |
| Queue | **staging only** | `wrangler.jsonc:74-81` under `env.staging`; absent from top level | **See below** |
| Observability | `enabled: true` | `wrangler.jsonc:43-45` | Workers Logs on for every frame — a real cost driver at 95 % heartbeats |

**Verdict: the DO design is the good case, not the bad one.** Hibernation is
used, nothing is held in memory, alarms are dropped when idle, and there is no
registry object. Cost scales with *message rate*, not charger count — which is
exactly what the architecture set out to do.

Two caveats:

**1. Production appears to have no queue binding.** `OCPP_EVENTS_QUEUE` is
declared only under `env.staging` in `wrangler.jsonc`; the top-level (production)
config has no `queues` block. `auth.ts:28-34` types it optional and
`ingest-client.ts` falls back to a direct service-binding `postEvent`. If that
top-level config is what production runs, **every OCPP frame becomes a
synchronous Worker-to-Worker request to `hlada-api`** rather than a batched queue
delivery — roughly 44k extra Worker invocations per connector per month at a 60 s
heartbeat, and it couples charger liveness to API Worker availability. *Worth
confirming against the deployed config; this is read from source, not from
Cloudflare.*

**2. `setWebSocketAutoResponse` cannot fix the heartbeat wake-ups.** It is the
obvious lever — Cloudflare can answer a ping without waking the DO — but it only
supports a **static** response, and an OCPP `Heartbeat` reply must carry
`currentTime`. The real lever is the heartbeat *interval*, which is
server-controlled via the `BootNotification` response.

## Phase 5 — Cost model inputs

Formulas only. No pricing is asserted — official rates were not available
locally, and guessing them would make the whole table untrustworthy.

```text
messages_per_month        = messages_per_day × 30.4375
do_duration_gb_seconds    = active_non_hibernated_seconds × 0.125
db_mb_per_month           = rows_per_month × bytes_per_row ÷ 1024²
```

Basis: **60 s heartbeat = 1,440 HB/day**, plus the observed non-heartbeat mix
(~90/day/connector) → **1,530 frames/day/connector = 46,570/month**. Median
observed connector (165 s heartbeat) is 594/day = 18,080/month.

| Scenario | CF Worker req/mo/conn | DO req/mo/conn | DO active sec/mo/conn | Queue ops/mo/conn | DB MB/mo/conn | Cost-risk note |
|---|---:|---:|---:|---:|---:|---|
| **1. Good — hibernating DO, durable data in PG, compact logs** *(what is built)* | 46,570 | 46,570 | **~233** (46,570 × ~5 ms) | 46,570 | **34.3** | Duration ≈ **29 GB-s**. Cost is linear in message rate |
| **1b. Same, observed median connector** | 18,080 | 18,080 | ~90 | 18,080 | 13.3 | The realistic per-connector figure today |
| **1c. Same, heartbeats dropped from the log** | 46,570 | 46,570 | ~233 | 46,570 | **1.7** | **20× less storage.** Frames still arrive; only persistence changes |
| **2. Bad — always-hot DO per charger** | 46,570 | 46,570 | **2,629,800** | 46,570 | 34.3 | **328,725 GB-s** — ~11,300× scenario 1. This is the failure mode, and it is avoided |
| **3. Worst — always-hot per connector + verbose logs** | 46,570 | 46,570 | 2,629,800 × connectors-per-charger | 46,570 | 34.3 + log volume | Adds one log line per frame ≈ 46,570 log events/mo/conn |
| **4. Observed outlier `517f927c`** | 518,000 | 518,000 | ~2,590 | 518,000 | **400** | One charger ≈ **11× a normal one**. Uncapped, this is the real budget risk |

### What actually moves the bill

1. **Heartbeat interval.** It is server-controlled in the `BootNotification`
   response. Moving 60 s → 300 s cuts frames per connector by **80 %**, and with
   them DO requests, Worker requests, queue ops, log lines and rows. Nothing else
   on this list comes close.
2. **Stop persisting heartbeats.** They are 94.9 % of rows and are already
   classified `raw_protocol` (the shortest-retention tier) at
   `identity-do.ts:238`. The derived downtime period is the artefact worth
   keeping, not 43,830 rows per connector per month saying "still here".
3. **Purge `idempotency_keys`.** ~120 MB reclaimable now, unbounded growth
   otherwise.
4. **Cap per-connector ingest.** One charger produced 32.8 % of all rows.
5. **Drop the empty `meter_values` partition set** or start using it — 106
   partitions and a 5-minute cron currently maintain a table with no rows.

### Confidence

- **High:** row counts, table sizes, message mix, DO design — all directly
  measured or read from source.
- **Medium:** per-connector monthly projections — short observation windows
  (7–17 days for most connectors) and simulator traffic inflate session rates.
- **Low / unverified:** the production queue binding (read from source, not from
  the deployed Cloudflare config); the ~5 ms per-frame DO execution estimate,
  which is assumed, not measured. Both should be confirmed before the numbers
  are used in a commercial model.
