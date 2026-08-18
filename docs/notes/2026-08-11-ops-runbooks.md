# Ops runbooks — OCPP gateway

Three runbooks and an incident taxonomy. Each runbook says up front
**what you can actually do today**, because several of these depend on
signals that do not exist yet, and a runbook that assumes a dashboard
you do not have is worse than none.

---

## Incident taxonomy — OCPP gateway failures

| Class | Symptom | Usual cause | Blast radius | Recovery |
|---|---|---|---|---|
| **G1 · Socket refused** | charger cannot connect | auth failure, pinned host gone, Worker down | per charger → whole fleet | minutes if host; hours if device config |
| **G2 · Socket accepted, no CallResult** | charger connects then times out | DO exception, storage failure, fast path broken | per charger | redeploy / rollback |
| **G3 · Protocol parse error** | frame rejected | firmware sending an untriaged frame type | per model | triage, then support the frame |
| **G4 · Ingest failure** | frames answered, nothing persisted | queue absent, consumer failing, Neon down | whole fleet, silent | **this is the dangerous one** |
| **G5 · Noisy charger** | one identity floods | firmware loop, reconnect storm | estate cost | cap sheds; contain the unit |
| **G6 · Silent charger** | no frames at all | device dead, site network | per charger, invisible | needs a sweeper |
| **G7 · Liveness false positive** | charger marked offline while working | interval drift, clock skew | per charger | check advertised interval |
| **G8 · Billing gap** | sessions missing from an invoice | G4 upstream, or job never ran | per customer, per month | reconcile from raw |

**G4 and G6 are the two that do not announce themselves.** Everything
else has a complaining charger or a complaining driver. These two look
exactly like a quiet night.

G4 is live today in the top-level environment by construction: no queue
producer, no consumer, no DLQ, so a failed `postEvent` is a
`console.warn` and a lost event.

---

## Runbook 1 · Noisy charger containment

**Trigger.** `frame_cap.breached` in logs, or `noisy_charger_events`
once the binding exists, or an unexplained rise in queue ops.

**What is automatic.** The frame cap admits 120 frames/hour/connector,
sheds the rest from ingest, and **keeps answering the protocol**. Three
consecutive breached windows raises an anomaly. Billing-material
actions — `StartTransaction`, `StopTransaction`, `MeterValues`,
`Authorize`, `BootNotification` — are **never shed**. A noisy charger
therefore costs DO wakeups but not queue, consumer or Neon volume.

**Steps.**

1. **Confirm the cap is working.** Frames stay high; queue ops flat.
   If queue ops rose with frames, the cap regressed — check OB5.
2. **Identify the unit.** Logs carry the identity; metrics carry the
   pseudonymised `cid_…`. Map it with `pseudonymiseIdentity(id, salt)`
   locally — never store the mapping in a dashboard.
3. **Classify.** Reconnect storm (repeated BootNotification), status
   flapping (StatusNotification), or a MeterValues loop. The third is
   the expensive one because those frames are cap-exempt.
4. **Contain.** Contact the site. Do **not** blackhole the charger —
   a charger that cannot connect cannot be diagnosed or updated.
5. **If MeterValues is the flood**, the cap will not save you. Raise
   it with the vendor; the sampling interval is device-side.

**Do not** simulate a reconnect storm against production to reproduce.
Use a local gateway with a virtual CP (M-9).

**Today:** steps 1–3 work from logs alone. Step 1's queue comparison
needs the Analytics binding.

---

## Runbook 2 · Missed heartbeat / offline detection

> **Read this first: offline detection does not work today.**
>
> Liveness transitions are computed only inside `handleInboundCall`.
> Nothing runs when nothing arrives, so a charger that goes silent is
> discovered on its *next* frame — which, for a dead charger, never
> comes. The DO `alarm()` exists but is the outbound-command timeout
> sweep. Gate OB18 fails on this deliberately.

**What this means operationally.** Today you find out a charger is dead
when a driver tells you. There is no runbook step that changes that,
which is why the fix is listed as engineering work rather than an
ops procedure.

**The fix, when it is built.** A DO alarm armed to
`lastFrameAt + offlineAfterMissedIntervals × idleHeartbeatIntervalMs`
(3 × 3600 s today). On fire: emit `missed_heartbeats`, write the
offline transition, re-arm. Cost is one alarm per connector per idle
window — small, and it is the only way the count can ever be right.

**Steps, once it exists.**

1. Confirm the scope: one charger, one site, or the fleet. Fleet-wide
   silence is a gateway or DNS problem, not a charger problem — check
   G1 before anything else.
2. Check the advertised interval. A charger honouring 3600 s that is
   judged against a 60 s window looks dead and is not (G7).
3. Check the site's other connectors; a shared uplink fails together.
4. Only then treat it as a device fault.

**False-positive guard.** Never page per connector. Group by site, and
require > 5 % of a site within 15 minutes (alert A1).

---

## Runbook 3 · Billing / report job failure

> **Read this first: there is no scheduler.** No Workflow and no cron
> trigger exists in any config (gate OB21). A billing job cannot fail
> because nothing runs it. "Workflows optional" was a decision about
> Workflows; the absence of *any* scheduler is an omission that looked
> identical in the config file.

**Severity.** Always **S1**. **Never auto-retry a billing invariant
failure.** A wrong invoice is worse than a late one, and a retry over a
partially-written period can double-count.

**Steps, once a job exists.**

1. **Stop.** Do not re-run. Establish what was written before you
   change anything.
2. **Scope by period and org.** `billing_job_started` without a
   matching `billing_job_completed` identifies the run; the period key
   identifies the blast radius.
3. **Reconcile from raw.** Session records are the truth; the statement
   is derived. If sessions are intact, the statement can be rebuilt. If
   sessions are missing, this is a **G4** incident and billing is the
   symptom, not the cause.
4. **Check the money unit.** Aurar on the wire throughout; the web
   client divides, Flutter does not. A factor-of-100 error looks like a
   pricing bug and is not.
5. **Re-run only when idempotence is proven for that period.**
6. **Tell the customer before they find it.** A corrected invoice sent
   proactively is a support ticket; one found by the customer is a
   trust problem.

**Recovery bound.** Neon PITR is believed to be 7 days and there are no
backup branches. A billing error discovered on day 8 cannot be
reconstructed from a restore — only from whatever the raw session
records still hold. That is the real deadline on this runbook.
