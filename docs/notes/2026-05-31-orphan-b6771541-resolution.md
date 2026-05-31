# Orphan Agreement b6771541 — Investigation + Resolution

**Date:** 2026-05-31
**Sprint:** Sprint 9 — cutover A.10 prep (FIX-4 follow-up)
**Agent:** FINAL-1

---

## Investigation of the orphan

Agreement `b6771541-a4c5-4c8c-8558-4041a34c7335` is a pre-A.10 scaffolding
row created on 2026-05-10 when the VCP Lab sandbox installation went live.

| Field | Value |
|---|---|
| id | `b6771541-a4c5-4c8c-8558-4041a34c7335` |
| agreement_type | `installation` |
| status | `active` |
| counterparty_org_id | `b9f6a897-2401-45a3-9cde-b89d32fdb326` (N1 ehf) |
| installation_id | `0909cff6-6a19-490d-b53b-b36204dfecc7` (VCP Lab) |
| display_name | "VCP Lab — N1 driver access (sandbox)" |
| clauses | 0 |
| bearer_rules | 0 |
| notes | "VCP Lab — N1 driver test access. Default tag STRMV-VCP-TEST-001 routes plug-ins to N1 Drivers User for billing attribution. Sandbox install; not customer-facing." |

It is a **bare-access stub** — no pricing logic, no clauses, no bearer rules.
It was created manually to give N1's driver group (`7820a970`) a membership
anchor before the A.10 migration was ready.

The A.10 dry-run (`2026-05-31-a10-dry-run.md`) flagged it as an ORPHAN
because `migrate-to-agreements.ts` matches installation Agreements on
`(counterparty_org_id, installation_id)`, and for VCP Lab the intended
counterparty is **Straumvakt** (the org that owns the installation), not
N1 ehf. The script will INSERT a new active agreement (`7dc9f9d4`) with
counterparty=Straumvakt, DSO + ELE clauses, and `effective_from` anchored
to the installation's creation timestamp — leaving `b6771541` untouched.

The notes column history for `b6771541` (from CO-1 probe output) shows it
was written with the intent "routes plug-ins to N1 Drivers User for billing
attribution" — it was never meant to be a permanent billing contract. Its
purpose was access enablement, not rate resolution. The A.10 migration
renders it obsolete.

---

## Investigation of resolver tie-breaking

**Files read:**
- `apps/api/src/lib/agreement/persist.ts` — `loadAgreementContext()`
- `apps/api/src/lib/agreement/resolve.ts` — `resolveBillingLines()`, `resolveFactor()`

### The lookup (persist.ts line 123)

```typescript
const installationAgreement = await prisma.agreement.findFirst({
  where: {
    agreementType: "installation",
    installationId,
    effectiveFrom: { lte: at },
    AND: [
      { status: "active" },
      { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] },
    ],
  },
  include: {
    clauses: { include: { costFactor: { select: { code: true } } } },
    bearerRules: true,
  },
});
```

**There is no `orderBy` clause.** Prisma's `findFirst()` without an
explicit `orderBy` maps to `SELECT ... LIMIT 1` with no `ORDER BY` in
the generated SQL. PostgreSQL is free to return any row that satisfies
the predicate — typically the one it encounters first in whatever index
or heap scan it chooses. This is non-deterministic under concurrent
updates and after table maintenance (VACUUM, index rebuilds).

### What happens after `--apply` if b6771541 is still active

After `migrate-to-agreements.ts --apply`, VCP Lab will have **two active
`installation`-type agreements**:

| id | counterparty | clauses | status |
|---|---|---|---|
| `b6771541` | N1 ehf | 0 | active |
| `7dc9f9d4` | Straumvakt | 2 (DSO + ELE) | active |

Both match the `where` predicate in `loadAgreementContext` for any VCP Lab
session. Without `orderBy`, the resolver will non-deterministically pick one
of the two. If it picks `b6771541`:

1. `installationAgreement.clauses` is empty — `clauses` array has length 0.
2. `resolveBillingLines()` iterates `ctx.clauses` — the loop body never
   executes.
3. `lines.length === 0` at `persist.ts` line 360 — the function returns
   `{ ok: true, emitted: 0, alreadyExisted: false, lines: [] }`.
4. **Zero billing lines are written.** The session is silently un-billed.

This is a Rule 5 concern — silent billing miss on a real session.

If the resolver picks `7dc9f9d4` (the new correct row), billing is correct.
The outcome is a coin flip.

### Which row would win more often?

PostgreSQL heap scans return rows in physical storage order (i.e. insertion
order absent fragmentation). `b6771541` was inserted first (2026-05-10);
`7dc9f9d4` will be inserted later (at apply time). In a lightly-used test
table, PostgreSQL is more likely to return `b6771541` first — it sits earlier
in the heap — making the broken-zero-billing outcome the **more probable**
path, not the less probable one.

### Is the tie-break "safe enough to coexist"?

No. The tie-break is:
- Non-deterministic (no `orderBy`),
- Biased toward the wrong row (older row earlier in heap),
- Produces a silent data integrity failure (zero billing lines, not an
  error that would alert the operator).

---

## Recommendation

**Run `supersede-orphan-b6771541.ts --apply` BEFORE `migrate-to-agreements.ts --apply`.**

The correct operation order is:

1. Retire the orphan stub:
   ```
   cd apps/api
   npx tsx scripts/supersede-orphan-b6771541.ts --apply
   ```
2. Then run the full A.10 migration:
   ```
   npx tsx scripts/migrate-to-agreements.ts --apply
   ```

Running them in this order guarantees that when `7dc9f9d4` is inserted,
it is the **only** active installation agreement on VCP Lab, and
`loadAgreementContext()` will always return the correct row regardless of
the missing `orderBy`.

### What the script does

`apps/api/scripts/supersede-orphan-b6771541.ts` sets
`status = 'expired'` (the correct retirement value in the
`AgreementStatus` enum — `draft | active | expired`) on the target row and
appends a timestamped note to the `notes` column. It runs in a single
transaction. Dry-run by default; `--apply` to commit.

**Note on status name:** There is no `'superseded'` value in
`AgreementStatus` (see `apps/api/prisma/schema.prisma` ~line 2710). The
billing-schema `ContractStatus` has `superseded`, but the agreements schema
does not. `'expired'` is the correct choice — it semantically means "this
agreement is no longer operative" without implying an error or cancellation.

### Pre-flight safety

The script refuses to proceed unless:
- The row exists in `agreements.agreements`,
- Its `counterparty_org_id` is N1 ehf (`b9f6a897`),
- Its `installation_id` is VCP Lab (`0909cff6`),
- Its `agreement_type` is `'installation'`.

Pass `--force` to skip the identity check if the operator has verified
state by other means.

### Idempotency

Re-running after expiry is a no-op — the `WHERE status != $1` clause makes
the update row-count 0 and the script exits cleanly.

---

## Exact commands + expected output

### Step 1 — retire orphan (required before step 2)

```sh
cd apps/api
npx tsx scripts/supersede-orphan-b6771541.ts --apply
```

Expected output (key lines):
```
  SUPERSEDE ORPHAN b6771541 — APPLY MODE (will write)
  ✓ Row found:
       id:               b6771541-a4c5-4c8c-8558-4041a34c7335
       status:           active
  ✓ Pre-flight identity check PASSED.
  -- BEGIN
  EXEC: update agreements.agreements set status = $1, updated_at = now(), notes = coalesce(notes, '') || $2 where id = $3 and status != $1
   → rowCount=1
  ✓ Agreement b6771541-a4c5-4c8c-8558-4041a34c7335 set to status='expired'.
  -- COMMIT
  ✓ APPLIED — transaction committed.
```

### Step 2 — run the full A.10 migration

```sh
npx tsx scripts/migrate-to-agreements.ts --apply
```

After step 1, the orphan is `expired` and will no longer appear in the
`findFirst()` result. The migration will log:
```
   ⚠     WARNING: orphan agreement id=b6771541 ... NOT deleted.
```
This warning is expected and harmless — the orphan is still in the table
with `status='expired'`; it was not matched by the migration's
reconciliation loop (which looks for `active` rows to UPDATE). The VCP
Lab `installation` Agreement `7dc9f9d4` will be inserted cleanly as the
sole active agreement for that installation.

---

## What to watch for if coexistence is chosen instead

If the operator decides NOT to supersede and lets both rows coexist:

1. **Watch VCP Lab sessions immediately after apply** — check
   `agreements.billing_lines` for `session_id` rows from VCP Lab
   sessions. If any have `emitted = 0` (and are not already-existed
   idempotency skips), the resolver picked the wrong row.

2. **The fix would be**: manually set `b6771541.status = 'expired'`
   and then re-run the resolver for any zero-line sessions via the
   `/api/admin/agreements/sessions/:sessionId/resolve` endpoint.

3. **The risk is not theoretical** — Dalvegur has no collision risk (only
   one installation agreement after apply). VCP Lab is the only affected
   installation.

The coexistence path is recoverable but introduces operational risk in a
sandbox environment used for N1 driver testing. Superseding first costs
one script run; not superseding risks silent billing misses that require
manual remediation.

---

*Generated by FINAL-1 agent, 2026-05-31.*
