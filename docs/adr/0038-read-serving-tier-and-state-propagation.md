# ADR 0038 — Read-serving tier: no UI read reaches a base table

**Status:** Proposed — 2026-08-02.
**Constrains:** [ADR 0023](./0023-realtime-connector-status-propagation.md)
— its polling decision was taken before any serving tier existed and is
re-opened here, not discarded.
**Builds on:** [ADR 0035](./0035-multi-operator-scale-readiness-roadmap.md)
P4.18 (authorize verdict caching in DO storage), P4.21 (Neon CU-hours as a
measured scale metric).
**Corroborated by, not derived from:** the
[2026-08-02 AMPECO note](../notes/2026-08-02-ampeco-benchmark-change-suggestions.md).
That benchmark was read to find *purposes* worth serving, not a shape
worth copying. Where it names a capability we lack, the capability is
adopted; where it names an implementation, we are free to do better —
and §D3 does.
**Relates to:** [ADR 0013](./0013-split-ui-api-do-queues.md),
[ADR 0018](./0018-data-platform-and-orm-boundary.md),
[TENANT_ISOLATION_AUDIT.md](../architecture/TENANT_ISOLATION_AUDIT.md).

---

## The one-paragraph version

Every read in the system — driver app, operator console, host portal —
goes API Worker → Hyperdrive → Neon and recomputes its answer from base
tables. There is **no serving tier**: the API Worker has Hyperdrive, R2,
two queues, a gateway service binding and rate limiters, and **no KV, no
Durable Objects, no cache**. On top of that absence, ADR 0023 committed
the driver app to a 10–15 s poll and the operator console to continuous
refresh. That is a foundation defect, not a performance tuning item: it
sets the cost and latency floor for every feature built above it, and
every new read path added meanwhile deepens it. This ADR separates three
concerns that have been conflated — **projection** (what the current
state *is*), **serving** (where a read is answered from), and
**transport** (how a change reaches a screen) — and sets one invariant:
**no UI read path queries base tables directly.**

---

## Context

### What exists today

`apps/api/wrangler.jsonc` binds `HYPERDRIVE_DB`, `EVIDENCE_BUCKET`,
`OUTBOUND_QUEUE`, `ARCHIVE_QUEUE`, `OCPP_GATEWAY`, and rate limiters.
There is no KV namespace and no Durable Object binding in the API tier;
the only DO in the system is `IdentityDurableObject` in the gateway.

So every `GET /api/*` is a Neon round trip, and several recompute rather
than read. The AMPECO note already records the worst case: `listSiteTree`
"walks the full hierarchy with aggregates and credential decrypt per
request, uncached."

### Why this is foundation, not optimisation

Three properties are being fixed by default rather than by decision:

1. **Cost floor.** Neon bills compute and autoscales CU. The staging
   branch shows 68 517 CPU-seconds against 147 556 active-seconds. P4.21
   already names Neon CU-hours as a scale metric to measure — but a
   metric measured against an architecture with no serving tier measures
   the wrong thing.
2. **Latency floor.** A driver standing at a charger waits for the next
   poll tick, not for the event. No amount of upper-floor work removes
   that.
3. **Blast radius.** Every new read endpoint inherits the pattern. The
   Tap & Auth tap-intent work (2026-08-02) added another one before this
   was noticed — correct as written, wrong tier.

### What ADR 0023 decided, and why it needs re-opening

ADR 0023 chose "smart polling + silent push": 10–15 s foreground poll,
stop when backgrounded, immediate post-action refresh, FCM/APNs for
background events. That was a reasonable call **given no serving tier**
— Workers "can't naively push from the projection to N clients," as it
says. The constraint it reasoned from is the thing this ADR removes.

Its own note is the tell: fanout "has nothing cheap to invalidate
without" a current-state projection (AMPECO S-1). Polling was the
fallback for a missing layer, not a preference.

---

## Decision

### D1 — Three tiers, split by volatility, not by feature

| tier | data | served from | staleness budget |
|---|---|---|---|
| **Hot** | connector status, active-session power, charger online, tap outcome | Durable Object per installation, in memory | push — sub-second |
| **Warm** | charger lists, site tree, tariffs, driver access, org settings | KV (or Hyperdrive query cache as the interim), explicit invalidation on write | seconds to minutes |
| **Cold** | session history, invoices, ledgers, reports, audit | Postgres directly, **never cached** | exact, always |

The tier is a property of the *data*, not of the endpoint that happens
to want it. A screen that mixes tiers composes from all three rather
than dropping to the lowest.

**Cold is never cached.** Serving a stale invoice is a worse failure than
any latency this ADR fixes. Financial and audit reads keep going to the
base tables, and that is deliberate.

### D2 — The invariant

> **No UI read path queries base tables directly, except Cold-tier reads.**

This is the foundation rule everything above must satisfy. It is
checkable in review, and it is what makes the tiering hold as features
accumulate rather than eroding one endpoint at a time.

### D3 — The live object *is* the read model

Two ways to build the Hot tier. They are not equivalent, and the
conventional one is the weaker fit for this stack.

**Option A — projection table (the conventional CPMS shape).** A
`fleet_state` table maintained by `lib/ocpp/projections.ts`, keyed by
connector, holding status + `statusUpdatedAt` + last-seen. Reads hit the
table instead of recomputing. This is what a mature CPMS API looks like
from the outside, and it is what the AMPECO benchmark exhibits.

It also keeps every property this ADR is trying to remove: the state
lives in Postgres, clients still poll it, and it is now a *second* source
of truth that can drift from the frames that produced it.

**Option B — the DO that owns the charger owns its state.** Straumvakt
already terminates OCPP in `IdentityDurableObject`, keyed per identity.
The live state is *already in memory in that object* at the moment it
changes — it is currently discarded after projection. Instead: keep it,
expose it, push deltas to subscribers.

What this buys that Option A cannot:

- **No invalidation problem for Hot data at all.** There is nothing to
  invalidate, because the serving copy is the origin — not a copy of it.
  The hardest failure mode in any cache layer simply does not arise.
- **State lives next to where it is produced**, at the edge, one hop
  from the charger. Not a round trip to a table in eu-west-2.
- **Push is native, not bolted on.** The object that learns of the change
  is the object holding the subscriber sockets.
- **Postgres returns to being the durable log and audit record**, which
  is what it is good at, instead of doubling as the serving path.

**Decision: Option B for Hot, with Postgres as the durable record.**
Projection writes continue exactly as today — they are the history and
the recovery source — but they stop being what a screen reads.

**What Option B must answer, and the honest risks.** A DO can be evicted
and must rehydrate from Postgres on cold start; a single object has
throughput limits; hibernation and socket lifecycle need handling; and a
DO is single-region, so a distant operator sees the round trip a table
would also have cost them. Rehydration is the one that must be designed
rather than discovered — the durable record has to be sufficient to
reconstruct live state, which is a constraint on the projection schema,
not an afterthought.

**Where Option A survives.** Warm-tier and report-shaped data — the
financial materialisations, settlement records, anything a screen
paginates rather than watches — are genuinely better as tables. Option B
is a claim about *live* state only.

### D4 — Transport follows tier

- **Hot** — WebSocket/SSE from the installation DO. This replaces ADR
  0023's foreground polling for status. FCM/APNs survives unchanged for
  background events; push-to-wake was never the problem.
- **Warm** — normal request/response against the cache, with
  `Cache-Control`/ETag so a repeat render is free.
- **Cold** — request/response, uncached, user-initiated.

ADR 0023's decisions that survive: stop polling when backgrounded,
pull-to-refresh always available, silent push for background events.
The 10–15 s foreground tick is superseded for Hot-tier data.

### D5 — Tenancy is part of the cache key, by construction

Every Warm-tier key carries the org scope; no key is derivable without
it. Every DO is keyed by an installation that belongs to exactly one
org. A read layer is the classic place for cross-tenant leakage, and
`TENANT_ISOLATION_AUDIT.md`'s guarantees must extend to cached reads
rather than stopping at the query layer.

### D6 — Invalidation is owned by the repositories

Rule 7 already routes every write through `repositories/*`. That is the
only place invalidation can be enforced without relying on discipline.
A write that bypasses the repository layer silently serves stale data —
so this ADR makes repository-mediated writes load-bearing rather than
stylistic.

### D7 — P4.18 is a special case of this, not a separate mechanism

ADR 0035's P4.18 ("Authorize verdict caching in DO storage, Rule 5
gate") is Hot-tier serving for the authorize path. It should use this
ADR's DO rather than growing a parallel cache with its own invalidation
rules. Its Rule 5 gate stands: nothing here changes the shadow-mode →
enforced flip in either direction.

---

### D8 — Capabilities to preserve, however we build it

The benchmark surfaced three *purposes* worth serving. They are
requirements on the outcome, not instructions about mechanism, and D3's
Option B satisfies all three differently from how a projection table
would:

1. **Current state and history are separate contracts.** A consumer
   asking "what is this connector doing now" must not have to read a log
   and infer. Under Option B, `.../status` is a snapshot of the live
   object and `.../status-log` is the durable history — one source, two
   access shapes, rather than two tables that can disagree.
2. **Financial and report data are materialised entities, not report
   generators run per request.** Revenues, expenses, settlement records.
   This is Warm/Cold work and is unaffected by D3.
3. **Read models are part of the public contract**, versioned as such —
   not internal caches that consumers are told to ignore.

None of these require copying anyone's API shape. They are the floor
below which a CPMS is missing functionality, and the ceiling is ours to
raise.

---

## Consequences

**For what is already built.** The Tap & Auth tap-intent repository
(2026-08-02) is Hot-tier data currently living in Postgres. The
repository interface is the seam — `matchAndConsumeTapIntent` moves
behind the DO without touching the resolver or the app. It is correct as
written and should not be rewritten before the tier exists.

**For the driver app.** `TapIntentController` and the BLE scanner are
unaffected. The "did my tap work" signal becomes a DO push instead of an
absent capability.

**For `listSiteTree`.** The worst offender becomes the first Warm-tier
migration, and the credential decrypt per request has to move out of the
read path regardless.

**New failure modes this introduces.** A cache is a second source of
truth: stale reads on missed invalidation, cross-tenant leakage on a
malformed key, and DO cold-start latency on the first read after
eviction. These are real and are the price of the tier — they are
bounded by D5, D6, and by keeping Cold uncached.

---

## Open questions — operator's call

1. **KV or Hyperdrive query cache for Warm?** Hyperdrive is bound today
   and needs no code; KV gives explicit invalidation. Interim vs
   destination, or skip the interim.
2. **DO granularity** — per installation, or per site? Installation
   matches the OCPP identity grain and the gateway's existing DO keying;
   site would mean fewer objects and coarser invalidation.
3. **Does the driver app get a socket, or only the operator console?**
   Mobile sockets cost battery and reconnect handling; the operator
   console is the continuous-refresh surface.
4. **Where does this sit in P4?** It is a prerequisite for P4.21 being
   meaningful, which argues for early — but it is larger than the other
   P4 items.

---

## Status of this document

Proposed. No code written. The tap-intent modules from 2026-08-02 remain
Postgres-backed and are not blocked by this ADR; the resolver hook they
depend on is separately Rule-5 gated and still unapproved.

---

# Addendum — 2026-08-02 — RLS × serving tier, and the single event spine

Written after a foundation gap-check across the sprint plan, the
critical path, the tenant-isolation audit and the 2026-06-14 system
review. Three collisions surfaced that the body above did not account
for.

## A. The collision: P4.5 (RLS) versus this ADR

P4.5 commits to Postgres row-level security as the tenant-isolation
backstop. The [tenant audit](../architecture/TENANT_ISOLATION_AUDIT.md)
rates today's state *"DB/RLS backstop — ❌ None — isolation is 100%
app-layer"* (High), with ~40 unscoped admin repositories described as
"safe-by-accident" and bootstrap sessions as unconditional god-mode.

**RLS protects rows read through Postgres. This ADR moves reads out of
Postgres.** Ship the tier first and RLS arrives guarding a shrinking
fraction of the read surface — the compliance box ticked while the
actual read paths route around it. Ship RLS first and the tier steps
around it later, silently. Neither document references the other.

### Decision — enforce tenancy twice, at two different moments

**A1 — At fill time, RLS still applies.** Every hydration of a Hot or
Warm entry runs through an RLS-scoped Postgres session. Nothing enters
the serving tier that was not already row-filtered by the database. RLS
therefore remains the real backstop rather than becoming decorative, and
P4.5 keeps its full value: it guards the fill path, which is the only
path by which tenant data enters the tier at all.

**A2 — At serve time, the object is single-tenant by construction.**
Every Hot object is keyed by an entity belonging to exactly one org —
**installation grain, not site and not region**. A single-tenant object
cannot mix tenants: there is no `where` clause to forget, because there
is no query. Warm keys embed the org scope such that a key is not
derivable without it.

Together these convert the hardest failure mode in any caching layer —
cross-tenant leakage from a malformed key or a missing scope — from a
discipline problem into a structural impossibility. That is a stronger
guarantee than the app-layer scoping the audit currently rates
"safe-by-accident," not a weaker one.

**A3 — This resolves open question 2.** DO granularity is *installation*,
and the reason is tenancy, not performance.

**A4 — Cold-tier reads keep going to Postgres under RLS**, unchanged.

### Consequence for sequencing

P4.5 and this ADR stop being alternatives and become ordered: **RLS
first, tier second.** The tier's fill path depends on RLS existing to be
worth anything, and RLS is cheaper to add before there are non-Postgres
read paths to audit.

## B. One event spine, not two

[Architecture V3 §7](../architecture/STRAUMVAKT_ARCHITECTURE_V3.md)
already specifies a **Push API** as a first-class subsystem — "a
subsystem, not a bag of routes" — with a fixed vocabulary
(`transaction.started`, `transaction.updated`, `transaction.stopped`,
`transaction.billed`, `charger.added`, `connector.status_updated`,
`card.authorize_request`, `issue.opened`, `issue.resolved`), signed HTTP
POST, idempotency keys, durable retry, a per-tenant subscriber registry
and a DLQ. Nothing implements it.

**That is the same machinery as this ADR's Hot tier.** One fanout, one
vocabulary, two subscriber shapes:

| subscriber | transport | consumer |
|---|---|---|
| internal | WebSocket/SSE from the installation DO | operator console, driver app, host portal |
| external | signed HTTP POST, retry, DLQ | ERP, CRM, fleet ops, analytics |

**Decision:** the Hot tier and the Push API are one subsystem. V3 §7
defines the event contract; this ADR defines delivery. Built separately
they become two pipelines with drifting event names, and the drift
surfaces first in partner integrations, where it is most expensive to
repair.

**Follow-up owed:** V3 §7 gains a pointer to this ADR. Not edited here —
another agent is actively working in the tree and §7 is under Rule 5's
protected list.

## C. P6.2 and P4_TASKS disagree about what "push" means

`P4_TASKS.md` states that only "Phase 4 (polling → SSE → push) remains,
and that is P6.2." But P6.2 in the critical path is *"Push notifications
— FCM + APNs, `push_token` on User, send queue"* — mobile notification
delivery, which is a different thing from an SSE read transport.

They are complementary, not substitutes: **FCM/APNs wakes a backgrounded
app; SSE/WebSocket serves a foregrounded one.** ADR 0023 already made
that split correctly and neither doc reflects it.

**Decision:** SSE/WebSocket read transport belongs to this ADR and is
sequenced with the serving tier, **not** deferred to P6.2. P6.2 keeps
FCM/APNs background delivery and is unaffected. `P4_TASKS.md`'s "that is
P6.2" line is wrong and is corrected in this pass.

## D. Invariants — proposed, not yet binding Rules

Two invariants fall out of the above. They are stated here as ADR
invariants and **deliberately not added to `CLAUDE.md` yet**, because a
Rule that current code universally violates trains people to ignore
Rules. Promote them when the tier ships:

> **I-1 — Read tiering.** No UI read path queries base tables directly,
> except Cold-tier reads (session history, invoices, ledgers, audit).
> Cold-tier reads are never cached.

> **I-2 — Tenancy by construction.** Every cached or in-memory read key
> carries the tenant scope, and every Hot object is single-tenant
> (installation grain). Fill goes through an RLS-scoped session.

I-2 is safe to promote to a Rule immediately — nothing violates it today
because no cache exists, so it binds only new work. I-1 cannot be
complied with until the tier exists.

## E. Related gaps found in the same pass, owned elsewhere

- **ADR 0030 (device registry, `identity.app_devices`) is cited by P6.3
  but was never written.** It is the natural home for per-device driver
  identity, including the device-handle work sketched in the 2026-08-02
  Tap & Auth note. That design should land there rather than growing a
  parallel one.
- **Launch blocker #4 — CDR-vs-OCPP ledger double-count** — remains open
  and is upstream of everything financial. Not this ADR's scope, but it
  compounds while unresolved.
- **Four Flutter trees**, with the canonical one (`apps/driver`) holding
  neither the BLE scanner nor the i18n work. Operator has taken this as
  a separate cleanup priority.
