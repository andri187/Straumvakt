# Agreement schema plan — consolidated migration

**Status:** Plan only. No code lands until this is approved.
**Date:** 2026-05-08
**Supersedes:** the two existing migrations on `feat/agreement-architecture`:
- `prisma/migrations/20260507180000_agreements_v1/`
- `prisma/migrations/20260507190000_agreements_cpo_org_id_and_str_factor/`

These migrations were never applied to any environment (staging or
otherwise). No rows exist in the `agreements` schema anywhere. That makes
the consolidated revision cheap.

## Two paths for consolidation

Both produce the same end state. Pick one and we land it.

### Path A — squash on the feature branch (cleaner history)

Delete the two existing migration directories, replace with one:
`20260508120000_agreements_v2`. Force-push `feat/agreement-architecture`.

- **Pros:** clean history; one migration to read, not three; matches the
  "do migration once" intent.
- **Cons:** force-push (the branch is pushed but not yet merged anywhere,
  so blast radius is just the working copy you may have on the Linux dev
  box). Anyone with the branch checked out will need to reset.

### Path B — additive on top (preserves history)

Keep the two existing migrations. Add a third:
`20260508120000_agreements_v2_alignment`. The new migration:
- Drops + recreates the `AgreementType` enum (Postgres can't add+remove
  values atomically).
- Drops + recreates the `cost_factors` rows (different catalog).
- Adds `installation_id`, `installation_type`, `billable_event_type`,
  nullable `session_id`.
- Rewrites the CHECK constraint.

- **Pros:** no force-push; preserves the design-iteration history.
- **Cons:** the migration is a strange-looking "rebuild what we just built"
  — readers wonder why. Three migrations to land instead of one. The
  reset is operationally identical because nothing's applied.

**Recommendation: Path A.** Force-pushing a feature branch that hasn't
been merged is conventional, and the resulting single migration is
materially easier to review.

## Final schema state (target — same under either path)

### Enum: `agreements.AgreementType`

```sql
CREATE TYPE "agreements"."AgreementType" AS ENUM (
  'service_cpo',          -- Straumvakt ↔ CPO        (commercial revenue)
  'service_contractor',   -- Straumvakt ↔ Contractor (commercial revenue)
  'service_workplace',    -- Straumvakt ↔ Workplace  (commercial revenue)
  'installation',         -- CPO ↔ themselves        (operational)
  'workplace'             -- CPO ↔ Workplace         (cost-bearing)
);
```

### Enum: `assets.InstallationType` (NEW)

```sql
CREATE TYPE "assets"."InstallationType" AS ENUM (
  'workplace',
  'mdu',
  'public',
  'private',
  'mixed'
);
```

Required column on `assets.installations`:

```sql
ALTER TABLE "assets"."installations"
  ADD COLUMN "installation_type" "assets"."InstallationType" NOT NULL DEFAULT 'workplace';
```

### Table: `agreements.agreements`

```sql
CREATE TABLE "agreements"."agreements" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_type"        "agreements"."AgreementType" NOT NULL,
  "counterparty_org_id"   UUID NOT NULL REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE,
  "cpo_org_id"            UUID REFERENCES "tenancy"."organizations"("id") ON DELETE RESTRICT,
  "installation_id"       UUID REFERENCES "assets"."installations"("id") ON DELETE RESTRICT,
  "default_driver_group_id" UUID,  -- for installation type=public
  "display_name"          TEXT NOT NULL,
  "status"                "agreements"."AgreementStatus" NOT NULL DEFAULT 'draft',
  "effective_from"        TIMESTAMPTZ(6) NOT NULL,
  "effective_until"       TIMESTAMPTZ(6),
  "notes"                 TEXT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "agreements_typed_anchors_consistency" CHECK (
    -- service_cpo: counterparty=CPO, no cpo_org, no installation
    (agreement_type = 'service_cpo'
       AND cpo_org_id IS NULL AND installation_id IS NULL)
    OR
    -- service_contractor: counterparty=Contractor, no cpo_org, no installation
    (agreement_type = 'service_contractor'
       AND cpo_org_id IS NULL AND installation_id IS NULL)
    OR
    -- service_workplace: counterparty=Workplace, no cpo_org, no installation
    (agreement_type = 'service_workplace'
       AND cpo_org_id IS NULL AND installation_id IS NULL)
    OR
    -- installation: counterparty=CPO, installation_id required, no cpo_org
    (agreement_type = 'installation'
       AND cpo_org_id IS NULL AND installation_id IS NOT NULL)
    OR
    -- workplace: counterparty=Workplace, cpo_org required, no installation
    (agreement_type = 'workplace'
       AND cpo_org_id IS NOT NULL AND installation_id IS NULL)
  )
);

CREATE INDEX "agreements_counterparty_status_idx"
  ON "agreements"."agreements" ("counterparty_org_id", "status");
CREATE INDEX "agreements_cpo_org_id_idx"
  ON "agreements"."agreements" ("cpo_org_id");
CREATE INDEX "agreements_installation_id_idx"
  ON "agreements"."agreements" ("installation_id");
CREATE INDEX "agreements_effective_idx"
  ON "agreements"."agreements" ("effective_from");
```

### Table: `agreements.billing_lines` (future-proofed)

Two changes from the original:

```sql
-- session_id was NOT NULL; becomes nullable for non-session events.
ALTER TABLE "agreements"."billing_lines"
  ALTER COLUMN "session_id" DROP NOT NULL;

-- New discriminator. Values now: 'session'. Future: 'service_invoice',
-- 'subscription', 'manual_adjustment'.
ALTER TABLE "agreements"."billing_lines"
  ADD COLUMN "billable_event_type" TEXT NOT NULL DEFAULT 'session';

-- And we want exactly one of (session_id, future event id) populated.
-- For now, just enforce session_id NOT NULL when type='session':
ALTER TABLE "agreements"."billing_lines"
  ADD CONSTRAINT "billing_lines_session_id_required_for_session"
  CHECK (
    (billable_event_type <> 'session')
    OR (billable_event_type = 'session' AND session_id IS NOT NULL)
  );
```

In the consolidated migration we just `CREATE TABLE` with the new shape
directly — no `ALTER` needed since the table doesn't exist yet under
Path A.

### Cost factor catalog — 15 rows

Re-seeded by `prisma/seed.ts`. Drop the old 9-factor catalog from the
seed (no rows in `agreements.cost_factors` exist). Replace with the
15-row catalog from the locked decisions:

| Code | IS | EN |
|---|---|---|
| INT | Hleðslukerfagjald | Price per installation |
| USRF | Notendagjald | Per-user-on-installation |
| CNR | Tenglagjald | Per-connector |
| RVN | Veltutengd gjöld | % of kWh charges |
| PRM | Premium | Premium user fee |
| AGN | Per Contractor Agent access | Per-agent (contractor) |
| WRK | Vinnan | Workplace service fee |
| DSO | Dreifing | DSO grid fee |
| ELE | Rafmagn | Retailer energy |
| MTR | Mælagjald | E-meter daily fee |
| RNT | Leiga | Charger rental |
| TRF | Álag | Idle / extra tariff |
| IDL | Idlepower | Idle power loss |
| NET | Internet | Internet / SIM cost |
| SRF | Þjónustugjald | Service line item |

### Things the migration does NOT need to do

- Touch the legacy `billing.contracts*` tables — still untouched per the
  original ADR.
- Touch the resolver code in `apps/api/src/lib/agreement/`. Pure TS,
  pure walk semantics, doesn't care about agreement types. The 20 unit
  tests still pass.
- Touch the `BearerRule` table — the override mechanic is unchanged.
- Touch `RateReference` table — same shape; rate book stays as-is.
- Touch `DriverGroup` / `DriverGroupMembership` — same shape.

## App-layer changes that follow

These are NOT in the migration; they're code changes that follow once
the migration is approved:

1. **A.6 endpoint** (`apps/api/src/routes/admin/agreements-debug.ts`):
   - Currently queries `agreement_type IN ('cpo', 'workplace')`.
   - Update to query `service_cpo + installation + workplace +
     service_workplace` and aggregate clauses + rules from all four.
   - Refresh the SessionContext build to include the installation
     contract's clauses.
2. **Zod validators for rule authoring** (new file in
   `apps/api/src/lib/agreement/validation.ts`):
   - ORG bearer: `bearer_ref` org has active `service_*` agreement.
   - TRD bearer: `bearer_ref` user has active membership covering the
     installation.
   - L3 (per-driver) overrides cannot reduce workplace L2 commitment.
3. **`installation_type`-aware factor enlistment**: rule-authoring UI
   surfaces only the factors valid for that installation's type.
4. **Public-access flow**: when creating an `installation_type=public`
   contract, force the operator to also set `default_driver_group_id`.

## What needs your approval before code

- **Path A vs Path B** for migration consolidation.
- The 15-factor catalog text + Icelandic spellings (above).
- The `installation_type` defaulting to `workplace` on existing rows
  (any existing installation rows will get `workplace` unless you
  rebackfill) — alternative: leave NOT NULL without default and require
  explicit setting at insert. I lean default `workplace` because that's
  the pilot case; mistakes are visible in the operator UI.

Confirm those three and I'll write the migration.
