-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "assets";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "charging";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "energy";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "entitlements";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "events";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hardware";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hosts";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "issues";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ocpp";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "people";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "properties";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "roaming";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tenancy";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "vendors";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "webhooks";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "identity"."UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "tenancy"."OrgStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "tenancy"."MembershipRole" AS ENUM ('owner', 'admin', 'operator', 'helper', 'contractor', 'driver', 'viewer');

-- CreateEnum
CREATE TYPE "hosts"."HostType" AS ENUM ('standard', 'workplace', 'mdu', 'hotel', 'fleet', 'retail');

-- CreateEnum
CREATE TYPE "hosts"."HostStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "properties"."SiteAccessLevel" AS ENUM ('public', 'private', 'taxi_only');

-- CreateEnum
CREATE TYPE "properties"."SitePowerClass" AS ENUM ('lt_50kw', 'between_50_150kw', 'between_150_500kw', 'gt_500kw');

-- CreateEnum
CREATE TYPE "properties"."SiteAssetKind" AS ENUM ('charger', 'meter', 'modem', 'controller');

-- CreateEnum
CREATE TYPE "properties"."InstallationOnboardingStatus" AS ENUM ('pending_credentials', 'discovering', 'active', 'suspended', 'error');

-- CreateEnum
CREATE TYPE "hardware"."HardwareVendorKind" AS ENUM ('charger_ac', 'charger_dc', 'meter', 'modem', 'controller', 'multi');

-- CreateEnum
CREATE TYPE "hardware"."VendorApiKind" AS ENUM ('oauth', 'basic_auth', 'none');

-- CreateEnum
CREATE TYPE "hardware"."VendorCredentialScope" AS ENUM ('installation', 'identity', 'none');

-- CreateEnum
CREATE TYPE "ocpp"."OcppVersion" AS ENUM ('ocpp_1_6', 'ocpp_2_0_1', 'ocpp_2_1');

-- CreateEnum
CREATE TYPE "ocpp"."AssetClass" AS ENUM ('ac', 'dc');

-- CreateEnum
CREATE TYPE "ocpp"."CommandStatus" AS ENUM ('pending', 'sent', 'acked', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "charging"."SessionStatus" AS ENUM ('in_progress', 'completed', 'aborted');

-- CreateEnum
CREATE TYPE "billing"."BalanceType" AS ENUM ('prepaid', 'postpaid', 'non_paying', 'pay_immediately', 'postpaid_immediately');

-- CreateEnum
CREATE TYPE "billing"."PlanCategory" AS ENUM ('single_tariff', 'membership', 'roaming', 'guest_otp');

-- CreateEnum
CREATE TYPE "billing"."TerminationBehavior" AS ENUM ('terminate', 'evergreen', 'rollover');

-- CreateEnum
CREATE TYPE "billing"."BillingTxType" AS ENUM ('payment', 'refund', 'penalty', 'credit', 'contract_charge', 'external_payment');

-- CreateEnum
CREATE TYPE "billing"."InvoiceStatus" AS ENUM ('draft', 'issued', 'paid', 'void');

-- CreateEnum
CREATE TYPE "issues"."IssueSubject" AS ENUM ('charger', 'ocpp_identity', 'connector', 'session', 'site', 'user', 'other');

-- CreateEnum
CREATE TYPE "issues"."IssueSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "issues"."IssueStatus" AS ENUM ('open', 'triaged', 'assigned', 'in_progress', 'waiting', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "events"."RetentionClass" AS ENUM ('financial', 'operational', 'raw_protocol', 'aggregate', 'issue_history');

-- CreateEnum
CREATE TYPE "audit"."ActorKind" AS ENUM ('user', 'system', 'vendor_webhook', 'ocpp_worker');

-- CreateEnum
CREATE TYPE "people"."MemberKind" AS ENUM ('primary', 'family_user');

-- CreateEnum
CREATE TYPE "roaming"."HubKind" AS ENUM ('hubject', 'gireve', 'direct');

-- CreateEnum
CREATE TYPE "roaming"."CdrDirection" AS ENUM ('inbound', 'outbound');

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "display_name" TEXT,
    "status" "identity"."UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT,
    "totp_secret" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tenancy"."organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "status" "tenancy"."OrgStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy"."memberships" (
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenancy"."MembershipRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("org_id","user_id")
);

-- CreateTable
CREATE TABLE "hosts"."charger_hosts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "type" "hosts"."HostType" NOT NULL DEFAULT 'standard',
    "address" JSONB NOT NULL DEFAULT '{}',
    "branding" JSONB NOT NULL DEFAULT '{}',
    "status" "hosts"."HostStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "charger_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosts"."charger_service_plans" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "revenue_share_rule" JSONB NOT NULL DEFAULT '{}',
    "electricity_reimbursement" JSONB NOT NULL DEFAULT '{}',
    "maintenance_responsibility" TEXT,
    "platform_fee_model" JSONB NOT NULL DEFAULT '{}',
    "default_tariff_id" UUID,
    "term_months" INTEGER,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "charger_service_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties"."properties" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "address" JSONB NOT NULL DEFAULT '{}',
    "location_type" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "provisioning_status" TEXT NOT NULL DEFAULT 'provisioned',
    "external" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties"."sites" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Atlantic/Reykjavik',
    "access_level" "properties"."SiteAccessLevel" NOT NULL DEFAULT 'private',
    "power_class" "properties"."SitePowerClass",
    "provisioning_status" TEXT NOT NULL DEFAULT 'provisioned',
    "external" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties"."site_assets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" "properties"."SiteAssetKind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties"."installations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "vendor_id" UUID,
    "model_id" UUID,
    "display_name" TEXT NOT NULL,
    "vendor_installation_ref" TEXT,
    "credentials_ref" TEXT,
    "credentials_status" TEXT,
    "onboarding_status" "properties"."InstallationOnboardingStatus" NOT NULL DEFAULT 'pending_credentials',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."chargers" (
    "site_asset_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "model_id" UUID,
    "installation_id" UUID,
    "vendor" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "install_date" DATE,
    "warranty_expires" DATE,
    "firmware_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chargers_pkey" PRIMARY KEY ("site_asset_id")
);

-- CreateTable
CREATE TABLE "assets"."meters" (
    "site_asset_id" UUID NOT NULL,
    "meter_serial" TEXT,
    "meter_type" TEXT,
    "max_amps" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("site_asset_id")
);

-- CreateTable
CREATE TABLE "assets"."modems" (
    "site_asset_id" UUID NOT NULL,
    "imei" TEXT,
    "carrier" TEXT,
    "iccid" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "modems_pkey" PRIMARY KEY ("site_asset_id")
);

-- CreateTable
CREATE TABLE "assets"."controllers" (
    "site_asset_id" UUID NOT NULL,
    "vendor" TEXT,
    "device_id" TEXT,
    "endpoint_url" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "controllers_pkey" PRIMARY KEY ("site_asset_id")
);

-- CreateTable
CREATE TABLE "hardware"."vendors" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "kind" "hardware"."HardwareVendorKind" NOT NULL,
    "website" TEXT,
    "api_kind" "hardware"."VendorApiKind" NOT NULL DEFAULT 'none',
    "support_contact" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hardware"."models" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "kind" "hardware"."HardwareVendorKind" NOT NULL,
    "asset_class" "ocpp"."AssetClass",
    "credential_scope" "hardware"."VendorCredentialScope" NOT NULL DEFAULT 'none',
    "profile" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpp"."ocpp_identities" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "charger_id" UUID NOT NULL,
    "identity_string" TEXT NOT NULL,
    "auth_secret_hash" TEXT NOT NULL,
    "ocpp_version" "ocpp"."OcppVersion" NOT NULL,
    "asset_class" "ocpp"."AssetClass" NOT NULL DEFAULT 'ac',
    "vendor" TEXT,
    "vendor_resource_id" TEXT,
    "credentials_ref" TEXT,
    "credentials_status" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "control_routing" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'provisioned',
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ocpp_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpp"."connectors" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "ocpp_identity_id" UUID NOT NULL,
    "connector_index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "max_power_kw" DECIMAL(8,2),
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "status_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpp"."outbound_commands" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "control_domain" TEXT NOT NULL,
    "routed_to" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ocpp"."CommandStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "not_before" TIMESTAMPTZ(6) NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(6),
    "result" JSONB,
    "correlation_id" UUID NOT NULL,
    "requested_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbound_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging"."sessions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "charger_id" UUID NOT NULL,
    "ocpp_identity_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "user_id" UUID,
    "id_tag" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "energy_wh" BIGINT,
    "stop_reason" TEXT,
    "status" "charging"."SessionStatus" NOT NULL DEFAULT 'in_progress',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging"."meter_values" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "energy_wh" BIGINT,
    "power_w" INTEGER,
    "voltage_v" DECIMAL(6,2),
    "current_a" DECIMAL(6,2),
    "soc_percent" DECIMAL(5,2),

    CONSTRAINT "meter_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging"."reservations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "user_id" UUID,
    "reserved_from" TIMESTAMPTZ(6) NOT NULL,
    "reserved_until" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."tariffs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "currency" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."customer_plans" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "balance_type" "billing"."BalanceType" NOT NULL,
    "category" "billing"."PlanCategory" NOT NULL,
    "products" JSONB NOT NULL DEFAULT '[]',
    "default_tariff_id" UUID,
    "termination_behavior" "billing"."TerminationBehavior" NOT NULL DEFAULT 'evergreen',
    "min_commitment_months" INTEGER,
    "cost_factor" DECIMAL(8,4),
    "country" TEXT,
    "currency" TEXT,
    "locale" TEXT,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_transactions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID,
    "type" "billing"."BillingTxType" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."invoices" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "status" "billing"."InvoiceStatus" NOT NULL DEFAULT 'draft',
    "issued_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "external_ref" TEXT,
    "pdf_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."statements" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues"."tickets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "subject_type" "issues"."IssueSubject" NOT NULL,
    "subject_id" UUID,
    "category" TEXT NOT NULL,
    "severity" "issues"."IssueSeverity" NOT NULL DEFAULT 'medium',
    "status" "issues"."IssueStatus" NOT NULL DEFAULT 'open',
    "detected_by" TEXT NOT NULL,
    "assigned_to_user_id" UUID,
    "assigned_to_contractor_id" UUID,
    "sla_target_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues"."ticket_events" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues"."detection_rules" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "detection_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events"."event_log" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "retention_class" "events"."RetentionClass" NOT NULL DEFAULT 'operational',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events"."idempotency_keys" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("scope","key")
);

-- CreateTable
CREATE TABLE "audit"."actions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_kind" "audit"."ActorKind" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements"."feature_flags" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "source_ref" UUID,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements"."enterprise_licenses" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "api_fair_use" JSONB NOT NULL DEFAULT '{}',
    "features" TEXT[],
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."family_groups" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people"."family_memberships" (
    "family_group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "member_kind" "people"."MemberKind" NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_memberships_pkey" PRIMARY KEY ("family_group_id","user_id")
);

-- CreateTable
CREATE TABLE "vendors"."adapter_health" (
    "id" UUID NOT NULL,
    "vendor" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "window_end" TIMESTAMPTZ(6) NOT NULL,
    "error_rate" DECIMAL(6,4) NOT NULL,
    "p50_latency_ms" INTEGER NOT NULL,
    "p95_latency_ms" INTEGER NOT NULL,
    "last_success_at" TIMESTAMPTZ(6),

    CONSTRAINT "adapter_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors"."contract_tests" (
    "id" UUID NOT NULL,
    "vendor" TEXT NOT NULL,
    "test_name" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "run_at" TIMESTAMPTZ(6) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "contract_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roaming"."ocpi_tokens" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "token_uid" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ocpi_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roaming"."hub_connections" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "hub" "roaming"."HubKind" NOT NULL,
    "party_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "credentials_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hub_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roaming"."cdr_queue" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "direction" "roaming"."CdrDirection" NOT NULL,
    "partner_ref" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cdr_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy"."site_energy_policies" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "policy" JSONB NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_energy_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy"."property_energy_policies" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "policy" JSONB NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_energy_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy"."energy_planning_results" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "energy_planning_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks"."subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "signing_secret_ref" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks"."deliveries" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "response_code" INTEGER,
    "response_body" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks"."dead_letters" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "last_error" TEXT,
    "moved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "identity"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "tenancy"."organizations"("slug");

-- CreateIndex
CREATE INDEX "charger_hosts_org_id_idx" ON "hosts"."charger_hosts"("org_id");

-- CreateIndex
CREATE INDEX "charger_service_plans_org_id_host_id_idx" ON "hosts"."charger_service_plans"("org_id", "host_id");

-- CreateIndex
CREATE INDEX "properties_org_id_host_id_idx" ON "properties"."properties"("org_id", "host_id");

-- CreateIndex
CREATE INDEX "sites_org_id_property_id_idx" ON "properties"."sites"("org_id", "property_id");

-- CreateIndex
CREATE INDEX "site_assets_org_id_site_id_idx" ON "properties"."site_assets"("org_id", "site_id");

-- CreateIndex
CREATE INDEX "site_assets_kind_status_idx" ON "properties"."site_assets"("kind", "status");

-- CreateIndex
CREATE INDEX "installations_org_id_site_id_idx" ON "properties"."installations"("org_id", "site_id");

-- CreateIndex
CREATE INDEX "installations_vendor_id_idx" ON "properties"."installations"("vendor_id");

-- CreateIndex
CREATE INDEX "chargers_model_id_idx" ON "assets"."chargers"("model_id");

-- CreateIndex
CREATE INDEX "chargers_installation_id_idx" ON "assets"."chargers"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "modems_imei_key" ON "assets"."modems"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_slug_key" ON "hardware"."vendors"("slug");

-- CreateIndex
CREATE INDEX "models_kind_status_idx" ON "hardware"."models"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "models_vendor_id_slug_key" ON "hardware"."models"("vendor_id", "slug");

-- CreateIndex
CREATE INDEX "ocpp_identities_org_id_charger_id_idx" ON "ocpp"."ocpp_identities"("org_id", "charger_id");

-- CreateIndex
CREATE UNIQUE INDEX "ocpp_identities_org_id_identity_string_key" ON "ocpp"."ocpp_identities"("org_id", "identity_string");

-- CreateIndex
CREATE INDEX "connectors_org_id_idx" ON "ocpp"."connectors"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_ocpp_identity_id_connector_index_key" ON "ocpp"."connectors"("ocpp_identity_id", "connector_index");

-- CreateIndex
CREATE INDEX "outbound_commands_status_not_before_idx" ON "ocpp"."outbound_commands"("status", "not_before");

-- CreateIndex
CREATE INDEX "outbound_commands_org_id_identity_id_idx" ON "ocpp"."outbound_commands"("org_id", "identity_id");

-- CreateIndex
CREATE INDEX "sessions_org_id_started_at_idx" ON "charging"."sessions"("org_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_charger_id_started_at_idx" ON "charging"."sessions"("charger_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_user_id_started_at_idx" ON "charging"."sessions"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "meter_values_session_id_measured_at_idx" ON "charging"."meter_values"("session_id", "measured_at");

-- CreateIndex
CREATE INDEX "reservations_org_id_reserved_from_idx" ON "charging"."reservations"("org_id", "reserved_from");

-- CreateIndex
CREATE INDEX "tariffs_org_id_idx" ON "billing"."tariffs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_plans_org_id_code_key" ON "billing"."customer_plans"("org_id", "code");

-- CreateIndex
CREATE INDEX "subscriptions_org_id_user_id_idx" ON "billing"."subscriptions"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "billing_transactions_org_id_occurred_at_idx" ON "billing"."billing_transactions"("org_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "invoices_org_id_user_id_period_start_idx" ON "billing"."invoices"("org_id", "user_id", "period_start");

-- CreateIndex
CREATE INDEX "statements_org_id_subject_type_subject_id_idx" ON "billing"."statements"("org_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "tickets_org_id_status_severity_idx" ON "issues"."tickets"("org_id", "status", "severity");

-- CreateIndex
CREATE INDEX "tickets_subject_type_subject_id_idx" ON "issues"."tickets"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "ticket_events_ticket_id_occurred_at_idx" ON "issues"."ticket_events"("ticket_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "detection_rules_org_id_rule_key_key" ON "issues"."detection_rules"("org_id", "rule_key");

-- CreateIndex
CREATE INDEX "event_log_org_id_occurred_at_idx" ON "events"."event_log"("org_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "event_log_aggregate_type_aggregate_id_occurred_at_idx" ON "events"."event_log"("aggregate_type", "aggregate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "event_log_event_type_occurred_at_idx" ON "events"."event_log"("event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "events"."idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "actions_org_id_occurred_at_idx" ON "audit"."actions"("org_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "actions_target_type_target_id_occurred_at_idx" ON "audit"."actions"("target_type", "target_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "feature_flags_org_id_scope_type_scope_id_feature_key_idx" ON "entitlements"."feature_flags"("org_id", "scope_type", "scope_id", "feature_key");

-- CreateIndex
CREATE INDEX "family_groups_org_id_idx" ON "people"."family_groups"("org_id");

-- CreateIndex
CREATE INDEX "adapter_health_vendor_window_start_idx" ON "vendors"."adapter_health"("vendor", "window_start");

-- CreateIndex
CREATE INDEX "contract_tests_vendor_run_at_idx" ON "vendors"."contract_tests"("vendor", "run_at" DESC);

-- CreateIndex
CREATE INDEX "ocpi_tokens_org_id_idx" ON "roaming"."ocpi_tokens"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ocpi_tokens_country_code_party_id_token_uid_key" ON "roaming"."ocpi_tokens"("country_code", "party_id", "token_uid");

-- CreateIndex
CREATE UNIQUE INDEX "hub_connections_org_id_hub_key" ON "roaming"."hub_connections"("org_id", "hub");

-- CreateIndex
CREATE INDEX "cdr_queue_org_id_status_idx" ON "roaming"."cdr_queue"("org_id", "status");

-- CreateIndex
CREATE INDEX "site_energy_policies_org_id_site_id_idx" ON "energy"."site_energy_policies"("org_id", "site_id");

-- CreateIndex
CREATE INDEX "property_energy_policies_org_id_property_id_idx" ON "energy"."property_energy_policies"("org_id", "property_id");

-- CreateIndex
CREATE INDEX "energy_planning_results_org_id_site_id_calculated_at_idx" ON "energy"."energy_planning_results"("org_id", "site_id", "calculated_at" DESC);

-- CreateIndex
CREATE INDEX "subscriptions_org_id_idx" ON "webhooks"."subscriptions"("org_id");

-- CreateIndex
CREATE INDEX "deliveries_subscription_id_created_at_idx" ON "webhooks"."deliveries"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "dead_letters_subscription_id_moved_at_idx" ON "webhooks"."dead_letters"("subscription_id", "moved_at" DESC);

-- AddForeignKey
ALTER TABLE "identity"."user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosts"."charger_hosts" ADD CONSTRAINT "charger_hosts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosts"."charger_service_plans" ADD CONSTRAINT "charger_service_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosts"."charger_service_plans" ADD CONSTRAINT "charger_service_plans_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"."charger_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."properties" ADD CONSTRAINT "properties_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."properties" ADD CONSTRAINT "properties_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"."charger_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"."properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."site_assets" ADD CONSTRAINT "site_assets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."site_assets" ADD CONSTRAINT "site_assets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "properties"."sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."installations" ADD CONSTRAINT "installations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."installations" ADD CONSTRAINT "installations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "properties"."sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."installations" ADD CONSTRAINT "installations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "hardware"."vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."installations" ADD CONSTRAINT "installations_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "hardware"."models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."chargers" ADD CONSTRAINT "chargers_site_asset_id_fkey" FOREIGN KEY ("site_asset_id") REFERENCES "properties"."site_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."chargers" ADD CONSTRAINT "chargers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."chargers" ADD CONSTRAINT "chargers_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "hardware"."models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."chargers" ADD CONSTRAINT "chargers_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "properties"."installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."meters" ADD CONSTRAINT "meters_site_asset_id_fkey" FOREIGN KEY ("site_asset_id") REFERENCES "properties"."site_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."modems" ADD CONSTRAINT "modems_site_asset_id_fkey" FOREIGN KEY ("site_asset_id") REFERENCES "properties"."site_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."controllers" ADD CONSTRAINT "controllers_site_asset_id_fkey" FOREIGN KEY ("site_asset_id") REFERENCES "properties"."site_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hardware"."models" ADD CONSTRAINT "models_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "hardware"."vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."ocpp_identities" ADD CONSTRAINT "ocpp_identities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."ocpp_identities" ADD CONSTRAINT "ocpp_identities_charger_id_fkey" FOREIGN KEY ("charger_id") REFERENCES "assets"."chargers"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."connectors" ADD CONSTRAINT "connectors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."connectors" ADD CONSTRAINT "connectors_ocpp_identity_id_fkey" FOREIGN KEY ("ocpp_identity_id") REFERENCES "ocpp"."ocpp_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."outbound_commands" ADD CONSTRAINT "outbound_commands_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."outbound_commands" ADD CONSTRAINT "outbound_commands_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "ocpp"."ocpp_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."outbound_commands" ADD CONSTRAINT "outbound_commands_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "properties"."sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_charger_id_fkey" FOREIGN KEY ("charger_id") REFERENCES "assets"."chargers"("site_asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_ocpp_identity_id_fkey" FOREIGN KEY ("ocpp_identity_id") REFERENCES "ocpp"."ocpp_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "ocpp"."connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."meter_values" ADD CONSTRAINT "meter_values_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."meter_values" ADD CONSTRAINT "meter_values_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."reservations" ADD CONSTRAINT "reservations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."reservations" ADD CONSTRAINT "reservations_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "ocpp"."connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."tariffs" ADD CONSTRAINT "tariffs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."customer_plans" ADD CONSTRAINT "customer_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."customer_plans" ADD CONSTRAINT "customer_plans_default_tariff_id_fkey" FOREIGN KEY ("default_tariff_id") REFERENCES "billing"."tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing"."customer_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."billing_transactions" ADD CONSTRAINT "billing_transactions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "billing"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."statements" ADD CONSTRAINT "statements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues"."tickets" ADD CONSTRAINT "tickets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues"."ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "issues"."tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues"."detection_rules" ADD CONSTRAINT "detection_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events"."event_log" ADD CONSTRAINT "event_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."actions" ADD CONSTRAINT "actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit"."actions" ADD CONSTRAINT "actions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements"."feature_flags" ADD CONSTRAINT "feature_flags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements"."enterprise_licenses" ADD CONSTRAINT "enterprise_licenses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."family_groups" ADD CONSTRAINT "family_groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."family_groups" ADD CONSTRAINT "family_groups_primary_user_id_fkey" FOREIGN KEY ("primary_user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."family_memberships" ADD CONSTRAINT "family_memberships_family_group_id_fkey" FOREIGN KEY ("family_group_id") REFERENCES "people"."family_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people"."family_memberships" ADD CONSTRAINT "family_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming"."ocpi_tokens" ADD CONSTRAINT "ocpi_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming"."ocpi_tokens" ADD CONSTRAINT "ocpi_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming"."hub_connections" ADD CONSTRAINT "hub_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming"."cdr_queue" ADD CONSTRAINT "cdr_queue_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy"."site_energy_policies" ADD CONSTRAINT "site_energy_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy"."site_energy_policies" ADD CONSTRAINT "site_energy_policies_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "properties"."sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy"."property_energy_policies" ADD CONSTRAINT "property_energy_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy"."property_energy_policies" ADD CONSTRAINT "property_energy_policies_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"."properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy"."energy_planning_results" ADD CONSTRAINT "energy_planning_results_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy"."energy_planning_results" ADD CONSTRAINT "energy_planning_results_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "properties"."sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks"."deliveries" ADD CONSTRAINT "deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhooks"."subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks"."dead_letters" ADD CONSTRAINT "dead_letters_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhooks"."subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

