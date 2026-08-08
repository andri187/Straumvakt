# ADR 0017 — Pre-Pilot Rescope For 4k-Charger Target

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Historical — a past sprint-scope decision, not a proposal awaiting approval. Reclassified 2026-08-04; the sprints it governs are long finished. Kept for the reasoning, not as an open question.
**Date:** 2026-05-03
**Sprint:** Records the rescope before any code lands. Sprints 5–11 reshape per this ADR.
**Supersedes (in part):** Sprint 5 milestones from [ADR 0016](./0016-sprint-5-scope-call-invite-over-tariff.md), and Sprint 6–10 sections of [STRAUMVAKT_V3_DELIVERY_PLAN.md](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md). [ADR 0006](./0006-pilot-scope-rev2-2026-04-25.md)'s "20 chargers, demonstrable" pilot framing tightens to "first batch on scale-validated infrastructure."
**Relates to:** [`gbtNotes/scale-to-4000-chargers-sprint-plan.md`](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md) (becomes the canonical pre-pilot architecture roadmap), [`gbtNotes/sprint-plan-review.md`](../../gbtNotes/sprint-plan-review.md), [ADR 0014](./0014-identity-tenancy-and-authorization.md), [ADR 0015](./0015-sprint-3-scope-swap-ocpi-to-identity.md).

## Context

Two roadmaps have been competing since Sprint 3:

1. **The delivery plan** (per ADR 0006 / 0014 / 0015) — pilot-first
   framing assuming ~20 chargers at Dalvegur, 30-day demonstrable
   pilot. Sprint structure: identity foundation → membership/permissions
   → invite flow → tariff → billing dashboard → push API →
   hardening → multi-tenant → pilot.

2. **The gbtNotes scale plan** (`scale-to-4000-chargers-sprint-plan.md`,
   2026-05-01) — 4,000-charger trajectory in 6 months. Sprint
   structure: fix runtime split → queue-backed ingest → data platform
   decision → hot ingest + retention + R2 archive → export pipeline →
   outbound hardening → load test → observability → security → cutover
   → enterprise API.

ADR 0015 reconciled the parallel numbering by mapping gbtNotes S1–S11
*into* the existing delivery sprints. That mapping was approximate;
the assumption was that gbtNotes scale work was post-pilot polish.

That assumption was wrong. Re-reading the gbtNotes scale plan with a
4k-charger-by-pilot-end target reveals that several "post-pilot"
items are actually pre-pilot must-haves:

- **Queue-backed inbound OCPP** (S2). Synchronous service-binding
  writes from gateway DO → Prisma → Postgres stalls under DB
  latency. At 67–400 events/sec from 4k chargers, charger WebSocket
  responses stretch beyond OCPP timeouts. **Must land before pilot
  ramp begins.**

- **Data-platform + ORM-boundary decision** (S3). Prisma per-event
  writes for MeterValues at 4k×30s (~133 events/sec) is the
  ingest ceiling Postgres + Prisma can sustainably hit. Either
  partition + raw SQL on Neon, or move telemetry to Timescale.
  **Decision must precede the implementation work in S4.**

- **Hot-ingest implementation + R2 raw archive** (S4). Once the
  decision lands, the queue consumer needs raw SQL batching;
  retention + age-out keeps Postgres bounded; raw OCPP payloads
  archive to R2 for billing-dispute evidence bundles. **Without
  this, Postgres grows unbounded at ~11.5M rows/day.**

- **Load test harness** (S7). Without 100 → 4000-charger
  simulation, none of the above is verified. **Pilot Go-Live
  needs evidence the architecture holds.**

- **Outbound command hardening** (S6). 4k chargers means real
  command churn; today's outbox lacks state semantics + timeout +
  observability. Ships pre-pilot so operator can diagnose the
  inevitable "remote start didn't" cases.

- **Observability dashboards** (S8). 4k chargers can't be operated
  by tail-watching. Pre-pilot.

- **Security + tenant isolation tests** (S9). Pre-pilot baseline.

- **Production cutover readiness** (S10). The pilot Go-Live
  ceremony itself.

Conversely, the original delivery plan's pilot-relevant features —
tariff engine, billing dashboard, invite flow — remain pre-pilot
but **no longer dominate the schedule**. They're customer-experience
deliverables; the 4k constraint is an architecture problem.

## Decision

**Sprints 5–11 reshape around the gbtNotes scale roadmap, with
identity-and-product features (invite, tariff, billing dashboard)
riding as parallel tracks where they don't compete with the
load-bearing scale work.** Pilot Go-Live becomes Sprint 11
("first batch on scale-validated infrastructure"), not Sprint 10.

Six pilot-time changes:

1. **Pilot scope tightens from "demonstrable" to "scale-validated."**
   ADR 0006 framed pilot as 20 chargers in shadow mode for 30 days.
   This ADR tightens: pilot opens with first batch (~50 chargers)
   on infrastructure that's been load-tested to 4k. Ramp from 50 →
   500 → 2k → 4k over 6 months post-pilot.

2. **gbtNotes scale plan absorbs as the pre-pilot canon.** Each
   gbtNotes S-sprint maps 1:1 (or 2:1 where parallel-trackable) into
   delivery sprints 5–11.

3. **Invite flow + tariff stay pre-pilot** but as parallel tracks
   inside Sprints 5 and 8 respectively. They don't drive the sprint
   headline; scale work does.

4. **Data platform: Neon-with-partitioning as default.** Timescale
   only if Sprint 9 load test surfaces a fundamental Postgres
   ceiling. Cheaper; fewer moving parts; Cloudflare connectivity
   already proven.

5. **Raw OCPP archive: R2 always-on.** 7-day Postgres retention for
   `raw_protocol` event-log rows; aged-out rows archive to R2 with
   per-day partitions. CDR-evidence-bundle requests during pilot
   read from R2.

6. **OCPI Foundation defers further.** Already at Sprint 14 per ADR
   0015; with this rescope, slips to Sprint 15. No customer asks
   for OCPI; cost is theoretical.

## New sprint structure (Sprints 5–11)

| Sprint | Headline | Carries |
|---|---|---|
| **5** | Queue-backed inbound OCPP events | + Invite flow MVP (parallel track) |
| **6** | Data Platform + ORM Decision | ADR 0018 + named data products |
| **7** | Hot Ingest + Retention + R2 Archive | The CDR-archive work specifically |
| **8** | Tariff Engine + Billing Dashboard | + Export pipeline MVP (parallel track) |
| **9** | Outbound Command Hardening + Load Test Harness | 100 → 500 → 1000 → 4000 charger simulation |
| **10** | Observability + Security/Tenancy | Dashboards, alerts, runbooks, RLS |
| **11** | Production Cutover Readiness + Pilot Go-Live | First-batch ramp begins |

### Detail per sprint

#### Sprint 5 — Queue-backed inbound OCPP + Invite flow MVP

**Headline (gbtNotes S2):** Inbound OCPP events flow via Cloudflare
Queue, not synchronous service binding. Charger WebSocket responses
stay sub-second when DB is slow. DLQ for poison messages. Idempotent
consumer keyed by `eventId`.

**Parallel track (per ADR 0014 / ADR 0016):** Invite flow MVP —
agent invitation endpoint + accept-invite landing + UserCredential
polymorphic kinds. Driver signup + impersonation slip to Sprint 8 (parallel
track there) since they don't block the scale work.

#### Sprint 6 — Data Platform + ORM Decision

**Headline (gbtNotes S3):** Lands as ADR 0018. Classifies tables
into operational / current-state / outbox / billing-grade /
time-series / raw archive / aggregate / report-ready / API metadata.
Decides Neon-with-partitioning vs Timescale Cloud (default Neon).
Decides ORM boundary (Prisma for control plane, raw SQL for queue
consumers + MeterValues + event facts). Defines named data products
that Sprint 7 + 8 consume.

**No code changes** — this sprint is a decision sprint with a written
ADR + named data products, similar to the Sprint 0 schema design work.

#### Sprint 7 — Hot Ingest + Retention + R2 Archive

**Headline (gbtNotes S4):** Implements whatever Sprint 6 decided.
Replaces per-event Prisma writes in queue consumer with raw SQL
batched writes. Adds partition or hypertable strategy. Retention:
7 days for `raw_protocol`, indefinite for `financial` and
`operational`. Raw OCPP payloads archive to R2 with per-day partitions
after the 7-day window. Adds aggregate + report-ready tables.

**The CDR-archive work specifically lives here** — not the OCPI
roaming CDR (Sprint 14+) but the raw OCPP payload archive used for
billing dispute evidence and operator forensics.

#### Sprint 8 — Tariff Engine + Billing Dashboard

**Headline (was original Sprint 5):** Pure-function tariff engine;
CustomerPlan + ChargerServicePlan schemas; plan selection priority
resolver; ISK-only locale rendering. Billing dashboard reads from
Sprint 7's report-ready tables.

**Parallel track:** Driver self-registration + impersonation flow (
deferred from Sprint 5). Export pipeline MVP (gbtNotes S5 trimmed —
just the queue + R2 artifact path, scope-limited to billing exports
the dashboard surfaces).

#### Sprint 9 — Outbound Command Hardening + Load Test Harness

**Headline (gbtNotes S6 + S7):** Outbox state machine (pending /
dispatched / sent / accepted / rejected / timed_out / failed),
gateway command-result event ingest, retry semantics. **Plus** the
load-test simulator: 100 → 500 → 1000 → 4000 chargers, reconnect
storms, queue backlog, DB latency spike, A/B test the persistence
path if Timescale was selected in Sprint 6.

This is THE sprint that proves the architecture. Exit criteria
include "staging survives 4000-charger sim at 30s MeterValues for
1 hour without DLQ growth."

#### Sprint 10 — Observability + Security/Tenancy

**Headline (gbtNotes S8 + S9):** Production dashboards (charger
counts, queue depth, command latency, DB write latency, R2 archive
growth). Structured logs with correlation IDs. Alert thresholds.
Runbooks for the 14 named failure modes. Postgres RLS as
defense-in-depth on per-tenant tables. AuditAction append-only DB
enforcement. MFA mandatory on PlatformGrant.

#### Sprint 11 — Production Cutover Readiness + Pilot Go-Live

**Headline (gbtNotes S10):** Production resources (Cloudflare
prod Workers, Neon prod plan, R2 buckets, Hyperdrive, Queues, DLQs).
Migration dry-run. Final 4k-staging load test against
production-like config. Rollback paths for UI / API / gateway / DB.
Go/no-go checklist signed. Pilot ramp: first batch lands.

**Pilot opens here.** Not "20 chargers in shadow mode." First batch
of customer chargers (target ~50, scaled by who's contracted) on
fully scale-validated infrastructure.

## Open decisions resolved by this ADR

| Question | Decision |
|---|---|
| Pilot definition | "First batch on scale-validated infrastructure" — opens at Sprint 11, ramps post-pilot |
| Tariff + invite scope | Both pre-pilot, riding parallel tracks (S5 invite, S8 tariff + driver signup) |
| Data platform (preliminary) | Neon-with-partitioning. Timescale only if Sprint 9 load test forces it. ADR 0018 in Sprint 6 finalizes. |
| Raw archive | R2 always-on. 7-day Postgres retention; per-day R2 partitions thereafter. |
| OTP delivery channel | Sprint 8 parallel track decides; staging may use a stub provider until then |
| Magic-link / OTP TTL | Per ADR 0016 recommendation: 7 days invite, 15 minutes OTP |
| Impersonation max duration | Per ADR 0016 recommendation: 4 hours |
| Bootstrap admin spike | Sprint 5 milestone in the invite-flow track — Option C (login-path upsert) |

## Open decisions deferred to their sprints

| Question | Decided in |
|---|---|
| Final ORM boundary specifics (which client lib, which migrations stay Prisma) | Sprint 6 ADR 0018 |
| Partition strategy specifics (range vs list, retention vs PITR interaction) | Sprint 6 ADR 0018 |
| R2 bucket layout + key scheme (prefixed by org? by date? by event-type?) | Sprint 6 ADR 0018 |
| Export pipeline scope for Sprint 8 (which report types ship in MVP) | Sprint 8 design summary |
| Load test simulator framework (build vs adopt; node-side or k6-side) | Sprint 9 design summary |

## Cost: schedule slip

| Slot | Pre-this-ADR (per ADR 0016) | Post-this-ADR |
|---|---|---|
| Sprint 5 | Invite Flow + Driver Signup + Impersonation | Queue-backed Inbound OCPP + Invite Flow MVP |
| Sprint 6 | Commercial Model | Data Platform Decision |
| Sprint 7 | Billing Dashboard | Hot Ingest + Retention + R2 Archive |
| Sprint 8 | Push API + Observability | Tariff + Billing Dashboard |
| Sprint 9 | Hardening | Outbound Hardening + Load Test |
| Sprint 10 | Multi-Tenant + White-Label | Observability + Security/Tenancy |
| Sprint 11 | Pilot Go-Live | Production Cutover + Pilot Go-Live |
| Sprint 12+ | Enterprise API + Post-pilot work | Driver UX, multi-tenant white-label, enterprise API |

**Pilot Go-Live stays at Sprint 11** (no further slip from current
state — ADR 0016 already moved it from Sprint 10 to 11). The 4k-target
work fills sprints 5–10 instead of pilot's original tariff + billing
+ push API + hardening + multi-tenant content.

The product features that slipped:
- **Push API + observability of issue + driver events** → Sprint 12+
  post-pilot. Operator console dashboards for charger health ship
  Sprint 10.
- **Multi-tenant white-label / second-org branding** → Sprint 12+.
  Multi-tenant *isolation* (RLS, scope checks) ships Sprint 10.
- **Issue Engine** (post-pilot per ADR 0006 already) → unchanged.
- **OCPI Foundation** → Sprint 14 → 15 with this slip.

## Consequences

### Positive

- Pilot opens with infrastructure that's actually been load-tested to
  the 4k target. No "we'll harden in production" debt.
- The CDR-archive question (raw OCPP payloads, billing-dispute
  evidence) gets answered before pilot, not after a customer files a
  dispute we can't honour.
- Communication patterns (queue-backed everywhere, DLQ-ready,
  observable) are baked in from sprint 5; not retrofitted.
- gbtNotes scale plan stops being a parallel canon and becomes the
  delivery plan's pre-pilot roadmap. Single source of truth.
- The "we keep slipping invite/tariff" pattern from ADR 0015 + 0016
  resolves: both ship pre-pilot but no longer dominate the schedule.

### Negative

- Pilot Go-Live calendar pushes by what was nominally 4–6 weeks of
  pure scale work that wasn't on the prior schedule (gbtNotes
  estimated S2–S4 + S7 + S8 + S9 at ~2–3 sprints; absorbed via parallel
  tracks the actual slip is ~2 sprints).
- Sprint 6 is mostly a decision-and-write sprint with no shippable
  customer-visible feature. Risk: feels like a "wasted" sprint.
  Mitigation: ADR 0018 is the deliverable, and Sprint 7's velocity
  depends on it being right.
- Sprint 9 load-test work is high variance — surprises in the
  4k-charger sim could surface real architecture changes.
  Mitigation: budget Sprint 10 + 11 with float.
- Tariff engine ships at Sprint 8 (was Sprint 5 in original plan,
  Sprint 6 per ADR 0016); 6-week slip. Pilot still has billing
  visibility because Sprint 8 is pre-pilot — but tariff engine has
  less pre-pilot soak time than the original plan envisioned.
- Multi-tenant white-label fully slips post-pilot. Pilot still
  proves multi-tenant isolation (Sprint 10 RLS); it just doesn't
  prove white-label re-skinning. Acceptable since pilot only has
  one customer.

### Out of scope

- Re-litigating ADR 0006's pilot framing entirely. Pilot still admin-
  only, money still doesn't move during pilot, drivers still inert
  records. The change is *infrastructure scale-validated* not
  *customer experience expanded*.
- Replacing the Cloudflare-native architecture. gbtNotes confirms
  the high-level shape (UI Worker / API Worker / Gateway / DOs /
  Queues / Postgres / R2) is sound; the rescope is about IMPLEMENTING
  it correctly, not redesigning.
- Sprint 12+ in detail. Post-pilot scope solidifies after pilot ramps
  and customer signal arrives.

## Sprint task lists

Detailed milestone breakdowns live at:

- [`docs/sprints/SPRINT_05_TASKS.md`](../sprints/SPRINT_05_TASKS.md) — Queue + Invite
- [`docs/sprints/SPRINT_06_TASKS.md`](../sprints/SPRINT_06_TASKS.md) — Data Platform Decision
- [`docs/sprints/SPRINT_07_TASKS.md`](../sprints/SPRINT_07_TASKS.md) — Hot Ingest + R2 Archive
- [`docs/sprints/SPRINT_08_TASKS.md`](../sprints/SPRINT_08_TASKS.md) — Tariff + Billing Dashboard
- [`docs/sprints/SPRINT_09_TASKS.md`](../sprints/SPRINT_09_TASKS.md) — Outbound Hardening + Load Test
- [`docs/sprints/SPRINT_10_TASKS.md`](../sprints/SPRINT_10_TASKS.md) — Observability + Security
- [`docs/sprints/SPRINT_11_TASKS.md`](../sprints/SPRINT_11_TASKS.md) — Production Cutover + Pilot Go-Live

All authored as part of this ADR's commit so the rescope lands as a
unit.

## References

- [`gbtNotes/scale-to-4000-chargers-sprint-plan.md`](../../gbtNotes/scale-to-4000-chargers-sprint-plan.md) — the canonical pre-pilot architecture roadmap
- [`gbtNotes/sprint-plan-review.md`](../../gbtNotes/sprint-plan-review.md) — the eight unscoped concerns this ADR partially absorbs
- [ADR 0006](./0006-pilot-scope-rev2-2026-04-25.md) — pilot scope rev 2 (the framing this ADR tightens)
- [ADR 0014](./0014-identity-tenancy-and-authorization.md) — identity model (still load-bearing; invite flow stays pre-pilot)
- [ADR 0015](./0015-sprint-3-scope-swap-ocpi-to-identity.md) — Sprint 3 scope swap (precedent for delivery-plan + ADR-driven scope reconciliation)
- [ADR 0016](./0016-sprint-5-scope-call-invite-over-tariff.md) — Sprint 5 scope call (this ADR partially absorbs by promoting queue-backed ingest above invite flow as Sprint 5's headline)
