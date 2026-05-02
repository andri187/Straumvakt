-- User profile enrichment for API-onboarding (ADR 0014 partial).
-- Additive only (Rule 4 OK):
--   • New columns on identity.users (all nullable / defaulted).
--   • New enums + tables under identity + people schemas.
-- No data migration; existing rows pick up defaults.

-- ── 1. New enums ───────────────────────────────────────────────────

CREATE TYPE "identity"."UserAudience" AS ENUM (
  'operator', 'driver', 'service'
);

CREATE TYPE "identity"."VendorRefStatus" AS ENUM (
  'active', 'inactive_at_vendor', 'removed_at_vendor'
);

CREATE TYPE "identity"."IdTokenKind" AS ENUM (
  'rfid', 'app_jwt', 'magic_link', 'zaptec_proxy', 'ocpi_token', 'manual'
);

CREATE TYPE "identity"."IdTokenStatus" AS ENUM (
  'active', 'suspended', 'revoked', 'expired'
);

-- ── 2. identity.users new columns ──────────────────────────────────

ALTER TABLE "identity"."users"
  ADD COLUMN IF NOT EXISTS "audience"             "identity"."UserAudience" NOT NULL DEFAULT 'operator',
  ADD COLUMN IF NOT EXISTS "deleted_at"           TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "timezone"             TEXT NOT NULL DEFAULT 'Atlantic/Reykjavik',
  ADD COLUMN IF NOT EXISTS "email_verified_at"    TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "phone_verified_at"    TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "last_seen_at"         TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "consent_tos_at"       TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "consent_privacy_at"   TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "consent_marketing_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "metadata"             JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3. identity.user_vendor_refs ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "identity"."user_vendor_refs" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "vendor_slug"            TEXT NOT NULL,
  "vendor_user_id"         TEXT NOT NULL,
  "vendor_email"           TEXT,
  "vendor_role_hint"       TEXT,
  "scope_installation_id"  UUID REFERENCES "properties"."installations"("id") ON DELETE SET NULL,
  "status"                 "identity"."VendorRefStatus" NOT NULL DEFAULT 'active',
  "last_synced_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "metadata"               JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_vendor_refs_vendor_uniq"
  ON "identity"."user_vendor_refs" ("vendor_slug", "vendor_user_id");
CREATE INDEX IF NOT EXISTS "user_vendor_refs_user_id_idx"
  ON "identity"."user_vendor_refs" ("user_id");
CREATE INDEX IF NOT EXISTS "user_vendor_refs_scope_installation_id_idx"
  ON "identity"."user_vendor_refs" ("scope_installation_id");

-- ── 4. identity.id_tokens ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "identity"."id_tokens" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "kind"                   "identity"."IdTokenKind" NOT NULL,
  "value"                  TEXT NOT NULL UNIQUE,
  "vendor_issued_by"       TEXT,
  "vendor_token_id"        TEXT,
  "label"                  TEXT,
  "status"                 "identity"."IdTokenStatus" NOT NULL DEFAULT 'active',
  "expires_at"             TIMESTAMPTZ(6),
  "last_used_at"           TIMESTAMPTZ(6),
  "scope_installation_id"  UUID REFERENCES "properties"."installations"("id") ON DELETE SET NULL,
  "metadata"               JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "id_tokens_user_id_idx"
  ON "identity"."id_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "id_tokens_status_value_idx"
  ON "identity"."id_tokens" ("status", "value");
CREATE INDEX IF NOT EXISTS "id_tokens_scope_installation_id_idx"
  ON "identity"."id_tokens" ("scope_installation_id");
CREATE INDEX IF NOT EXISTS "id_tokens_vendor_issued_idx"
  ON "identity"."id_tokens" ("vendor_issued_by", "vendor_token_id");

-- ── 5. identity.vendor_user_groups + memberships ───────────────────

CREATE TABLE IF NOT EXISTS "identity"."vendor_user_groups" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "vendor_slug"       TEXT NOT NULL,
  "vendor_group_id"   TEXT NOT NULL,
  "installation_id"   UUID NOT NULL REFERENCES "properties"."installations"("id") ON DELETE CASCADE,
  "name"              TEXT NOT NULL,
  "metadata"          JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_user_groups_vendor_uniq"
  ON "identity"."vendor_user_groups" ("vendor_slug", "vendor_group_id");
CREATE INDEX IF NOT EXISTS "vendor_user_groups_installation_id_idx"
  ON "identity"."vendor_user_groups" ("installation_id");

CREATE TABLE IF NOT EXISTS "identity"."vendor_user_group_memberships" (
  "group_id"   UUID NOT NULL REFERENCES "identity"."vendor_user_groups"("id") ON DELETE CASCADE,
  "user_id"    UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "role"       TEXT NOT NULL,
  "metadata"   JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("group_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "vendor_user_group_memberships_user_id_idx"
  ON "identity"."vendor_user_group_memberships" ("user_id");

-- ── 6. people.vehicles ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "people"."vehicles" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                UUID NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "make"                   TEXT,
  "model"                  TEXT,
  "year"                   INTEGER,
  "license_plate"          TEXT,
  "vin"                    TEXT UNIQUE,
  "battery_capacity_kwh"   DECIMAL(6, 2),
  "metadata"               JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "vehicles_user_id_idx"
  ON "people"."vehicles" ("user_id");
