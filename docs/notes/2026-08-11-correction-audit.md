# Second-pass correction audit

Run against my own gates and my own prior notes, before committing.

---

## 1 · Assumptions corrected or narrowed

**1.1 — "`gateway/node_modules` is present, so the toolchain is back."**
`test -d` returned true and I reported dependencies as available. The
directory has **zero entries**. Dependencies are still absent; vitest,
typescript and wrangler are all missing locally. The correct check is
entry count, not existence. Everything in this run is therefore still
dependency-free by necessity, not by choice.

**1.2 — "A queue producer is declared, so the queue is configured."**
This was the shape of the previous run's gate OC16, and it passed. The
producer is declared **in staging only**. Top-level `straumvakt-ocpp`
has none, and `hlada-api` consumes nothing. Every per-binding question
in this estate has to be asked *per environment*; asked globally, the
answer is meaningless. OB16/OB17 now ask it correctly.

**1.3 — "The heartbeat fast path removes heartbeat cost."**
It removes the queue op, the consumer invocation and the Neon row. It
does **not** remove the DO wakeup or the storage write — every inbound
frame wakes the object regardless. My earlier framing ("720 queue ops →
0") was true but read as "heartbeats are free". The cost model now
carries `DO wakeups` and `DO writes` columns specifically so that
reading is unavailable.

**1.4 — "Observability is free."**
Two metric points per heartbeat once the binding exists
(`heartbeats_received` + `heartbeats_suppressed`). At 20,000 connectors
that is 28.8 M points/month on the idle path alone — the largest single
row in the idle model. Cheap per unit, not free, and previously
uncounted.

**1.5 — "Missed heartbeats create an event."**
The locked architecture says they do. The code does not. Liveness
transitions are computed only inside `handleInboundCall`, so a charger
that goes silent produces nothing — its offline state is discovered on
the next frame, which for a dead charger never arrives. I had read the
DO `alarm()` as covering this; it is the **outbound-command timeout
sweep**, a different mechanism for a different problem.

**1.6 — "`interval: 60` was a typo."**
Narrowed: it was a *second independent literal*. Correcting the digit
would have left the same drift class in place. The defect was the
duplication, which is why the fix is a derivation.

## 2 · Prior Claude B claims now wrong

| Claim | Where | Correction |
|---|---|---|
| "Queue producer binding declared — **pass**" | `2026-08-10-market-release-gates.md`, gate 5 | Passes only for staging. Top-level has no producer and no consumer. The gate was too coarse to be true. |
| "gateway suite couldn't run — root cause was one import line" | earlier run | Correct at the time, but I then reported `node_modules` as present this run on a directory with nothing in it. Both the original fix and this correction are needed to describe the toolchain honestly. |
| "168/168 across 7 checkers" as a completeness claim | several notes | Still literally true, and still says nothing about the estate — those fixtures test the *checkers*. Real-tree results are 10 errors on relops-b. I have been quoting the fixture number in positions where a reader would take it as a health figure. |
| "Sentry and Analytics are absent rather than broken" | last completion | Accurate, but incomplete: **no scheduler exists either** (OB21), which nobody had noticed because "Workflows optional" made absence look deliberate. |

## 3 · Rules that first passed for the wrong reason

**OB26 — free-form metric bag.** Fired against my own `metrics.ts`. The
rule matched `Record<string, string>` inside a **comment** that says the
code is "deliberately not `Record<string, string>`" — a rule that reads
a note *about* a defect as the defect. This is the third instance of
this exact class in this project (the OCPP fast-path collector matched
`return` inside `/* no return here */`). Comments are now stripped
before the check, and both directions are asserted.

**OB18 — liveness sweeper.** First version matched
`/alarm[\s\S]{0,4000}?(liveness|…)/`, case-sensitively, against a
comment-stripped source. It failed *every* fixture, including the good
one, because `sweepLiveness` capitalises the L and the fixture's proof
was inside a comment `stripComments` had already removed. A rule whose
evidence can live in a comment is not a rule. Now anchored on
`async alarm(` with `/i`.

## 4 · Fixtures that failed for two reasons and had to be narrowed

**`no-guard.invalid`** truncated `identityDo` from the guard onward,
which also removed the cap-breach lines and the alarm — so it tripped
OB2, OB18 and OB25 together and proved nothing about OB2. Narrowed to
renaming the predicate, leaving everything else intact.

**`interval-60.invalid`** legitimately trips both OB6 (shape) and OB23
(cost multiplier). Rather than weaken either rule, the expectation now
records both. The neighbouring `interval-7200` case exists to prove
OB23 does **not** fire when the interval moves the safe way.

## 5 · Code I wrote that was too permissive on the first attempt

**`buildBlobs` accepted any string dimension.** The type system stops an
OCPP frame reaching `eventType`, but nothing stopped a caller
interpolating one into a string — unbounded length into a billed blob,
and free text where a token belongs. Now capped at 64 characters and
rejected if it contains whitespace or `@`, with `identity` exempt
because it is hashed before it is written.

**`sentryConfigFrom` accepted any non-empty DSN.** A malformed DSN does
not fail loudly — SDKs log once and then silently drop every event,
which is indistinguishable from "no errors happened". Now shape-checked
and fail-closed with a `reason`, and the rejected value is never echoed
back into the config object, because a malformed DSN is still a
credential-shaped string and that object gets logged.

**`OB12` had a test-file carve-out.** It exempted DSNs that looked
synthetic in files named like tests. Removed: a DSN-shaped literal is
either a credential or something a scanner will treat as one. The
fixture that needs one assembles it at runtime instead.

## 6 · Remaining blockers — credential-gated vs engineering-gated

| Blocker | Kind | Note |
|---|---|---|
| No Worker version id recorded | **credential** | one read-only session; the single blocking release fact |
| Queue binding as deployed | **credential** | config is not deployment |
| Deployed bindings / routes / domains | **credential** | column A |
| Neon protection, MFA, backups | **credential** | plus an approval |
| **No liveness sweeper** | **engineering** | a DO alarm and a transition write; nothing external needed |
| **No scheduler for billing jobs** | **engineering** | a cron trigger; nothing external needed |
| **Metrics writer not wired to the hot path** | **engineering**, sequenced | deliberately deferred until a binding exists to observe |
| Sentry SDK not installed | **engineering** | one dependency, out of scope for this lane |
| Active-session interval (M-3) | **hardware** | neither credential nor engineering can settle it |
| Top-level queue producer/consumer absent | **engineering** | uncomment + declare; needs approval to deploy |

The useful split: **three of the top blockers need a 30-minute
Cloudflare session, and two need an afternoon of code.** The liveness
sweeper is the highest-value engineering item on the list, because
without it the product cannot tell a customer that a charger is down.
