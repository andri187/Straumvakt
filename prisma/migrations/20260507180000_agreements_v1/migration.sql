-- Sprint 9 / ADR 0019 — agreements schema (milestone A.2/A.3)
--
-- New top-level namespace for the contract architecture re-base. Three
-- primitives — Agreement, BearerRule, RateReference — plus a revised
-- cost-factor catalog (DSO / ELE / ACS / PRM / TRF / SRF / RNT / MTR),
-- DriverGroup + memberships, and an output billing_lines table distinct
-- from the legacy billing.billing_lines.
--
-- Coexists with billing.contracts*, billing.cost_factors,
-- billing.tariff_definitions (ADR 0008). No FKs into the legacy schema.
-- Cutover is a separate ADR after milestone A.6.

CREATE SCHEMA IF NOT EXISTS "agreements";

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE "agreements"."AgreementType" AS ENUM (
  'cpo',        -- Straumvakt <-> CPO ORG
  'workplace'   -- Straumvakt <-> workplace ORG
);

CREATE TYPE "agreements"."AgreementStatus" AS ENUM (
  'draft',
  'active',
  'expired'
);

CREATE TYPE "agreements"."BearerType" AS ENUM (
  'org',  -- counterparty ORG of parent agreement (the CPO)
  'usr',  -- the driver running the session
  'wrk',  -- workplace ORG that owns the driver's DriverGroup
  'trd'   -- a specific other User (bearer_ref required)
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
  'passthrough',  -- routes to RateReference.supplier_org_id
  'markup'        -- routes to CPO ORG (revenue line)
);

CREATE TYPE "agreements"."AgrCostFactorStatus" AS ENUM (
  'draft',
  'active',
  'archived'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Cost-factor catalog (revised)
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
-- Agreement (top-level legal contract)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."agreements" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "counterparty_org_id"   UUID NOT NULL,
  "agreement_type"        "agreements"."AgreementType" NOT NULL,
  "display_name"          TEXT NOT NULL,
  "status"                "agreements"."AgreementStatus" NOT NULL DEFAULT 'draft',
  "effective_from"        TIMESTAMPTZ(6) NOT NULL,
  "effective_until"       TIMESTAMPTZ(6),
  "notes"                 TEXT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "agreements_counterparty_fk"
    FOREIGN KEY ("counterparty_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE
);

CREATE INDEX "agreements_counterparty_status_idx"
  ON "agreements"."agreements" ("counterparty_org_id", "status");
CREATE INDEX "agreements_effective_idx"
  ON "agreements"."agreements" ("effective_from");

-- ─────────────────────────────────────────────────────────────────────────
-- Per-factor agreement defaults
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
-- Driver groups
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
-- BearerRule — the override row
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

  -- Either both scope_type + scope_id are NULL or both set.
  CONSTRAINT "bearer_rules_scope_consistency"
    CHECK (("scope_type" IS NULL AND "scope_id" IS NULL)
        OR ("scope_type" IS NOT NULL AND "scope_id" IS NOT NULL)),

  -- Either both audience_type + audience_id are NULL or both set.
  CONSTRAINT "bearer_rules_audience_consistency"
    CHECK (("audience_type" IS NULL AND "audience_id" IS NULL)
        OR ("audience_type" IS NOT NULL AND "audience_id" IS NOT NULL)),

  -- bearer_ref is required iff bearer_type = 'trd'.
  CONSTRAINT "bearer_rules_bearer_ref_consistency"
    CHECK (("bearer_type" = 'trd' AND "bearer_ref" IS NOT NULL)
        OR ("bearer_type" IS NULL OR "bearer_type" <> 'trd'))
);

-- Resolver lookup — covers the per-attribute walk per ADR 0019.
CREATE INDEX "bearer_rules_walk_idx"
  ON "agreements"."bearer_rules"
     ("agreement_id", "cost_factor_id", "audience_type", "audience_id",
      "scope_type", "scope_id", "effective_from");
CREATE INDEX "bearer_rules_effective_idx"
  ON "agreements"."bearer_rules" ("effective_from");

-- ─────────────────────────────────────────────────────────────────────────
-- AgreementBillingLine — output table
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE "agreements"."billing_lines" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_id"          UUID NOT NULL,
  "session_id"            UUID NOT NULL,
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
    FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id") ON DELETE CASCADE
);

CREATE INDEX "agr_billing_lines_agreement_session_idx"
  ON "agreements"."billing_lines" ("agreement_id", "session_id");
CREATE INDEX "agr_billing_lines_session_factor_idx"
  ON "agreements"."billing_lines" ("session_id", "factor_code", "kind");
CREATE INDEX "agr_billing_lines_recipient_idx"
  ON "agreements"."billing_lines" ("recipient_org_id", "created_at" DESC);
