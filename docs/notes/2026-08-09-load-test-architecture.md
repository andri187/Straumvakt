# Load-test architecture

**Specifications only. No load test was run and no capacity is claimed.**
Every figure inherited from the capacity model is an assumption, not a
measurement.

## Isolation — the part that must be right before anything else

**A load test must be structurally incapable of reaching beta, production, real
chargers, or a default Neon branch.** Not "careful"; incapable.

| # | Control | Mechanism | Failure it prevents |
|---|---|---|---|
| **I1** | Dedicated Workers | `straumvakt-web-lt`, `straumvakt-api-lt`, `straumvakt-ocpp-lt`; **no custom domain** | a load test answering a customer hostname |
| **I2** | Dedicated Neon branch | created fresh per run, deleted after; **branch id passed explicitly on every call** | writing into the abandoned default branch — the likeliest lasting damage |
| **I3** | Dedicated queues, DLQs, R2 | `*-lt` names | a load-test backlog delaying beta settlement |
| **I4** | Reserved synthetic serial range | `SYN-<seed>-<n>` | a fixture colliding with a real charger |
| **I5** | No beta/production secret present | separate KEK, separate `AUTH_SECRET` | a compromised harness reaching real data |
| **I6** | Hard abort on a real `orgId` | the generator refuses any org id not in the synthetic set | a write landing on a customer tenant |
| **I7** | Egress restriction | the harness may only address `*-lt` hostnames | a mistyped host hitting production |
| **I8** | Cost ceiling agreed before the run | — | an unbounded bill from a runaway generator |

**I2 deserves its own emphasis.** The Neon project default is the abandoned
`production` branch. A harness that omits a branch id writes thousands of
synthetic rows into it, silently, and the schema mismatch means it may half-fail
rather than fail cleanly.

## Deterministic seed strategy

```
seed          : a single integer, printed at start, embedded in every serial
PRNG          : xorshift128 — deterministic, no crypto RNG, no Math.random
serial        : SYN-<seed>-<zero-padded index>
org           : one synthetic org per 500 connectors, ids derived from the seed
session length: LogNormal(median 45 min), drawn from the same PRNG
jitter        : heartbeat ± U(0, 30 s), same PRNG
```

**Same seed ⇒ identical traffic.** Without this, a regression cannot be
distinguished from a different random draw, and every comparison between runs is
worthless.

## Traffic profiles

Derived from the capacity model's assumptions. **All values `[A]`.**

| Profile | Connectors | Heartbeat | Charging % | MeterValues/min | Starts/min | Purpose |
|---|---|---|---|---|---|---|
| `steady-1k` | 1,000 | 300 s | 10% | 1 | 2 | baseline |
| `steady-4k` | 4,000 | 300 s | 10% | 1 | 8 | target scale |
| `hot-4k` | 4,000 | 60 s | 25% | 4 | 8 | worst-case assumption set |
| `storm-5k` | 5,000 | 300 s | 10% | 1 | 0 | reconnect burst |
| `surge-5k` | 5,000 | 300 s | 25% | 1 | 40 | free-period boundary |
| `degraded-5k` | 5,000 | 300 s | 10% | 1 | 8 | consumer at 50% |

Event mix per connector-hour (base): 12 heartbeats, 6 status notifications, and
60 meter values **while charging**.

## Experiments — thresholds and aborts

| # | Experiment | Success `[T]` | **Abort immediately if** |
|---|---|---|---|
| E1 | Connection fan-out 500→5k | 5k held 10 min; p95 handshake < 2 s; errors < 0.1% | error rate > 5% at any step |
| **E2** | **Reconnect storm** (sever 5k, 60 s window) | 95% reconnected < 5 min; no DLQ growth; no loss | any message loss |
| E3 | Meter hot path (`hot-4k`) | ingest p95 < 5 s; `cpu_ms` < 40 of the 50 budget | `cpu_ms` ≥ 50 (hard limit) |
| E4 | Queue backpressure (consumer 50%, 1 h) | drains < 30 min; **no loss; no duplicate session rows** | duplicate session rows |
| E5 | Dead letters (1-in-10k malformed) | poison reaches DLQ; a valid message behind it is **not** blocked | head-of-line blocking |
| E6 | Consumer outage 15 min + catch-up | catch-up < 3× outage; **live lag stays < 30 s during catch-up** | live ingest starves |
| E7 | DB connection exhaustion ramp | supports `surge-5k` with 3× headroom | connection errors below target rate |
| E8 | Projection lag (10k sessions) | p95 session-end → cost < 10 min | > 30 min |
| E9 | Tariff surge (`surge-5k`) | p95 start acceptance < 10 s; no load-attributable rejection | rejections rise with load |
| E10 | Alert storm (20% of 5k faulted) | alerts deduplicate to incident level | unbounded per-connector fan-out |
| E11 | Reporting batch under `steady-4k` | live ingest degradation < 10% | ingest lag doubles |

**E2 runs first**, against the instinct to ramp gently: it has the least evidence
and the highest consequence, and a gentle ramp that passes tells you little you
did not already assume.

## Logs and metrics to capture per run

| Field | Why |
|---|---|
| seed, commit SHA, Neon branch id, Worker version ids | **reproducibility — a run without these is an anecdote** |
| connects/s achieved (not requested) | the generator may be the bottleneck |
| ingest p50/p95/p99 | — |
| queue depth over time; DLQ count | — |
| `cpu_ms` distribution per Worker | the 50 ms limit is hard |
| DB connection count and error class at the knee | E7's whole purpose |
| projection lag | the driver-visible one |
| cost incurred | against the I8 ceiling |

## Post-test contamination checks — mandatory

Run **after every experiment**, not only at the end:

| # | Check | Expected |
|---|---|---|
| C1 | Any `SYN-` serial present in beta or production | **zero** |
| C2 | Synthetic org ids present outside the load-test branch | **zero** |
| C3 | Load-test Neon branch deleted | confirmed absent |
| C4 | `*-lt` Workers still have no custom domain | confirmed |
| C5 | Beta and production queue depths unaffected during the window | flat |
| C6 | Beta/production Worker version ids unchanged | unchanged |

**C6 catches the worst case:** a load test that accidentally deployed.

## Tooling

| Need | Choice | Note |
|---|---|---|
| OCPP 1.6J client simulation | custom Node harness | off-the-shelf load tools do not speak OCPP |
| HTTP surfaces | k6 or Artillery | **not** for the WebSocket path |
| Metrics | Workers analytics + queue depth + Neon metrics | already available |
| Orchestration | a single script that prints the seed and refuses to start without a branch id | I2 enforced in code, not in a checklist |

## What these tests cannot establish

- Real charger firmware behaviour under reconnect — synthetic clients are
  well-behaved in ways hardware is not.
- Vendor API rate limits during mass onboarding.
- Whether the **deployed fleet's heartbeat interval** matches the assumption that
  dominates the model at a 2.97× swing. That is a fleet audit, not a load test —
  and it is cheaper than every experiment here.

**No capacity claim exists until an experiment produces a result with its seed,
commit and branch id recorded.**
