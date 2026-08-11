CREATE TYPE "billing"."CorrectionReason" AS ENUM('cdr_mismatch_resolved', 'meter_fault', 'tariff_misapplied', 'duplicate_session', 'customer_dispute', 'operator_goodwill');--> statement-breakpoint
CREATE TYPE "billing"."DeliveryChannel" AS ENUM('email', 'download', 'webhook');--> statement-breakpoint
CREATE TYPE "billing"."DeliveryState" AS ENUM('pending', 'sending', 'sent', 'retrying', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "billing"."PeriodState" AS ENUM('open', 'closing', 'closed');--> statement-breakpoint
CREATE TYPE "billing"."ProvenanceState" AS ENUM('estimated', 'ocpp_derived', 'cdr_pending', 'cdr_confirmed', 'cdr_mismatch', 'corrected', 'held_manual_review');--> statement-breakpoint
CREATE TYPE "billing"."RateComponentKind" AS ENUM('dso', 'retailer', 'cpo_addon');--> statement-breakpoint
CREATE TYPE "billing"."ReviewReason" AS ENUM('no_rate_at_session_start', 'meter_unresolvable', 'cdr_mismatch_beyond_tolerance', 'negative_or_impossible_energy', 'missing_session_times', 'unsupported_compute_rule', 'manual_hold');--> statement-breakpoint
CREATE TYPE "billing"."SettlementProvenance" AS ENUM('ocpp', 'cdr', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "billing"."SettlementStatus" AS ENUM('settled', 'billing_review_required');--> statement-breakpoint
CREATE TYPE "billing"."StatementLineKind" AS ENUM('session_energy', 'plug_time', 'subscription_connector', 'subscription_driver', 'cap_relief', 'correction');--> statement-breakpoint
CREATE TYPE "billing"."StatementRecipientKind" AS ENUM('driver', 'organisation');--> statement-breakpoint
CREATE TABLE "billing"."billing_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"period_start" timestamp (6) with time zone NOT NULL,
	"period_end" timestamp (6) with time zone NOT NULL,
	"state" "billing"."PeriodState" DEFAULT 'open' NOT NULL,
	"currency" text DEFAULT 'ISK' NOT NULL,
	"closed_at" timestamp (6) with time zone,
	"closed_by_user_id" uuid,
	"blockers_at_close" jsonb,
	"reopened_at" timestamp (6) with time zone,
	"reopened_by_user_id" uuid,
	"reopen_reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports"."connector_activity_month" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"connector_id" uuid NOT NULL,
	"charging_station_id" uuid,
	"source" text NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"active_days" integer,
	"first_seen_at" timestamp (6) with time zone NOT NULL,
	"last_seen_at" timestamp (6) with time zone NOT NULL,
	"cap_applied_isk" bigint,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports"."driver_activity_month" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"driver_user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp (6) with time zone NOT NULL,
	"last_seen_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."mutation_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"actor_user_id" uuid,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."session_settlements" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"connector_id" uuid,
	"driver_user_id" uuid,
	"started_at" timestamp (6) with time zone NOT NULL,
	"stopped_at" timestamp (6) with time zone,
	"energy_wh" integer,
	"meter_start_wh" integer,
	"meter_stop_wh" integer,
	"cdr_energy_kwh" numeric(10, 3),
	"plug_time_seconds" integer,
	"plug_time_fee_minor" bigint NOT NULL,
	"amount_ex_vat_minor" bigint NOT NULL,
	"vat_rate_pct" numeric(4, 2) NOT NULL,
	"vat_minor" bigint NOT NULL,
	"total_inc_vat_minor" bigint NOT NULL,
	"total_isk" bigint NOT NULL,
	"currency" text DEFAULT 'ISK' NOT NULL,
	"status" "billing"."SettlementStatus" NOT NULL,
	"provenance" "billing"."SettlementProvenance" NOT NULL,
	"provenance_state" "billing"."ProvenanceState" NOT NULL,
	"rate_selection_policy" text DEFAULT 'start_rate' NOT NULL,
	"priced_at" timestamp (6) with time zone NOT NULL,
	"committed_at" timestamp (6) with time zone,
	"explanation" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."settlement_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "billing"."RateComponentKind" NOT NULL,
	"rate_version_id" uuid NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"effective_from" timestamp (6) with time zone NOT NULL,
	"effective_until" timestamp (6) with time zone,
	"amount_ex_vat_minor" bigint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."settlement_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"reason" "billing"."ReviewReason" NOT NULL,
	"detail" text,
	"raised_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (6) with time zone,
	"resolved_by_user_id" uuid,
	"resolution" text,
	"resolution_note" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."statement_delivery_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" "billing"."DeliveryChannel" DEFAULT 'email' NOT NULL,
	"state" "billing"."DeliveryState" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp (6) with time zone,
	"last_attempt_at" timestamp (6) with time zone,
	"outcome_kind" text,
	"provider_message_id" text,
	"destination" text,
	"last_error" text,
	"result" jsonb,
	"idempotency_key" text NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."statement_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"row_count" integer NOT NULL,
	"total_isk" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text,
	"idempotency_key" text NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."statement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" "billing"."StatementLineKind" NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 4),
	"unit" text,
	"unit_price_minor" bigint,
	"amount_minor" bigint NOT NULL,
	"amount_isk" bigint NOT NULL,
	"session_id" uuid,
	"corrects_session_id" uuid,
	"correction_reason" "billing"."CorrectionReason",
	"reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"recipient_kind" "billing"."StatementRecipientKind" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"statement_key" text NOT NULL,
	"total_isk" bigint NOT NULL,
	"currency" text DEFAULT 'ISK' NOT NULL,
	"excluded_session_ids" jsonb NOT NULL,
	"generated_at" timestamp (6) with time zone NOT NULL,
	"generated_by_user_id" uuid,
	"superseded_by_statement_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_periods_org_id_period_year_period_month_index" ON "billing"."billing_periods" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE INDEX "billing_periods_org_id_state_index" ON "billing"."billing_periods" USING btree ("org_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_activity_month_org_id_period_year_period_month_connector_id_index" ON "reports"."connector_activity_month" USING btree ("org_id","period_year","period_month","connector_id");--> statement-breakpoint
CREATE INDEX "connector_activity_month_org_id_period_year_period_month_index" ON "reports"."connector_activity_month" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_activity_month_org_id_period_year_period_month_driver_user_id_index" ON "reports"."driver_activity_month" USING btree ("org_id","period_year","period_month","driver_user_id");--> statement-breakpoint
CREATE INDEX "driver_activity_month_org_id_period_year_period_month_index" ON "reports"."driver_activity_month" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "mutation_receipts_org_id_scope_idempotency_key_index" ON "billing"."mutation_receipts" USING btree ("org_id","scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "mutation_receipts_expires_at_index" ON "billing"."mutation_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "session_settlements_org_id_period_id_index" ON "billing"."session_settlements" USING btree ("org_id","period_id");--> statement-breakpoint
CREATE INDEX "session_settlements_period_id_status_index" ON "billing"."session_settlements" USING btree ("period_id","status");--> statement-breakpoint
CREATE INDEX "session_settlements_org_id_driver_user_id_started_at_index" ON "billing"."session_settlements" USING btree ("org_id","driver_user_id","started_at");--> statement-breakpoint
CREATE INDEX "session_settlements_org_id_connector_id_started_at_index" ON "billing"."session_settlements" USING btree ("org_id","connector_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_components_session_id_kind_index" ON "billing"."settlement_components" USING btree ("session_id","kind");--> statement-breakpoint
CREATE INDEX "settlement_components_org_id_rate_version_id_index" ON "billing"."settlement_components" USING btree ("org_id","rate_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_holds_session_id_reason_index" ON "billing"."settlement_holds" USING btree ("session_id","reason");--> statement-breakpoint
CREATE INDEX "settlement_holds_org_id_resolved_at_index" ON "billing"."settlement_holds" USING btree ("org_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_delivery_attempts_statement_id_idempotency_key_index" ON "billing"."statement_delivery_attempts" USING btree ("statement_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "statement_delivery_attempts_org_id_state_index" ON "billing"."statement_delivery_attempts" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "statement_delivery_attempts_state_not_before_index" ON "billing"."statement_delivery_attempts" USING btree ("state","not_before");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_exports_org_id_idempotency_key_index" ON "billing"."statement_exports" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "statement_exports_org_id_period_id_index" ON "billing"."statement_exports" USING btree ("org_id","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_lines_statement_id_line_no_index" ON "billing"."statement_lines" USING btree ("statement_id","line_no");--> statement-breakpoint
CREATE INDEX "statement_lines_org_id_session_id_index" ON "billing"."statement_lines" USING btree ("org_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_period_id_recipient_kind_recipient_id_index" ON "billing"."statements" USING btree ("period_id","recipient_kind","recipient_id");--> statement-breakpoint
CREATE INDEX "statements_org_id_period_id_index" ON "billing"."statements" USING btree ("org_id","period_id");--> statement-breakpoint
CREATE INDEX "statements_org_id_recipient_kind_recipient_id_index" ON "billing"."statements" USING btree ("org_id","recipient_kind","recipient_id");