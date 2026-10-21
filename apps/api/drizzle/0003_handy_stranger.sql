CREATE TABLE "billing"."connector_assertions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"connector_id" uuid NOT NULL,
	"asserted_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence_note" text,
	"asserted_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."period_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"event" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "connector_assertions_org_id_period_year_period_month_connector_id_index" ON "billing"."connector_assertions" USING btree ("org_id","period_year","period_month","connector_id");--> statement-breakpoint
CREATE INDEX "connector_assertions_org_id_period_year_period_month_index" ON "billing"."connector_assertions" USING btree ("org_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "period_transitions_org_id_period_year_period_month_event_index" ON "billing"."period_transitions" USING btree ("org_id","period_year","period_month","event");--> statement-breakpoint
CREATE INDEX "period_transitions_org_id_period_year_period_month_occurred_at_index" ON "billing"."period_transitions" USING btree ("org_id","period_year","period_month","occurred_at");