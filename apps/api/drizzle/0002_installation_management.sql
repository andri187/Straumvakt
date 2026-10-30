CREATE TABLE "properties"."installation_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_label" text NOT NULL,
	"effective_at" timestamp (6) with time zone,
	"idempotency_key" uuid,
	"occurred_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties"."circuits" ALTER COLUMN "phase_count" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "properties"."circuits" ALTER COLUMN "phase_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "properties"."circuits" ADD COLUMN "parent_circuit_id" uuid;--> statement-breakpoint
ALTER TABLE "properties"."circuits" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties"."circuits" ADD COLUMN "archived_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "installation_key" text;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "main_device_type" text;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "main_rating_amps" integer;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "main_phase_count" integer;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "electrician_name" text;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "electrician_email" text;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "electrician_phone" text;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "electrician_changed_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "responsible_confirmed_revision" integer;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "ocpp_password_mode" text DEFAULT 'unset' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "ocpp_password_verifier" text;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "ocpp_password_set_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "archived_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "assets"."placements" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD COLUMN "cpo_routing_id" text;--> statement-breakpoint
CREATE INDEX "installation_changes_installation_id_occurred_at_index" ON "properties"."installation_changes" USING btree ("installation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_changes_idempotency_key_index" ON "properties"."installation_changes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "circuits_parent_circuit_id_index" ON "properties"."circuits" USING btree ("parent_circuit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "installations_installation_key_index" ON "properties"."installations" USING btree ("installation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_cpo_routing_id_index" ON "tenancy"."organizations" USING btree ("cpo_routing_id");
-- ── Hand-written below this line: CHECK constraints drizzle-kit cannot express.
-- Same convention as 0001: the snapshot does not know these exist, and
-- apps/api/src/lib/migration-constraints.test.ts asserts them against this file.
-- All are additive on columns/tables created above (or pre-existing columns
-- whose rows cannot violate them: ampere_ceiling and phase_count are only
-- written by the installation-management flow on a fresh target).

ALTER TABLE "properties"."circuits"
  ADD CONSTRAINT "circuits_ampere_ceiling_non_negative"
  CHECK ("ampere_ceiling" IS NULL OR "ampere_ceiling" >= 0);--> statement-breakpoint
ALTER TABLE "properties"."circuits"
  ADD CONSTRAINT "circuits_phase_count_known_values"
  CHECK ("phase_count" IS NULL OR "phase_count" IN (1, 2, 3));--> statement-breakpoint
ALTER TABLE "properties"."circuits"
  ADD CONSTRAINT "circuits_not_own_parent"
  CHECK ("parent_circuit_id" IS NULL OR "parent_circuit_id" <> "id");--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_main_rating_non_negative"
  CHECK ("main_rating_amps" IS NULL OR "main_rating_amps" >= 0);--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_main_phase_count_known_values"
  CHECK ("main_phase_count" IS NULL OR "main_phase_count" IN (1, 2, 3));--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_ocpp_password_mode_values"
  CHECK ("ocpp_password_mode" IN ('unset', 'none', 'password'));--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_ocpp_password_verifier_matches_mode"
  CHECK (("ocpp_password_mode" = 'password') = ("ocpp_password_verifier" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_installation_key_format"
  CHECK ("installation_key" IS NULL OR "installation_key" ~ '^[a-z0-9]{12}$');--> statement-breakpoint
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_confirmed_not_ahead_of_revision"
  CHECK ("responsible_confirmed_revision" IS NULL OR "responsible_confirmed_revision" <= "revision");--> statement-breakpoint
ALTER TABLE "tenancy"."organizations"
  ADD CONSTRAINT "organizations_cpo_routing_id_format"
  CHECK ("cpo_routing_id" IS NULL OR "cpo_routing_id" ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$');
