# Sprint 11 — Production Cutover Readiness + Pilot Go-Live · Task List

**Status:** FUTURE — entry condition: Sprint 10 exit met
(observability + RLS + MFA live; runbooks complete).
**Branch:** `dev/sprint-11-cutover-and-pilot`.

> Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> Absorbs gbtNotes S10. **Pilot opens in this sprint.** Pilot scope
> tightens from "20 chargers, demonstrable" (ADR 0006) to "first
> batch on scale-validated infrastructure." Production resources
> provisioned; migration dry-run; final 4k load test against
> production-like config; rollback paths; go/no-go checklist;
> first-batch ramp.

---

## Track A — Production cutover readiness

### Milestone 11.1 — Domain layout finalized

- [ ] UI domain: `app.straumvakt.is` (Cloudflare Pages /
      OpenNext-Workers production)
- [ ] API domain: `api.straumvakt.is` (apps/api production Worker)
- [ ] OCPP gateway domain: `ws.straumvakt.is` (gateway production
      Worker, ws/wss only)
- [ ] Future enterprise API domain reserved: `api.straumvakt.is/v1/`
      mounts under the same Worker; no separate Worker needed
      until Sprint 13+.
- [ ] DNS provisioning + TLS cert verification documented in
      `docs/runbooks/domain-cutover.md`.

### Milestone 11.2 — Production Cloudflare resources

- [ ] API Worker `hlada-api` provisioned (already exists in staging
      as `hlada-api-staging`).
- [ ] Gateway Worker `straumvakt-ocpp` provisioned.
- [ ] DO namespace bound to gateway prod Worker.
- [ ] Inbound queue `straumvakt-ocpp-events` (prod) + DLQ
      `-dlq` (prod).
- [ ] Outbound queue `straumvakt-commands` (prod) + DLQ.
- [ ] Export queue `straumvakt-exports` (prod) + DLQ.
- [ ] Hyperdrive prod binding pointing at Neon prod connection
      string.
- [ ] R2 prod bucket `straumvakt-evidence-prod` (raw archive).
- [ ] R2 prod bucket `straumvakt-exports-prod` (export artifacts).
- [ ] Wrangler configs updated; secrets staged via dashboard
      (per Rule 2 — never in `wrangler.jsonc`).

### Milestone 11.3 — Production DB resources

- [ ] Neon prod plan provisioned (or Timescale prod service per
      ADR 0018). Plan sized for 4k chargers + 7-year billing
      retention.
- [ ] Backup posture: PITR with 14-day window. Daily logical
      backup to R2.
- [ ] Restore drill against scratch branch — runbook from Sprint
      10.4 executed.
- [ ] Document plan + sizing + cost in
      `docs/runbooks/prod-db-sizing.md`.

### Milestone 11.4 — Production migration dry-run

- [ ] Create scratch Neon branch from a fresh prod-shape image.
- [ ] Apply every `prisma/migrations/*` in order.
- [ ] Run integration smoke against it (login, create org, send
      invite, accept invite, create plan, simulate session, check
      billing dashboard).
- [ ] Document any required manual SQL alongside the auto-applied
      migrations (e.g. RLS policy refinements, partition seeding).
- [ ] Output: `docs/runbooks/prod-migration-procedure.md` —
      step-by-step for the actual cutover.

### Milestone 11.5 — Final 4k-staging load test against production-like config

- [ ] Configure staging to match production: same Hyperdrive,
      same R2 region pinning, same secret distribution.
- [ ] Re-run Sprint 9 Scenario D (4000 chargers, 30s MeterValues,
      1h) + Scenario H (concurrent reports). Confirm pass.
- [ ] Catches any prod-only environmental issue before customer
      traffic hits.
- [ ] Results in `docs/runbooks/sprint-11-final-load-test.md`.

### Milestone 11.6 — Rollback paths

- [ ] UI Worker rollback: previous Pages deployment is one click;
      runbook documents the click path.
- [ ] API Worker rollback: wrangler versioned deploy + rollback
      via `wrangler deployments rollback <id>`.
- [ ] Gateway Worker rollback: same wrangler versioned deploy.
- [ ] DB migration rollback: forward-only is the rule; per-
      migration documented hot-fix forward migration path lives
      next to the migration in `prisma/migrations/<name>/ROLLBACK.md`.
- [ ] All rollback procedures rehearsed at least once against
      staging.

### Milestone 11.7 — Go/no-go checklist signed

> Operator-facing checklist; signed before pilot opens.

- [ ] Backup restore drill passed (Sprint 11.3 + Sprint 10.4 runbook).
- [ ] 4k load test passed (Sprint 11.5).
- [ ] Runbooks reviewed (Sprint 10.4) — operator can find each.
- [ ] Secret rotations rehearsed (Sprint 10.10) — operator can
      execute each unaided.
- [ ] On-call rotation set — Straumvakt-staff schedule, paging
      channel.
- [ ] Communication plan to pilot customer documented:
      kickoff letter + weekly status format + incident comms
      template.
- [ ] Sign-off committed in `docs/runbooks/pilot-go-no-go.md`.

---

## Track B — Pilot Go-Live

### Milestone 11.8 — Pilot first-batch onboarding

- [ ] ~50 chargers from contracted customer(s). Onboarded through
      the Sprint 2 admin flow — no special pilot wizard.
- [ ] Customer admin invited via Sprint 5.7 flow; accepts via
      Sprint 5.8 landing.
- [ ] Customer admin sets up org, sites, installations, chargers
      via Sprint 2 wizards.
- [ ] Driver records seeded:
      - Existing customer drivers via Sprint 8.7 self-registration
        (where the driver app is in their hands)
      - Inert admin-created records linked to RFID idTags otherwise
        (per ADR 0006 retained guidance)
- [ ] Plans set: customer admin chooses CustomerPlan + ChargerServicePlan
      via Sprint 8.1–8.3 flows.

### Milestone 11.9 — Pilot operation (30-day window)

- [ ] Operator runs the site from console. Sprint 9.3
      command-history UI is the day-to-day surface.
- [ ] Retention + R2 archive + aggregate jobs run nightly
      (Sprint 7.3 / 7.4 / 7.5). 30+ successful runs by end of
      window.
- [ ] Billing dashboard (Sprint 8.4) reviewed weekly. Per-driver +
      per-Host totals reconcile to tariff engine.
- [ ] **No money moves during pilot** per ADR 0005 (tag E) — invoice
      generation post-pilot.
- [ ] Incidents (if any) handled per Sprint 10.4 runbooks; each
      incident's response captured in `docs/incidents/<date>-<topic>.md`.

### Milestone 11.10 — Pilot retrospective + post-pilot plan

- [ ] `docs/retros/sprint-11.md` (sprint retro)
- [ ] `docs/retros/pilot-overall.md` (30-day pilot retrospective —
      what worked, what broke, what the data says, what the operator
      says).
- [ ] Post-pilot plan ordering the deferred queue:
      - **Suggested order:** F (payment provider — unblock money
        movement) → driver UX (tag B — drivers in front of users)
        → D (Issue Engine — scale ops) → multi-tenant white-label
        (second customer) → push API → A (OCPP 2.0.1 + roaming) →
        C (multi-currency) → E (real billing — needs F live first)
        → enterprise API → OCPI Foundation.
- [ ] Sprint 12 scope ADR authored if the post-pilot signal calls
      for re-ordering (precedent: ADR 0015 + 0016 + 0017).

---

**Risks.**
- **First-batch surprises.** First real customer chargers will
  surface edge cases the simulator missed. Sprint 11.5 (final load
  test) is the last gate before customer traffic; expect 1-2 hotfix
  cycles in the first 7 days regardless.
- **Production secret distribution.** Don't echo any secret to
  chat during cutover. Per Rule 2.
- **Deploy ordering.** API Worker + gateway redeploy in the order
  documented in Sprint 4.5's commit message. Rehearsed in 11.5.
- **Customer expectation management.** Pilot is operational, not
  commercial. No money moves; driver app may not be in customer
  hands; explicit in the pilot kickoff letter.
- **30-day window slip.** If the first batch lands late in the
  sprint, the 30-day pilot window stretches into Sprint 12. Plan
  Sprint 12 with float for that overlap.

**Out of scope (post-pilot — Sprint 12+).**
- Driver-facing UX expansion (PWA polish, mobile app) per ADR 0006
  (tag B).
- Issue Engine per ADR 0006 (tag D).
- Push API + webhook delivery.
- Payment provider integration + dunning per ADR 0005 (tag F).
- Multi-tenant white-label / second-tenant branding.
- Enterprise API + OpenAPI surface (was gbtNotes S11).
- OCPI Foundation (Sprint 15+ per ADR 0015 + 0017 cascade).
- OCPP 2.0.1 adapter per ADR 0005 (tag A).
- Multi-currency (EUR variants, per-locale rendering) per ADR 0005
  (tag C).
- Real invoice generation, statements, employer reimbursement,
  PDF invoices per ADR 0005 (tag E).
