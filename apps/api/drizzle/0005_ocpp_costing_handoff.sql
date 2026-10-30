ALTER TABLE "charging"."ocpp_transactions" ADD COLUMN "costed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "charging"."ocpp_transactions" ADD COLUMN "costing_detail" jsonb;--> statement-breakpoint
ALTER TABLE "charging"."ocpp_transactions" ADD COLUMN "costing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ocpp_transactions_costing_needed_index" ON "charging"."ocpp_transactions" USING btree ("started_received_at") WHERE "charging"."ocpp_transactions"."costing_state" = 'needed';--> statement-breakpoint
-- Hand-written below. Additive; no data is read or written. The costing vocabulary of 0003's
-- check is replaced (not widened silently): every value the consumer can write is listed.
ALTER TABLE "charging"."ocpp_transactions"
  DROP CONSTRAINT "ocpp_transactions_costing_state_known",
  ADD CONSTRAINT "ocpp_transactions_costing_state_known" CHECK ("costing_state" IN ('not_needed','needed','costed','blocked_energy','excluded_unauthorized','unresolved_access','unresolved_rates','unresolved_context')),
  ADD CONSTRAINT "ocpp_transactions_costing_attempts_non_negative" CHECK ("costing_attempts" >= 0),
  ADD CONSTRAINT "ocpp_transactions_costed_has_timestamp" CHECK ("costing_state" <> 'costed' OR "costed_at" IS NOT NULL);
