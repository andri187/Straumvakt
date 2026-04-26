-- CreateEnum
CREATE TYPE "tenancy"."OrganizationRole" AS ENUM ('csms_provider', 'operator', 'service_contractor', 'installer', 'vendor', 'asset_owner', 'payer', 'beneficiary', 'customer', 'retailer', 'dso', 'tso', 'producer', 'aggregator', 'public_charging', 'home_charging', 'emsp', 'roaming_hub', 'payment_processor', 'insurance_provider', 'regulator');

-- CreateEnum
CREATE TYPE "identity"."PlatformAdminLevel" AS ENUM ('read_only', 'superuser');

-- CreateEnum
CREATE TYPE "properties"."SiteType" AS ENUM ('standard', 'workplace', 'mdu', 'hotel', 'fleet', 'retail');

-- CreateEnum
CREATE TYPE "billing"."CostFactorAnchor" AS ENUM ('org', 'property', 'site', 'installation', 'circuit', 'charger', 'driver_contract');

-- CreateEnum
CREATE TYPE "billing"."CostFactorStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "billing"."ContractScopeType" AS ENUM ('org', 'property', 'site', 'installation', 'charger');

-- CreateEnum
CREATE TYPE "billing"."ContractStatus" AS ENUM ('pending_configuration', 'active', 'superseded', 'archived');

-- CreateEnum
CREATE TYPE "billing"."DriverContractOwnerType" AS ENUM ('workplace', 'family_group', 'self');

-- DropForeignKey
ALTER TABLE "hosts"."charger_hosts" DROP CONSTRAINT "charger_hosts_org_id_fkey";

-- DropForeignKey
ALTER TABLE "hosts"."charger_service_plans" DROP CONSTRAINT "charger_service_plans_org_id_fkey";

-- DropForeignKey
ALTER TABLE "hosts"."charger_service_plans" DROP CONSTRAINT "charger_service_plans_host_id_fkey";

-- DropForeignKey
ALTER TABLE "properties"."properties" DROP CONSTRAINT "properties_host_id_fkey";

-- DropForeignKey
ALTER TABLE "assets"."chargers" DROP CONSTRAINT "chargers_site_asset_id_fkey";

-- DropForeignKey
ALTER TABLE "assets"."chargers" DROP CONSTRAINT "chargers_org_id_fkey";

-- DropForeignKey
ALTER TABLE "assets"."chargers" DROP CONSTRAINT "chargers_model_id_fkey";

-- DropForeignKey
ALTER TABLE "assets"."chargers" DROP CONSTRAINT "chargers_installation_id_fkey";

-- DropForeignKey
ALTER TABLE "ocpp"."ocpp_identities" DROP CONSTRAINT "ocpp_identities_charger_id_fkey";

-- DropForeignKey
ALTER TABLE "ocpp"."connectors" DROP CONSTRAINT "connectors_org_id_fkey";

-- DropForeignKey
ALTER TABLE "ocpp"."connectors" DROP CONSTRAINT "connectors_ocpp_identity_id_fkey";

-- DropForeignKey
ALTER TABLE "charging"."sessions" DROP CONSTRAINT "sessions_charger_id_fkey";

-- DropForeignKey
ALTER TABLE "charging"."sessions" DROP CONSTRAINT "sessions_ocpp_identity_id_fkey";

-- DropForeignKey
ALTER TABLE "charging"."sessions" DROP CONSTRAINT "sessions_connector_id_fkey";

-- DropForeignKey (manual fix: prisma migrate diff missed this — Reservation.connector
-- relation didn't change shape in the schema, but the underlying connectors table is
-- being moved from ocpp to assets, so the FK needs to be dropped here and re-created
-- pointing at the new table further down.)
ALTER TABLE "charging"."reservations" DROP CONSTRAINT "reservations_connector_id_fkey";

-- DropIndex
DROP INDEX "properties"."properties_org_id_host_id_idx";

-- DropIndex
DROP INDEX "ocpp"."ocpp_identities_org_id_charger_id_idx";

-- DropIndex
DROP INDEX "charging"."sessions_charger_id_started_at_idx";

-- AlterTable
ALTER TABLE "identity"."users" ADD COLUMN     "kennitala" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'is',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "tenancy"."organizations" ADD COLUMN     "addresses" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "branding" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "contacts" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "default_currency" TEXT NOT NULL DEFAULT 'ISK',
ADD COLUMN     "kennitala" TEXT,
ADD COLUMN     "legal_form" TEXT,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "lei_code" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "regulator_licence_no" TEXT,
ADD COLUMN     "roles" "tenancy"."OrganizationRole"[] DEFAULT ARRAY[]::"tenancy"."OrganizationRole"[],
ADD COLUMN     "vsk_nr" TEXT;

-- AlterTable
ALTER TABLE "properties"."properties" DROP COLUMN "host_id";

-- AlterTable
ALTER TABLE "properties"."sites" ADD COLUMN     "dso_tariff_id" UUID,
ADD COLUMN     "site_type" "properties"."SiteType" NOT NULL DEFAULT 'standard',
ADD COLUMN     "spvivf_tariff_id" UUID,
ADD COLUMN     "usrf_prem_tariff_id" UUID,
ADD COLUMN     "usrf_tariff_id" UUID,
ADD COLUMN     "xtrrf_tariff_id" UUID;

-- AlterTable
ALTER TABLE "properties"."installations" ADD COLUMN     "retailer_tariff_id" UUID;

-- AlterTable
ALTER TABLE "ocpp"."ocpp_identities" DROP COLUMN "capabilities",
DROP COLUMN "charger_id",
DROP COLUMN "control_routing",
ADD COLUMN     "charging_station_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "charging"."sessions" DROP COLUMN "charger_id",
ADD COLUMN     "charging_station_id" UUID NOT NULL,
ADD COLUMN     "cost_ex_vat_minor" BIGINT,
ADD COLUMN     "cost_inc_vat_minor" BIGINT,
ADD COLUMN     "evse_id" UUID NOT NULL,
ALTER COLUMN "ocpp_identity_id" DROP NOT NULL,
ALTER COLUMN "connector_id" DROP NOT NULL;

-- DropTable
DROP TABLE "hosts"."charger_hosts";

-- DropTable
DROP TABLE "hosts"."charger_service_plans";

-- DropTable
DROP TABLE "assets"."chargers";

-- DropTable
DROP TABLE "ocpp"."connectors";

-- DropEnum
DROP TYPE "hosts"."HostType";

-- DropEnum
DROP TYPE "hosts"."HostStatus";

-- CreateTable
CREATE TABLE "assets"."charging_stations" (
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
    "circuit_id" UUID,
    "owner_org_id" UUID,
    "chrgrf_tariff_id" UUID,

    CONSTRAINT "charging_stations_pkey" PRIMARY KEY ("site_asset_id")
);

-- CreateTable
CREATE TABLE "assets"."evses" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "charging_station_id" UUID NOT NULL,
    "evse_index" INTEGER NOT NULL,
    "max_power_kw" DECIMAL(8,2),
    "phase_count" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "status_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."connectors" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "evse_id" UUID NOT NULL,
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
CREATE TABLE "assets"."capability_profiles" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "charging_station_id" UUID NOT NULL,
    "control_plane" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "capability_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."control_routing_policies" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "charging_station_id" UUID NOT NULL,
    "routing" JSONB NOT NULL,
    "fallback_plane" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "control_routing_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging"."protocol_transaction_refs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_transaction_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging"."imported_cdr_refs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_cdr_id" TEXT NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_cdr_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors"."vendor_asset_refs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "charging_station_id" UUID NOT NULL,
    "vendor_slug" TEXT NOT NULL,
    "vendor_asset_id" TEXT NOT NULL,
    "credentials_ref" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_asset_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roaming"."external_cpms_refs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "charging_station_id" UUID NOT NULL,
    "external_cpms_slug" TEXT NOT NULL,
    "external_asset_id" TEXT NOT NULL,
    "import_mode" TEXT NOT NULL,
    "credentials_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_imported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "external_cpms_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."platform_admins" (
    "user_id" UUID NOT NULL,
    "level" "identity"."PlatformAdminLevel" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by_user_id" UUID,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "properties"."circuits" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "installation_id" UUID,
    "display_name" TEXT NOT NULL,
    "ampere_ceiling" INTEGER,
    "phase_count" INTEGER NOT NULL DEFAULT 3,
    "vendor_circuit_ref" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "circuits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpp"."configuration_keys" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "ocpp_identity_id" UUID NOT NULL,
    "key_name" TEXT NOT NULL,
    "key_value" TEXT,
    "readonly" BOOLEAN NOT NULL DEFAULT false,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "set_by_actor_user_id" UUID,
    "set_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "configuration_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."cost_factors" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "anchor_tier" "billing"."CostFactorAnchor" NOT NULL,
    "default_vat_rate_pct" DECIMAL(4,2) NOT NULL,
    "default_currency" TEXT NOT NULL DEFAULT 'ISK',
    "status" "billing"."CostFactorStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."tariff_definitions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "cost_factor_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "compute_rule" JSONB NOT NULL,
    "vat_rate_pct" DECIMAL(4,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ISK',
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tariff_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."cost_centers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "payer_org_id" UUID,
    "payer_user_id" UUID,
    "beneficiary_org_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."contracts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "scope_type" "billing"."ContractScopeType" NOT NULL,
    "scope_id" UUID,
    "parent_contract_id" UUID,
    "display_name" TEXT NOT NULL,
    "status" "billing"."ContractStatus" NOT NULL DEFAULT 'pending_configuration',
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."contract_factor_assignments" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "cost_factor_id" UUID NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "allocation_rule" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),

    CONSTRAINT "contract_factor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."driver_contracts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope_type" "billing"."ContractScopeType",
    "scope_id" UUID,
    "parent_contract_id" UUID,
    "owner_type" "billing"."DriverContractOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "wrkpf_tariff_id" UUID,
    "display_name" TEXT NOT NULL,
    "status" "billing"."ContractStatus" NOT NULL DEFAULT 'pending_configuration',
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "driver_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."driver_contract_factor_overrides" (
    "id" UUID NOT NULL,
    "driver_contract_id" UUID NOT NULL,
    "cost_factor_id" UUID NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "allocation_rule" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scope_type" "billing"."ContractScopeType",
    "scope_id" UUID,

    CONSTRAINT "driver_contract_factor_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."contract_period_accumulators" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "driver_contract_id" UUID,
    "contract_id" UUID,
    "cost_factor_id" UUID NOT NULL,
    "period_type" TEXT NOT NULL DEFAULT 'calendar_month',
    "period_start_date" DATE NOT NULL,
    "period_end_date" DATE NOT NULL,
    "cumulative_kwh" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "cumulative_amount_ex_vat_minor" BIGINT NOT NULL DEFAULT 0,
    "cumulative_session_count" INTEGER NOT NULL DEFAULT 0,
    "last_session_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contract_period_accumulators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."billing_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "cost_factor_id" UUID NOT NULL,
    "cost_factor_code" TEXT NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "amount_ex_vat_minor" BIGINT NOT NULL,
    "vat_rate_pct" DECIMAL(4,2) NOT NULL,
    "vat_amount_minor" BIGINT NOT NULL,
    "amount_inc_vat_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "computation_detail" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "charging_stations_model_id_idx" ON "assets"."charging_stations"("model_id");

-- CreateIndex
CREATE INDEX "charging_stations_installation_id_idx" ON "assets"."charging_stations"("installation_id");

-- CreateIndex
CREATE INDEX "charging_stations_circuit_id_idx" ON "assets"."charging_stations"("circuit_id");

-- CreateIndex
CREATE INDEX "charging_stations_owner_org_id_idx" ON "assets"."charging_stations"("owner_org_id");

-- CreateIndex
CREATE INDEX "evses_org_id_status_idx" ON "assets"."evses"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "evses_charging_station_id_evse_index_key" ON "assets"."evses"("charging_station_id", "evse_index");

-- CreateIndex
CREATE INDEX "connectors_org_id_idx" ON "assets"."connectors"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_evse_id_connector_index_key" ON "assets"."connectors"("evse_id", "connector_index");

-- CreateIndex
CREATE UNIQUE INDEX "capability_profiles_charging_station_id_control_plane_key" ON "assets"."capability_profiles"("charging_station_id", "control_plane");

-- CreateIndex
CREATE UNIQUE INDEX "control_routing_policies_charging_station_id_key" ON "assets"."control_routing_policies"("charging_station_id");

-- CreateIndex
CREATE INDEX "protocol_transaction_refs_session_id_idx" ON "charging"."protocol_transaction_refs"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_transaction_refs_source_kind_source_id_key" ON "charging"."protocol_transaction_refs"("source_kind", "source_id");

-- CreateIndex
CREATE INDEX "imported_cdr_refs_session_id_idx" ON "charging"."imported_cdr_refs"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "imported_cdr_refs_source_kind_source_cdr_id_key" ON "charging"."imported_cdr_refs"("source_kind", "source_cdr_id");

-- CreateIndex
CREATE INDEX "vendor_asset_refs_org_id_vendor_slug_idx" ON "vendors"."vendor_asset_refs"("org_id", "vendor_slug");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_asset_refs_vendor_slug_vendor_asset_id_key" ON "vendors"."vendor_asset_refs"("vendor_slug", "vendor_asset_id");

-- CreateIndex
CREATE INDEX "external_cpms_refs_org_id_idx" ON "roaming"."external_cpms_refs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_cpms_refs_external_cpms_slug_external_asset_id_key" ON "roaming"."external_cpms_refs"("external_cpms_slug", "external_asset_id");

-- CreateIndex
CREATE INDEX "circuits_org_id_site_id_idx" ON "properties"."circuits"("org_id", "site_id");

-- CreateIndex
CREATE INDEX "circuits_installation_id_idx" ON "properties"."circuits"("installation_id");

-- CreateIndex
CREATE INDEX "configuration_keys_org_id_ocpp_identity_id_idx" ON "ocpp"."configuration_keys"("org_id", "ocpp_identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_keys_ocpp_identity_id_key_name_key" ON "ocpp"."configuration_keys"("ocpp_identity_id", "key_name");

-- CreateIndex
CREATE UNIQUE INDEX "cost_factors_code_key" ON "billing"."cost_factors"("code");

-- CreateIndex
CREATE INDEX "tariff_definitions_org_id_cost_factor_id_valid_from_idx" ON "billing"."tariff_definitions"("org_id", "cost_factor_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_org_id_code_key" ON "billing"."cost_centers"("org_id", "code");

-- CreateIndex
CREATE INDEX "contracts_org_id_scope_type_scope_id_idx" ON "billing"."contracts"("org_id", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "contract_factor_assignments_contract_id_cost_factor_id_prio_idx" ON "billing"."contract_factor_assignments"("contract_id", "cost_factor_id", "priority");

-- CreateIndex
CREATE INDEX "driver_contracts_org_id_user_id_valid_from_idx" ON "billing"."driver_contracts"("org_id", "user_id", "valid_from");

-- CreateIndex
CREATE INDEX "driver_contract_factor_overrides_driver_contract_id_cost_fa_idx" ON "billing"."driver_contract_factor_overrides"("driver_contract_id", "cost_factor_id", "priority");

-- CreateIndex
CREATE INDEX "contract_period_accumulators_org_id_period_start_date_idx" ON "billing"."contract_period_accumulators"("org_id", "period_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "contract_period_accumulators_driver_contract_id_cost_factor_key" ON "billing"."contract_period_accumulators"("driver_contract_id", "cost_factor_id", "period_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "contract_period_accumulators_contract_id_cost_factor_id_per_key" ON "billing"."contract_period_accumulators"("contract_id", "cost_factor_id", "period_start_date");

-- CreateIndex
CREATE INDEX "billing_lines_org_id_session_id_idx" ON "billing"."billing_lines"("org_id", "session_id");

-- CreateIndex
CREATE INDEX "billing_lines_cost_center_id_created_at_idx" ON "billing"."billing_lines"("cost_center_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_kennitala_key" ON "identity"."users"("kennitala");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_kennitala_key" ON "tenancy"."organizations"("kennitala");

-- CreateIndex
CREATE INDEX "properties_org_id_idx" ON "properties"."properties"("org_id");

-- CreateIndex
CREATE INDEX "ocpp_identities_org_id_charging_station_id_idx" ON "ocpp"."ocpp_identities"("org_id", "charging_station_id");

-- CreateIndex
CREATE INDEX "sessions_evse_id_started_at_idx" ON "charging"."sessions"("evse_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_dso_tariff_id_fkey" FOREIGN KEY ("dso_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_usrf_tariff_id_fkey" FOREIGN KEY ("usrf_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_usrf_prem_tariff_id_fkey" FOREIGN KEY ("usrf_prem_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_xtrrf_tariff_id_fkey" FOREIGN KEY ("xtrrf_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."sites" ADD CONSTRAINT "sites_spvivf_tariff_id_fkey" FOREIGN KEY ("spvivf_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."installations" ADD CONSTRAINT "installations_retailer_tariff_id_fkey" FOREIGN KEY ("retailer_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_site_asset_id_fkey" FOREIGN KEY ("site_asset_id") REFERENCES "properties"."site_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "hardware"."models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "properties"."installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_circuit_id_fkey" FOREIGN KEY ("circuit_id") REFERENCES "properties"."circuits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."charging_stations" ADD CONSTRAINT "charging_stations_chrgrf_tariff_id_fkey" FOREIGN KEY ("chrgrf_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."evses" ADD CONSTRAINT "evses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."evses" ADD CONSTRAINT "evses_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."connectors" ADD CONSTRAINT "connectors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."connectors" ADD CONSTRAINT "connectors_evse_id_fkey" FOREIGN KEY ("evse_id") REFERENCES "assets"."evses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."capability_profiles" ADD CONSTRAINT "capability_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."capability_profiles" ADD CONSTRAINT "capability_profiles_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."control_routing_policies" ADD CONSTRAINT "control_routing_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."control_routing_policies" ADD CONSTRAINT "control_routing_policies_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."ocpp_identities" ADD CONSTRAINT "ocpp_identities_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_evse_id_fkey" FOREIGN KEY ("evse_id") REFERENCES "assets"."evses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "assets"."connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (manual fix paired with the corresponding DROP earlier — re-anchors
-- charging.reservations.connector_id at the new assets.connectors table.)
ALTER TABLE "charging"."reservations" ADD CONSTRAINT "reservations_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "assets"."connectors"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."sessions" ADD CONSTRAINT "sessions_ocpp_identity_id_fkey" FOREIGN KEY ("ocpp_identity_id") REFERENCES "ocpp"."ocpp_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."protocol_transaction_refs" ADD CONSTRAINT "protocol_transaction_refs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."protocol_transaction_refs" ADD CONSTRAINT "protocol_transaction_refs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."imported_cdr_refs" ADD CONSTRAINT "imported_cdr_refs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging"."imported_cdr_refs" ADD CONSTRAINT "imported_cdr_refs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors"."vendor_asset_refs" ADD CONSTRAINT "vendor_asset_refs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors"."vendor_asset_refs" ADD CONSTRAINT "vendor_asset_refs_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming"."external_cpms_refs" ADD CONSTRAINT "external_cpms_refs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roaming"."external_cpms_refs" ADD CONSTRAINT "external_cpms_refs_charging_station_id_fkey" FOREIGN KEY ("charging_station_id") REFERENCES "assets"."charging_stations"("site_asset_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."platform_admins" ADD CONSTRAINT "platform_admins_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."circuits" ADD CONSTRAINT "circuits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."circuits" ADD CONSTRAINT "circuits_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "properties"."sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties"."circuits" ADD CONSTRAINT "circuits_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "properties"."installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."configuration_keys" ADD CONSTRAINT "configuration_keys_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."configuration_keys" ADD CONSTRAINT "configuration_keys_ocpp_identity_id_fkey" FOREIGN KEY ("ocpp_identity_id") REFERENCES "ocpp"."ocpp_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp"."configuration_keys" ADD CONSTRAINT "configuration_keys_set_by_actor_user_id_fkey" FOREIGN KEY ("set_by_actor_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."tariff_definitions" ADD CONSTRAINT "tariff_definitions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."tariff_definitions" ADD CONSTRAINT "tariff_definitions_cost_factor_id_fkey" FOREIGN KEY ("cost_factor_id") REFERENCES "billing"."cost_factors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."cost_centers" ADD CONSTRAINT "cost_centers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."cost_centers" ADD CONSTRAINT "cost_centers_payer_org_id_fkey" FOREIGN KEY ("payer_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."cost_centers" ADD CONSTRAINT "cost_centers_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."cost_centers" ADD CONSTRAINT "cost_centers_beneficiary_org_id_fkey" FOREIGN KEY ("beneficiary_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contracts" ADD CONSTRAINT "contracts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contracts" ADD CONSTRAINT "contracts_parent_contract_id_fkey" FOREIGN KEY ("parent_contract_id") REFERENCES "billing"."contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_factor_assignments" ADD CONSTRAINT "contract_factor_assignments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "billing"."contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_factor_assignments" ADD CONSTRAINT "contract_factor_assignments_cost_factor_id_fkey" FOREIGN KEY ("cost_factor_id") REFERENCES "billing"."cost_factors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_factor_assignments" ADD CONSTRAINT "contract_factor_assignments_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "billing"."cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contracts" ADD CONSTRAINT "driver_contracts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contracts" ADD CONSTRAINT "driver_contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contracts" ADD CONSTRAINT "driver_contracts_parent_contract_id_fkey" FOREIGN KEY ("parent_contract_id") REFERENCES "billing"."driver_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contracts" ADD CONSTRAINT "driver_contracts_wrkpf_tariff_id_fkey" FOREIGN KEY ("wrkpf_tariff_id") REFERENCES "billing"."tariff_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contract_factor_overrides" ADD CONSTRAINT "driver_contract_factor_overrides_driver_contract_id_fkey" FOREIGN KEY ("driver_contract_id") REFERENCES "billing"."driver_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contract_factor_overrides" ADD CONSTRAINT "driver_contract_factor_overrides_cost_factor_id_fkey" FOREIGN KEY ("cost_factor_id") REFERENCES "billing"."cost_factors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."driver_contract_factor_overrides" ADD CONSTRAINT "driver_contract_factor_overrides_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "billing"."cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_period_accumulators" ADD CONSTRAINT "contract_period_accumulators_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_period_accumulators" ADD CONSTRAINT "contract_period_accumulators_driver_contract_id_fkey" FOREIGN KEY ("driver_contract_id") REFERENCES "billing"."driver_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_period_accumulators" ADD CONSTRAINT "contract_period_accumulators_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "billing"."contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."contract_period_accumulators" ADD CONSTRAINT "contract_period_accumulators_cost_factor_id_fkey" FOREIGN KEY ("cost_factor_id") REFERENCES "billing"."cost_factors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."billing_lines" ADD CONSTRAINT "billing_lines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."billing_lines" ADD CONSTRAINT "billing_lines_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "charging"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."billing_lines" ADD CONSTRAINT "billing_lines_cost_factor_id_fkey" FOREIGN KEY ("cost_factor_id") REFERENCES "billing"."cost_factors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."billing_lines" ADD CONSTRAINT "billing_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "billing"."cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
