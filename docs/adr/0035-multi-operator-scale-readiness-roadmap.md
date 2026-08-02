# ADR 0035 — Scale readiness and fleet acquisition: expanding Track H, adding Track F

**Status:** Proposed — 2026-08-02.
**Extends (does not supersede):**
[GOING_PUBLIC_CRITICAL_PATH.md](../architecture/GOING_PUBLIC_CRITICAL_PATH.md)
— ratified 2026-06-04, phases P0–P6, still execution canon.
**Relates to:** [ADR 0017](./0017-prepilot-rescope-for-4k-charger-target.md),
[ADR 0018](./0018-data-platform-and-orm-boundary.md),
[ADR 0023](./0023-realtime-connector-status-propagation.md),
[ADR 0031](./0031-cost-model-and-money-flow.md),
[ADR 0032](./0032-neighbour-helper-and-issue-engine-go-live.md),
[TENANT_ISOLATION_AUDIT.md](../architecture/TENANT_ISOLATION_AUDIT.md),
[2026-08-02 AMPECO benchmark note](../notes/2026-08-02-ampeco-benchmark-change-suggestions.md).

---

## The one-paragraph version

A 2026-08-02 code review found nine defects on the OCPP ingest and
command paths that make the "we can scale" claim unproven, plus a
missing load-test harness that P5.5 already depends on. Separately, a
major market participant may be entering insolvency, creating a need to
absorb another operator's fleet — mixed-vendor, connectors in the 1000s
— on a timeline nobody here controls. **Neither of these requires
renumbering sprints or delaying launch.** The hardening work belongs in
**P4**, which already runs parallel to Track E and depends only on P0.
The fleet work is genuinely new and becomes **Track F (P7)**, triggered
by the market event rather than the launch gate. Several review findings
belong *earlier* than a new track would put them — inside P0.7 and P1.

---

## Context

### Why this is not a renumbering

ADR 0017 resolved a "two competing roadmaps" problem in May. GOING_PUBLIC
resolved the pilot-versus-public framing in June and is explicit that
*"phase numbers (P0–P6) are the stable identifier; target sprint is a
suggestion."* A third numbering scheme would recreate exactly the problem
both documents were written to end.

GOING_PUBLIC's structure already accommodates this work:

```
P0 decisions ─► P1 billing ─► P2 onboarding ─► P3 mobile ─┐
                                                          ├─► P5 launch
P4 hardening (parallel, depends on P0 only) ──────────────┘
P7 fleet acquisition (parallel, market-triggered) ────────┘
P6 differentiators ── post-launch
```

P4 was scoped as "observability + security" because that is what the
pilot-era Sprint 10 contained. The code review says P4 must be larger.
That is an expansion of a ratified phase, not a new plan.

### Findings this ADR responds to

Verified against source on 2026-08-02.

| # | Finding | Location |
|---|---|---|
| F1 | Batch fast path covers heartbeats only. At 1000 chargers ~99% of batches are mixed and fall to per-event Prisma — the exact ceiling ADR 0017 named for MeterValues | `apps/api/src/queues/ocpp-events.ts:98` |
| F2 | `slice(0, result.fresh)` archives the wrong events when a batch contains a replay | `ocpp-events.ts:146` |
| F2b | Archive fanout is a sequential `await send()` per event | `ocpp-events.ts:145` |
| F3 | New pg pool created and destroyed per batch | `ocpp-events.ts:108,179` |
| F4 | `max_batch_timeout: 1` — the 2026-05-12 batching change (~50% Neon CU-hour reduction) is not in the live config | `apps/api/wrangler.jsonc` |
| F5 | Partition detach/drop never implemented; ~2M rows/day at 1000 chargers | `lib/db/partition-cron.ts:8` |
| F6 | `pendingOutbound` is an in-memory Map on a hibernating DO. Command results are lost on eviction; dispatch already returned 202 "Sent" | `gateway/src/identity-do.ts:90` |
| F7 | `transactions` Map declared, never written — dead | `identity-do.ts:88` |
| F8 | WS upgrade does not echo `Sec-WebSocket-Protocol: ocpp1.6`. Spec-strict firmware closes 1006 | `identity-do.ts:140` |
| F9 | Authorize sidecar awaits a Postgres round trip on the charger hot path | `identity-do.ts:256` |
| F10 | Zaptec status sweep: two sequential round trips per charger; hard wall at the Workers 1000-subrequest limit | `repositories/zaptec-charger-status-sync.ts:140` |
| F11 | Zaptec sessions cron: sequential per-installation calls, every minute | `lib/zaptec-sync-cron.ts:297` |
| F12 | **No load-test harness.** `virtual-cp.ts` simulates one charge point. ADR 0017's Sprint 9 Track B never shipped — and **P5.5 depends on "Scenario D", which does not exist** | `apps/api/scripts/` |
| F13 | No current-state projection; `listSiteTree` recomputes hierarchy + credential decrypt per request, uncached | `routes/admin/orgs.ts:176` |
| F14 | Host pages blank the list on every refetch, reset expansion state, no SSR, effect keyed on an object | `src/app/host/chargers/page.tsx:66,84,92` |
| F15 | Driver apps poll every 3–4s per session — ~70 req/s at 1000 chargers, more DB load than the entire charging fleet | `apps/driver/lib/main.dart:1030` |
| F16 | ADR 0031 money flow contradicts itself: item 4 forbids Straumvakt holding driver money; the 2026-06-14 amendment says Straumvakt "collects" and "remits" | ADR 0031 §4 vs access-fee amendment |
| F17 | `billing.sponsor_companies` follow-up superseded by the 2026-06-14 `service_workplace` structure, still listed as required | ADR 0031 |
| F18 | No tariff snapshot per closed session — historical invoices cannot be re-derived after an agreement changes | `lib/tariff/*` |
| F19 | Issue engine: zero code. Field service: zero code (both already placed at P6.1 / deferred) | — |
| F20 | Duplicate ADR 0021 — **resolved 2026-08-02.** Two documents held the number, and the citation graph was split: ADRs 0025 and 0031 cited `0021` meaning *reference-catalogue*, while ADR 0024 cited it meaning *autocharge*. Autocharge renumbered to **0036** (fewer citations to repair, and reference-catalogue is the one committed ADRs point at). | `docs/adr/` |

### What the tenant-isolation audit already answered

[TENANT_ISOLATION_AUDIT.md](../architecture/TENANT_ISOLATION_AUDIT.md)
(2026-06-05, same branch) already scoped P4.5 and P4.9:

| Layer | Verdict | Severity |
|---|---|---|
| Driver sees only own data | ✅ Enforced | — |
| Cross-host driver | ✅ Correct | — |
| Host sees only own org | ⚠ Safe-by-accident, not row-scoped | Medium |
| DB / RLS backstop | ❌ None — 100% app-layer | **High** |
| Charging gate | ⚠ `enforceAuthorize` default-OFF | Operator decision |
| OCPP ingest write path | ❌ Trusts envelope `orgId`, no row guard | Medium |

P4 does **not** need a fresh audit. It needs the fixes, a re-validation
of a two-month-old read, and one thing the audit did not cover: the
audit examined **host** isolation, not **operator-as-tenant**.

---

## Decision

### D1 — Phase numbering stands. No sprint renumbering.

P0–P6 remain the stable identifiers. This ADR adds milestones to P4,
adds one new phase P7, and folds several findings into P0/P1 where they
already belong.

### D2 — P4 expands from "observability + security" to the full hardening track

P4.1–P4.11 stand exactly as ratified. New milestones are added below,
grouped into sub-tracks for readability. **P4 still depends only on P0
and still runs parallel to P1–P3, so launch does not move.**

### D3 — New Track F (P7): fleet acquisition, market-triggered

Onboarding another operator's fleet is not on the launch critical path
and is not post-launch differentiation. It is a separate track with its
own trigger. It may need to run before its dependencies are complete; if
so, the fleet lands under a single operator and is re-tenanted
afterwards — a known, accepted cost.

### D4 — Findings that belong in existing phases move there, not into a new track

The review's billing findings are *earlier* than a new track would place
them. See "Fold-ins" below.

### D5 — Native OCPP is the strategic path; vendor-REST is maintenance

F10/F11 are real defects on the Zaptec REST path, which caps at roughly
200 chargers. Native OCPP is vendor-agnostic *and* reaches the 2–5k
range. Fleet acquisition depends on it. Vendor-REST sweeps are fixed only
when they block.

---

## P4 — Production Hardening (expanded)

> Ratified milestones **P4.1–P4.11 are unchanged.** Everything below is
> additive. Sub-track letters are for readability; the `P4.n` numbers
> are the identifiers.

### P4-C — Ingest and command integrity *(new — F1–F9)*

> A load test exists to find *unknowns*. Spending one to rediscover
> defects already written down wastes the run. P4-C comes before P4-D.

| # | Milestone | Detail |
|---|---|---|
| P4.12 | Generalised batch write path | Group a batch by event type, one multi-row insert per type, projections applied in bulk. MeterValues leaves the per-event Prisma path. `ON CONFLICT … RETURNING event_id` so the insert reports *which* rows were fresh. **Rule 5 gate** — `StopTransaction` triggers tariff resolution and a ledger write. |
| P4.13 | Archive fanout | `sendBatch()` instead of the sequential loop; driven by P4.12's returned identities, which closes F2 by construction. |
| P4.14 | Connection handling and batch cadence | Stop creating/destroying a pool per batch. Re-apply the 2026-05-12 `max_batch_timeout` change. **Rule 4 gate** — `apps/api/wrangler.jsonc`. |
| P4.15 | Partition retention | Detach-and-drop past the retention window, **gated on archive confirmation**, dry-run first, off by default. The one destructive task. **Rule 3.** |
| P4.16 | Outbound command durability | `pendingOutbound` → DO storage under the `cmd:` prefix the header comment already specifies; disconnect sweep; alarm-based timeout; delete the dead `transactions` map. |
| P4.17 | OCPP subprotocol echo | Echo `Sec-WebSocket-Protocol: ocpp1.6` when offered. Blocking for P7 — spec-strict firmware from an unknown vendor will not connect without it. |
| P4.18 | Authorize verdict caching | Short-TTL cache in DO storage with an invalidation path. **Rule 5 gate** — access-grant resolution. Must not change P4.11's shadow-mode → enforced flip in either direction. |

### P4-D — Measurement *(new — F12)*

> **P5.5 currently depends on something that does not exist.** It says
> "re-run Sprint 9 Scenario D"; ADR 0017's Sprint 9 Track B never
> shipped. Until P4-D lands, P5.5 cannot be executed and the go/no-go in
> P5.7 cannot be honestly signed.

| # | Milestone | Detail |
|---|---|---|
| P4.19 | Fleet simulator | Extend `apps/api/scripts/virtual-cp.ts` to N concurrent identities with configurable heartbeat / MeterValues intervals and mixed-vendor behaviour. |
| P4.20 | Scenarios | Steady state at 100 / 500 / 1000 / 5000; **connect storm** (a fleet repointed at once — new, for P7); reconnect storm; DB-latency injection; API-unavailable. |
| P4.21 | Instrumentation and write-up | Queue depth, batch path selection, DLQ growth, DB write latency, partition growth, Neon CU-hours. Raw graphs, not summaries. Feeds P4.1's dashboards with real thresholds instead of guesses. |
| P4.22 | Documented per-component limits | Replaces the arithmetic estimates in the 2026-08-02 review with measurements. |

### P4-B extension — Tenancy depth and domain model *(new)*

| # | Milestone | Detail |
|---|---|---|
| P4.23 | Re-validate the isolation audit | The 2026-06-05 read is two months old on a moving branch. Confirm, don't redo. |
| P4.24 | Host-path row scoping | Close the audit's Medium finding — host isolation currently holds "for the wrong reason". |
| P4.25 | OCPP ingest write-path guard | Close the audit's Medium finding — the consumer trusts the envelope `orgId` with no row guard. |
| P4.26 | **Operator-as-tenant** | The audit covered host isolation, not operator. Follow ADR 0031's own build note: `Organization.kind` gives way to **role-derived-from-agreements**, so an org holding `service_cpo` *is* a CPO. Decide shared-with-RLS vs per-operator isolation. |
| P4.27 | **EVSE layer** | Introduce EVSE between Charger and Connector. OCPP 1.6 tolerates its absence; OCPI does not, and the EVSE ID is the roaming-visible unit. Migrating this after a fleet lands, against live billing, is the expensive version of the same work. |

### P4-E — Operational read models *(new — F13, F14, F15)*

| # | Milestone | Detail |
|---|---|---|
| P4.28 | `fleet_state` projection | Current state keyed by connector, maintained by `lib/ocpp/projections.ts`. `listSiteTree` and the list endpoints read it instead of recomputing. |
| P4.29 | Console read path | Server-rendered first paint, stale-while-revalidate, stop blanking lists on refetch, UI state separated from server state. |
| P4.30 | Derived downtime periods | Availability as a *derived fact* from connector status and last-seen — the substrate P4.1's dashboards, SLA reporting and P6.1's issue engine all need. |
| P4.31 | Driver polling backoff | Focus-gated 10–15s instead of 3–4s. Cheap, no new infrastructure, and it removes the largest single source of database load. Full SSE/push stays at P6.2. |

---

## P7 — Fleet Acquisition *(new · Track F · market-triggered, parallel)*

**Goal:** onboard a thousand mixed-vendor chargers in an afternoon
instead of one at a time. **Depends:** P4.17 (subprotocol) hard; P4.12
and P4.20 strongly. **Parallel with:** everything.

| # | Milestone | Detail |
|---|---|---|
| P7.1 | Bulk claim from `pending_discoveries` | Select-all / select-some. The existing pending-discovery flow is already protocol-level self-service onboarding — this makes it usable at fleet scale. |
| P7.2 | Bulk claim from vendor credentials | List every charger visible under a credential; claim in one pass. |
| P7.3 | Vendor-agnostic identity provisioning | Carries the UX-2 / UX-3 fixes from the 2026-05-13 note: auto-fill vendor/model/serial from the identity prefix; respect `enforce_authorize` so no-auth installations are not issued a Basic-Auth password they cannot use. |
| P7.4 | Connect-storm tolerance | Verified against P4.20's connect-storm scenario. |
| P7.5 | Historical CDR import | On the existing `imported_cdr_refs` idempotency. Billing continuity for inherited customers. |

**Exit:** 1000 mixed-vendor chargers onboarded in one working session
without per-charger operator interaction.

---

## Fold-ins to existing phases

### P0.7 re-opens

P0.7 (*"pin driver-access-fee mechanics"*) was resolved by the
2026-06-14 ADR 0031 amendment — and that resolution introduced **F16**.
ADR 0031 item 4 forbids Straumvakt holding driver money on explicit
regulatory grounds; the amendment says Straumvakt *"collects"* and
*"remits"*. If the host is kröfuhafi and the claim settles directly, the
agent posture holds. If funds transit Straumvakt, the client-money
exposure item 4 rejected is live.

**This gates P1.3 and P1.6 exactly as the original P0.7 did.** Rule 5.

### P1 — Money Model & Billing

| # | Addition | Why here |
|---|---|---|
| P1.9 | **Tariff snapshots** per closed session (F18) | P1.6 generates invoices. An invoice that cannot be re-derived after an agreement changes is not defensible in a dispute. This belongs *inside* P1, not after it. |
| P1.10 | Credit notes | ADR 0031 item 15 requires them for metering disputes; they do not exist. P1.6's invoice engine needs the counterpart. |
| P1.11 | Retire `billing.sponsor_companies` (F17) | Superseded by the 2026-06-14 `service_workplace` structure; still listed as required follow-up. Remove before someone builds the wrong table. |

### P2 — Host & Driver Onboarding

- ADR 0027 and 0028, listed as **unwritten** in GOING_PUBLIC, **are now
  written**. P2.0 is done; update the prerequisite table.
- P2.2's "create host" flow should reach P7.1/P7.2's bulk claim, so a
  newly-created host can bring a fleet rather than chargers one at a time.

### P3 — Mobile Redemption & Localization

- P3.6 (live session feedback) and P3.7 (stop session) are listed as
  outstanding, but the shipped Flutter code does both.
  `driver-app-api/README.md` is stale by ~3 months — it marks Phases 2
  and 3 pending; only Phase 4 (polling → SSE → push) remains, which is
  P6.2. Re-verify and check these off rather than rebuilding them.

### P6 — Differentiators

Already correctly placed; this ADR only adds detail:

- **P6.1** issue engine — build on P4.30's derived downtime periods. A
  downtime period is a derived fact; an issue is a workstream
  referencing one. That split is what makes auto-resolution tractable:
  most of it is "the downtime period closed, so the issue can close."
  Target: the N1-1 `WeakSignal` flap produces one correlated issue, not
  forty.
- **P6.2 / P6.3** push + device registry — ADR 0023's fanout and ADR
  0030's registry. P4.31 takes the cheap half of the load problem now;
  this is the rest.
- **P6.4 backlog** additions: field service (contractors, work orders,
  visits, resolution — ADR 0034); dynamic load balancing via a
  `CircuitDurableObject` allocator with unmanaged-load measurement;
  **OSCP + OpenADR** for DSO integration; per-resource API versioning
  with signed webhooks; analytical reporting split from operational
  projections.

> **On OSCP.** Capacity forecasts arrive **per grid connection point** —
> which is `Installation`. The hierarchy layer generic CPMS platforms
> omit is what makes DSO integration land naturally: the forecast
> arrives at the Installation and is allocated down Circuit to Charger.
> The tree is an asset here, not legacy.

---

## Canon hygiene

Four documents currently carry a plan. This ADR does not add a fifth; it
adds phases to the ratified one. Outstanding reconciliation:

- **`gbtNotes/dc-readiness-sprint-plan.md`** (Sprints DC1–DC5+: OCPP
  2.0.1, connector-anchored sessions, cabinet power envelope and
  allocator, per-connector current limits, SmartCharging profile
  pipeline) is a parallel canon. It should be re-slotted as the **P6.4
  detail** for DC and smart charging — the same treatment ADR 0017 gave
  the original gbtNotes plan. Its allocator work is the same work as
  P6.4's load balancing.
- **`docs/architecture/README.md`** still says "10 sprints"; the
  documents CLAUDE.md points to as "start here" predate both the P-phase
  fold and this ADR.
- **`straumvakt_roadmap.svg`** and **`straumvakt_sprint_timeline.svg`**
  show the Sprint 0/1 boundary.
- **CLAUDE.md "Current state"** says *"Sprint −1 complete — login shell
  live"* and *"Prisma schema deliberately empty"*. Nine sprints stale.
- ~~**Duplicate ADR 0021**~~ (F20) — resolved 2026-08-02; autocharge is
  now ADR 0036.
- **Sprint task-list files** (`SPRINT_10_TASKS.md`,
  `SPRINT_11_TASKS.md`) are the P4 and P5 detail per GOING_PUBLIC's
  fold, but are still titled by their old sprint numbers.

## Infrastructure audit — Cloudflare + Neon, 2026-08-02

Read-only audit via authenticated `wrangler` and the Cloudflare API,
plus the Neon control plane. Recorded here because several findings are
phase blockers that exist in no other document.

### What exists

| Resource | Production | Staging |
|---|---|---|
| Workers | `hlada` (last deploy **2026-04-23**), `straumvakt-ocpp` (**2026-04-19**), `straumvakt` (**2026-04-19**) — all stale | `hlada-staging`, `hlada-api-staging`, `straumvakt-ocpp-staging` |
| `hlada-api` | **never existed** (API `code: 10007`) | ✅ |
| Queues | **none** | 6 — 3 live + 3 DLQ |
| R2 | **none** | `straumvakt-evidence-staging` |
| Hyperdrive | **none** | `straumvakt-staging` |
| KV / D1 | none | none |

Eight worker scripts exist in total; two are unaddressable hex-ID
entries (`025043728a…`, `6df04a9d24…`) that return `code: 10007` when
queried directly and belong to no Pages project. Benign, but
unexplained.

**Custom domains:** `straumvakt.org` + `www` → `hlada-staging`;
`api.straumvakt.org` → `hlada-api-staging`. The entire public surface
runs on staging Workers.

> ⚠️ **`straumvakt.org` is the only domain we own.** ISNIC rejected the
> `straumvakt.is` registration (operator, 2026-08-02). **This
> invalidates P5.1 and SPRINT_11 milestone 11.1**, both of which specify
> `app.` / `api.` / `ws.straumvakt.is` as the production domain layout.
> The production hostnames must be planned under `.org`.
>
> Two consequences:
> - **Technical:** the charger-facing hostname resolves to
>   `ws.straumvakt.org`, not `ws.straumvakt.is`. There is no `.is`
>   fallback to wait for, so the decision can and should be made now.
> - **Commercial:** an Iceland-focused platform selling to Icelandic
>   hosts, DSOs and retailers without the `.is` domain is a brand
>   exposure worth a deliberate decision rather than an accident. ISNIC
>   requires an Icelandic registrant connection; a re-application under
>   an Icelandic company kennitala may succeed where the first attempt
>   did not. Business action, not an engineering one — but it belongs on
>   the record.

**Cron:** `* * * * *` is deployed on `hlada-api-staging` (created
2026-05-06, modified 2026-06-14). It fires every minute, permanently.

**R2 archive is working end-to-end** — 353,730 objects / 154 MB,
location hint `EEUR`. ADR 0018 Decision 3 is verified live.

**Neon:** one project, `eu-west-2`, pg17, ~529 MB.

### Actions taken 2026-08-02

- Deleted orphan D1 database `straumvakt-db` (created 2026-04-21, zero
  tables, referenced in no config or source).
- Disabled `workers.dev` and previews on `hlada`, `straumvakt-ocpp` and
  `straumvakt`. All three were publicly reachable April artefacts. This
  is a reversible flag, not a deletion — the Workers still exist.

`hlada` held `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`AUTH_SECRET`, `OCPP_ADMIN_SECRET` and `OCPP_WEBHOOK_SECRET`, and — as
an April deploy — had **no rate-limiter bindings**, since those are
declared only in `env.staging`. With exactly one Neon project in
existence, that connection string necessarily pointed at the database
holding live billing data. It was an unthrottled admin login against
production data, running unpatched code, for roughly three months.
Reachability is now closed. **Secret rotation deferred by operator
decision 2026-08-02** — folded into the security-hardening work, not
done here.

### Phase blockers discovered

| Blocker | Phase affected |
|---|---|
| Hyperdrive connects as **`neondb_owner`**. Postgres exempts the table owner from RLS unless `FORCE ROW LEVEL SECURITY` is set, so P4.5 would deploy policies that never fire. The `straumvakt_app` role the task list assumes does not exist. | **P4.5** |
| **R2 lifecycle tiers cannot be expressed.** ADR 0017 §5 promises 7y/90d/7d/30d retention, but the key scheme in ADR 0018 Decision 3b — `<orgId>/<yyyy>/<mm>/<dd>/<chargerKey>/<eventId>.json.gz` — carries `retentionClass` in object metadata, not the key. R2 lifecycle rules match on key prefix only. A blanket rule would delete billing evidence alongside protocol noise. Today the bucket has one rule: the default multipart-abort. **Addressed by [ADR 0037](./0037-r2-key-scheme-retention-class-segment.md)** — retention class becomes the leading key segment, one lifecycle rule per class, and P4.15's archive gate becomes a fail-closed watermark read rather than a prefix count. | **P4.15**, ADR 0018 |
| **No branded charger hostname, and P5.1's target domain is unavailable.** Chargers connect to `straumvakt-ocpp-staging.straumvakt.workers.dev`. P5.1 and SPRINT_11 11.1 both specify `ws.straumvakt.is` — ISNIC rejected that registration, so the plan is void and there is nothing to wait for. The permanent hostname must be **`ws.straumvakt.org`**, and it should be attached to the gateway *before* P7 onboards a fleet. Otherwise every acquired charger is repointed twice: once onto `workers.dev`, then again onto the real hostname. | **P5.1**, **P7** |
| **Neon PITR is 6 hours** (`history_retention_seconds: 21600`) on the database holding real billing evidence, with no other backup — P5.3's daily-backup-to-R2 and restore drill are unbuilt. This is the thinnest recovery posture in the stack. | **P5.3** |
| **`block_public_connections: false`, `allowed_ips: []`** — no network restriction on the database. Any leaked connection string works from anywhere. | security hardening |
| R2 bucket location hint is `EEUR` while Neon is `eu-west-2` — auto-selected, and immutable after creation. P5.2's production bucket should specify its region deliberately. | **P5.2** |
| All three DLQs have **0 consumers**. Poison messages land and age out at retention, unobserved — the "1 stuck message" recorded 2026-05-13 expired silently. P4.3's DLQ alert is the fix. | **P4.3** |

### Settings worth knowing

- **`suspend_timeout_seconds: 0`** — Neon scale-to-zero is *disabled as
  a setting*. The 2026-05-13 note assumed 24/7 heartbeats were
  preventing autosuspend; it is switched off outright.
- **Hyperdrive `caching: disabled`** — every `listSiteTree` walk reaches
  Neon. Enabling it is a cheap lever but risks stale operator-facing
  charger status, which is the exact complaint ADR 0023 exists to fix.
  Not a trade to make without measurement.
- **Hyperdrive `origin_connection_limit: 60`** — a harder ceiling than
  any estimate in this ADR assumed. F15 projects ~70 req/s of driver
  polling alone at 1000 chargers. P4-D must measure against it
  explicitly.

## Consequences

**Positive.** Launch does not move — every hardening addition lands in a
phase that already runs parallel to Track E. P5.5's hidden dependency on
a non-existent load-test harness is surfaced before go/no-go rather
than at it. Two billing findings move *earlier*, into P1 where an
invoice engine is being built anyway. Schema changes that get more
expensive with fleet size (EVSE, operator tenancy) happen while the
fleet is small. No new numbering scheme.

**Negative.** P4 roughly triples in size. It was already the parallel
track carried by "different skill sets"; it is now the larger half of
the plan, and treating it as background work to Track E will not
survive contact with the fleet scenario.

**Risk.** P7 may need to run before P4.26 (operator-as-tenant). The
accepted cost is re-tenanting an already-loaded fleet. P4.17 is the one
P7 dependency with no workaround.
