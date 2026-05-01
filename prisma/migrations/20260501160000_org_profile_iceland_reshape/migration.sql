-- Organization profile reshape — ADR 0014.
-- Iceland-aligned (Fyrirtækjaskrá) field shape, mainContact FK to
-- User, slug + free-form addresses/contacts JSON dropped. Enum trim
-- removes 12 OrganizationRole values that had zero code consumers.
--
-- Non-additive (Rule 4 break authorised by operator). Idempotent —
-- safe to re-run if a previous attempt partially applied (the prior
-- failure mode here was a Postgres rejection of subquery-in-USING
-- which left the schema half-migrated).

-- ── 1. New columns on organizations (idempotent) ───────────────────
ALTER TABLE "tenancy"."organizations"
  ADD COLUMN IF NOT EXISTS "legal_form_code"      TEXT,
  ADD COLUMN IF NOT EXISTS "postal_address"       JSONB,
  ADD COLUMN IF NOT EXISTS "legal_address"        JSONB,
  ADD COLUMN IF NOT EXISTS "municipality_code"    TEXT,
  ADD COLUMN IF NOT EXISTS "municipality_name"    TEXT,
  ADD COLUMN IF NOT EXISTS "main_contact_user_id" UUID
    REFERENCES "identity"."users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "organizations_main_contact_user_id_idx"
  ON "tenancy"."organizations" ("main_contact_user_id");

-- ── 2a. Backfill postal_address from legacy addresses.primary JSON ──
-- Idempotent: only fills rows where postal_address is still NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'tenancy'
      AND table_name = 'organizations'
      AND column_name = 'addresses'
  ) THEN
    UPDATE "tenancy"."organizations"
    SET "postal_address" = jsonb_build_object(
          'street',     "addresses"->'primary'->>'street',
          'postalCode', "addresses"->'primary'->>'postal_code',
          'city',       "addresses"->'primary'->>'city'
        )
    WHERE "postal_address" IS NULL
      AND "addresses"->'primary'->>'street'      IS NOT NULL
      AND "addresses"->'primary'->>'postal_code' IS NOT NULL
      AND "addresses"->'primary'->>'city'        IS NOT NULL;
  END IF;
END $$;

-- ── 2b. Drop slug, addresses, contacts (idempotent) ────────────────
ALTER TABLE "tenancy"."organizations"
  DROP COLUMN IF EXISTS "slug",
  DROP COLUMN IF EXISTS "addresses",
  DROP COLUMN IF EXISTS "contacts";

-- ── 3. OrganizationRole enum trim (temp-column path) ───────────────
-- Postgres rejects subqueries inside ALTER ... USING. Workaround: add
-- a new array column of the new type, backfill via UPDATE (where
-- subqueries ARE allowed), drop old, rename. Idempotent via
-- IF NOT EXISTS / IF EXISTS guards.

DO $$
BEGIN
  -- Create new enum type only if it doesn't already exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'OrganizationRole_new' AND n.nspname = 'tenancy'
  ) THEN
    CREATE TYPE "tenancy"."OrganizationRole_new" AS ENUM (
      'cpo', 'emsp', 'hub', 'nsp', 'site_host', 'service_contractor',
      'installer', 'vendor', 'regulator', 'dso', 'tso', 'retailer',
      'payment_processor'
    );
  END IF;
END $$;

-- Add the temp column if the swap hasn't happened yet (i.e., the
-- 'roles' column is still on the OLD type).
DO $$
DECLARE
  current_udt text;
BEGIN
  SELECT udt_name INTO current_udt
  FROM information_schema.columns
  WHERE table_schema = 'tenancy'
    AND table_name = 'organizations'
    AND column_name = 'roles';

  IF current_udt = 'OrganizationRole' THEN
    ALTER TABLE "tenancy"."organizations"
      ADD COLUMN IF NOT EXISTS "roles_new" "tenancy"."OrganizationRole_new"[]
        DEFAULT ARRAY[]::"tenancy"."OrganizationRole_new"[];

    UPDATE "tenancy"."organizations"
    SET "roles_new" = COALESCE((
      SELECT array_agg(v::text::"tenancy"."OrganizationRole_new")
      FROM unnest("roles") v
      WHERE v::text IN (
        'cpo','emsp','hub','nsp','site_host','service_contractor',
        'installer','vendor','regulator','dso','tso','retailer',
        'payment_processor'
      )
    ), ARRAY[]::"tenancy"."OrganizationRole_new"[]);

    ALTER TABLE "tenancy"."organizations" DROP COLUMN "roles";
    ALTER TABLE "tenancy"."organizations" RENAME COLUMN "roles_new" TO "roles";

    DROP TYPE "tenancy"."OrganizationRole";
    ALTER TYPE "tenancy"."OrganizationRole_new" RENAME TO "OrganizationRole";
  END IF;
END $$;
