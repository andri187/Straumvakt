# Sprint 5 — Commercial Model (ISK only) · Task List

**Status:** FUTURE — entry condition: Sprint 4 exit met.
**Branch:** `dev/sprint-05-commercial-model`.

> Sketch-level. See [delivery plan §8](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#8-sprint-5--commercial-model-isk-only-for-pilot).
> CLAUDE.md Rule 5 territory throughout — every billing-math change
> requires an explicit summary + approval.

---

## Milestone 5.1 — CustomerPlan schema in full richness
- [ ] Repo + API + admin form covering products, tariffs, displays,
      country/currency, balance type, category, termination behaviour
- [ ] Round-trip test: every field survives create→fetch

## Milestone 5.2 — ChargerServicePlan schema
- [ ] Repo + API + admin form for revenue share, electricity
      reimbursement, maintenance, platform fee, default tariff, term
- [ ] Attach to a Host; rule cascades to Host's chargers

## Milestone 5.3 — Tariff engine
- [ ] Pure function `computeSessionCost(session, tariffChain): CostBreakdown`
- [ ] Energy cost + time cost + overtime + total + tax
- [ ] No I/O; fully unit-testable
- [ ] 10 hand-computed scenarios covering each tariff type pass

## Milestone 5.4 — Plan selection logic
- [ ] Priority resolver: user override > site > Host default > org default
- [ ] 4 priority test scenarios green

## Milestone 5.5 — Locale + ISK posture
- [ ] `is-IS` + `en-GB` plan rendering green
- [ ] EUR plan creation blocked at form layer; schema accepts it (post-pilot)

---

**Risks:** Rule 5. Don't ship invoice math without an explicit
review of the change summary.
