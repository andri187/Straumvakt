# ADR 0037 — R2 key scheme: add a retention-class segment

> **LEGACY — pre-market-focus historical reference. Not active canon. See /FOCUS.md. Load-bearing constraints extracted into the focus rules.**

**Status:** Accepted — operator, 2026-08-03 (proposed 2026-08-02).
**Amends:** [ADR 0018](./0018-data-platform-and-orm-boundary.md)
Decisions **3b** (key scheme) and **3c** (retention policy). Decision 3a
(one bucket per env) and 3d (separate archive consumer) stand unchanged.
**Blocks:** P4.15 (partition retention) in
[ADR 0035](./0035-multi-operator-scale-readiness-roadmap.md).

---

## Context

P4.15 implements partition detach-and-drop, gated on rows being
confirmed present in the R2 archive. Working through that gate surfaced
that **ADR 0018's tiered retention policy cannot be expressed against
its own key scheme.**

ADR 0018 §3c commits to four retention tiers:

| Class | Retention |
|---|---|
| Billing-touched | 7 years |
| Operational | 90 days |
| Heartbeat | 7 days |
| Diagnostics | 30 days |

ADR 0018 §3b chose the key scheme:

```
<orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz
```

and justified it: *"Lifecycle rules being prefix-by-date is the deciding
factor."*

**That justification does not hold, in two distinct ways.**

1. **R2 lifecycle rules do not need a date in the key.** Expiry is
   computed from the object's own creation time. The date segment buys
   human browsability and per-day forensics — both real — but it was
   never load-bearing for lifecycle.

2. **Tiered expiry needs the retention class in the key prefix, and it
   is not there.** `archive-events.ts` writes `retentionClass` into
   object metadata ([line 108](../../apps/api/src/queues/archive-events.ts#L108)),
   not the key. R2 lifecycle rules match a **literal string prefix**;
   they cannot read metadata and cannot use wildcards. So there is no
   rule that expresses "expire heartbeat objects after 7 days but keep
   billing objects for 7 years."

The consequence is not theoretical. Today the bucket carries **353,730
objects and exactly one lifecycle rule** — R2's default
abort-incomplete-multipart. Nothing expires, everything sits in Standard
class, and a naive prefix rule added later would delete **billing
evidence alongside heartbeat noise**, because the two are
indistinguishable by key.

Under ADR 0031 §15 a metering dispute is decided on Straumvakt's logs as
evidence, and OCMF-bearing frames are that evidence. Losing them to a
misconfigured lifecycle rule is a business failure, not an ops one.

---

## Decision

### D1 — Retention class becomes the leading key segment

```
<retentionClass>/<orgId>/<yyyy>/<mm>/<dd>/<chargingStationId>/<eventId>.json.gz
```

Example:

```
financial/019a.../2026/08/02/03f1.../8c2e....json.gz
raw_protocol/019a.../2026/08/02/03f1.../41bd....json.gz
```

`retentionClass` is the existing enum already carried on every envelope:
`financial`, `operational`, `raw_protocol`, `aggregate`, `issue_history`.

### D2 — One lifecycle rule per retention class

Bucket-wide, one rule per leading prefix. Ages per ADR 0018 §3c, mapped
onto the actual enum:

| Prefix | Expiry | Basis |
|---|---|---|
| `financial/` | **none** (7y, reviewed) | Iceland VAT / accounting law |
| `operational/` | 90 days | Incident investigation window |
| `raw_protocol/` | 7 days | ADR 0017 §5 |
| `aggregate/` | none | Small, derived, cheap to keep |
| `issue_history/` | 90 days | Aligns with operational |

`financial/` gets **no expiry rule at all** rather than a 7-year one.
A seven-year timer is a loaded gun pointed at billing evidence with a
very long fuse; deleting it should be a deliberate act with a human
attached, not something that fires unattended in 2033.

### D3 — Per-tenant operations iterate class prefixes

The cost of leading with retention class is that a per-tenant operation
(GDPR erasure, tenant export) is no longer a single prefix scan — it
becomes one scan per class, five at present.

Accepted. Five LIST prefixes instead of one is a trivial cost on an
operation that is rare, asynchronous, and already batch-shaped. The
alternative — leading with `orgId` — makes bucket-wide class rules
impossible, because R2 prefixes are literal and `*/financial/` is not a
valid prefix. That would require one lifecycle rule per (org × class),
growing with tenant count against R2's per-bucket rule cap. Under a
multi-operator scenario that ceiling is a real constraint, not a
theoretical one.

### D4 — Existing objects are left in place

The 353,730 objects already written under the old scheme stay where they
are. They total ~154 MB — the cost of leaving them indefinitely is
immaterial, and rewriting them means reading and re-putting every object
for no operational gain.

The legacy prefix is **frozen** the moment the new scheme ships: it
receives no new writes and therefore cannot grow. Evidence-bundle reads
must check both layouts during the retention window of the oldest legacy
object; after that the legacy prefix can be dropped in one operation.

Do **not** add a catch-all lifecycle rule to sweep the legacy prefix —
it contains billing-class objects that are indistinguishable by key,
which is the entire defect this ADR exists to fix.

### D5 — Archive confirmation for P4.15

P4.15 may only drop a partition once its rows are confirmed archived.
Prefix-listing to count objects is rejected: it is O(objects), racy
against in-flight writes, and now spans multiple class prefixes per day.

Instead the archive consumer records completion. A small table —
`events.archive_watermark` keyed by `(retention_class, day)` — carries a
count of objects written and the timestamp of the last write. The
partition-drop cron compares the row count in the partition against the
watermark for that day and refuses to drop on any mismatch.

This makes the gate a single indexed read, gives the operator something
observable, and fails closed: **no watermark row means no drop.**

---

## Consequences

**Positive.** The tiered retention policy ADR 0018 committed to becomes
implementable. Storage stops growing without bound. P4.15 gains a cheap,
fail-closed gate. Billing evidence becomes structurally distinguishable
from protocol noise rather than distinguishable only by metadata no
lifecycle rule can read.

**Negative.** Per-tenant operations cost five prefix scans instead of
one. Two key layouts coexist until the legacy prefix ages out. The
archive consumer gains a write it did not have — a watermark upsert per
batch — which is a small addition to a path ADR 0018 §3d deliberately
kept independent of the Postgres ack.

**Migration.** `buildArchiveKey` in
[`apps/api/src/queues/archive-events.ts`](../../apps/api/src/queues/archive-events.ts)
gains the leading segment. The envelope already carries
`retentionClass`, so no producer change is needed. Evidence-bundle reads
gain a legacy-prefix fallback. Lifecycle rules are applied per D2 —
against **staging first**, verified over at least one full expiry cycle
before production, because a lifecycle rule is the one R2 operation with
no undo.

**Open — for the operator.** The `financial/` 7-year figure is inherited
from ADR 0018 as "Iceland VAT / accounting law." That should be
confirmed against actual Icelandic bókhaldslög retention requirements
before it is treated as settled; this ADR carries the number forward
without re-verifying it.
