# Review - Scale To 4,000 Chargers Sprint Plan

> **LEGACY — superseded as active canon by /FOCUS.md (2026-08-07). Kept as historical reference; nothing here is being worked from.**

**Reviewer date:** 2026-05-01
**Subject:** `scale-to-4000-chargers-sprint-plan.md` and the two architecture SVGs in this folder.
**Verdict:** Architectural direction is sound. The plan is high-quality. The issues below are about scoping, sequencing, and a few production concerns that are flagged as "gaps" but never given owners or sprints.

---

## 1. Overall Read

The diagnosis is correct and matches the SVGs:

- The current Straumvakt runtime is mid-transition - gateway staging binds to `hlada-api-staging` while `/api/ocpp/events` still lives in the Next app. This is the highest-impact issue and it is correctly placed at S1.
- Prisma is being used as a row-by-row writer for what will become high-volume telemetry. This is the second highest-impact issue and S3+S4 address it properly.
- Async export jobs and a separate enterprise API are real product gaps, not nice-to-haves, and they are correctly scoped as their own sprints.

The target architecture in `target-architecture-after-gbtnotes.svg` is the right shape: queue-first OCPP ingest, raw SQL batch writers, report-ready datasets, object-storage artifacts, and a separate `/v1` public API. There is nothing structurally wrong to fix.

The remaining critique is about *what is missing*, *what is mis-sized*, and *what depends on what*.

---

## 2. Strengths Worth Preserving

- Concrete scale assumptions with event/sec math (S1 framing). Most plans hand-wave this.
- Explicit ADR gate at S3 before optimizing the wrong persistence path.
- Clear ORM boundary: Prisma for control plane, raw SQL for hot ingest.
- Export pipeline designed once and reused by the enterprise API (S5 calls this out).
- Enterprise API treated as a *product* with auth, scopes, OpenAPI, webhooks, audit, not a thin wrapper over admin routes.
- Load test scope (S7) includes report exports during ingest, not just charger volume.
- Priority Order section acknowledges that S6 (commands) may move earlier for pilot.

---

## 3. Highest-Impact Gaps

These are issues the plan flags in "Gaps Found" but does not assign to a sprint, or assigns only weakly.

### 3.1 Driver / mobile app and registration are unscoped

Listed as gaps under "Product And Production Gaps":

- "Real user registration is missing"
- "Driver/mobile app production UX is missing"
- "Driver billing UX is incomplete"
- "Payment/provider decision is open"

None of S1-S11 owns this work. If production for 4,000 chargers includes drivers using the app, this is on the critical path and is at least one full additional sprint, possibly two. Decide explicitly:

1. Is driver-facing functionality in scope for the 6-month ramp?
2. If yes, add a "Sprint S5b - Driver/Mobile Production UX" between S5 and S6.
3. If no, state it: "Drivers continue to use vendor-provided apps; Straumvakt only owns operator/admin workflows in this window."

### 3.2 RBAC and tenant administration are unscoped

Listed gaps:

- "User privileges/RBAC are incomplete"
- "Tenant administration is incomplete"

S9 only adds *tests* for tenant isolation. It does not define the role model (platform admin, org admin, site manager, finance, support, driver) or build the membership/permissions UI. This needs its own sprint, probably between S6 and S7, or it gets bolted on under time pressure during S10.

### 3.3 Privacy / GDPR / PII classification

Listed gap. S9 mentions audit fields and export download review, but PII classification *should drive* retention windows in S4 and export field selection in S5. A short PII classification step belongs *inside S3* so S4 retention rules and S5 report-ready datasets respect it from the start.

### 3.4 Onboarding tooling for the ramp itself

To get from 20 to 4,000 chargers in 6 months you need to onboard ~22 chargers/day on average and likely much more in batches. The plan does not include:

- Bulk charger import (CSV/API).
- Vendor credential bulk provisioning.
- Site/location bulk creation.
- A "fleet onboarding" runbook with a checklist.

This is operator UX, not raw scale, but it is the difference between hitting 4,000 and not. Add a small sprint or fold into the RBAC/tenant-admin sprint.

### 3.5 Backpressure and overload behavior

S2 adds queues but does not specify what happens when:

- Queue depth grows faster than the consumer drains (poison-storm or DB outage).
- The gateway DO is saturated by reconnect storms.
- A single noisy charger sends MeterValues every second.

Concretely the plan should add:

- A per-identity rate limit at the DO level (drop or coalesce excess MeterValues).
- A queue-depth threshold above which the gateway returns a soft-fail to chargers so they slow down.
- A circuit-breaker on the consumer side when DB latency exceeds a budget.

Without these, the system at 4,000 chargers will have a graceful failure mode only by accident.

### 3.6 Cost model is missing

At MeterValues every 30s the math in S1 is ~133 events/sec, ~11.5M events/day. At every 10s it is ~35M events/day. Each event becomes:

- 1 Cloudflare Queue message (produce + consume).
- 1+ Postgres/Timescale write.
- 1 Durable Object request and storage cost.
- Optionally 1 R2 write for raw archive.

Without a cost forecast the team cannot defend the data-platform decision in S3 or the raw-archive policy in S4. Add a "Cost Model" sub-section to S3 with conservative high/low bands.

### 3.7 Scheduled jobs / cron

Multiple things in the plan need a scheduler that is not named:

- Retention enforcement (S4).
- Partition / hypertable maintenance (S4).
- Raw archive sweep (S5).
- Signed URL expiry / artifact cleanup (S5).
- Aggregate refresh / continuous aggregate maintenance (S4).
- DLQ size monitoring (S8).

Cloudflare Cron Triggers cover some of this; long-running maintenance may need to live in the API Worker queue consumer or an external scheduler. Pick a story in S3 and reference it from each sprint that schedules work.

### 3.8 Migration of the existing 20 chargers' data

When S4 introduces partitioning or moves telemetry to Timescale, the existing data has to land somewhere. The plan does not have a backfill / migration step. Likely small at 20 chargers but should still be written down so it is not invented at deploy time.

---

## 4. Sequencing And Sizing Concerns

### 4.1 S2 ships before S3 - what does the consumer do?

S2 introduces a queue consumer that writes to *something*. S3 then decides Neon-vs-Timescale and Prisma-vs-raw-SQL. So either:

- The S2 consumer writes through Prisma to Neon and is explicitly throwaway, to be replaced in S4. (Likely cheapest path, but state it.)
- S3 is partially folded into S2 - at minimum the ORM-boundary decision must be made before S2 consumer code is written.

Pick one and call it out. As written S2 is at risk of accidentally becoming the long-term hot-ingest path because "it works".

### 4.2 S6 is misnumbered relative to Priority Order

The Priority Order section places S6 (commands) at position 8, after S7 and S8. The plan body places S6 between S5 and S7. The doc itself flags that "S6 can move earlier if remote start/stop is a pilot requirement." Almost any production pilot will require it. Either renumber so the body matches the priority, or change the priority list to match the body. Today they disagree.

### 4.3 S11 is one sprint pretending to be a quarter

S11 packs: API product boundary, OpenAPI, enterprise auth, agreement APIs, operational read APIs, billing/reporting APIs, write APIs, webhooks, audit, observability, tests, and documentation. That is 2-4 sprints of real work in any team. Acceptable as a placeholder, but the plan should say "S11 is a milestone, not a sprint" and break it into S11a/b/c when the time comes.

### 4.4 S7 simulator is itself a small project

"Build or adopt an OCPP 1.6J charger simulator" with reconnect storms, failure injection, message-mix shaping, and concurrency to 4,000 is a multi-week task on its own. Consider:

- Picking a simulator in S3 (open-source baselines: SteVe simulator, MaEVe, ocpp-rs simulators, etc.).
- Spending one engineer-week on simulator harness *before* S7 so S7 is execution, not authoring.

### 4.5 The 6-month window probably does not include S11

The intro says the plan makes Straumvakt "ready for a fast scale-up... within 6 months." S11 is then explicitly last. Be honest with stakeholders: "S1-S10 in 6 months. Enterprise API (S11) is a follow-on quarter." Otherwise the 6-month commitment is overstated.

---

## 5. Sprint-By-Sprint Notes

### S1 - Fix The Runtime Split

Solid. Two adds:

- Add a smoke test that the Next app no longer responds to `/api/ocpp/events` after cutover (or returns a clear "moved" response). Otherwise an old config could keep traffic hitting the wrong app silently.
- Add a "rollback step": what if porting the route breaks an existing 20-charger pilot? Should be quick to revert.

### S2 - Queue-Backed Inbound OCPP Events

- Idempotency on `eventId` alone is fragile. Some chargers reuse uniqueIds after reboot, and some firmware misconfigs duplicate them. Use a composite idempotency key: `(identityUuid, ocppMessageId, action, timestampBucket)`, and dedupe on a short TTL store (Cloudflare KV or DO storage) before the DB write.
- Specify maximum message size, max batch size for the consumer, and what happens to oversized payloads.
- Specify the queue's max retries and DLQ TTL explicitly, not "as needed".

### S3 - Data Platform And ORM Decision

- Add an "if no decision by X, default is Neon partitioning" rule so S4 cannot stall.
- Add the cost model from §3.6.
- Add the simulator-choice step from §4.4.
- Add the scheduled-jobs decision from §3.7.
- Add a small "PII classification" step from §3.3.

### S4 - Hot Ingest, Retention, Projection

- Call out the migration of the existing 20 chargers' data (§3.8).
- The "current-state upserts" task is doing a lot of work in one bullet. Expand to: which tables, what is the conflict key, what update-only-if-newer logic, and how to avoid hot-row contention if 4,000 chargers all touch the same charger-status row. (They shouldn't, one row per charger, but spell it out.)

### S5 - Report Export Pipeline

- Good as written.
- Add a "preview" path: synchronous exports under N rows that bypass the queue. Operators will want fast small CSVs.
- Specify object-storage choice early (R2 is the obvious Cloudflare-native choice).
- Specify whether report worker runs as a Cloudflare Worker or as a separate runtime; very large XLSX/PDF generation can hit Worker CPU/memory limits and may need a different runtime.

### S6 - Outbound Command Hardening

- Move earlier per §4.2.
- "Add command timeout semantics" should specify default timeout, per-action overrides, and what "timed_out" actually does (does the command auto-retry, or is it manual?).
- Add a "command cancellation" path. Operators sometimes need to cancel pending commands on a stuck charger.

### S7 - Load Test Harness

- See §4.4 - move simulator selection to S3.
- Add a "baseline run" before any tuning so deltas are measurable.
- Add a database-restore drill while load is running. Restore + replay is the scariest thing about a fleet at scale.

### S8 - Observability And Operations

- Add SLOs (e.g., "ingest lag p95 < 5s for normal load, < 60s under reconnect storm"). Without SLOs the alert thresholds are arbitrary.
- Add a "synthetic charger" running in production that exercises the full path end to end and alerts when broken.
- Add error-budget burn-rate alerts, not just static thresholds.

### S9 - Security, Tenant Isolation, Secrets

- Add "secret-rotation runbook" as a deliverable, not just "review rotation procedure".
- Add the RBAC role model deliverable (§3.2) here or in a dedicated sprint.
- Add a vulnerability-disclosure / security-contact policy. Cheap and required by enterprise customers.

### S10 - Production Cutover Readiness

- Add "scaled rollback drill": deploy production, deploy a known-bad migration, roll it back end-to-end. Once.
- Add an explicit "freeze window" policy: no schema changes during onboarding batches.

### S11 - Enterprise API And Agreement Integrations

- Treat as a milestone, break into S11a (read-only `/v1`), S11b (writes + idempotency), S11c (webhooks + DLQ + replay), S11d (docs + sandbox).
- Add a "design partner" step: pick one enterprise customer, build to their integration, then generalize. Most public APIs that are designed in a vacuum get rewritten after the first real integration.

---

## 6. Internal Consistency Issues

- "Priority Order" disagrees with sprint numbering (§4.2).
- The intro promises 6-month readiness but S11 implicitly slips out of that window (§4.5). Either drop S11 from the 6-month claim or commit to a smaller S11 scope inside the window.
- "Gaps Found In The Current Situation" lists driver app, RBAC, registration, payments, privacy, but the Sprint Task Lists do not own them. Either move these to a "Deferred Scope" section or assign them to sprints.
- Current architecture SVG says "Prisma paths still mixed by runtime" - true, but this *is* the split-brain in §S1, not a separate gap. Worth saying so on the diagram.

---

## 7. Suggested Minimal Edits To The Plan

If you want a low-effort first pass, do these:

1. Add a "Deferred / Out of Scope" section listing driver app, payments, RBAC role model, PII classification, onboarding tooling, cost model, scheduler choice - with one line each saying which sprint will adopt them. This converts implicit gaps into explicit decisions.
2. Renumber sprints (or the Priority Order) so the two orderings match, and explicitly mark S11 as a follow-on milestone.
3. Add "S2 consumer writes are transitional, replaced in S4" inline in S2.
4. Add "default decision: Neon partitioning unless explicit Timescale ADR by week N" inline in S3.
5. Add SLOs to S8 so its alerts have a basis.
6. Add a backpressure subsection to S2 (per-identity rate limit, queue-depth soft-fail, consumer circuit breaker).

---

## 8. Net Recommendation

Ship the plan after the §7 edits. The architectural decisions are right and the sprint shapes are reasonable. The main risk to the 6-month commitment is *unscoped product work* (driver/RBAC/registration/payments) and *under-sized late sprints* (S11), not the technical backbone. If the team is honest about what is and is not in the 6 months, this plan can deliver a stable 4,000-charger fleet on the current Cloudflare-native architecture.
