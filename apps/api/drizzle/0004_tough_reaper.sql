CREATE TABLE "billing"."document_number_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"series" text NOT NULL,
	"period_year" integer NOT NULL,
	"next_ordinal" integer DEFAULT 1 NOT NULL,
	"pad_width" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."document_numbers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"series" text NOT NULL,
	"period_year" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"document_number" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"statement_id" uuid,
	"idempotency_key" text NOT NULL,
	"issued_by_user_id" uuid,
	"issued_at" timestamp (6) with time zone NOT NULL,
	"voided_at" timestamp (6) with time zone,
	"void_reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_number_series_org_id_series_period_year_index" ON "billing"."document_number_series" USING btree ("org_id","series","period_year");--> statement-breakpoint
CREATE UNIQUE INDEX "document_numbers_org_id_series_period_year_ordinal_index" ON "billing"."document_numbers" USING btree ("org_id","series","period_year","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "document_numbers_org_id_series_period_year_idempotency_key_index" ON "billing"."document_numbers" USING btree ("org_id","series","period_year","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_numbers_statement_id_purpose_index" ON "billing"."document_numbers" USING btree ("statement_id","purpose");--> statement-breakpoint
CREATE INDEX "document_numbers_org_id_issued_at_index" ON "billing"."document_numbers" USING btree ("org_id","issued_at");