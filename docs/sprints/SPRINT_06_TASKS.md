# Sprint 6 — Billing Dashboard (read-only) · Task List

**Status:** FUTURE — entry condition: Sprint 5 exit met.
**Branch:** `dev/sprint-06-billing-dashboard`.

> Sketch-level. See [delivery plan §9](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#9-sprint-6--billing-dashboard-read-only-for-pilot).
> Driver-side dashboard view (was 6.3) deferred per ADR 0006 (tag B).

---

## Milestone 6.1 — Tariff-engine session cost projection
- [ ] On `transaction.stopped`, run tariff engine and persist
      `charging.sessions.cost_minor`
- [ ] Period rollup table or query (per-day, per-month)
- [ ] 10 simulator-generated sessions match engine output exactly

## Milestone 6.2 — Operator billing dashboard
- [ ] `/billing` page (scaffold from 2.9) lights up: per-driver
      totals, per-Host totals, per-period rollups, drill-down to
      individual sessions
- [ ] Read-only — no actions, no buttons that mutate

## Milestone 6.3 — DEFERRED (driver dashboard, tag B)
- No tasks. Schema available; ships with Driver Experience post-pilot.

## Milestone 6.4 — DEFERRED (invoice generation, tag E)
- No tasks. Schema (`billing.invoices`, `billing.invoice_lines`)
  available; ships post-pilot.

---

**Risks:** Dashboard total ≠ tariff-engine output → trust collapse.
Validate against engine in unit tests, not visual review.
