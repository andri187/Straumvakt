# ADR 0021 — Reference catalogue + tariff propagation

**Status:** Open — design conversation, not a decision yet.
**Created:** 2026-05-10
**Triggered by:** seed-vcp-sandbox conversation (2026-05-10) — operator
flagged that `/reference/electricity/*` should be web-scraped and
propagate downward into bound contracts.

## Problem

Today the reference layer (`docs/reference/iceland-energy-parties.json`
→ `/reference/electricity/dso` and `/retailers`) and the operational
catalogue (`billing.tariff_definitions`) are **decoupled**. A site/
installation FKs to a frozen TariffDefinition row. When a real-world
party (Veitur, N1, etc.) changes a price or a structural rule:

- The reference JSON is stale until somebody commits a doc edit.
- The DB row is stale until somebody runs a manual seed/update.
- Bound sites continue at the old number with no audit trail of when
  the change "should have" happened.

The desired property: a price change at the source propagates
automatically to all bound contracts on its effective date, **without**
retroactively repricing closed sessions.

## Sketch (for the eventual decision conversation)

```
[Web scraper / Cron Worker]
        │
        │ diff against last snapshot
        ▼
[reference.electricity_parties + reference.electricity_tariff_versions]
        │
        │ "Veitur AD1: 8.64 → 9.10 kr/kWh, effective 2026-06-01"
        ▼
[billing.tariff_definitions: new row with valid_from=2026-06-01,
 family_code='VEITUR-AD1']
        │
        │ propagation
        ▼
[Sites/Installations bound by family_code → resolver picks the row
 active on session start]
        │
        ▼
[Future sessions priced at new rate; historical sessions preserved]
```

## Open design questions

1. **Reference data home**
   Static JSON (today) → DB-backed `reference.electricity_parties` table
   with `last_scraped_at`? Versioned snapshots, or last-write-wins?

2. **Tariff family identity**
   Today FKs target a specific TariffDefinition (`display_name`-based
   lookup). Future probably needs a stable `family_code` (e.g.
   `VEITUR-AD1`, `N1-RAFMAGN-REPF-01`) so versions stack under one
   family and FKs can rebind without losing identity.

3. **Binding semantics**
   - Pin to a specific TariffDefinition (frozen until manual rebind), OR
   - Pin to a family + resolver picks `valid_from <= now() < valid_to` row, OR
   - Hybrid: family pin + manual "freeze at version X" override per site

4. **Scraper trust + diff gating**
   Auto-create new TariffDefinition versions on every diff, OR queue
   diffs into an operator-review inbox (`/admin/tariff-diffs`) so a
   human signs off before propagation? Price-only diffs probably
   auto-flow; rule-shape diffs (flat → TOU, currency change) probably
   gate.

5. **Historical correctness**
   Closed `ChargeSession` rows already store the resolved cost. Reprice
   never. New sessions resolve through the chain at session-start
   timestamp. That timestamp must lock the resolution — not "current
   active" at session-stop, which would silently change billing if a
   tariff version flipped mid-session.

6. **VAT, currency, structural changes**
   Price-delta diff = trivial. VAT-rate change = simple but needs new
   row (different `vat_rate_pct` is a different version). Rule-shape
   change (flat → TOU, capacity tier added) = operator-review gate.

## Implications for current state

- `seed-vcp-sandbox.ts` (2026-05-10) FKs by specific TariffDefinition
  ID. When/if family-code binding lands, the sandbox will need a
  one-time migration to point at the family. Low-stakes, internal.
- `seed-dalvegur-n1-contract.ts` (2026-05-09) does the same and would
  need the same migration.
- The mobile-app price-display work (deferred from the same 2026-05-10
  conversation) reads through the chain — once family-code resolution
  lands, the resolver call site changes but the API contract doesn't.

## Out of scope for this ADR

- Implementation of the scraper itself (separate ADR or sprint).
- TOU / capacity (fastagjald) rule shapes — orthogonal billing-engine
  work, separate ADR.
- VAT-exclusive display in driver UI — see deferred mobile work.

## Decision

**Not made.** Park until a sprint allocates real time to the scraper +
versioned tariff conversation. Update this ADR with the decision when
that happens; until then, keep extending the operational catalogue
manually via seed scripts.
