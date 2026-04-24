# ADR 0003 — No CPMS Backfill in Sprint 0

**Status:** Accepted
**Date:** 2026-04-24
**Sprint:** 0

## Context

The V3 delivery plan's Sprint 0 milestone **0.3** read:

> *Backfill existing CPMS data into V3 shape. Each existing charger
> becomes `assets.chargers` + `ocpp.ocpp_identities`; connectors
> repoint to identity; existing drivers become `identity.users` +
> `people.family_groups` of one; existing sites become
> `properties.sites` under a default `hosts.charger_hosts` for the
> pilot CPO.*

This was written before the Straumvakt workspace was cut as a clean
rebuild. The assumption was that Straumvakt would inherit rows from
the CPMS Neon database on first boot.

The actual state at Sprint 0 time:

- The operator has wiped the database.
- Straumvakt is a clean rebuild (per [CLAUDE.md](../../CLAUDE.md)
  project context).
- Prisma schema began empty; V3 schema is the *first* schema the
  database has ever seen.
- The prior CPMS workspace (`E:\Claude\CPMS\CPMS\`) is retained for
  domain-language reference only, not as a data source.
- Rule 6 ("No mock data, ever") would prohibit seeding synthetic
  rows to stand in for "existing CPMS data" anyway.

There is no data to migrate. Milestone 0.3 as written is moot.

## Decision

Milestone 0.3 is **superseded** by this ADR. The Sprint 0 exit
criterion no longer requires a CPMS backfill.

The catalog seed (Sprint 0.6 — Zaptec vendor + Zaptec Pro model) is
the only seed data Sprint 0 lands. It is reference data (a catalog of
supported hardware), not operational inventory. Rule 6 remains
intact.

Onboarding — first Org, first Host, first Property, first Site, first
Charger — happens through the operator console wizard landing in
Sprint 9 (milestone 9.1). Between Sprint 0 and Sprint 9, the schema
is populated manually through API calls and the admin session during
dogfood testing of each sprint's surface. No seed data pretends
otherwise.

## Consequences

### Positive

- Sprint 0 closes on verifiable state: schema applied, catalog
  seeded, tsc clean, build clean. No ambiguous "how much of CPMS did
  we port?" question.
- Rule 6 is respected without exception. The pilot customer's first
  row is created by the pilot customer, not a migration script.
- The Sprint 9 onboarding wizard (milestone 9.1) has real
  justification — it is the *only* path for an Org to enter the
  system, not a nice-to-have alongside a backdoor migration.

### Negative

- If a future scenario wants test data for demo purposes, it has to
  come from either dogfood use or a separate test-environment seed
  (gated off production). This is the right constraint, not a
  regression.

### Neutral

- The old CPMS database can be dropped or archived at the operator's
  discretion. Straumvakt does not read from it at any point.

## Alternatives considered

**Keep milestone 0.3, write a no-op backfill script documenting the
decision there.** Rejected — code-shaped documentation rots. An ADR
is the right home.

**Port a minimal CPMS dataset for dogfood convenience.** Rejected —
violates Rule 6 and reintroduces the "is this row real?" ambiguity
that the clean rebuild was designed to end.

**Defer the decision until Sprint 1.** Rejected — Sprint 0's exit
criterion depends on it. Deferring leaves Sprint 0 unable to close,
which violates Rule 11 (sprint discipline).

## References

- `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md` §3 (Sprint 0,
  milestone 0.3 now marked *superseded by ADR 0003*)
- `CLAUDE.md` Rule 6 (No mock data, ever)
- `CLAUDE.md` Rule 11 (Sprint discipline)
- `docs/adr/0002-hardware-catalog-and-installations.md` (catalog 0.6)
