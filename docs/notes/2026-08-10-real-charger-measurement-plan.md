# Real charger measurement plan — ZPR074002 / Zaptec / FEV300

**No hardware command is issued by this run.** This is what to measure when a
charger is next connected, and why each number matters.

The plan exists because one number sizes everything downstream and **nobody has
it**: frames per session-hour. Every cost model so far covers only the idle path
and says so.

---

## M-1 · Idle heartbeat proof

**Measure.** With no session active, the interval between consecutive
`Heartbeat` frames, over at least 6 hours.
**Expect.** 3600 s, locked by the product frame.
**Trouble.** Anything shorter — cost scales linearly with this number and nothing
else changed to justify it (gate OC5).
**How.** `[ocpp-gw]` log lines, or `heartbeats_received` once the binding exists.

## M-2 · BootNotification interval verification

**Measure.** The `interval` the gateway returns in its BootNotification reply,
and whether the charger honours it.
**Expect.** `stubResponseFor` currently returns **60**, not 3600.
**This is a live discrepancy.** A charger that obeys the BootNotification
interval would heartbeat **every 60 seconds** — 43,200 frames/connector/month
instead of 720, sixty times the modelled cost. Whether Zaptec honours it or uses
its own configured value is exactly what M-2 settles, and it is the highest-value
measurement in this plan.

## M-3 · Active-session telemetry interval

**Measure.** Interval between `MeterValues` during a real charge.
**Expect.** Unknown. Deliberately not guessed — gate OC6 fails any profile that
records one without a measured source.
**Why it dominates.** A 30-second interval over a 4-hour charge is 480 frames for
one session, comparable to two-thirds of a connector's entire idle year.

## M-4 · Message mix

**Measure.** Count by action over a full week: Heartbeat, StatusNotification,
MeterValues, Start/StopTransaction, Authorize, BootNotification, DataTransfer.
**Use.** Confirms which frames the fast path may drop and which must never be.

## M-5 · Queue operations

**Measure.** `queue_messages_by_type`; specifically the heartbeat share.
**Expect after the fast path merges.** Heartbeat share ≈ 0.
**Trouble.** Any heartbeat share at all means OC1 regressed in production even
though the static gate passes.

## M-6 · Neon writes

**Measure.** Rows/day by table; growth rate in MB/day.
**Expect.** Tracks *sessions*, not frames.
**Trouble.** Growth proportional to frames means raw persistence leaked back.

## M-7 · DO activity

**Measure.** Invocations and duration against concurrent socket count.
**Expect.** Duration flat while sockets are held — that is hibernation working.
**Trouble.** Duration rising with socket count means hibernation regressed, which
bills wall-clock for idle connections.

## M-8 · Sentry and Analytics events

**Measure.** Event volume per connector per day, and the scrub result on a real
payload containing an idTag.
**Gate.** No DSN goes live until a real payload is confirmed scrubbed. An idTag
identifies a driver.

## M-9 · Noisy charger simulation — constraints

**Do not** induce a reconnect storm against production. Simulate against a local
gateway with a virtual CP. The frame cap's behaviour is already proven offline
(35 assertions); this measures the *reconnect profile*, which is a property of
the hardware and cannot be derived from code.
**Measure.** Backoff, retry interval, and worst-case simultaneous reconnects
across the fleet — the figure that sizes the Neon connection ceiling.

## M-10 · Cost per connector in ISK

```
idle_frames_month      = 720                       (measured, M-1)
session_frames_month   = sessions × hours × rate   (rate UNKNOWN until M-3)
queue_ops              = meaningful events only    (heartbeats excluded after merge)
do_cost                = f(invocations, duration)  (M-7)
neon_cost              = f(rows/day, storage)      (M-6)
cost_per_connector_isk = queue + do + neon + analytics + sentry share

margin = 200 − cost_per_connector_isk              (450 cap binds at scale)
```

**Only the idle term is currently known.** Any cost-per-connector figure quoted
before M-3 is an idle-path figure and must be labelled as one.

---

## Sequence

M-1 and M-2 first — they need no session and M-2 may invalidate every existing
model. Then M-4 and M-5 over a week of ordinary use. M-3 on the first real
charge, alongside the independent hand-calculation of cost that the money-unit
contract still requires. M-7 and M-6 continuously. M-9 last, and never against
production.
