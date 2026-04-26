# Sprint 9 — Multi-Tenant + White-Label · Task List

**Status:** FUTURE — entry condition: Sprint 8 exit met.
**Branch:** `dev/sprint-09-multi-tenant`.

> Sketch-level. See [delivery plan §12](../architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md#12-sprint-9--multi-tenant--white-label).
> OCPP 2.0.1 adapter deferred per ADR 0005 (tag A).

---

## Milestone 9.1 — Second-tenant onboarding via Sprint 2 admin flows
- [ ] Re-run the Sprint 2 admin sequence end-to-end for a second
      staged Org
- [ ] Time-to-onboard measured; target < 30 min
- [ ] No code changes — milestone *validates* Sprint 2 flows for a
      fresh tenant

## Milestone 9.2 — Per-Host branding
- [ ] `hosts.branding` JSONB shape defined: `{ logo_url, color_primary,
      color_accent, sender_email_domain }`
- [ ] Operator console chrome (sidebar + topbar) reads brand from
      session's active Host
- [ ] DEFERRED: driver-PWA branding (ships with Driver Experience, tag B)

## Milestone 9.3 — Postgres RLS where it matters
- [ ] RLS policies on `charging.sessions`, `identity.users` (in operator queries)
- [ ] Issue-table policies scaffolded but inert (table exists; data lives post-pilot)
- [ ] RLS audit: cross-tenant raw query rejected

## Milestone 9.4 — API key + scopes subsystem
- [ ] `tenancy.api_keys` table + repo (additive migration)
- [ ] Scopes: `sessions.read`, `chargers.read`, `chargers.write`,
      `events.read`
- [ ] Rotation + audit log of uses

## Milestone 9.5 — DEFERRED (OCPP 2.0.1 adapter, tag A)
- No tasks. Translator boundary in `gateway/src/ocpp-frame.ts`
  designed to admit a second protocol version as a sibling module.

---

**Risks:** RLS performance on hot paths. Measure before turning on
for sessions.
