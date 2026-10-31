CREATE TABLE "properties"."installation_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"state" text DEFAULT 'open' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"installation_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_label" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp (6) with time zone
);
--> statement-breakpoint
ALTER TABLE "ocpp"."pending_discoveries" ALTER COLUMN "identity_string" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "assets"."device_identities" ADD COLUMN "cpo_org_id" uuid;--> statement-breakpoint
ALTER TABLE "assets"."device_identities" ADD COLUMN "charge_point_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "installation_drafts_one_per_installation" ON "properties"."installation_drafts" USING btree ("installation_id") WHERE "properties"."installation_drafts"."installation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "installation_drafts_state_updated_at_index" ON "properties"."installation_drafts" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "device_identities_cpo_org_id_lower_charge_point_id_index" ON "assets"."device_identities" USING btree ("cpo_org_id",lower("charge_point_id"));--> statement-breakpoint
-- Hand-written below. Nothing here deletes or rewrites history.
--
-- 1. CPO-scoped connection identity. A charger now connects to wss://{cpo-id}.straumvakt.org/{charge-point-id}
--    and is resolved by (cpo_org_id, charge_point_id). Existing rows were written as
--    '{installation-key}/{charge-point-id}'. Their identity_string, period and every other column are LEFT AS
--    WRITTEN; the two new columns are filled from that same string only where the key prefix names an existing
--    installation (the installation's org is the CPO). A row that matches nothing keeps NULL in both columns and
--    is never admitted. This is the only data statement in the migration.
UPDATE "assets"."device_identities" AS di
SET "cpo_org_id" = i."org_id",
    "charge_point_id" = substr(di."identity_string", length(i."installation_key") + 2)
FROM "properties"."installations" AS i
WHERE di."cpo_org_id" IS NULL
  AND i."installation_key" IS NOT NULL
  AND left(di."identity_string", length(i."installation_key") + 1) = i."installation_key" || '/'
  AND length(di."identity_string") > length(i."installation_key") + 1;--> statement-breakpoint
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_cpo_and_charge_point_id_together"
  CHECK (("cpo_org_id" IS NULL) = ("charge_point_id" IS NULL));--> statement-breakpoint
-- At most ONE device holds a given charge point id within one CPO at any moment, whichever installation it is
-- in, and concurrent registrations cannot both win. The same id in two CPOs is allowed. Rows with NULL columns
-- never conflict. If a target already holds two overlapping rows for one CPO and id, this statement fails and the
-- whole migration rolls back: resolve those rows deliberately first; do not weaken the constraint.
ALTER TABLE "assets"."device_identities"
  ADD CONSTRAINT "device_identities_one_device_per_cpo_charge_point_id_at_a_time"
  EXCLUDE USING GIST ("cpo_org_id" WITH =, "charge_point_id" WITH =, "period" WITH &&);--> statement-breakpoint
-- 2. Unfinished-form drafts (a new table, so no existing row can violate these).
ALTER TABLE "properties"."installation_drafts"
  ADD CONSTRAINT "installation_drafts_state_values"
  CHECK ("state" IN ('open', 'consumed', 'discarded'));--> statement-breakpoint
ALTER TABLE "properties"."installation_drafts"
  ADD CONSTRAINT "installation_drafts_consumed_names_installation"
  CHECK (("state" = 'consumed') = ("installation_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "properties"."installation_drafts"
  ADD CONSTRAINT "installation_drafts_closed_when_not_open"
  CHECK (("state" = 'open') = ("closed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "properties"."installation_drafts"
  ADD CONSTRAINT "installation_drafts_payload_is_object"
  CHECK (jsonb_typeof("payload") = 'object');--> statement-breakpoint
ALTER TABLE "properties"."installation_drafts"
  ADD CONSTRAINT "installation_drafts_revision_positive"
  CHECK ("revision" >= 1);
