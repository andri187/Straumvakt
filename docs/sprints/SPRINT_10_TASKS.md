# Sprint 10 — Observability + Security/Tenancy · Task List

**Status:** FUTURE — entry condition: Sprint 9 exit met (4k sim
runs cleanly on staging).
**Branch:** `dev/sprint-10-observability-security`.

> Rescoped per [ADR 0017](../adr/0017-prepilot-rescope-for-4k-charger-target.md).
> Absorbs gbtNotes S8 (Observability) + S9 (Security, Tenant
> Isolation, Secrets). 4,000 chargers cannot be operated by
> tail-watching. Postgres RLS as defense-in-depth, AuditAction
> append-only enforcement at the DB layer, MFA mandatory on
> PlatformGrant. Pre-pilot security audit checklist signed.

---

## Track A — Observability

### Milestone 10.1 — Production dashboards

- [ ] Pick: Cloudflare Analytics + custom Grafana, or Cloudflare
      Workers Analytics Engine + Grafana, or Datadog. Decision in
      `docs/notes/<date>-observability-stack-pick.md`.
- [ ] Recommend: Cloudflare Workers Analytics Engine for metrics +
      Grafana Cloud (Cloudflare-friendly, EU region) for dashboards.
- [ ] Dashboards: charger online count, queue depth, ingest lag
      p50/p99, DLQ count, command round-trip p50/p99, DB write
      latency p50/p99, R2 archive growth, partition health (next
      partition exists for tomorrow). Per-environment views.
- [ ] Public-API rate dashboard scaffolded (populates Sprint 12+
      with the push API surface).

### Milestone 10.2 — Structured logs with correlation IDs

- [ ] All log lines emit JSON with `correlation_id` (= eventId or
      command id), `org_id`, `station_id`, `event_id`, `command_id`
      where applicable.
- [ ] Cloudflare Logpush configured to ship to chosen destination
      (Grafana Loki / R2 + query layer).
- [ ] Trace from OCPP message arrival → queue → consumer → DB
      write → result event → command transition is one chain of
      log lines tied by correlation_id. Sample trace captured in
      `docs/runbooks/correlation-id-trace.md`.

### Milestone 10.3 — Alert thresholds

- [ ] Alerts wired (operator's preferred channel — PagerDuty /
      email / Slack, decided here):
      - Queue age > 60s for 5min
      - DLQ non-empty for 10min
      - Auth failure spike (>5×/min baseline)
      - Charger drop (online count drops >10% in 5min)
      - DB write latency p99 > 1s
      - R2 archive cron failure
      - Partition cron failure
      - Command timeout spike (>5%/min)
- [ ] Test: each alert has a synthetic firing scenario; runbook
      lists the response.

### Milestone 10.4 — Runbooks for the 14 named scenarios

> Per gbtNotes S8 — non-author operator must be able to diagnose
> common failures without source.

- [ ] Charger cannot connect (TLS, auth, network)
- [ ] Vendor import mismatch (Zaptec API ↔ our records)
- [ ] Queue backlog growing
- [ ] DLQ replay procedure
- [ ] Postgres slow / unavailable
- [ ] Partition maintenance miss (forgot to create tomorrow)
- [ ] R2 archive cron failure
- [ ] R2 archive replay procedure
- [ ] Gateway deploy rollback
- [ ] API Worker deploy rollback
- [ ] UI Worker deploy rollback
- [ ] Secret rotation (per-secret runbooks per 10.10)
- [ ] Backup restore drill
- [ ] Incident response (severity classification + escalation)

All in `docs/runbooks/`. Index in `docs/runbooks/README.md`.

---

## Track B — Security / Tenancy

### Milestone 10.5 — Postgres RLS on per-tenant tables

- [ ] Application Postgres role `straumvakt_app` re-shaped:
      `SET app.org_id = '<orgId>'` per-request. RLS policies on
      `charging.sessions`, `identity.users`, `tenancy.memberships`,
      `properties.sites`, `hardware.charging_stations`,
      `billing.session_ledger`, `billing.period_summary`.
- [ ] Migration: `CREATE POLICY ... USING (org_id = current_setting('app.org_id')::uuid)`.
      Operator-instructed Rule 4 + Rule 5 schema migration.
- [ ] Performance impact measured pre-flip:
      - Take 3 representative dashboard queries
      - Measure with RLS off vs RLS on
      - Document in `docs/runbooks/rls-perf.md`
      - If >5% on hot paths, escalate; consider per-query enforcement
        only for cold-path tables.
- [ ] PlatformGrant holders skip RLS via `BYPASSRLS` role membership
      (god-mode but DB-side, not application-side).

### Milestone 10.6 — AuditAction append-only enforcement

- [ ] Revoke `UPDATE`, `DELETE` on `audit.audit_actions` from
      `straumvakt_app` role at the DB level. Operator-instructed
      Rule 4 migration.
- [ ] Test: application-side `prisma.auditAction.update()` fails
      with a permission error. Insert succeeds.
- [ ] Tenant-admin `audit.read` route shows "who from Straumvakt
      accessed our data" — filterable to PlatformGrant holders
      (impersonation events from Sprint 8.8).

### Milestone 10.7 — MFA mandatory on PlatformGrant

- [ ] `UserCredential.kind='passkey'` activated (enum value already
      exists from Sprint 5.6). WebAuthn registration flow.
- [ ] `UserCredential.kind='otp'` activated as TOTP fallback.
- [ ] Migration enforces: every PlatformGrant holder MUST have ≥1
      MFA credential. Sprint 10 cutover plan: 1-week parallel
      period for existing holders to enrol; after deadline, login
      requires MFA.
- [ ] Test: PlatformGrant login without MFA → enrolment screen,
      not dashboard.

### Milestone 10.8 — Tenant-isolation tests

- [ ] Cross-tenant query test suite:
      - 2 staging orgs, 1000 rows each
      - Run every dashboard query as Org A
      - Assert: zero rows from Org B in any result
      - Includes R2 prefix check (Org A signed-URL cannot fetch
        Org B's evidence bundle)
      - Includes API key scope check (Org A key cannot read
        Org B chargers)
- [ ] Results in `docs/runbooks/tenant-isolation-test-results.md`.

### Milestone 10.9 — SMS provider for OTP

- [ ] Final pick: Twilio, Cloudflare-friendly alternative, or
      operator-recommended provider.
- [ ] Replace Sprint 8 staging stub with real provider.
- [ ] Cost forecast at 4k driver-onboarding pace; budget signed.
- [ ] Test: real SMS delivers within 30s in IS region.

### Milestone 10.10 — Secret rotation runbooks

> One runbook per rotatable secret. Each has steps + rollback +
> downtime estimate.

- [ ] `OCPP_INGEST_SECRET` (gateway → api Worker shared secret)
- [ ] `OCPP_CRED_KEK` (Cloudflare-side KEK for charger creds)
- [ ] `AUTH_SECRET` (admin session signing secret)
- [ ] Neon connection string rotation
- [ ] R2 bucket credentials rotation
- [ ] Twilio (or chosen SMS provider) API key rotation
- [ ] All runbooks in `docs/runbooks/secret-rotation/<secret>.md`.

---

## Track C — Sprint 4.5 dead-code cleanup

> Carry-forward from Sprint 4. Both gateway environments are now
> on the new URL (post Sprint 5 deploy); legacy UI-Worker code is
> safe to delete.

### Milestone 10.11 — UI-Worker dead-code cleanup

- [ ] Delete `src/app/api/ocpp/events/route.ts` (UI Worker route).
- [ ] Delete `src/app/api/internal/ocpp-auth/route.ts`
      (UI Worker mirror).
- [ ] Delete `src/lib/ocpp/{event-envelope,projections,bootstrap,
      ingest-auth,internal-auth}.ts` + their tests.
- [ ] Delete `src/lib/repositories/events.ts` + test.
- [ ] Drop the legacy `/api/ocpp/events` mount on apps/api
      (keep only `/api/internal/ocpp-events` from the queue path).
- [ ] Smoke against staging + production after each deletion.

---

**Risks.**
- **RLS performance.** If 10.5 measures >5% on hot dashboard
  queries, take a different enforcement layer (in-app-only).
- **MFA enrolment friction.** Operator + Straumvakt staff need to
  enrol passkeys before the deadline. 1-week parallel period
  budgeted.
- **Secret rotation downtime.** Neon connection string rotation
  needs reconnect; schedule outside peak. Communicate window.
- **AuditAction enforcement is irreversible** at the role level.
  Test against scratch Neon branch first.
- **Dead-code cleanup race.** Smoke against both environments
  between each deletion; if one production charger fails the
  smoke, halt and root-cause.

**Out of scope (Sprint 11+).**
- Push API + webhook delivery → Sprint 12+ post-pilot.
- Multi-tenant white-label re-skin → Sprint 12+ post-pilot.
- OCPP 2.0.1 adapter → Sprint 14 with OCPI Foundation.
- Driver-app passkey/SSO → Sprint 12+ post-pilot.
