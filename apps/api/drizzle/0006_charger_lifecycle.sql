CREATE TABLE "assets"."lifecycle_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_label" text NOT NULL,
	"requested_at" timestamp (6) with time zone NOT NULL,
	"service_ended_at" timestamp (6) with time zone,
	"completed_at" timestamp (6) with time zone,
	"sessions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attention" text,
	"identity_closed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_requests_request_key_index" ON "assets"."lifecycle_requests" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_requests_one_open_per_device" ON "assets"."lifecycle_requests" USING btree ("device_id") WHERE "assets"."lifecycle_requests"."state" NOT IN ('completed','cancelled');--> statement-breakpoint
CREATE INDEX "lifecycle_requests_installation_id_state_index" ON "assets"."lifecycle_requests" USING btree ("installation_id","state");--> statement-breakpoint
-- Hand-written below. Additive; no data is read or written.
ALTER TABLE "assets"."lifecycle_requests"
  ADD CONSTRAINT "lifecycle_requests_kind_known" CHECK ("kind" IN ('remove','retire')),
  ADD CONSTRAINT "lifecycle_requests_state_known" CHECK ("state" IN ('requested','stopping','closing','settling','completed','needs_attention','cancelled')),
  ADD CONSTRAINT "lifecycle_requests_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "lifecycle_requests_completed_has_time" CHECK ("state" <> 'completed' OR "completed_at" IS NOT NULL),
  ADD CONSTRAINT "lifecycle_requests_actor_is_shared_login" CHECK ("actor_kind" = 'shared_login');
