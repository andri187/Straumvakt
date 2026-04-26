# Sprint 8 — Hardening · Task List

**Status:** FUTURE — entry condition: Sprint 7 exit met.
**Branch:** `dev/sprint-08-hardening`.

> Sketch-level. See [delivery plan §11](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#11-sprint-8--hardening).
> Payment provider + dunning + EU residency *ceremony* deferred per
> ADR 0005 (tag F).

---

## Milestone 8.1 — DEFERRED (payment provider, tag F)
- No tasks.

## Milestone 8.2 — DEFERRED (dunning, tag F)
- No tasks.

## Milestone 8.3 — Backup verification by restore drill
- [ ] `docs/runbooks/restore-drill.md` written
- [ ] Restore staging Neon to a scratch branch from a PITR point
- [ ] Run main app against the restored branch — login + read flow green
- [ ] Document time-to-restore and any surprises

## Milestone 8.4 — DEFERRED (EU residency *ceremony*, tag F)
- Posture (CF Data Localization, Neon EU, R2 EU, DO `locationHint=weur`)
  stays in place from Sprint 0–1; ceremony post-pilot.

## Milestone 8.5 — Load test OCPP gateway
- [ ] Multi-charger simulator script (1, 10, 100, 1000 chargers)
- [ ] Measure: CPU, memory, Service Binding latency, DO concurrency
- [ ] Document ceiling — must be ≥ 3× pilot scale (pilot ≤ 10 chargers)
- [ ] Results in `docs/runbooks/ocpp-gateway-load-test.md`

---

**Risks:** Restore drill always finds something. Allocate one full
day for fixes after the first run.
