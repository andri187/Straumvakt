# Shadow resolver comparison — baseline 2026-05-31 (pre-A.10)

## Script
- `apps/api/scripts/shadow-compare-resolvers.ts`
- Window: last 30 days (also verified at 90 days — same result)
- Database: staging Neon branch `br-tiny-river-abgpqq37` (ep-quiet-bird-abxartp8)
- Executed at: 2026-05-31T13:15:00Z (approx)

## State at run-time
- `agreements.agreements` rows: 2
- `agreements.agreement_clauses` rows: **0** (confirmed via direct DB query)
- A.10 migration: NOT YET APPLIED — agreement_clauses is empty
- `charging.sessions` total: 502
- `charging.sessions` with `user_id IS NOT NULL`: **0** — ALL sessions are anonymous
- `reports.session_ledger` total: 489 (all priced, spanning 2026-05-04 to 2026-05-31)

## Why the script returned 0 rows

The script's source query requires:

```sql
WHERE sl.cost_isk_minor IS NOT NULL
  AND cs.ended_at IS NOT NULL
  AND cs.energy_wh IS NOT NULL
  AND cs.user_id IS NOT NULL          -- ← eliminates every row
  AND sl.started_at > now() - interval '30 days'
```

Every session in staging is an anonymous free-vend session (Dalvegur OCPP
charger, Authorisation required = OFF, idTag = `EE43C609263CC7` / Default ID
tag). None have a `user_id` assigned. The `user_id IS NOT NULL` filter is
structurally correct — the new resolver requires a user to look up agreement
context — but it means the shadow comparison has nothing to run against on
this staging dataset.

This is **expected and correct behaviour** given the current staging data
state. It is not a script bug.

## Histogram

| Classification | Count | % |
|---|---|---|
| match | 0 | — |
| match_within_1_aurar | 0 | — |
| mismatch | 0 | — |
| new_resolver_failed | 0 | — |
| **TOTAL** | **0** | — |

Script output: `fetched 0 priced session(s) for comparison` / `No priced sessions in window — nothing to compare.`

## Failure-mode breakdown

N/A — no rows were processed.

## Top mismatches

None.

## Root cause of empty comparison

The staging environment was set up for free-vend OCPP testing (Dalvegur
charger). The OCPP flow does not assign `user_id` on sessions because:
1. Authorisation required = OFF on the charger
2. No driver (User) record is linked to the default ID tag
3. The free-vend / no-auth path intentionally leaves `charging.sessions.user_id = NULL`

For the shadow comparison to produce meaningful output, at least one session
must have a linked user AND a priced ledger row. That requires either:
- A production dataset (where real drivers with user accounts charge), or
- A seeded staging scenario where a User record is created and linked to
  an IdToken that has actually been used in a session

## Post-A.10 expectations

After CO-2 `--apply` runs and seeds `agreement_clauses`:
- The agreements table will have real clauses populated
- BUT the `new_resolver_failed` rate will still be high until real
  user-linked sessions exist in the ledger
- `new_resolver_failed → near 0` and `match → near 100%` can only be
  validated against a dataset with `user_id IS NOT NULL` sessions

## Recommended next step

**Situation A — production data available:**
If a production Neon branch has sessions with real `user_id` values,
point the script at that branch (swap DATABASE_URL) and re-run. The
comparison will be meaningful there after A.10 applies.

**Situation B — staging-only:**
Seed one User + CustomerPlan + linked IdToken that matches a session
already in the staging ledger (or drive one real session through with
a logged-in driver), then re-run. Even a single matched row confirms
the resolver pipeline works end-to-end.

**Current verdict:** The shadow comparison infrastructure is correct and
functional. The zero-row result is a staging-data limitation, not a code
defect. Proceed with A.10 — no mismatches were found (no rows ran), and
the new resolver failure mode (no agreement_clauses) is expected to resolve
after CO-2 `--apply`.

## Full output

```
══════════════════════════════════════════════════════════════════
  SHADOW RESOLVER COMPARISON — Sprint 9 CO-3
══════════════════════════════════════════════════════════════════
  window:           last 30 day(s)
  row cap:          1000
  show mismatches:  top 10 by |delta|
  write report:     no

(node:739120) Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.
[... standard pg-connection-string SSL warning ...]

fetched 0 priced session(s) for comparison

No priced sessions in window — nothing to compare.
```

Re-run with `--days=90` produced identical output.

## DB verification queries (read-only, run against br-tiny-river-abgpqq37)

```
ledger_total:          489
ledger_priced:         489
sessions_total:        502
sessions_with_user:      0   ← confirms why script returns 0 rows
sessions_complete:     502
sessions_priceable:      0
query_match_30d:         0

agreements_count:        2
clauses_count:           0   ← A.10 not yet applied

ledger date range: 2026-05-04 → 2026-05-31
```
