# Sprint 3 — OCPI Foundation (CPO-only) · Task List

**Status:** FUTURE — entry condition: Sprint 2 exit met.
**Branch:** `dev/sprint-03-ocpi-cpo` (cut from `staging`).

> Sketch-level. Refines into task-level when Sprint 2 closes and we
> retro into this sprint. See [delivery plan §6](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#6-sprint-3--ocpi-foundation-cpo-only-for-pilot)
> for the milestone definitions.

---

## Milestone 3.1 — CPO endpoints

- [ ] `/ocpi/cpo/2.2.1/locations` — projection from
      `properties.sites` + `assets.chargers` + `ocpp.connectors`
- [ ] `/ocpi/cpo/2.2.1/sessions` — projection from `charging.sessions`
- [ ] `/ocpi/cpo/2.2.1/cdrs` — projection from completed sessions
      with cost
- [ ] `/ocpi/cpo/2.2.1/tariffs` — projection from `billing.tariffs`
- [ ] `/ocpi/cpo/2.2.1/tokens` (authorize) — RFID lookup → user
- [ ] Auth: OCPI Credentials module (Bearer token, party-ID matching)
- [ ] Vendored OCPI 2.2.1 JSON Schemas in `docs/vendors/ocpi/2.2.1/`

## Milestone 3.2 — eMSP endpoints (deferred per ADR 0005 tag A)

- No tasks — schema (`roaming.external_properties`,
  `roaming.cdr_queue`) stays in place from Sprint 0.

## Milestone 3.3 — Token translator (CPO-receive only)

- [ ] `roaming.ocpi_tokens` lookup path wired into OCPP authorize
      handler in the gateway
- [ ] Local RFID UID resolution (already partially in place from
      Sprint 2.2 driver-RFID linking)
- [ ] Authorize response schema match with OCPI 2.2.1
- [ ] Tests: 4 token-resolution scenarios (local RFID, OCPI token,
      unknown idTag, expired token)

## Milestone 3.4 — Hub connector scaffold

- [ ] `roaming.hub_connections` repo + admin CRUD page
- [ ] No live partner credentials — schema only

## Milestone 3.5 — Contract tests

- [ ] `npm run test:ocpi-contract` script
- [ ] Nightly CI hook
- [ ] First passing run committed

---

**Risks:** OCPI 2.2.1 ambiguity — book 2–3 days of spec reading before
coding 3.1. Don't shortcut by reading the spec out of order.
