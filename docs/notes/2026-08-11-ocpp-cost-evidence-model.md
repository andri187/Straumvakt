# OCPP cost evidence model

Reproduce with `node scripts/analysis/observability/cost-model.mjs --md`;
machine-readable evidence in `2026-08-11-cost-model-evidence.json`.

## What this model refuses to do

**It quotes no kr figures.** Cloudflare unit prices are not knowable
from this tree, and a plausible-looking wrong number is worse than an
honest formula — it gets quoted in a pricing conversation and nobody
re-derives it. Every monetary term is a named placeholder:

```
cost = frames·P_DO_REQ
     + doStorageWrites·P_DO_WRITE
     + queueOps·P_QUEUE_OP
     + consumerInvocations·P_CONSUMER
     + dbRows·P_NEON_ROW
     + metricPoints·P_AE_POINT
```

What the model is *for* is **sensitivity and multipliers**, and those
need no prices at all.

Rows marked **TBD** use guessed intervals standing in for measurement
M-3, which does not exist. They are flagged in the table and in the
JSON so no downstream reader mistakes a placeholder for evidence. Gate
OC6 fails any profile that records an active-session interval without a
measured source.

## Three corrections to how this has been described before

**1. The fast path does not remove DO cost.** Every inbound frame wakes
the Durable Object. The fast path reduces what happens *after* the
wake — no queue op, no ingest, no row — but the wakeup and one storage
write are paid regardless. Any statement of the form "heartbeats are
now free" is wrong; they are now *cheap*, which is a different claim.
The `DO wakeups` column exists to keep that honest.

**2. The frame cap does not reduce frames.** It sheds *ingest* while
still answering the protocol, because a charger that stops getting
CallResults stops charging cars. So a noisy connector's frame and DO
columns are unchanged and only its queue/DB columns are clamped. That
asymmetry is the entire design.

**3. Heartbeats produce two metric points, not zero.**
`heartbeats_received` and `heartbeats_suppressed` are both written per
heartbeat once the binding exists — that pair is the only thing that
would reveal a fast-path regression in production. Observability is not
free either, and at 20,000 connectors it is the largest single row in
the idle model.

## Headline numbers

| | |
|---|---|
| Idle frames / connector / month @ 3600 s | **720** |
| Idle frames / connector / month @ 60 s | **43,200** |
| Multiplier | **60x** |
| Queue ops avoided / connector / month by the fast path | **720** |
| Noisy connector, 1 frame/s, one month — frames | **2,592,000** |
| …of which reach the queue after the cap | **86,400** (96.7 % shed) |
| 20,000 connectors, idle, monthly frames @ 3600 s | **14,400,000** |
| 20,000 connectors, idle, monthly frames @ 60 s | **864,000,000** |

The last pair is the argument for OB23 existing at all. A single
literal that nobody re-read moves an idle fleet from 14 million frames
a month to 864 million, and no test failed when it was wrong.

## Scenarios

| Scenario | Interval | Duration | Frames | DO wakeups | DO writes | Queue ops | Consumer | DB rows | Rows avoided | Metric pts | Storage class | Controlled by | Gate | TBD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Idle connector, 3600 s heartbeat (product frame) | 3600s | 2,592,000s | 720 | 720 | 720 | 0 | 0 | 0 | 720 | 1,440 | liveness only | `PRODUCT_HEARTBEAT_INTERVAL_SECONDS / idleHeartbeatIntervalMs` | OB6, OB7, OC5 | no |
| Idle connector, 60 s heartbeat (the pre-fix defect) | 60s | 2,592,000s | 43,200 | 43,200 | 43,200 | 0 | 0 | 0 | 43,200 | 86,400 | liveness only | `literal interval in stubResponseFor — now derived` | OB6, OB23 (reports the multiplier) | no |
| Noisy connector, 1 frame/s, 1 hour | 1s | 3,600s | 3,600 | 3,600 | 3,600 | 120 | 120 | 120 | 3,480 | 3,600 | event | `DEFAULT_FRAME_CAP (120/hour, then shed)` | OB5, OB25, OC10 | no |
| Noisy connector, 1 frame/s, 1 day | 1s | 86,400s | 86,400 | 86,400 | 86,400 | 2,880 | 2,880 | 2,880 | 83,520 | 86,400 | event | `DEFAULT_FRAME_CAP + quarantine` | OB5, OB25, OC10 | no |
| Noisy connector, 1 frame/s, 1 month | 1s | 2,592,000s | 2,592,000 | 2,592,000 | 2,592,000 | 86,400 | 86,400 | 86,400 | 2,505,600 | 2,592,000 | event | `DEFAULT_FRAME_CAP + quarantine` | OB5, OB25, OC10 | no |
| Active session — startup burst, 1 s for 5 min | 1s | 300s | 300 | 300 | 300 | 10 | 10 | 10 | 290 | 300 | billing material | `charger firmware — not settable from here` | OC6 refuses a fabricated interval | **yes** |
| Active session — settling, 10 s for 10 min | 10s | 600s | 60 | 60 | 60 | 20 | 20 | 20 | 40 | 60 | billing material | `charger firmware` | OC6 | **yes** |
| Active session — steady, 120 s for 4 h | 120s | 14,400s | 120 | 120 | 120 | 120 | 120 | 120 | 0 | 120 | billing material | `charger firmware / OCPP MeterValueSampleInterval` | OC6 | **yes** |
| Connected but idle, 240 s for 8 h | 240s | 28,800s | 120 | 120 | 120 | 120 | 120 | 120 | 0 | 120 | billing material | `charger firmware` | OC6 | **yes** |

### Fleet scaling — monthly idle path only (3600 s heartbeat)

| Connectors | Frames/mo | DO wakeups/mo | Queue ops/mo | DB rows/mo | Metric points/mo |
|---|---|---|---|---|---|
| 1 | 720 | 720 | 0 | 0 | 1,440 |
| 50 | 36,000 | 36,000 | 0 | 0 | 72,000 |
| 500 | 360,000 | 360,000 | 0 | 0 | 720,000 |
| 1,000 | 720,000 | 720,000 | 0 | 0 | 1,440,000 |
| 20,000 | 14,400,000 | 14,400,000 | 0 | 0 | 28,800,000 |

### The same fleets at the 60 s defect

| Connectors | Frames/mo | DO wakeups/mo | Δ vs 3600 s |
|---|---|---|---|
| 1 | 43,200 | 43,200 | **+42,480** |
| 50 | 2,160,000 | 2,160,000 | **+2,124,000** |
| 500 | 21,600,000 | 21,600,000 | **+21,240,000** |
| 1,000 | 43,200,000 | 43,200,000 | **+42,480,000** |
| 20,000 | 864,000,000 | 864,000,000 | **+849,600,000** |

## Sensitivity — what actually moves the bill

Ranked by how much a wrong assumption costs, not by size:

| Rank | Term | Known? | Controlled by | Detected by |
|---|---|---|---|---|
| 1 | **Active-session `MeterValues` interval** | **NO — M-3** | charger firmware, not settable from here | OC6 refuses a fabricated value |
| 2 | Idle heartbeat interval | yes, 3600 s | derived from liveness config | OB6, OB7, OB23 |
| 3 | Noisy-charger frames | bounded by cap | `DEFAULT_FRAME_CAP` | OB5, OB25, OC10 |
| 4 | Queue ops per meaningful event | yes, 1:1 | `enqueueOrPost` | OB16, OB17, OC1 |
| 5 | DO storage writes | 1 per frame | shared `OPS_STATE_KEY` | none — **unowned** |
| 6 | Metric points | 2 per heartbeat | `metrics.ts` | none — **unowned** |
| 7 | Neon rows | tracks sessions | ingest consumer | none — **unowned** |

**Terms 5, 6 and 7 have no checker.** That is the honest state of
"every cost-sensitive term has an owner", and it is why claim 20 in the
census is refuted rather than qualified.

Term 1 dominates everything below it. A 4-hour charge at a 30-second
sample interval is 480 frames — two-thirds of a connector's entire idle
*year* — and the interval is a property of the hardware that no amount
of local analysis can settle.

## What the fast path is worth, stated precisely

Per connector per month, at the product frame:

- **720 queue operations avoided**
- **720 consumer invocations avoided**
- **720 Neon rows avoided**
- 720 DO wakeups and 720 DO storage writes **still paid**

At 1,000 connectors that is 720,000 queue ops a month that do not
happen. At 20,000 it is 14.4 million. The saving is real and large; it
is simply not total, and the columns say which is which.

## Where this model is weakest

1. **The active-session rows are guesses.** Four scenarios, all TBD.
2. **Consumer invocations are modelled 1:1 with queue messages.**
   Cloudflare batches; the real number is lower by a factor this model
   cannot know. Treated as an upper bound, deliberately.
3. **No Neon storage growth term.** Rows are counted, bytes are not.
4. **Reconnect storms are not modelled.** M-9, and it needs hardware.
5. **The 30-day month** is a modelling convention, not a calendar.
