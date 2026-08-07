CREATE SCHEMA "assets";
--> statement-breakpoint
CREATE SCHEMA "energy";
--> statement-breakpoint
CREATE SCHEMA "properties";
--> statement-breakpoint
CREATE SCHEMA "reports";
--> statement-breakpoint
CREATE SCHEMA "hardware";
--> statement-breakpoint
CREATE SCHEMA "charging";
--> statement-breakpoint
CREATE SCHEMA "agreements";
--> statement-breakpoint
CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE SCHEMA "entitlements";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "people";
--> statement-breakpoint
CREATE SCHEMA "tenancy";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "events";
--> statement-breakpoint
CREATE SCHEMA "webhooks";
--> statement-breakpoint
CREATE SCHEMA "ocpp";
--> statement-breakpoint
CREATE SCHEMA "roaming";
--> statement-breakpoint
CREATE SCHEMA "vendors";
--> statement-breakpoint
CREATE TYPE "properties"."InstallationOnboardingStatus" AS ENUM('pending_credentials', 'discovering', 'active', 'suspended', 'error');--> statement-breakpoint
CREATE TYPE "properties"."InstallationType" AS ENUM('workplace', 'mdu', 'public', 'private', 'mixed');--> statement-breakpoint
CREATE TYPE "properties"."SiteAccessLevel" AS ENUM('public', 'private', 'taxi_only');--> statement-breakpoint
CREATE TYPE "properties"."SiteAssetKind" AS ENUM('charger', 'meter', 'modem', 'controller');--> statement-breakpoint
CREATE TYPE "properties"."SitePowerClass" AS ENUM('lt_50kw', 'between_50_150kw', 'between_150_500kw', 'gt_500kw');--> statement-breakpoint
CREATE TYPE "properties"."SiteType" AS ENUM('standard', 'workplace', 'mdu', 'hotel', 'fleet', 'retail');--> statement-breakpoint
CREATE TYPE "hardware"."HardwareVendorKind" AS ENUM('charger_ac', 'charger_dc', 'meter', 'modem', 'controller', 'multi');--> statement-breakpoint
CREATE TYPE "hardware"."VendorApiKind" AS ENUM('oauth', 'basic_auth', 'none');--> statement-breakpoint
CREATE TYPE "hardware"."VendorCredentialScope" AS ENUM('installation', 'identity', 'none');--> statement-breakpoint
CREATE TYPE "charging"."SessionStatus" AS ENUM('in_progress', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "agreements"."AgrCostFactorStatus" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "agreements"."AgreementStatus" AS ENUM('draft', 'active', 'expired');--> statement-breakpoint
CREATE TYPE "agreements"."AgreementType" AS ENUM('service_cpo', 'service_contractor', 'service_workplace', 'installation', 'workplace');--> statement-breakpoint
CREATE TYPE "billing"."BalanceType" AS ENUM('prepaid', 'postpaid', 'non_paying', 'pay_immediately', 'postpaid_immediately');--> statement-breakpoint
CREATE TYPE "agreements"."BearerType" AS ENUM('org', 'usr', 'trd');--> statement-breakpoint
CREATE TYPE "billing"."BillObjectKind" AS ENUM('apartment', 'unit', 'stall', 'company', 'department', 'cost_center', 'other');--> statement-breakpoint
CREATE TYPE "billing"."BillObjectStatus" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "agreements"."BillingLineKind" AS ENUM('passthrough', 'markup');--> statement-breakpoint
CREATE TYPE "billing"."BillingTxType" AS ENUM('payment', 'refund', 'penalty', 'credit', 'contract_charge', 'external_payment');--> statement-breakpoint
CREATE TYPE "billing"."ContractScopeType" AS ENUM('org', 'property', 'site', 'installation', 'charger');--> statement-breakpoint
CREATE TYPE "billing"."ContractStatus" AS ENUM('pending_configuration', 'active', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "billing"."CostFactorAnchor" AS ENUM('org', 'property', 'site', 'installation', 'circuit', 'charger', 'driver_contract');--> statement-breakpoint
CREATE TYPE "billing"."CostFactorStatus" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "agreements"."DriverAccessRequestStatus" AS ENUM('pending', 'approved', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TYPE "agreements"."DriverAccessRequestTrigger" AS ENUM('self_request', 'email_domain_match');--> statement-breakpoint
CREATE TYPE "billing"."DriverContractOwnerType" AS ENUM('workplace', 'family_group', 'self');--> statement-breakpoint
CREATE TYPE "billing"."InvoiceStatus" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "billing"."PlanCategory" AS ENUM('single_tariff', 'membership', 'roaming', 'guest_otp');--> statement-breakpoint
CREATE TYPE "agreements"."RateBasis" AS ENUM('per_kwh', 'per_minute', 'per_day', 'per_session');--> statement-breakpoint
CREATE TYPE "agreements"."RuleAudienceType" AS ENUM('driver_group', 'user');--> statement-breakpoint
CREATE TYPE "agreements"."RuleScopeType" AS ENUM('site', 'installation', 'circuit', 'charger');--> statement-breakpoint
CREATE TYPE "billing"."TerminationBehavior" AS ENUM('terminate', 'evergreen', 'rollover');--> statement-breakpoint
CREATE TYPE "identity"."DriverInviteSecurity" AS ENUM('none', 'password_key', 'allow_term');--> statement-breakpoint
CREATE TYPE "tenancy"."HostApplicationStatus" AS ENUM('new', 'in_review', 'offered', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "identity"."IdTokenKind" AS ENUM('rfid', 'app_jwt', 'magic_link', 'zaptec_proxy', 'ocpi_token', 'manual', 'evccid', 'virtual_rfid');--> statement-breakpoint
CREATE TYPE "identity"."IdTokenStatus" AS ENUM('active', 'suspended', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "people"."MemberKind" AS ENUM('primary', 'family_user');--> statement-breakpoint
CREATE TYPE "tenancy"."MembershipRole" AS ENUM('owner', 'admin', 'operator', 'helper', 'contractor', 'driver', 'viewer', 'manager', 'technician', 'finance', 'support', 'host_admin');--> statement-breakpoint
CREATE TYPE "tenancy"."MembershipStatus" AS ENUM('invited', 'active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "tenancy"."OrgEmailDomainPolicy" AS ENUM('auto_join', 'request_approval', 'disabled');--> statement-breakpoint
CREATE TYPE "tenancy"."OrgStatus" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "tenancy"."OrganizationKind" AS ENUM('multi_dwelling', 'company');--> statement-breakpoint
CREATE TYPE "tenancy"."OrganizationRole" AS ENUM('cpo', 'emsp', 'hub', 'nsp', 'site_host', 'service_contractor', 'installer', 'vendor', 'regulator', 'dso', 'tso', 'retailer', 'payment_processor');--> statement-breakpoint
CREATE TYPE "identity"."PlatformGrantStatus" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "identity"."PlatformRole" AS ENUM('super_user', 'platform_admin', 'support_agent', 'sales_cs', 'finance_internal', 'auditor');--> statement-breakpoint
CREATE TYPE "identity"."UserAudience" AS ENUM('operator', 'driver', 'service');--> statement-breakpoint
CREATE TYPE "identity"."UserStatus" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "identity"."UserTokenKind" AS ENUM('invite', 'magic_link', 'password_reset', 'driver');--> statement-breakpoint
CREATE TYPE "identity"."VendorRefStatus" AS ENUM('active', 'inactive_at_vendor', 'removed_at_vendor');--> statement-breakpoint
CREATE TYPE "audit"."ActorKind" AS ENUM('user', 'system', 'vendor_webhook', 'ocpp_worker');--> statement-breakpoint
CREATE TYPE "events"."RetentionClass" AS ENUM('financial', 'operational', 'raw_protocol', 'aggregate', 'issue_history');--> statement-breakpoint
CREATE TYPE "ocpp"."AssetClass" AS ENUM('ac', 'dc');--> statement-breakpoint
CREATE TYPE "roaming"."CdrDirection" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "ocpp"."CommandStatus" AS ENUM('pending', 'sent', 'acked', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "roaming"."HubKind" AS ENUM('hubject', 'gireve', 'direct');--> statement-breakpoint
CREATE TYPE "ocpp"."OcppVersion" AS ENUM('ocpp_1_6', 'ocpp_2_0_1', 'ocpp_2_1');--> statement-breakpoint
CREATE TABLE "assets"."capability_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"control_plane" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."charging_stations" (
	"site_asset_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"model_id" uuid,
	"installation_id" uuid,
	"vendor" text,
	"model" text,
	"serial_number" text,
	"install_date" date,
	"warranty_expires" date,
	"firmware_version" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"circuit_id" uuid,
	"owner_org_id" uuid,
	"chrgrf_tariff_id" uuid,
	"charge_box_serial_number" text,
	"meter_type" text,
	"meter_serial_number" text,
	"iccid" text,
	"imsi" text,
	"location_note" text,
	"mounting_type" text,
	"photo_url" text,
	"ip_rating" text,
	"breaker_amps" integer,
	"ble_advertising_id" text,
	"ble_advertising_kind" text,
	"lifetime_kwh_cached" numeric(12, 3),
	"lifetime_kwh_observed_at" timestamp (6) with time zone,
	"last_telemetry_read" jsonb,
	"last_telemetry_at" timestamp (6) with time zone,
	"vendor_auth_required" boolean,
	"vendor_authentication_type" integer,
	"vendor_auth_seen_at" timestamp (6) with time zone,
	"mainboard_sw_version" text,
	"smart_bootloader_version" text,
	"hardware_version" text,
	"online_since_at" timestamp (6) with time zone,
	"comm_mode" text,
	"signal_dbm" integer,
	"pushed_auth_list_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties"."circuits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"installation_id" uuid,
	"display_name" text NOT NULL,
	"ampere_ceiling" integer,
	"phase_count" integer DEFAULT 3 NOT NULL,
	"vendor_circuit_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."connectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"evse_id" uuid NOT NULL,
	"connector_index" integer NOT NULL,
	"type" text NOT NULL,
	"max_power_kw" numeric(8, 2),
	"status" text DEFAULT 'unknown' NOT NULL,
	"status_updated_at" timestamp (6) with time zone,
	"error_code" text,
	"vendor_error_code" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."control_routing_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"routing" jsonb NOT NULL,
	"fallback_plane" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."evses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"evse_index" integer NOT NULL,
	"max_power_kw" numeric(8, 2),
	"phase_count" integer,
	"status" text DEFAULT 'unknown' NOT NULL,
	"status_updated_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties"."installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"vendor_id" uuid,
	"model_id" uuid,
	"display_name" text NOT NULL,
	"vendor_installation_ref" text,
	"credentials_ref" text,
	"credentials_id" uuid,
	"credentials_status" text,
	"onboarding_status" "properties"."InstallationOnboardingStatus" DEFAULT 'pending_credentials' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"retailer_tariff_id" uuid,
	"enforce_authorize" boolean DEFAULT false NOT NULL,
	"installation_type" "properties"."InstallationType" DEFAULT 'workplace' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."modems" (
	"site_asset_id" uuid PRIMARY KEY NOT NULL,
	"imei" text,
	"carrier" text,
	"iccid" text,
	"last_seen_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties"."properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"location_type" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"provisioning_status" text DEFAULT 'provisioned' NOT NULL,
	"external" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties"."site_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "properties"."SiteAssetKind" NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties"."sites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'Atlantic/Reykjavik' NOT NULL,
	"access_level" "properties"."SiteAccessLevel" DEFAULT 'private' NOT NULL,
	"power_class" "properties"."SitePowerClass",
	"provisioning_status" text DEFAULT 'provisioned' NOT NULL,
	"external" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"site_type" "properties"."SiteType" DEFAULT 'standard' NOT NULL,
	"dso_tariff_id" uuid,
	"usrf_tariff_id" uuid,
	"usrf_prem_tariff_id" uuid,
	"xtrrf_tariff_id" uuid,
	"spvivf_tariff_id" uuid,
	"opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_note" text,
	"photo_url" text
);
--> statement-breakpoint
CREATE TABLE "hardware"."models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" "hardware"."HardwareVendorKind" NOT NULL,
	"asset_class" "ocpp"."AssetClass",
	"credential_scope" "hardware"."VendorCredentialScope" DEFAULT 'none' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hardware"."vendors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" "hardware"."HardwareVendorKind" NOT NULL,
	"website" text,
	"api_kind" "hardware"."VendorApiKind" DEFAULT 'none' NOT NULL,
	"support_contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging"."imported_cdr_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_cdr_id" text NOT NULL,
	"imported_at" timestamp (6) with time zone NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging"."live_session_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"charger_id" uuid NOT NULL,
	"observed_at" timestamp (6) with time zone NOT NULL,
	"power_w" integer,
	"energy_wh" bigint,
	"state_id" integer NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging"."live_sessions" (
	"charging_station_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"ocpp_identity_id" uuid NOT NULL,
	"vendor_resource_id" text NOT NULL,
	"started_at" timestamp (6) with time zone NOT NULL,
	"last_observed_at" timestamp (6) with time zone NOT NULL,
	"last_operation_mode" integer,
	"last_power_w" numeric(10, 0),
	"last_session_energy_wh" numeric(12, 0),
	"connected_at" timestamp (6) with time zone,
	"charging_started_at" timestamp (6) with time zone,
	"last_mode_at" timestamp (6) with time zone,
	"charging_seconds" integer DEFAULT 0 NOT NULL,
	"non_charging_seconds" integer DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging"."meter_values" (
	"id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"measured_at" timestamp (6) with time zone NOT NULL,
	"energy_wh" bigint,
	"power_w" integer,
	"voltage_v" numeric(6, 2),
	"current_a" numeric(6, 2),
	"soc_percent" numeric(5, 2),
	CONSTRAINT "meter_values_id_measured_at_pk" PRIMARY KEY("id","measured_at")
);
--> statement-breakpoint
CREATE TABLE "charging"."protocol_transaction_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging"."reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"user_id" uuid,
	"reserved_from" timestamp (6) with time zone NOT NULL,
	"reserved_until" timestamp (6) with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charging"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"evse_id" uuid NOT NULL,
	"connector_id" uuid,
	"ocpp_identity_id" uuid,
	"user_id" uuid,
	"id_tag" text,
	"started_at" timestamp (6) with time zone NOT NULL,
	"ended_at" timestamp (6) with time zone,
	"energy_wh" bigint,
	"stop_reason" text,
	"status" "charging"."SessionStatus" DEFAULT 'in_progress' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"cost_ex_vat_minor" bigint,
	"cost_inc_vat_minor" bigint,
	"completed_session_raw_json" jsonb,
	"ocmf_signed_session" text,
	"ocmf_format_version" text,
	"ocmf_gateway_id" text,
	"ocmf_gateway_serial" text,
	"ocmf_gateway_version" text,
	"auth_id_status" boolean,
	"auth_id_level" text,
	"auth_id_type" text,
	"auth_id_value" text,
	"auth_id_flags" text[],
	"ocmf_first_reading_kwh" numeric(14, 4),
	"ocmf_last_reading_kwh" numeric(14, 4),
	"ocmf_signed_session_kwh" numeric(14, 4),
	"completed_session_seen_at" timestamp (6) with time zone,
	"ev_plc_mac" text,
	"ev_plc_mac_oui_vendor" text,
	"ev_plc_pib_version" text,
	"cable_type" text,
	"pnc_attempted" boolean,
	"pnc_succeeded" boolean,
	"pnc_rejected_uuid" text,
	"ocpp_energy_kwh" numeric(10, 4),
	"cdr_energy_kwh" numeric(10, 4),
	"amqp_energy_kwh" numeric(10, 4),
	"ocpp_stopped_at" timestamp (6) with time zone,
	"cdr_stopped_at" timestamp (6) with time zone,
	"ocmf_blob_ref" text
);
--> statement-breakpoint
CREATE TABLE "charging"."tap_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"evse_id" uuid,
	"device_handle" text,
	"ble_rssi" integer,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"consumed_at" timestamp (6) with time zone,
	"consumed_id_tag" text
);
--> statement-breakpoint
CREATE TABLE "agreements"."agreement_clauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"cost_factor_id" uuid NOT NULL,
	"default_bearer_type" "agreements"."BearerType" NOT NULL,
	"default_bearer_ref" uuid,
	"default_rate_ref_code" text,
	"allocation_json" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_type" "agreements"."AgreementType" NOT NULL,
	"counterparty_org_id" uuid NOT NULL,
	"cpo_org_id" uuid,
	"installation_id" uuid,
	"default_driver_group_id" uuid,
	"display_name" text NOT NULL,
	"status" "agreements"."AgreementStatus" DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp (6) with time zone NOT NULL,
	"effective_until" timestamp (6) with time zone,
	"notes" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."billing_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"billable_event_type" text DEFAULT 'session' NOT NULL,
	"session_id" uuid,
	"factor_code" text NOT NULL,
	"kind" "agreements"."BillingLineKind" NOT NULL,
	"basis_type" "agreements"."RateBasis" NOT NULL,
	"basis_quantity" numeric(14, 4) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"amount_ex_vat_minor" bigint NOT NULL,
	"vat_rate_pct" numeric(4, 2) NOT NULL,
	"vat_amount_minor" bigint NOT NULL,
	"amount_inc_vat_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ISK' NOT NULL,
	"bearer_type" "agreements"."BearerType" NOT NULL,
	"bearer_ref" uuid,
	"recipient_org_id" uuid,
	"recipient_user_id" uuid,
	"rate_ref_id" uuid,
	"rule_id" uuid,
	"computation_detail" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."cost_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"display_name_is" text NOT NULL,
	"display_name_en" text NOT NULL,
	"description" text,
	"status" "agreements"."AgrCostFactorStatus" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."bearer_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"cost_factor_id" uuid NOT NULL,
	"scope_type" "agreements"."RuleScopeType",
	"scope_id" uuid,
	"audience_type" "agreements"."RuleAudienceType",
	"audience_id" uuid,
	"bearer_type" "agreements"."BearerType",
	"bearer_ref" uuid,
	"rate_ref_code" text,
	"allocation_json" jsonb,
	"effective_from" timestamp (6) with time zone NOT NULL,
	"effective_until" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."bill_object_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bill_object_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp (6) with time zone
);
--> statement-breakpoint
CREATE TABLE "billing"."bill_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid,
	"kind" "billing"."BillObjectKind" NOT NULL,
	"label" text NOT NULL,
	"parent_id" uuid,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"status" "billing"."BillObjectStatus" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."billing_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"cost_factor_id" uuid NOT NULL,
	"cost_factor_code" text NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"amount_ex_vat_minor" bigint NOT NULL,
	"vat_rate_pct" numeric(4, 2) NOT NULL,
	"vat_amount_minor" bigint NOT NULL,
	"amount_inc_vat_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"computation_detail" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."cost_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"anchor_tier" "billing"."CostFactorAnchor" NOT NULL,
	"default_vat_rate_pct" numeric(4, 2) NOT NULL,
	"default_currency" text DEFAULT 'ISK' NOT NULL,
	"status" "billing"."CostFactorStatus" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"counterparty_org_id" uuid,
	"scope_type" "billing"."ContractScopeType" NOT NULL,
	"scope_id" uuid,
	"parent_contract_id" uuid,
	"display_name" text NOT NULL,
	"status" "billing"."ContractStatus" DEFAULT 'pending_configuration' NOT NULL,
	"valid_from" timestamp (6) with time zone NOT NULL,
	"valid_until" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."cost_centers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"payer_org_id" uuid,
	"payer_user_id" uuid,
	"beneficiary_org_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."driver_access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"triggered_by" "agreements"."DriverAccessRequestTrigger" NOT NULL,
	"org_email_domain_id" uuid,
	"status" "agreements"."DriverAccessRequestStatus" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp (6) with time zone,
	"denial_reason" text,
	"resulting_membership_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."driver_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "billing"."ContractScopeType",
	"scope_id" uuid,
	"parent_contract_id" uuid,
	"owner_type" "billing"."DriverContractOwnerType" NOT NULL,
	"owner_id" uuid NOT NULL,
	"wrkpf_tariff_id" uuid,
	"display_name" text NOT NULL,
	"status" "billing"."ContractStatus" DEFAULT 'pending_configuration' NOT NULL,
	"valid_from" timestamp (6) with time zone NOT NULL,
	"valid_until" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."driver_group_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"driver_group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."driver_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"scope_filter_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements"."rate_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"cost_factor_id" uuid NOT NULL,
	"supplier_org_id" uuid,
	"basis" "agreements"."RateBasis" NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'ISK' NOT NULL,
	"vat_rate_pct" numeric(4, 2) NOT NULL,
	"effective_from" timestamp (6) with time zone NOT NULL,
	"effective_until" timestamp (6) with time zone,
	"notes" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports"."session_ledger" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid,
	"charging_station_id" uuid,
	"driver_user_id" uuid,
	"driver_id_tag" text,
	"started_at" timestamp (6) with time zone NOT NULL,
	"stopped_at" timestamp (6) with time zone,
	"duration_sec" integer,
	"energy_kwh" numeric(10, 3) DEFAULT '0' NOT NULL,
	"cost_isk_minor" bigint,
	"tariff_definition_id" uuid,
	"computed_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"verified_source" text,
	"enrichment_status" text
);
--> statement-breakpoint
CREATE TABLE "billing"."tariff_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"cost_factor_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"compute_rule" jsonb NOT NULL,
	"vat_rate_pct" numeric(4, 2) NOT NULL,
	"currency" text DEFAULT 'ISK' NOT NULL,
	"valid_from" timestamp (6) with time zone NOT NULL,
	"valid_until" timestamp (6) with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."tariffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"rule" jsonb NOT NULL,
	"currency" text NOT NULL,
	"valid_from" timestamp (6) with time zone NOT NULL,
	"valid_until" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."family_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"primary_user_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."family_memberships" (
	"family_group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_kind" "people"."MemberKind" NOT NULL,
	"joined_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_memberships_family_group_id_user_id_pk" PRIMARY KEY("family_group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."host_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"kennitala" text,
	"site_type" "tenancy"."OrganizationKind" NOT NULL,
	"sites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"status" "tenancy"."HostApplicationStatus" DEFAULT 'new' NOT NULL,
	"converted_org_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."id_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "identity"."IdTokenKind" NOT NULL,
	"value" text NOT NULL,
	"vendor_issued_by" text,
	"vendor_token_id" text,
	"label" text,
	"status" "identity"."IdTokenStatus" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp (6) with time zone,
	"last_used_at" timestamp (6) with time zone,
	"scope_installation_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "tenancy"."MembershipRole" NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"status" "tenancy"."MembershipStatus" DEFAULT 'active' NOT NULL,
	"invited_by_id" uuid,
	"invited_at" timestamp (6) with time zone,
	"accepted_at" timestamp (6) with time zone,
	"suspended_at" timestamp (6) with time zone,
	"revoked_at" timestamp (6) with time zone,
	"scope_site_ids" uuid[] DEFAULT '{}' NOT NULL,
	"scope_property_ids" uuid[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenancy"."org_email_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"policy" "tenancy"."OrgEmailDomainPolicy" DEFAULT 'request_approval' NOT NULL,
	"default_driver_group_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"country_code" text NOT NULL,
	"status" "tenancy"."OrgStatus" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"legal_name" text,
	"legal_form" text,
	"legal_form_code" text,
	"kennitala" text,
	"vsk_nr" text,
	"lei_code" text,
	"default_currency" text DEFAULT 'ISK' NOT NULL,
	"postal_address" jsonb,
	"legal_address" jsonb,
	"municipality_code" text,
	"municipality_name" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"regulator_licence_no" text,
	"roles" "tenancy"."OrganizationRole"[] DEFAULT '{}',
	"notes" text,
	"kind" "tenancy"."OrganizationKind",
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"main_contact_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "identity"."platform_grants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "identity"."PlatformRole" NOT NULL,
	"status" "identity"."PlatformGrantStatus" DEFAULT 'active' NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (6) with time zone,
	"revoked_at" timestamp (6) with time zone,
	"revoked_by_id" uuid,
	"scope" jsonb
);
--> statement-breakpoint
CREATE TABLE "identity"."user_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text,
	"totp_secret" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."user_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "identity"."UserTokenKind" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"used_at" timestamp (6) with time zone,
	"created_by_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"driver_group_id" uuid,
	"bill_object_id" uuid,
	"security" "identity"."DriverInviteSecurity" DEFAULT 'none' NOT NULL,
	"password_key_hash" text,
	"max_redemptions" integer
);
--> statement-breakpoint
CREATE TABLE "identity"."user_vendor_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"vendor_slug" text NOT NULL,
	"vendor_user_id" text NOT NULL,
	"vendor_email" text,
	"vendor_role_hint" text,
	"scope_installation_id" uuid,
	"status" "identity"."VendorRefStatus" DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text,
	"status" "identity"."UserStatus" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"deleted_at" timestamp (6) with time zone,
	"kennitala" text,
	"phone" text,
	"locale" text DEFAULT 'is' NOT NULL,
	"timezone" text DEFAULT 'Atlantic/Reykjavik' NOT NULL,
	"notes" text,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"date_of_birth" date,
	"photo_url" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audience" "identity"."UserAudience" DEFAULT 'operator' NOT NULL,
	"email_verified_at" timestamp (6) with time zone,
	"phone_verified_at" timestamp (6) with time zone,
	"last_seen_at" timestamp (6) with time zone,
	"consent_tos_at" timestamp (6) with time zone,
	"consent_privacy_at" timestamp (6) with time zone,
	"consent_marketing_at" timestamp (6) with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people"."vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"license_plate" text,
	"vin" text,
	"battery_capacity_kwh" numeric(6, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."vendor_user_group_memberships" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_user_group_memberships_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."vendor_user_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vendor_slug" text NOT NULL,
	"vendor_group_id" text NOT NULL,
	"installation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" "audit"."ActorKind" NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events"."archive_watermark" (
	"retention_class" "events"."RetentionClass" NOT NULL,
	"day" date NOT NULL,
	"object_count" bigint DEFAULT 0 NOT NULL,
	"last_write_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_watermark_retention_class_day_pk" PRIMARY KEY("retention_class","day")
);
--> statement-breakpoint
CREATE TABLE "events"."event_log" (
	"id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_class" "events"."RetentionClass" DEFAULT 'operational' NOT NULL,
	"occurred_at" timestamp (6) with time zone NOT NULL,
	"recorded_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_log_id_recorded_at_pk" PRIMARY KEY("id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "events"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "events"."protocol_log" (
	"id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_class" "events"."RetentionClass" DEFAULT 'raw_protocol' NOT NULL,
	"occurred_at" timestamp (6) with time zone NOT NULL,
	"recorded_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_log_id_recorded_at_pk" PRIMARY KEY("id","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "roaming"."external_cpms_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"external_cpms_slug" text NOT NULL,
	"external_asset_id" text NOT NULL,
	"import_mode" text NOT NULL,
	"credentials_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_imported_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocpp"."ocpp_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"identity_string" text NOT NULL,
	"auth_secret_hash" text,
	"ocpp_version" "ocpp"."OcppVersion" NOT NULL,
	"asset_class" "ocpp"."AssetClass" DEFAULT 'ac' NOT NULL,
	"vendor" text,
	"vendor_resource_id" text,
	"credentials_ref" text,
	"credentials_status" text,
	"status" text DEFAULT 'provisioned' NOT NULL,
	"last_seen_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocpp"."outbound_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"control_domain" text NOT NULL,
	"routed_to" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "ocpp"."CommandStatus" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp (6) with time zone NOT NULL,
	"last_attempt_at" timestamp (6) with time zone,
	"result" jsonb,
	"correlation_id" uuid NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocpp"."pending_discoveries" (
	"identity_string" varchar(64) PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"remote_addr" varchar(64),
	"user_agent" varchar(255),
	"last_payload_summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "vendors"."vendor_asset_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"charging_station_id" uuid NOT NULL,
	"vendor_slug" text NOT NULL,
	"vendor_asset_id" text NOT NULL,
	"credentials_ref" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hardware"."vendor_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_org_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"username" varchar(200) NOT NULL,
	"password_cipher" "bytea",
	"password_iv" "bytea",
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp (6) with time zone,
	"notes" varchar(500),
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_profiles_charging_station_id_control_plane_index" ON "assets"."capability_profiles" USING btree ("charging_station_id","control_plane");--> statement-breakpoint
CREATE INDEX "charging_stations_model_id_index" ON "assets"."charging_stations" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "charging_stations_installation_id_index" ON "assets"."charging_stations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "charging_stations_circuit_id_index" ON "assets"."charging_stations" USING btree ("circuit_id");--> statement-breakpoint
CREATE INDEX "charging_stations_owner_org_id_index" ON "assets"."charging_stations" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "circuits_org_id_site_id_index" ON "properties"."circuits" USING btree ("org_id","site_id");--> statement-breakpoint
CREATE INDEX "circuits_installation_id_index" ON "properties"."circuits" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connectors_evse_id_connector_index_index" ON "assets"."connectors" USING btree ("evse_id","connector_index");--> statement-breakpoint
CREATE INDEX "connectors_org_id_index" ON "assets"."connectors" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evses_charging_station_id_evse_index_index" ON "assets"."evses" USING btree ("charging_station_id","evse_index");--> statement-breakpoint
CREATE INDEX "evses_org_id_status_index" ON "assets"."evses" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "installations_org_id_site_id_index" ON "properties"."installations" USING btree ("org_id","site_id");--> statement-breakpoint
CREATE INDEX "installations_vendor_id_index" ON "properties"."installations" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "properties_org_id_index" ON "properties"."properties" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "site_assets_org_id_site_id_index" ON "properties"."site_assets" USING btree ("org_id","site_id");--> statement-breakpoint
CREATE INDEX "site_assets_kind_status_index" ON "properties"."site_assets" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "sites_org_id_property_id_index" ON "properties"."sites" USING btree ("org_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_vendor_id_slug_index" ON "hardware"."models" USING btree ("vendor_id","slug");--> statement-breakpoint
CREATE INDEX "models_kind_status_index" ON "hardware"."models" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_cdr_refs_source_kind_source_cdr_id_index" ON "charging"."imported_cdr_refs" USING btree ("source_kind","source_cdr_id");--> statement-breakpoint
CREATE INDEX "imported_cdr_refs_session_id_index" ON "charging"."imported_cdr_refs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "live_session_samples_charger_id_observed_at_index" ON "charging"."live_session_samples" USING btree ("charger_id","observed_at");--> statement-breakpoint
CREATE INDEX "live_sessions_org_id_index" ON "charging"."live_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "live_sessions_last_observed_at_index" ON "charging"."live_sessions" USING btree ("last_observed_at");--> statement-breakpoint
CREATE INDEX "live_sessions_user_id_index" ON "charging"."live_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meter_values_session_id_measured_at_index" ON "charging"."meter_values" USING btree ("session_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_transaction_refs_source_kind_source_id_index" ON "charging"."protocol_transaction_refs" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX "protocol_transaction_refs_session_id_index" ON "charging"."protocol_transaction_refs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "reservations_org_id_reserved_from_index" ON "charging"."reservations" USING btree ("org_id","reserved_from");--> statement-breakpoint
CREATE INDEX "sessions_org_id_started_at_index" ON "charging"."sessions" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_evse_id_started_at_index" ON "charging"."sessions" USING btree ("evse_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_started_at_index" ON "charging"."sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_ev_plc_mac_index" ON "charging"."sessions" USING btree ("ev_plc_mac");--> statement-breakpoint
CREATE INDEX "tap_intents_charging_station_id_consumed_at_expires_at_index" ON "charging"."tap_intents" USING btree ("charging_station_id","consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "tap_intents_user_id_expires_at_index" ON "charging"."tap_intents" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_clauses_agreement_id_cost_factor_id_index" ON "agreements"."agreement_clauses" USING btree ("agreement_id","cost_factor_id");--> statement-breakpoint
CREATE INDEX "agreements_counterparty_org_id_status_index" ON "agreements"."agreements" USING btree ("counterparty_org_id","status");--> statement-breakpoint
CREATE INDEX "agreements_cpo_org_id_index" ON "agreements"."agreements" USING btree ("cpo_org_id");--> statement-breakpoint
CREATE INDEX "agreements_installation_id_index" ON "agreements"."agreements" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "agreements_effective_from_index" ON "agreements"."agreements" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "billing_lines_agreement_id_billable_event_type_index" ON "agreements"."billing_lines" USING btree ("agreement_id","billable_event_type");--> statement-breakpoint
CREATE INDEX "billing_lines_session_id_factor_code_kind_index" ON "agreements"."billing_lines" USING btree ("session_id","factor_code","kind");--> statement-breakpoint
CREATE INDEX "billing_lines_recipient_org_id_created_at_index" ON "agreements"."billing_lines" USING btree ("recipient_org_id","created_at");--> statement-breakpoint
CREATE INDEX "bearer_rules_agreement_id_cost_factor_id_audience_type_audience_id_scope_type_scope_id_effective_from_index" ON "agreements"."bearer_rules" USING btree ("agreement_id","cost_factor_id","audience_type","audience_id","scope_type","scope_id","effective_from");--> statement-breakpoint
CREATE INDEX "bearer_rules_effective_from_index" ON "agreements"."bearer_rules" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "bill_object_members_user_id_effective_to_index" ON "billing"."bill_object_members" USING btree ("user_id","effective_to");--> statement-breakpoint
CREATE INDEX "bill_object_members_bill_object_id_index" ON "billing"."bill_object_members" USING btree ("bill_object_id");--> statement-breakpoint
CREATE INDEX "bill_objects_org_id_installation_id_index" ON "billing"."bill_objects" USING btree ("org_id","installation_id");--> statement-breakpoint
CREATE INDEX "bill_objects_owner_user_id_index" ON "billing"."bill_objects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "bill_objects_owner_org_id_index" ON "billing"."bill_objects" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "billing_lines_org_id_session_id_index" ON "billing"."billing_lines" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE INDEX "billing_lines_cost_center_id_created_at_index" ON "billing"."billing_lines" USING btree ("cost_center_id","created_at");--> statement-breakpoint
CREATE INDEX "contracts_org_id_scope_type_scope_id_index" ON "billing"."contracts" USING btree ("org_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "contracts_counterparty_org_id_index" ON "billing"."contracts" USING btree ("counterparty_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_org_id_code_index" ON "billing"."cost_centers" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "driver_access_requests_status_installation_id_index" ON "agreements"."driver_access_requests" USING btree ("status","installation_id");--> statement-breakpoint
CREATE INDEX "driver_access_requests_user_id_status_index" ON "agreements"."driver_access_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "driver_contracts_org_id_user_id_valid_from_index" ON "billing"."driver_contracts" USING btree ("org_id","user_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_group_memberships_driver_group_id_user_id_index" ON "agreements"."driver_group_memberships" USING btree ("driver_group_id","user_id");--> statement-breakpoint
CREATE INDEX "driver_group_memberships_user_id_index" ON "agreements"."driver_group_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "driver_groups_agreement_id_index" ON "agreements"."driver_groups" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "driver_groups_owner_org_id_index" ON "agreements"."driver_groups" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "rate_references_code_effective_from_index" ON "agreements"."rate_references" USING btree ("code","effective_from");--> statement-breakpoint
CREATE INDEX "rate_references_cost_factor_id_effective_from_index" ON "agreements"."rate_references" USING btree ("cost_factor_id","effective_from");--> statement-breakpoint
CREATE INDEX "session_ledger_org_id_started_at_index" ON "reports"."session_ledger" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "session_ledger_driver_user_id_started_at_index" ON "reports"."session_ledger" USING btree ("driver_user_id","started_at");--> statement-breakpoint
CREATE INDEX "session_ledger_charging_station_id_started_at_index" ON "reports"."session_ledger" USING btree ("charging_station_id","started_at");--> statement-breakpoint
CREATE INDEX "tariff_definitions_org_id_cost_factor_id_valid_from_index" ON "billing"."tariff_definitions" USING btree ("org_id","cost_factor_id","valid_from");--> statement-breakpoint
CREATE INDEX "tariffs_org_id_index" ON "billing"."tariffs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "family_groups_org_id_index" ON "people"."family_groups" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "host_applications_status_index" ON "tenancy"."host_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "id_tokens_user_id_index" ON "identity"."id_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "id_tokens_status_value_index" ON "identity"."id_tokens" USING btree ("status","value");--> statement-breakpoint
CREATE INDEX "id_tokens_scope_installation_id_index" ON "identity"."id_tokens" USING btree ("scope_installation_id");--> statement-breakpoint
CREATE INDEX "id_tokens_vendor_issued_by_vendor_token_id_index" ON "identity"."id_tokens" USING btree ("vendor_issued_by","vendor_token_id");--> statement-breakpoint
CREATE INDEX "memberships_org_id_status_index" ON "tenancy"."memberships" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "org_email_domains_domain_index" ON "tenancy"."org_email_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "org_email_domains_org_id_index" ON "tenancy"."org_email_domains" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "user_tokens_user_id_kind_expires_at_index" ON "identity"."user_tokens" USING btree ("user_id","kind","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_vendor_refs_vendor_slug_vendor_user_id_index" ON "identity"."user_vendor_refs" USING btree ("vendor_slug","vendor_user_id");--> statement-breakpoint
CREATE INDEX "user_vendor_refs_user_id_index" ON "identity"."user_vendor_refs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_vendor_refs_scope_installation_id_index" ON "identity"."user_vendor_refs" USING btree ("scope_installation_id");--> statement-breakpoint
CREATE INDEX "vehicles_user_id_index" ON "people"."vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendor_user_group_memberships_user_id_index" ON "identity"."vendor_user_group_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_user_groups_vendor_slug_vendor_group_id_index" ON "identity"."vendor_user_groups" USING btree ("vendor_slug","vendor_group_id");--> statement-breakpoint
CREATE INDEX "vendor_user_groups_installation_id_index" ON "identity"."vendor_user_groups" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "actions_org_id_occurred_at_index" ON "audit"."actions" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "actions_target_type_target_id_occurred_at_index" ON "audit"."actions" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "archive_watermark_day_index" ON "events"."archive_watermark" USING btree ("day");--> statement-breakpoint
CREATE INDEX "event_log_org_id_occurred_at_index" ON "events"."event_log" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_log_aggregate_type_aggregate_id_occurred_at_index" ON "events"."event_log" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_log_event_type_occurred_at_index" ON "events"."event_log" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_index" ON "events"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "protocol_log_org_id_occurred_at_index" ON "events"."protocol_log" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "protocol_log_aggregate_type_aggregate_id_occurred_at_index" ON "events"."protocol_log" USING btree ("aggregate_type","aggregate_id","occurred_at");--> statement-breakpoint
CREATE INDEX "protocol_log_event_type_occurred_at_index" ON "events"."protocol_log" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_cpms_refs_external_cpms_slug_external_asset_id_index" ON "roaming"."external_cpms_refs" USING btree ("external_cpms_slug","external_asset_id");--> statement-breakpoint
CREATE INDEX "external_cpms_refs_org_id_index" ON "roaming"."external_cpms_refs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ocpp_identities_org_id_identity_string_index" ON "ocpp"."ocpp_identities" USING btree ("org_id","identity_string");--> statement-breakpoint
CREATE INDEX "ocpp_identities_org_id_charging_station_id_index" ON "ocpp"."ocpp_identities" USING btree ("org_id","charging_station_id");--> statement-breakpoint
CREATE INDEX "outbound_commands_status_not_before_index" ON "ocpp"."outbound_commands" USING btree ("status","not_before");--> statement-breakpoint
CREATE INDEX "outbound_commands_org_id_identity_id_index" ON "ocpp"."outbound_commands" USING btree ("org_id","identity_id");--> statement-breakpoint
CREATE INDEX "pending_discoveries_last_seen_at_index" ON "ocpp"."pending_discoveries" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_asset_refs_vendor_slug_vendor_asset_id_credentials_ref_index" ON "vendors"."vendor_asset_refs" USING btree ("vendor_slug","vendor_asset_id","credentials_ref");--> statement-breakpoint
CREATE INDEX "vendor_asset_refs_charging_station_id_vendor_slug_index" ON "vendors"."vendor_asset_refs" USING btree ("charging_station_id","vendor_slug");--> statement-breakpoint
CREATE INDEX "vendor_asset_refs_org_id_vendor_slug_index" ON "vendors"."vendor_asset_refs" USING btree ("org_id","vendor_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_credentials_owner_org_id_vendor_id_username_index" ON "hardware"."vendor_credentials" USING btree ("owner_org_id","vendor_id","username");--> statement-breakpoint
CREATE INDEX "vendor_credentials_owner_org_id_index" ON "hardware"."vendor_credentials" USING btree ("owner_org_id");