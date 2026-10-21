# Scale and isolation under the beta/production topology

**Analysis only. No load test was run and no capacity is claimed as measured.**

Reconciles the existing 1k/4k/5k capacity model — which modelled *one* estate —
against a topology with two.

> **Not linked:** `docs/notes/2026-08-09-connector-capacity-model.md` lives on
> branch `docs/remediation-architecture-packet` (`fabc56f`) and is not in this
> branch's tree. Its figures are quoted here with that provenance.

## What changes when there are two estates

The model's arithmetic is unaffected: connectors are connectors. What changes is
**what shares a failure domain**.

| Resource | Today (one estate) | Target (two estates) |
|---|---|---|
| Web/API Workers | shared | separate names, separate versions |
| OCPP gateway | one | **beta keeps `straumvakt-ocpp-staging`; production gets `straumvakt-ocpp`** |
| Durable Objects | one `IDENTITY_DO` namespace | separate per Worker — **state does not migrate** |
| Queues + DLQs | shared | separate names |
| Database | one Neon branch | **separate Neon project** |
| Hyperdrive | one config, shared by web + API | one per environment |
| R2 evidence | one bucket | separate buckets |

**The single most valuable isolation property** is that a beta load test can no
longer consume production's queue consumers, Hyperdrive connections or database
capacity — because today it would, and that is what makes the current estate
untestable at scale.

## Reconnect storms during Worker cutover

The capacity model puts a 5k reconnect burst at **~83 connects/s** over a 60 s
window. Two cutover-specific observations:

1. **Renaming the OCPP Worker deliberately causes that storm.** Severing every
   charger WebSocket at once is exactly the S3 scenario — self-inflicted rather
   than caused by an outage. This is the quantitative argument behind
   "do not rename the beta OCPP Worker".
2. **A web or API cutover causes no storm at all.** Chargers do not connect to
   either. The customer-visible cutover is, from the OCPP fleet's perspective, a
   non-event.

`IDENTITY_DO` state does not transfer between Workers. A new gateway starts with
empty Durable Objects, so per-charger state is rebuilt from reconnection — which
is survivable for identity but **not** for a transaction in flight.

**Recommendation:** any OCPP cutover happens in a low-traffic window with **zero
sessions in progress**, verified immediately beforehand — not merely assumed from
the hour.

## Queue backlog and isolation

| Property | Consequence |
|---|---|
| Separate queues per environment | A beta backlog cannot delay production settlement |
| Separate DLQs | A poison message in beta cannot mask a production one |
| Separate consumers | Beta catch-up cannot starve production ingest |

Without separation, the degraded-consumer scenario (~118,200 queued messages
after an hour at half throughput) would be a **shared** backlog. With two
estates, beta can be deliberately degraded to test E4/E6 — which is the only way
those experiments are safe to run at all.

## Hyperdrive and Neon limits

The model's predicted 4k bottleneck is **database connection concurrency**:
Workers mint a client per request and `drizzle.ts` sets `Pool max: 1`, with
Hyperdrive pooling in front.

Two estates change this in two directions:

- **Better:** production's connection budget is no longer shared with beta
  experiments.
- **Worse:** two Hyperdrive configurations and two Neon computes means the
  *aggregate* cost and connection footprint roughly doubles at idle.

**Unknown:** the actual Hyperdrive connection ceiling. It is not in source and
cannot be established without the control plane. It remains the least-understood
number in the model, and E7 exists to measure it.

## Observability under two estates

| Requirement | Why |
|---|---|
| Every dashboard, alert and log query is **environment-scoped** | An alert that does not say which estate fired is worse than no alert during an incident |
| Beta alerts route to engineering; production alerts **page** | Otherwise beta noise trains people to ignore the channel |
| Worker version id in every deploy record, both estates | The rollback target; **no such record exists today** |
| Neon branch id in every operational query | The default-branch trap is silent |

## Load-test environment requirements

**A load test must not be able to reach beta or production customer data.**
Beta is *not* a safe load-test target — it will contain test organisations doing
real hardware charging, and a load test would corrupt those results and could
disrupt real chargers.

Required properties of a load-test estate:

| # | Requirement |
|---|---|
| L1 | Its **own** Workers, on workers.dev only, **no custom domain** |
| L2 | Its **own** Neon branch, created fresh and deleted afterwards — never `staging`, never `production`, never the project default |
| L3 | Its **own** queues, DLQs and R2 bucket |
| L4 | Synthetic charger identities in a reserved serial range so a fixture cannot collide with a real charger |
| L5 | **No production or beta secret value** present in the environment |
| L6 | A hard abort if any write targets a real `orgId` |
| L7 | Cost ceiling agreed before any run that spins compute |
| L8 | Torn down completely afterwards; teardown verified, not assumed |

**L2 deserves emphasis.** The project default branch is the abandoned
`production` branch, so a load-test harness that omits a branch id writes
thousands of synthetic rows into it. That is the single most likely way a load
test causes lasting damage, and it is one missing parameter away at all times.

## Scale conclusions under the target topology

| Finding | Class |
|---|---|
| Steady-state ingest (26–45 events/s at 4–5k) is unremarkable | assumption-derived |
| Connection **churn**, not connection count, is the load — heartbeat interval swings ingest 2.97× | assumption-derived |
| Environment separation makes E1–E11 **safe to run for the first time** | design consequence |
| An OCPP rename is a self-inflicted reconnect storm | design consequence |
| Web/API cutover is invisible to the charger fleet | design consequence |
| Hyperdrive ceiling remains **unknown** | blocked |

**No capacity is proven.** The topology makes it *possible* to prove capacity
without endangering customers, which is the actual prerequisite that has been
missing.
