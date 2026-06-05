# ADR 0034 — Contractor (Tengill) billing + contractor org model

**Status:** Proposed (2026-06-05) — org model is canon; billing math is the
open Rule-5 piece, specced here, implemented in P-billing.
**Related:** [ADR 0031](./0031-cost-model-and-money-flow.md) (money flow),
[ADR 0032](./0032-neighbour-helper-and-issue-engine-go-live.md) (contractor =
the paid escalation tier / Tengill), [ADR 0027](./0027-host-onboarding-operator-create-and-host-admin-invite.md)
(operator-created orgs).

## Context

ADR 0032 names **Tengill** as the default service provider (the paid escalation
tier when a host has no SLA contractor). ADR 0031 modelled money as
**driver → host, Straumvakt as agent** — it did *not* model paying contractors.
The operator clarified: **Straumvakt bills Tengill for all work created for
Tengill on the platform** — i.e. a contractor is *also a billable customer of
the platform*, not just a service party. That's a new money-flow direction
(platform → contractor) and a Rule-5 change, so it needs pinning.

## Decision

### 1. Contractor org model
A contractor is a **`tenancy.organizations`** row with:
- **`kind = 'company'`** — it is a billable company entity (so it can carry an
  Agreement + invoices), and
- **`roles` includes `service_contractor`** — it performs contractor work.

**Tengill ehf** is created this way (operator onboarding, ADR 0027, with a real
kennitala). It is both the **default** contractor (ADR 0032 fallback) and a
billable platform customer.

### 2. Who pays whom (extends ADR 0031)
Two distinct flows now coexist:
- **Job settlement (unchanged, ADR 0031/0032):** for a callout, the *driver*
  (escalation) or *host* (SLA monitoring) pays the contractor's rate; Straumvakt
  is the **agent** collecting/remitting. Money: payer → contractor (via Straumvakt).
- **Platform fee (new):** Straumvakt **bills the contractor** for *platform use*
  — the jobs routed to / handled by that contractor on the platform. Money:
  **contractor → Straumvakt**. This is the contractor's own monthly invoice from
  Straumvakt (a service/usage fee on contractor activity), separate from the
  job-settlement remittance.

So Tengill receives **remittance** for jobs done *and* an **invoice** from
Straumvakt for platform usage. Net is reconciled per ADR 0031's "Straumvakt
never holds driver money" principle: driver/host money passes through to the
contractor; the platform fee is billed to the contractor directly.

### 3. Fee basis (open — to confirm before billing code)
The platform fee on contractor work is **per-host-negotiated** like host terms
(ADR 0031 Q3): options are per-job, %-of-settled-amount, or monthly subscription.
**Decision deferred to the billing spec**; the org/Agreement structure above
carries whichever is chosen (factor-code set on Tengill's Agreement).

## Consequences

- **Enabled:** contractors are first-class billable orgs; Tengill maps to a real
  entity; the contractor console (jobs/settlement) has a real org behind it.
- **Rule 5:** the platform-fee math is **not** implemented until the fee basis
  (§3) is chosen and specced; only the org model (kind/roles) + the two-flow
  shape are pinned here.
- **Schema:** reuses Organization (`kind`, `roles`) + Agreement; a contractor
  platform-fee likely needs its own factor-code(s) — additive.

## Rejected
- **Contractor as a non-org service party only** (no `kind`) — rejected; it must
  be billable, so it needs `kind='company'` to carry an Agreement + invoices.
- **Folding contractor fees into the driver/host invoice** — rejected; the
  contractor is a distinct payer with its own platform relationship.
