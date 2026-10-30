CREATE SEQUENCE "charging"."ocpp_transaction_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "charging"."ocpp_transaction_readings" (
	"transaction_id" uuid NOT NULL,
	"sampled_at" timestamp (6) with time zone NOT NULL,
	"energy_wh" bigint,
	"power_w" integer,
	"other" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "ocpp_transaction_readings_transaction_id_sampled_at_pk" PRIMARY KEY("transaction_id","sampled_at")
);
--> statement-breakpoint
CREATE TABLE "charging"."ocpp_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_no" integer DEFAULT nextval('charging.ocpp_transaction_no_seq') NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"identity_string" text NOT NULL,
	"connector_no" integer NOT NULL,
	"id_tag" text NOT NULL,
	"authorization" jsonb NOT NULL,
	"authorized" boolean NOT NULL,
	"user_id" uuid,
	"id_token_id" uuid,
	"meter_start_wh" bigint NOT NULL,
	"meter_stop_wh" bigint,
	"started_reported_at" timestamp (6) with time zone NOT NULL,
	"started_received_at" timestamp (6) with time zone NOT NULL,
	"stopped_reported_at" timestamp (6) with time zone,
	"stopped_received_at" timestamp (6) with time zone,
	"stop_reason" text,
	"energy_wh" bigint,
	"energy_quality" text,
	"costing_state" text DEFAULT 'not_needed' NOT NULL,
	"reconcile_flag" text,
	"start_receipt_id" uuid NOT NULL,
	"stop_receipt_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocpp"."protocol_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"identity_string" text NOT NULL,
	"action" text NOT NULL,
	"message_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp (6) with time zone NOT NULL,
	"decision" jsonb,
	"response" jsonb,
	"responded_at" timestamp (6) with time zone
);
--> statement-breakpoint
CREATE TABLE "ocpp"."quarantined_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"transaction_no" integer,
	"received_at" timestamp (6) with time zone NOT NULL,
	"resolved_at" timestamp (6) with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ocpp_transactions_transaction_no_index" ON "charging"."ocpp_transactions" USING btree ("transaction_no");--> statement-breakpoint
CREATE INDEX "ocpp_transactions_device_id_connector_no_index" ON "charging"."ocpp_transactions" USING btree ("device_id","connector_no");--> statement-breakpoint
CREATE INDEX "ocpp_transactions_org_id_started_received_at_index" ON "charging"."ocpp_transactions" USING btree ("org_id","started_received_at");--> statement-breakpoint
CREATE INDEX "ocpp_transactions_installation_id_started_received_at_index" ON "charging"."ocpp_transactions" USING btree ("installation_id","started_received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_receipts_device_id_message_id_request_hash_index" ON "ocpp"."protocol_receipts" USING btree ("device_id","message_id","request_hash");--> statement-breakpoint
CREATE INDEX "protocol_receipts_org_id_received_at_index" ON "ocpp"."protocol_receipts" USING btree ("org_id","received_at");--> statement-breakpoint
CREATE INDEX "quarantined_events_device_id_received_at_index" ON "ocpp"."quarantined_events" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "quarantined_events_resolved_at_index" ON "ocpp"."quarantined_events" USING btree ("resolved_at");--> statement-breakpoint
-- Hand-written below: constraints drizzle-kit cannot express. Additive; no data is read or written.
ALTER TABLE "charging"."ocpp_transactions"
  ADD CONSTRAINT "ocpp_transactions_transaction_no_positive" CHECK ("transaction_no" >= 1),
  ADD CONSTRAINT "ocpp_transactions_connector_no_positive" CHECK ("connector_no" >= 1),
  ADD CONSTRAINT "ocpp_transactions_meter_start_non_negative" CHECK ("meter_start_wh" >= 0),
  ADD CONSTRAINT "ocpp_transactions_meter_stop_non_negative" CHECK ("meter_stop_wh" IS NULL OR "meter_stop_wh" >= 0),
  ADD CONSTRAINT "ocpp_transactions_stop_fields_together" CHECK (("stopped_received_at" IS NULL) = ("meter_stop_wh" IS NULL)),
  ADD CONSTRAINT "ocpp_transactions_costing_state_known" CHECK ("costing_state" IN ('not_needed','needed','blocked_energy','excluded_unauthorized')),
  ADD CONSTRAINT "ocpp_transactions_energy_quality_known" CHECK ("energy_quality" IS NULL OR "energy_quality" IN ('ok','missing_stop','register_decreased','implausible','unparseable')),
  ADD CONSTRAINT "ocpp_transactions_energy_only_when_ok" CHECK ("energy_wh" IS NULL OR "energy_quality" = 'ok'),
  ADD CONSTRAINT "ocpp_transactions_unauthorized_never_costed" CHECK ("authorized" OR "costing_state" IN ('not_needed','excluded_unauthorized'));--> statement-breakpoint
ALTER TABLE "charging"."ocpp_transaction_readings"
  ADD CONSTRAINT "ocpp_transaction_readings_energy_non_negative" CHECK ("energy_wh" IS NULL OR "energy_wh" >= 0);--> statement-breakpoint
ALTER TABLE "ocpp"."protocol_receipts"
  ADD CONSTRAINT "protocol_receipts_payload_bounded" CHECK (pg_column_size("payload") <= 16384),
  ADD CONSTRAINT "protocol_receipts_action_known" CHECK ("action" IN ('Authorize','StartTransaction','StopTransaction','MeterValues'));