# ADR 0040 — Tier storage by volume and access pattern, not by age

**Status:** Accepted — operator, 2026-08-03 (proposed 2026-08-02).
**Amends:** [ADR 0037](./0037-r2-key-scheme-retention-class-segment.md) §D2
(retention table) and [ADR 0039](./0039-split-protocol-log-from-event-log.md)
(its 2026-08-02 amendment). Both stand; this refines the tiers they set.
**Relates to:** [ADR 0018](./0018-data-platform-and-orm-boundary.md) §3c,
[ADR 0031](./0031-cost-model-and-money-flow.md) §15,
[ADR 0038](./0038-read-serving-tier-and-state-propagation.md).

---

## Context

ADR 0039's amendment fixed *what* is disposable (heartbeats, not every
OCPP frame). This ADR fixes *where things live*, which the earlier ADRs
answered by age alone.

The operator's proposal was three tiers: heartbeats readily available for
3 days, financial records for 12–24 months, everything past 24 months
moved to a separate archive database fetched by explicit, rate-limited
call.

The shape is right — hot/warm/cold with gated cold retrieval is the
standard pattern. One premise does not survive contact with the numbers.

### Financial records are not a volume problem

At 1000 chargers:

| data | rows/year |
|---|---|
| Events — heartbeats and protocol frames | ~730,000,000 |
| Sessions + ledger + invoices | ~91,000 |

Roughly **1000:1**. Seven years of every session, ledger entry and
invoice is ~640,000 rows — trivial for Postgres. One driver's five-year
invoice history is about sixty rows.

Archiving *records* past 24 months therefore buys nothing and costs a
second store to keep consistent, plus a retrieval path for data that
fits comfortably in the hot tier. [F23](./0035-multi-operator-scale-readiness-roadmap.md)
already shows what two stores cost when they drift.

**The volume is in the evidence behind the records, not the records.**

---

## Decision

### D1 — Tier by volume and access pattern

| Data | Postgres | Cold (R2) | Retrieval |
|---|---|---|---|
| Heartbeats | **3 days** | **not archived at all** | none — they are gone |
| Protocol frames / evidence (MeterValues incl. OCMF, Start/Stop, Status) | 7–30 days | indefinite | evidence bundle, on demand, **rate-limited** |
| Sessions, ledger, invoices | **indefinite** | — | instant, always |

Age is a consequence of the tier, not the thing that defines it.

### D2 — Financial records stay hot indefinitely

No 24-month cutover, no archive database, no retrieval gate. A driver
opening a 2023 invoice gets it instantly, the same as a 2026 one.

### D3 — Rate-limiting belongs on evidence retrieval

The operator's instinct to meter cold access is right; it was aimed one
level too high. Reading an old invoice is cheap and common. Requesting
the **signed meter evidence** behind a three-year-old session is rare,
expensive, and exactly what [ADR 0031 §15](./0031-cost-model-and-money-flow.md)'s
dispute flow needs — *"Straumvakt's logs are evidence the host uses to
decide."*

Gate the evidence bundle. Leave invoice reads alone.

### D4 — Heartbeats are not archived to R2

Currently every raw frame fans out to `ARCHIVE_QUEUE`, heartbeats
included. At 1000 chargers that is ~1.44M objects/day, ~43M Class A
operations/month — on the order of **$195/month to durably store data
with no long-term value**, before storage.

If a heartbeat is worthless after three days it is worthless in R2 too.
The long-term availability artifact is the **derived downtime period**
(P4.30), not the frames. Excluding `Heartbeat` from the archive fanout is
a small change in the queue consumer and is likely the cheapest saving
identified in this whole review.

This does not weaken evidence: heartbeats are never evidence of anything
billable. Losing them costs the ability to answer *"was this charger
reachable at 14:32 on a Tuesday nine months ago"* — which P4.30's
downtime periods answer better, and in a form SLA reporting can actually
use.

### D5 — R2 is the cold tier. No second database yet.

R2 already holds the evidence and is key-addressed, which serves
retrieval by org/date/charger — the shape an evidence bundle needs.

A second database earns its place only when cold data needs **querying**
rather than **fetching**. That threshold has not been reached, and F23 is
a live demonstration of what a second store costs when nobody is
watching it.

---

## Consequences

**Positive.** No archive database to build, operate or keep consistent.
Invoice history stays instant at any age. The retrieval gate lands where
the expensive operation actually is. R2 spend stops scaling with
heartbeat volume.

**Negative.** Postgres carries sessions and ledger rows indefinitely.
That is deliberate — at ~91k rows/year it is cheaper than the machinery
required to move them, and it removes a whole class of "where does this
record live" bug from the read path.

**Open — for the operator.** The 3-day heartbeat window is shorter than
ADR 0018 §3c's 7 days. Three days covers "what happened last night";
seven covers "what happened over a long weekend before anyone looked."
Cheap either way — the volume that matters is already excluded from R2 by
D4. Pick one and let ADR 0018 §3c be amended to match.

**Sequencing.** D4 is safe to ship immediately and independently. D1's
Postgres windows depend on ADR 0039's per-action classification landing
first — until frames are classified by action, no 7-day rule can be
switched on without deleting billing evidence.
