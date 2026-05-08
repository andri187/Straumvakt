-- Sprint 9 / ADR 0019 (2026-05-08 addendum) — agreements schema v2.
--
-- Consolidated migration. Supersedes:
--   - 20260507180000_agreements_v1
--   - 20260507190000_agreements_cpo_org_id_and_str_factor
-- Both never applied to any environment. Squashed into this single
-- coherent migration.
--
-- Five agreement types across three layers:
--   - service_cpo / service_contractor / service_workplace  (commercial)
--   - installation                                          (operational, CPO-authored)
--   - workplace                                             (cost-bearing, CPO ↔ Workplace)
--
-- Plus:
--   - assets.installations.installation_type — load-bearing for factor
--     enlistment, audience flavors, TRD applicability, public access.
--   - agreements.billing_lines future-proofed for non-session events
--     via session_id NULL + billable_event_type discriminator.
--
-- Coexists with billing.contracts* (ADR 0008). No FKs into the legacy
-- schema.

CREATE SCHEMA IF NOT EXISTS "agreements";

-- ─────────────────────────────────────────────────────────────────────────
-- Installation type (properties.installations addition)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE "properties"."InstallationType" AS ENUM (
  'workplace',
  'mdu',
  'public',
  'private',
  'mixed'
);

ALTER TABLE "properties"."installations"
  ADD COLUMN "installation_type" "properties"."InstallationType"
    NOT NULL DEFAULT 'workplace';

-- ─────────────────────────────────────────────────────────────────────────
-- Agreement-namespace enums
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE "agreements"."AgreementType" AS ENUM (
  'service_cpo',         -- Straumvakt ↔ CPO        (commercial)
  'service_contractor',  -- Straumvakt ↔ Contractor (commercial)
  'service_workplace',   -- Straumvakt ↔ Workplace  (commercial)
  'installation',        -- CPO ↔ themselves        (operational)
  'workplace'            -- CPO ↔ Workplace         (cost-bearing)
);

CREATE TYPE "agreements"."AgreementStatus" AS ENUM (
  'draft',
  'active',
  'expired'
);

CREATE TYPE "agreements"."BearerType" AS ENUM (
  'org',  -- any Straumvakt-customer ORG (CPO / Contractor / Workplace)
  'usr',  -- the driver running the session
  'trd'   -- another User (MDU only, must already have access)
);

CREATE TYPE "agreements"."RuleScopeType" AS ENUM (
  'site',
  'installation',
  'circuit',
  'charger'
);

CREATE TYPE "agreements"."RuleAudienceType" AS ENUM (
  'driver_group',
  'user'
);

CREATE TYPE "agreements"."RateBasis" AS ENUM (
  'per_kwh',
  'per_minute',
  'per_day',
  'per_session'
);

CREATE TYPE "agreements"."BillingLineKind" AS ENUM (
  'passthrough',
  'markup'
);

CREATE TYPE "agreements"."AgrCostFactorStatus" AS ENUM (
  'draft',
  'active',
  'archived'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Cost-factor catalog (15-factor v2 catalog)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."cost_factors" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"              TEXT NOT NULL UNIQUE,
  "display_name_is"   TEXT NOT NULL,
  "display_name_en"   TEXT NOT NULL,
  "description"       TEXT,
  "status"            "agreements"."AgrCostFactorStatus" NOT NULL DEFAULT 'active',
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Versioned rate book
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."rate_references" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"              TEXT NOT NULL,
  "cost_factor_id"    UUID NOT NULL,
  "supplier_org_id"   UUID,
  "basis"             "agreements"."RateBasis" NOT NULL,
  "price_minor"       BIGINT NOT NULL,
  "currency"          TEXT NOT NULL DEFAULT 'ISK',
  "vat_rate_pct"      NUMERIC(4,2) NOT NULL,
  "effective_from"    TIMESTAMPTZ(6) NOT NULL,
  "effective_until"   TIMESTAMPTZ(6),
  "notes"             TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "rate_references_factor_fk"
    FOREIGN KEY ("cost_factor_id") REFERENCES "agreements"."cost_factors"("id"),
  CONSTRAINT "rate_references_supplier_fk"
    FOREIGN KEY ("supplier_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE SET NULL
);

CREATE INDEX "rate_references_code_effective_idx"
  ON "agreements"."rate_references" ("code", "effective_from" DESC);
CREATE INDEX "rate_references_factor_effective_idx"
  ON "agreements"."rate_references" ("cost_factor_id", "effective_from" DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Agreement (5-type)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."agreements" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_type"          "agreements"."AgreementType" NOT NULL,
  "counterparty_org_id"     UUID NOT NULL,
  "cpo_org_id"              UUID,
  "installation_id"         UUID,
  "default_driver_group_id" UUID,                                -- public installations only
  "display_name"            TEXT NOT NULL,
  "status"                  "agreements"."AgreementStatus" NOT NULL DEFAULT 'draft',
  "effective_from"          TIMESTAMPTZ(6) NOT NULL,
  "effective_until"         TIMESTAMPTZ(6),
  "notes"                   TEXT,
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "agreements_counterparty_fk"
    FOREIGN KEY ("counterparty_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "agreements_cpo_org_fk"
    FOREIGN KEY ("cpo_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "agreements_installation_fk"
    FOREIGN KEY ("installation_id") REFERENCES "properties"."installations"("id") ON DELETE RESTRICT,

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
    -- installation: counterparty=CPO, installation required, no cpo_org
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
CREATE INDEX "agreements_cpo_org_idx"
  ON "agreements"."agreements" ("cpo_org_id");
CREATE INDEX "agreements_installation_idx"
  ON "agreements"."agreements" ("installation_id");
CREATE INDEX "agreements_effective_idx"
  ON "agreements"."agreements" ("effective_from");

-- ─────────────────────────────────────────────────────────────────────────
-- AgreementClause — per-factor defaults
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."agreement_clauses" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_id"             UUID NOT NULL,
  "cost_factor_id"           UUID NOT NULL,
  "default_bearer_type"      "agreements"."BearerType" NOT NULL,
  "default_bearer_ref"       UUID,
  "default_rate_ref_code"    TEXT,
  "allocation_json"          JSONB NOT NULL,
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "agreement_clauses_agreement_fk"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"."agreements"("id") ON DELETE CASCADE,
  CONSTRAINT "agreement_clauses_factor_fk"
    FOREIGN KEY ("cost_factor_id") REFERENCES "agreements"."cost_factors"("id"),
  CONSTRAINT "agreement_clauses_unique" UNIQUE ("agreement_id", "cost_factor_id")
);

-- ─────────────────────────────────────────────────────────────────────────
-- DriverGroup + Membership
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."driver_groups" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_id"        UUID NOT NULL,
  "owner_org_id"        UUID NOT NULL,
  "display_name"        TEXT NOT NULL,
  "scope_filter_json"   JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "driver_groups_agreement_fk"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"."agreements"("id") ON DELETE CASCADE,
  CONSTRAINT "driver_groups_owner_fk"
    FOREIGN KEY ("owner_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE RESTRICT
);

CREATE INDEX "driver_groups_agreement_idx"
  ON "agreements"."driver_groups" ("agreement_id");
CREATE INDEX "driver_groups_owner_idx"
  ON "agreements"."driver_groups" ("owner_org_id");

CREATE TABLE "agreements"."driver_group_memberships" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_group_id"     UUID NOT NULL,
  "user_id"             UUID NOT NULL,
  "added_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "driver_group_memberships_group_fk"
    FOREIGN KEY ("driver_group_id") REFERENCES "agreements"."driver_groups"("id") ON DELETE CASCADE,
  CONSTRAINT "driver_group_memberships_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "driver_group_memberships_unique" UNIQUE ("driver_group_id", "user_id")
);

CREATE INDEX "driver_group_memberships_user_idx"
  ON "agreements"."driver_group_memberships" ("user_id");

-- ─────────────────────────────────────────────────────────────────────────
-- BearerRule — override row at (scope × audience)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."bearer_rules" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_id"      UUID NOT NULL,
  "cost_factor_id"    UUID NOT NULL,
  "scope_type"        "agreements"."RuleScopeType",
  "scope_id"          UUID,
  "audience_type"     "agreements"."RuleAudienceType",
  "audience_id"       UUID,
  "bearer_type"       "agreements"."BearerType",
  "bearer_ref"        UUID,
  "rate_ref_code"     TEXT,
  "allocation_json"   JSONB,
  "effective_from"    TIMESTAMPTZ(6) NOT NULL,
  "effective_until"   TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "bearer_rules_agreement_fk"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"."agreements"("id") ON DELETE CASCADE,
  CONSTRAINT "bearer_rules_factor_fk"
    FOREIGN KEY ("cost_factor_id") REFERENCES "agreements"."cost_factors"("id"),

  CONSTRAINT "bearer_rules_scope_consistency"
    CHECK (("scope_type" IS NULL AND "scope_id" IS NULL)
        OR ("scope_type" IS NOT NULL AND "scope_id" IS NOT NULL)),

  CONSTRAINT "bearer_rules_audience_consistency"
    CHECK (("audience_type" IS NULL AND "audience_id" IS NULL)
        OR ("audience_type" IS NOT NULL AND "audience_id" IS NOT NULL)),

  CONSTRAINT "bearer_rules_bearer_ref_consistency"
    CHECK (("bearer_type" = 'trd' AND "bearer_ref" IS NOT NULL)
        OR ("bearer_type" IS NULL OR "bearer_type" <> 'trd'))
);

CREATE INDEX "bearer_rules_walk_idx"
  ON "agreements"."bearer_rules"
     ("agreement_id", "cost_factor_id", "audience_type", "audience_id",
      "scope_type", "scope_id", "effective_from");
CREATE INDEX "bearer_rules_effective_idx"
  ON "agreements"."bearer_rules" ("effective_from");

-- ─────────────────────────────────────────────────────────────────────────
-- AgreementBillingLine — output table (future-proofed for non-session events)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."billing_lines" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_id"          UUID NOT NULL,
  "billable_event_type"   TEXT NOT NULL DEFAULT 'session',
  "session_id"            UUID,                                  -- nullable for non-session events
  "factor_code"           TEXT NOT NULL,
  "kind"                  "agreements"."BillingLineKind" NOT NULL,
  "basis_type"            "agreements"."RateBasis" NOT NULL,
  "basis_quantity"        NUMERIC(14,4) NOT NULL,
  "unit_price_minor"      BIGINT NOT NULL,
  "amount_ex_vat_minor"   BIGINT NOT NULL,
  "vat_rate_pct"          NUMERIC(4,2) NOT NULL,
  "vat_amount_minor"      BIGINT NOT NULL,
  "amount_inc_vat_minor"  BIGINT NOT NULL,
  "currency"              TEXT NOT NULL DEFAULT 'ISK',
  "bearer_type"           "agreements"."BearerType" NOT NULL,
  "bearer_ref"            UUID,
  "recipient_org_id"      UUID,
  "recipient_user_id"     UUID,
  "rate_ref_id"           UUID,
  "rule_id"               UUID,
  "computation_detail"    JSONB NOT NULL,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "agr_billing_lines_agreement_fk"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"."agreements"("id") ON DELETE CASCADE,
  CONSTRAINT "agr_billing_lines_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id") ON DELETE CASCADE,

  CONSTRAINT "agr_billing_lines_session_id_required_for_session" CHECK (
    (billable_event_type <> 'session') OR (session_id IS NOT NULL)
  )
);

CREATE INDEX "agr_billing_lines_agreement_event_idx"
  ON "agreements"."billing_lines" ("agreement_id", "billable_event_type");
CREATE INDEX "agr_billing_lines_session_factor_idx"
  ON "agreements"."billing_lines" ("session_id", "factor_code", "kind");
CREATE INDEX "agr_billing_lines_recipient_idx"
  ON "agreements"."billing_lines" ("recipient_org_id", "created_at" DESC);
