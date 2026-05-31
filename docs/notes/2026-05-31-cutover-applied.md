# Cutover --apply sequence executed — 2026-05-31

The three prepared scripts ran in order against staging Neon. All three
committed cleanly. Post-state sanity queries confirm expected counts.

## Order of operations

1. `apps/api/scripts/supersede-orphan-b6771541.ts --apply`
2. `apps/api/scripts/migrate-to-agreements.ts --apply`
3. `apps/api/scripts/backfill-tariff-definition-id.ts --apply`
4. `apps/api/scripts/shadow-compare-resolvers.ts --days=30 --show-mismatches=10`

## Step 1 — supersede orphan

- Exit code: 0
- Rows touched: 1 (`b6771541-a4c5-4c8c-8558-4041a34c7335`)
- Status set to `expired`
- Pre-flight identity check passed

Removes the orphan from the resolver's candidate set so the GAP-1
findFirst tie-break can't silently pick it. Without this step, the
0-clause orphan would have been heap-scan-biased to win against the
new VCP Lab agreement.

## Step 2 — migrate to agreements

- Exit code: 0
- Result: `installation` 2 inserted + 1 updated, `service_cpo` 2 inserted, 6 clauses written, 2 rate references inserted, 0 bearer rules
- 1 orphan warning (b6771541, which we just superseded) — left untouched

The 2 service_cpo agreements:
- N1 ehf ↔ Straumvakt (CPO commercial)
- Straumvakt ↔ Straumvakt (its own VCP Lab is owned by Straumvakt)

The 3 installation agreements (with 2 clauses each — DSO + ELE):
- Dalvegur 10-14 (counterparty = N1 ehf)
- Reykjavík HQ (counterparty = N1 ehf)
- VCP Lab (counterparty = Straumvakt)

Rate references:
- `VEITUR-AD1` — DSO rate
- `N1-RAFMAGN-REPF-01` — retailer ELE rate

## Step 3 — backfill tariff_definition_id

- Exit code: 0
- 488 ledger rows updated (all to TariffDefinition `Veitur AD1`)
- 1 skipped (`0b308456-f1f1-411b-8385-f5279c5b7fdd` — orphan ledger row with no `charging_station_id`)

## Step 4 — shadow comparison re-run

- Exit code: 0
- 0 priced sessions returned by the script's join (all staging sessions
  are anonymous free-vend — `user_id IS NULL`)
- Expected outcome — staging shadow can't produce a meaningful
  histogram until either (a) a user-attributed seed session is created,
  or (b) the comparison runs against production data on cutover day

## Post-state sanity queries

```
--- agreements by type + status ---
  service_cpo          active     2
  installation         active     3
  installation         expired    1

--- agreement_clauses ---
  total clauses: 6

--- rate_references ---
  N1-RAFMAGN-REPF-01        1
  VEITUR-AD1                1

--- session_ledger backfill coverage ---
  backfilled: 488    still_null (priced rows): 1
```

State matches expectation:
- 5 active agreements (3 installation + 2 service_cpo)
- 1 expired (the superseded orphan)
- 6 clauses (2 per installation agreement: DSO + ELE)
- 2 rate references (one per supplier code)
- 488/489 priced ledger rows now have `tariff_definition_id`; the 1 still-null
  is the orphan session with no charging_station_id (data quality issue, not a
  backfill defect)

## Headline

- **Cutover writes applied: yes**
- **Session-stop still resolves through legacy** (`apps/api/src/lib/tariff/*`) —
  the resolver flip is the *next* commit, not this batch
- **No invoice-affecting writes** — all changes are catalog seeding and
  audit-trail backfill; the canonical `cost_isk_minor` was untouched
- **Rollback path** if needed:
  - To revert step 1: `UPDATE agreements.agreements SET status='active' WHERE id='b6771541-...';`
  - To revert step 2: `DELETE FROM agreements.agreement_clauses WHERE agreement_id IN (...)` followed by `DELETE FROM agreements.agreements WHERE id IN (...)` for the newly inserted rows (note: this is a manual operation; the script doesn't ship a `--rollback`)
  - To revert step 3: `UPDATE reports.session_ledger SET tariff_definition_id = NULL WHERE updated_at > <step-3-timestamp>`

## Next steps

After GAP-1 / GAP-2 / GAP-3 land:
- Operator decides whether to flip the per-installation `enforceAuthorize` flag at any installation (GAP-2 hardening + A.11 from FINAL-4)
- The resolver flip itself (legacy → agreements at session-stop) is still deferred to a separate ADR / commit per ADR 0025
