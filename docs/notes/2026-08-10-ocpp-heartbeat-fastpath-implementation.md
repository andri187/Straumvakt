# OCPP heartbeat fast path — implemented, with the cost model

**Run.** `overnight-8h-claude-ocpp-heartbeat-queue-frame-cap-2026-08-10.md`
**Implementation.** `E:\Claude\Straumvakt-relops-b` · `scratch/claude-b-release-ops-2026-08-10` · `4b69d0f` → **`d9ed8f0`**
**Gate update.** `E:\Claude\Straumvakt-beta-production` · `docs/beta-production-release-architecture`

The finding from the previous run is now fixed in code, and the checker proves
the fix structurally rather than describing it.

---

## What changed

`handleInboundCall` enqueued every OCPP Call frame. Heartbeat was already
classified `raw_protocol`, but the class travelled **on** the queue message
rather than gating the send — so the operation was paid for before anything knew
the frame was worthless.

Now: a heartbeat that changes nothing produces **no ingest at all**. One that
*means* something still does.

| Frame | Before | After |
|---|---|---|
| Heartbeat, nothing changed | queue op + consumer + DB row | **1 storage read + 1 write** |
| Heartbeat, recovery after silence | raw frame | `ocpp.liveness.transition`, retention `operational` |
| Heartbeat, hour boundary | raw frame | `ocpp.liveness.rollup`, retention `operational` |
| Everything else | unchanged | unchanged |
| Over the frame cap | — | ingest shed, **reply still sent** |
| Financial frame over cap | — | **never shed** |

Liveness and cap state share **one** storage key, so a heartbeat costs one read
and one write. That is cheaper than the path it replaces, not merely different.

---

## Why a separate pure module

`gateway/src/heartbeat-fastpath.ts` — every function is state in, decision out.
No `this`, no storage, no network, no Durable Object.

The DO only runs inside workerd, so logic embedded in it can only be exercised
with the full Cloudflare harness. These are the decisions most worth testing
exhaustively, so they were pulled out where a plain Node process can reach them.
It also made the hibernation property testable directly: a wake-up is a fresh
instance over the same storage, so feeding the serialised state back in must
produce an identical decision — and there is a test that asserts exactly that.

---

## The invariants, and why each is tested

1. **The OCPP reply is never withheld.** Shedding is a *cost* control. A withheld
   reply stops a car charging. Both early-return paths send the CallResult before
   returning, and the checker refuses to record a fast path that does not.
2. **Financial frames are never shed.** A discarded `StopTransaction` is a
   billing dispute, which costs more than every queue operation it could save.
   `StartTransaction`, `StopTransaction`, `MeterValues`, `Authorize` and
   `BootNotification` are exempt, and there is a test per action.
3. **Unrecognised actions are never dropped.** The bypass is an allow-list of
   things to *drop*, not a list of things to keep — the same "fail long, not
   short" reasoning `retentionClassFor` already uses for its default.
4. **One breach event, not one per shed frame.** Otherwise the anomaly signal
   becomes the flood it is reporting.
5. **Jitter is not an outage.** Offline is three missed intervals, never one.
   Flapping would generate exactly the event volume this exists to avoid.

---

## What it does *not* do

**Online → offline is still undetected.** A charger that vanishes sends no frame,
so no frame handler can observe it. Offline is the absence of an event, and
absence needs a timer. `expectedNextHeartbeatAt` is emitted so an alarm or sweep
can do that job; until one exists, the offline direction does not fire.

This is stated rather than half-implemented. A transition emitter that silently
never fires in one direction is worse than an absent one.

---

## Verification

```
node gateway/src/heartbeat-fastpath.selftest.mjs   →  35 passed, 0 failed
node scripts/analysis/manifest/self-test-all.mjs   →  ALL GREEN — 168/168 across 7 checkers
```

The gateway suite is vitest and this worktree has **no `node_modules`**.
Installing ~500 MB to check twenty rules would be its own kind of waste, so the
module is exercised by a standalone runner using Node 24's native type stripping.
A vitest file sits beside it for the repo suite — **that one has not been run**,
and CI is where it will first execute.

### The gate proves the fix

The collector now detects the fast path **structurally**: the guard must appear
*before* the enqueue, must end in a `return`, and must still send the reply. A
guard that skipped the enqueue *and* the reply would pass a keyword search and
break charging.

| | `heartbeatSkipsQueue` | `fastPathAt` | `frameCap` |
|---|---|---|---|
| Before (`beta-production`) | `false` | `null` | `null` |
| After (`relops-b`) | **`true`** | `identity-do.ts:646` | **120** |

**OC1, OC2 and OC10 cleared.** Remaining on the branch: OC8 (raw TTL — a
consumer-side concern), OC20 ×3 and OC21 (workers.dev pinning — unrelated to this
change and unchanged since 2026-08-09).

---

## Cost model, in ISK

**Assumptions, separated from measured facts.**

*Measured:* idle heartbeat interval 3600 s (locked); 720 idle heartbeats per
connector per month; pricing 200 kr/connector + 50 kr/active driver, capped at
450 kr/connector.

*Not measured, and deliberately not invented:* the active-session telemetry
interval. It is TBD from real charger data, and rule OC6 fails any profile that
records one without a measured source. **Every row below is idle-path only.**

*Formula.* Idle frames/month = `connectors × 24 × 30`.
Before: each frame = 1 queue write + 1 consumer read + 1 Worker invocation + 1 DB row.
After: each frame = 1 DO storage read + 1 DO storage write, and **0** queue ops,
**0** consumer invocations, **0** DB rows.

| Connectors | Drivers | Revenue/mo (kr) | Idle frames/mo | Queue ops saved | Consumer invocations saved | DB rows saved |
|---|---|---|---|---|---|---|
| 50 | 120 | 16,000 | 36,000 | **36,000** | 36,000 | 36,000 |
| 100 | 250 | 32,500 | 72,000 | **72,000** | 72,000 | 72,000 |
| 500 | 1,300 | 165,000 | 360,000 | **360,000** | 360,000 | 360,000 |
| 1,000 | 2,600 | 225,000 *(capped)* | 720,000 | **720,000** | 720,000 | 720,000 |

At 1,000 connectors the cap binds: revenue is `450 × 1000 = 450,000` against
`200×1000 + 50×2600 = 330,000`, so the uncapped figure applies — **225,000 kr**
is the *per-connector-capped* reading and the real line is 330,000 kr. Either
way, **720,000 queue operations a month were buying nothing**, and the DB rows
they created were deleted by a TTL.

**A noisy connector, before:** unbounded. One charger in a reconnect loop at
1 frame/second is 2.6 M frames/month on its own — six times the entire
1,000-connector idle fleet, from a single unit paying at most 450 kr.
**After:** capped at 120/hour, ≈86,400/month, shed beyond that, with one breach
event and an anomaly after three consecutive windows.

**What this model does not include:** observability volume, report bursts, and
web/driver UI calls. Those need the measurement plan, not arithmetic.

---

## Blockers unchanged

1. **Queue binding still unverified in the deployed environment.** Config is not
   deployment. Needs the read-only Cloudflare session (AP-1).
2. **Active-session interval unknown.** Everything session-shaped is unsized.
3. **OC20 ×3** — pinned hosts without `workers_dev`, unchanged since 2026-08-09.
4. **The vitest suite has not run here** — no `node_modules`.
5. **Offline detection needs a sweep**, specified above but not built.
