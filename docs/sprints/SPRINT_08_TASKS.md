# Sprint 8 — Tariff Engine + Billing Dashboard · Task List

**Status:** FUTURE — entry condition: Sprint 7 exit met (hot ingest
+ R2 archive live).
**Branch:** `dev/sprint-08-tariff-and-billing`.

> Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> Picks up the original Sprint 5 (Commercial Model) + original Sprint
> 6 (Billing Dashboard) on top of Sprint 7's report-ready datasets.
> Plus parallel tracks for driver self-registration + impersonation
> (slipped from Sprint 5 per ADR 0017) and sub-resource route
> `assertPermission` retrofits (carry-forward from Sprint 4 — needs
> invite-issued userIds in sessions, which Sprint 5 delivered).

---

## Track A — Tariff engine + billing dashboard

> Rule 5 territory throughout. Stop-and-summarize before each
> milestone's code lands. Synthetic-scenario tests are the only way
> to validate billing math.

### Milestone 8.1 — `CustomerPlan` + `ChargerServicePlan` schema

- [ ] `CustomerPlan` model: `id, orgId, name, currency, products[],
      tariffs[], displays[], balanceType, category,
      terminationBehavior`. Operator-instructed Rule 4 + Rule 5
      schema migration.
- [ ] `ChargerServicePlan` model: `id, orgId, name, revenueShareRule,
      electricityReimbursementRule, maintenanceResponsibility,
      platformFeeModel, defaultTariffId, term`.
- [ ] Repo: `apps/api/src/repositories/customer-plans.ts` +
      `charger-service-plans.ts`.
- [ ] Routes: `POST/GET/PATCH /api/admin/customer-plans/:id` +
      `/charger-service-plans/:id`. Permissions:
      `tariff.read | tariff.write`.
- [ ] Tests: full create → read round-trip; all fields preserved.

### Milestone 8.2 — Pure-function tariff engine

- [ ] `apps/api/src/lib/tariff/compute-session-cost.ts`:
      `computeSessionCost(session, tariffChain): CostBreakdown`.
      No I/O. No globals. Returns `{ energyCostMinor, timeCostMinor,
      overtimeMinor, totalMinor, taxMinor, currency, lineItems[] }`.
- [ ] Inputs typed: `Session = { startedAt, stoppedAt, kWh,
      kWhSamples[], chargerId, connectorId }`. `TariffChain =
      { primary, fallbacks[] }`.
- [ ] Time-of-use rules: peak/off-peak windows by weekday + hour.
- [ ] Per-connector + per-speed differentials.
- [ ] Overtime penalty after `parkingGraceMinutes`.
- [ ] **Stop-and-summarize before code lands** — Rule 5.
- [ ] Ten hand-computed scenarios in `tests/tariff-scenarios.test.ts`.
      Pass exactly (no rounding drift).

### Milestone 8.3 — Plan-selection priority resolver

- [ ] `resolveCustomerPlan(userId, siteId, chargerId): CustomerPlan` —
      walks priority chain: user override → site default → Host
      default → org default. Returns first match.
- [ ] Tests: 4 priority scenarios (each level wins once).
- [ ] Operator UI surface: `/sites/[id]/tariff` shows the resolved
      plan + which level overrode it.

### Milestone 8.4 — Operator-side billing dashboard

- [ ] `/billing` page reads from `billing.period_summary` (Sprint
      7.6) + `billing.session_ledger` (Sprint 7.6 + 8.5).
- [ ] Tiles: per-driver totals, per-Host totals, per-period rollups.
- [ ] Drill-down: click a driver → list of sessions; click a
      session → cost breakdown from tariff engine.
- [ ] Read-only: no actions, no buttons that mutate billing state.
- [ ] Permissions: `billing.read`.
- [ ] Test: 10-session synthetic dataset → dashboard totals match
      tariff-engine output exactly.

### Milestone 8.5 — Tariff-engine session cost projection

- [ ] On `transaction.stopped` (queue-consumer-side, Sprint 5.3
      handler), call `computeSessionCost(session, tariffChain)` and
      persist into `billing.session_ledger.cost_minor`.
- [ ] Update `billing.period_summary` aggregate row (additive).
- [ ] Permissions surface unchanged — this runs server-side off
      a queue event.
- [ ] Test: 10 simulator-stopped sessions → ledger costs match
      pure-function output exactly.

### Milestone 8.6 — Locale + ISK currency posture

- [ ] `is-IS` + `en-GB` display variants ship.
- [ ] `currency` column accepts EUR; no EUR plans created during
      pilot per ADR 0005 tag C.
- [ ] Test: `CustomerPlan(currency='ISK')` renders correctly in
      both locales.

---

## Track B — Driver self-registration + impersonation

> Slipped from Sprint 5 per ADR 0017. UI + one repo + auditable
> impersonation flow. Doesn't compete with Track A's scale work.

### Milestone 8.7 — Driver self-registration (OTP)

- [ ] OTP delivery channel decided (Sprint 8 design summary):
      Twilio, Cloudflare Email Routing, or other. Document in
      `docs/notes/<date>-otp-delivery-channel.md`.
- [ ] `UserCredential.kind='otp'` activated (enum value already
      exists from Sprint 5.6). New columns: `otpSecret?`,
      `otpExpiresAt?`.
- [ ] Public route: `POST /api/public/signup` — body
      `{ email | phone, displayName? }`. Creates driver-audience
      User row (no Membership); sends OTP via chosen channel.
- [ ] Public route: `POST /api/public/verify-otp` — body
      `{ identifier, otp }`. Verifies + 15-minute TTL per ADR 0016
      / 0017. Issues driver-app session cookie.
- [ ] Rate limiting: 3 OTP send attempts per identifier per 15min;
      5 verify attempts per OTP.
- [ ] Tests: signup, verify, expired OTP, wrong OTP, rate-limited.

### Milestone 8.8 — Impersonation flow

- [ ] Schema: `ImpersonationGrant` model in `audit` schema:
      `id, actorUserId, targetUserId, grantedById, grantedAt,
      expiresAt, revokedAt, reason`. Operator-instructed Rule 4.
- [ ] Route: `POST /api/admin/platform/impersonate` —
      `requirePermission("platform.impersonate")`. Body
      `{ targetUserId, reason }`. Mints grant; issues new session
      cookie carrying `actAsUserId=targetUserId` + retains
      `originalUserId`.
- [ ] Route: `POST /api/admin/platform/impersonate/end` — clears
      impersonation; restores original session.
- [ ] Audit: every impersonation start AND every privileged write
      during impersonation logs `actor_user_id=originalUserId,
      acting_as_user_id=targetUserId`. Audit-drift = security
      incident.
- [ ] Max duration: **4 hours** per ADR 0016 / 0017 confirmed.
- [ ] UI: "Impersonate" button on `/users/[id]` admin page;
      sticky banner "You are acting as ANNA · End impersonation"
      across the impersonating session.
- [ ] Test: impersonation cycle; audit rows assert both ids;
      4h-expiry forces re-grant.

---

## Track C — Sub-resource route `assertPermission` retrofits

> Sprint 4.4 carry-forward. ~30 admin routes today use bare
> `requirePermission(verb)` without `orgIdParam` — bootstrap admin
> passes via god-mode but real users get no orgId-scoped check.
> Now that Sprint 5 lands real userIds + invite-issued users, the
> retrofit is finally load-bearing.

### Milestone 8.9 — Retrofit list

- [ ] adminSites: `GET/PATCH/DELETE /:siteId` + nested.
- [ ] adminInstallations: `GET/PATCH/DELETE /:id`.
- [ ] adminCircuits: `GET/PATCH/DELETE /:id`.
- [ ] adminProperties: `GET/PATCH/DELETE /:id`.
- [ ] adminChargers: `GET/PATCH/DELETE /:id` + OCPP command paths.
- [ ] adminUsers: `GET/PATCH /:id`, `GET/POST /:id/tokens`.
- [ ] adminIdTokens: `GET/DELETE /:tokenId`.
- [ ] adminVendorCredentials: `GET/PATCH/DELETE /:id` +
      workflow paths.
- [ ] Each route gets a `getOrgIdForResource(db, id)` helper if
      not already present in its repo.
- [ ] Each route's tests gain a "real-user-cross-org-rejection"
      case.

---

**Risks.**
- **Rule 5.** Tariff math is the highest-stakes correctness surface
  in the platform. Stop-and-summarize before each Track A
  milestone.
- **Sprint 7 dependency.** 8.4 reads from Sprint 7's report-ready
  tables. If 7.6 slips, 8.4 slips with it.
- **OTP provider lock-in.** 8.7 picks a delivery channel; the
  pick becomes load-bearing for pilot. Validate in staging before
  production.
- **Audit drift in 8.8.** Every privileged write under impersonation
  must log both ids. Drift = security incident.
- **Track C scope creep.** ~30 routes is the prior estimate; if
  it's actually 50, parallel-tracking with Track A may not finish
  in-sprint. Then carry-forward to Sprint 9.

**Out of scope (Sprint 9+).**
- Multi-currency (EUR per-locale variants) → post-pilot per ADR
  0005 (tag C).
- Invoice generation, statements, employer reimbursement, PDF
  invoices → post-pilot per ADR 0005 (tag E).
- Driver-side billing view → post-pilot per ADR 0006 (tag B).
- Payment provider integration → post-pilot per ADR 0005 (tag F).
- Push API + webhook delivery → post-pilot.
- OAuth / passkey credentials → Sprint 10.
