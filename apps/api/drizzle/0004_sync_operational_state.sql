CREATE TABLE "assets"."device_operational_state" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"connectors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_reported_at" timestamp (6) with time zone,
	"last_received_at" timestamp (6) with time zone NOT NULL,
	"seq" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties"."installations" ADD COLUMN "status_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "device_operational_state_installation_id_seq_index" ON "assets"."device_operational_state" USING btree ("installation_id","seq");--> statement-breakpoint
CREATE INDEX "installation_changes_installation_id_revision_index" ON "properties"."installation_changes" USING btree ("installation_id","revision");--> statement-breakpoint
-- Hand-written below. Additive; no data is read or written.
ALTER TABLE "properties"."installations"
  ADD CONSTRAINT "installations_status_version_non_negative" CHECK ("status_version" >= 0);--> statement-breakpoint
ALTER TABLE "assets"."device_operational_state"
  ADD CONSTRAINT "device_operational_state_seq_positive" CHECK ("seq" >= 1);