# Sprint 10 — Pilot Go-Live (admin-only, demonstrable) · Task List

**Status:** FUTURE — entry condition: Sprint 9 exit met.
**Branch:** `dev/sprint-10-pilot-go-live`.

> Sketch-level. See [delivery plan §13](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#13-sprint-10--pilot-go-live-admin-only-demonstrable).
> Drivers exist as inert admin-created records only. No driver-facing
> surface, no money movement, no Issue Engine.

---

## Milestone 10.1 — Real chargers onboarded
- [ ] If pilot site has Zaptec: run the Sprint 2.7 wizard against the
      pilot's Zaptec installation
- [ ] If non-Zaptec OCPP 1.6J: provision via the Sprint 2.5 admin
      flow with generated Basic-Auth
- [ ] Operator console shows chargers `Available`
- [ ] Vendor refs (`vendor_circuit_ref`, `vendor_installation_ref`)
      populated for Zaptec-managed

## Milestone 10.2 — Pilot driver records (inert)
- [ ] Admin creates `identity.users` rows + `tenancy.memberships` (role=driver)
- [ ] Each driver linked to ≥ 1 RFID idTag via `roaming.ocpi_tokens`
- [ ] No invite emails, no signup links — Rule 6 (no mock data) +
      ADR 0006 (no driver-facing surface) both apply

## Milestone 10.3 — Pilot session lifecycle
- [ ] Driver presents RFID at pilot charger → Authorize → StartTransaction
      → MeterValues → StopTransaction
- [ ] Session row + projection visible in operator console
- [ ] ≥ 10 real sessions complete during the pilot window without
      operator intervention

## Milestone 10.4 — Billing dashboard reviewed
- [ ] Operator reviews `/billing` weekly during pilot
- [ ] Per-driver and per-Host accumulated ISK reconciles to tariff
      engine output for every session
- [ ] No invoices issued — manual operator-side invoicing if needed
      (post-pilot work, not Straumvakt deliverable)

## Milestone 10.5 — Charge-log retention verified for ≥ 30 nights
- [ ] Aggregator job has fired ≥ 30 successful runs across the pilot
      window (Sprint 4's machinery)
- [ ] Spot-check: `raw_protocol` rows past TTL have aged out;
      financial / operational rows preserved
- [ ] Job log + spot-check captured in retro

## Milestone 10.6 — Runbooks finalised
- [ ] Incident response, backup restore, OCPP reconnect, retention-job
      monitoring, common operator tasks
- [ ] Living docs in `docs/runbooks/`

## Milestone 10.7 — Pilot retrospective + post-pilot plan
- [ ] `docs/retros/sprint-10.md` + `docs/retros/pilot-overall.md`
- [ ] Post-pilot plan ordering tags A–F:
      - Suggested order: F (unblock money) → B (drivers in front of users)
        → D (Issue Engine to scale ops) → A (roaming) → C (multi-currency)
        → E (real billing — depends on F payment provider being live)
- [ ] Decision log: which tag is sprint 11, which is sprint 12

---

**Risks:** Real hardware always surprises. Don't push a hotfix to
master under launch pressure — Rule 1 stays firm.
