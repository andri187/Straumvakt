-- Sprint 4 milestone 4.1 — Membership lifecycle + PlatformGrant
-- (replaces PlatformAdmin per ADR 0014).
--
-- Path A1 from sprint-04 task list — additive enum values, additive
-- columns on memberships, new platform_grants table with backfill,
-- old platform_admins dropped after backfill. Deprecated MembershipRole
-- values (operator | helper | contractor | driver) stay on the enum;
-- Sprint 9's RLS rebuild will retire them when we can reshape the type
-- safely. No code references the deprecated values after Sprint 4 4.2
-- (the new permission catalogue maps only the post-ADR-0014 values).
--
-- Idempotent where possible (CREATE TYPE / TABLE without IF NOT EXISTS
-- because Postgres rejects those for these statements; the migrations
-- table guards re-runs).

-- ── 1. New MembershipRole values (additive) ─────────────────────────
-- ALTER TYPE … ADD VALUE is transaction-safe in Postgres 12+ (Neon
-- runs Postgres 17). IF NOT EXISTS lets the migration re-run without
-- error if half-applied.

ALTER TYPE "tenancy"."MembershipRole" ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE "tenancy"."MembershipRole" ADD VALUE IF NOT EXISTS 'technician';
ALTER TYPE "tenancy"."MembershipRole" ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE "tenancy"."MembershipRole" ADD VALUE IF NOT EXISTS 'support';

-- ── 2. New MembershipStatus enum ────────────────────────────────────

CREATE TYPE "tenancy"."MembershipStatus" AS ENUM (
  'invited', 'active', 'suspended', 'revoked'
);

-- ── 3. Membership lifecycle columns ─────────────────────────────────
-- Existing rows get status='active' (the column default). accepted_at
-- backfills to created_at so the audit trail is internally consistent
-- (we don't actually know when historical members "accepted" — at
-- minimum they existed by created_at).

ALTER TABLE "tenancy"."memberships"
  ADD COLUMN IF NOT EXISTS "status" "tenancy"."MembershipStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "invited_by_id"      UUID,
  ADD COLUMN IF NOT EXISTS "invited_at"         TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "accepted_at"        TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "suspended_at"       TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "revoked_at"         TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "scope_site_ids"     UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS "scope_property_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE "tenancy"."memberships"
SET "accepted_at" = "created_at"
WHERE "accepted_at" IS NULL;

ALTER TABLE "tenancy"."memberships"
  ADD CONSTRAINT "memberships_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "identity"."users"("id")
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "memberships_org_id_status_idx"
  ON "tenancy"."memberships" ("org_id", "status");

-- ── 4. PlatformRole + PlatformGrantStatus enums ─────────────────────

CREATE TYPE "identity"."PlatformRole" AS ENUM (
  'super_user',
  'platform_admin',
  'support_agent',
  'sales_cs',
  'finance_internal',
  'auditor'
);

CREATE TYPE "identity"."PlatformGrantStatus" AS ENUM (
  'active', 'suspended', 'revoked'
);

-- ── 5. platform_grants table (replaces platform_admins) ─────────────

CREATE TABLE "identity"."platform_grants" (
  "user_id"        UUID PRIMARY KEY REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "role"           "identity"."PlatformRole" NOT NULL,
  "status"         "identity"."PlatformGrantStatus" NOT NULL DEFAULT 'active',
  "granted_by_id"  UUID REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "granted_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "expires_at"     TIMESTAMPTZ(6),
  "revoked_at"     TIMESTAMPTZ(6),
  "revoked_by_id"  UUID REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "scope"          JSONB
);

-- ── 6. Backfill platform_grants from platform_admins ────────────────
-- Mapping per ADR 0014 §"Migration: backfill all PlatformAdmin rows
-- as role = 'platform_admin'":
--   level=superuser  → role=platform_admin
--   level=read_only  → role=auditor
-- A row in platform_admins becomes exactly one row in platform_grants.
-- Both tables have user_id as PK, so 1:1 mapping; no duplicates
-- possible.

INSERT INTO "identity"."platform_grants" (
  "user_id", "role", "status", "granted_by_id", "granted_at"
)
SELECT
  "user_id",
  CASE
    WHEN "level" = 'superuser' THEN 'platform_admin'::"identity"."PlatformRole"
    WHEN "level" = 'read_only' THEN 'auditor'::"identity"."PlatformRole"
    ELSE 'auditor'::"identity"."PlatformRole"  -- defensive default
  END,
  'active'::"identity"."PlatformGrantStatus",
  "granted_by_user_id",
  "granted_at"
FROM "identity"."platform_admins";

-- ── 7. Drop platform_admins ─────────────────────────────────────────
-- After backfill — irreversible. The old table is dropped fully so
-- nothing accidentally writes to it during cutover. Old code
-- referencing `db.platformAdmin.*` no longer exists in the codebase
-- (verified at commit time).

DROP TABLE "identity"."platform_admins";
DROP TYPE "identity"."PlatformAdminLevel";
